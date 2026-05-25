// Genoa adapter for the vendored FCC contours-api-node tvfm_curves.js.
//
// PURPOSE
//   Expose the FCC's canonical FM/TV propagation-curve computation
//   (F(50,50) / F(50,10) / F(50,90)) under a clean Genoa-shaped surface
//   without leaking the FCC code's CommonJS / 8-positional-argument
//   calling convention into the rest of the engine.
//
// PROVENANCE
//   See ./PROVENANCE.md.  Source: github.com/fcc/contours-api-node
//   commit b55870d3f20618e886cd02379008ef980229d44b, file
//   controllers/tvfm_curves.js, sha256 58a0cd0eed98353509f39ea56e6f3a1e9ec94e6882a412be4c97bdf79cb6c28a.

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { clampHaatToFcc, applyFccDistanceFloor } from './orchestration.mjs';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The FCC code emits a debug console.log on every entry into
// tvfmfs_metric().  Silence it ONLY around our calls so server logs
// stay readable; we restore the original after each call.
const _origLog = console.log;
const _silent  = () => {};

const fcc = require('./tvfm_curves.js');

// --- AM groundwave (gwave.js) ----------------------------------------
// Upstream gwave.js does `require('../data/gwave_field.json')`.  Genoa
// keeps the data file inside the vendor boundary at
// src/engine/curves/fcc/data/gwave_field.json, so the only modification
// to the vendored gwave.js is changing that relative path to
// `./data/gwave_field.json`.  Documented in PROVENANCE.md and noted
// inline at the changed line.
const fccAm = require('./gwave.js');

// fcc.tvfmfs_metric signature:
//   tvfmfs_metric(erp, haat, channel, field, distance, fs_or_dist, curve, flag)
//
//   fs_or_dist:
//     1 → compute field   (returns dBu given distance)
//     2 → compute distance (returns km  given dBu)        ← Genoa uses this
//     3 → compute ERP     (returns kW  given distance + dBu)
//   curve:
//     0 → F(50,50)
//     1 → F(50,10)
//     2 → F(50,90)
//   channel:
//     2..6   → Low VHF
//     7..13  → High VHF
//     14..83 → UHF
//     200..300 → FM (88..108 MHz)  ← FM uses Low-VHF tables
//   flag: out parameter (array of 19 ints).  flag[1..19] != 0 → input or
//         range error; we surface a structured error in that case.

const CURVE_F5050 = 0;
const CURVE_F5010 = 1;
const CURVE_F5090 = 2;

const FS_OR_DIST_FIELD    = 1;
const FS_OR_DIST_DISTANCE = 2;
const FS_OR_DIST_ERP      = 3;

// Map an FM frequency in MHz to an FCC FM channel number (200..300)
// per 47 CFR §73.201.  88.1 MHz = channel 201, 100.1 = 261, etc.
//   channel = round((frequency_mhz - 87.9) / 0.2) + 200
// Returns 200 (88.1) for FM frequencies even slightly outside band; the
// FCC code itself accepts 200..300 and gates ERP/HAAT separately.
export function fmFrequencyToChannel(frequency_mhz){
  const f = Number(frequency_mhz);
  if (!Number.isFinite(f)) return 261;            // ~100.1 MHz default
  const ch = Math.round((f - 87.9) / 0.2) + 200;
  return Math.max(200, Math.min(300, ch));
}

