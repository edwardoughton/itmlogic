import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAppendixSections } from '../exports/engineeringReport/sections/appendices.js';

const BASE_EXHIBIT = {
  station_inputs: { service: 'AM', call: 'WTST', frequency: 700, erp_kw: 50, fcc_class: 'B' },
  radial_table:   [],
  interference_study: null,
  validation_context: {},
  method_versions:    {},
  evidence:           {},
  engine_signature:   {}
};

function getAppendix(sections, id){
  return sections.find((s) => s.id === id) || null;
}

test('Appendix F is omitted for FM exhibits', () => {
  const exhibit = {
    ...BASE_EXHIBIT,
    station_inputs: { ...BASE_EXHIBIT.station_inputs, service: 'FM', frequency: 89.1 },
    evidence: {
      am_night_nif: {
        available: true,
        summary: { n_azimuths: 4, mean_radius_km: 100 },
        contour: [], interferers: []
      }
    }
  };
  const sections = buildAppendixSections(exhibit);
  assert.equal(getAppendix(sections, 'appendix-f'), null);
});

test('Appendix F omitted when AM exhibit has no am_night_nif evidence', () => {
  const sections = buildAppendixSections(BASE_EXHIBIT);
  assert.equal(getAppendix(sections, 'appendix-f'), null);
});

test('Appendix F renders NOT RUN block when available:false', () => {
  const exhibit = {
    ...BASE_EXHIBIT,
    evidence: { am_night_nif: { available: false, error: 'FCCAM sidecar not configured' } }
  };
  const sections = buildAppendixSections(exhibit);
  const f = getAppendix(sections, 'appendix-f');
  assert.ok(f, 'expected appendix-f');
  assert.match(f.heading, /§73\.182/);
  const flat = JSON.stringify(f.rows);
  assert.match(flat, /NOT RUN/);
  assert.match(flat, /FCCAM/);
});

test('Appendix F renders summary KV + per-azimuth table + interferer table', () => {
  const exhibit = {
    ...BASE_EXHIBIT,
    evidence: {
      am_night_nif: {
        available: true,
        source: 'fccam',
        fetched_at: '2026-05-16T01:23:45Z',
        regulation: '47 CFR §73.182 / §73.183 / §73.190(c)',
        summary: {
          n_azimuths: 4,
          n_failing_azimuths: 1,
          n_no_service_azimuths: 0,
          n_unbounded_azimuths: 0,
          mean_radius_km: 215.5,
          min_radius_km: 50.1,
          max_radius_km: 400.9,
          worst_margin_db: -2.5,
          n_interferers_used: 3,
          n_interferers_seen: 8,
          interferer_cap: 25
        },
        du_db_by_relation: { co_channel: 20, first_adjacent: 0, second_adjacent: -26 },
        contour: [
          { azimuth_deg: 0,   distance_km: 400.9, lat: 43.61, lon: -75,    binding: { relation: 'co_channel', margin_db: 1.2 }, iterations: 8 },
          { azimuth_deg: 90,  distance_km: 200.0, lat: 40,    lon: -72.65, binding: { relation: 'co_channel', margin_db: 0.4 }, iterations: 10 },
          { azimuth_deg: 180, distance_km:  50.1, lat: 39.55, lon: -75,    binding: { relation: 'co_channel', margin_db: -2.5 }, iterations: 12 },
          { azimuth_deg: 270, distance_km: 210.2, lat: 40,    lon: -77.35, binding: { relation: 'co_channel', margin_db: 0.8 }, iterations: 9 }
        ],
        interferers: [
          { call: 'WXYZ', station_id: '12345', fcc_class: 'B', freq_khz: 700, erp_kw: 50, distance_km: 600.0, relation: 'co_channel' },
          { call: 'WTST', station_id: '54321', fcc_class: 'A', freq_khz: 700, erp_kw: 50_000, distance_km: 1200.5, relation: 'co_channel' }
        ],
        interferer_cap_applied: false,
        provenance: { upstream_skywave: 'FCCAM (Fccam.for / Wang 1985)' }
      }
    }
  };
  const sections = buildAppendixSections(exhibit);

  const summary = getAppendix(sections, 'appendix-f');
  assert.ok(summary, 'expected appendix-f summary block');
  assert.equal(summary.type, 'kv');
  const summaryFlat = JSON.stringify(summary.rows);
  assert.match(summaryFlat, /215\.5 km/);     // mean radius
  assert.match(summaryFlat, /-2\.50 dB/);     // worst margin
  assert.match(summaryFlat, /Fccam\.for/);    // upstream engine
  assert.match(summaryFlat, /20.*Co-channel|co_channel.*20/i);  // D/U row format-agnostic

  const azTable = getAppendix(sections, 'appendix-f-azimuths');
  assert.ok(azTable, 'expected per-azimuth table');
  assert.equal(azTable.type, 'table');
  assert.equal(azTable.table.rows.length, 4);
  // Failing row at 180° flagged with negative margin.
  const failRow = azTable.table.rows.find((r) => r.az === '180.0');
  assert.match(failRow.binding, /co_channel.*-2\.5/);

  const intTable = getAppendix(sections, 'appendix-f-interferers');
  assert.ok(intTable, 'expected interferer table');
  assert.equal(intTable.table.rows.length, 2);
  assert.equal(intTable.table.rows[0].call, 'WXYZ');
  assert.equal(intTable.table.rows[1].erp_kw, '50000.00');
});

test('Appendix F omits per-azimuth / interferer tables when arrays empty', () => {
  const exhibit = {
    ...BASE_EXHIBIT,
    evidence: {
      am_night_nif: {
        available: true,
        summary: { n_azimuths: 0 },
        contour: [],
        interferers: []
      }
    }
  };
  const sections = buildAppendixSections(exhibit);
  assert.ok(getAppendix(sections, 'appendix-f'), 'summary block still emitted');
  assert.equal(getAppendix(sections, 'appendix-f-azimuths'), null);
  assert.equal(getAppendix(sections, 'appendix-f-interferers'), null);
});
