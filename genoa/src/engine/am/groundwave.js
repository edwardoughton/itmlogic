// AM groundwave (47 CFR §73.183 / §73.184).
//
// FCC-CANONICAL via the vendored gwave.js (Sommerfeld-Norton evaluation
// against the FCC's pre-tabulated field grid in
// data/gwave_field.json).  Same code that backs
// geo.fcc.gov/api/contours/amDistance.json.
//
// Unlike the previous stub, this module now returns real
// contour-distance numbers per radial AND fills the radial table.
// Inputs that are out of FCC range (frequency, conductivity, ERP)
// surface as structured warnings rather than fabricated distances.

import { W } from '../../types/warnings.js';
import { fccAmDistanceKm } from '../curves/fcc/index.mjs';

// AM contour list — full consultant-grade set including the two contours
// that real AM filings (cf. Mullaney KELP 1989 Tables 1/2) compute but
// Genoa previously omitted:
//
//   blanket_1000mvm — 1000 mV/m blanket interference contour per
//     §73.24(g).  Population within this contour drives the
//     "blanketing-interference receiver complaint" obligation; if
//     the population exceeds 1% of the population within the 25 mV/m
//     contour the licensee must commit to a complaint-remediation plan.
//
//   international_25mvm — 25 mV/m daytime contour per §73.187 and
//     the US/Mexico and US/Canada AM treaties.  Triggered when the
//     subject site is near an international border (KELP at 0 km from
//     the US/Mexico border had to protect XEJPV 1560 kHz on the basis
//     of a 25 mV/m daytime overlap check).
//
// Both contours are pure-add to the existing list; FCC parity and
// per-radial geometry continue to operate on every entry uniformly.
export const AM_DEFAULT_CONTOURS = Object.freeze([
  { id: 'blanket_1000mvm',     label: '1000 mV/m (blanket intf. §73.24(g))',                   field_mvm: 1000, role: 'blanket'         },
  { id: 'service_25mvm',       label: '25 mV/m (service / §73.24(g) reference)',               field_mvm: 25,   role: 'service_25'      },
  { id: 'international_25mvm', label: '25 mV/m (international protection §73.187)',            field_mvm: 25,   role: 'international'   },
  { id: 'city_5mvm',           label: '5 mV/m (city grade)',                                   field_mvm: 5,    role: 'city'            },
  { id: 'primary_2mvm',        label: '2 mV/m (primary)',                                      field_mvm: 2,    role: 'primary'         },
  { id: 'secondary_05mvm',     label: '0.5 mV/m (secondary)',                                  field_mvm: 0.5,  role: 'secondary'       },
  { id: 'night_intf',          label: '0.025 mV/m (night intf.)',                              field_mvm: 0.025,role: 'night_interferer'}
]);

// FCC §73.184 default dielectric (relative permittivity).  The pre-
// tabulated field grid was computed against this value across the
// FCC M3 conductivity map; passing a different ε to gwave.js would
// be inconsistent with the tabulated data.
export const AM_DEFAULT_DIELECTRIC = 15;

export function amReferenceField_mVm_at_1km(erp_kW){
  return 100 * Math.sqrt(Math.max(0, erp_kW));
}

// Path-length weighted σ across a radial's constant-σ segments.
// Stage-2 approximation for §73.184 mixed-conductivity paths — the
// FCC's blessed method is Millington's reciprocal-incremental sum,
// which we'll wire later.  Weighted-σ gets us asymmetric contours
// honestly (different bearings see different σ, different distance)
// without claiming Millington-grade accuracy.  Returns null when the
// segments are empty or all-null so the caller can fall back to the
// uniform-σ path cleanly.
export function pathWeightedSigma(segments){
  if (!Array.isArray(segments) || segments.length === 0) return null;
  let num = 0;
  let den = 0;
  for (const s of segments){
    const dx = Number(s?.to_km) - Number(s?.from_km);
    const σ  = Number(s?.sigma_mS_m);
    if (!Number.isFinite(dx) || dx <= 0 || !Number.isFinite(σ) || σ <= 0) continue;
    num += σ * dx;
    den += dx;
  }
  return den > 0 ? num / den : null;
}

