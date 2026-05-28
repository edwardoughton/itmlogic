// Exhibit diff — given two computed exhibits (an existing-licensed
// "before" and a proposed "after"), surface every meaningful change
// in a flat, reviewer-friendly delta payload.  Drives the move-in
// / what-if studies brokers commission from H&D.
//
// CONTRACT
//   diffExhibits(before, after, opts?)
//     → {
//         ok, regulation,
//         identity:                   { call, facility_id, kept_same? },
//         station_inputs_delta:       { freq, lat, lon, erp, haat, class, pattern_mode, distance_moved_km },
//         contour_delta:              { [contour_id]: { before_mean_km, after_mean_km, delta_km, before_area_km2, after_area_km2, delta_area_km2 } },
//         population_delta:           { before, after, delta },
//         interference_delta:         { before_qualifies, after_qualifies, delta_pass, delta_fail, new_violations[], cleared_violations[] },
//         regulatory_compliance_delta: { rules_passing_before[], rules_passing_after[], became_passing[], became_failing[] },
//         warnings_delta:             { added[], removed[], unchanged_count },
//         summary:                    { headline, severity }
//       }
//
// All deltas are after - before; positive = grew/added; negative =
// shrank/removed.
//
// IMPLEMENTATION NOTE
//   Both inputs MUST be Genoa exhibit-v2 objects (or a subset
//   thereof).  We do NOT re-compute either exhibit here — diffing
//   is pure shape-comparison so the caller can run "compute → diff
//   → compute → diff" against a single existing baseline without
//   re-running the engine on the baseline every time.
//
// LIMITATIONS
//   - Population_estimate is currently informational-only across
//     Genoa (no Census dispatch live), so the delta will be null
//     until the population sidecar is wired.  We surface the
//     delta-or-null transparently rather than fabricating a number.
//   - Antenna pattern delta is by-mode only ("omni" → "DA" or vice
//     versa), not a per-azimuth pattern_table diff.

import { karneyInverse } from './geometry/wgs84.js';

