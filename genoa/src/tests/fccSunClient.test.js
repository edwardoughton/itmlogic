import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeFccSunClient,
  isValidFccTzCode,
  defaultTzForLatLon,
  FCC_TIMEZONE_CODES,
  FCC_SUN_CLIENT_PROVENANCE
} from '../evidence/fccSunClient.js';

/* ---------- construction ---------- */

test('makeFccSunClient: null when FCC_SUN_SIDECAR_URL unset', () => {
  const orig = process.env.FCC_SUN_SIDECAR_URL;
  delete process.env.FCC_SUN_SIDECAR_URL;
  try {
    assert.equal(makeFccSunClient(), null);
  } finally {
    if (orig !== undefined) process.env.FCC_SUN_SIDECAR_URL = orig;
  }
});

test('makeFccSunClient: constructed client carries hasToken flag', () => {
  const c1 = makeFccSunClient({ baseUrl: 'http://x', apiToken: 'abc', fetchFn: async () => ({}) });
  const c2 = makeFccSunClient({ baseUrl: 'http://x', fetchFn: async () => ({}) });
  assert.equal(c1.hasToken, true);
  assert.equal(c2.hasToken, false);
});

/* ---------- FCC timezone codes ---------- */

test('FCC_TIMEZONE_CODES: 13 entries covering A/a/B/b/C/c/D/d/E/F/f/G/g', () => {
  const codes = FCC_TIMEZONE_CODES.map((t) => t.code);
  assert.equal(FCC_TIMEZONE_CODES.length, 13);
  for (const c of ['A','a','B','b','C','c','D','d','E','F','f','G','g']){
    assert.ok(codes.includes(c), `missing FCC code ${c}`);
  }
});

test('isValidFccTzCode: accepts every documented code; rejects unknown', () => {
  for (const t of FCC_TIMEZONE_CODES) assert.equal(isValidFccTzCode(t.code), true);
  assert.equal(isValidFccTzCode('Z'), false);
  assert.equal(isValidFccTzCode(''), false);
  assert.equal(isValidFccTzCode(null), false);
});

/* ---------- default timezone picker ---------- */

test('defaultTzForLatLon: Arizona (KAZM) → D (Mountain Standard, year-round)', () => {
  // KAZM: 34.8608° N, 111.8203° W — Sedona, AZ
  assert.equal(defaultTzForLatLon(34.8608, -111.8203), 'D');
});

test('defaultTzForLatLon: Eastern US → B', () => {
  assert.equal(defaultTzForLatLon(40.7, -74.0), 'B');   // NYC
});

test('defaultTzForLatLon: Central US → C', () => {
  assert.equal(defaultTzForLatLon(41.8, -87.6), 'C');   // Chicago
});

test('defaultTzForLatLon: Pacific US → E', () => {
  assert.equal(defaultTzForLatLon(37.8, -122.4), 'E');  // SF
});

test('defaultTzForLatLon: Alaska → F', () => {
  assert.equal(defaultTzForLatLon(61.2, -149.9), 'F');  // Anchorage
});

test('defaultTzForLatLon: Hawaii → G', () => {
  assert.equal(defaultTzForLatLon(21.3, -157.9), 'G');  // Honolulu
});

test('defaultTzForLatLon: Puerto Rico → A (Atlantic Standard)', () => {
  assert.equal(defaultTzForLatLon(18.4, -66.1), 'A');   // San Juan
});

test('defaultTzForLatLon: bad inputs → safe default (B/EST)', () => {
  assert.equal(defaultTzForLatLon(NaN, NaN), 'B');
  assert.equal(defaultTzForLatLon(undefined, undefined), 'B');
});

/* ---------- fetchAmSun input validation ---------- */

function makeFakeFetch(handler){
  return async (url, init) => handler({ url, init });
}

test('fetchAmSun: rejects non-finite lat/lon', async () => {
  const c = makeFccSunClient({ baseUrl: 'http://x', fetchFn: makeFakeFetch(() => ({})) });
  const r = await c.fetchAmSun({ lat: NaN, lon: -75 });
  assert.equal(r.available, false);
  assert.match(r.error, /lat.*lon/);
});

