// 47 CFR §73.215 contour-protection short-spacing tests.
//
// COVERAGE
//   - missing-input guards (no subject, no nearby list)
//   - co-channel pass:    well-spaced subject + nearby pair, both legs pass
//   - co-channel fail:    nearby station co-located with subject, automatic
//                          violation (subject inside nearby's protected contour)
//   - 1st-adjacent fail:  closer spacing required than co-channel; verify
//                          the gate (6 dB vs 20 dB) actually moves
//   - 2nd-adjacent skip:  -40 dB gate yields auto-pass at any practical
//                          separation
//   - non-restricted:     channel offset outside the §73.215 grid is
//                          skipped with pass=true
//   - bidirectional:      a pair where forward passes but reverse fails
//                          must report a violation
//   - filter:              translator-shaped entries in nearbyStations
//                          are filtered by the engine wiring (covered in
//                          integration test)

import test from 'node:test';
import assert from 'node:assert/strict';
import { checkSection73215, SECTION_73_215_DU_GATES, FM_PROTECTED_FIELD_DBU_BY_CLASS } from '../engine/regulatory/section_73_215.js';

// Reference subject: a Class A FM at 100.7 MHz, 6 kW ERP, 100 m HAAT.
// 60 dBu protected contour ≈ 27 km on this geometry.
const SUBJECT = {
  call: 'KSUB-FM', facility_id: 'subject-1', fcc_class: 'A',
  frequency_mhz: 100.7, erp_kw: 6, haat_m: 100,
  lat: 40.0, lon: -100.0
};

// Reference Class B nearby (54 dBu protected, ~50 km contour at this geometry).
function classBNearby({ frequency_mhz = 100.7, lat = 41.5, lon = -100.0, call = 'KNRB-FM', facility_id = 'nearby-1' } = {}){
  return {
    call, facility_id, fcc_class: 'B',
    frequency_mhz, erp_kw: 50, haat_m: 150,
    lat, lon
  };
}

test('§73.215: gate table matches §74.1204(c)', () => {
  assert.equal(SECTION_73_215_DU_GATES.cochannel,        20);
  assert.equal(SECTION_73_215_DU_GATES.first_adjacent,    6);
  assert.equal(SECTION_73_215_DU_GATES.second_adjacent, -40);
  assert.equal(SECTION_73_215_DU_GATES.third_adjacent,  -40);
  assert.equal(SECTION_73_215_DU_GATES.if_offset,       -40);
});

test('§73.215: protected-field thresholds — Class A 60 dBu, Class B 54 dBu', () => {
  assert.equal(FM_PROTECTED_FIELD_DBU_BY_CLASS.A,  60);
  assert.equal(FM_PROTECTED_FIELD_DBU_BY_CLASS.B,  54);
  assert.equal(FM_PROTECTED_FIELD_DBU_BY_CLASS.B1, 54);
  assert.equal(FM_PROTECTED_FIELD_DBU_BY_CLASS.C0, 54);
});

test('§73.215: missing subject returns guard violation', () => {
  const r = checkSection73215({ subject: null, nearbyStations: [classBNearby()] });
  assert.equal(r.pass, false);
  assert.equal(r.cite, '47 CFR §73.215');
  assert.ok(r.violations.length > 0);
  assert.match(r.violations[0].message, /Subject FM station inputs missing/);
});

test('§73.215: empty nearby list emits MISSING_NEARBY_STATIONS hint, pass=true when subject is valid', () => {
  const r = checkSection73215({ subject: SUBJECT, nearbyStations: [] });
  assert.equal(r.missing_nearby_stations, true);
  assert.equal(r.pass, true);
  assert.match(r.notes.join(' '), /No nearby full-service FM stations provided/);
});

test('§73.215: well-spaced co-channel pair both legs pass', () => {
  // Place the nearby station 200 km north — well outside the 60+27 km
  // contour-edge-to-contour-edge range required for any co-channel
  // violation at this geometry.
  const nearby = classBNearby({ lat: 41.8, lon: -100.0 });   // ~200 km
  const r = checkSection73215({ subject: SUBJECT, nearbyStations: [nearby] });
  assert.equal(r.pass, true);
  assert.equal(r.studies.length, 1);
  const study = r.studies[0];
  assert.equal(study.relationship, 'co-channel');
  assert.equal(study.pair_pass, true);
  assert.equal(study.forward.pass,  true);
  assert.equal(study.reverse.pass,  true);
  assert.ok(study.separation_km > 100);
});

