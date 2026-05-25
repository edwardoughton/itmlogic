#!/usr/bin/env node
//
// splat-vs-JS bake-off harness for the JS port of NTIA ITM v1.2.2.
//
// Drives chelstein/splat's POST /api/v1/itm/p2p endpoint and the local
// JS pointToPoint() with the same set of fixtures, reports per-fixture
// residual (dbloss_C - dbloss_JS) and aggregate stats (mean, RMS, max
// abs).  This is the proof step for Phase 2 - if the residuals are
// within the dB tolerance the FCC engine cares about, the JS port is
// validated.
//
// USAGE
//   SPLAT_SIDECAR_URL=https://genoaiq.com/splat \
//   SPLAT_API_TOKEN=<bearer> \
//   node src/scripts/itmBakeOff.js
//
//   # Or filter to a single fixture by name:
//   node src/scripts/itmBakeOff.js wnvz_norfolk
//
// EXIT CODE
//   0   all residuals within ITM_BAKEOFF_TOLERANCE_DB (default 1.0)
//   1   one or more residuals exceed tolerance
//   2   sidecar unreachable / config error
//
// FIXTURE SCHEMA
//   { name, description?, profile, tx_height_m, rx_height_m,
//     frequency_mhz, conf, rel, radio_climate, pol }
// Profiles are flat SPLAT pfl arrays: [np, xi, e0, e1, ..., enp].

import { pointToPoint, profileFromElevations }
  from '../engine/coverage/itm_v122/index.js';

const SIDECAR_URL = process.env.SPLAT_SIDECAR_URL
                 || (process.env.SPLAT_DOMAIN ? `https://${process.env.SPLAT_DOMAIN}/splat` : null);
const API_TOKEN   = process.env.SPLAT_API_TOKEN || null;
const TOLERANCE   = Number(process.env.ITM_BAKEOFF_TOLERANCE_DB) || 1.0;

if (!SIDECAR_URL){
  console.error('SPLAT_SIDECAR_URL not set (or set SPLAT_DOMAIN to e.g. genoaiq.com)');
  process.exit(2);
}

// ---------- fixture suite ------------------------------------------

function flat(length_m, spacing_m){
  const n = Math.round(length_m / spacing_m) + 1;
  return profileFromElevations(new Array(n).fill(0.0), spacing_m);
}

function ridge(length_m, spacing_m, height_m, centre_m, width_m){
  const n = Math.round(length_m / spacing_m) + 1;
  const h = new Array(n).fill(0.0);
  const half = width_m / 2;
  for (let i = 0; i < n; i++){
    const x = i * spacing_m;
    const dx = Math.abs(x - centre_m);
    if (dx <= half) h[i] = height_m * (1 - dx / half);
  }
  return profileFromElevations(h, spacing_m);
}

function staircase(length_m, spacing_m, step_m){
  // Increasing sawtooth - tests d1thx / hzns on irregular but
  // monotonic terrain.
  const n = Math.round(length_m / spacing_m) + 1;
  const h = new Array(n);
  for (let i = 0; i < n; i++) h[i] = step_m * Math.floor(i / 50);
  return profileFromElevations(h, spacing_m);
}