export function diffExhibits(before, after, opts = {}){
  if (!before || typeof before !== 'object'){
    return { ok: false, error: 'before exhibit required' };
  }
  if (!after || typeof after !== 'object'){
    return { ok: false, error: 'after exhibit required' };
  }
  const sb = before.station_inputs || {};
  const sa = after.station_inputs  || {};

  // Identity — same call/facility = "minor mod"; different = "new build" comparison.
  const identity = {
    before: {
      call:        sb.call || null,
      facility_id: sb.facility_id || null
    },
    after: {
      call:        sa.call || null,
      facility_id: sa.facility_id || null
    },
    kept_same: !!sb.facility_id
            && !!sa.facility_id
            && String(sb.facility_id) === String(sa.facility_id)
  };

  // Station-input deltas.  Distance-moved is the great-circle
  // between the two coordinates; everything else is scalar arithmetic.
  let distance_moved_km = null;
  if (Number.isFinite(Number(sb.lat)) && Number.isFinite(Number(sb.lon))
      && Number.isFinite(Number(sa.lat)) && Number.isFinite(Number(sa.lon))){
    try {
      const inv = karneyInverse(Number(sb.lat), Number(sb.lon),
                                Number(sa.lat), Number(sa.lon));
      distance_moved_km = Number(inv.distance_km.toFixed(3));
    } catch { distance_moved_km = null; }
  }
  const station_inputs_delta = {
    frequency: scalarDelta(sb.frequency,    sa.frequency),
    erp_kw:    scalarDelta(sb.erp_kw,       sa.erp_kw),
    haat_m:    scalarDelta(sb.haat_m,       sa.haat_m),
    fcc_class: enumDelta  (sb.fcc_class,    sa.fcc_class),
    pattern_mode: enumDelta(sb.pattern_mode, sa.pattern_mode),
    site_changed: distance_moved_km !== null && distance_moved_km > 0.05,
    distance_moved_km
  };

  // Contour delta — per contour-id (e.g. service_60dbu, city_54dbu,
  // protected_40dbu) compute mean radial distance + filed polygon
  // area before / after.
  const contour_delta = {};
  const beforeContours = collectContours(before);
  const afterContours  = collectContours(after);
  const allContourIds = new Set([
    ...Object.keys(beforeContours),
    ...Object.keys(afterContours)
  ]);
  for (const id of allContourIds){
    const b = beforeContours[id] || null;
    const a = afterContours[id]  || null;
    contour_delta[id] = {
      before_mean_km:   b?.mean_km   ?? null,
      after_mean_km:    a?.mean_km   ?? null,
      delta_km:         b?.mean_km != null && a?.mean_km != null
                          ? Number((a.mean_km - b.mean_km).toFixed(3))
                          : null,
      before_area_km2:  b?.area_km2  ?? null,
      after_area_km2:   a?.area_km2  ?? null,
      delta_area_km2:   b?.area_km2 != null && a?.area_km2 != null
                          ? Number((a.area_km2 - b.area_km2).toFixed(2))
                          : null,
      before_present:   !!b,
      after_present:    !!a
    };
  }

  // Population delta — both sides will be null until the population
  // sidecar wires real Census/ACS data.  We still surface the field
  // shape so consumers can render a "—" without special-casing.
  const popB = numberOrNull(before.population_estimate?.primary);
  const popA = numberOrNull(after.population_estimate?.primary);
  const population_delta = {
    before:        popB,
    after:         popA,
    delta:         popB != null && popA != null ? popA - popB : null,
    informational_only:
      !!(before.population_estimate?.informational_only
         || after.population_estimate?.informational_only)
  };

  // Interference delta — compare interference_study filing_qualifies
  // and per-station verdicts.  "New violations" are stations that
  // failed in `after` but not `before`; "cleared violations" are the
  // inverse.
  const interference_delta = compareInterferenceStudies(
    before.interference_study, after.interference_study
  );

  // Regulatory compliance delta — which rules transitioned pass/fail.
  const regulatory_compliance_delta = compareRegulatoryCompliance(
    before.regulatory_compliance, after.regulatory_compliance
  );

  // Warnings delta — by code.
  const wb = new Set((before.warnings || []).map((w) => w.code).filter(Boolean));
  const wa = new Set((after.warnings  || []).map((w) => w.code).filter(Boolean));
  const warnings_delta = {
    added:    [...wa].filter((c) => !wb.has(c)),
    removed:  [...wb].filter((c) => !wa.has(c)),
    unchanged_count: [...wa].filter((c) => wb.has(c)).length
  };

  // Headline + severity heuristic.
  const summary = makeSummary({
    identity, station_inputs_delta, contour_delta,
    interference_delta, regulatory_compliance_delta, warnings_delta
  });

  return {
    ok:                          true,
    regulation:                  '47 CFR §73.207 / §73.215 (FM); §73.182 (AM nighttime); §74.1204 (FX) — diff over the rules each side actually evaluated',
    identity,
    station_inputs_delta,
    contour_delta,
    population_delta,
    interference_delta,
    regulatory_compliance_delta,
    warnings_delta,
    summary
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function scalarDelta(b, a){
  const nb = numberOrNull(b);
  const na = numberOrNull(a);
  return {
    before: nb,
    after:  na,
    delta:  nb != null && na != null ? Number((na - nb).toFixed(6)) : null,
    changed: nb !== na
  };
}

function enumDelta(b, a){
  return {
    before:  b ?? null,
    after:   a ?? null,
    changed: (b ?? null) !== (a ?? null)
  };
}

function numberOrNull(x){
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/**
 * For each contour id present in the exhibit's radial_table, compute
 * the mean radial distance and the filed-polygon area (km²).  Area
 * uses the spherical-cap polygon-area approximation suitable for
 * short-radius FM contours.
 */
function collectContours(exhibit){
  const out = {};
  const rt = Array.isArray(exhibit.radial_table) ? exhibit.radial_table : [];
  if (rt.length === 0) return out;
  // Derive the contour id list from the first radial.
  const contourIds = new Set();
  for (const r of rt){
    for (const id of Object.keys(r.contour_distances_km || {})) contourIds.add(id);
  }
  for (const id of contourIds){
    const radii = [];
    for (const r of rt){
      const d = Number(r.contour_distances_km?.[id]);
      if (Number.isFinite(d) && d > 0) radii.push(d);
    }
    if (radii.length === 0){ continue; }
    const mean_km = radii.reduce((a, x) => a + x, 0) / radii.length;
    // Filed polygon area, treating radials as evenly spaced rays in
    // a plane (small-angle approximation; good to a few % at FM
    // contour scales).  Area = (π / N) * Σ rᵢ² when radials are
    // equally spaced over 360°.
    const n = radii.length;
    const area_km2 = (Math.PI / n) * radii.reduce((a, x) => a + x * x, 0);
    out[id] = {
      mean_km:  Number(mean_km.toFixed(3)),
      area_km2: Number(area_km2.toFixed(2)),
      n_radials: n
    };
  }
  return out;
}

function compareInterferenceStudies(b, a){
  const out = {
    before_present:        !!b,
    after_present:         !!a,
    before_qualifies:      b?.filing_qualifies ?? null,
    after_qualifies:       a?.filing_qualifies ?? null,
    delta_pass:            null,
    delta_fail:            null,
    new_violations:        [],
    cleared_violations:    []
  };
  if (!b || !a) return out;
  out.delta_pass = (a.n_pass ?? 0) - (b.n_pass ?? 0);
  out.delta_fail = (a.n_fail ?? 0) - (b.n_fail ?? 0);

  const beforeFails = stationFailureSet(b.stations);
  const afterFails  = stationFailureSet(a.stations);
  out.new_violations     = [...afterFails].filter((s) => !beforeFails.has(s));
  out.cleared_violations = [...beforeFails].filter((s) => !afterFails.has(s));
  return out;
}

function stationFailureSet(stations){
  const out = new Set();
  if (!Array.isArray(stations)) return out;
  for (const s of stations){
    if (s?.pair_pass === false || s?.section_73_207?.pass === false || s?.section_73_215?.pass === false){
      const key = s.call || s.facility_id || JSON.stringify(s);
      out.add(String(key));
    }
  }
  return out;
}

function compareRegulatoryCompliance(b, a){
  const out = {
    rules_passing_before: [],
    rules_passing_after:  [],
    became_passing:       [],
    became_failing:       []
  };
  const bRules = passingRuleSet(b);
  const aRules = passingRuleSet(a);
  out.rules_passing_before = [...bRules];
  out.rules_passing_after  = [...aRules];
  out.became_passing = [...aRules].filter((r) => !bRules.has(r));
  out.became_failing = [...bRules].filter((r) => !aRules.has(r));
  return out;
}

function passingRuleSet(reg){
  const out = new Set();
  if (!reg || typeof reg !== 'object') return out;
  for (const [rule, body] of Object.entries(reg)){
    if (body && typeof body === 'object' && body.pass === true){
      out.add(rule);
    }
  }
  return out;
}

function makeSummary({ identity, station_inputs_delta, contour_delta,
                       interference_delta, regulatory_compliance_delta,
                       warnings_delta }){
  const bits = [];
  if (station_inputs_delta.site_changed){
    bits.push(`site moved ${station_inputs_delta.distance_moved_km} km`);
  }
  if (station_inputs_delta.fcc_class.changed){
    bits.push(`class ${station_inputs_delta.fcc_class.before}→${station_inputs_delta.fcc_class.after}`);
  }
  if (station_inputs_delta.frequency.changed){
    bits.push(`freq ${station_inputs_delta.frequency.before}→${station_inputs_delta.frequency.after}`);
  }
  if (station_inputs_delta.erp_kw.changed && Number.isFinite(station_inputs_delta.erp_kw.delta)){
    bits.push(`ERP ${station_inputs_delta.erp_kw.delta > 0 ? '+' : ''}${station_inputs_delta.erp_kw.delta} kW`);
  }
  if (station_inputs_delta.haat_m.changed && Number.isFinite(station_inputs_delta.haat_m.delta)){
    bits.push(`HAAT ${station_inputs_delta.haat_m.delta > 0 ? '+' : ''}${station_inputs_delta.haat_m.delta} m`);
  }
  // Service contour shift if present.
  for (const id of ['service_60dbu', 'city_54dbu', 'protected_40dbu']){
    const c = contour_delta[id];
    if (c && c.delta_km != null && Math.abs(c.delta_km) >= 0.1){
      bits.push(`${id} ${c.delta_km > 0 ? '+' : ''}${c.delta_km.toFixed(2)} km`);
      break;   // headline only carries the most impactful contour
    }
  }
  if (interference_delta.new_violations?.length){
    bits.push(`${interference_delta.new_violations.length} new violations`);
  }
  if (interference_delta.cleared_violations?.length){
    bits.push(`${interference_delta.cleared_violations.length} cleared violations`);
  }
  if (regulatory_compliance_delta.became_failing?.length){
    bits.push(`now failing: ${regulatory_compliance_delta.became_failing.join(', ')}`);
  }

  let severity = 'minor';
  if (regulatory_compliance_delta.became_failing?.length
      || interference_delta.new_violations?.length
      || warnings_delta.added.includes('FILING_BLOCKED')){
    severity = 'blocking';
  } else if (station_inputs_delta.site_changed
          || station_inputs_delta.fcc_class.changed
          || station_inputs_delta.frequency.changed){
    severity = 'major';
  }

  const headline = bits.length
    ? bits.join('; ')
    : (identity.kept_same ? 'no station-input changes detected' : 'comparator station');
  return { headline, severity };
}

export const EXHIBIT_DIFF_PROVENANCE = Object.freeze({
  module:     'src/engine/exhibitDiff.js',
  regulation: '47 CFR §73.207 / §73.215 (FM); §73.182 (AM nighttime); §74.1204 (FX)',
  modeled: [
    'Station-input scalar diffs (freq / ERP / HAAT / class / pattern_mode)',
    'Site-shift great-circle distance via WGS-84 Karney',
    'Per-contour mean-radial + filed-polygon-area deltas',
    'Interference-study verdict delta + per-station added/cleared violations',
    'Regulatory-compliance rule transitions (pass↔fail)',
    'Warning-code added/removed sets'
  ],
  not_modeled: [
    'Per-azimuth pattern_table diff (we report mode-only)',
    'Per-station §73.215 contour-overlap delta (use full exhibit re-compute for that)',
    'Population delta — currently informational-only across Genoa (Census sidecar pending)'
  ],
  license_basis: '17 USC §105 (FCC compliance rules + tables, US Government public domain)'
});
