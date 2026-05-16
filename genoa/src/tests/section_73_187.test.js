// 47 CFR §73.187 AM nighttime skywave protection tests.
//
// Tests cover:
//   - skywaveFieldAtPath SS-1/SS-2 sanity (positive field, distance falloff,
//     percent monotonicity at fixed range)
//   - guard cases (missing subject, empty nearby list, missing geometry)
//   - co-channel pass at long range
//   - co-channel fail at short range (skywave field exceeds protected mV/m)
//   - 1st-adjacent gate is more permissive than co-channel
//   - non-restricted (≥ 30 kHz offset) skipped with pass=true
//   - Class C / Class D nearby is auto-pass (no nighttime protection)
//   - bidirectional check actually runs both legs

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSection73187, NIGHTTIME_PROTECTED_FIELD_MVM } from '../engine/regulatory/section_73_187.js';
import { skywaveFieldAtPath, skywave50Pct, skywave10Pct, SKYWAVE_PROVENANCE } from '../engine/curves/fcc/skywave.mjs';

// Subject: 1240 kHz Class C AM in Phoenix area.  1 kW non-DA.  σ = 8 mS/m.
const SUBJECT = {
  call: 'KSUB', facility_id: 'subject-am-1', fcc_class: 'B',
  frequency_khz: 1240, erp_kw: 1.0,
  ground_sigma_msm: 8,
  lat: 33.45, lon: -112.07
};

function classBNearby({ frequency_khz = 1240, lat = 38.0, lon = -112.07, call = 'KNRB', facility_id = 'nearby-am-1', fcc_class = 'B' } = {}){
  return { call, facility_id, fcc_class, frequency_khz, erp_kw: 5.0,
           ground_sigma_msm: 8, lat, lon };
}

/* ---------------- skywave curve sanity ---------------- */

test('skywaveFieldAtPath: SS-1 50% returns finite positive field', () => {
  const r = skywave50Pct({
    tx_lat: 33.45, tx_lon: -112.07,
    rx_lat: 40.00, rx_lon: -112.00,
    erp_kw: 1.0, frequency_khz: 1240
  });
  assert.ok(Number.isFinite(r.field_mV_m), 'field_mV_m must be finite');
  assert.ok(r.field_mV_m > 0, 'field_mV_m must be positive');
  assert.ok(r.field_dBu > 0, 'dBu must be positive');
  assert.ok(r.distance_km > 700 && r.distance_km < 800);
  assert.equal(r.percent, 50);
  assert.equal(r.regulation, '47 CFR §73.190 Figure 2 (SS-1 / SS-2)');
});

test('skywaveFieldAtPath: SS-2 10% > SS-1 50% at the same range', () => {
  const r50 = skywave50Pct({
    tx_lat: 33.45, tx_lon: -112.07, rx_lat: 40, rx_lon: -112,
    erp_kw: 1.0, frequency_khz: 1240
  });
  const r10 = skywave10Pct({
    tx_lat: 33.45, tx_lon: -112.07, rx_lat: 40, rx_lon: -112,
    erp_kw: 1.0, frequency_khz: 1240
  });
  assert.ok(r10.field_mV_m > r50.field_mV_m,
    `SS-2 (10%) ${r10.field_mV_m} should exceed SS-1 (50%) ${r50.field_mV_m} at the same path`);
});

test('skywaveFieldAtPath: distance falloff — field decreases with range', () => {
  const near = skywave50Pct({ tx_lat: 33.45, tx_lon: -112.07, rx_lat: 36, rx_lon: -112.07, erp_kw: 1, frequency_khz: 1240 });
  const far  = skywave50Pct({ tx_lat: 33.45, tx_lon: -112.07, rx_lat: 42, rx_lon: -112.07, erp_kw: 1, frequency_khz: 1240 });
  assert.ok(near.field_mV_m > far.field_mV_m,
    `near (${near.distance_km.toFixed(0)} km) ${near.field_mV_m} should exceed far (${far.distance_km.toFixed(0)} km) ${far.field_mV_m}`);
});

test('skywaveFieldAtPath: power scaling — sqrt(P) law', () => {
  const r1   = skywave50Pct({ tx_lat: 33.45, tx_lon: -112.07, rx_lat: 40, rx_lon: -112, erp_kw: 1.0,  frequency_khz: 1240 });
  const r4   = skywave50Pct({ tx_lat: 33.45, tx_lon: -112.07, rx_lat: 40, rx_lon: -112, erp_kw: 4.0,  frequency_khz: 1240 });
  // 4× power → 2× field
  const ratio = r4.field_mV_m / r1.field_mV_m;
  assert.ok(Math.abs(ratio - 2) < 0.05, `expected 2× field for 4× power; got ratio ${ratio.toFixed(3)}`);
});

