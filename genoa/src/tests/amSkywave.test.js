import test from 'node:test';
import assert from 'node:assert/strict';
import {
  patternFactorAt,
  greatCircleKm,
  bearingDeg,
  destinationPoint,
  buildBatchInputs,
  applyPatternFactor,
  skywaveFieldAtReceivers,
  AM_SKYWAVE_PROVENANCE
} from '../engine/am/skywave.js';

/* ---------- pattern factor ---------- */

test('patternFactorAt: omni when no table', () => {
  assert.equal(patternFactorAt(null,      0),   1);
  assert.equal(patternFactorAt(undefined, 90),  1);
  assert.equal(patternFactorAt({},        180), 1);
});

test('patternFactorAt: exact-hit on a sample azimuth', () => {
  const t = { 0: 1.0, 90: 0.5, 180: 0.1, 270: 0.5 };
  assert.equal(patternFactorAt(t, 0),   1.0);
  assert.equal(patternFactorAt(t, 90),  0.5);
  assert.equal(patternFactorAt(t, 180), 0.1);
});

test('patternFactorAt: linear interp between samples, wrap-around', () => {
  const t = { 0: 1.0, 180: 0.0 };
  const v90 = patternFactorAt(t, 90);
  assert.ok(Math.abs(v90 - 0.5) < 0.01, `expected ~0.5, got ${v90}`);
  // Going the other way around the circle (270°) the closer pair is
  // (180:0.0) → (0:1.0); midpoint should also be 0.5.
  const v270 = patternFactorAt(t, 270);
  assert.ok(Math.abs(v270 - 0.5) < 0.01, `expected ~0.5 at 270, got ${v270}`);
});

test('patternFactorAt: accepts array entries [factor, field_at_1km]', () => {
  const t = { 0: [1.0, 100], 180: [0.2, 20] };
  assert.equal(patternFactorAt(t, 0),   1.0);
  assert.equal(patternFactorAt(t, 180), 0.2);
});

test('patternFactorAt: accepts array-of-pairs shape from §73.150 synthesizer', () => {
  // This is the shape /api/am-da/design returns: [[az, f], ...]
  const t = [[0, 1.0], [90, 0.5], [180, 0.1], [270, 0.5]];
  assert.equal(patternFactorAt(t, 0),   1.0);
  assert.equal(patternFactorAt(t, 90),  0.5);
  assert.equal(patternFactorAt(t, 180), 0.1);
  // Interpolation should still work between pairs.
  const v45 = patternFactorAt(t, 45);
  assert.ok(v45 > 0.5 && v45 < 1.0, `expected 0.5<v<1.0, got ${v45}`);
});

test('patternFactorAt: array-of-pairs and object shapes produce identical results', () => {
  const arr = [[0, 1.0], [90, 0.5], [180, 0.1], [270, 0.5]];
  const obj = { 0: 1.0, 90: 0.5, 180: 0.1, 270: 0.5 };
  for (const az of [0, 30, 45, 90, 135, 180, 225, 270, 315, 359]){
    const a = patternFactorAt(arr, az);
    const o = patternFactorAt(obj, az);
    assert.ok(Math.abs(a - o) < 1e-9, `shape mismatch at az=${az}: arr=${a} obj=${o}`);
  }
});

/* ---------- great-circle geometry ---------- */

test('greatCircleKm: 1° latitude ≈ 111 km', () => {
  // 0,0 → 1,0 along the meridian.
  const d = greatCircleKm(0, 0, 1, 0);
  assert.ok(Math.abs(d - 111.2) < 0.3, `got ${d}`);
});

test('greatCircleKm: NYC ↔ LA ≈ 3940 km', () => {
  const d = greatCircleKm(40.71, -74.01, 34.05, -118.24);
  assert.ok(d > 3900 && d < 4000, `got ${d}`);
});

test('bearingDeg: due north / east', () => {
  assert.ok(Math.abs(bearingDeg(0, 0, 1, 0) - 0)  < 0.01, 'N');
  assert.ok(Math.abs(bearingDeg(0, 0, 0, 1) - 90) < 0.01, 'E');
});

test('destinationPoint: round-trips 100 km north', () => {
  const [lat, lon] = destinationPoint(40, -75, 0, 100);
  assert.ok(Math.abs((lat - 40) - 0.9) < 0.01, `lat got ${lat}`);
  assert.ok(Math.abs(lon - -75) < 0.01, `lon got ${lon}`);
});

/* ---------- batch input construction ---------- */

test('buildBatchInputs: rejects out-of-band freq before sending to FCCAM', () => {
  assert.throws(
    () => buildBatchInputs({ lat: 40, lon: -75, freq_khz: 89, erp_kw: 10 },
                           [{ lat: 41, lon: -75 }]),
    /not a valid US AM carrier/
  );
});

