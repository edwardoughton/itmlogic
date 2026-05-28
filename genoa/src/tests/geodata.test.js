// Geodata evidence layer — KAZM acceptance tests.
//
// The actual rasters and PostGIS table live on the production
// /opt/genoa corpus (~tens of GB), so these tests exercise the
// service with stub raster/query adapters that emulate the
// documented per-layer behavior for KAZM (34.860833, -111.820278):
//
//   - NLCD impervious     → returns 12
//   - Mexico NALCMS       → outside extent
//   - Vegetation departure→ numeric value if covered
//   - M3 conductivity     → boundary-only warning
//
// The end-to-end "does it actually read the TIFFs" check is the
// integration suite that runs on the prod box against the real
// /opt/genoa tree.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeGeodataService } from '../evidence/geodata/index.js';

const KAZM = { lat: 34.860833, lon: -111.820278 };
const NOW = new Date('2026-05-15T16:00:00.000Z');

// A stub raster sampler that returns canned per-layer values keyed by
// the raster path.  Mirrors the real rasterSampler.js return shape
// (available / outside_extent / nodata / value / replay).
function makeStubRaster(plan){
  return async function stub({ tif, lon, lat }){
    const replay = `gdallocationinfo -wgs84 -valonly ${tif} ${lon} ${lat}`;
    const hit = plan.find((p) => tif.endsWith(p.suffix));
    if (!hit) return { available: false, reason: 'raster_unavailable', tif, replay };
    if (hit.outside_extent) return { available: true, outside_extent: true, value: null, replay };
    if (hit.nodata) return { available: true, value: null, nodata: true, replay };
    return { available: true, value: hit.value, replay };
  };
}

function makeStubQuery(rows){
  return async function stubQuery(_sql, _params){ return { rows }; };
}

test('NLCD impervious returns 12 at KAZM with interpretation + replay', async () => {
  const svc = makeGeodataService({
    raster: makeStubRaster([
      { suffix: 'Annual_NLCD_FctImp_2024_CU_C1V1.tif',                     value: 12 },
      { suffix: 'MEX_NALCMS_landcover_2020v2_30m.tif',                     outside_extent: true },
      { suffix: '2024_perennial_herbaceous_departure_20250608.tif',        value: 47 }
    ]),
    shaMapPromise: Promise.resolve(new Map()),
    now: NOW
  });
  const r = await svc.sample({ layer: 'nlcd_impervious_2024', ...KAZM });
  assert.equal(r.layer, 'nlcd_impervious_2024');
  assert.equal(r.value, 12);
  assert.equal(r.value_kind, 'pixel_pct_impervious');
  assert.match(r.interpretation, /12% impervious/);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.source.crs, 'EPSG:5070');
  assert.match(r.source.path, /Annual_NLCD_FctImp_2024_CU_C1V1\.tif$/);
  assert.match(r.replay,
    /^gdallocationinfo -wgs84 -valonly .*Annual_NLCD_FctImp_2024_CU_C1V1\.tif -111\.820278 34\.860833$/);
});

test('Mexico NALCMS returns outside_extent warning at KAZM', async () => {
  const svc = makeGeodataService({
    raster: makeStubRaster([
      { suffix: 'MEX_NALCMS_landcover_2020v2_30m.tif', outside_extent: true }
    ]),
    shaMapPromise: Promise.resolve(new Map()),
    now: NOW
  });
  const r = await svc.sample({ layer: 'nalcms_mexico_2020v2', ...KAZM });
  assert.equal(r.value, null);
  assert.match(r.warnings.join(' '), /outside the raster extent/);
  assert.match(r.warnings.join(' '), /outside the Mexico NALCMS raster extent/);
  assert.equal(r.value_kind, 'class_code');
});

test('Vegetation departure returns a numeric value when covered', async () => {
  const svc = makeGeodataService({
    raster: makeStubRaster([
      { suffix: '2024_perennial_herbaceous_departure_20250608.tif', value: 47 }
    ]),
    shaMapPromise: Promise.resolve(new Map()),
    now: NOW
  });
  const r = await svc.sample({ layer: 'vegetation_perennial_herbaceous_2024', ...KAZM });
  assert.equal(r.value, 47);
  assert.equal(r.value_kind, 'departure_index');
  assert.match(r.interpretation, /departure index 47/);
  assert.deepEqual(r.warnings, []);
});

