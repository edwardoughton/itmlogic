// SDR Observability — advisory per-capture engineering-report section.
//
// Tests:
//   1) section returns null when no captures attached
//   2) advisory mode (no residuals): heading is ADVISORY, paragraph says
//      "no calibrated residual model applied"
//   3) calibrated mode (residual rows attached): heading flips to
//      OBSERVED VS PREDICTED, residual columns populated, band classified
//   4) ADVISORY badge for uncalibrated rows; CERTIFIED for calibrated
//   5) audio_url derived from capture id when not explicitly set
//   6) INVARIANCE proof: attaching the capture set does NOT mutate
//      radial_table or contour_definitions across the whole report
//      pipeline (the core acceptance criterion)
//   7) schema normalizer round-trip
//   8) schema validator: residual fields must travel as a pair

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSdrObservabilitySection } from '../exports/engineeringReport/sections/sdrObservability.js';
import { buildEngineeringReport }         from '../exports/engineeringReport/index.js';
import {
  normalizeCapture,
  validateCaptureRow,
  classifyResidualBand,
  SDR_EVIDENCE_SCHEMA_NAME
} from '../types/sdrEvidence.schema.js';

// ----- fixtures -----

const BASE_EXHIBIT = {
  station_inputs: { call: 'KRDM', facility_id: '129314', service: 'AM' },
  method_versions: { engine_version: 'genoa-2.0' },
  contour_definitions: [
    { contour_id: 'city_5mvm', field_strength: { value: 5, unit: 'mV/m' } }
  ],
  radial_table: [
    { az_deg:   0, contour_distances_km: { city_5mvm: 10.83 } },
    { az_deg:  90, contour_distances_km: { city_5mvm:  9.41 } },
    { az_deg: 180, contour_distances_km: { city_5mvm: 11.02 } },
    { az_deg: 270, contour_distances_km: { city_5mvm:  8.97 } }
  ],
  polygons: [{
    contour_id: 'city_5mvm',
    label: '5 mV/m (city grade)',
    field_strength: { value: 5, unit: 'mV/m' },
    area_km2: 367, mean_radial_km: 10.8,
    closed: true,
    ring_latlng: [[44.25, -121.20], [44.35, -121.30], [44.30, -121.10]]
  }]
};

function fixtureCaptures(){
  return [
    {
      id: '71268', station_callsign: 'KRDM',
      frequency_khz: 1240, service_type: 'am', mode: 'am',
      capture_purpose: 'manual_check', status: 'succeeded',
      created_at: '2026-05-10T19:37:00.272Z',
      confidence_band: 'high', confidence_score: 90,
      lat: 44.28, lon: -121.16
    },
    {
      id: '71106',
      frequency_khz: 1240, mode: 'am',
      capture_purpose: 'eas_validation', status: 'succeeded',
      created_at: '2026-05-10T18:00:00.000Z'
    }
  ];
}

// ----- tests -----

test('returns null when no captures attached', () => {
  assert.equal(buildSdrObservabilitySection({ ...BASE_EXHIBIT }), null);
  assert.equal(buildSdrObservabilitySection({
    ...BASE_EXHIBIT,
    evidence: { measurements: { available: true, records: [] } }
  }), null);
  // explicit opt-out
  assert.equal(buildSdrObservabilitySection({
    ...BASE_EXHIBIT,
    evidence: { measurements: { available: false, records: [{ id: 'x' }] } }
  }), null);
});

test('advisory mode: heading + advisory paragraph + ADVISORY badge', () => {
  const ex = {
    ...BASE_EXHIBIT,
    evidence: { measurements: { available: true, records: fixtureCaptures() } }
  };
  const sec = buildSdrObservabilitySection(ex);
  assert.ok(sec, 'section should be returned');
  assert.equal(sec.id, 'sdr-observability');
  assert.equal(sec.heading, 'SDR OBSERVABILITY — ADVISORY');
  assert.equal(sec.advisory, true);
  assert.match(sec.paragraphs[0], /no calibrated residual model applied/i);
  assert.equal(sec.table.rows.length, 2);
  // Both rows ADVISORY
  for (const r of sec.table.rows){
    assert.equal(r.badge, 'ADVISORY');
    assert.equal(r.observed_vs_predicted_db, '—');
    assert.equal(r.residual_band, '—');
    // audio URL derived from id
    assert.match(r.audio_url, /^\/api\/captures\/\d+\/audio$/);
  }
});

test('calibrated mode: residual rows flip heading, populate columns, CERTIFIED badge', () => {
  const ex = {
    ...BASE_EXHIBIT,
    evidence: {
      measurements: { available: true, records: fixtureCaptures() },
      sdr_residuals: {
        rows: [
          // 71268: within band
          { capture_id: '71268', delta_db: 3.4, calibration_applied: true },
          // 71106: significant band
          { capture_id: '71106', delta_db: -12.7, calibration_applied: true }
        ]
      }
    }
  };
  const sec = buildSdrObservabilitySection(ex);
  assert.ok(sec);
  assert.equal(sec.heading, 'SDR OBSERVABILITY — OBSERVED VS PREDICTED');
  assert.equal(sec.advisory, false);

  const byId = new Map(sec.table.rows.map(r => [r.id, r]));
  const r1 = byId.get('71268');
  const r2 = byId.get('71106');
  assert.ok(r1 && r2, 'both rows should be present');

  assert.equal(r1.observed_vs_predicted_db, '+3.4');
  assert.equal(r1.residual_band, 'within');
  assert.equal(r1.badge, 'CERTIFIED');

  assert.equal(r2.observed_vs_predicted_db, '-12.7');
  assert.equal(r2.residual_band, 'significant');
  assert.equal(r2.badge, 'CERTIFIED');
});

