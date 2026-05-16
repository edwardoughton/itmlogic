import test from 'node:test';
import assert from 'node:assert/strict';
import { diffExhibits, EXHIBIT_DIFF_PROVENANCE } from '../engine/exhibitDiff.js';

// Minimal exhibit shape — only the fields exhibitDiff actually reads.
function mkExhibit({
  call = 'WTST', facility_id = 1234,
  lat = 40.0, lon = -75.0,
  frequency = 100.7, fcc_class = 'A',
  erp_kw = 6, haat_m = 100,
  pattern_mode = 'omni',
  contour_distances = { service_60dbu: 14, city_54dbu: 19, protected_40dbu: 41 },
  filing_qualifies = true, n_pass = 12, n_fail = 0, stations = [],
  rules = { '47 CFR §73.207': { pass: true } },
  warnings = []
} = {}){
  // Build a 4-radial table by repeating the contour set per azimuth.
  const radial_table = [0, 90, 180, 270].map((az) => ({
    azimuth_deg: az,
    contour_distances_km: { ...contour_distances }
  }));
  return {
    station_inputs: { call, facility_id, lat, lon, frequency,
                      fcc_class, erp_kw, haat_m, pattern_mode },
    radial_table,
    population_estimate: { primary: null, informational_only: true },
    interference_study: {
      filing_qualifies, n_pass, n_fail, stations
    },
    regulatory_compliance: rules,
    warnings
  };
}

/* ---------- input guards ---------- */

test('diffExhibits: rejects missing before / after', () => {
  assert.equal(diffExhibits(null, mkExhibit()).ok, false);
  assert.equal(diffExhibits(mkExhibit(), null).ok, false);
  assert.equal(diffExhibits().ok, false);
});

/* ---------- station input deltas ---------- */

test('station_inputs_delta: same exhibit twice → no changes', () => {
  const e = mkExhibit();
  const d = diffExhibits(e, e);
  assert.equal(d.ok, true);
  assert.equal(d.station_inputs_delta.frequency.changed, false);
  assert.equal(d.station_inputs_delta.erp_kw.changed,    false);
  assert.equal(d.station_inputs_delta.site_changed,      false);
  assert.equal(d.station_inputs_delta.distance_moved_km, 0);
});

test('station_inputs_delta: ERP increase reflected as positive delta', () => {
  const before = mkExhibit({ erp_kw: 6 });
  const after  = mkExhibit({ erp_kw: 25 });
  const d = diffExhibits(before, after);
  assert.equal(d.station_inputs_delta.erp_kw.before, 6);
  assert.equal(d.station_inputs_delta.erp_kw.after, 25);
  assert.equal(d.station_inputs_delta.erp_kw.delta, 19);
  assert.equal(d.station_inputs_delta.erp_kw.changed, true);
});

test('station_inputs_delta: site move detected as great-circle distance', () => {
  const before = mkExhibit({ lat: 40.0, lon: -75.0 });
  const after  = mkExhibit({ lat: 40.5, lon: -75.0 });   // ~55 km north
  const d = diffExhibits(before, after);
  assert.equal(d.station_inputs_delta.site_changed, true);
  assert.ok(d.station_inputs_delta.distance_moved_km > 50);
  assert.ok(d.station_inputs_delta.distance_moved_km < 60);
});

test('station_inputs_delta: site moves <0.05 km treated as no move', () => {
  const before = mkExhibit({ lat: 40.0, lon: -75.0 });
  const after  = mkExhibit({ lat: 40.0001, lon: -75.0 });  // ~11 m
  const d = diffExhibits(before, after);
  assert.equal(d.station_inputs_delta.site_changed, false);
  assert.ok(d.station_inputs_delta.distance_moved_km > 0);
});

test('station_inputs_delta: class + frequency + pattern_mode changes flagged', () => {
  const before = mkExhibit({ fcc_class: 'A', frequency: 100.7, pattern_mode: 'omni' });
  const after  = mkExhibit({ fcc_class: 'B', frequency: 100.5, pattern_mode: 'DA' });
  const d = diffExhibits(before, after);
  assert.equal(d.station_inputs_delta.fcc_class.changed, true);
  assert.equal(d.station_inputs_delta.frequency.changed, true);
  assert.equal(d.station_inputs_delta.pattern_mode.changed, true);
});

/* ---------- contour deltas ---------- */

test('contour_delta: shows mean radius + filed-area before/after/delta', () => {
  const before = mkExhibit({ contour_distances: { service_60dbu: 14, city_54dbu: 19, protected_40dbu: 41 } });
  const after  = mkExhibit({ contour_distances: { service_60dbu: 16, city_54dbu: 22, protected_40dbu: 47 } });
  const d = diffExhibits(before, after);
  const c = d.contour_delta.service_60dbu;
  assert.equal(c.before_mean_km, 14);
  assert.equal(c.after_mean_km, 16);
  assert.equal(c.delta_km, 2);
  assert.ok(Number.isFinite(c.before_area_km2));
  assert.ok(Number.isFinite(c.after_area_km2));
  assert.ok(c.delta_area_km2 > 0, 'area should grow when radius grows');
});