test('M3 conductivity sampler warns that current data is boundary lines only', async () => {
  const svc = makeGeodataService({
    raster: makeStubRaster([]),
    query: makeStubQuery([{
      m3_value: 8,
      distance_m: 1234.5,
      nearest_segment_wkt: 'LINESTRING(-111.82 34.86, -111.80 34.87)'
    }]),
    shaMapPromise: Promise.resolve(new Map()),
    now: NOW
  });
  const r = await svc.sample({ layer: 'm3_conductivity_postgis', ...KAZM });
  assert.equal(r.value, 8);
  assert.equal(r.value_kind, 'm3_S_per_m_nearest_boundary');
  assert.match(r.interpretation, /nearest-boundary M3 ground conductivity = 8/);
  const allWarnings = r.warnings.join(' | ');
  assert.match(allWarnings, /boundary LINESTRINGs only/);
  assert.match(allWarnings, /not yet reconstructed/);
  assert.match(allWarnings, /not from a containing zone/);
  assert.equal(r.extra.nearest_segment_distance_m, 1234.5);
  assert.match(r.replay, /SELECT m3_value/);
});

test('M3 sampler reports unavailable when no postgres pool is wired', async () => {
  const svc = makeGeodataService({
    raster: makeStubRaster([]),
    // query intentionally omitted
    shaMapPromise: Promise.resolve(new Map()),
    now: NOW
  });
  const r = await svc.sample({ layer: 'm3_conductivity_postgis', ...KAZM });
  assert.equal(r.value, null);
  assert.equal(r.interpretation, 'sampler unavailable');
  assert.match(r.warnings.join(' '), /postgres pool not configured/);
});

test('sampleAll fans out across every layer and returns auditable rows', async () => {
  const svc = makeGeodataService({
    raster: makeStubRaster([
      { suffix: 'Annual_NLCD_FctImp_2024_CU_C1V1.tif',              value: 12 },
      { suffix: 'MEX_NALCMS_landcover_2020v2_30m.tif',              outside_extent: true },
      { suffix: '2024_perennial_herbaceous_departure_20250608.tif', value: 47 }
    ]),
    query: makeStubQuery([{ m3_value: 8, distance_m: 1234.5,
                            nearest_segment_wkt: 'LINESTRING(-111 34, -111 35)' }]),
    shaMapPromise: Promise.resolve(new Map()),
    now: NOW
  });
  const r = await svc.sampleAll(KAZM);
  assert.equal(r.lat, KAZM.lat);
  assert.equal(r.lon, KAZM.lon);
  assert.equal(r.layers.nlcd_impervious_2024.value, 12);
  assert.equal(r.layers.nalcms_mexico_2020v2.value, null);
  assert.equal(r.layers.vegetation_perennial_herbaceous_2024.value, 47);
  assert.equal(r.layers.m3_conductivity_postgis.value, 8);
});

test('manifest reports every configured layer with status + warnings', async () => {
  const svc = makeGeodataService({
    raster: makeStubRaster([]),
    shaMapPromise: Promise.resolve(new Map([
      ['/opt/genoa/sources/nlcd/Annual_NLCD_FctImp_2024_CU_C1V1/Annual_NLCD_FctImp_2024_CU_C1V1.tif',
       'a'.repeat(64)]
    ])),
    listDir: async () => [],
    now: NOW
  });
  const m = await svc.manifest();
  assert.equal(m.geodata_root, '/opt/genoa');
  assert.equal(m.master_sha256sums_present, true);
  assert.equal(m.master_sha256sums_count, 1);
  const ids = m.layers.map((l) => l.id);
  assert.deepEqual(ids.sort(), [
    'fcc_contour_evidence',
    'm3_conductivity_postgis',
    'nalcms_mexico_2020v2',
    'nlcd_impervious_2024',
    'terrain_globe',
    'vegetation_perennial_herbaceous_2024'
  ]);
  const m3 = m.layers.find((l) => l.id === 'm3_conductivity_postgis');
  assert.equal(m3.status, 'partial');
  assert.match(m3.warnings.join(' '), /boundary LINESTRINGs only/);
  const globe = m.layers.find((l) => l.id === 'terrain_globe');
  assert.equal(globe.status, 'pending_georef');
  assert.match(globe.warnings.join(' '), /not yet attested/);
  const nlcd = m.layers.find((l) => l.id === 'nlcd_impervious_2024');
  assert.equal(nlcd.sha256, 'a'.repeat(64));
});

