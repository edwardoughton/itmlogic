// Nighttime-Interference-Free (NIF) contour solver for AM stations
// under 47 CFR §73.182.
//
// For each of N azimuths around the proposed station, find the
// distance at which the station's *desired* field (50% skywave
// after pattern-factor) drops to the §73.182(k) RSS-of-interferers
// times the required D/U ratio.  The locus of those distances is
// the NIF contour — the boundary inside which the proposed station
// provides protected nighttime service.
//
// The solver is per-azimuth bisection:
//   - At each azimuth, walk outward; station field decreases ~
//     monotonically with distance, interferer field is approximately
//     azimuth-only at receiver scale; both functions are smooth,
//     so bisection converges in ~12 iterations at any practical
//     starting bracket.
//   - All field evaluations go through src/engine/am/skywave.js
//     which is a thin wrapper over the FCCAM sidecar — single source
//     of truth for skywave numbers.
//
// CONTRACT
//   solveNifContour({
//     proposed:    { lat, lon, freq_khz, erp_kw, pattern_table?, fcc_class },
//     interferers: [{ id, call, lat, lon, freq_khz, erp_kw, pattern_table?,
//                     fcc_class, relation: 'co_channel'|'first_adjacent'|... }],
//     azimuths_deg: number[]    // default [0..350 step 10]
//   }, { fccamClient, duDbOverride? })
//     → { available, contour: [{ az, lat, lon, distance_km, ... }], failures[] }
//
// CALLER RESPONSIBILITY
//   - Geometry, frequency, and class membership must be pre-validated
//     (use band.js + LMS metadata).
//   - The fccamClient must be live; this module returns
//     available:false when the sidecar can't be reached.
//
// REGULATORY
//   - 47 CFR §73.182      — engineering standards of allocation
//   - 47 CFR §73.182(k)   — RSS aggregation, 25% exclusion
//   - 47 CFR §73.183(b)   — class-specific protection ratios

import {
  applyPatternFactor,
  bearingDeg,
  buildBatchInputs,
  destinationPoint,
  greatCircleKm,
  patternFactorAt
} from './skywave.js';
import {
  checkProtection,
  rssAggregate,
  standardDuDb
} from './nightInterference.js';

const DEFAULT_AZIMUTHS = Array.from({ length: 36 }, (_, i) => i * 10);
const DEFAULT_BRACKET_MIN_KM = 5;
const DEFAULT_BRACKET_MAX_KM = 4000;
const DEFAULT_TOL_KM         = 0.5;
const DEFAULT_MAX_ITERATIONS = 24;

/**
 * Field-strength sample at a single receiver from a single station.
 * Calls FCCAM once for the omni field, then applies the station's
 * pattern factor at the bearing to the receiver.
 *
 * @param {object} fccamClient
 * @param {object} station           { lat, lon, freq_khz, erp_kw, pattern_table? }
 * @param {object} rx                { lat, lon }
 * @param {object} [opts]            { percent_time? }
 * @returns {Promise<{ ok:boolean, field_uv_m?:number, error?:string }>}
 */
export async function fieldFromStation(fccamClient, station, rx, opts = {}){
  const reqs = buildBatchInputs(station, [rx], { percent_time: opts.percent_time ?? 50 });
  const batch = await fccamClient.runBatch(reqs, opts);
  if (!batch?.available || !batch.results?.[0]?.ok){
    return {
      ok: false,
      error: batch?.results?.[0]?.flag
          || batch?.error
          || 'fccam returned ok=false'
    };
  }
  const omniField = Number(batch.results[0].field_uv_m);
  const applied   = applyPatternFactor(station, rx, omniField);
  return { ok: true, field_uv_m: applied.field_uv_m, pattern_factor: applied.pattern_factor };
}

/**
 * Evaluate one candidate receiver point: returns the proposed
 * station's desired field, the RSS of interferers, and a pass/fail
 * verdict against §73.182.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   desired_uv_m?: number,
 *   rss_uv_m?: number,
 *   required_uv_m?: number,
 *   margin_db?: number,
 *   pass?: boolean,
 *   per_interferer?: Array,
 *   error?: string
 * }>}
 */
