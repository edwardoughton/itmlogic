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

export const AM_DEFAULT_CONTOURS = Object.freeze([
  { id: 'city_5mvm',      label: '5 mV/m (city grade)',       field_mvm: 5    },
  { id: 'primary_2mvm',   label: '2 mV/m (primary)',          field_mvm: 2    },
  { id: 'secondary_05mvm',label: '0.5 mV/m (secondary)',      field_mvm: 0.5  },
  { id: 'night_intf',     label: '0.025 mV/m (night intf.)',  field_mvm: 0.025}
]);

// FCC §73.184 default dielectric (relative permittivity).  The pre-
// tabulated field grid was computed against this value across the
// FCC M3 conductivity map; passing a different ε to gwave.js would
// be inconsistent with the tabulated data.
export const AM_DEFAULT_DIELECTRIC = 15;

export function amReferenceField_mVm_at_1km(erp_kW){
  return 100 * Math.sqrt(Math.max(0, erp_kW));
}

/**
 * Compute the AM contour radial table.
 *
 * @param {object}   args
 * @param {number}   args.erp_kW            ERP in kW
 * @param {number}   args.frequency_khz     AM carrier frequency in kHz (530..1700)
 * @param {number}   args.conductivity_msm  Ground conductivity σ in mS/m (FCC M3: 1..8)
 * @param {function} args.patternFactorFn   az_deg → relative-field factor (0..1)
 * @param {number[]} args.radials_deg       list of azimuths in degrees
 * @param {object[]} [args.contours]        contour list (default = AM_DEFAULT_CONTOURS)
 * @param {number}   [args.dielectric]      ε_r (default = AM_DEFAULT_DIELECTRIC)
 */
export function amRadialTable({
  erp_kW,
  frequency_khz,
  conductivity_msm,
  patternFactorFn,
  radials_deg,
  contours = AM_DEFAULT_CONTOURS,
  dielectric = AM_DEFAULT_DIELECTRIC
}){
  return radials_deg.map(az => {
    const f = patternFactorFn(az);
    const erp_az = erp_kW * f * f;
    const distances = {};
    for (const c of contours){
      try {
        const r = fccAmDistanceKm({
          frequency_khz,
          target_mvm:        c.field_mvm,
          conductivity_msm,
          dielectric,
          erp_kw:            erp_az
        });
        distances[c.id] = r.distance_km;
      } catch (e){
        // Out-of-range / FCC routine error — record null, do NOT
        // fabricate.  The orchestrator surfaces a warning.
        distances[c.id] = null;
      }
    }
    return {
      azimuth_deg:                az,
      relative_field:             f,
      haat_input_m:               null,
      haat_computed_m:            null,
      haat_source:                'n/a (AM groundwave)',
      terrain_profile_source:     null,
      reference_field_mVm_at_1km: 100 * Math.sqrt(Math.max(0, erp_az)),
      contour_distances_km:       distances
    };
  });
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
