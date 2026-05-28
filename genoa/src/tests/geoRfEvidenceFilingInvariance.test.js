import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFilingPackage } from '../exports/lmsFiling/packager.js';

// CONTRACT INVARIANT: adding evidence.geo_rf_evidence to an exhibit must
// NEVER change filing_ready, blockers_count, compliance_pass, OR the set
// of LMS fields produced.  Geo-RF evidence is advisory only; it surfaces
// as a top-level "advisory_notes" list and in plain-text "ADVISORY
// EVIDENCE" section — never as an LMS form field.

const BASE_EXHIBIT = Object.freeze({
  station_inputs: {
    call: 'WFAN',
    facility_id: '28617',
    service: 'AM',
    frequency: 660,
    erp_kw: 50,
    lat: 40.859833,
    lon: -73.785417
  },
  evidence: {}
});

const GEO_RF_RUN = {
  status: 'run',
  advisory: true,
  filing_effect: 'none',
  inputs: { lat: 40.859833, lon: -73.785417, service: 'AM', call: 'WFAN', facility_id: '28617' },
  datasets: {
    tree_canopy_conus: {
      available: true,
      dataset: 'science_tcc_CONUS_2022_v2023-5',
      value_raw: '35',
      value_numeric: 35,
      interpretation: 'moderate canopy / vegetation context'
    },
    tau_rf_models:    { available: true,  role: 'RF/environment statistical model artifact' },
    canada_landcover: { available: true,  role: 'available for Canadian coordinates / cross-border studies' }
  },
  fetched_at: '2026-05-16T17:00:00.000Z'
};

test('filing package: filing_ready identical with and without geo_rf_evidence', () => {
  const without = buildFilingPackage(BASE_EXHIBIT);
  const withGeo = buildFilingPackage({
    ...BASE_EXHIBIT,
    evidence: { ...BASE_EXHIBIT.evidence, geo_rf_evidence: GEO_RF_RUN }
  });
  assert.equal(without.filing_ready,    withGeo.filing_ready);
  assert.equal(without.blockers_count,  withGeo.blockers_count);
  assert.equal(without.compliance_pass, withGeo.compliance_pass);
});

test('filing package: LMS field set identical with and without geo_rf_evidence', () => {
  const without = JSON.parse(buildFilingPackage(BASE_EXHIBIT).json);
  const withGeo = JSON.parse(buildFilingPackage({
    ...BASE_EXHIBIT,
    evidence: { ...BASE_EXHIBIT.evidence, geo_rf_evidence: GEO_RF_RUN }
  }).json);
  // Compare the fields by id+status+value — the set must not change.
  const fp = (j) => j.fields.map(f => `${f.id}::${f.status}::${JSON.stringify(f.value)}`);
  assert.deepEqual(fp(without), fp(withGeo));
});

test('filing package: advisory_notes surfaces geo_rf_evidence with filing_effect="none"', () => {
  const withGeo = JSON.parse(buildFilingPackage({
    ...BASE_EXHIBIT,
    evidence: { ...BASE_EXHIBIT.evidence, geo_rf_evidence: GEO_RF_RUN }
  }).json);
  assert.ok(Array.isArray(withGeo.advisory_notes));
  const note = withGeo.advisory_notes.find(n => n.id === 'environmental_rf_evidence');
  assert.ok(note, 'environmental_rf_evidence note must be present');
  assert.equal(note.advisory, true);
  assert.equal(note.filing_effect, 'none');
  assert.equal(note.tree_canopy_value, 35);
  assert.equal(note.tree_canopy_dataset, 'science_tcc_CONUS_2022_v2023-5');
});

test('filing package: advisory_notes is empty when geo_rf_evidence absent', () => {
  const without = JSON.parse(buildFilingPackage(BASE_EXHIBIT).json);
  assert.ok(Array.isArray(without.advisory_notes));
  assert.equal(without.advisory_notes.find(n => n.id === 'environmental_rf_evidence'), undefined);
});

test('filing package: plain text contains ADVISORY EVIDENCE section when geo_rf present', () => {
  const withGeo = buildFilingPackage({
    ...BASE_EXHIBIT,
    evidence: { ...BASE_EXHIBIT.evidence, geo_rf_evidence: GEO_RF_RUN }
  });
  assert.match(withGeo.plain_text, /ADVISORY EVIDENCE/);
  assert.match(withGeo.plain_text, /Environmental RF Evidence/);
  assert.match(withGeo.plain_text, /Filing effect\s*:\s*NONE/);
  assert.match(withGeo.plain_text, /Tree canopy\s*:\s*35/);
});

test('filing package: plain text NEVER claims geo_rf is an LMS field', () => {
  const withGeo = buildFilingPackage({
    ...BASE_EXHIBIT,
    evidence: { ...BASE_EXHIBIT.evidence, geo_rf_evidence: GEO_RF_RUN }
  });
  // No "REQ" tag on any line that mentions Environmental RF.
  const envLines = withGeo.plain_text.split('\n').filter(l => /Environmental RF/i.test(l));
  for (const l of envLines){
    assert.ok(!l.includes('[REQ]'), `advisory note must never be marked [REQ]: ${l}`);
  }
});