test('fetchAmSun: rejects unknown FCC timezone code', async () => {
  const c = makeFccSunClient({ baseUrl: 'http://x', fetchFn: makeFakeFetch(() => ({})) });
  const r = await c.fetchAmSun({ lat: 40, lon: -75, tzone: 'Z' });
  assert.equal(r.available, false);
  assert.match(r.error, /FCC timezone codes/);
});

/* ---------- happy path + request shape ---------- */

const SAMPLE_PAYLOAD = {
  source: 'fcc_srsstime',
  timezone_code:  'D',
  timezone_label: 'Mountain Standard Time (Arizona)',
  input: { lat: 34.8608, lon: -111.8203 },
  dms: {
    lat: { degrees: 34, minutes: 51, seconds: 39 },
    lon: { degrees: 111, minutes: 49, seconds: 13 }
  },
  monthly: {
    1: { sunrise: '07:42', sunset: '17:34' },
    2: { sunrise: '07:25', sunset: '18:02' },
    3: { sunrise: '06:51', sunset: '18:25' }
  },
  replay: 'srsstime --lat 34.860833 --lon -111.820278 --tzone D'
};

test('fetchAmSun: success unwraps payload, stamps fetched_at + endpoint', async () => {
  let capturedUrl = null, capturedHeaders = null;
  const fetchFn = makeFakeFetch(({ url, init }) => {
    capturedUrl = url; capturedHeaders = init.headers;
    return { ok: true, json: async () => SAMPLE_PAYLOAD };
  });
  const c = makeFccSunClient({ baseUrl: 'http://sun.test', apiToken: 'secret', fetchFn });
  const r = await c.fetchAmSun({ lat: 34.8608, lon: -111.8203, tzone: 'D' });
  assert.equal(r.available, true);
  assert.equal(r.source, 'fcc_srsstime');
  assert.equal(r.timezone_code, 'D');
  assert.equal(r.monthly['1'].sunrise, '07:42');
  assert.ok(r.fetched_at);
  // URL includes the right query params + lat/lon rounded to 6 decimals.
  assert.match(capturedUrl, /\/api\/am\/sun\?lat=34\.860800&lon=-111\.820300&tzone=D/);
  assert.equal(capturedHeaders.authorization, 'Bearer secret');
});

test('fetchAmSun: HTTP error surfaces with status', async () => {
  const c = makeFccSunClient({ baseUrl: 'http://x',
    fetchFn: makeFakeFetch(() => ({ ok: false, status: 503 })) });
  const r = await c.fetchAmSun({ lat: 40, lon: -75, tzone: 'B' });
  assert.equal(r.available, false);
  assert.match(r.error, /HTTP 503/);
});

test('fetchAmSun: network error surfaced inline', async () => {
  const c = makeFccSunClient({ baseUrl: 'http://x',
    fetchFn: makeFakeFetch(() => { throw new Error('econnrefused'); }) });
  const r = await c.fetchAmSun({ lat: 40, lon: -75, tzone: 'B' });
  assert.equal(r.available, false);
  assert.match(r.error, /econnrefused/);
});

/* ---------- /healthz ---------- */

test('health: true on 200, false on network error', async () => {
  const ok = makeFccSunClient({ baseUrl: 'http://x',
    fetchFn: makeFakeFetch(() => ({ ok: true })) });
  const bad = makeFccSunClient({ baseUrl: 'http://x',
    fetchFn: makeFakeFetch(() => { throw new Error('down'); }) });
  assert.equal(await ok.health(), true);
  assert.equal(await bad.health(), false);
});

/* ---------- provenance ---------- */

test('FCC_SUN_CLIENT_PROVENANCE names §73.99 + §73.1209 + 17 USC §105', () => {
  assert.match(FCC_SUN_CLIENT_PROVENANCE.regulation, /73\.99/);
  assert.match(FCC_SUN_CLIENT_PROVENANCE.regulation, /73\.1209/);
  assert.match(FCC_SUN_CLIENT_PROVENANCE.license_basis, /17 USC §105/);
});
