// AM-night class matrix — exercises the Class A SS-1 floor, the
// field-based interferer cap ordering, the patternFactorAt `kind`
// discriminator safety, and the per-azimuth binding_interferer
// attribution column.
//
// This suite is the regression net for Agent 3's Genoa-AM-night
// fixes (Class A floor, field-sorted interferers, pattern unit
// safety, binding-interferer attribution).  Tests use the same
// crude inverse-distance FCCAM fake the rest of the AM-night
// engine tests use — deterministic, sidecar-free, fast.
//
// REGULATORY
//   - 47 CFR §73.182(a)/(d)  — Class A 0.5 mV/m vs Class B 2.5 mV/m
//   - 47 CFR §73.182(k)      — RSS aggregation, 25% exclusion
//   - 47 CFR §73.150         — DA horizontal pattern table conventions
//   - 47 CFR §73.190(c)      — skywave engine permission
//
// WFAN ACCEPTANCE
//   WFAN is licensed Class A on 660 kHz at 50 kW.  Surrounded by a
//   dense pool of strong co-channel AMs the §73.182 NIF study must
//   FAIL — even with the Class A 0.5 mV/m SS-1 floor in place — so
//   the reviewer sees that pattern redesign / class change is the
//   only path.  This test confirms the FAIL is preserved (the floor
//   does not whitewash a genuinely-failing Class A study).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateReceiver
} from '../engine/am/nifContour.js';
import {
  patternFactorAt
} from '../engine/am/skywave.js';
import {
  nighttimeNifStudy
} from '../engine/am/nightOrchestrator.js';

// Inverse-distance FCCAM fake.  field ∝ sqrt(erp_kw) / distance_km.
function makeFakeFccam({ multiplier = 1 } = {}){
  return {
    runBatch: async (requests) => ({
      available: true, source: 'fccam',
      n_requests: requests.length,
      n_ok:       requests.length,
      n_failed:   0,
      results:    requests.map((req) => ({
        ok: true, engine: 'fccam',
        field_uv_m: multiplier * (1000 * Math.sqrt(req.erp_kw)) / Math.max(1, req.distance_km),
        input_sha256: 'a'.repeat(64),
        inputs: req
      }))
    })
  };
}

function makeFakeFacility(primaries){
  return {
    getNearbyPrimaries: async () => ({
      available: true,
      source:    'fcc-amq',
      primaries: primaries || []
    })
  };
}

/* ============================================================
   Class A SS-1 0.5 mV/m floor (nifContour.evaluateReceiver)
   ============================================================ */

test('Class A: SS-1 0.5 mV/m floor lifts the desired field used for protection', async () => {
  // Far-from-tx receiver: raw desired field is tiny.  With Class A,
  // evaluateReceiver clamps the protection-check desired up to 500 µV/m.
  const proposedA = {
    lat: 40.0, lon: -75.0, freq_khz: 660, erp_kw: 50, fcc_class: 'A'
  };
  // One distant, modest co-channel interferer.
  const interferers = [{
    station_id: 'WFAR', call: 'WFAR',
    lat: 41.0, lon: -76.0,
    freq_khz: 660, erp_kw: 5,
    relation: 'co_channel', fcc_class: 'B'
  }];
  // Receiver ~600 km north of proposed — raw desired field at that
  // range with the inverse-distance fake is ~12 µV/m, well below the
  // 500 µV/m floor.
  const v = await evaluateReceiver({
    fccamClient: makeFakeFccam(),
    proposed: proposedA, interferers,
    rx: { lat: 45.4, lon: -75 },
    duDbByRelation: { co_channel: 26 }
  });
  assert.equal(v.ok, true);
  // Class A floor applied flag on every check.
  for (const c of v.checks){
    assert.equal(c.class_a_floor_applied, true,
      `class_a_floor_applied missing on ${c.relation}`);
    // desired_uv_m is the floored value used in checkProtection.
    assert.ok(c.desired_uv_m >= 500 - 1e-9,
      `floored desired should be ≥ 500, got ${c.desired_uv_m}`);
    // raw desired is preserved separately so the appendix can show both.
    assert.ok(Number.isFinite(c.desired_uv_m_raw));
    assert.ok(c.desired_uv_m_raw < c.desired_uv_m,
      'raw desired should be smaller than floored desired in this scenario');
  }
});