export async function evaluateReceiver({
  fccamClient, proposed, interferers, rx, duDbByRelation
}){
  // Proposed station's desired field at rx.
  const desired = await fieldFromStation(fccamClient, proposed, rx);
  if (!desired.ok){
    return { ok: false, error: `proposed: ${desired.error}` };
  }

  // Interferer fields — one FCCAM call per interferer, ran in
  // parallel.  We do NOT batch across stations because each one has
  // a different ERP / location / midpoint_lat and the batch endpoint
  // groups by request-list order not by station identity.
  const interfererReqs = interferers.map((s) => fieldFromStation(fccamClient, s, rx));
  const interfererResults = await Promise.all(interfererReqs);
  const enriched = interferers.map((s, i) => {
    const r = interfererResults[i];
    return {
      ...s,
      field_uv_m:    r.ok ? r.field_uv_m : 0,
      pattern_factor: r.pattern_factor ?? null,
      ok:            r.ok,
      error:         r.ok ? null : r.error
    };
  });

  // RSS-aggregate by relation: §73.182 protects co-channel and 1st-/
  // 2nd-/3rd-adjacent with different D/U ratios, so we aggregate
  // each pool independently then check the strictest binding.
  const byRelation = groupBy(enriched, (x) => x.relation || 'co_channel');
  const checks = [];
  for (const [relation, group] of Object.entries(byRelation)){
    const agg = rssAggregate(group);
    const du  = duDbByRelation?.[relation];
    if (!Number.isFinite(du)) continue;        // not protected for this combo
    const verdict = checkProtection(desired.field_uv_m, agg.rss_uv_m, du);
    checks.push({
      relation,
      du_db:          du,
      rss_uv_m:       agg.rss_uv_m,
      required_uv_m:  verdict.required_uv_m,
      desired_uv_m:   desired.field_uv_m,
      margin_db:      verdict.margin_db,
      pass:           verdict.pass,
      contributing:   agg.contributing.map((x) => x.station_id || x.call || null),
      n_excluded:     agg.n_excluded
    });
  }
  const failing = checks.filter((c) => !c.pass);
  return {
    ok:             true,
    desired_uv_m:   desired.field_uv_m,
    pass:           failing.length === 0 && checks.length > 0,
    binding:        failing[0] || checks[0] || null,
    checks,
    per_interferer: enriched
  };
}

/**
 * Bisect along a single azimuth to find the NIF radius.
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   azimuth_deg: number,
 *   distance_km?: number,
 *   lat?: number, lon?: number,
 *   binding?: object,
 *   iterations?: number,
 *   error?: string
 * }>}
 */
export async function nifRadiusAtAzimuth({
  fccamClient, proposed, interferers, azimuth_deg, duDbByRelation,
  bracketMinKm = DEFAULT_BRACKET_MIN_KM,
  bracketMaxKm = DEFAULT_BRACKET_MAX_KM,
  tolKm        = DEFAULT_TOL_KM,
  maxIter      = DEFAULT_MAX_ITERATIONS
}){
  const evalAt = async (kmFromTx) => {
    const [lat, lon] = destinationPoint(proposed.lat, proposed.lon, azimuth_deg, kmFromTx);
    return await evaluateReceiver({
      fccamClient, proposed, interferers,
      rx: { lat, lon }, duDbByRelation
    });
  };

  // Bracket: inner edge should pass, outer edge should fail.  If the
  // outer edge passes (no interferers reach this far) declare the
  // contour as the bracketMaxKm; if the inner edge fails (interferers
  // dominate even at very small radii) declare it as bracketMinKm.
  const inner = await evalAt(bracketMinKm);
  if (!inner.ok) return { ok: false, azimuth_deg, error: `inner bracket: ${inner.error}` };
  const outer = await evalAt(bracketMaxKm);
  if (!outer.ok) return { ok: false, azimuth_deg, error: `outer bracket: ${outer.error}` };

  if (!inner.pass){
    // Even at the close-in point, RSS interference dominates → no NIF
    // service at this azimuth.  Distance reported as 0 with the
    // binding relation surfaced so the caller can render a flagged sector.
    return {
      ok:         true,
      azimuth_deg,
      distance_km: 0,
      lat:        proposed.lat,
      lon:        proposed.lon,
      binding:    inner.binding,
      iterations: 1,
      saturated: 'no_service'
    };
  }
  if (outer.pass){
    const [lat, lon] = destinationPoint(proposed.lat, proposed.lon, azimuth_deg, bracketMaxKm);
    return {
      ok:         true,
      azimuth_deg,
      distance_km: bracketMaxKm,
      lat, lon,
      binding:    outer.binding,
      iterations: 1,
      saturated: 'unbounded'
    };
  }

  // Standard bisection: pass inside, fail outside.
  let lo = bracketMinKm, hi = bracketMaxKm, iterations = 0;
  let lastBinding = inner.binding;
  while (hi - lo > tolKm && iterations < maxIter){
    iterations++;
    const mid = (lo + hi) / 2;
    const v   = await evalAt(mid);
    if (!v.ok) return { ok: false, azimuth_deg, error: `iteration ${iterations}: ${v.error}` };
    if (v.pass){
      lo = mid;
    } else {
      hi = mid;
      lastBinding = v.binding;
    }
  }
  const radius_km = lo;
  const [lat, lon] = destinationPoint(proposed.lat, proposed.lon, azimuth_deg, radius_km);
  return {
    ok:          true,
    azimuth_deg,
    distance_km: radius_km,
    lat, lon,
    binding:     lastBinding,
    iterations
  };
}

