// Geo-RF filing-invariance (PART 2)
//
// CONTRACT INVARIANT: the NEW Geo-RF dataset slots
//
//   - tree_canopy
//   - landcover
//   - fcc_m3_conductivity_availability
//   - water_proximity
//   - climate_projection_availability
//   - sdr_residual_support
//
// plus the new top-level `map_marker`, `confidence_scoring_context`, and
// `residual_support` keys, MUST NEVER change filing readiness, blocker
// counts, compliance pass, or the LMS field set.  This is the regulatory-
// posture lock for the v2 envelope shape and is the companion to
// geoRfEvidenceFilingInvariance.test.js (v1 slots).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFilingPackage } from '../exports/lmsFiling/packager.js';
import {
  validateGeoRfEvidenceEnvelope,
  GEO_RF_DATASET_SLOTS,
  GEO_RF_EVIDENCE_SCHEMA,
  makeEmptyDatasetMap
} from '../types/geoRfEvidence.schema.js';

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

// Fully-populated v2 envelope — every new slot reports `available:true`
// and the optional sections (map_marker, confidence_scoring_context,
// residual_support) are present.  This is what the worst-case advisory
// payload looks like; if THIS doesn't change filing readiness, none of
// the partial shapes will either.
const GEO_RF_RUN_V2 = Object.freeze({
  status:        'run',
  advisory:      true,
  filing_effect: 'none',
  inputs: { lat: 40.859833, lon: -73.785417, service: 'AM', call: 'WFAN', facility_id: '28617' },
  datasets: {
    tree_canopy: {
      available:      true,
      dataset:        'science_tcc_CONUS_2022_v2023-5',
      value_raw:      '35',
      value_numeric:  35,
      interpretation: 'moderate canopy / vegetation context'
    },
    tree_canopy_conus: {
      available:      true,
      dataset:        'science_tcc_CONUS_2022_v2023-5',
      value_raw:      '35',
      value_numeric:  35,
      interpretation: 'moderate canopy / vegetation context'
    },
    landcover:                       { available: true,  role: 'NLCD / NRCan landcover' },
    tau_rf_models:                   { available: true,  role: 'RF/environment statistical model artifact' },
    fcc_m3_conductivity_availability:{ available: true,  role: 'FCC §73.190 Fig. M3 coverage indicator' },
    water_proximity:                 { available: true,  role: 'surface-water / coastal proximity' },
    climate_projection_availability: { available: true,  role: 'climate-projection raster availability' },
    sdr_residual_support:            { available: true,  role: 'observed-vs-predicted residual support' },
    canada_landcover:                { available: true,  role: 'cross-border landcover' }
  },
  map_marker: {
    lat: 40.859833, lon: -73.785417,
    label: 'Geo-RF Evidence (advisory)',
    popup_text: 'Tree canopy value: 35. Advisory environmental RF evidence only.'
  },
  confidence_scoring_context: {
    role: 'advisory_inputs_only',
    canopy_density: 35,
    canopy_interpretation: 'moderate canopy / vegetation context',
    contributes_to: ['observed_vs_predicted_residual_explanation',
                     'confidence_scoring_advisory_context'],
    filing_effect: 'none'
  },
  residual_support: {
    slot: 'sdr_residual_support',
    available: true,
    role: 'cross-references SDR observed-vs-predicted residuals (advisory context)',
    filing_effect: 'none'
  },
  notes: [
    'Environmental RF evidence is advisory only.',
    'Does not modify FCC filing-controlling contour or allocation calculations.'
  ],
  sidecar_service: 'genoa-geo-rf-evidence',
  fetched_at:      '2026-05-16T17:00:00.000Z'
});

/* ─────────────────────────── invariance ─────────────────────────── */

test('v2 envelope: filing_ready / blockers / compliance unchanged vs baseline', () => {
  const without = buildFilingPackage(BASE_EXHIBIT);
  const withGeo = buildFilingPackage({
    ...BASE_EXHIBIT,
    evidence: { ...BASE_EXHIBIT.evidence, geo_rf_evidence: GEO_RF_RUN_V2 }
  });
  assert.equal(without.filing_ready,    withGeo.filing_ready);
  assert.equal(without.blockers_count,  withGeo.blockers_count);
  assert.equal(without.compliance_pass, withGeo.compliance_pass);
});

test('v2 envelope: LMS field set byte-identical vs baseline', () => {
  const without = JSON.parse(buildFilingPackage(BASE_EXHIBIT).json);
  const withGeo = JSON.parse(buildFilingPackage({
    ...BASE_EXHIBIT,
    evidence: { ...BASE_EXHIBIT.evidence, geo_rf_evidence: GEO_RF_RUN_V2 }
  }).json);
  const fp = (j) => j.fields.map(f => `${f.id}::${f.status}::${JSON.stringify(f.value)}`);
  assert.deepEqual(fp(without), fp(withGeo));
});

test('v2 envelope: advisory_notes carries the geo_rf marker but no LMS field id', () => {
  const withGeo = JSON.parse(buildFilingPackage({
    ...BASE_EXHIBIT,
    evidence: { ...BASE_EXHIBIT.evidence, geo_rf_evidence: GEO_RF_RUN_V2 }
  }).json);
  assert.ok(Array.isArray(withGeo.advisory_notes));
  const note = withGeo.advisory_notes.find(n => n.id === 'environmental_rf_evidence');
  assert.ok(note, 'environmental_rf_evidence note must be present');
  assert.equal(note.filing_effect, 'none');
  // No advisory note may collide with an LMS field id.
  const fieldIds = new Set(withGeo.fields.map(f => f.id));
  for (const n of withGeo.advisory_notes){
    assert.ok(!fieldIds.has(n.id),
      `advisory note id "${n.id}" must NOT collide with an LMS field id`);
  }
});