test('Class B: SS-1 floor is NOT applied (Class B is protected to 2.5 mV/m via §73.182(d) separately)', async () => {
  const proposedB = {
    lat: 40.0, lon: -75.0, freq_khz: 660, erp_kw: 50, fcc_class: 'B'
  };
  const interferers = [{
    station_id: 'WFAR', call: 'WFAR',
    lat: 41.0, lon: -76.0,
    freq_khz: 660, erp_kw: 5,
    relation: 'co_channel', fcc_class: 'B'
  }];
  const v = await evaluateReceiver({
    fccamClient: makeFakeFccam(),
    proposed: proposedB, interferers,
    rx: { lat: 45.4, lon: -75 },
    duDbByRelation: { co_channel: 20 }
  });
  assert.equal(v.ok, true);
  for (const c of v.checks){
    assert.equal(c.class_a_floor_applied, false,
      `Class B should NOT carry class_a_floor_applied=true`);
  }
});

test('Class A floor: floor never DOWNgrades a desired field above 500 µV/m', async () => {
  // Close-in receiver — raw desired field is >> 500 µV/m.  The floor
  // should be a no-op (Math.max).
  const proposedA = {
    lat: 40.0, lon: -75.0, freq_khz: 660, erp_kw: 50, fcc_class: 'A'
  };
  const interferers = [{
    station_id: 'WFAR', call: 'WFAR',
    lat: 41.0, lon: -76.0,
    freq_khz: 660, erp_kw: 5,
    relation: 'co_channel', fcc_class: 'B'
  }];
  const v = await evaluateReceiver({
    fccamClient: makeFakeFccam(),
    proposed: proposedA, interferers,
    rx: { lat: 40.05, lon: -75 },  // ~5 km north of tx
    duDbByRelation: { co_channel: 26 }
  });
  assert.equal(v.ok, true);
  for (const c of v.checks){
    // Floor is a no-op here; flag should be false because raw ≥ floor.
    assert.equal(c.class_a_floor_applied, false,
      `floor should be no-op when raw desired exceeds 500 µV/m`);
    assert.equal(c.desired_uv_m, c.desired_uv_m_raw);
  }
});

/* ============================================================
   binding_interferer per-azimuth column
   ============================================================ */

test('binding_interferer: per-azimuth check carries the dominant station', async () => {
  const proposed = {
    lat: 40.0, lon: -75.0, freq_khz: 660, erp_kw: 50, fcc_class: 'A'
  };
  // Two co-channel interferers — WBIG (close, loud) and WLITTLE (far, weak).
  // The receiver between proposed and WBIG should attribute the
  // binding interferer to WBIG.
  const interferers = [
    { station_id: '111', call: 'WBIG',    lat: 41.0, lon: -75.0,
      freq_khz: 660, erp_kw: 50, relation: 'co_channel', fcc_class: 'B' },
    { station_id: '222', call: 'WLITTLE', lat: 41.0, lon: -76.0,
      freq_khz: 660, erp_kw: 1,  relation: 'co_channel', fcc_class: 'B' }
  ];
  const v = await evaluateReceiver({
    fccamClient: makeFakeFccam(),
    proposed, interferers,
    rx: { lat: 40.5, lon: -75 },     // closer to WBIG
    duDbByRelation: { co_channel: 26 }
  });
  assert.equal(v.ok, true);
  const co = v.checks.find((c) => c.relation === 'co_channel');
  assert.ok(co, 'co_channel check missing');
  assert.ok(co.binding_interferer, 'binding_interferer not populated');
  assert.equal(co.binding_interferer.call, 'WBIG');
  assert.equal(co.binding_interferer.facility_id, '111');
  assert.equal(co.binding_interferer.relation, 'co_channel');
  assert.ok(Number.isFinite(co.binding_interferer.contributed_uv_m));
  assert.ok(co.binding_interferer.contributed_uv_m > 0);
});

/* ============================================================
   patternFactorAt — pattern_table.kind unit safety
   ============================================================ */

