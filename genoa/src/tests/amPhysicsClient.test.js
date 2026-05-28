import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeAmPhysicsClient,
  sigmaMsmToSm,
  khzToMhz,
  DEFAULT_EPR,
  DEFAULT_GROUND_SIGMA_MS_M,
  AM_PHYSICS_CLIENT_PROVENANCE
} from '../evidence/amPhysicsClient.js';

/* ---------- construction ---------- */

test('makeAmPhysicsClient: null when AM_PHYSICS_SIDECAR_URL unset', () => {
  const orig = process.env.AM_PHYSICS_SIDECAR_URL;
  delete process.env.AM_PHYSICS_SIDECAR_URL;
  try {
    assert.equal(makeAmPhysicsClient(), null);
  } finally {
    if (orig !== undefined) process.env.AM_PHYSICS_SIDECAR_URL = orig;
  }
});

test('makeAmPhysicsClient: constructed client carries hasToken flag', () => {
  const c1 = makeAmPhysicsClient({ baseUrl: 'http://x', apiToken: 'abc', fetchFn: async () => ({}) });
  const c2 = makeAmPhysicsClient({ baseUrl: 'http://x', fetchFn: async () => ({}) });
  assert.equal(c1.hasToken, true);
  assert.equal(c2.hasToken, false);
});

/* ---------- unit conversions ---------- */

test('sigmaMsmToSm: converts 8 mS/m to 0.008 S/m', () => {
  assert.equal(sigmaMsmToSm(8), 0.008);
  assert.equal(sigmaMsmToSm(15), 0.015);
});

test('sigmaMsmToSm: bad inputs return null', () => {
  assert.equal(sigmaMsmToSm(NaN), null);
  assert.equal(sigmaMsmToSm(undefined), null);
  assert.equal(sigmaMsmToSm('bad'), null);
});

test('khzToMhz: 780 kHz → 0.780 MHz', () => {
  assert.equal(khzToMhz(780), 0.780);
  assert.equal(khzToMhz(1060), 1.060);
});

test('khzToMhz: bad inputs return null', () => {
  assert.equal(khzToMhz(undefined), null);
  assert.equal(khzToMhz(null), null);
});

test('DEFAULT_EPR is 15 (NEC average-soil convention)', () => {
  assert.equal(DEFAULT_EPR, 15);
});

test('DEFAULT_GROUND_SIGMA_MS_M is 8 mS/m (§73.190 Figure R3 default)', () => {
  assert.equal(DEFAULT_GROUND_SIGMA_MS_M, 8);
});

/* ---------- runSomnec input validation ---------- */

function makeFakeFetch(handler){
  return async (url, init) => handler({ url, init });
}

test('runSomnec: rejects non-positive epr', async () => {
  const c = makeAmPhysicsClient({ baseUrl: 'http://x', fetchFn: makeFakeFetch(() => ({})) });
  const r = await c.runSomnec({ epr: 0, sig_s_m: 0.008, frequency_mhz: 0.780 });
  assert.equal(r.available, false);
  assert.match(r.error, /epr/);
});

test('runSomnec: rejects non-positive conductivity', async () => {
  const c = makeAmPhysicsClient({ baseUrl: 'http://x', fetchFn: makeFakeFetch(() => ({})) });
  const r = await c.runSomnec({ epr: 15, sig_s_m: -1, frequency_mhz: 0.780 });
  assert.equal(r.available, false);
  assert.match(r.error, /sig_s_m/);
});

test('runSomnec: rejects non-positive frequency', async () => {
  const c = makeAmPhysicsClient({ baseUrl: 'http://x', fetchFn: makeFakeFetch(() => ({})) });
  const r = await c.runSomnec({ epr: 15, sig_s_m: 0.008, frequency_mhz: 0 });
  assert.equal(r.available, false);
  assert.match(r.error, /frequency_mhz/);
});

/* ---------- happy path + request shape ---------- */

const SAMPLE_PAYLOAD = {
  ok:       true,
  engine:   'somnec2d',
  advisory: true,
  inputs:   { epr: 15, sig_s_m: 0.008, frequency_mhz: 0.780 },
  outputs:  {
    grid_file:    'SOM2D.NEC',
    grid_sha256:  '4ba81a0692907b073bfedbeed2ba7964dfc6010587e79983fb8bd6e9cb6b0fab',
    grid_created: true
  },
  stdout_summary: {
    epscf:        '(15.000, -184.369)',
    ar1_1_1:      '(-3.040, -188.095)',
    time_seconds: 0.04749
  }
};

