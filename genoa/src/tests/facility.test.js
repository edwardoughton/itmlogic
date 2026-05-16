// Facility adapter tests.  All upstreams are mocked — no real ZTR or n8n
// is contacted.  The point is to prove the adapter
//   - normalizes ZTR rows into Genoa's facility shape
//   - never fabricates ERP / HAAT / coords
//   - falls back to n8n when ZTR is unavailable
//   - reports FACILITY_LOOKUP_UNAVAILABLE when nothing is configured

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeFacilityClient } from '../api/services/facilityClient.js';

const KSLX_ZTR_ROW = {
  id:             123,
  source:         'fcc',
  kind:           'fm',
  callsign:       'KSLX-FM',
  station_name:   'KSLX-FM',
  frequency_khz:  100700,
  service:        'FM',
  status:         'L',
  licensee:       'Hubbard Broadcasting',
  city:           'Scottsdale',
  state:          'AZ',
  country_code:   'US',
  latitude:       33.3,
  longitude:    -112.0,
  power_watts:    100000,
  haat_m:         561,
  url:            null,
  tags:           null,
  last_seen:      '2025-01-01T00:00:00Z',
  facility_id:    '11282'
};

function mockFetch(handler){
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => handler(String(url), opts) || (() => { throw new Error('no mock for ' + url); })();
  return () => { globalThis.fetch = orig; };
}

function jsonResp(body, ok = true){
  return { ok, status: ok ? 200 : 502, json: async () => body };
}

test('makeFacilityClient returns null when no upstream is configured', () => {
  const c = makeFacilityClient({ ztrUrl: null, n8nBaseUrl: null, fmqClient: null });
  assert.equal(c, null);
});

test('makeFacilityClient defaults to FCC FMQ enabled (no ZTR / n8n required)', () => {
  // FMQ is a free, no-auth FCC public endpoint — Genoa enables it by
  // default so the search box works on a fresh deploy without any
  // operator configuration.
  const c = makeFacilityClient({ ztrUrl: null, n8nBaseUrl: null });
  assert.ok(c, 'client should construct with FMQ-only upstream');
  assert.equal(c.hasFmq, true);
});

test('searchByQuery normalizes ZTR rows; preserves null fields, never fabricates', async () => {
  const restore = mockFetch((url) => {
    assert.match(url, /\/api\/broadcast\/stations\?q=KSLX/);
    return jsonResp({ rows: [KSLX_ZTR_ROW], count: 1 });
  });
  try {
    const c = makeFacilityClient({ ztrUrl: 'http://ztr.test', fmqClient: null });
    const r = await c.searchByQuery('KSLX');
    assert.equal(r.source, 'zerotrustradio');
    assert.equal(r.rows.length, 1);
    const f = r.rows[0];
    assert.equal(f.facility_id, '11282');
    assert.equal(f.call,        'KSLX-FM');
    assert.equal(f.service,     'FM');
    assert.equal(f.frequency,   100.7);
    assert.equal(f.frequency_unit, 'MHz');
    assert.equal(f.erp_kw,      100);
    assert.equal(f.haat_m,      561);
    assert.equal(f.lat,         33.3);
    assert.equal(f.lon,        -112.0);
    assert.equal(f.facility_lookup_source.upstream, 'zerotrustradio');
    assert.match(f.facility_lookup_source.endpoint, /\/api\/broadcast\/stations\?q=KSLX/);
  } finally { restore(); }
});

test('searchByQuery rejects too-short queries before hitting the network', async () => {
  let called = false;
  const restore = mockFetch(() => { called = true; return jsonResp({ rows: [] }); });
  try {
    const c = makeFacilityClient({ ztrUrl: 'http://ztr.test', fmqClient: null });
    const r = await c.searchByQuery('K');
    assert.equal(called, false);
    assert.equal(r.source, null);
    assert.match(r.error, /at least 2 characters/);
  } finally { restore(); }
});

