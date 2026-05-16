// Unit tests for the FCCAM (AM skywave) sidecar client.
// Uses a synthetic fetchFn for full deterministic coverage — no live
// sidecar required.  See fccamClientIntegration.test.js for the
// live-sidecar suite (skipped by default; gated on FCCAM_SIDECAR_URL).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeFccamClient,
  midpointLatitude,
  FCCAM_CLIENT_PROVENANCE
} from '../evidence/fccamClient.js';

/* ---------- construction ---------- */

test('makeFccamClient returns null when baseUrl is unset', () => {
  // Strip env var for this assertion.
  const orig = process.env.FCCAM_SIDECAR_URL;
  delete process.env.FCCAM_SIDECAR_URL;
  try {
    assert.equal(makeFccamClient(), null);
  } finally {
    if (orig !== undefined) process.env.FCCAM_SIDECAR_URL = orig;
  }
});

test('makeFccamClient: hasToken reflects FCCAM_API_TOKEN', () => {
  const c1 = makeFccamClient({ baseUrl: 'http://x', apiToken: 'abc', fetchFn: async () => ({}) });
  const c2 = makeFccamClient({ baseUrl: 'http://x', fetchFn: async () => ({}) });
  assert.equal(c1.hasToken, true);
  assert.equal(c2.hasToken, false);
});

/* ---------- midpointLatitude ---------- */

test('midpointLatitude: identity for same-point inputs', () => {
  assert.equal(midpointLatitude(40, -80, 40, -80), 40);
});

test('midpointLatitude: NYC↔LA midpoint near 39.5° N', () => {
  // NYC ≈ (40.71, -74.01), LA ≈ (34.05, -118.24).  The great-circle
  // path bows north of the chord midpoint because the path is long
  // enough that sphericity matters — actual midpoint latitude is
  // ~39.5° N, not the chord midpoint of 37.4°.
  const m = midpointLatitude(40.71, -74.01, 34.05, -118.24);
  assert.ok(m > 38 && m < 41, `expected great-circle midpoint between 38 and 41°, got ${m}`);
});

test('midpointLatitude: NaN on non-finite inputs', () => {
  assert.ok(Number.isNaN(midpointLatitude(40, NaN, 40, -80)));
  assert.ok(Number.isNaN(midpointLatitude('x', -80, 40, -80)));
});

/* ---------- body validation ---------- */

const BASE_URL  = 'http://fccam.test';
const SAMPLE_OK = {
  ok: true, engine: 'fccam',
  field_uv_m: 123.4, flag: null,
  input_sha256: 'a'.repeat(64),
  engine_version: 'fccam-wang-1985',
  source_sha256:  'b'.repeat(64),
  stdout: 'ANSWER: FIELD =  1.234E+02 UV/M', stderr: ''
};

function makeFakeFetch(handler){
  return async (url, init) => {
    const u = new URL(url);
    const path = u.pathname;
    const body = init?.body ? JSON.parse(init.body) : null;
    const headers = init?.headers || {};
    return await handler({ url, path, body, headers, method: init?.method || 'GET' });
  };
}

test('fieldAtDistance: rejects freq off the 10-kHz AM grid', async () => {
  const c = makeFccamClient({ baseUrl: BASE_URL, fetchFn: async () => ({}) });
  const r = await c.fieldAtDistance({
    erp_kw: 50, freq_khz: 705, distance_km: 400, midpoint_lat: 39
  });
  assert.equal(r.available, false);
  assert.match(r.error, /10-kHz/);
});

test('fieldAtDistance: rejects freq outside the AM band', async () => {
  const c = makeFccamClient({ baseUrl: BASE_URL, fetchFn: async () => ({}) });
  for (const freq of [400, 100_000]){
    const r = await c.fieldAtDistance({
      erp_kw: 50, freq_khz: freq, distance_km: 400, midpoint_lat: 39
    });
    assert.equal(r.available, false, `freq ${freq} should reject`);
    assert.match(r.error, /AM band/);
  }
});

test('fieldAtDistance: rejects non-finite ERP / lat / distance', async () => {
  const c = makeFccamClient({ baseUrl: BASE_URL, fetchFn: async () => ({}) });
  const cases = [
    { erp_kw: NaN, freq_khz: 700, distance_km: 400, midpoint_lat: 39 },
    { erp_kw: 1,   freq_khz: 700, distance_km: 'x', midpoint_lat: 39 },
    { erp_kw: 1,   freq_khz: 700, distance_km: 400, midpoint_lat: undefined }
  ];
  for (const c0 of cases){
    const r = await c.fieldAtDistance(c0);
    assert.equal(r.available, false);
    assert.match(r.error, /finite number/);
  }
});