test('terrain status reports pending_georef and counts tiles', async () => {
  const svc = makeGeodataService({
    raster: makeStubRaster([]),
    listDir: async () => ['a10g.bil', 'a10g.hdr', 'b10g.bil', 'b10g.hdr', 'README.txt'],
    shaMapPromise: Promise.resolve(new Map()),
    now: NOW
  });
  const t = await svc.terrainStatus();
  assert.equal(t.layer, 'terrain_globe');
  assert.equal(t.status, 'pending_georef');
  assert.equal(t.tile_count, 4);
  assert.match(t.warnings.join(' '), /not yet attested/);
});

test('invalid coordinates throw a coded error', async () => {
  const svc = makeGeodataService({
    raster: makeStubRaster([]),
    shaMapPromise: Promise.resolve(new Map())
  });
  await assert.rejects(
    () => svc.sample({ layer: 'nlcd_impervious_2024', lat: 999, lon: 0 }),
    /invalid lat\/lon/
  );
  await assert.rejects(
    () => svc.sampleAll({ lat: 'banana', lon: 0 }),
    /invalid lat\/lon/
  );
});

test('unknown layer returns GEODATA_LAYER_NOT_FOUND', async () => {
  const svc = makeGeodataService({
    raster: makeStubRaster([]),
    shaMapPromise: Promise.resolve(new Map())
  });
  const r = await svc.sample({ layer: 'made_up', ...KAZM });
  assert.equal(r.error, 'GEODATA_LAYER_NOT_FOUND');
});

test('manifest routes json_dir presence through the sidecar in sidecar mode', async () => {
  const svc = makeGeodataService({
    raster: makeStubRaster([]),
    statRasterRemote: async (p) => {
      // fcc_contour_evidence dir exists as a directory; everything
      // else (the raster files) doesn't matter for this assertion.
      if (p.endsWith('/live-data/fcc-contours/tests')){
        return { exists: true, is_dir: true, size: null };
      }
      return { exists: false };
    },
    shaMapPromise: Promise.resolve(new Map()),
    listDir:       async () => [],
    now:           NOW
  });
  const m = await svc.manifest();
  const fcc = m.layers.find((l) => l.id === 'fcc_contour_evidence');
  assert.equal(fcc.status, 'available');
  assert.equal(fcc.via,    'sidecar');
});

test('manifest populates sha256 for json_dir when present in master sha map', async () => {
  const fccDir = '/opt/genoa/live-data/fcc-contours/tests';
  const svc = makeGeodataService({
    raster: makeStubRaster([]),
    statRasterRemote: async (p) =>
      p === fccDir ? { exists: true, is_dir: true } : { exists: false },
    shaMapPromise: Promise.resolve(new Map([[fccDir, 'ab'.repeat(32)]])),
    listDir:       async () => [],
    now:           NOW
  });
  const m = await svc.manifest();
  const fcc = m.layers.find((l) => l.id === 'fcc_contour_evidence');
  assert.equal(fcc.status, 'available');
  assert.equal(fcc.sha256, 'ab'.repeat(32));
});

test('manifest uses statRasterRemote when running in sidecar mode', async () => {
  // sidecar mode: status comes from the sidecar's /raster/status, not
  // from local fs.stat (which would always say "missing" on App Platform).
  const svc = makeGeodataService({
    raster: makeStubRaster([]),
    statRasterRemote: async (p) => ({
      exists: p.endsWith('Annual_NLCD_FctImp_2024_CU_C1V1.tif'),
      size:   p.endsWith('Annual_NLCD_FctImp_2024_CU_C1V1.tif') ? 1234567890 : null
    }),
    shaMapPromise: Promise.resolve(new Map()),
    listDir:       async () => [],
    now:           NOW
  });
  const m = await svc.manifest();
  const nlcd  = m.layers.find((l) => l.id === 'nlcd_impervious_2024');
  const nalcm = m.layers.find((l) => l.id === 'nalcms_mexico_2020v2');
  assert.equal(nlcd.status,  'available');
  assert.equal(nlcd.size,    1234567890);
  assert.equal(nlcd.via,     'sidecar');
  assert.equal(nalcm.status, 'missing');
  assert.equal(nalcm.via,    'sidecar');
});