test('searchByQuery: ZTR reachable but empty + no FMQ + no n8n -> 200 success with 0 rows', async () => {
  // When every fallback is disabled and ZTR returns empty, the adapter
  // reports ZTR as the source so the route returns 200 (not 503), and
  // the UI can show a "no matches" hint instead of an outage banner.
  let zhits = 0;
  const restore = mockFetch((url) => {
    assert.match(url, /\/api\/broadcast\/stations\?q=KDKB/);
    zhits += 1;
    return jsonResp({ rows: [], count: 0 });
  });
  try {
    const c = makeFacilityClient({ ztrUrl: 'http://ztr.test', fmqClient: null });
    const r = await c.searchByQuery('KDKB');
    assert.equal(zhits, 1, 'ZTR was hit exactly once');
    assert.equal(r.source, 'zerotrustradio');
    assert.equal(r.count, 0);
    assert.deepEqual(r.rows, []);
    assert.equal(r.error, undefined);
  } finally { restore(); }
});

test('searchByQuery: ZTR empty + FMQ configured -> FCC FMQ direct fallback fires', async () => {
  // FCC FMQ pipe-delim row for KDKB-FM (real Mesa, AZ data).
  const KDKB_FMQ_LINE =
    '|KDKB        |93.3  MHz |FM |227 |ND  |H                   |C  |-  |LIC    |MESA                     |AZ |US |BLH-20101116AIX     |100.   kW |100.   kW |508.0   |508.0   |41299      |N |33 |20 |1.0   |W |112 |3  |46.9  |PHOENIX FCC LICENSE SUB, LLC                                                |   0.00 km |   0.00 mi |  0.00 deg |871.   m|871.0  m|-         |-       |1002069 |       m|201011161 |aaa |bbb   |';
  const stubFmq = {
    async searchByCallsign(call){
      assert.equal(call, 'KDKB');
      const { parseRow } = await import('../evidence/fccFmqClient.js');
      const row = parseRow(KDKB_FMQ_LINE, false, 'https://transition.fcc.gov/fcc-bin/fmq?call=KDKB&list=4');
      return { rows: [row], count: 1, source: 'fcc-fmq+amq' };
    }
  };
  const restore = mockFetch((url) => {
    if (url.includes('/api/broadcast/stations')) return jsonResp({ rows: [], count: 0 });
    throw new Error('unexpected url ' + url);
  });
  try {
    const c = makeFacilityClient({ ztrUrl: 'http://ztr.test', fmqClient: stubFmq });
    const r = await c.searchByQuery('KDKB');
    assert.equal(r.source, 'fcc-fmq');
    assert.equal(r.count, 1);
    const f = r.rows[0];
    assert.equal(f.call, 'KDKB');
    assert.equal(f.service, 'FM');
    assert.equal(f.fcc_class, 'C');
    assert.equal(f.facility_id, '41299');
    assert.equal(f.frequency, 93.3);
    assert.equal(f.frequency_unit, 'MHz');
    assert.equal(f.erp_kw, 100);
    assert.equal(f.haat_m, 508);
    assert.ok(f.lat > 33.33 && f.lat < 33.34, `expected lat ~33.33; got ${f.lat}`);
    assert.ok(f.lon > -112.07 && f.lon < -112.06, `expected lon ~-112.06; got ${f.lon}`);
    assert.equal(f.facility_lookup_source.upstream, 'fcc-fmq');
  } finally { restore(); }
});

test('searchByQuery: ZTR empty + FMQ empty + n8n configured -> n8n fallback fires last', async () => {
  const N8N_ROW = {
    facility_id: '99999', call: 'KDKB-FM', service: 'FM', frequency: 93.3,
    erp_kw: 50, haat_m: 200, lat: 33.5, lon: -111.9,
    facility_lookup_source: { upstream: 'n8n', endpoint: 'http://n8n.test/webhook/station/analyze',
                              fetched_at: '2025-01-01T00:00:00Z' }
  };
  const stubFmq = { async searchByCallsign(){ return { rows: [], source: null }; } };
  const restore = mockFetch((url) => {
    if (url.includes('/api/broadcast/stations')) return jsonResp({ rows: [], count: 0 });
    if (url.includes('/webhook/station/analyze')) return jsonResp({ rows: [N8N_ROW] });
    throw new Error('unexpected url ' + url);
  });
  try {
    const c = makeFacilityClient({
      ztrUrl:     'http://ztr.test',
      n8nBaseUrl: 'http://n8n.test',
      fmqClient:  stubFmq
    });
    const r = await c.searchByQuery('KDKB');
    assert.equal(r.source, 'n8n');
    assert.equal(r.count, 1);
    assert.equal(r.rows[0].call, 'KDKB-FM');
  } finally { restore(); }
});

