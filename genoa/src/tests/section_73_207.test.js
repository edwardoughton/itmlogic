// 47 CFR §73.207 minimum-distance separation tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSection73207,
  minimumSeparationKm,
  SECTION_73_207_PROVENANCE
} from '../engine/regulatory/section_73_207.js';

const SUBJECT_A = {
  call: 'KSUB-FM', facility_id: 'subject-A',
  fcc_class: 'A', frequency_mhz: 100.7,
  lat: 40.0, lon: -100.0
};

function classB({ frequency_mhz = 100.7, lat = 41.5, lon = -100.0,
                  call = 'KNRB-FM', facility_id = 'nearby-B', fcc_class = 'B' } = {}){
  return { call, facility_id, fcc_class, frequency_mhz, lat, lon };
}

/* ---------- separation table ---------- */

test('§73.207: A↔A co-channel = 115 km, 1st-adj = 72 km, 2nd/3rd = 31 km, IF = 10 km', () => {
  assert.equal(minimumSeparationKm('A', 'A', 'cochannel'),       115);
  assert.equal(minimumSeparationKm('A', 'A', 'first_adjacent'),   72);
  assert.equal(minimumSeparationKm('A', 'A', 'second_adjacent'),  31);
  assert.equal(minimumSeparationKm('A', 'A', 'third_adjacent'),   31);
  assert.equal(minimumSeparationKm('A', 'A', 'if_offset'),        10);
});

test('§73.207: A↔B co-channel = 241 km (the asymmetric class-B-protects-class-A case)', () => {
  // Class B is much higher power; the protection distance is far.
  assert.equal(minimumSeparationKm('A', 'B', 'cochannel'), 241);
  // Symmetric: B↔A also 241
  assert.equal(minimumSeparationKm('B', 'A', 'cochannel'), 241);
});

test('§73.207: C↔C co-channel = 374 km (largest pair in table)', () => {
  assert.equal(minimumSeparationKm('C', 'C', 'cochannel'), 374);
});

test('§73.207: classes outside table return null', () => {
  assert.equal(minimumSeparationKm('LP100', 'A', 'cochannel'), null);
  assert.equal(minimumSeparationKm('A', 'FX',    'cochannel'), null);
  assert.equal(minimumSeparationKm('Z',  'A',    'cochannel'), null);
});

test('§73.207: case-insensitive, "Class A" / "A " all normalize', () => {
  assert.equal(minimumSeparationKm('a', 'a', 'cochannel'),         115);
  assert.equal(minimumSeparationKm('Class A', ' A ', 'cochannel'), 115);
});

/* ---------- study guards ---------- */

test('§73.207: missing subject returns guard violation', () => {
  const r = checkSection73207({ subject: null, nearbyStations: [classB()] });
  assert.equal(r.pass, false);
  assert.equal(r.cite, '47 CFR §73.207');
  assert.match(r.violations[0].message, /Subject FM station inputs missing/);
});

test('§73.207: empty nearby list pass=true with hint', () => {
  const r = checkSection73207({ subject: SUBJECT_A, nearbyStations: [] });
  assert.equal(r.missing_nearby_stations, true);
  assert.equal(r.pass, true);
});

test('§73.207: unknown subject class is noted; pass falls to false when nearby exist', () => {
  const r = checkSection73207({
    subject: { ...SUBJECT_A, fcc_class: 'LP100' },
    nearbyStations: [classB()]
  });
  assert.equal(r.pass, false);
  assert.match(r.notes.join(' '), /not in §73\.207\(b\)/);
});

/* ---------- pair-wise pass / fail ---------- */

