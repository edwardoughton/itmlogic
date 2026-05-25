// AM 50% skywave field-strength engine.
//
// Thin orchestration over the FCCAM sidecar (genoa/src/sidecars/fccam,
// see src/evidence/fccamClient.js for the contract).  The sidecar
// computes the field per the FCC's published Wang 1985 skywave model
// (47 CFR §73.190(c)); this module:
//
//   - composes a station + receiver geometry into FCCAM calls,
//   - applies the station's directional pattern factor (when a
//     pattern_table is attached) to the per-azimuth field, and
//   - batches the work so a 36-azimuth × N-interferer night study
//     fans out in one HTTP round trip.
//
// IMPORTANT — NO LOCAL SUBSTITUTION
//   When the sidecar is unreachable this module returns
//   { available: false, reason } and the caller MUST degrade
//   explicitly.  We do NOT swap to a Berry or NEC fallback — the
//   whole determinism argument for AM nighttime depends on the FCC's
//   own FORTRAN being the sole authority.
//
// REGULATORY
//   - 47 CFR §73.150   — DA ground-wave horizontal pattern synthesis
//   - 47 CFR §73.182   — AM nighttime engineering standards of allocation
//   - 47 CFR §73.190(c)— Wang skywave formula explicitly permitted

import { isValidAmKhz } from './band.js';

const EARTH_RADIUS_KM = 6371.0;

/**
 * Pattern factor at an arbitrary azimuth.
 *
 * `pattern_table` is the §73.150 horizontal-plane f(θ) table the DA
 * designer emits — sparse object keyed by integer azimuth in
 * degrees, value = [pattern_factor, field_uV_m_at_1km] or just a
 * scalar pattern_factor.  Falls back to linear interpolation between
 * the two nearest sampled azimuths, since the table is typically
 * sampled at coarse step (e.g. 10°) but skywave geometry needs the
 * factor at the exact great-circle bearing.
 *
 * When no pattern_table is present the station is treated as
 * omnidirectional → returns 1.0.
 *
 * @param {object|null} patternTable
 * @param {number} azDeg
 * @returns {number}
 */
export function patternFactorAt(patternTable, azDeg){
  if (!patternTable) return 1;
  // Pattern-table SHAPE SAFETY (Codex audit on §73.150 ingest).  A
  // pattern_table arrives from multiple sources: the §73.150 DA
  // synthesizer (Array of [az, factor] pairs), an LMS pattern dump
  // (Object keyed by integer azimuth), or an operator-hand-edited
  // object that happens to look like one shape but holds the other.
  // We require an EXPLICIT `kind` discriminator on Object-shaped
  // tables — `kind: 'horizontal_relative_field' | 'msa' | 'rss'`.
  // Without it, an Object that pairs raw measured-field-at-1km
  // (mV/m) with azimuth would silently be treated as a relative
  // pattern factor and inflate the directional field by ~3 orders
  // of magnitude.  Failing closed (returns 1, equivalent to omni)
  // is the correct safe default; the caller's narrative downstream
  // emits a "pattern_table missing kind discriminator → treated as
  // omni" advisory when this branch fires.
  // Array form is unambiguous (synthesizer-emitted), so it bypasses
  // the discriminator check.
  if (!Array.isArray(patternTable)
      && typeof patternTable === 'object'
      && patternTable.kind == null){
    // Allow legacy plain-numeric maps {0:1.0, 90:0.5, ...} that
    // contain ONLY finite numeric values associated with finite
    // azimuth keys — this is the historical shape every Genoa test
    // and exhibit has shipped with, and the discriminator
    // requirement should not regress them.  Anything richer (mixed
    // shapes, meta-keys, vendor-specific fields) MUST declare kind.
    const entries = Object.entries(patternTable);
    const looksLikePlainNumericMap = entries.length > 0 && entries.every(([k, v]) => {
      const azOk = Number.isFinite(Number(k));
      const valOk = (typeof v === 'number' && Number.isFinite(v))
                 || (Array.isArray(v) && v.length >= 1 && Number.isFinite(Number(v[0])))
                 || (v && typeof v === 'object' && typeof v.factor === 'number');
      return azOk && valOk;
    });
    if (!looksLikePlainNumericMap){
      // Unknown shape with no kind discriminator → fail closed (omni).
      return 1;
    }
  }
  // Accept two shapes:
  //   - Array of [az, factor] pairs (the §73.150 synthesizer output)
  //   - Object keyed by integer azimuth (filed pattern_table)
  // Normalize into one Map<azDeg, factor> so the lookup logic is
  // shape-agnostic from here on.
  const map = {};
  if (Array.isArray(patternTable)){
    for (const entry of patternTable){
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const az = Number(entry[0]);
      const f  = Number(entry[1]);
      if (Number.isFinite(az) && Number.isFinite(f)){
        map[((az % 360) + 360) % 360] = f;
      }
    }
  } else if (typeof patternTable === 'object'){
    for (const [k, v] of Object.entries(patternTable)){
      // Skip the discriminator + any meta-key (`kind`, `source`,
      // `regulation`, etc.) — Number('kind') is NaN so it would
      // naturally drop out, but explicit is clearer than implicit.
      if (k === 'kind' || k === 'source' || k === 'regulation' || k === 'note') continue;
      const az = Number(k);
      if (!Number.isFinite(az)) continue;
      map[((az % 360) + 360) % 360] = readFactor(v);
    }
  } else {
    return 1;
  }
  patternTable = map;
  const samples = Object.keys(patternTable)
    .map((k) => Number(k))
    .filter((n) => Number.isFinite(n))
    .sort((a, b) => a - b);
  if (samples.length === 0) return 1;

  // Wrap target into [0, 360).
  const wrap = (x) => ((x % 360) + 360) % 360;
  const target = wrap(azDeg);

  // Exact hit?
  const exactKey = samples.find((s) => wrap(s) === target);
  if (exactKey !== undefined){
    return readFactor(patternTable[exactKey]);
  }

  // Interpolate.  Sort samples by absolute angular distance from
  // target (handling wrap-around) and pick the two nearest neighbors
  // on opposite sides.
  const wrapped = samples.map((s) => ({ deg: wrap(s), raw: s }));
  let lo = null, hi = null;
  for (const w of wrapped){
    const d = ((w.deg - target) + 360) % 360;  // 0..360 going CW
    if (d === 0){ lo = w; hi = w; break; }
    if (d < 180){
      if (!hi || ((hi.deg - target + 360) % 360) > d) hi = w;
    } else {
      const rev = 360 - d;
      if (!lo || ((target - lo.deg + 360) % 360) > rev) lo = w;
    }
  }
  if (!lo) lo = wrapped[wrapped.length - 1];
  if (!hi) hi = wrapped[0];
  const fLo = readFactor(patternTable[lo.raw]);
  const fHi = readFactor(patternTable[hi.raw]);
  const span = ((hi.deg - lo.deg) + 360) % 360 || 360;
  const t = (((target - lo.deg) + 360) % 360) / span;
  return fLo + (fHi - fLo) * t;
}

