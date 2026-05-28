// §73.215 / §73.207 "path to compliance" remediation analysis.
//
// When an exhibit is NON-COMPLIANT on distance/contour-protection, this
// runs a BOUNDED, free-space ERP × HAAT × directional-pattern parameter
// sweep (reusing the existing sweep engine + scorer) to find a
// configuration that would qualify under §73.207 OR §73.215 — i.e. the
// engineering "alternative route" to authorization.  The directional
// axis offers notch patterns aimed at the binding stations' bearings;
// the §73.215 check arbitrates, so a notched candidate only counts as
// compliant if it genuinely clears the conflicts (no false positives).
// STRICTLY ADVISORY: it never changes the compliance determination; it
// surfaces a remediation option for the engineer of record.
//
// Recursion-safe by construction: the sweep calls the engine compute()
// directly (never the job runner / this module), and this module is
// only invoked from the job layer — so a sweep combo can never
// re-trigger another remediation.

import { sweepParameters } from './sweepEngine.js';

// True only when the facility is genuinely NON-COMPLIANT on
// distance/contour protection — i.e. it qualifies under NEITHER §73.207
// distance NOR the §73.215 contour-protection alternative
// (regulatory_compliance.pass === false).  A §73.207 distance shortfall
// by itself is NOT a failure when §73.215 saves it ("COMPLIANT VIA
// ALTERNATE RULE"), so we must not fire on section_73_207.pass === false
// alone — that would offer a spurious remediation on an already-
// compliant facility.
export function needsRemediation(exhibit){
  const reg = exhibit?.regulatory_compliance;
  if (!reg) return false;
  return reg.pass === false && /73\.215|73\.207/.test(String(reg.cite || ''));
}

// Build a downward ERP × HAAT envelope from the current facility: ERP
// from ~10% up to current (≈6 points), HAAT from the §73.333 30 m floor
// up to current (≈4 points) → ≤ ~24 combos.  Reducing either shrinks
// the interfering contour and recovers D/U margin.
export function buildRemediationRanges(baseInputs, bearings){
  const ranges = {};
  const erp  = Number(baseInputs?.erp_kw ?? baseInputs?.erp);
  const haat = Number(baseInputs?.haat_m ?? baseInputs?.haat);
  if (Number.isFinite(erp) && erp > 0.1){
    const min  = Math.max(0.1, +(erp * 0.1).toFixed(2));
    const step = Math.max(0.1, +((erp - min) / 5).toFixed(2));
    ranges.erp_kw = { min, max: erp, step };
  }
  if (Number.isFinite(haat) && haat > 30){
    const step = Math.max(10, Math.round((haat - 30) / 3));
    ranges.haat_m = { min: 30, max: haat, step };
  }
  // Directional axis: when binding bearings are known, offer the
  // non-directional baseline (null) plus notch patterns toward those
  // bearings at a few depths.  The §73.215 check arbitrates — a notched
  // pattern only counts as compliant if it genuinely clears the
  // conflicts, so this can never produce a false positive.
  if (Array.isArray(bearings) && bearings.length){
    ranges.patterns = [
      null,
      notchPattern(bearings, dbToFactor(-6)),
      notchPattern(bearings, dbToFactor(-12)),
      notchPattern(bearings, dbToFactor(-20))
    ];
  }
  return ranges;
}

// Geographic bearings (deg, subject → station) of the §73.215 pairs the
// subject fails — the directions a directional null must protect.  Reads
// the per-pair forward study's `bearings.u_to_d_deg` (azimuth from the
// subject/undesired toward the protected nearby).  Deduped to ~10°.
export function bindingBearings(exhibit){
  const studies = exhibit?.regulatory_compliance?.studies;
  if (!Array.isArray(studies)) return [];
  const out = [];
  for (const s of studies){
    if (s?.pair_pass !== false) continue;
    const b = Number(s?.forward?.bearings?.u_to_d_deg);
    if (!Number.isFinite(b)) continue;
    const r = Math.round((((b % 360) + 360) % 360) / 10) * 10 % 360;
    if (!out.includes(r)) out.push(r);
  }
  return out;
}