test('residual band classifier: within < 6 < moderate <= 10 < significant', () => {
  assert.equal(classifyResidualBand(0),    'within');
  assert.equal(classifyResidualBand(5.9),  'within');
  assert.equal(classifyResidualBand(-6),   'moderate');
  assert.equal(classifyResidualBand(10),   'moderate');
  assert.equal(classifyResidualBand(10.1), 'significant');
  assert.equal(classifyResidualBand(NaN),  null);
});

test('schema normalizer: produces canonical row shape', () => {
  const raw = fixtureCaptures()[0];
  const row = normalizeCapture(raw);
  assert.equal(row.capture_id, '71268');
  assert.equal(row.frequency.value, 1240);
  assert.equal(row.frequency.unit,  'kHz');
  assert.equal(row.mode, 'AM');
  assert.equal(row.advisory, true);
  assert.equal(row.audio_url, '/api/captures/71268/audio');
  assert.equal(row.audio_available, true);
  assert.ok(!('residual_db_observed_vs_predicted' in row),
    'residual fields absent when no residual passed');
  // validate
  const v = validateCaptureRow(row);
  assert.equal(v.valid, true, JSON.stringify(v.errors));
});

test('schema normalizer: surfaces residual fields when calibrated delta provided', () => {
  const raw = fixtureCaptures()[0];
  const row = normalizeCapture(raw, { residual: { delta_db: 4.21 } });
  assert.equal(row.residual_db_observed_vs_predicted, 4.21);
  assert.equal(row.residual_band, 'within');
  assert.equal(validateCaptureRow(row).valid, true);
});

test('schema validator: residual_db and residual_band must travel together', () => {
  const partial = {
    capture_id: '1', receiver: {}, timestamp_utc: null,
    frequency: null, mode: null, purpose: null, status: null,
    audio_available: false, audio_url: null, confidence: { band: null, score: null },
    distance_km: null, advisory: true,
    residual_db_observed_vs_predicted: 3.0
    // missing residual_band
  };
  const v = validateCaptureRow(partial);
  assert.equal(v.valid, false);
  assert.match(v.errors.join('|'), /must be set together/);
});

// ----- the ACCEPTANCE invariance test -----

test('INVARIANCE: capture set on/off does not mutate radial_table or contour_definitions', () => {
  const without = JSON.parse(JSON.stringify(BASE_EXHIBIT));
  const withCaps = JSON.parse(JSON.stringify({
    ...BASE_EXHIBIT,
    evidence: {
      measurements: { available: true, records: fixtureCaptures() },
      sdr_residuals: {
        rows: [
          { capture_id: '71268', delta_db: 3.4, calibration_applied: true },
          { capture_id: '71106', delta_db: -12.7, calibration_applied: true }
        ]
      }
    }
  }));

  // Snapshot before report build.
  const radialBefore_without  = JSON.stringify(without.radial_table);
  const contourBefore_without = JSON.stringify(without.contour_definitions);
  const radialBefore_with     = JSON.stringify(withCaps.radial_table);
  const contourBefore_with    = JSON.stringify(withCaps.contour_definitions);

  // The two exhibits start with byte-identical radial/contour blocks.
  assert.equal(radialBefore_without,  radialBefore_with,
    'fixtures must start with identical radial_table');
  assert.equal(contourBefore_without, contourBefore_with,
    'fixtures must start with identical contour_definitions');

  // Build both reports.
  const docWithout = buildEngineeringReport(without,  {});
  const docWith    = buildEngineeringReport(withCaps, {});

  // After build: radial + contour blocks unchanged in BOTH exhibits.
  assert.equal(JSON.stringify(without.radial_table),  radialBefore_without,
    'radial_table mutated by report builder on no-caps exhibit');
  assert.equal(JSON.stringify(without.contour_definitions), contourBefore_without,
    'contour_definitions mutated on no-caps exhibit');
  assert.equal(JSON.stringify(withCaps.radial_table), radialBefore_with,
    'radial_table mutated on with-caps exhibit');
  assert.equal(JSON.stringify(withCaps.contour_definitions), contourBefore_with,
    'contour_definitions mutated on with-caps exhibit');

  // CORE invariance: byte-identical radial + contour blocks regardless of caps.
  assert.equal(JSON.stringify(without.radial_table),
               JSON.stringify(withCaps.radial_table),
               'radial_table differs between with-caps / without-caps');
  assert.equal(JSON.stringify(without.contour_definitions),
               JSON.stringify(withCaps.contour_definitions),
               'contour_definitions differs between with-caps / without-caps');

  // Sanity: the SDR observability section appears only on the with-caps doc.
  const idsWithout = docWithout.sections.map(s => s.id);
  const idsWith    = docWith.sections.map(s => s.id);
  assert.equal(idsWithout.includes('sdr-observability'), false);
  assert.equal(idsWith.includes('sdr-observability'),     true);
});

test('schema name + version are pinned (replay-determinism)', () => {
  assert.equal(SDR_EVIDENCE_SCHEMA_NAME, 'genoa.sdrEvidence.v1');
});
