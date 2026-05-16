import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

let proc, baseUrl;
// Session cookie signed with the same secret the server is launched
// with — the auth middleware now refuses to run when AUTH_* env is
// missing, so every /api/* request must present a valid session.
let sessionCookie;

// Build a server.js-compatible session cookie without going through
// /api/auth/login (avoids paying scrypt cost in every test run).
// Mirrors signSession() in src/api/middleware/auth.js.
function signTestSession(secret, ttlSeconds = 3600){
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + ttlSeconds }))
    .toString('base64url');
  const sig = crypto.createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

// Wrapper that auto-attaches the session cookie + JSON content-type.
async function api(pathname, init = {}){
  const headers = { ...(init.headers || {}), cookie: `genoa_session=${sessionCookie}` };
  return fetch(baseUrl + pathname, { ...init, headers });
}

test.before(async () => {
  const port = 18099 + Math.floor(Math.random() * 100);
  baseUrl = `http://127.0.0.1:${port}`;
  // Synthetic auth config — the password hash is a syntactically valid
  // scrypt$salt$hash placeholder; we sign cookies directly with the
  // secret so the password value itself is never exercised.
  const AUTH_SESSION_SECRET = 'genoa-test-session-secret-do-not-use-in-prod-32b';
  const AUTH_PASSWORD_HASH  = 'scrypt$00$00';
  sessionCookie = signTestSession(AUTH_SESSION_SECRET);
  proc = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATABASE_URL: '',
           AUTH_PASSWORD_HASH, AUTH_SESSION_SECRET,
           // Service-token bypass for operator CLI verification of the
           // geodata routes — exercised below in the geodata auth tests.
           GENOA_SERVICE_TOKEN: 'svc_token_test_value_must_be_long_enough_aa',
           // Disable the FCC FMQ default fallback so the
           // "no upstream configured" assertions still hold under test.
           // The FMQ path is exercised separately in fccFmq.test.js.
           FACILITY_DISABLE_FCC_FMQ: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await waitForHealth(baseUrl + '/healthz', 5000);
});

test.after(async () => {
  if (proc){ proc.kill('SIGTERM'); }
});

test('GET /healthz returns ok', async () => {
  const r = await fetch(baseUrl + '/healthz');
  assert.equal(r.status, 200);
  assert.equal((await r.text()).trim(), 'ok');
});

test('GET /api/curves returns the manifest with sha256s', async () => {
  const r = await api('/api/curves');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.version);
  assert.ok(j.meta_sha256);
  assert.ok(j.datasets?.f5050);
});

test('POST /api/exhibits/compute returns a schema-valid v2 exhibit', async () => {
  const r = await api('/api/exhibits/compute', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      inputs: { call:'WAPI-FM', facility_id:'1', service:'FM', fcc_class:'A',
                frequency:98.7, erp_kw:6, haat_m:100,
                lat:37.0902, lon:-95.7129, radial_step_deg:45 }
    })
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.schema.name, 'genoa.exhibit.v2');
  assert.ok(j.engine_signature?.module);
  assert.ok(Array.isArray(j.blockers));
  assert.equal(typeof j.degraded_mode, 'boolean');
  assert.ok(j.calculation_trace);
});

test('GET /api/validation returns regression + authoritative counters', async () => {
  const r = await api('/api/validation');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok('n_run' in j);
  assert.ok('n_pass' in j);
  assert.ok('n_regression_run' in j);
  assert.ok('authoritative_pass' in j);
});

test('Persistence routes return 503 when no DATABASE_URL is configured', async () => {
  const r = await api('/api/exhibits');
  assert.equal(r.status, 503);
});

test('PDF export route returns a PDF or 404/503 when the row is unavailable', async () => {
  const r = await api('/api/exhibits/123/export/pdf');
  // 503 (no DB) or 404 (row not found) when persistence is unavailable;
  // 200 + application/pdf when the row exists.  The PDF renderer is now
  // wired via @pdfme/generator (no more 501).
  assert.ok([200, 404, 503].includes(r.status));
  if (r.status === 200){
    assert.equal(r.headers.get('content-type'), 'application/pdf');
  }
});

test('GET /api/facilities/search with no upstream configured -> 503 + FACILITY_LOOKUP_UNAVAILABLE', async () => {
  const r = await api('/api/facilities/search?q=KSLX');
  assert.equal(r.status, 503);
  const j = await r.json();
  assert.equal(j.error, 'FACILITY_LOOKUP_UNAVAILABLE');
  assert.equal(j.warning?.code, 'FACILITY_LOOKUP_UNAVAILABLE');
});

