import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSection73215Showing,
  SECTION_73_215_SHOWING_PROVENANCE
} from '../exports/section73215Showing.js';

// Build a minimal exhibit with realistic §73.207 / §73.215 study
// shapes — only the fields buildSection73215Showing actually reads.
function mkExhibit({
  call = 'WTST', facility_id = 1234, frequency = 92.1,
  r207_pass = false,
  r207_violations = [],
  r215_studies = [],
  drop_215 = false
} = {}){
  const reg = {
    '47 CFR §73.207': {
      pass: r207_pass,
      violations: r207_violations
    }
  };
  if (!drop_215){
    reg['47 CFR §73.215'] = { studies: r215_studies };
  }
  return {
    station_inputs: { call, facility_id, frequency },
    regulatory_compliance: reg
  };
}

function r207Violation({ call = 'WBLK', facility_id = 9001, freq = 92.1,
                         class_pair = 'A↔A', relationship = 'co-channel',
                         required = 115, actual = 60 } = {}){
  return {
    cite: '47 CFR §73.207(b)',
    detail: {
      nearby_call:               call,
      nearby_facility_id:        facility_id,
      nearby_class:              class_pair.split('↔')[1] || 'A',
      nearby_frequency_mhz:      freq,
      relationship,
      class_pair,
      required_separation_km:    required,
      actual_separation_km:      actual,
      margin_km:                 actual - required
    }
  };
}

function r215Study({ call = 'WBLK', facility_id = 9001,
                     pair_pass = true,
                     forward_du = 30, reverse_du = 28, du_threshold = 6,
                     subj_overlap = 0, near_overlap = 0 } = {}){
  return {
    nearby_call:        call,
    nearby_facility_id: facility_id,
    nearby_class:       'A',
    nearby_frequency_mhz: 92.1,
    relationship:       '1st-adjacent',
    du_threshold_db:    du_threshold,
    forward:            { du_actual_db: forward_du, pass: forward_du >= du_threshold },
    reverse:            { du_actual_db: reverse_du, pass: reverse_du >= du_threshold },
    polygon_overlap: {
      subject_interfering_overlaps_nearby_protected: subj_overlap > 0,
      nearby_interfering_overlaps_subject_protected: near_overlap > 0,
      subject_interfering_overlap_area_km2: subj_overlap,
      nearby_interfering_overlap_area_km2:  near_overlap
    },
    pair_pass_du: forward_du >= du_threshold && reverse_du >= du_threshold,
    pair_pass
  };
}

/* ---------- input guards ---------- */

test('buildSection73215Showing: rejects missing exhibit', () => {
  assert.equal(buildSection73215Showing(null).ok, false);
});