/**
 * Solve the NIF contour around a proposed station.
 *
 * Returns a closed polygon (first vertex repeated) suitable for GeoJSON
 * MultiPolygon output, plus per-azimuth diagnostics for the appendix.
 *
 * @param {object} input
 * @param {object} input.proposed       { lat, lon, freq_khz, erp_kw, pattern_table?, fcc_class }
 * @param {Array}  input.interferers    each: { lat, lon, freq_khz, erp_kw, pattern_table?, fcc_class, relation, station_id?, call? }
 * @param {Array}  [input.azimuths_deg] default [0,10,20,...,350]
 * @param {object} ctx
 * @param {object} ctx.fccamClient
 * @param {object} [ctx.duDbOverride]   override the §73.183 standard table per-relation, e.g. { co_channel: 26 }
 */
export async function solveNifContour(input, ctx){
  const { proposed, interferers = [], azimuths_deg = DEFAULT_AZIMUTHS } = input || {};
  const { fccamClient, duDbOverride = null } = ctx || {};
  if (!fccamClient){
    return { available: false, error: 'FCCAM sidecar not configured (FCCAM_SIDECAR_URL unset)' };
  }
  if (!proposed?.lat || !proposed?.lon || !proposed?.freq_khz || !proposed?.erp_kw){
    return { available: false, error: 'proposed station requires lat, lon, freq_khz, erp_kw' };
  }
  // Default D/U table from the standard §73.183 matrix using the
  // proposed station's class.  Per-relation override is allowed for
  // waiver studies that argue an explicit ratio.
  const duDbByRelation = duDbOverride || {
    co_channel:      standardDuDb(proposed.fcc_class, 'co_channel'),
    first_adjacent:  standardDuDb(proposed.fcc_class, 'first_adjacent'),
    second_adjacent: standardDuDb(proposed.fcc_class, 'second_adjacent'),
    third_adjacent:  standardDuDb(proposed.fcc_class, 'third_adjacent')
  };

  const perAzimuth = [];
  for (const az of azimuths_deg){
    // eslint-disable-next-line no-await-in-loop
    const r = await nifRadiusAtAzimuth({
      fccamClient, proposed, interferers,
      azimuth_deg: az, duDbByRelation
    });
    perAzimuth.push(r);
  }

  const failures = perAzimuth.filter((p) => !p.ok);
  const closed   = perAzimuth.filter((p) => p.ok);
  // Close the polygon by repeating the first vertex at the end.
  const polygonVertices = closed.length > 0
    ? [...closed, { ...closed[0] }]
    : [];

  return {
    available:        failures.length === 0,
    source:           'fccam',
    fetched_at:       new Date().toISOString(),
    proposed,
    n_interferers:    interferers.length,
    n_azimuths:       azimuths_deg.length,
    n_failures:       failures.length,
    du_db_by_relation: duDbByRelation,
    polygon:          polygonVertices,
    per_azimuth:      perAzimuth,
    failures
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function groupBy(items, keyFn){
  const out = {};
  for (const it of items){
    const k = keyFn(it);
    if (!out[k]) out[k] = [];
    out[k].push(it);
  }
  return out;
}

// Re-export the geometry helpers so consumers can construct contour
// preview rasters without re-importing skywave directly.
export {
  bearingDeg, destinationPoint, greatCircleKm,
  patternFactorAt
};

export const NIF_CONTOUR_PROVENANCE = Object.freeze({
  module:        'src/engine/am/nifContour.js',
  regulation:    '47 CFR §73.182 (engineering standards of allocation, AM nighttime)',
  modeled: [
    'Per-azimuth bisection of the NIF boundary against §73.182(k) RSS',
    'Per-relation (co/1st/2nd/3rd adjacent) D/U evaluation with §73.183 defaults',
    'Closed-polygon output suitable for GeoJSON / map overlay',
    'Saturation flags: no_service (interference dominates everywhere) + unbounded (no protected interferers within the bracket)'
  ],
  not_modeled: [
    'Mexican/Canadian treaty stations (XEW, CKAC etc) — pull these into interferers[] separately',
    'Pre-sunrise / post-sunset authority (separate analysis pass)',
    'AM expanded band §73.30 inter-station protection (different D/U table)'
  ]
});