// Per-pair detail for the §73.215 pairs the subject FAILS — the binding
// constraints any remediation must clear.  Used to explain WHY no
// configuration was found: the worst (most-deficient) D/U leg gives the
// shortfall, and the polygon-overlap area is carried for pairs that fail
// on contour overlap rather than the bearing-D/U pre-filter.  Sorted
// most-deficient first, so the dominant blocker is named before minor
// ones.  Returns [] when there are no failing pairs.
export function bindingConstraints(exhibit){
  const studies = exhibit?.regulatory_compliance?.studies;
  if (!Array.isArray(studies)) return [];
  const out = [];
  for (const s of studies){
    if (s?.pair_pass !== false) continue;
    const required = Number(s?.du_threshold_db);
    const legs = [Number(s?.forward?.du_actual_db), Number(s?.reverse?.du_actual_db)]
      .filter(Number.isFinite);
    const worst = legs.length ? Math.min(...legs) : null;       // most-deficient D/U
    const shortfall = (Number.isFinite(required) && worst != null)
      ? +(required - worst).toFixed(1) : null;
    const po = s?.polygon_overlap || {};
    const overlap = Math.max(
      Number(po.subject_interfering_overlap_area_km2) || 0,
      Number(po.nearby_interfering_overlap_area_km2)  || 0
    );
    out.push({
      call:         s.nearby_call || s.nearby_facility_id || 'nearby',
      relationship: s.relationship || null,
      required_db:  Number.isFinite(required) ? required : null,
      actual_db:    worst != null ? +worst.toFixed(1) : null,
      shortfall_db: shortfall,
      overlap_km2:  overlap > 0 ? Math.round(overlap) : null,
      // When the protected edge is inside the FCC free-space boundary the
      // D/U is a non-physical extrapolation (engulfed contours); the
      // shortfall figure is then meaningless and should not be printed.
      beyond_curve_range: s.forward?.du_beyond_curve_range === true
                       || s.reverse?.du_beyond_curve_range === true
    });
  }
  out.sort((a, b) => (b.shortfall_db ?? -Infinity) - (a.shortfall_db ?? -Infinity));
  return out;
}

function dbToFactor(db){ return Math.pow(10, db / 20); }

// 1-D azimuth pattern_table [[az_deg, field_factor]] (36 × 10°,
// peak-normalized to 1.0) with raised-cosine nulls toward each bearing
// at the given minimum field factor.  The factor at each azimuth is the
// min across all requested nulls, so multiple binding directions are
// suppressed simultaneously.
export function notchPattern(bearings, minFactor, halfWidthDeg = 35){
  const table = [];
  for (let az = 0; az < 360; az += 10){
    let f = 1.0;
    for (const b of bearings){
      let d = Math.abs(az - b) % 360;
      if (d > 180) d = 360 - d;
      if (d < halfWidthDeg){
        const g = minFactor + (1 - minFactor) * (0.5 - 0.5 * Math.cos(Math.PI * d / halfWidthDeg));
        if (g < f) f = g;
      }
    }
    table.push([az, Math.round(f * 1e4) / 1e4]);
  }
  return table;
}

export async function runRemediationSweep({
  baseInputs,
  bearings    = [],
  evidence    = {},
  validation,
  computeFn,
  maxCombos   = 24
} = {}){
  const ranges = buildRemediationRanges(baseInputs, bearings);
  if (!Object.keys(ranges).length){
    return { available: false, reason: 'no ERP/HAAT available to vary' };
  }
  // Strip per-radial terrain so each combo's haat_m drives a flat HAAT
  // profile (same reasoning as the /sweep route); keep other evidence.
  // eslint-disable-next-line no-unused-vars
  const { terrain_haat_per_radial, terrain_haat_requested, ...ev } = evidence || {};

  // With a directional axis the grid grows (ERP × HAAT × patterns); raise
  // the cap so full-power notched candidates aren't downsampled away.
  const cap = Array.isArray(ranges.patterns) ? Math.max(maxCombos, 120) : maxCombos;

  const sweep = await sweepParameters({
    baseInputs,
    sweepRanges: ranges,
    evidence:    ev,
    validation,
    options:     { max_combinations: cap, top_n: 5, only_compliant: true },
    computeFn
  });

  const best = sweep.best;
  const bestPat = best?.combo?.pattern_table;
  const directional = Array.isArray(bestPat) && bestPat.length > 0;
  const notch_db = directional
    ? Math.round(20 * Math.log10(Math.min(...bestPat.map(p => Number(p[1]) || 1))))
    : null;
  return {
    available:   true,
    none_found:  !best,
    evaluated:   sweep.total_evaluated,
    searched:    ranges,
    binding_bearings_deg: bearings,
    recommended: best ? {
      erp_kw:          best.combo?.erp_kw ?? null,
      haat_m:          best.combo?.haat_m ?? null,
      service_km2:     best.coverage_km2 ?? null,
      compliance_path: best.compliance?.distance_path || '§73.215',
      directional,
      notch_bearings_deg: directional ? bearings : null,
      notch_depth_db:     notch_db
    } : null,
    candidates: (sweep.top_compliant || []).slice(0, 5).map(r => ({
      erp_kw:      r.combo?.erp_kw ?? null,
      haat_m:      r.combo?.haat_m ?? null,
      service_km2: r.coverage_km2 ?? null,
      directional: Array.isArray(r.combo?.pattern_table) && r.combo.pattern_table.length > 0
    }))
  };
}