// Compute distance (km) at which the engine reaches `target_dBu` for a
// given `erp_kw` and `haat_m`.  Returns:
//   { distance_km, source: 'fcc-tvfm_curves', flags: [...] }
// Throws an Error when the FCC routine flags an input/range failure
// that makes the result unreliable.
export function fccDistanceKm({
  haat_m,
  target_dBu,
  erp_kw,
  mode = '50,50',
  channel = null,
  frequency_mhz = null
}){
  const ch = channel ?? (frequency_mhz != null ? fmFrequencyToChannel(frequency_mhz) : 261);
  const curve = mode === '50,10' ? CURVE_F5010
              : mode === '50,90' ? CURVE_F5090
              :                    CURVE_F5050;
  const flag = new Array(19).fill(0);

  // FCC contours.js orchestration parity: HAAT is clamped to
  // [30, 1600] m before lookup, and the clamped value is recorded
  // alongside the raw input.  See ./orchestration.js.
  const { haat_used_m, clamped: haat_clamp } = clampHaatToFcc(haat_m);

  // The FCC fn returns the computed distance in km (positive) when
  // fs_or_dist === 2 succeeds.  When inputs are out of range it sets
  // entries in `flag` (1..18) and may early-return 0 / NaN.
  console.log = _silent;
  let result;
  try {
    result = fcc.tvfmfs_metric(
      Number(erp_kw),       // erp (kW)
      haat_used_m,          // haat (m), FCC-clamped
      Number(ch),           // channel
      Number(target_dBu),   // field (dBu) — input for fs_or_dist=2
      0,                    // distance — placeholder; FCC fills via curve walk
      FS_OR_DIST_DISTANCE,  // fs_or_dist = 2 → return distance
      curve,                // 0/1/2
      flag                  // out: 19-element array
    );
  } finally {
    console.log = _origLog;
  }

  // flag[3]  → channel out of range
  // flag[5]  → fs_or_dist invalid
  // flag[6]  → erp < 0.0001 (clamped)
  // flag[9]  → negative input (auto-abs)
  // flag[15] → distance > 300 km on F(50,50) / F(50,90)
  // flag[16] → distance > 500 km on F(50,10)
  // Most are warnings, not failures.  The hard-fail markers are
  // flag[3] (channel) and flag[5] (mode).
  if (flag[3]){
    throw Object.assign(new Error('FCC: channel out of range'), { code: 'FCC_CHANNEL_OUT_OF_RANGE', flag });
  }
  if (flag[5]){
    throw Object.assign(new Error('FCC: fs_or_dist invalid'), { code: 'FCC_FSDIST_INVALID', flag });
  }
  if (!Number.isFinite(result)){
    throw Object.assign(new Error('FCC: tvfmfs_metric returned non-finite distance'),
      { code: 'FCC_NO_RESULT', flag, result });
  }

  // FCC contours.js orchestration: negative distances become 1 km.
  const distance_km = applyFccDistanceFloor(Number(result));
  const distance_floored = distance_km !== Number(result);

  return {
    distance_km,
    distance_floored,
    haat_input_m:    Number(haat_m),
    haat_used_m,
    haat_clamp,
    source:      'fcc-tvfm_curves',
    method:      curve === CURVE_F5050 ? '47 CFR §73.333 F(50,50)' :
                 curve === CURVE_F5010 ? '47 CFR §73.333 F(50,10)' :
                                          '47 CFR §73.333 F(50,90)',
    channel:     ch,
    flags:       flag.slice(0, 19),
    upstream: {
      repo:   'github.com/fcc/contours-api-node',
      commit: 'b55870d3f20618e886cd02379008ef980229d44b',
      file:   'controllers/tvfm_curves.js',
      sha256: '58a0cd0eed98353509f39ea56e6f3a1e9ec94e6882a412be4c97bdf79cb6c28a'
    }
  };
}

// Compute predicted field strength (dBu) at a given distance for a given
// ERP / HAAT / channel / curve.  This is the inverse of fccDistanceKm —
// used by the §74.1204 D/U interference analysis where the engine asks
// "what F(50,10) field does this translator produce at distance d?".
//
// Same vendored FCC routine, fs_or_dist = 1 (return field).
export function fccFieldDbuAtDistance({
  haat_m,
  distance_km,
  erp_kw,
  mode = '50,10',
  channel = null,
  frequency_mhz = null
}){
  const ch = channel ?? (frequency_mhz != null ? fmFrequencyToChannel(frequency_mhz) : 261);
  const curve = mode === '50,10' ? CURVE_F5010
              : mode === '50,90' ? CURVE_F5090
              :                    CURVE_F5050;
  const flag = new Array(19).fill(0);

  // FCC orchestration parity — clamp HAAT to [30, 1600] m.
  const { haat_used_m } = clampHaatToFcc(haat_m);

  console.log = _silent;
  let result;
  try {
    result = fcc.tvfmfs_metric(
      Number(erp_kw),       // erp (kW)
      haat_used_m,          // haat (m), FCC-clamped
      Number(ch),           // channel
      0,                    // field — placeholder; FCC fills via curve walk
      Number(distance_km),  // distance (km) — input for fs_or_dist=1
      FS_OR_DIST_FIELD,     // fs_or_dist = 1 → return field
      curve,
      flag
    );
  } finally {
    console.log = _origLog;
  }

  if (flag[3]){
    throw Object.assign(new Error('FCC: channel out of range'),
      { code: 'FCC_CHANNEL_OUT_OF_RANGE', flag });
  }
  if (flag[5]){
    throw Object.assign(new Error('FCC: fs_or_dist invalid'),
      { code: 'FCC_FSDIST_INVALID', flag });
  }
  if (!Number.isFinite(result)){
    throw Object.assign(new Error('FCC: tvfmfs_metric returned non-finite field'),
      { code: 'FCC_NO_RESULT', flag, result });
  }

  return {
    field_dBu:   Number(result),
    source:      'fcc-tvfm_curves',
    method:      curve === CURVE_F5050 ? '47 CFR §73.333 F(50,50)' :
                 curve === CURVE_F5010 ? '47 CFR §73.333 F(50,10)' :
                                          '47 CFR §73.333 F(50,90)',
    channel:     ch,
    flags:       flag.slice(0, 19)
  };
}