test('contour_delta: contour appearing only in after has before_present=false', () => {
  const before = mkExhibit({ contour_distances: { service_60dbu: 14 } });
  const after  = mkExhibit({ contour_distances: { service_60dbu: 14, protected_40dbu: 41 } });
  const d = diffExhibits(before, after);
  assert.equal(d.contour_delta.protected_40dbu.before_present, false);
  assert.equal(d.contour_delta.protected_40dbu.after_present,  true);
  assert.equal(d.contour_delta.protected_40dbu.delta_km, null);
});

/* ---------- interference deltas ---------- */

test('interference_delta: new violation added by after', () => {
  const before = mkExhibit({ filing_qualifies: true,  n_pass: 12, n_fail: 0, stations: [] });
  const after  = mkExhibit({ filing_qualifies: false, n_pass: 11, n_fail: 1, stations: [
    { call: 'WBLK', pair_pass: false }
  ]});
  const d = diffExhibits(before, after);
  assert.equal(d.interference_delta.before_qualifies, true);
  assert.equal(d.interference_delta.after_qualifies, false);
  assert.equal(d.interference_delta.delta_fail, 1);
  assert.deepEqual(d.interference_delta.new_violations, ['WBLK']);
  assert.deepEqual(d.interference_delta.cleared_violations, []);
});

test('interference_delta: cleared violation reflected', () => {
  const before = mkExhibit({ filing_qualifies: false, n_pass: 11, n_fail: 1, stations: [
    { call: 'WBLK', pair_pass: false }
  ]});
  const after  = mkExhibit({ filing_qualifies: true,  n_pass: 12, n_fail: 0, stations: [
    { call: 'WBLK', pair_pass: true }
  ]});
  const d = diffExhibits(before, after);
  assert.deepEqual(d.interference_delta.cleared_violations, ['WBLK']);
  assert.deepEqual(d.interference_delta.new_violations, []);
});

/* ---------- regulatory compliance deltas ---------- */

test('regulatory_compliance_delta: rule transitions surfaced', () => {
  const before = mkExhibit({ rules: {
    '47 CFR §73.207': { pass: true  },
    '47 CFR §73.215': { pass: false }
  }});
  const after = mkExhibit({ rules: {
    '47 CFR §73.207': { pass: false },
    '47 CFR §73.215': { pass: true  }
  }});
  const d = diffExhibits(before, after);
  assert.deepEqual(d.regulatory_compliance_delta.became_failing, ['47 CFR §73.207']);
  assert.deepEqual(d.regulatory_compliance_delta.became_passing, ['47 CFR §73.215']);
});

/* ---------- warning deltas ---------- */

test('warnings_delta: added / removed sets', () => {
  const before = mkExhibit({ warnings: [{ code: 'CURVE_VALIDATION_MISSING' }, { code: 'POPULATION_PLACEHOLDER' }] });
  const after  = mkExhibit({ warnings: [{ code: 'POPULATION_PLACEHOLDER' }, { code: 'TERRAIN_LOW_CONFIDENCE' }] });
  const d = diffExhibits(before, after);
  assert.deepEqual(d.warnings_delta.added,   ['TERRAIN_LOW_CONFIDENCE']);
  assert.deepEqual(d.warnings_delta.removed, ['CURVE_VALIDATION_MISSING']);
  assert.equal(d.warnings_delta.unchanged_count, 1);
});

/* ---------- summary headline + severity ---------- */

test('summary: severity=blocking when becomes_failing has a rule', () => {
  const before = mkExhibit({ rules: { '47 CFR §73.207': { pass: true } } });
  const after  = mkExhibit({ rules: { '47 CFR §73.207': { pass: false } } });
  const d = diffExhibits(before, after);
  assert.equal(d.summary.severity, 'blocking');
});

test('summary: severity=major when site/class/freq changed (without becoming-failing)', () => {
  const before = mkExhibit({ lat: 40.0 });
  const after  = mkExhibit({ lat: 41.0 });          // site moved
  const d = diffExhibits(before, after);
  assert.equal(d.summary.severity, 'major');
  assert.match(d.summary.headline, /site moved/);
});

test('summary: severity=minor when only ERP/HAAT nudged', () => {
  const before = mkExhibit({ erp_kw: 6, haat_m: 100 });
  const after  = mkExhibit({ erp_kw: 6.1, haat_m: 100 });
  const d = diffExhibits(before, after);
  assert.equal(d.summary.severity, 'minor');
});

/* ---------- identity ---------- */

test('identity.kept_same: true when same facility_id, false when different', () => {
  assert.equal(diffExhibits(mkExhibit({ facility_id: 1 }), mkExhibit({ facility_id: 1 })).identity.kept_same, true);
  assert.equal(diffExhibits(mkExhibit({ facility_id: 1 }), mkExhibit({ facility_id: 2 })).identity.kept_same, false);
});

/* ---------- provenance ---------- */

test('EXHIBIT_DIFF_PROVENANCE names the rules diffed', () => {
  assert.match(EXHIBIT_DIFF_PROVENANCE.regulation, /73\.207/);
  assert.match(EXHIBIT_DIFF_PROVENANCE.regulation, /73\.182/);
  assert.match(EXHIBIT_DIFF_PROVENANCE.license_basis, /17 USC §105/);
});
