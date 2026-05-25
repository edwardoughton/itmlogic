// Unit tests for the engineering-report Measurements section.
//
// Covers:
//   - null when evidence.measurements is absent / empty
//   - null when records[] is empty
//   - rows + provenance footnote when captures are attached
//   - audio URL derivation from id when audio_url isn't on the record
//   - timestamp formatting + uppercase mode
//   - integration: buildEngineeringReport places the section between
//     engineering-interpretation and contour-results

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildMeasurementsSection } from '../exports/engineeringReport/sections/measurements.js';
import { buildEngineeringReport }    from '../exports/engineeringReport/index.js';

const KRDM_BASE = {
  station_inputs: { call: 'KRDM', facility_id: '129314', service: 'AM' },
  method_versions: { engine_version: 'genoa-2.0' },
  polygons: [],
  radial_table: []
};

test('returns null when evidence.measurements is absent', () => {
  assert.equal(buildMeasurementsSection({ ...KRDM_BASE }), null);
});

test('returns null when evidence.measurements.available is false', () => {
  const ex = { ...KRDM_BASE, evidence: { measurements: { available: false, records: [] } } };
  assert.equal(buildMeasurementsSection(ex), null);
});

test('returns null when records[] is empty', () => {
  const ex = { ...KRDM_BASE, evidence: { measurements: { available: true, records: [] } } };
  assert.equal(buildMeasurementsSection(ex), null);
});

test('builds a section with rows when captures are attached', () => {
  const ex = {
    ...KRDM_BASE,
    evidence: {
      measurements: {
        available: true,
        source: 'zerotrustradio',
        captures_field: 'ztr-sdr-captures-by-call',
        lookup_strategy: 'callsign-filter',
        n_records: 2,
        calibrated: false,
        records: [
          {
            id: '71268',
            station_callsign: 'KRDM',
            frequency_khz: 1240,
            service_type: 'am',
            mode: 'am',
            capture_purpose: 'manual_check',
            status: 'succeeded',
            created_at: '2026-05-10T19:37:00.272Z',
            confidence_band: 'high',
            confidence_score: 90
          },
          {
            id: '71106',
            station_callsign: 'KRDM',
            frequency_khz: 1240,
            service_type: 'am',
            mode: 'am',
            capture_purpose: 'manual_check',
            status: 'succeeded',
            created_at: '2026-05-10T18:00:00.000Z'
          }
        ]
      }
    }
  };

  const sec = buildMeasurementsSection(ex);
  assert.ok(sec, 'section should be returned');
  assert.equal(sec.id,      'measurements');
  assert.equal(sec.type,    'table');
  assert.equal(sec.heading, 'MEASUREMENTS — SDR CAPTURES');
  assert.equal(sec.table.rows.length, 2);

  const r0 = sec.table.rows[0];
  assert.equal(r0.id,        '71268');
  assert.equal(r0.frequency, '1240 kHz');
  assert.equal(r0.mode,      'AM');
  assert.equal(r0.purpose,   'manual_check');
  assert.equal(r0.status,    'succeeded');
  assert.equal(r0.confidence, 'high (90)');
  assert.equal(r0.audio_url, '/api/captures/71268/audio');
  assert.match(r0.captured_at, /^2026-05-10 19:37Z$/);

  // Second record has no confidence_* fields
  assert.equal(sec.table.rows[1].confidence, '—');

  // Footnote names the provenance.
  assert.match(sec.footnote, /zerotrustradio/);
  assert.match(sec.footnote, /ztr-sdr-captures-by-call/);
  assert.match(sec.footnote, /callsign-filter/);
  assert.match(sec.footnote, /2 records/);
  assert.match(sec.footnote, /uncalibrated/);
});

test('honors explicit audio_url over the derived /api/captures/<id>/audio', () => {
  const ex = {
    ...KRDM_BASE,
    evidence: {
      measurements: {
        available: true,
        records: [{ id: '99', audio_url: 'https://example.com/custom/path.wav' }]
      }
    }
  };
  const sec = buildMeasurementsSection(ex);
  assert.equal(sec.table.rows[0].audio_url, 'https://example.com/custom/path.wav');
});

test('falls back to ztr_capture_id when id is missing', () => {
  const ex = {
    ...KRDM_BASE,
    evidence: {
      measurements: {
        available: true,
        records: [{ ztr_capture_id: '54321', frequency_khz: 1240 }]
      }
    }
  };
  const sec = buildMeasurementsSection(ex);
  assert.equal(sec.table.rows[0].id,        '54321');
  assert.equal(sec.table.rows[0].audio_url, '/api/captures/54321/audio');
});

test('integration: buildEngineeringReport places measurements between interpretation and contour-results', () => {
  const ex = {
    ...KRDM_BASE,
    polygons: [{ contour_id: 'city_5mvm', label: '5 mV/m (city grade)',
                 field_strength: { value: 5, unit: 'mV/m' }, area_km2: 367, mean_radial_km: 10.8,
                 closed: true, ring_latlng: [[44, -121], [44.1, -121.1]] }],
    radial_table: [{ az_deg: 0, contour_distances_km: { city_5mvm: 10.83 } }],
    evidence: {
      measurements: {
        available: true,
        source: 'zerotrustradio',
        n_records: 1,
        records: [{ id: '71268', frequency_khz: 1240, mode: 'am', status: 'succeeded' }]
      }
    }
  };

  const doc = buildEngineeringReport(ex, {});
  const ids = doc.sections.map((s) => s.id);
  const interpIdx = ids.indexOf('engineering-interpretation');
  const measIdx   = ids.indexOf('measurements');
  const resultsIdx = ids.indexOf('contour-results');

  // engineering-interpretation may or may not be present depending on residual_interpretation
  // (it's not on this fixture).  But measurements must appear, and must come before contour-results.
  assert.ok(measIdx >= 0,    'measurements section should be present');
  assert.ok(resultsIdx >= 0, 'contour-results section should be present');
  assert.ok(measIdx < resultsIdx, 'measurements should be ordered before contour-results');
  // If interpretation IS there, measurements should follow it directly.
  if (interpIdx >= 0){
    assert.equal(measIdx, interpIdx + 1, 'measurements should immediately follow interpretation');
  }
});