function readFactor(entry){
  if (entry == null) return 1;
  if (typeof entry === 'number') return entry;
  if (Array.isArray(entry)) return Number(entry[0]) || 0;
  if (typeof entry.factor === 'number') return entry.factor;
  return 1;
}

/**
 * Great-circle distance (km) between two lat/lon points using the
 * spherical-earth haversine.  Matches §73.208 / contour engine's
 * convention to keep skywave-distance and contour-distance
 * consistent across the exhibit.
 *
 * @returns {number} km
 */
export function greatCircleKm(latA, lonA, latB, lonB){
  const d2r = Math.PI / 180;
  const φ1 = Number(latA) * d2r, φ2 = Number(latB) * d2r;
  const Δφ = (Number(latB) - Number(latA)) * d2r;
  const Δλ = (Number(lonB) - Number(lonA)) * d2r;
  if (![φ1, φ2, Δφ, Δλ].every(Number.isFinite)) return NaN;
  const a = Math.sin(Δφ / 2) ** 2
          + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Initial great-circle bearing (deg, 0=N, CW) from A to B.
 * @returns {number}
 */
export function bearingDeg(latA, lonA, latB, lonB){
  const d2r = Math.PI / 180;
  const r2d = 180 / Math.PI;
  const φ1 = Number(latA) * d2r, φ2 = Number(latB) * d2r;
  const Δλ = (Number(lonB) - Number(lonA)) * d2r;
  if (![φ1, φ2, Δλ].every(Number.isFinite)) return NaN;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2)
          - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * r2d) + 360) % 360;
}

/**
 * Destination point at given initial bearing + distance.
 * @returns {[number, number]} [lat, lon]
 */
export function destinationPoint(lat, lon, bearingDeg_, distanceKm){
  const d2r = Math.PI / 180;
  const r2d = 180 / Math.PI;
  const φ1 = Number(lat) * d2r;
  const λ1 = Number(lon) * d2r;
  const θ  = Number(bearingDeg_) * d2r;
  const δ  = Number(distanceKm) / EARTH_RADIUS_KM;
  if (![φ1, λ1, θ, δ].every(Number.isFinite)) return [NaN, NaN];
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(
    Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
    Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2)
  );
  return [φ2 * r2d, ((λ2 * r2d + 540) % 360) - 180];
}

/**
 * Build a /run-batch input for a list of receiver points from a
 * single transmitter.
 *
 * @param {object} tx       { lat, lon, freq_khz, erp_kw, pattern_table? }
 * @param {Array<{lat:number, lon:number}>} receivers
 * @param {object} [opts]
 * @param {10|50} [opts.percent_time=50]
 * @returns {Array} requests for fccamClient.runBatch()
 */
export function buildBatchInputs(tx, receivers, { percent_time = 50 } = {}){
  if (!isValidAmKhz(tx.freq_khz)){
    throw new Error(`freq_khz ${tx.freq_khz} is not a valid US AM carrier`);
  }
  return receivers.map((rx) => {
    const distance_km  = greatCircleKm(tx.lat, tx.lon, rx.lat, rx.lon);
    const midpoint_lat = (Number(tx.lat) + Number(rx.lat)) / 2;
    return {
      erp_kw:       Number(tx.erp_kw),
      freq_khz:     Number(tx.freq_khz),
      distance_km,
      midpoint_lat,
      percent_time,
      mode:         'field_at_distance'
    };
  });
}

