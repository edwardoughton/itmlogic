import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExhibit, FM_CLASS_A } from './_helpers.js';
import { exportJson }    from '../exports/json/exporter.js';
import { exportTxt }     from '../exports/txt/exporter.js';
import { exportGeoJson } from '../exports/geojson/exporter.js';
import { exportPdf, PDF_CONTENT_TYPE, PDF_PROVENANCE } from '../exports/pdf/exporter.js';

test('JSON export round-trips and validates', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const s = exportJson(x);
  const back = JSON.parse(s);
  assert.equal(back.schema.name, 'genoa.exhibit.v2');
  assert.equal(back.radial_table.length, x.radial_table.length);
});

test('TXT export contains required engineering sections', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const t = exportTxt(x);
  for (const section of [
    'GENOA — FCC PROPAGATION EXHIBIT',
    '-- STATION INPUTS --',
    '-- CALCULATION METHOD --',
    '-- CONTOUR RESULTS --',
    '-- RADIAL TABLE',
    '-- WARNINGS --',
    '-- FILING READINESS --',
    '-- VERSION BLOCK --',
    '-- REPRODUCIBILITY STATEMENT --',
    '-- ENGINEERING CERTIFICATION PLACEHOLDER --'
  ]){
    assert.ok(t.includes(section), 'TXT missing section ' + section);
  }
  assert.ok(t.includes(x.calculation_method.name), 'TXT must reference FCC method');
});

test('GeoJSON export is parseable and valid', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const g = JSON.parse(exportGeoJson(x));
  assert.equal(g.type, 'FeatureCollection');
  for (const f of g.features){
    assert.equal(f.type, 'Feature');
    const ring = f.geometry.coordinates[0];
    assert.deepEqual(ring[0], ring[ring.length - 1]);
  }
});

test('PDF export renders a valid PDF byte stream via @pdfme/generator', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const buf = await exportPdf(x);
  assert.ok(buf instanceof Uint8Array, 'expected Uint8Array');
  assert.ok(buf.byteLength > 1000, `expected non-trivial PDF, got ${buf.byteLength} bytes`);
  // PDF magic header bytes are %PDF (0x25 0x50 0x44 0x46)
  assert.equal(buf[0], 0x25);
  assert.equal(buf[1], 0x50);
  assert.equal(buf[2], 0x44);
  assert.equal(buf[3], 0x46);
});

test('PDF export Content-Type and provenance', () => {
  assert.equal(PDF_CONTENT_TYPE, 'application/pdf');
  assert.match(PDF_PROVENANCE.renderer, /pdfme/);
  assert.match(PDF_PROVENANCE.renderer_repo, /chelstein\/pdfme/);
});

test('PDF export rejects non-object input with structured error', async () => {
  let caught = null;
  try { await exportPdf(null); } catch (e){ caught = e; }
  assert.ok(caught, 'expected exportPdf(null) to throw');
  assert.equal(caught.code, 'INVALID_EXHIBIT');
  assert.equal(caught.http_status, 400);
});

test('PDF export handles a minimal exhibit (no warnings, no nearby_primaries)', async () => {
  const minimal = {
    exhibit_id: 'min',
    station_inputs: { call: 'TEST', service: 'FM', frequency: 100.7, frequency_unit: 'MHz', erp_kw: 1, haat_m: 30 },
    filing_readiness: { score: 100, status: 'ok' },
    method_versions: { curve_engine: 'fcc-canonical' },
    radial_table: [],
    warnings: []
  };
  const buf = await exportPdf(minimal);
  assert.ok(buf.byteLength > 500);
  assert.equal(buf[0], 0x25);   // %
});
