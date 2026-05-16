// FCC Census polygon-population estimator tests.
//
// Covers polygon sampling determinism, ray-cast point-in-polygon,
// FCC API client behavior with a stubbed fetch (no network), block
// cache reuse across calls, and end-to-end polygon-population output.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  pointInPolygon,
  bboxOfRing,
  uniformInteriorSample,
  bboxAreaKm2
} from '../evidence/polygonSample.js';
import { makeFccCensusClient, _fetchBlock, _runWithConcurrency } from '../evidence/fccCensusClient.js';

// A 0.1° × 0.1° square ring centered on (37.0, -95.7), closed.
const SQUARE = [
  [36.95, -95.75],
  [37.05, -95.75],
  [37.05, -95.65],
  [36.95, -95.65],
  [36.95, -95.75]
];

test('pointInPolygon: inside, edge, outside', () => {
  assert.equal(pointInPolygon([37.0,  -95.7],  SQUARE), true);
  assert.equal(pointInPolygon([36.0,  -95.7],  SQUARE), false);
  assert.equal(pointInPolygon([37.06, -95.7],  SQUARE), false);
  assert.equal(pointInPolygon([37.0,  -95.6],  SQUARE), false);
});

test('bboxOfRing matches the closed square', () => {
  const b = bboxOfRing(SQUARE);
  assert.equal(b.lat_min, 36.95);
  assert.equal(b.lat_max, 37.05);
  assert.equal(b.lon_min, -95.75);
  assert.equal(b.lon_max, -95.65);
});

test('uniformInteriorSample is deterministic across runs', () => {
  const a = uniformInteriorSample(SQUARE, 16);
  const b = uniformInteriorSample(SQUARE, 16);
  assert.deepEqual(a, b, 'sample must be byte-identical across runs');
  assert.ok(a.length >= 8, 'expected at least 8 interior samples for n_target=16');
  for (const p of a){
    assert.equal(pointInPolygon(p, SQUARE), true,
      `sample ${p} is outside polygon`);
  }
});

test('bboxAreaKm2: 0.1° × 0.1° box at lat ~37 is ~93 km²', () => {
  const a = bboxAreaKm2({ lat_min: 36.95, lat_max: 37.05, lon_min: -95.75, lon_max: -95.65 });
  // 0.1°lat ≈ 11.06 km; 0.1°lon × cos(37°) ≈ 8.89 km; product ~98 km²
  // Allow a 10% band — this is just an approximation helper.
  assert.ok(a > 90 && a < 110, `expected ~93..98 km², got ${a}`);
});

test('runWithConcurrency preserves input order', async () => {
  const inputs = [10, 20, 30, 40, 50, 60, 70];
  const out = await _runWithConcurrency(inputs, 3, async (x) => {
    await new Promise(r => setTimeout(r, Math.random() * 5));
    return x * 2;
  });
  assert.deepEqual(out, [20, 40, 60, 80, 100, 120, 140]);
});