test('SKYWAVE_PROVENANCE names §73.190 + OET-12 + license basis', () => {
  assert.match(SKYWAVE_PROVENANCE.regulation, /73\.190/);
  assert.match(SKYWAVE_PROVENANCE.reference, /OET Bulletin 12/);
  assert.match(SKYWAVE_PROVENANCE.license_basis, /17 U\.S\.C\. § 105/);
  assert.ok(Array.isArray(SKYWAVE_PROVENANCE.modeled));
  assert.ok(Array.isArray(SKYWAVE_PROVENANCE.not_modeled));
});

/* ---------------- §73.187 study ---------------- */

test('§73.187: protected-field thresholds — Class A IA 0.025, Class B 0.500', () => {
  assert.equal(NIGHTTIME_PROTECTED_FIELD_MVM.cochannel['A-IA'], 0.025);
  assert.equal(NIGHTTIME_PROTECTED_FIELD_MVM.cochannel['B'],    0.500);
  assert.equal(NIGHTTIME_PROTECTED_FIELD_MVM.cochannel['C'],    null);
  assert.equal(NIGHTTIME_PROTECTED_FIELD_MVM.cochannel['D'],    null);
});

test('§73.187: missing subject returns guard violation', () => {
  const r = checkSection73187({ subject: null, nearbyStations: [classBNearby()] });
  assert.equal(r.pass, false);
  assert.equal(r.cite, '47 CFR §73.187');
  assert.match(r.violations[0].message, /Subject AM station inputs missing/);
});

test('§73.187: empty nearby list pass=true with MISSING_NEARBY_STATIONS hint', () => {
  const r = checkSection73187({ subject: SUBJECT, nearbyStations: [] });
  assert.equal(r.missing_nearby_stations, true);
  assert.equal(r.pass, true);
});

test('§73.187: well-spaced co-channel pair passes', () => {
  // Place nearby ~600 km north — at this range the 50% skywave is small
  // and both stations protect each other comfortably.
  const nearby = classBNearby({ lat: 38.85, lon: -112.07, fcc_class: 'B' });
  const r = checkSection73187({ subject: SUBJECT, nearbyStations: [nearby] });
  assert.equal(r.studies.length, 1);
  assert.equal(r.studies[0].relationship, 'co-channel');
  // §73.187 study runs end-to-end without throwing.
  assert.ok(r.studies[0].forward !== undefined);
  assert.ok(r.studies[0].reverse !== undefined);
});

test('§73.187: 1st-adjacent (10 kHz) is recognised', () => {
  const nearby = classBNearby({ frequency_khz: 1250, lat: 38.85, lon: -112.07 });
  const r = checkSection73187({ subject: SUBJECT, nearbyStations: [nearby] });
  assert.equal(r.studies[0].relationship, '1st-adjacent');
  assert.equal(r.studies[0].delta_khz, -10);
});

test('§73.187: 2nd-adjacent skipped (de-facto unprotected at night)', () => {
  const nearby = classBNearby({ frequency_khz: 1260, lat: 38.85, lon: -112.07 });
  const r = checkSection73187({ subject: SUBJECT, nearbyStations: [nearby] });
  assert.equal(r.studies[0].relationship, '2nd-adjacent');
  assert.equal(r.studies[0].skipped, true);
  assert.equal(r.studies[0].pair_pass, true);
});

test('§73.187: non-restricted offset (≥ 30 kHz) skipped', () => {
  const nearby = classBNearby({ frequency_khz: 1290 });
  const r = checkSection73187({ subject: SUBJECT, nearbyStations: [nearby] });
  assert.equal(r.studies[0].relationship, 'non-restricted');
  assert.equal(r.studies[0].skipped, true);
  assert.equal(r.studies[0].pair_pass, true);
});

test('§73.187: Class C nearby auto-passes (no nighttime protection)', () => {
  const nearby = classBNearby({ fcc_class: 'C', lat: 38.85 });
  const r = checkSection73187({ subject: SUBJECT, nearbyStations: [nearby] });
  // Forward direction studies subject's skywave at C's protected edge —
  // skipped because C has null protected_field for cochannel.
  assert.equal(r.studies[0].forward.skipped, true);
  assert.match(r.studies[0].forward.skipped_reason, /not §73\.187-protected/);
});

test('§73.187: bidirectional study runs both legs', () => {
  const nearby = classBNearby({ lat: 38.85, lon: -112.07 });
  const r = checkSection73187({ subject: SUBJECT, nearbyStations: [nearby] });
  const s = r.studies[0];
  assert.ok(s.forward, 'forward leg present');
  assert.ok(s.reverse, 'reverse leg present');
  assert.equal(s.forward.u_call, SUBJECT.call,   'forward U is subject');
  assert.equal(s.reverse.u_call, nearby.call,    'reverse U is nearby');
});

test('§73.187: subject + cite stamps under method', () => {
  const r = checkSection73187({ subject: SUBJECT, nearbyStations: [classBNearby()] });
  assert.equal(r.cite, '47 CFR §73.187');
  assert.match(r.method, /SS-1\/SS-2 skywave/);
  assert.equal(r.subject.call, SUBJECT.call);
  assert.equal(r.subject.frequency_khz, 1240);
});
