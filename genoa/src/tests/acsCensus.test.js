// ACS 5-year population client — mocked-fetch tests.
//
// Every test injects its own fetch stub via the constructor option so
// no test depends on the real api.census.gov / geocoder upstreams.

import test    from 'node:test';
import assert  from 'node:assert/strict';

import {
  makeAcsCensusClient,
  _padFips,
  _rowsToFipsMap
} from '../evidence/acsCensusClient.js';

// Square ~111 km on a side near Phoenix, AZ. Single block-group geocoded
// for every interior sample point (the stub keys off the URL prefix).
const SIMPLE_GEOJSON = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[
      [-112.0, 33.0],
      [-111.0, 33.0],
      [-111.0, 34.0],
      [-112.0, 34.0],
      [-112.0, 33.0]
    ]]
  }
};

function stubResponses({
  geocoderState   = '04',
  geocoderCounty  = '013',
  geocoderTract   = '010101',
  geocoderBlkgrp  = '1',
  acsRows         = [['B01003_001E', 'NAME', 'state', 'county', 'tract', 'block group'],
                     ['1500',        'BG1',  '04',    '013',    '010101', '1']],
  decRows         = [['AREALAND', 'NAME', 'state', 'county', 'tract', 'block group'],
                     ['1000000',  'BG1',  '04',    '013',    '010101', '1']],   // 1 km^2
  geocoderHttpStatus = 200,
  acsHttpStatus      = 200,
  decHttpStatus      = 200
} = {}){
  const calls = { geocoder: 0, acs: 0, dec: 0 };
  const fetchFn = async (url) => {
    if (url.startsWith('https://geocoding.geo.census.gov')){
      calls.geocoder++;
      if (geocoderHttpStatus !== 200) return { ok: false, status: geocoderHttpStatus, json: async () => ({}) };
      return { ok: true, json: async () => ({
        result: { geographies: { 'Census Block Groups': [
          { STATE: geocoderState, COUNTY: geocoderCounty, TRACT: geocoderTract, BLKGRP: geocoderBlkgrp }
        ] } }
      }) };
    }
    if (url.includes('/acs/acs5')){
      calls.acs++;
      if (acsHttpStatus !== 200) return { ok: false, status: acsHttpStatus, json: async () => [] };
      return { ok: true, json: async () => acsRows };
    }
    if (url.includes('/dec/dhc')){
      calls.dec++;
      if (decHttpStatus !== 200) return { ok: false, status: decHttpStatus, json: async () => [] };
      return { ok: true, json: async () => decRows };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchFn, calls };
}

/* ---------------- constructor / disabled ---------------- */

test('makeAcsCensusClient returns null when fetch is unavailable', () => {
  const c = makeAcsCensusClient({ fetchFn: null });
  assert.equal(c, null);
});

/* ---------------- happy path ---------------- */

test('valid polygon -> available=true with full ACS provenance', async () => {
  const { fetchFn, calls } = stubResponses();
  const c = makeAcsCensusClient({ fetchFn, samples: 4 });
  const r = await c.populationForContour({ geojson: SIMPLE_GEOJSON, contour_label: '60 dBu (1 mV/m service)' });
  assert.equal(r.available, true);
  assert.equal(r.source, 'US Census Bureau via ACS 5-year');
  assert.match(r.dataset, /American Community Survey 5-year \d{4}$/);
  assert.equal(typeof r.persons, 'number');
  assert.ok(r.persons > 0, 'persons should be positive for a 1500 pop / 1 km^2 block-group sampled across 1 deg square');
  assert.equal(r.contour_label, '60 dBu (1 mV/m service)');
  assert.match(r.method, /Census Geocoder \+ ACS 5-year/);
  assert.ok(calls.geocoder >= 1, 'geocoder called at least once');
  assert.equal(calls.acs, 1, 'one ACS bulk per county');
  assert.equal(calls.dec, 1, 'one DEC bulk per county');
});

test('determinism: same polygon -> same persons across calls', async () => {
  const c1 = makeAcsCensusClient({ fetchFn: stubResponses().fetchFn, samples: 4 });
  const c2 = makeAcsCensusClient({ fetchFn: stubResponses().fetchFn, samples: 4 });
  const a = await c1.populationForContour({ geojson: SIMPLE_GEOJSON, contour_label: '' });
  const b = await c2.populationForContour({ geojson: SIMPLE_GEOJSON, contour_label: '' });
  assert.equal(a.persons, b.persons);
});

test('block-group cache survives within one client instance', async () => {
  const { fetchFn, calls } = stubResponses();
  const c = makeAcsCensusClient({ fetchFn, samples: 4 });
  await c.populationForContour({ geojson: SIMPLE_GEOJSON, contour_label: '' });
  await c.populationForContour({ geojson: SIMPLE_GEOJSON, contour_label: '' });
  // The county-level ACS/DEC bulks fire on every call (they're not
  // county-cached in this implementation), but block-group-level
  // cache hits should accumulate.
  assert.ok(c.cacheSize() >= 1);
});

/* ---------------- API key plumbing ---------------- */

test('API key is forwarded as the `key` query param when set', async () => {
  let acsUrl = null, decUrl = null;
  const fetchFn = async (url) => {
    if (url.startsWith('https://geocoding.geo.census.gov')){
      return { ok: true, json: async () => ({
        result: { geographies: { 'Census Block Groups': [
          { STATE: '04', COUNTY: '013', TRACT: '010101', BLKGRP: '1' }
        ] } }
      }) };
    }
    if (url.includes('/acs/acs5')){
      acsUrl = url;
      return { ok: true, json: async () => [
        ['B01003_001E', 'NAME', 'state', 'county', 'tract', 'block group'],
        ['1500', 'BG1', '04', '013', '010101', '1']
      ] };
    }
    if (url.includes('/dec/dhc')){
      decUrl = url;
      return { ok: true, json: async () => [
        ['AREALAND', 'NAME', 'state', 'county', 'tract', 'block group'],
        ['1000000', 'BG1', '04', '013', '010101', '1']
      ] };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const c = makeAcsCensusClient({ fetchFn, samples: 4, apiKey: 'test-key-xyz' });
  await c.populationForContour({ geojson: SIMPLE_GEOJSON, contour_label: '' });
  assert.match(acsUrl, /key=test-key-xyz/);
  assert.match(decUrl, /key=test-key-xyz/);
});

test('API key is omitted when not set', async () => {
  let acsUrl = null;
  const fetchFn = async (url) => {
    if (url.startsWith('https://geocoding.geo.census.gov')){
      return { ok: true, json: async () => ({
        result: { geographies: { 'Census Block Groups': [
          { STATE: '04', COUNTY: '013', TRACT: '010101', BLKGRP: '1' }
        ] } }
      }) };
    }
    if (url.includes('/acs/acs5')){
      acsUrl = url;
      return { ok: true, json: async () => [
        ['B01003_001E', 'NAME', 'state', 'county', 'tract', 'block group'],
        ['1', 'BG1', '04', '013', '010101', '1']
      ] };
    }
    if (url.includes('/dec/dhc')){
      return { ok: true, json: async () => [
        ['AREALAND', 'NAME', 'state', 'county', 'tract', 'block group'],
        ['1000000', 'BG1', '04', '013', '010101', '1']
      ] };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const c = makeAcsCensusClient({ fetchFn, samples: 4, apiKey: null });
  await c.populationForContour({ geojson: SIMPLE_GEOJSON, contour_label: '' });
  assert.doesNotMatch(acsUrl, /[?&]key=/);
});

/* ---------------- failure modes ---------------- */

test('missing geojson -> available=false, error=no_geojson', async () => {
  const { fetchFn } = stubResponses();
  const c = makeAcsCensusClient({ fetchFn });
  const r = await c.populationForContour({ geojson: null, contour_label: '' });
  assert.equal(r.available, false);
  assert.equal(r.error, 'no_geojson');
});

test('invalid polygon -> available=false, error=invalid_polygon', async () => {
  const { fetchFn } = stubResponses();
  const c = makeAcsCensusClient({ fetchFn });
  // Degenerate: all four corners at the same point -> zero area.
  const r = await c.populationForContour({
    geojson: { type: 'Feature', geometry: {
      type: 'Polygon',
      coordinates: [[[0,0],[0,0],[0,0],[0,0]]]
    } },
    contour_label: ''
  });
  assert.equal(r.available, false);
  assert.equal(r.error, 'invalid_polygon');
});

test('all geocoder calls fail -> available=false, error=census_geocoder_unreachable', async () => {
  const { fetchFn } = stubResponses({ geocoderHttpStatus: 503 });
  const c = makeAcsCensusClient({ fetchFn, samples: 4 });
  const r = await c.populationForContour({ geojson: SIMPLE_GEOJSON, contour_label: '' });
  assert.equal(r.available, false);
  assert.equal(r.error, 'census_geocoder_unreachable');
  assert.ok(Array.isArray(r.attempt_errors));
  assert.ok(r.attempt_errors.length > 0);
});

test('ACS bulk fails but geocoder succeeds -> available=false, error=no_block_group_data_resolved', async () => {
  const { fetchFn } = stubResponses({ acsHttpStatus: 502 });
  const c = makeAcsCensusClient({ fetchFn, samples: 4 });
  const r = await c.populationForContour({ geojson: SIMPLE_GEOJSON, contour_label: '' });
  assert.equal(r.available, false);
  assert.equal(r.error, 'no_block_group_data_resolved');
});

test('DEC bulk fails -> available=false (no AREALAND, no density)', async () => {
  const { fetchFn } = stubResponses({ decHttpStatus: 502 });
  const c = makeAcsCensusClient({ fetchFn, samples: 4 });
  const r = await c.populationForContour({ geojson: SIMPLE_GEOJSON, contour_label: '' });
  assert.equal(r.available, false);
  assert.equal(r.error, 'no_block_group_data_resolved');
});

test('ACS returns empty rows -> available=false', async () => {
  const { fetchFn } = stubResponses({ acsRows: [['B01003_001E','NAME','state','county','tract','block group']] });
  const c = makeAcsCensusClient({ fetchFn, samples: 4 });
  const r = await c.populationForContour({ geojson: SIMPLE_GEOJSON, contour_label: '' });
  assert.equal(r.available, false);
});

/* ---------------- pure helpers ---------------- */

test('_padFips zero-pads short numeric FIPS', () => {
  assert.equal(_padFips(4,    2), '04');
  assert.equal(_padFips('13', 3), '013');
  assert.equal(_padFips('010101', 6), '010101');
  assert.equal(_padFips(1,    1), '1');
  assert.equal(_padFips(null, 2), '00');
});

test('_rowsToFipsMap collates rows into 12-char FIPS keys', () => {
  const rows = [
    ['B01003_001E', 'NAME', 'state', 'county', 'tract', 'block group'],
    ['100',         'A',    '04',    '013',    '010101', '1'],
    ['200',         'B',    '04',    '013',    '010101', '2'],
  ];
  const m = _rowsToFipsMap(rows, 'B01003_001E');
  assert.equal(m.size, 2);
  assert.equal(m.get('040130101011'), 100);
  assert.equal(m.get('040130101012'), 200);
});

test('_rowsToFipsMap throws on unexpected columns', () => {
  const rows = [
    ['B01003_001E', 'NAME'],
    ['100',         'A']
  ];
  assert.throws(() => _rowsToFipsMap(rows, 'B01003_001E'),
                /unexpected columns/);
});
