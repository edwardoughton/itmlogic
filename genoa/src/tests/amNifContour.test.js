import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateReceiver,
  nifRadiusAtAzimuth,
  solveNifContour,
  fieldFromStation,
  NIF_CONTOUR_PROVENANCE
} from '../engine/am/nifContour.js';

// FCCAM fake that returns field strength inversely proportional to
// distance.  Crude but deterministic — close enough to expose the
// solver's logic (monotonic decrease with distance, threshold
// crossing) without needing the real Wang model.
//
//   omni field at receiver = (1000 * sqrt(erp_kw)) / max(1, distance_km)
//
// All values uV/m at the receiver before pattern factor is applied.
function makeFakeFccam({ multiplier = 1 } = {}){
  return {
    runBatch: async (requests) => {
      const results = requests.map((req) => {
        const field_uv_m = multiplier * (1000 * Math.sqrt(req.erp_kw)) / Math.max(1, req.distance_km);
        return {
          ok:           true,
          engine:       'fccam',
          field_uv_m,
          flag:         null,
          input_sha256: 'a'.repeat(64),
          inputs:       req
        };
      });
      return {
        available: true, source: 'fccam',
        n_requests: requests.length,
        n_ok: results.length, n_failed: 0,
        results
      };
    }
  };
}

const proposed = {
  lat: 40.0, lon: -75.0, freq_khz: 700, erp_kw: 50, fcc_class: 'B'
};
// A far-off-axis co-channel interferer that lands at a known field
// at the proposed station's surroundings.
const interferers = [{
  station_id: 'WXYZ', call: 'WXYZ',
  lat: 40.0, lon: -85.0,           // due west of proposed
  freq_khz: 700, erp_kw: 50,
  relation: 'co_channel', fcc_class: 'B'
}];

/* ---------- fieldFromStation ---------- */

test('fieldFromStation: applies pattern factor of 1 for omni', async () => {
  const r = await fieldFromStation(makeFakeFccam(), proposed, { lat: 40.5, lon: -75 });
  assert.equal(r.ok, true);
  assert.ok(r.field_uv_m > 0);
});

test('fieldFromStation: DA station attenuates per pattern_table at bearing', async () => {
  const station = { ...proposed,
    pattern_table: { 0: 1.0, 90: 0.1, 180: 1.0, 270: 0.1 }
  };
  // Receiver due east (bearing 90°) → pattern factor 0.1.
  const rxE = await fieldFromStation(makeFakeFccam(), station, { lat: 40, lon: -74 });
  // Receiver due north (bearing 0°) → pattern factor 1.0.
  const rxN = await fieldFromStation(makeFakeFccam(), station, { lat: 40.5, lon: -75 });
  assert.ok(rxN.field_uv_m > rxE.field_uv_m * 5, `north should dominate east; got N=${rxN.field_uv_m} E=${rxE.field_uv_m}`);
});

/* ---------- evaluateReceiver ---------- */

test('evaluateReceiver: pass when proposed field dominates RSS', async () => {
  // Close to proposed → strong desired, weak interferer → pass.
  const v = await evaluateReceiver({
    fccamClient: makeFakeFccam(),
    proposed,
    interferers,
    rx:               { lat: 40.1, lon: -75 },
    duDbByRelation:   { co_channel: 20 }
  });
  assert.equal(v.ok, true);
  assert.equal(v.pass, true);
  assert.ok(v.checks.length > 0);
});

test('evaluateReceiver: fail when interferer field comparable / stronger', async () => {
  // Far from proposed → weak desired; interferer is closer to rx
  // (since rx is between them on the great circle).
  const v = await evaluateReceiver({
    fccamClient: makeFakeFccam(),
    proposed,
    interferers,
    rx:               { lat: 40, lon: -80 },   // halfway-ish toward interferer
    duDbByRelation:   { co_channel: 26 }
  });
  assert.equal(v.ok, true);
  assert.equal(v.pass, false, 'expected fail at distant rx; checks: ' + JSON.stringify(v.checks));
});

test('evaluateReceiver: ignores relations with no D/U entry', async () => {
  const v = await evaluateReceiver({
    fccamClient: makeFakeFccam(),
    proposed,
    interferers,
    rx:               { lat: 40.1, lon: -75 },
    duDbByRelation:   { /* empty */ }
  });
  assert.equal(v.ok, true);
  assert.equal(v.checks.length, 0);
  assert.equal(v.pass, false);  // no checks evaluated → "no protected coverage proven"
});