test('v2 envelope: each slot toggled individually still preserves filing_ready', () => {
  const base = buildFilingPackage(BASE_EXHIBIT);
  for (const slot of GEO_RF_DATASET_SLOTS){
    // Build an envelope where ONLY this slot is available (every other
    // slot reports false).  If filing readiness flips, the slot leaked
    // into LMS — that's the regression we're guarding against.
    const datasets = makeEmptyDatasetMap();
    datasets[slot] = { available: true, role: 'unit test toggle' };
    const env = {
      status: 'run', advisory: true, filing_effect: 'none',
      inputs: GEO_RF_RUN_V2.inputs,
      datasets,
      notes: ['advisory'],
      fetched_at: '2026-05-16T17:00:00.000Z'
    };
    const pkg = buildFilingPackage({
      ...BASE_EXHIBIT,
      evidence: { ...BASE_EXHIBIT.evidence, geo_rf_evidence: env }
    });
    assert.equal(pkg.filing_ready,    base.filing_ready,    `slot ${slot} flipped filing_ready`);
    assert.equal(pkg.blockers_count,  base.blockers_count,  `slot ${slot} flipped blockers_count`);
    assert.equal(pkg.compliance_pass, base.compliance_pass, `slot ${slot} flipped compliance_pass`);
  }
});

test('v2 envelope: map_marker is present and never carries filing-controlling keys', () => {
  const m = GEO_RF_RUN_V2.map_marker;
  assert.equal(typeof m.lat, 'number');
  assert.equal(typeof m.lon, 'number');
  assert.equal(typeof m.label, 'string');
  assert.match(m.popup_text, /Tree canopy value/);
  assert.match(m.popup_text, /Advisory environmental RF evidence only/);
  // map_marker must NOT carry any filing-controlling field.
  const forbidden = ['contour_distance_km', 'permitted_erp_kw', 'compliance_pass', 'filing_ready'];
  for (const k of forbidden){
    assert.equal(m[k], undefined, `map_marker must not carry "${k}"`);
  }
});

/* ─────────────────────────── schema validator ─────────────────────────── */

test('schema validator: accepts the canonical v2 envelope', () => {
  const r = validateGeoRfEvidenceEnvelope(GEO_RF_RUN_V2);
  assert.equal(r.ok, true, `expected ok=true, got errors: ${r.errors.join('; ')}`);
  assert.deepEqual(r.errors, []);
});

test('schema validator: rejects envelopes that try to flip filing_effect', () => {
  const bad = { ...GEO_RF_RUN_V2, filing_effect: 'allows' };
  const r = validateGeoRfEvidenceEnvelope(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /filing_effect.*none/.test(e)));
});

test('schema validator: rejects envelopes that smuggle filing-controlling keys', () => {
  const bad = { ...GEO_RF_RUN_V2, filing_ready: true };
  const r = validateGeoRfEvidenceEnvelope(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /filing-controlling/.test(e)));
});

test('schema validator: rejects non-boolean dataset.available', () => {
  const bad = {
    ...GEO_RF_RUN_V2,
    datasets: { ...GEO_RF_RUN_V2.datasets, tree_canopy: { available: 'yes' } }
  };
  const r = validateGeoRfEvidenceEnvelope(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /datasets\.tree_canopy\.available/.test(e)));
});

test('schema validator: rejects malformed map_marker', () => {
  const bad = {
    ...GEO_RF_RUN_V2,
    map_marker: { lat: 40, lon: -74 }    // missing label / popup_text
  };
  const r = validateGeoRfEvidenceEnvelope(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /map_marker\.label/.test(e)));
  assert.ok(r.errors.some(e => /map_marker\.popup_text/.test(e)));
});

test('schema validator: rejects unknown status', () => {
  const bad = { ...GEO_RF_RUN_V2, status: 'maybe' };
  const r = validateGeoRfEvidenceEnvelope(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some(e => /status must be one of/.test(e)));
});

test('schema constant: ID + version pinned and advisory-only', () => {
  assert.equal(GEO_RF_EVIDENCE_SCHEMA.$id, 'genoa.geo_rf_evidence.envelope.v2');
  assert.equal(GEO_RF_EVIDENCE_SCHEMA.version, 2);
  assert.equal(GEO_RF_EVIDENCE_SCHEMA.advisory_only, true);
  assert.equal(GEO_RF_EVIDENCE_SCHEMA.filing_effect, 'none');
  // All NEW slots required by mission must be in the canonical list.
  for (const required of [
    'tree_canopy', 'landcover', 'tau_rf_models',
    'fcc_m3_conductivity_availability', 'water_proximity',
    'climate_projection_availability', 'sdr_residual_support'
  ]){
    assert.ok(GEO_RF_DATASET_SLOTS.includes(required),
      `canonical slot list missing required slot "${required}"`);
  }
});

test('makeEmptyDatasetMap: every slot present and marked unavailable', () => {
  const m = makeEmptyDatasetMap();
  for (const slot of GEO_RF_DATASET_SLOTS){
    assert.ok(slot in m, `missing slot ${slot}`);
    assert.equal(m[slot].available, false);
  }
});