/**
 * Compute the AM contour radial table.
 *
 * @param {object}   args
 * @param {number}   args.erp_kW            ERP in kW
 * @param {number}   args.frequency_khz     AM carrier frequency in kHz (530..1700)
 * @param {number}   args.conductivity_msm  Ground conductivity σ in mS/m (FCC M3: 1..8) — uniform-σ fallback
 * @param {object}   [args.sigmaSegmentsByRadial]  optional { az_deg: [{from_km,to_km,sigma_mS_m}], … }
 *                                          When present and non-empty for an azimuth, the engine uses
 *                                          path-length-weighted σ from those segments instead of the
 *                                          uniform conductivity_msm.  Produces asymmetric contours.
 * @param {function} args.patternFactorFn   az_deg → relative-field factor (0..1)
 * @param {number[]} args.radials_deg       list of azimuths in degrees
 * @param {object[]} [args.contours]        contour list (default = AM_DEFAULT_CONTOURS)
 * @param {number}   [args.dielectric]      ε_r (default = AM_DEFAULT_DIELECTRIC)
 */
export function amRadialTable({
  erp_kW,
  frequency_khz,
  conductivity_msm,
  sigmaSegmentsByRadial = null,
  patternFactorFn,
  radials_deg,
  contours = AM_DEFAULT_CONTOURS,
  dielectric = AM_DEFAULT_DIELECTRIC
}){
  // Capture σ clamp/rounding metadata from the first successful FCC
  // call; even with per-radial σ each call still hits the same FCC M3
  // grid and clamp logic.  Exposed as the table's `_ground_constants`
  // sidecar so the orchestrator can plumb it onto
  // exhibit.evidence.ground_constants and emit SIGMA_CLAMP warnings.
  let groundConstants = null;
  let radialsUsingSegments = 0;
  const rows = radials_deg.map(az => {
    const f = patternFactorFn(az);
    const erp_az = erp_kW * f * f;
    // Per-radial σ resolution: if the orchestrator handed us segments
    // for this azimuth, use the path-length-weighted σ; else fall back
    // to the uniform conductivity_msm.  Crucially, the SAME contour
    // call shape is used either way — only the σ number changes — so
    // the FCC §73.184 grid lookup stays bit-identical to the uniform-σ
    // case.  This is the stage-2 approximation; stage-3 will replace
    // the weighted-σ call with a real Millington integration that
    // walks the segments instead of collapsing them.
    const segs = sigmaSegmentsByRadial?.[az] || sigmaSegmentsByRadial?.[String(az)] || null;
    const σ_seg = pathWeightedSigma(segs);
    const σ_use = (σ_seg != null && Number.isFinite(σ_seg)) ? σ_seg : conductivity_msm;
    const usedSegments = (σ_seg != null && Number.isFinite(σ_seg));
    if (usedSegments) radialsUsingSegments += 1;
    const distances = {};
    for (const c of contours){
      try {
        const r = fccAmDistanceKm({
          frequency_khz,
          target_mvm:        c.field_mvm,
          conductivity_msm:  σ_use,
          dielectric,
          erp_kw:            erp_az
        });
        distances[c.id] = r.distance_km;
        if (!groundConstants && r.inputs){
          const sigma_in  = Number(r.inputs.conductivity_msm_raw);
          const sigma_use = Number(r.inputs.conductivity_msm);
          const rounding  = Number.isFinite(sigma_in) && Number.isFinite(sigma_use)
            ? +(sigma_use - sigma_in).toFixed(6)
            : null;
          let src = 'exact';
          if (r.inputs.conductivity_clamp === 'low')  src = 'clamped-low (FCC M3 floor σ=1 mS/m)';
          else if (r.inputs.conductivity_clamp === 'high') src = 'clamped-high (FCC M3 ceiling σ=8 mS/m)';
          else if (rounding !== 0 && rounding !== null) src = 'rounded-to-integer-grid';
          groundConstants = {
            sigma_input:    Number.isFinite(sigma_in) ? sigma_in : null,
            sigma_used:     Number.isFinite(sigma_use) ? sigma_use : null,
            sigma_rounding: rounding,
            sigma_clamp:    r.inputs.conductivity_clamp || null,
            sigma_source:   src,
            dielectric:     Number(r.inputs.dielectric),
            frequency_khz_grid: Number(r.inputs.frequency_khz_grid),
            regulation:     '47 CFR §73.184 / Figure M3 (σ ∈ {1..8} mS/m integer grid)'
          };
        }
      } catch (e){
        // Out-of-range / FCC routine error — record null, do NOT
        // fabricate.  The orchestrator surfaces a warning.
        distances[c.id] = null;
      }
    }
    // AM radial row schema — AM-native, NO HAAT keys.  Audit caught
    // the prior leak where haat_input_m / haat_computed_m / haat_source
    // were emitted as nulls on every AM row; the Appendix A renderer
    // ignored them but the schema itself signaled "FM architecture
    // applied to AM exhibits".  Removed entirely.  FM/TV radial rows
    // keep their HAAT keys in their own engine path.
    return {
      azimuth_deg:                az,
      relative_field:             f,
      terrain_profile_source:     null,
      reference_field_mVm_at_1km: 100 * Math.sqrt(Math.max(0, erp_az)),
      contour_distances_km:       distances,
      // Per-radial M3 conductivity evidence — null when uniform-σ.
      sigma_path: usedSegments ? {
        method:            'path-length weighted (stage-2)',
        sigma_used_mS_m:   σ_use,
        sigma_uniform_mS_m: conductivity_msm,
        segments:          segs.map((s) => ({
          from_km:    Number(s.from_km),
          to_km:      Number(s.to_km),
          sigma_mS_m: Number(s.sigma_mS_m)
        })),
        n_segments:        segs.length,
        regulation:        '47 CFR §73.184 mixed-conductivity path (Millington method to replace weighted-σ in stage-3)'
      } : null
    };
  });
  // Attach the ground-constants sidecar on the array without changing
  // its iteration shape — callers that don't read it see the original
  // per-radial array.
  Object.defineProperty(rows, '_ground_constants', {
    value:        groundConstants,
    enumerable:   false,
    configurable: false
  });
  // Attach summary of segmentation use so the orchestrator can decide
  // whether to surface the "M3 per-radial segmentation: ENABLED" badge
  // on the PDF / verdict.
  Object.defineProperty(rows, '_sigma_segmentation', {
    value: {
      enabled:                radialsUsingSegments > 0,
      radials_with_segments:  radialsUsingSegments,
      radials_total:          radials_deg.length,
      method:                 'path-length weighted (stage-2)',
      uniform_sigma_fallback: conductivity_msm
    },
    enumerable:   false,
    configurable: false
  });
  return rows;
}