test('GET /api/facilities/:id with no upstream configured -> 503', async () => {
  const r = await api('/api/facilities/11282');
  assert.equal(r.status, 503);
});

test('GET /api/facilities/search with q too short -> 400', async () => {
  const r = await api('/api/facilities/search?q=K');
  assert.equal(r.status, 400);
});

test('POST /api/exhibits/save without DATABASE_URL returns JSON ephemeral ack (never HTML)', async () => {
  // Minimal compute payload — the service computes then tries to
  // persist, hits PersistenceUnavailable, and falls back to ephemeral.
  // The CRITICAL invariant is: response is always application/json
  // with a parseable body, so the frontend's readJsonOrThrow doesn't
  // crash on "<!DOCTYPE …".
  const r = await api('/api/exhibits/save', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify({
      inputs: {
        call: 'WTEST-FM', service: 'FM', fcc_class: 'A',
        frequency: 98.7, erp_kw: 6, haat_m: 100,
        lat: 37.0902, lon: -95.7129, radial_step_deg: 45
      }
    })
  });
  assert.equal(r.status, 200, 'ephemeral fallback returns 200, not 503');
  assert.match(r.headers.get('content-type') || '', /application\/json/i,
    'response MUST be JSON, never HTML — this is the bug guard');
  const j = await r.json();
  assert.equal(j.status, 'ok');
  assert.equal(j.saved, false);
  assert.equal(j.mode,  'ephemeral');
  assert.match(j.message || '', /Persistence unavailable/i);
});

test('POST /api/exhibits/save with empty body returns JSON (never HTML)', async () => {
  // The CRITICAL invariant: even malformed/empty bodies get a JSON
  // response.  The frontend's readJsonOrThrow will then receive a
  // structured error instead of crashing on "<!DOCTYPE …".
  const r = await api('/api/exhibits/save', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    '{}'
  });
  assert.match(r.headers.get('content-type') || '', /application\/json/i,
    'response MUST be JSON, never HTML');
  const j = await r.json();
  // It either returns 400 BAD_REQUEST or falls through to ephemeral
  // — either is fine for the bug-guard.  What matters is the body parses.
  assert.ok(typeof j === 'object' && j !== null);
  if (j.error){
    assert.equal(j.error, 'BAD_REQUEST');
    assert.equal(j.saved, false);
  } else {
    assert.equal(j.saved, false);
    assert.equal(j.mode,  'ephemeral');
  }
});

// ── Geodata service-token auth ───────────────────────────────────
//
// The geodata evidence endpoints are reachable both via cookie
// session AND via GENOA_SERVICE_TOKEN headers (for operator CLI
// verification).  These tests exercise the live HTTP path.

test('GET /api/geodata/manifest with valid x-service-token → 200, no cookie needed', async () => {
  const r = await fetch(baseUrl + '/api/geodata/manifest', {
    headers: { 'x-service-token': 'svc_token_test_value_must_be_long_enough_aa' }
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.layers));
  assert.ok(j.layers.find((l) => l.id === 'nlcd_impervious_2024'));
});

test('GET /api/geodata/manifest with Authorization: Bearer → 200', async () => {
  const r = await fetch(baseUrl + '/api/geodata/manifest', {
    headers: { authorization: 'Bearer svc_token_test_value_must_be_long_enough_aa' }
  });
  assert.equal(r.status, 200);
});

test('GET /api/geodata/manifest with wrong service token → 401 INVALID_SERVICE_TOKEN', async () => {
  const r = await fetch(baseUrl + '/api/geodata/manifest', {
    headers: { 'x-service-token': 'definitely-wrong' }
  });
  assert.equal(r.status, 401);
  const j = await r.json();
  assert.equal(j.error, 'INVALID_SERVICE_TOKEN');
});

test('GET /api/geodata/manifest with no auth at all → 401 UNAUTHENTICATED', async () => {
  const r = await fetch(baseUrl + '/api/geodata/manifest');
  assert.equal(r.status, 401);
});

test('Service token does NOT unlock write endpoints (e.g. /api/exhibits/compute)', async () => {
  const r = await fetch(baseUrl + '/api/exhibits/compute', {
    method: 'POST',
    headers: {
      'content-type':    'application/json',
      'x-service-token': 'svc_token_test_value_must_be_long_enough_aa'
    },
    body: JSON.stringify({})
  });
  // Not a 200 — service token isn't honored on non-whitelisted routes,
  // so cookie auth would be required.  No valid cookie → 401.
  assert.equal(r.status, 401);
});

async function waitForHealth(url, timeoutMs){
  const start = Date.now();
  while (Date.now() - start < timeoutMs){
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not become healthy in ' + timeoutMs + 'ms');
}