const FIXTURES = [
  // Baseline flat-earth at FM frequencies.
  {
    name:          'flat_50km_100mhz_v',
    description:   'flat 50 km, 100 MHz, V-pol, FM-class antennas',
    profile:       flat(50_000, 100),
    tx_height_m:   30, rx_height_m: 10, frequency_mhz: 100,
    conf: 0.5, rel: 0.5, radio_climate: 5, pol: 1,
  },
  {
    name:          'flat_30km_100mhz_v',
    description:   'flat 30 km, near LOS edge',
    profile:       flat(30_000, 100),
    tx_height_m:   30, rx_height_m: 10, frequency_mhz: 100,
    conf: 0.5, rel: 0.5, radio_climate: 5, pol: 1,
  },
  {
    name:          'flat_100km_100mhz_v',
    description:   'flat 100 km - well past horizon, troposcatter regime',
    profile:       flat(100_000, 100),
    tx_height_m:   30, rx_height_m: 10, frequency_mhz: 100,
    conf: 0.5, rel: 0.5, radio_climate: 5, pol: 1,
  },
  // Ridge cases - tests adiff / aknfe.
  {
    name:          'ridge_200m_at_25km',
    description:   '50 km path, 200 m ridge at midpoint',
    profile:       ridge(50_000, 100, 200, 25_000, 10_000),
    tx_height_m:   30, rx_height_m: 10, frequency_mhz: 100,
    conf: 0.5, rel: 0.5, radio_climate: 5, pol: 1,
  },
  {
    name:          'ridge_500m_at_15km',
    description:   '40 km path, 500 m ridge nearer the tx',
    profile:       ridge(40_000, 100, 500, 15_000, 8_000),
    tx_height_m:   30, rx_height_m: 10, frequency_mhz: 100,
    conf: 0.5, rel: 0.5, radio_climate: 5, pol: 1,
  },
  // Frequency sweep at fixed geometry.
  {
    name:          'flat_50km_50mhz_v',
    description:   'flat 50 km, 50 MHz - low-VHF',
    profile:       flat(50_000, 100),
    tx_height_m:   30, rx_height_m: 10, frequency_mhz: 50,
    conf: 0.5, rel: 0.5, radio_climate: 5, pol: 1,
  },
  {
    name:          'flat_50km_400mhz_v',
    description:   'flat 50 km, 400 MHz - UHF lo',
    profile:       flat(50_000, 100),
    tx_height_m:   30, rx_height_m: 10, frequency_mhz: 400,
    conf: 0.5, rel: 0.5, radio_climate: 5, pol: 1,
  },
  // Staircase / irregular terrain.
  {
    name:          'staircase_50km',
    description:   'staircase up to ~5000 m elevation - delta-h stress',
    profile:       staircase(50_000, 100, 10),
    tx_height_m:   30, rx_height_m: 10, frequency_mhz: 100,
    conf: 0.5, rel: 0.5, radio_climate: 5, pol: 1,
  },
  // Confidence/reliability sweep.
  {
    name:          'flat_50km_conf95_rel95',
    description:   'same path, conf/rel = 0.95/0.95 - exercises avar tails',
    profile:       flat(50_000, 100),
    tx_height_m:   30, rx_height_m: 10, frequency_mhz: 100,
    conf: 0.95, rel: 0.95, radio_climate: 5, pol: 1,
  },
  {
    name:          'flat_50km_conf05_rel05',
    description:   'same path, conf/rel = 0.05/0.05 - the other tail',
    profile:       flat(50_000, 100),
    tx_height_m:   30, rx_height_m: 10, frequency_mhz: 100,
    conf: 0.05, rel: 0.05, radio_climate: 5, pol: 1,
  },
  // Climate sweep (hold geometry, vary klim).
  {
    name:          'flat_50km_klim1_equatorial',
    description:   'continental temperate -> equatorial climate',
    profile:       flat(50_000, 100),
    tx_height_m:   30, rx_height_m: 10, frequency_mhz: 100,
    conf: 0.5, rel: 0.5, radio_climate: 1, pol: 1,
  },
  {
    name:          'flat_50km_klim7_maritime_sea',
    description:   'maritime temperate over sea',
    profile:       flat(50_000, 100),
    tx_height_m:   30, rx_height_m: 10, frequency_mhz: 100,
    conf: 0.5, rel: 0.5, radio_climate: 7, pol: 1,
  },
];

// ---------- harness ------------------------------------------------

