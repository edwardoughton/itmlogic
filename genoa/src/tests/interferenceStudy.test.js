// Formal interference_study consolidation tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInterferenceStudy } from '../engine/regulatory/interferenceStudy.js';

const SUBJECT_FM = {
  call: 'KSUB', facility_id: 'subject-1', fcc_class: 'A',
  frequency_mhz: 100.7, erp_kw: 6, haat_m: 100, lat: 40, lon: -100
};

test('buildInterferenceStudy: missing inputs returns explanatory shape', () => {
  const r = buildInterferenceStudy({});
  assert.equal(r.n_stations, 0);
  assert.equal(r.filing_qualifies, null);
  assert.match(r.reason, /no subject/);
});

test('buildInterferenceStudy: FM with §73.207 + §73.215 results consolidates per-station', () => {
  const rc = {
    cite: '47 CFR §73.215',
    pass: true,
    studies: [   // §73.215 studies
      {
        nearby_call: 'KCLO', nearby_facility_id: 'n1', nearby_class: 'B',
        nearby_frequency_mhz: 100.7, delta_khz: 0,
        relationship: 'co-channel', du_threshold_db: 20,
        forward: { du_actual_db: 22, separation_km: 250 },
        reverse: { du_actual_db: 25, separation_km: 250 },
        polygon_overlap: {
          subject_interfering_overlaps_nearby_protected: false,
          nearby_interfering_overlaps_subject_protected: false,
          subject_interfering_overlap_area_km2: 0,
          nearby_interfering_overlap_area_km2:  0
        },
        pair_pass_du: true, pair_pass: true
      }
    ],
    section_73_207: {
      pass: true,
      studies: [   // §73.207 studies — same nearby
        {
          nearby_call: 'KCLO', nearby_facility_id: 'n1', nearby_class: 'B',
          nearby_frequency_mhz: 100.7, delta_khz: 0, relationship: 'co-channel',
          required_separation_km: 241, actual_separation_km: 250, margin_km: 9,
          pair_pass: true
        }
      ]
    }
  };
  const r = buildInterferenceStudy({ subject: SUBJECT_FM, regulatory_compliance: rc, service: 'FM' });
  assert.equal(r.n_stations, 1);
  assert.equal(r.n_pass, 1);
  assert.equal(r.n_fail, 0);
  assert.equal(r.filing_qualifies, true);
  assert.equal(r.blocking_rule, null);
  const s = r.stations[0];
  assert.equal(s.call, 'KCLO');
  assert.ok(s.rules.section_73_207);
  assert.ok(s.rules.section_73_215);
  assert.equal(s.rules.section_73_207.pass, true);
  assert.equal(s.rules.section_73_215.pass, true);
  assert.deepEqual(s.qualified_via.sort(), ['§73.207(b)', '§73.215']);
  assert.equal(s.pass_overall, true);
});

test('buildInterferenceStudy: §73.207 fail + §73.215 pass → station qualifies via §73.215', () => {
  const rc = {
    cite: '47 CFR §73.215', pass: true,
    studies: [
      {
        nearby_call: 'KCLO', nearby_facility_id: 'n1', nearby_class: 'B',
        nearby_frequency_mhz: 100.7, delta_khz: 0, relationship: 'co-channel',
        du_threshold_db: 20,
        forward: { du_actual_db: 22, separation_km: 200 },
        reverse: { du_actual_db: 25, separation_km: 200 },
        polygon_overlap: {
          subject_interfering_overlaps_nearby_protected: false,
          nearby_interfering_overlaps_subject_protected: false
        },
        pair_pass_du: true, pair_pass: true
      }
    ],
    section_73_207: {
      pass: false,
      studies: [
        {
          nearby_call: 'KCLO', nearby_facility_id: 'n1', nearby_class: 'B',
          nearby_frequency_mhz: 100.7, relationship: 'co-channel',
          required_separation_km: 241, actual_separation_km: 200, margin_km: -41,
          pair_pass: false
        }
      ]
    }
  };
  const r = buildInterferenceStudy({ subject: SUBJECT_FM, regulatory_compliance: rc, service: 'FM' });
  assert.equal(r.n_pass, 1);
  assert.equal(r.n_fail, 0);
  assert.equal(r.filing_qualifies, true);
  const s = r.stations[0];
  assert.equal(s.pass_overall, true);
  assert.deepEqual(s.qualified_via, ['§73.215']);
  assert.deepEqual(s.failed_rules, ['§73.207(b)']);
});