export const FCC_PROVENANCE = Object.freeze({
  repo:    'github.com/fcc/contours-api-node',
  commit:  'b55870d3f20618e886cd02379008ef980229d44b',
  file:    'controllers/tvfm_curves.js',
  sha256:  '58a0cd0eed98353509f39ea56e6f3a1e9ec94e6882a412be4c97bdf79cb6c28a',
  vendor_path: 'src/engine/curves/fcc/tvfm_curves.js',
  vendored_at: '2026-05-04',
  license_basis: '17 U.S.C. § 105 — US Government work product, public domain in the United States'
});

/* =============================================================
   AM GROUNDWAVE (gwave.js — 47 CFR §73.184 Sommerfeld-Norton)
   ============================================================= */

// Compute AM groundwave distance to a target field strength via the
// vendored FCC gwave.js.  This is the same code that backs
// geo.fcc.gov/api/contours/amDistance.json.
//
// The FCC routine takes:
//   conductivity (sigma)  — mS/m, integer in {1,2,3,4,5,6,7,8} per FCC M3
//   dielectric            — relative permittivity ε_r (FCC default 15)
//   frequency_khz         — AM carrier frequency in kHz (530..1700)
//   target_mvm            — target field strength in mV/m
//   fs1km_mvm             — reference field at 1 km = 100·sqrt(P_kW)
//
// Returns distance in km on success.  Out-of-grid sigma values are
// clamped to the M3 boundary (1..8) and the clamped value is reported
// in `inputs.conductivity_clamp` for traceability — wet/marine soils
// commonly run 10..30 mS/m and we don't want the engine to hard-fail
// on those.  Other invalid inputs (frequency, ERP, target field) still
// throw FCC_AM_* codes because they have no sensible default.

const AM_DEFAULT_DIELECTRIC = 15;          // §73.184 standard ε_r
const AM_FREQ_MIN_KHZ = 530;
const AM_FREQ_MAX_KHZ = 1700;
const FCC_M3_SIGMA_MIN = 1;
const FCC_M3_SIGMA_MAX = 8;