test('fieldAtDistance: rejects percent_time other than 10 or 50', async () => {
  const c = makeFccamClient({ baseUrl: BASE_URL, fetchFn: async () => ({}) });
  const r = await c.fieldAtDistance({
    erp_kw: 50, freq_khz: 700, distance_km: 400, midpoint_lat: 39,
    percent_time: 25
  });
  assert.equal(r.available, false);
  assert.match(r.error, /percent_time/);
});

test('distanceToField: requires positive field_uv_m', async () => {
  const c = makeFccamClient({ baseUrl: BASE_URL, fetchFn: async () => ({}) });
  for (const f of [0, -1, NaN, undefined]){
    const r = await c.distanceToField({
      erp_kw: 50, freq_khz: 700, midpoint_lat: 39, field_uv_m: f
    });
    assert.equal(r.available, false);
    assert.match(r.error, /field_uv_m/);
  }
});

/* ---------- request shape sent to the sidecar ---------- */

test('fieldAtDistance: posts canonical body shape to /run', async () => {
  let captured = null;
  const fetchFn = makeFakeFetch(async ({ path, body }) => {
    captured = { path, body };
    return { ok: true, json: async () => SAMPLE_OK };
  });
  const c = makeFccamClient({ baseUrl: BASE_URL, apiToken: 't', fetchFn });
  const r = await c.fieldAtDistance({
    erp_kw: 50, freq_khz: 700, distance_km: 425.7, midpoint_lat: 39.5
  });
  assert.equal(r.available, true);
  assert.equal(captured.path, '/run');
  assert.deepEqual(captured.body, {
    erp_kw: 50, freq_khz: 700, distance_km: 425.7, midpoint_lat: 39.5,
    percent_time: 50, mode: 'field_at_distance'
  });
});

test('fieldAtDistance: passes Authorization: Bearer when apiToken set', async () => {
  let captured = null;
  const fetchFn = makeFakeFetch(async ({ headers }) => {
    captured = headers;
    return { ok: true, json: async () => SAMPLE_OK };
  });
  const c = makeFccamClient({ baseUrl: BASE_URL, apiToken: 'secret', fetchFn });
  await c.fieldAtDistance({ erp_kw: 50, freq_khz: 700, distance_km: 400, midpoint_lat: 39 });
  assert.equal(captured.authorization, 'Bearer secret');
});

test('distanceToField: sends mode=distance_to_field + field_uv_m', async () => {
  let captured = null;
  const fetchFn = makeFakeFetch(async ({ body }) => {
    captured = body;
    return { ok: true, json: async () => ({ ...SAMPLE_OK, field_uv_m: null, distance_km: 425.7 }) };
  });
  const c = makeFccamClient({ baseUrl: BASE_URL, fetchFn });
  await c.distanceToField({
    erp_kw: 50, freq_khz: 700, midpoint_lat: 39, field_uv_m: 500
  });
  assert.equal(captured.mode, 'distance_to_field');
  assert.equal(captured.field_uv_m, 500);
});

/* ---------- response shape ---------- */

test('fieldAtDistance: success unwraps field_uv_m + carries replay metadata', async () => {
  const fetchFn = makeFakeFetch(async () => ({ ok: true, json: async () => SAMPLE_OK }));
  const c = makeFccamClient({ baseUrl: BASE_URL, fetchFn });
  const r = await c.fieldAtDistance({
    erp_kw: 50, freq_khz: 700, distance_km: 400, midpoint_lat: 39
  });
  assert.equal(r.available, true);
  assert.equal(r.source, 'fccam');
  assert.equal(r.field_uv_m, 123.4);
  assert.equal(r.input_sha256, 'a'.repeat(64));
  assert.equal(r.engine_version, 'fccam-wang-1985');
  assert.equal(r.source_sha256, 'b'.repeat(64));
});

test('fieldAtDistance: surfaces upstream HTTP error verbatim', async () => {
  const fetchFn = makeFakeFetch(async () => ({ ok: false, status: 503 }));
  const c = makeFccamClient({ baseUrl: BASE_URL, fetchFn });
  const r = await c.fieldAtDistance({
    erp_kw: 50, freq_khz: 700, distance_km: 400, midpoint_lat: 39
  });
  assert.equal(r.available, false);
  assert.match(r.error, /HTTP 503/);
});