test('runSomnec: success unwraps payload, stamps fetched_at + endpoint', async () => {
  let capturedUrl = null, capturedBody = null, capturedHeaders = null;
  const fetchFn = makeFakeFetch(({ url, init }) => {
    capturedUrl     = url;
    capturedBody    = JSON.parse(init.body);
    capturedHeaders = init.headers;
    return { ok: true, json: async () => SAMPLE_PAYLOAD };
  });
  const c = makeAmPhysicsClient({ baseUrl: 'http://amphys.test', fetchFn });
  const r = await c.runSomnec({ epr: 15, sig_s_m: 0.008, frequency_mhz: 0.780, print_grid: 1 });
  assert.equal(r.available, true);
  assert.equal(r.engine, 'somnec2d');
  assert.equal(r.advisory, true);
  assert.equal(r.outputs.grid_sha256, SAMPLE_PAYLOAD.outputs.grid_sha256);
  assert.ok(r.fetched_at);
  // Request shape: POST to /run/somnec with the right body.
  assert.match(capturedUrl, /\/run\/somnec$/);
  assert.equal(capturedBody.epr, 15);
  assert.equal(capturedBody.sig_s_m, 0.008);
  assert.equal(capturedBody.frequency_mhz, 0.780);
  assert.equal(capturedBody.print_grid, 1);
  // No bearer when no token supplied.
  assert.equal(capturedHeaders.authorization, undefined);
});

test('runSomnec: bearer token header added when configured', async () => {
  let capturedHeaders = null;
  const fetchFn = makeFakeFetch(({ init }) => {
    capturedHeaders = init.headers;
    return { ok: true, json: async () => SAMPLE_PAYLOAD };
  });
  const c = makeAmPhysicsClient({ baseUrl: 'http://x', apiToken: 'secret', fetchFn });
  await c.runSomnec({ epr: 15, sig_s_m: 0.008, frequency_mhz: 0.780 });
  assert.equal(capturedHeaders.authorization, 'Bearer secret');
});

test('runSomnec: HTTP error surfaces with status', async () => {
  const c = makeAmPhysicsClient({ baseUrl: 'http://x',
    fetchFn: makeFakeFetch(() => ({ ok: false, status: 503 })) });
  const r = await c.runSomnec({ epr: 15, sig_s_m: 0.008, frequency_mhz: 0.780 });
  assert.equal(r.available, false);
  assert.match(r.error, /HTTP 503/);
});

test('runSomnec: sidecar ok:false envelope is treated as failure', async () => {
  const c = makeAmPhysicsClient({ baseUrl: 'http://x',
    fetchFn: makeFakeFetch(() => ({ ok: true, json: async () => ({ ok: false, error: 'somnec crashed' }) })) });
  const r = await c.runSomnec({ epr: 15, sig_s_m: 0.008, frequency_mhz: 0.780 });
  assert.equal(r.available, false);
  assert.match(r.error, /somnec crashed/);
});

test('runSomnec: network error surfaced inline; never throws upward', async () => {
  const c = makeAmPhysicsClient({ baseUrl: 'http://x',
    fetchFn: makeFakeFetch(() => { throw new Error('econnrefused'); }) });
  const r = await c.runSomnec({ epr: 15, sig_s_m: 0.008, frequency_mhz: 0.780 });
  assert.equal(r.available, false);
  assert.match(r.error, /econnrefused/);
});

/* ---------- /healthz ---------- */

test('health: true on {ok:true}; false on non-ok body or network error', async () => {
  const ok = makeAmPhysicsClient({ baseUrl: 'http://x',
    fetchFn: makeFakeFetch(() => ({ ok: true, json: async () => ({ ok: true, engine: 'somnec2d' }) })) });
  const notOk = makeAmPhysicsClient({ baseUrl: 'http://x',
    fetchFn: makeFakeFetch(() => ({ ok: true, json: async () => ({ ok: false }) })) });
  const bad = makeAmPhysicsClient({ baseUrl: 'http://x',
    fetchFn: makeFakeFetch(() => { throw new Error('down'); }) });
  assert.equal(await ok.health(), true);
  assert.equal(await notOk.health(), false);
  assert.equal(await bad.health(), false);
});

/* ---------- provenance ---------- */

test('AM_PHYSICS_CLIENT_PROVENANCE names SOMNEC2D + advisory posture', () => {
  assert.match(AM_PHYSICS_CLIENT_PROVENANCE.upstream, /SOMNEC2D/);
  assert.match(AM_PHYSICS_CLIENT_PROVENANCE.posture, /ADVISORY/);
  assert.match(AM_PHYSICS_CLIENT_PROVENANCE.posture, /73\.184/);
});