test('buildBatchInputs: emits one entry per receiver with correct geometry', () => {
  const reqs = buildBatchInputs(
    { lat: 40, lon: -75, freq_khz: 700, erp_kw: 50 },
    [
      { lat: 41, lon: -75 },
      { lat: 40, lon: -76 }
    ]
  );
  assert.equal(reqs.length, 2);
  assert.equal(reqs[0].erp_kw, 50);
  assert.equal(reqs[0].freq_khz, 700);
  assert.equal(reqs[0].percent_time, 50);
  assert.ok(reqs[0].distance_km > 100 && reqs[0].distance_km < 120);
  assert.ok(Math.abs(reqs[0].midpoint_lat - 40.5) < 0.01);
});

/* ---------- pattern + omni-field composition ---------- */

test('applyPatternFactor: omni station preserves field unchanged', () => {
  const r = applyPatternFactor(
    { lat: 40, lon: -75 },
    { lat: 41, lon: -75 },
    100
  );
  assert.equal(r.field_uv_m, 100);
  assert.equal(r.pattern_factor, 1);
  assert.ok(Math.abs(r.bearing_deg - 0) < 0.1, 'due north');
});

test('applyPatternFactor: DA station scales field by pattern factor at bearing', () => {
  const r = applyPatternFactor(
    { lat: 40, lon: -75, pattern_table: { 0: 1.0, 180: 0.1 } },
    { lat: 41, lon: -75 },  // due north
    100
  );
  assert.equal(r.field_uv_m, 100, 'pattern @ 0° is 1.0');
  const south = applyPatternFactor(
    { lat: 40, lon: -75, pattern_table: { 0: 1.0, 180: 0.1 } },
    { lat: 39, lon: -75 },  // due south
    100
  );
  assert.ok(Math.abs(south.field_uv_m - 10) < 0.1, `south expected ~10, got ${south.field_uv_m}`);
});

/* ---------- orchestrator with fake FCCAM client ---------- */

function makeFakeFccam(handler){
  return {
    runBatch: async (requests) => {
      const results = handler(requests);
      return {
        available: true,
        source:    'fccam',
        n_requests: requests.length,
        n_ok:       results.filter((r) => r.ok).length,
        n_failed:   results.filter((r) => !r.ok).length,
        results
      };
    }
  };
}

test('skywaveFieldAtReceivers: returns available:false when sidecar is null', async () => {
  const r = await skywaveFieldAtReceivers(null,
    { lat: 40, lon: -75, freq_khz: 700, erp_kw: 50 },
    [{ lat: 41, lon: -75 }]
  );
  assert.equal(r.available, false);
  assert.match(r.error, /FCCAM/);
});

test('skywaveFieldAtReceivers: empty receivers rejected', async () => {
  const r = await skywaveFieldAtReceivers(makeFakeFccam(() => []),
    { lat: 40, lon: -75, freq_khz: 700, erp_kw: 50 },
    []
  );
  assert.equal(r.available, false);
});

test('skywaveFieldAtReceivers: applies pattern factor + carries provenance per receiver', async () => {
  const fake = makeFakeFccam((reqs) => reqs.map((req) => ({
    ok: true,
    engine: 'fccam',
    field_uv_m: 100,         // omni reference
    input_sha256: 'a'.repeat(64),
    inputs: req
  })));
  const r = await skywaveFieldAtReceivers(fake,
    { lat: 40, lon: -75, freq_khz: 700, erp_kw: 50,
      pattern_table: { 0: 1.0, 180: 0.1 } },
    [
      { id: 'n', lat: 41, lon: -75 },  // north → factor 1.0 → 100
      { id: 's', lat: 39, lon: -75 }   // south → factor 0.1 → 10
    ]
  );
  assert.equal(r.available, true);
  assert.equal(r.n_ok, 2);
  assert.equal(r.results[0].field_uv_m, 100);
  assert.ok(Math.abs(r.results[1].field_uv_m - 10) < 0.5);
  assert.equal(r.results[0].input_sha256, 'a'.repeat(64));
});

test('skywaveFieldAtReceivers: per-receiver error surfaced when FCCAM returns ok=false', async () => {
  const fake = makeFakeFccam((reqs) => reqs.map((req, i) => ({
    ok: i !== 1,
    field_uv_m: i !== 1 ? 100 : null,
    flag: i === 1 ? 'OFF_GRID_LATITUDE' : null,
    inputs: req
  })));
  const r = await skywaveFieldAtReceivers(fake,
    { lat: 40, lon: -75, freq_khz: 700, erp_kw: 50 },
    [
      { lat: 41, lon: -75 },
      { lat: 91, lon: -75 },  // bogus
      { lat: 39, lon: -75 }
    ]
  );
  assert.equal(r.n_ok, 2);
  assert.equal(r.n_failed, 1);
  assert.equal(r.results[1].ok, false);
  assert.equal(r.results[1].error, 'OFF_GRID_LATITUDE');
});

/* ---------- provenance ---------- */

test('AM_SKYWAVE_PROVENANCE names §73.182 + §73.190(c)', () => {
  assert.match(AM_SKYWAVE_PROVENANCE.regulation, /73\.182/);
  assert.match(AM_SKYWAVE_PROVENANCE.regulation, /73\.190\(c\)/);
  assert.match(AM_SKYWAVE_PROVENANCE.license_basis, /17 USC §105/);
});