test('buildSection73215Showing: rejects exhibit with no §73.207 study', () => {
  const r = buildSection73215Showing({ regulatory_compliance: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /73\.207/);
});

test('buildSection73215Showing: §73.207 passes outright → showing not applicable', () => {
  const r = buildSection73215Showing(mkExhibit({ r207_pass: true }));
  assert.equal(r.ok, true);
  assert.equal(r.applicable, false);
  assert.equal(r.short_spaced_pairs.length, 0);
  assert.match(r.reason, /no §73\.215.*required|No §73\.215/);
});

test('buildSection73215Showing: §73.207 fails but no §73.215 → instructive error', () => {
  const r = buildSection73215Showing(mkExhibit({
    r207_violations: [r207Violation()],
    drop_215: true
  }));
  assert.equal(r.ok, false);
  assert.match(r.error, /no §73\.215|re-run compute/);
});

/* ---------- happy path: cleanly cured by §73.215 ---------- */

test('§73.215 showing: single qualifying pair surfaces forward/reverse D/U + zero overlap', () => {
  const r = buildSection73215Showing(mkExhibit({
    r207_violations: [r207Violation({ call: 'WBLK', required: 115, actual: 60 })],
    r215_studies:    [r215Study({ call: 'WBLK', pair_pass: true,
                                  forward_du: 30, reverse_du: 28 })]
  }));
  assert.equal(r.ok, true);
  assert.equal(r.applicable, true);
  assert.equal(r.summary.n_qualifying, 1);
  assert.equal(r.summary.n_cannot_cure, 0);
  assert.equal(r.summary.filing_qualifies, true);

  const pair = r.short_spaced_pairs[0];
  assert.equal(pair.call, 'WBLK');
  assert.equal(pair.section_73_207.required_km, 115);
  assert.equal(pair.section_73_207.actual_km, 60);
  assert.equal(pair.section_73_207.deficit_km, 55);
  assert.equal(pair.section_73_215.passed, true);
  assert.equal(pair.section_73_215.forward_du_db, 30);
  assert.equal(pair.section_73_215.reverse_du_db, 28);
  assert.equal(pair.section_73_215.polygon_overlap.subject_interfering_overlaps_nearby_protected, false);
  assert.match(pair.narrative, /WBLK.*115 km.*60 km.*55 km/);
  assert.match(pair.narrative, /qualifies under 47 CFR §73\.215/);
});

/* ---------- mixed result: some pairs cured, some not ---------- */

test('§73.215 showing: mixed pairs split into qualifying + cannot_cure', () => {
  const r = buildSection73215Showing(mkExhibit({
    r207_violations: [
      r207Violation({ call: 'WBLK', required: 115, actual: 60 }),
      r207Violation({ call: 'WPOOR', facility_id: 9002, required: 115, actual: 40 })
    ],
    r215_studies: [
      r215Study({ call: 'WBLK',  pair_pass: true,  forward_du: 30, reverse_du: 28 }),
      r215Study({ call: 'WPOOR', facility_id: 9002, pair_pass: false,
                  forward_du: -2, reverse_du: -1, subj_overlap: 12.5 })
    ]
  }));
  assert.equal(r.summary.n_qualifying, 1);
  assert.equal(r.summary.n_cannot_cure, 1);
  assert.equal(r.summary.filing_qualifies, false);
  assert.equal(r.short_spaced_pairs[0].call, 'WBLK');
  assert.equal(r.cannot_cure_pairs[0].call, 'WPOOR');
  assert.match(r.cannot_cure_pairs[0].narrative,
    /cannot be cured.*§73\.215|§73\.207 waiver/);
});

/* ---------- pair lookup by facility_id when call missing ---------- */

test('§73.215 showing: matches §73.207 violation to §73.215 study by facility_id', () => {
  const r = buildSection73215Showing(mkExhibit({
    r207_violations: [r207Violation({ call: null, facility_id: 9001 })],
    r215_studies:    [r215Study({ call: null, facility_id: 9001, pair_pass: true })]
  }));
  assert.equal(r.summary.n_qualifying, 1);
  assert.equal(r.summary.filing_qualifies, true);
});

/* ---------- boilerplate prose ---------- */

test('§73.215 showing: boilerplate names the subject and pair counts', () => {
  const r = buildSection73215Showing(mkExhibit({
    call: 'WJPZ', facility_id: 73148, frequency: 89.1,
    r207_violations: [r207Violation()],
    r215_studies:    [r215Study({ pair_pass: true })]
  }));
  assert.match(r.boilerplate_narrative, /WJPZ/);
  assert.match(r.boilerplate_narrative, /89\.1/);
  assert.match(r.boilerplate_narrative, /1 nearby/);
  assert.match(r.boilerplate_narrative, /qualifies under 47 CFR §73\.215\(a\)/);
});

test('§73.215 showing: boilerplate flags mixed result correctly', () => {
  const r = buildSection73215Showing(mkExhibit({
    r207_violations: [
      r207Violation({ call: 'WA' }),
      r207Violation({ call: 'WB' })
    ],
    r215_studies: [
      r215Study({ call: 'WA', pair_pass: true }),
      r215Study({ call: 'WB', pair_pass: false, subj_overlap: 5 })
    ]
  }));
  assert.match(r.boilerplate_narrative, /mixed showing/);
});

test('§73.215 showing: boilerplate names the failure mode when none qualify', () => {
  const r = buildSection73215Showing(mkExhibit({
    r207_violations: [r207Violation()],
    r215_studies:    [r215Study({ pair_pass: false, subj_overlap: 5 })]
  }));
  assert.equal(r.summary.n_qualifying, 0);
  assert.equal(r.summary.n_cannot_cure, 1);
  assert.match(r.boilerplate_narrative, /do not clear|cannot be cured/);
});

/* ---------- certification block ---------- */

test('§73.215 showing: certification language references the engines used', () => {
  const r = buildSection73215Showing(mkExhibit({
    r207_violations: [r207Violation()],
    r215_studies:    [r215Study()]
  }));
  assert.match(r.certification_language, /tvfm_curves\.js/);
  assert.match(r.certification_language, /Sutherland-Hodgman/);
  assert.match(r.certification_language, /WGS-84/);
});

/* ---------- provenance ---------- */

test('SECTION_73_215_SHOWING_PROVENANCE names the right rules', () => {
  assert.match(SECTION_73_215_SHOWING_PROVENANCE.regulation, /73\.207/);
  assert.match(SECTION_73_215_SHOWING_PROVENANCE.regulation, /73\.215/);
  assert.match(SECTION_73_215_SHOWING_PROVENANCE.license_basis, /17 USC §105/);
});