test('buildInterferenceStudy: every rule fails → filing_qualifies=false + blocking_rule named', () => {
  const rc = {
    cite: '47 CFR §73.215', pass: false,
    studies: [
      {
        nearby_call: 'KFAIL', nearby_facility_id: 'n2', nearby_class: 'B',
        nearby_frequency_mhz: 100.7, relationship: 'co-channel',
        du_threshold_db: 20,
        forward: { du_actual_db: 5, separation_km: 50 },
        reverse: { du_actual_db: 8, separation_km: 50 },
        polygon_overlap: {
          subject_interfering_overlaps_nearby_protected: true,
          subject_interfering_overlap_area_km2: 1234,
          nearby_interfering_overlaps_subject_protected: true,
          nearby_interfering_overlap_area_km2: 1234
        },
        pair_pass_du: false, pair_pass: false
      }
    ],
    section_73_207: {
      pass: false,
      studies: [
        {
          nearby_call: 'KFAIL', nearby_facility_id: 'n2', nearby_class: 'B',
          relationship: 'co-channel',
          required_separation_km: 241, actual_separation_km: 50, margin_km: -191,
          pair_pass: false
        }
      ]
    }
  };
  const r = buildInterferenceStudy({ subject: SUBJECT_FM, regulatory_compliance: rc, service: 'FM' });
  assert.equal(r.n_fail, 1);
  assert.equal(r.filing_qualifies, false);
  assert.match(r.blocking_rule, /KFAIL/);
});

test('buildInterferenceStudy: stations sorted by distance ascending', () => {
  const rc = {
    cite: '47 CFR §73.215', pass: true,
    studies: [],
    section_73_207: {
      pass: true,
      studies: [
        { nearby_call: 'KFAR',  nearby_facility_id: 'far',  actual_separation_km: 300, pair_pass: true },
        { nearby_call: 'KNEAR', nearby_facility_id: 'near', actual_separation_km: 100, pair_pass: true },
        { nearby_call: 'KMID',  nearby_facility_id: 'mid',  actual_separation_km: 200, pair_pass: true }
      ]
    }
  };
  const r = buildInterferenceStudy({ subject: SUBJECT_FM, regulatory_compliance: rc, service: 'FM' });
  assert.deepEqual(r.stations.map(s => s.call), ['KNEAR', 'KMID', 'KFAR']);
});

test('buildInterferenceStudy: AM service uses §73.187 rule list', () => {
  const r = buildInterferenceStudy({
    subject: { call: 'KAM', facility_id: 'a', frequency_khz: 1240, lat: 33, lon: -112 },
    regulatory_compliance: { cite: '47 CFR §73.187', pass: true, studies: [] },
    service: 'AM'
  });
  assert.deepEqual(r.rules_evaluated, ['§73.187', '§73.190 (Wang skywave)']);
});

test('buildInterferenceStudy: provenance documents methodology + qualification rule', () => {
  const r = buildInterferenceStudy({
    subject: SUBJECT_FM,
    regulatory_compliance: { cite: '47 CFR §73.215', studies: [], section_73_207: { studies: [] } },
    service: 'FM'
  });
  assert.match(r.provenance.methodology.distance, /73\.208/);
  assert.match(r.provenance.methodology.protected_contour, /73\.211/);
  assert.match(r.provenance.methodology.polygon_overlap, /Sutherland-Hodgman/);
  assert.match(r.provenance.rule_qualification, /at least one applicable rule passes/i);
  assert.match(r.provenance.license_basis, /17 USC §105/);
});