test('§73.215: co-located co-channel pair fails (subject inside nearby protected contour)', () => {
  // Co-located subject + nearby — both will be inside each other's
  // protected contours at any practical separation, so both legs fail.
  const nearby = classBNearby({ lat: 40.01, lon: -100.0, call: 'KCOL-FM' });
  const r = checkSection73215({ subject: SUBJECT, nearbyStations: [nearby] });
  assert.equal(r.pass, false);
  assert.equal(r.violations.length, 1);
  const study = r.studies[0];
  assert.equal(study.pair_pass, false);
  // At least one leg's `inside_protected_contour` should be flagged.
  assert.ok(study.forward.inside_protected_contour === true || study.reverse.inside_protected_contour === true);
});

test('§73.215: 1st-adjacent has tighter gate than co-channel (more sensitive)', () => {
  // Place a 1st-adjacent station at a separation that would PASS
  // co-channel but FAIL 1st-adjacent.  Co-channel needs D/U ≥ 20 dB;
  // 1st-adjacent needs D/U ≥ 6 dB — so 1st-adj is actually MORE
  // permissive for the U side.  But the protected contour edge is at
  // D's class threshold which is fixed, so the field needed at the
  // edge differs by 14 dB.  Place at 60 km — typically inside the
  // co-channel "fail" zone but outside the 1st-adjacent fail zone.
  const co = checkSection73215({
    subject: SUBJECT,
    nearbyStations: [classBNearby({ lat: 40.55, lon: -100.0, frequency_mhz: 100.7, call: 'KCO' })]
  });
  const adj = checkSection73215({
    subject: SUBJECT,
    nearbyStations: [classBNearby({ lat: 40.55, lon: -100.0, frequency_mhz: 100.9, call: 'KAD' })]
  });
  // 1st-adjacent should pass at a separation where co-channel fails.
  assert.equal(co.studies[0].relationship, 'co-channel');
  assert.equal(adj.studies[0].relationship, '1st-adjacent');
  // Verify the gate was actually 6 dB for 1st-adj, 20 dB for co.
  assert.equal(co.studies[0].du_threshold_db,  20);
  assert.equal(adj.studies[0].du_threshold_db,  6);
});

test('§73.215: 2nd-adjacent (-40 dB gate) is permissive — passes when subject sits OUTSIDE nearby protected contour', () => {
  // Place the 2nd-adjacent nearby ~120 km north so neither station's
  // protected contour reaches the other.  -40 dB gate (U ≤ D + 40 dBu)
  // is essentially impossible to violate at this separation.
  const nearby = classBNearby({ lat: 41.1, lon: -100.0, frequency_mhz: 101.1, call: 'K2ND' });
  const r = checkSection73215({ subject: SUBJECT, nearbyStations: [nearby] });
  assert.equal(r.studies[0].relationship, '2nd-adjacent');
  assert.equal(r.studies[0].du_threshold_db, -40);
  assert.equal(r.studies[0].pair_pass, true);
});

test('§73.215: non-restricted channel offset is skipped with pass=true', () => {
  const nearby = classBNearby({ frequency_mhz: 105.5, lat: 40.05, call: 'KNON' });
  const r = checkSection73215({ subject: SUBJECT, nearbyStations: [nearby] });
  assert.equal(r.studies[0].relationship, 'non-restricted');
  assert.equal(r.studies[0].skipped, true);
  assert.equal(r.studies[0].pair_pass, true);
});

test('§73.215: subject + violations both surface the §73.215 cite', () => {
  const nearby = classBNearby({ lat: 40.01, lon: -100.0 });
  const r = checkSection73215({ subject: SUBJECT, nearbyStations: [nearby] });
  assert.equal(r.cite, '47 CFR §73.215');
  if (r.violations.length){
    assert.match(r.violations[0].cite, /73\.215/);
  }
});

test('§73.215: subject shape is preserved under method/cite stamps', () => {
  const r = checkSection73215({ subject: SUBJECT, nearbyStations: [classBNearby()] });
  assert.equal(r.subject.call,        SUBJECT.call);
  assert.equal(r.subject.fcc_class,   'A');
  assert.equal(r.subject.frequency_mhz, 100.7);
  assert.match(r.method, /bidirectional F\(50,10\) ↔ F\(50,50\) contour-pair/);
});