test('fieldAtDistance: surfaces FORTRAN-side flag when ok=false', async () => {
  const fetchFn = makeFakeFetch(async () => ({
    ok: true,
    json: async () => ({ ok: false, flag: 'OFF_GRID_LATITUDE', stdout: '', stderr: '' })
  }));
  const c = makeFccamClient({ baseUrl: BASE_URL, fetchFn });
  const r = await c.fieldAtDistance({
    erp_kw: 50, freq_khz: 700, distance_km: 400, midpoint_lat: 39
  });
  assert.equal(r.available, false);
  assert.equal(r.error, 'OFF_GRID_LATITUDE');
});

/* ---------- batch ---------- */

test('runBatch: empty list rejected', async () => {
  const c = makeFccamClient({ baseUrl: BASE_URL, fetchFn: async () => ({}) });
  const r = await c.runBatch([]);
  assert.equal(r.available, false);
});

test('runBatch: aggregates n_ok / n_failed from server response', async () => {
  const fetchFn = makeFakeFetch(async ({ path, body }) => {
    assert.equal(path, '/run-batch');
    return {
      ok: true,
      json: async () => ({
        results: body.requests.map((req, i) => ({
          ok: i !== 1,
          engine: 'fccam',
          field_uv_m: i !== 1 ? 100 + i : null,
          flag: i === 1 ? 'OFF_GRID_LATITUDE' : null,
          input_sha256: 'x'.repeat(64),
          inputs: req
        }))
      })
    };
  });
  const c = makeFccamClient({ baseUrl: BASE_URL, fetchFn });
  const r = await c.runBatch([
    { erp_kw: 50, freq_khz: 700, distance_km: 400, midpoint_lat: 39 },
    { erp_kw: 50, freq_khz: 700, distance_km: 400, midpoint_lat: -91 },  // bogus lat — server rejects
    { erp_kw: 25, freq_khz: 820, distance_km: 700, midpoint_lat: 35 }
  ]);
  assert.equal(r.available, true);
  assert.equal(r.n_requests, 3);
  assert.equal(r.n_ok, 2);
  assert.equal(r.n_failed, 1);
});

test('runBatch: surfaces 404 when /run-batch is missing on the sidecar', async () => {
  const fetchFn = makeFakeFetch(async () => ({ ok: false, status: 404 }));
  const c = makeFccamClient({ baseUrl: BASE_URL, fetchFn });
  const r = await c.runBatch([{ erp_kw: 50, freq_khz: 700, distance_km: 400, midpoint_lat: 39 }]);
  assert.equal(r.available, false);
  assert.match(r.error, /run-batch not deployed/);
});

/* ---------- /version + /healthz ---------- */

test('version: returns the sidecar payload + fetched_at', async () => {
  const fetchFn = makeFakeFetch(async ({ path }) => {
    assert.equal(path, '/version');
    return {
      ok: true,
      json: async () => ({
        engine: 'fccam',
        version: 'fccam-wang-1985',
        source_sha256: 'c'.repeat(64),
        binary_sha256: 'd'.repeat(64),
        files: { 'Fccam.for': { sha256: 'c'.repeat(64), size: 12345 } }
      })
    };
  });
  const c = makeFccamClient({ baseUrl: BASE_URL, fetchFn });
  const v = await c.version();
  assert.equal(v.available, true);
  assert.equal(v.engine, 'fccam');
  assert.equal(v.source_sha256, 'c'.repeat(64));
  assert.ok(v.fetched_at);
});

test('health: true on 200, false on network error', async () => {
  const okFetch = makeFakeFetch(async () => ({ ok: true }));
  const errFetch = makeFakeFetch(async () => { throw new Error('econnrefused'); });
  assert.equal(await makeFccamClient({ baseUrl: BASE_URL, fetchFn: okFetch }).health(), true);
  assert.equal(await makeFccamClient({ baseUrl: BASE_URL, fetchFn: errFetch }).health(), false);
});

/* ---------- provenance ---------- */

test('FCCAM_CLIENT_PROVENANCE names §73.182 + §73.190(c) + 17 USC §105', () => {
  assert.match(FCCAM_CLIENT_PROVENANCE.regulation, /73\.182/);
  assert.match(FCCAM_CLIENT_PROVENANCE.regulation, /73\.190\(c\)/);
  assert.match(FCCAM_CLIENT_PROVENANCE.license_basis, /17 USC §105/);
});