export function fccAmDistanceKm({
  frequency_khz,
  target_mvm,
  conductivity_msm,           // ground conductivity σ in mS/m
  dielectric = AM_DEFAULT_DIELECTRIC,
  erp_kw
}){
  const freq = Number(frequency_khz);
  const f    = Number(target_mvm);
  const sigmaRaw = Number(conductivity_msm);
  const epsilon = Number(dielectric);
  const erp = Number(erp_kw);

  if (!Number.isFinite(freq) || freq < AM_FREQ_MIN_KHZ || freq > AM_FREQ_MAX_KHZ){
    throw Object.assign(new Error(`FCC AM: frequency ${freq} kHz out of range ${AM_FREQ_MIN_KHZ}..${AM_FREQ_MAX_KHZ}`),
      { code: 'FCC_AM_FREQ_OUT_OF_RANGE' });
  }
  // FCC pre-tabulated data is keyed at 10-kHz steps.  Round to the
  // nearest channel grid point.
  const freqGrid = Math.round(freq / 10) * 10;
  if (!Number.isFinite(f) || f <= 0){
    throw Object.assign(new Error('FCC AM: target_mvm must be positive'),
      { code: 'FCC_AM_FIELD_INVALID' });
  }
  if (!Number.isFinite(erp) || erp <= 0){
    throw Object.assign(new Error('FCC AM: erp_kw must be positive'),
      { code: 'FCC_AM_ERP_INVALID' });
  }
  if (!Number.isFinite(sigmaRaw)){
    throw Object.assign(new Error('FCC AM: conductivity_msm must be a finite number'),
      { code: 'FCC_AM_SIGMA_INVALID' });
  }

  // FCC M3 sigma is keyed by integer (1..8).  Clamp out-of-grid values
  // to the boundary instead of throwing — wet/marine soils run higher
  // than 8 mS/m and the §73.184 boundary curve is the closest defined
  // approximation.  The clamp direction is reported so the validator
  // can surface a recommendation.
  let sigma_clamp = null;
  let sigmaInt    = Math.round(sigmaRaw);
  if (sigmaInt < FCC_M3_SIGMA_MIN){ sigmaInt = FCC_M3_SIGMA_MIN; sigma_clamp = 'low';  }
  else if (sigmaInt > FCC_M3_SIGMA_MAX){ sigmaInt = FCC_M3_SIGMA_MAX; sigma_clamp = 'high'; }

  const fs1km    = 100 * Math.sqrt(erp);   // 100·sqrt(P_kW) mV/m at 1 km

  let distance;
  console.log = _silent;
  try {
    distance = fccAm.amDistance(sigmaInt, epsilon, freqGrid, f, fs1km);
  } finally {
    console.log = _origLog;
  }

  if (!Number.isFinite(distance) || distance <= 0){
    throw Object.assign(new Error('FCC AM: amDistance returned non-positive distance'),
      { code: 'FCC_AM_NO_RESULT', distance });
  }

  return {
    distance_km: Number(distance),
    source:      'fcc-gwave',
    method:      '47 CFR §73.184 groundwave (Sommerfeld-Norton)',
    inputs: {
      frequency_khz_grid:   freqGrid,
      conductivity_msm:     sigmaInt,
      conductivity_msm_raw: sigmaRaw,
      conductivity_clamp:   sigma_clamp,
      dielectric:           epsilon,
      target_mvm:           f,
      fs1km_mvm:            fs1km
    },
    upstream: {
      repo:   'github.com/fcc/contours-api-node',
      commit: 'b55870d3f20618e886cd02379008ef980229d44b',
      file:   'controllers/gwave.js',
      sha256: '0ba81eca1bda166e36d34906dfdbc72c730a976d91a3356c12b1ccde2a8b059f'
    }
  };
}

// Compute AM groundwave field strength at a given distance.  Returns
// mV/m.  Useful for inverse checks and per-radial radial-table fill.
export function fccAmFieldMvmAtDistance({
  frequency_khz,
  distance_km,
  conductivity_msm,
  dielectric = AM_DEFAULT_DIELECTRIC,
  erp_kw
}){
  const freq = Number(frequency_khz);
  const dist = Number(distance_km);
  const sigma = Number(conductivity_msm);
  const epsilon = Number(dielectric);
  const erp = Number(erp_kw);
  if (!Number.isFinite(freq) || freq < AM_FREQ_MIN_KHZ || freq > AM_FREQ_MAX_KHZ){
    throw Object.assign(new Error(`FCC AM: frequency ${freq} kHz out of range`),
      { code: 'FCC_AM_FREQ_OUT_OF_RANGE' });
  }
  const freqGrid = Math.round(freq / 10) * 10;
  // Same M3 clamp behavior as fccAmDistanceKm — never hard-fail on
  // out-of-grid sigma; clamp to the boundary instead.
  let sigmaInt = Number.isFinite(sigma) ? Math.round(sigma) : FCC_M3_SIGMA_MAX;
  if (sigmaInt < FCC_M3_SIGMA_MIN) sigmaInt = FCC_M3_SIGMA_MIN;
  else if (sigmaInt > FCC_M3_SIGMA_MAX) sigmaInt = FCC_M3_SIGMA_MAX;
  const fs1km    = 100 * Math.sqrt(Math.max(0, erp));

  let mvm;
  console.log = _silent;
  try {
    mvm = fccAm.amField(sigmaInt, epsilon, freqGrid, dist, fs1km);
  } finally {
    console.log = _origLog;
  }
  return Number(mvm);
}

export const FCC_AM_PROVENANCE = Object.freeze({
  repo:    'github.com/fcc/contours-api-node',
  commit:  'b55870d3f20618e886cd02379008ef980229d44b',
  files: [
    { path: 'controllers/gwave.js',        sha256: '0ba81eca1bda166e36d34906dfdbc72c730a976d91a3356c12b1ccde2a8b059f' },
    { path: 'data/gwave_field.json',       sha256: '81e90fd493d2ef1be46ab71096d647fca45d51b2b0ca1a8306f20e390780412e' }
  ],
  vendor_paths: [
    'src/engine/curves/fcc/gwave.js',
    'src/engine/curves/fcc/data/gwave_field.json'
  ],
  vendored_at: '2026-05-04',
  license_basis: '17 U.S.C. § 105 — US Government work product, public domain in the United States'
});