test('patternFactorAt: omni (null pattern_table) → factor 1', () => {
  assert.equal(patternFactorAt(null, 90), 1);
  assert.equal(patternFactorAt(undefined, 90), 1);
});

test('patternFactorAt: array (synthesizer) bypasses kind requirement', () => {
  // Array form is unambiguous — emitted by the §73.150 synthesizer.
  const pat = [[0, 1.0], [90, 0.25], [180, 1.0], [270, 0.25]];
  const f0  = patternFactorAt(pat, 0);
  const f90 = patternFactorAt(pat, 90);
  assert.equal(f0, 1.0);
  assert.equal(f90, 0.25);
});

test('patternFactorAt: plain numeric map (legacy shape) is accepted without kind', () => {
  // Historical Genoa shape: {0: 1.0, 90: 0.1, ...} — no kind
  // discriminator, all values finite numbers.  Must continue to work.
  const pat = { 0: 1.0, 90: 0.1, 180: 1.0, 270: 0.1 };
  assert.equal(patternFactorAt(pat, 0),   1.0);
  assert.equal(patternFactorAt(pat, 90),  0.1);
  assert.equal(patternFactorAt(pat, 180), 1.0);
});

test('patternFactorAt: object with kind="horizontal_relative_field" is accepted', () => {
  const pat = {
    kind: 'horizontal_relative_field',
    0: 1.0, 90: 0.5, 180: 1.0, 270: 0.5
  };
  assert.equal(patternFactorAt(pat, 0), 1.0);
  assert.equal(patternFactorAt(pat, 90), 0.5);
});

test('patternFactorAt: object with non-numeric meta + no kind → fails closed (omni)', () => {
  // Operator hand-edit that bolts a string field on without declaring
  // kind — could be a unit mix-up (mV/m vs relative).  Fail closed
  // to omni (factor 1) rather than silently scaling the field.
  const pat = {
    notes: 'measured at 1 km',
    0: 'one',  // non-numeric — shape unknown
    90: 0.1
  };
  // Falsy/unknown shape → 1 (omni).
  assert.equal(patternFactorAt(pat, 90), 1);
});

test('patternFactorAt: object meta-keys (kind/source/regulation/note) are skipped during lookup', () => {
  const pat = {
    kind:       'horizontal_relative_field',
    source:     'operator-filed',
    regulation: '47 CFR §73.150',
    note:       'tuning iteration #3',
    0:   1.0,
    180: 1.0
  };
  // Look up exactly 180° — should return 1.0, not crash on the meta-keys.
  assert.equal(patternFactorAt(pat, 180), 1.0);
});

/* ============================================================
   Field-sorted interferer cap in nightOrchestrator
   ============================================================ */

test('nightOrchestrator: cap keeps strongest-estimated-field stations (not just closest)', async () => {
  // Build a primary pool where the closest station is weak and a
  // farther station is 50× more powerful — under the OLD distance-only
  // ordering the loud one would have been dropped at max_interferers=1.
  // With the field-based estimator (erp_kw / d^1.2), the loud station
  // must survive the cap.
  const primaries = [
    // WCLOSE — 100 km, 0.5 kW.  field_est = 0.5 / 100^1.2 ≈ 0.00198
    { facility_id: 1, call: 'WCLOSE', fcc_class: 'B',
      lat: 41.0, lon: -75.0, frequency_khz: 660, erp_kw: 0.5,
      channel_relationship: 'co_channel', distance_km: 100 },
    // WLOUD — 500 km, 50 kW.  field_est = 50 / 500^1.2 ≈ 0.0362  →  ~18×
    { facility_id: 2, call: 'WLOUD', fcc_class: 'A',
      lat: 44.5, lon: -75.0, frequency_khz: 660, erp_kw: 50,
      channel_relationship: 'co_channel', distance_km: 500 }
  ];
  const proposed = {
    lat: 40.0, lon: -75.0, freq_khz: 660, erp_kw: 50,
    fcc_class: 'A', pattern_mode: 'omni'
  };
  const r = await nighttimeNifStudy(
    { proposed, options: { max_interferers: 1, azimuths_deg: [0, 90, 180, 270] } },
    {
      fccamClient: makeFakeFccam(),
      facilityClient: makeFakeFacility(primaries)
    }
  );
  assert.equal(r.available, true);
  assert.equal(r.interferers.length, 1);
  assert.equal(r.interferers[0].call, 'WLOUD',
    `field-based cap should keep the louder station; kept ${r.interferers[0].call}`);
});