test('§73.207: well-spaced co-channel pair passes (200 km > 241 fails; 300 km > 241 passes)', () => {
  // A↔B co-channel: 241 km required.  Place at 300 km north (~ 2.7° lat).
  const nearby = classB({ lat: 42.7, lon: -100.0 });
  const r = checkSection73207({ subject: SUBJECT_A, nearbyStations: [nearby] });
  assert.equal(r.pass, true);
  assert.equal(r.studies.length, 1);
  assert.equal(r.studies[0].pair_pass, true);
  assert.ok(r.studies[0].actual_separation_km > 241);
  assert.equal(r.studies[0].required_separation_km, 241);
  assert.ok(r.studies[0].margin_km > 0);
});

test('§73.207: short-spaced co-channel pair fails', () => {
  // A↔B co-channel: 241 km required.  Place at 100 km (0.9° lat) — a fail.
  const nearby = classB({ lat: 40.9, lon: -100.0 });
  const r = checkSection73207({ subject: SUBJECT_A, nearbyStations: [nearby] });
  assert.equal(r.pass, false);
  assert.equal(r.violations.length, 1);
  assert.match(r.violations[0].cite, /73\.207/);
  assert.match(r.violations[0].message, /Class A↔B co-channel requires 241 km/);
  assert.ok(r.violations[0].section_73_215_alternative);
  assert.equal(r.studies[0].pair_pass, false);
  assert.ok(r.studies[0].margin_km < 0);
});

test('§73.207: 1st-adjacent has shorter required separation than co-channel', () => {
  const co  = checkSection73207({ subject: SUBJECT_A,
    nearbyStations: [classB({ frequency_mhz: 100.7, lat: 40.9 })] });
  const adj = checkSection73207({ subject: SUBJECT_A,
    nearbyStations: [classB({ frequency_mhz: 100.9, lat: 40.9 })] });
  assert.equal(co.studies[0].required_separation_km,  241);
  assert.equal(adj.studies[0].required_separation_km, 169);
  assert.ok(adj.studies[0].required_separation_km < co.studies[0].required_separation_km);
});

test('§73.207: 2nd-adjacent at 0.5° lat (~55 km) passes (A↔B requires 74)', () => {
  const r = checkSection73207({ subject: SUBJECT_A,
    nearbyStations: [classB({ frequency_mhz: 101.1, lat: 40.7 })] });   // ~78 km
  assert.equal(r.studies[0].relationship, '2nd-adjacent');
  assert.equal(r.studies[0].pair_pass, true);
});

test('§73.207: non-restricted offset is skipped with pair_pass=true', () => {
  const r = checkSection73207({ subject: SUBJECT_A,
    nearbyStations: [classB({ frequency_mhz: 105.5, lat: 40.5 })] });
  assert.equal(r.studies[0].relationship, 'non-restricted');
  assert.equal(r.studies[0].skipped, true);
  assert.equal(r.studies[0].pair_pass, true);
});

test('§73.207: nearby with unknown class is skipped with reason', () => {
  const r = checkSection73207({ subject: SUBJECT_A,
    nearbyStations: [{ call: 'KFX', facility_id: 'fx-1', fcc_class: 'FX',
                       frequency_mhz: 100.7, lat: 40.5, lon: -100 }] });
  assert.equal(r.studies[0].skipped, true);
  assert.match(r.studies[0].skipped_reason, /not in §73\.207\(b\)/);
});

test('§73.207: subject + cite stamps under method', () => {
  const r = checkSection73207({ subject: SUBJECT_A, nearbyStations: [classB()] });
  assert.equal(r.cite, '47 CFR §73.207');
  assert.match(r.method, /Table A/);
  assert.match(r.method, /Karney/);
  assert.equal(r.subject.call, SUBJECT_A.call);
});

test('SECTION_73_207_PROVENANCE names §73.207(b) + §73.208 + license', () => {
  assert.match(SECTION_73_207_PROVENANCE.regulation, /73\.207/);
  assert.match(SECTION_73_207_PROVENANCE.reference_distance_method, /73\.208/);
  assert.match(SECTION_73_207_PROVENANCE.alternative, /73\.215/);
  assert.match(SECTION_73_207_PROVENANCE.license_basis, /17 U\.S\.C\. § 105/);
});