/* ---------- per-azimuth NIF solver ---------- */

test('nifRadiusAtAzimuth: away from interferer — bisection finds a positive radius', async () => {
  const r = await nifRadiusAtAzimuth({
    fccamClient: makeFakeFccam(),
    proposed,
    interferers,
    azimuth_deg: 0,                            // due north — away from west interferer
    duDbByRelation: { co_channel: 20 },
    bracketMinKm: 5,
    bracketMaxKm: 500,
    tolKm: 1,
    maxIter: 20
  });
  assert.equal(r.ok, true);
  assert.ok(r.distance_km > 5 && r.distance_km < 500, `got ${r.distance_km}`);
  assert.equal(r.azimuth_deg, 0);
});

test('nifRadiusAtAzimuth: directly toward interferer — saturated no_service or small radius', async () => {
  const r = await nifRadiusAtAzimuth({
    fccamClient: makeFakeFccam({ multiplier: 5 }),   // boost interferer strength
    proposed,
    interferers: [{ ...interferers[0], erp_kw: 500 }], // big interferer
    azimuth_deg: 270,                          // due west, toward interferer
    duDbByRelation: { co_channel: 26 },
    bracketMinKm: 5,
    bracketMaxKm: 500,
    tolKm: 1
  });
  assert.equal(r.ok, true);
  // Either saturated_no_service or a small positive radius is acceptable;
  // what we don't want is bracketMaxKm.
  assert.ok(r.distance_km < 500, `got ${r.distance_km}`);
});

/* ---------- full contour ---------- */

test('solveNifContour: returns available:false when sidecar missing', async () => {
  const r = await solveNifContour({ proposed, interferers }, { fccamClient: null });
  assert.equal(r.available, false);
  assert.match(r.error, /FCCAM/);
});

test('solveNifContour: rejects incomplete proposed station', async () => {
  const r = await solveNifContour(
    { proposed: { lat: 40 }, interferers },
    { fccamClient: makeFakeFccam() }
  );
  assert.equal(r.available, false);
  assert.match(r.error, /freq_khz|erp_kw|lat|lon/);
});

test('solveNifContour: emits closed polygon + per-azimuth diagnostics', async () => {
  const azimuths_deg = [0, 90, 180, 270];
  const r = await solveNifContour(
    { proposed, interferers, azimuths_deg },
    {
      fccamClient: makeFakeFccam(),
      duDbOverride: { co_channel: 20 }
    }
  );
  assert.equal(r.available, true, JSON.stringify(r.failures));
  assert.equal(r.n_azimuths, 4);
  // Closed polygon = N vertices + 1 (first repeated).
  assert.equal(r.polygon.length, 5);
  assert.deepEqual(r.polygon[0], r.polygon[r.polygon.length - 1]);
  // Each per_azimuth has bisection diagnostics.
  for (const p of r.per_azimuth){
    assert.equal(p.ok, true);
    assert.equal(typeof p.azimuth_deg, 'number');
    assert.equal(typeof p.distance_km, 'number');
    assert.equal(typeof p.lat, 'number');
    assert.equal(typeof p.lon, 'number');
  }
});

test('solveNifContour: NIF radius is smaller toward an interferer than away', async () => {
  const r = await solveNifContour(
    { proposed, interferers, azimuths_deg: [0, 90, 180, 270] },
    {
      fccamClient: makeFakeFccam(),
      duDbOverride: { co_channel: 26 }
    }
  );
  assert.equal(r.available, true);
  const byAz = Object.fromEntries(r.per_azimuth.map((p) => [p.azimuth_deg, p.distance_km]));
  // Interferer is due west of proposed (lon -85 vs proposed -75), so
  // toward it is azimuth 270°.  Radius at 270° should be < radius at 90°.
  assert.ok(byAz[270] < byAz[90],
    `expected NIF smaller toward interferer (270) than away (90); got ${byAz[270]} vs ${byAz[90]}`);
});

/* ---------- provenance ---------- */

test('NIF_CONTOUR_PROVENANCE names §73.182', () => {
  assert.match(NIF_CONTOUR_PROVENANCE.regulation, /73\.182/);
});
