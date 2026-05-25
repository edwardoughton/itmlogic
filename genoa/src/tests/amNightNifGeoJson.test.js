import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAmNightNifGeoJson,
  serializeAmNightNifGeoJson,
  GEOJSON_CONTENT_TYPE,
  AM_NIGHT_NIF_GEOJSON_PROVENANCE
} from '../exports/geojson/amNightNif.js';

const PROPOSED = { lat: 40.0, lon: -75.0, freq_khz: 700, erp_kw: 50,
                   fcc_class: 'B', call: 'WTST', facility_id: 1234 };

const FULL_NIF = {
  available: true,
  source: 'fccam',
  fetched_at: '2026-05-16T00:00:00Z',
  regulation: '47 CFR §73.182',
  proposed: PROPOSED,
  summary: {
    n_azimuths: 4, n_failing_azimuths: 1, n_no_service_azimuths: 0,
    mean_radius_km: 200, min_radius_km: 50, max_radius_km: 350,
    worst_margin_db: -2.0, n_interferers_used: 2
  },
  contour: [
    { azimuth_deg: 0,   distance_km: 350, lat: 43.15, lon: -75,    binding: { relation: 'co_channel', margin_db: 1.5, pass: true } },
    { azimuth_deg: 90,  distance_km: 200, lat: 40,    lon: -72.65, binding: { relation: 'co_channel', margin_db: 0.4, pass: true } },
    { azimuth_deg: 180, distance_km: 50,  lat: 39.55, lon: -75,    binding: { relation: 'co_channel', margin_db: -2.0, pass: false } },
    { azimuth_deg: 270, distance_km: 200, lat: 40,    lon: -77.35, binding: { relation: 'co_channel', margin_db: 0.8, pass: true } }
  ],
  polygon: [
    { lat: 43.15, lon: -75 },
    { lat: 40,    lon: -72.65 },
    { lat: 39.55, lon: -75 },
    { lat: 40,    lon: -77.35 },
    { lat: 43.15, lon: -75 }   // already closed
  ],
  interferers: [
    { call: 'WBLK', station_id: 9001, fcc_class: 'B', freq_khz: 700, erp_kw: 50,
      lat: 40, lon: -82, relation: 'co_channel', distance_km: 600 },
    { call: 'WTOY', station_id: 9002, fcc_class: 'A', freq_khz: 700, erp_kw: 50_000,
      lat: 41, lon: -76, relation: 'co_channel', distance_km: 100 }
  ]
};

function mkExhibit(nif){
  return { station_inputs: PROPOSED, evidence: nif === undefined ? {} : { am_night_nif: nif } };
}

/* ---------- input guards ---------- */

test('buildAmNightNifGeoJson: rejects missing exhibit', () => {
  assert.equal(buildAmNightNifGeoJson(null).ok, false);
});

test('buildAmNightNifGeoJson: 404-style error when exhibit has no am_night_nif', () => {
  const r = buildAmNightNifGeoJson(mkExhibit(undefined));
  assert.equal(r.ok, false);
  assert.match(r.error, /am_night_nif/);
});

test('buildAmNightNifGeoJson: surfaces orchestrator-level error verbatim', () => {
  const r = buildAmNightNifGeoJson(mkExhibit({ available: false, error: 'FCCAM not configured' }));
  assert.equal(r.ok, false);
  assert.equal(r.error, 'FCCAM not configured');
});

test('buildAmNightNifGeoJson: rejects when proposed lacks lat/lon', () => {
  const r = buildAmNightNifGeoJson(mkExhibit({
    ...FULL_NIF, proposed: { ...PROPOSED, lat: NaN }
  }));
  assert.equal(r.ok, false);
  assert.match(r.error, /lat\/lon/);
});

/* ---------- shape ---------- */

test('FeatureCollection: type, bbox, top-level properties', () => {
  const r = buildAmNightNifGeoJson(mkExhibit(FULL_NIF));
  assert.equal(r.ok, true);
  const fc = r.features;
  assert.equal(fc.type, 'FeatureCollection');
  assert.ok(Array.isArray(fc.bbox));
  assert.equal(fc.bbox.length, 4);
  assert.match(fc.properties.regulation, /73\.182/);
  assert.match(fc.properties.license_basis, /17 USC §105/);
});

test('Polygon feature: closed ring, properties from summary', () => {
  const r = buildAmNightNifGeoJson(mkExhibit(FULL_NIF));
  const poly = r.features.features.find((f) => f.properties.kind === 'nif_contour');
  assert.ok(poly, 'polygon feature should exist');
  assert.equal(poly.geometry.type, 'Polygon');
  const ring = poly.geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1], 'ring must be closed');
  assert.equal(poly.properties.proposed_call, 'WTST');
  assert.equal(poly.properties.n_failing_azimuths, 1);
  assert.equal(poly.properties.mean_radius_km, 200);
});