async function callSidecar(fixture){
  const body = {
    profile:        fixture.profile,
    tx_height_m:    fixture.tx_height_m,
    rx_height_m:    fixture.rx_height_m,
    frequency_mhz:  fixture.frequency_mhz,
    eps_dielect:    15.0,
    sgm_conduct:    0.005,
    eno_ns_surfref: 301.0,
    radio_climate:  fixture.radio_climate,
    pol:            fixture.pol,
    conf:           fixture.conf,
    rel:            fixture.rel,
  };
  const headers = { 'content-type': 'application/json' };
  if (API_TOKEN) headers['Authorization'] = `Bearer ${API_TOKEN}`;
  const url = SIDECAR_URL.replace(/\/$/, '') + '/api/v1/itm/p2p';
  const r = await fetch(url, {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok){
    const j = await r.json().catch(() => ({}));
    throw new Error(`sidecar ${r.status}: ${j.error || r.statusText}`);
  }
  return r.json();
}

function callJs(fixture){
  return pointToPoint({
    profile:       fixture.profile,
    tx_height_m:   fixture.tx_height_m,
    rx_height_m:   fixture.rx_height_m,
    frequency_mhz: fixture.frequency_mhz,
    conf:          fixture.conf,
    rel:           fixture.rel,
    klim:          fixture.radio_climate,
    mdvar:         12,
  });
}

async function runFixture(fixture){
  let cpp, js, err = null;
  try { cpp = await callSidecar(fixture); }
  catch (e){ err = `sidecar: ${e.message}`; }
  try { js  = callJs(fixture); }
  catch (e){ err = (err ? err + ' | ' : '') + `js: ${e.message}`; }
  if (err) return { fixture: fixture.name, error: err };

  const residual = cpp.dbloss - js.dbloss_db;
  return {
    fixture:       fixture.name,
    description:   fixture.description,
    cpp_dbloss:    Number(cpp.dbloss.toFixed(2)),
    cpp_strmode:   cpp.strmode,
    cpp_errnum:    cpp.errnum,
    js_dbloss:     Number(js.dbloss_db.toFixed(2)),
    js_mode:       js.mode,
    js_kwx:        js.kwx,
    residual_db:   Number(residual.toFixed(2)),
    abs_residual:  Math.abs(residual),
    within_tol:    Math.abs(residual) <= TOLERANCE,
    runtime_seconds: cpp.runtime_seconds,
  };
}

// ---------- main ---------------------------------------------------

const filterArg = process.argv[2] || null;
const selected  = filterArg
  ? FIXTURES.filter(f => f.name === filterArg || f.name.includes(filterArg))
  : FIXTURES;

if (selected.length === 0){
  console.error(`No fixture matched ${JSON.stringify(filterArg)}.`);
  console.error('Available:', FIXTURES.map(f => f.name).join(', '));
  process.exit(2);
}

console.log(`# splat-vs-JS bake-off`);
console.log(`# sidecar: ${SIDECAR_URL}`);
console.log(`# tolerance: ${TOLERANCE.toFixed(2)} dB`);
console.log(`# fixtures: ${selected.length}`);
console.log();

const results = [];
for (const fx of selected){
  const r = await runFixture(fx);
  results.push(r);
  if (r.error){
    console.log(`  [ERR ] ${r.fixture}: ${r.error}`);
  } else {
    const flag = r.within_tol ? 'PASS' : 'FAIL';
    console.log(`  [${flag}] ${r.fixture.padEnd(34)} `
              + `cpp=${r.cpp_dbloss.toString().padStart(7)}  `
              + `js=${r.js_dbloss.toString().padStart(7)}  `
              + `Δ=${r.residual_db.toString().padStart(7)} dB  `
              + `(${r.cpp_strmode || '-'})`);
  }
}

const valid    = results.filter(r => !r.error);
const passing  = valid.filter(r => r.within_tol);
const failing  = valid.filter(r => !r.within_tol);
const errored  = results.filter(r =>  r.error);

const absResids = valid.map(r => r.abs_residual);
const meanAbs   = absResids.length ? absResids.reduce((s, v) => s + v, 0) / absResids.length : 0;
const rms       = absResids.length ? Math.sqrt(absResids.reduce((s, v) => s + v*v, 0) / absResids.length) : 0;
const maxAbs    = absResids.length ? Math.max(...absResids) : 0;

console.log();
console.log(`## summary`);
console.log(`   tested:       ${results.length}`);
console.log(`   pass:         ${passing.length}`);
console.log(`   fail:         ${failing.length}`);
console.log(`   error:        ${errored.length}`);
console.log(`   mean |Δ|:     ${meanAbs.toFixed(3)} dB`);
console.log(`   RMS  Δ:       ${rms.toFixed(3)} dB`);
console.log(`   max  |Δ|:     ${maxAbs.toFixed(3)} dB`);
console.log(`   tolerance:    ${TOLERANCE.toFixed(2)} dB`);

if (failing.length || errored.length){
  console.log();
  console.log(`## failures (${failing.length}) + errors (${errored.length})`);
  for (const r of failing){
    console.log(`   ${r.fixture}: Δ=${r.residual_db} dB  `
              + `cpp=${r.cpp_dbloss}  js=${r.js_dbloss}  `
              + `mode_cpp="${r.cpp_strmode}" mode_js="${r.js_mode}"`);
  }
  for (const r of errored){
    console.log(`   ${r.fixture}: ${r.error}`);
  }
  process.exit(1);
}
process.exit(0);