test('getById returns a single normalized facility', async () => {
  const restore = mockFetch((url) => {
    assert.match(url, /\/api\/broadcast\/stations\?facility_id=11282/);
    return jsonResp({ rows: [KSLX_ZTR_ROW] });
  });
  try {
    const c = makeFacilityClient({ ztrUrl: 'http://ztr.test', fmqClient: null });
    const r = await c.getById('11282');
    assert.equal(r.source, 'zerotrustradio');
    assert.equal(r.facility.facility_id, '11282');
    assert.equal(r.facility.haat_m, 561);
  } finally { restore(); }
});

test('AM rows: frequency_unit is kHz, no MHz conversion', async () => {
  const am = { ...KSLX_ZTR_ROW, kind: 'am', frequency_khz: 1240, callsign: 'WAM-AM', facility_id: '999', station_name: 'WAM' };
  const restore = mockFetch(() => jsonResp({ rows: [am] }));
  try {
    const c = makeFacilityClient({ ztrUrl: 'http://ztr.test', fmqClient: null });
    const r = await c.getById('999');
    assert.equal(r.facility.service, 'AM');
    assert.equal(r.facility.frequency, 1240);
    assert.equal(r.facility.frequency_unit, 'kHz');
  } finally { restore(); }
});

test('Falls back to n8n when ZTR fails (FMQ disabled)', async () => {
  let urls = [];
  const restore = mockFetch((url, opts) => {
    urls.push(url);
    if (url.includes('/api/broadcast/stations'))   throw new Error('ZTR down');
    if (url.includes('/webhook/station/analyze')){
      assert.equal(opts.method, 'POST');
      return jsonResp({ rows: [{ call: 'KSLX-FM', facility_id: '11282', kind: 'fm', frequency_mhz: 100.7, erp_kw: 100, haat_m: 561, lat: 33.3, lon: -112 }] });
    }
    throw new Error('unexpected url: ' + url);
  });
  try {
    const c = makeFacilityClient({ ztrUrl: 'http://ztr.test', n8nBaseUrl: 'http://n8n.test', fmqClient: null });
    const r = await c.searchByQuery('KSLX');
    assert.equal(r.source, 'n8n');
    assert.equal(r.rows[0].facility_id, '11282');
    assert.equal(r.rows[0].erp_kw, 100);
    assert.ok(urls.some(u => u.includes('ztr.test')));
    assert.ok(urls.some(u => u.includes('n8n.test')));
  } finally { restore(); }
});

test('All upstreams fail: source=null, error reported (not fabricated)', async () => {
  const stubFmq = { async searchByCallsign(){ throw new Error('FMQ network'); } };
  const restore = mockFetch(() => { throw new Error('network'); });
  try {
    const c = makeFacilityClient({ ztrUrl: 'http://ztr.test', n8nBaseUrl: 'http://n8n.test', fmqClient: stubFmq });
    const r = await c.searchByQuery('KSLX');
    assert.equal(r.source, null);
    assert.equal(r.rows.length, 0);
    assert.ok(r.error);
  } finally { restore(); }
});

test('Missing fields stay null (no fabrication)', async () => {
  const partial = {
    id: 1, source: 'fcc', kind: 'fm', callsign: 'WTEST-FM',
    frequency_khz: 99500, latitude: null, longitude: null,
    power_watts: null, haat_m: null,
    facility_id: '7777',
    last_seen: '2025-01-01T00:00:00Z'
  };
  const restore = mockFetch(() => jsonResp({ rows: [partial] }));
  try {
    const c = makeFacilityClient({ ztrUrl: 'http://ztr.test', fmqClient: null });
    const r = await c.getById('7777');
    assert.equal(r.facility.lat,    null);
    assert.equal(r.facility.lon,    null);
    assert.equal(r.facility.erp_kw, null);
    assert.equal(r.facility.haat_m, null);
  } finally { restore(); }
});