test('nightOrchestrator: advisory_voacap slot is reserved as null', async () => {
  const primaries = [{
    facility_id: 1, call: 'WX', fcc_class: 'B',
    lat: 41.0, lon: -75.0, frequency_khz: 660, erp_kw: 5,
    channel_relationship: 'co_channel', distance_km: 100
  }];
  const r = await nighttimeNifStudy(
    {
      proposed: {
        lat: 40.0, lon: -75.0, freq_khz: 660, erp_kw: 50,
        fcc_class: 'A', pattern_mode: 'omni'
      },
      options: { max_interferers: 1, azimuths_deg: [0, 180] }
    },
    {
      fccamClient: makeFakeFccam(),
      facilityClient: makeFakeFacility(primaries)
    }
  );
  assert.equal(r.available, true);
  // Field exists and is explicitly null — consumers can rely on the
  // shape without a downstream schema migration when VOACAP wires up.
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'advisory_voacap'), true);
  assert.equal(r.advisory_voacap, null);
});

/* ============================================================
   WFAN Class A 660 kHz 50 kW — §73.182 NIF FAIL acceptance test
   ============================================================ */

test('acceptance: WFAN-shape Class A 660 kHz 50 kW with dense co-channel pool still FAILS §73.182', async () => {
  // WFAN is the canonical clear-channel test case: Class A on 660 kHz
  // at 50 kW.  When surrounded by a dense pool of strong co-channel
  // AMs (representative of the 660 kHz US co-channel allocation), the
  // §73.182 NIF study must fail — the Class A SS-1 0.5 mV/m floor
  // does NOT whitewash a genuinely-failing study; it only prevents
  // false-negative failures in zones where the rule does not protect.
  const proposed = {
    lat: 40.86, lon: -73.79,             // WFAN-ish NYC site
    freq_khz: 660, erp_kw: 50,
    fcc_class: 'A',
    pattern_mode: 'omni'
  };
  // Ring 12 strong co-channels at ~80 km — close enough that their
  // skywave fields dominate the §73.182(k) RSS at every azimuth.
  const primaries = [];
  for (let i = 0; i < 12; i++){
    const az = (i * 30) * Math.PI / 180;
    const dLat = Math.sin(az) * 0.72;     // ~80 km away
    const dLon = Math.cos(az) * 0.72;
    primaries.push({
      facility_id: 1000 + i,
      call:        `WCO${i}`,
      fcc_class:   'A',
      lat: 40.86 + dLat,
      lon: -73.79 + dLon,
      frequency_khz: 660,
      erp_kw:        50,                  // every neighbor is 50 kW Class A
      channel_relationship: 'co_channel',
      distance_km:   Math.hypot(dLat, dLon) * 111
    });
  }
  const r = await nighttimeNifStudy(
    {
      proposed,
      options: {
        max_interferers: 25,
        azimuths_deg: [0, 45, 90, 135, 180, 225, 270, 315]
      }
    },
    {
      fccamClient: makeFakeFccam(),
      facilityClient: makeFakeFacility(primaries)
    }
  );
  assert.equal(r.available, true,
    `study should complete even when failing; got ${JSON.stringify(r.error)}`);
  // The dense Class-A co-channel pool MUST produce a §73.182 FAIL —
  // either failing azimuths or no-service azimuths, ideally both.
  const failing  = r.summary.n_failing_azimuths    || 0;
  const noServ   = r.summary.n_no_service_azimuths || 0;
  assert.ok(failing > 0 || noServ > 0,
    `WFAN-shape Class A on 660 kHz surrounded by 50 kW co-channels should FAIL §73.182; ` +
    `got n_failing=${failing}, n_no_service=${noServ}`);
  // The orchestrator should keep the 25-cap loud Class A neighbors —
  // proves the field-based sort kept the right pool for the study.
  assert.equal(r.interferers.length, Math.min(12, 25));
});