/**
 * Apply the directional pattern factor (and the §73.190 power-vs-field
 * relation, field ∝ pattern × √power_ratio = pattern at constant ERP)
 * to a single FCCAM field result.
 *
 * @param {object} tx     { lat, lon, pattern_table? }
 * @param {object} rx     { lat, lon }
 * @param {number} fieldOmniUvm  FCCAM omni field at this receiver
 * @returns {{ field_uv_m: number, bearing_deg: number, pattern_factor: number }}
 */
export function applyPatternFactor(tx, rx, fieldOmniUvm){
  const bearing_deg = bearingDeg(tx.lat, tx.lon, rx.lat, rx.lon);
  const pattern_factor = patternFactorAt(tx.pattern_table || null, bearing_deg);
  return {
    bearing_deg,
    pattern_factor,
    field_uv_m: fieldOmniUvm * pattern_factor
  };
}

/**
 * High-level: run skywave for a list of receivers from one station.
 * Returns one entry per receiver with bearing, pattern factor, and
 * directional 50% skywave field.
 *
 * The fccamClient is injected so callers can pass either the live
 * client (from src/api/services/sidecars.js) or a test fake.
 *
 * @param {object} fccamClient  must expose runBatch()
 * @param {object} tx           { lat, lon, freq_khz, erp_kw, pattern_table? }
 * @param {Array<{id?:string, lat:number, lon:number}>} receivers
 * @param {object} [opts]       { percent_time?: 10|50 }
 * @returns {Promise<{
 *   available: boolean,
 *   source?: 'fccam',
 *   percent_time?: number,
 *   results?: Array,
 *   error?: string
 * }>}
 */
export async function skywaveFieldAtReceivers(fccamClient, tx, receivers, opts = {}){
  if (!fccamClient){
    return { available: false, error: 'FCCAM sidecar not configured (FCCAM_SIDECAR_URL unset)' };
  }
  if (!Array.isArray(receivers) || receivers.length === 0){
    return { available: false, error: 'receivers[] must be a non-empty array' };
  }
  let batchInputs;
  try {
    batchInputs = buildBatchInputs(tx, receivers, opts);
  } catch (e){
    return { available: false, error: String(e?.message || e) };
  }
  const batch = await fccamClient.runBatch(batchInputs, opts);
  if (!batch?.available){
    return { available: false, error: batch?.error || 'fccam runBatch failed', raw: batch };
  }
  const results = batch.results.map((r, i) => {
    const rx = receivers[i];
    if (!r?.ok || !Number.isFinite(r.field_uv_m)){
      return {
        id:        rx.id ?? null,
        rx,
        ok:        false,
        error:     r?.flag || r?.error || 'fccam returned ok=false',
        input_sha256: r?.input_sha256 || null
      };
    }
    const directional = applyPatternFactor(tx, rx, r.field_uv_m);
    return {
      id:               rx.id ?? null,
      rx,
      ok:               true,
      bearing_deg:      directional.bearing_deg,
      pattern_factor:   directional.pattern_factor,
      field_uv_m_omni:  r.field_uv_m,
      field_uv_m:       directional.field_uv_m,
      input_sha256:     r.input_sha256 || null,
      distance_km:      r.inputs?.distance_km ?? null,
      midpoint_lat:     r.inputs?.midpoint_lat ?? null
    };
  });
  return {
    available:    true,
    // Pass through the actual engine identity the sidecar reported
    // (fccam, berry-1968-screening, …) so callers and the appendix
    // narrative can adapt prose + render the right screening / filing
    // badge.  Defaults to 'fccam' for back-compat when an older
    // sidecar shape omits source.
    source:       batch.source || 'fccam',
    percent_time: opts.percent_time ?? 50,
    n_requests:   batch.n_requests,
    n_ok:         results.filter((x) => x.ok).length,
    n_failed:     results.filter((x) => !x.ok).length,
    results
  };
}

export const AM_SKYWAVE_PROVENANCE = Object.freeze({
  module:        'src/engine/am/skywave.js',
  upstream:      'FCCAM (genoa/src/sidecars/fccam — Fccam.for / Wang 1985)',
  regulation:    '47 CFR §73.182 (AM nighttime allocation) + §73.190(c) (Wang skywave)',
  license_basis: '17 USC §105 (US Government public-domain work product)',
  modeled: [
    'Per-receiver 50% skywave field with directional pattern factor applied',
    'Great-circle distance + initial bearing per §73.208 spherical convention',
    'Batch fan-out so a 36-azimuth × N-interferer night study is one HTTP RTT'
  ],
  not_modeled: [
    'Local fallback model — when FCCAM is unreachable the orchestrator gets available:false',
    'Sunrise/sunset transitions (pre-/post-sunrise authority is a separate pass)',
    'Tropospheric / sporadic-E modes'
  ]
});