/**
 * Inspect σ resolution metadata.  Returns the same shape as the
 * `_ground_constants` sidecar attached to amRadialTable's return value,
 * computed standalone for callers that just want to know how the FCC
 * grid clamped/rounded their σ before computing distances.
 */
export function amGroundConstants({ frequency_khz, conductivity_msm, dielectric = AM_DEFAULT_DIELECTRIC } = {}){
  const sigma_in = Number(conductivity_msm);
  if (!Number.isFinite(sigma_in)) return null;
  let sigma_use = Math.round(sigma_in);
  let clamp = null;
  if (sigma_use < 1){ sigma_use = 1; clamp = 'low'; }
  else if (sigma_use > 8){ sigma_use = 8; clamp = 'high'; }
  const rounding = +(sigma_use - sigma_in).toFixed(6);
  let src = 'exact';
  if (clamp === 'low') src = 'clamped-low (FCC M3 floor σ=1 mS/m)';
  else if (clamp === 'high') src = 'clamped-high (FCC M3 ceiling σ=8 mS/m)';
  else if (rounding !== 0) src = 'rounded-to-integer-grid';
  return {
    sigma_input:    sigma_in,
    sigma_used:     sigma_use,
    sigma_rounding: rounding,
    sigma_clamp:    clamp,
    sigma_source:   src,
    dielectric:     Number(dielectric),
    frequency_khz_grid: Number.isFinite(Number(frequency_khz)) ? Math.round(Number(frequency_khz) / 10) * 10 : null,
    regulation:     '47 CFR §73.184 / Figure M3 (σ ∈ {1..8} mS/m integer grid)'
  };
}

// Returns warnings for the AM compute path.  No longer emits
// AM_ENGINE_NOT_IMPLEMENTED — the engine IS implemented now via the
// vendored FCC gwave.js — but flags real input gaps (missing σ,
// out-of-range frequency, etc).
export function amWarnings({ frequency_khz, conductivity_msm, erp_kw } = {}){
  const out = [];
  const freq = Number(frequency_khz);
  const sigma = Number(conductivity_msm);
  const erp = Number(erp_kw);
  if (!Number.isFinite(freq) || freq < 530 || freq > 1700){
    out.push(W.make('FCC_METHOD_MISSING',
      `AM frequency ${freq} kHz is outside the FCC AM band (530..1700 kHz); §73.184 groundwave does not apply.`));
  }
  if (!Number.isFinite(sigma) || sigma < 1 || sigma > 8){
    out.push(W.make('FCC_METHOD_MISSING',
      `AM ground conductivity ${sigma} mS/m is outside the FCC M3 grid (1..8 mS/m).  The FCC §73.184 tabulated curves do not extend beyond this range.`));
  }
  if (!Number.isFinite(erp) || erp <= 0){
    out.push(W.make('FCC_METHOD_MISSING',
      'AM ERP must be positive for §73.184 groundwave computation.'));
  }
  return out;
}