test('Polygon ring auto-closes when input polygon is open', () => {
  const r = buildAmNightNifGeoJson(mkExhibit({
    ...FULL_NIF,
    polygon: FULL_NIF.polygon.slice(0, -1)  // strip the closing vertex
  }));
  const poly = r.features.features.find((f) => f.properties.kind === 'nif_contour');
  const ring = poly.geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1]);
});

test('Proposed-station Point feature carries pattern_mode', () => {
  const r = buildAmNightNifGeoJson(mkExhibit({
    ...FULL_NIF, proposed: { ...PROPOSED, pattern_table: { 0: 1, 180: 0.1 } }
  }));
  const stn = r.features.features.find((f) => f.properties.kind === 'proposed_station');
  assert.ok(stn);
  assert.equal(stn.geometry.type, 'Point');
  assert.equal(stn.properties.pattern_mode, 'DA');
});

test('Interferer Point features include relation + class + freq', () => {
  const r = buildAmNightNifGeoJson(mkExhibit(FULL_NIF));
  const interferers = r.features.features.filter((f) => f.properties.kind === 'interferer');
  assert.equal(interferers.length, 2);
  const wblk = interferers.find((f) => f.properties.call === 'WBLK');
  assert.equal(wblk.properties.relation, 'co_channel');
  assert.equal(wblk.properties.fcc_class, 'B');
  assert.equal(wblk.properties.freq_khz, 700);
});

test('Failing-azimuth radial: one LineString per failing pass=false sample', () => {
  const r = buildAmNightNifGeoJson(mkExhibit(FULL_NIF));
  const lines = r.features.features.filter((f) => f.properties.kind === 'failing_radial');
  assert.equal(lines.length, 1, 'only the 180° azimuth had pass:false');
  assert.equal(lines[0].properties.azimuth_deg, 180);
  assert.equal(lines[0].properties.binding_relation, 'co_channel');
  assert.equal(lines[0].properties.margin_db, -2);
  // LineString starts at proposed, ends at the boundary point.
  assert.deepEqual(lines[0].geometry.coordinates[0], [-75, 40]);
});

test('saturated:no_service azimuths produce a failing_radial too', () => {
  const r = buildAmNightNifGeoJson(mkExhibit({
    ...FULL_NIF,
    contour: [
      { azimuth_deg: 0, distance_km: 0, lat: 40, lon: -75, saturated: 'no_service' }
    ]
  }));
  const lines = r.features.features.filter((f) => f.properties.kind === 'failing_radial');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].properties.saturated, 'no_service');
});

/* ---------- bbox ---------- */

test('bbox covers every coordinate (south, west, north, east)', () => {
  const r = buildAmNightNifGeoJson(mkExhibit(FULL_NIF));
  const [west, south, east, north] = r.features.bbox;
  // Polygon spans roughly lon -77.35 to -72.65, lat 39.55 to 43.15
  // Interferers stretch the box: WBLK at -82 lon, 40 lat.
  assert.ok(west <= -82, `west should reach interferer at -82 lon, got ${west}`);
  assert.ok(east >= -72.65);
  assert.ok(south <= 39.55);
  assert.ok(north >= 43.15);
});

/* ---------- serialization ---------- */

test('serializeAmNightNifGeoJson: returns Buffer + content_type on success', () => {
  const r = serializeAmNightNifGeoJson(mkExhibit(FULL_NIF));
  assert.equal(r.ok, true);
  assert.ok(Buffer.isBuffer(r.body));
  assert.equal(r.content_type, GEOJSON_CONTENT_TYPE);
  // Body parses as valid JSON.
  const parsed = JSON.parse(r.body.toString('utf8'));
  assert.equal(parsed.type, 'FeatureCollection');
});

test('serializeAmNightNifGeoJson: forwards error envelope when build fails', () => {
  const r = serializeAmNightNifGeoJson(mkExhibit(undefined));
  assert.equal(r.ok, false);
  assert.match(r.error, /am_night_nif/);
});

/* ---------- provenance ---------- */

test('AM_NIGHT_NIF_GEOJSON_PROVENANCE names §73.182 + §73.190(c) + 17 USC §105', () => {
  assert.match(AM_NIGHT_NIF_GEOJSON_PROVENANCE.regulation, /73\.182/);
  assert.match(AM_NIGHT_NIF_GEOJSON_PROVENANCE.regulation, /73\.190\(c\)/);
  assert.match(AM_NIGHT_NIF_GEOJSON_PROVENANCE.license_basis, /17 USC §105/);
});