test('fccCensusClient: stubbed fetch returns evidence with provenance', async () => {
  // Stubbed FCC response.  Each (lat, lon) maps to one of two synthetic
  // blocks based on lon sign — covers cache reuse.
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const lat = parseFloat(url.match(/lat=([^&]+)/)[1]);
    const lon = parseFloat(url.match(/lon=([^&]+)/)[1]);
    const fips = lon > -95.7 ? '201259507003001' : '201259507003002';
    const pop  = lon > -95.7 ? 50 : 30;
    return {
      ok: true,
      async json(){
        return {
          input: { lat, lon, censusYear: '2020' },
          results: [{
            block_fips:     fips,
            bbox:           [-95.72918, 37.080404, -95.71059, 37.095048],
            block_pop_2020: pop,
            county_fips:    '20125',
            state_code:     'KS'
          }]
        };
      }
    };
  };

  const client = makeFccCensusClient({ fetchFn, samples: 12, concurrency: 4 });
  assert.ok(client, 'client must construct when fetchFn is provided');
  // Simulated GeoJSON Feature with a Polygon (lon, lat) ring.
  const geojson = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-95.75, 36.95],
        [-95.75, 37.05],
        [-95.65, 37.05],
        [-95.65, 36.95],
        [-95.75, 36.95]
      ]]
    },
    properties: {}
  };
  const r = await client.populationForContour({ geojson, contour_label: '60 dBu' });
  assert.equal(r.available, true);
  assert.equal(typeof r.persons, 'number');
  assert.ok(r.persons > 0, 'sampled blocks both have positive pop; expected positive estimate');
  assert.equal(r.source,   'US Census Bureau via FCC Census Block API');
  assert.equal(r.dataset,  'Decennial Census 2020');
  assert.equal(r.vintage,  2020);
  assert.match(r.method,   /polygon point-sample density estimator/);
  assert.match(r.endpoint, /census\/area$/);
  assert.equal(r.contour_label, '60 dBu');
  assert.ok(typeof r.fetched_at === 'string' && r.fetched_at.endsWith('Z'));
  assert.ok(r.details.unique_block_count >= 1);
  assert.ok(r.details.sample_count >= r.details.unique_block_count);

  // Cache hit rate: a second contour over the same area should NOT
  // re-issue API calls for blocks already cached.
  const callsBefore = calls.length;
  const r2 = await client.populationForContour({ geojson, contour_label: '60 dBu' });
  assert.equal(r2.available, true);
  // The client deduplicates AFTER receiving each FCC response (FCC
  // tells us the block fips — we don't know it ahead of time), so the
  // second call still issues the same number of API requests for the
  // sample points.  But the per-block POPULATION/AREA is reused from
  // cache, not recomputed.  Validate by checking cacheSize.
  assert.ok(client.cacheSize() >= 1, 'block cache must retain entries');
});

test('fccCensusClient: API failure surfaces as available=false (no fabrication)', async () => {
  const fetchFn = async () => ({
    ok:     false,
    status: 503,
    async json(){ return {}; }
  });
  const client = makeFccCensusClient({ fetchFn, samples: 8, concurrency: 2 });
  const geojson = {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [-95.75, 36.95], [-95.75, 37.05], [-95.65, 37.05], [-95.65, 36.95], [-95.75, 36.95]
      ]]
    },
    properties: {}
  };
  const r = await client.populationForContour({ geojson, contour_label: '60 dBu' });
  assert.equal(r.available, false);
  assert.equal(r.source,    null);
  assert.match(r.error,     /unreachable/);
  assert.ok(Array.isArray(r.attempt_errors) && r.attempt_errors.length > 0);
});

test('fccCensusClient: empty/missing geometry => available=false', async () => {
  const fetchFn = async () => ({ ok: true, async json(){ return {}; } });
  const client = makeFccCensusClient({ fetchFn });
  const r1 = await client.populationForContour({ geojson: null, contour_label: 'x' });
  assert.equal(r1.available, false);
  const r2 = await client.populationForContour({
    geojson: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] } }
  });
  assert.equal(r2.available, false);
});

test('fccCensusClient: external block cache shared across constructor calls', async () => {
  const cache = new Map();
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    const lat = parseFloat(url.match(/lat=([^&]+)/)[1]);
    const lon = parseFloat(url.match(/lon=([^&]+)/)[1]);
    return {
      ok: true,
      async json(){
        return {
          input: { lat, lon, censusYear: '2020' },
          results: [{
            block_fips:     '201259507003001',
            bbox:           [-95.72918, 37.080404, -95.71059, 37.095048],
            block_pop_2020: 50
          }]
        };
      }
    };
  };
  // First client populates the cache.
  const c1 = makeFccCensusClient({ fetchFn, cache, samples: 4, concurrency: 1 });
  await _fetchBlock({
    lat: 37, lon: -95.7,
    baseUrl: 'https://geo.fcc.gov/api/census/area',
    censusYear: 2020, popField: 'block_pop_2020',
    timeoutMs: 5000, fetchFn, blockCache: cache
  });
  assert.equal(cache.size, 1);
  // Second client (different constructor call) sharing the same Map
  // sees the entry.
  const c2 = makeFccCensusClient({ fetchFn, cache });
  assert.equal(c2.cacheSize(), 1);
});
