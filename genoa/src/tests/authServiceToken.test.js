// requireAuth — service-token branch.
//
// Validates the operator-CLI bypass header path:
//   - x-service-token: <token>
//   - Authorization:    Bearer <token>
// scoped to the whitelist in SERVICE_TOKEN_ROUTE_PATTERNS.
//
// Tests run the middleware directly with fake req/res — no server.

import test from 'node:test';
import assert from 'node:assert/strict';

// Module under test is env-sensitive at require time only for the
// cookie path; the service-token branch reads env at request time,
// so we can set/clear in beforeEach safely.
const AUTH_MOD = await import('../api/middleware/auth.js');
const { requireAuth, isServiceTokenRoute, verifyServiceToken } = AUTH_MOD;

function fakeReq({ path = '/geodata/manifest', headers = {} } = {}){
  return { path, headers };
}
function fakeRes(){
  const res = { statusCode: null, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json   = (b) => { res.body = b; return res; };
  return res;
}
async function run(req){
  const res = fakeRes();
  let called = false;
  await new Promise((resolve) => {
    requireAuth(req, res, () => { called = true; resolve(); });
    // requireAuth doesn't call next() on the error paths; resolve
    // synchronously so we don't hang the test.
    setImmediate(resolve);
  });
  return { res, called };
}

test.beforeEach(() => {
  // Cookie auth misconfigured by default — proves the service-token
  // path doesn't depend on cookie env.
  delete process.env.AUTH_PASSWORD_HASH;
  delete process.env.AUTH_SESSION_SECRET;
  delete process.env.GENOA_SERVICE_TOKEN;
});

test('isServiceTokenRoute allowlist: read-only routes only (geodata + am/physics + facilities + geo-rf-evidence)', () => {
  // Allowlisted read-only routes — service token (CI / operator) is accepted.
  assert.equal(isServiceTokenRoute('/geodata/manifest'),         true);
  assert.equal(isServiceTokenRoute('/geodata/clutter'),          true);
  assert.equal(isServiceTokenRoute('/geodata/terrain/status'),   true);
  assert.equal(isServiceTokenRoute('/geodata'),                  true);
  assert.equal(isServiceTokenRoute('/am/physics/health'),        true);
  assert.equal(isServiceTokenRoute('/am/physics/somnec'),        true);
  assert.equal(isServiceTokenRoute('/am/physics'),               true);
  assert.equal(isServiceTokenRoute('/facilities/search'),        true);
  assert.equal(isServiceTokenRoute('/facilities/53588'),         true);
  assert.equal(isServiceTokenRoute('/facilities'),               true);
  assert.equal(isServiceTokenRoute('/geo-rf-evidence/health'),   true);
  assert.equal(isServiceTokenRoute('/geo-rf-evidence/sample'),   true);
  assert.equal(isServiceTokenRoute('/geo-rf-evidence'),          true);
  // Write endpoints — must stay cookie-only.
  assert.equal(isServiceTokenRoute('/exhibits/compute'),         false);
  assert.equal(isServiceTokenRoute('/exhibits/save'),            false);
  assert.equal(isServiceTokenRoute('/am-da/design'),             false);
  assert.equal(isServiceTokenRoute('/am-night/nif'),             false);
  assert.equal(isServiceTokenRoute('/auth/login'),               false);
  // Substring near-misses must NOT match (anchored regex).
  assert.equal(isServiceTokenRoute('/x/geodata/manifest'),       false);
  assert.equal(isServiceTokenRoute('/facilitiesx'),              false);
  assert.equal(isServiceTokenRoute('/geo-rf-evidencex'),         false);
});

test('verifyServiceToken is constant-time and supports rotation', () => {
  assert.equal(verifyServiceToken('abc', ['abc']), true);
  assert.equal(verifyServiceToken('abc', ['old', 'abc']), true);
  assert.equal(verifyServiceToken('xyz', ['abc']), false);
  assert.equal(verifyServiceToken('',    ['abc']), false);
  assert.equal(verifyServiceToken('abc', []),      false);
  // Length-different tokens must not throw (timingSafeEqual rejects
  // unequal-length buffers — we short-circuit before that).
  assert.equal(verifyServiceToken('abcdef', ['abc']), false);
});

test('valid x-service-token on whitelisted route → next() called', async () => {
  process.env.GENOA_SERVICE_TOKEN = 'sv_t_test_secret_value_32_chars__';
  const req = fakeReq({
    path: '/geodata/manifest',
    headers: { 'x-service-token': 'sv_t_test_secret_value_32_chars__' }
  });
  const { res, called } = await run(req);
  assert.equal(called, true);
  assert.equal(res.statusCode, null);
  assert.deepEqual(req.session, { kind: 'service', auth: 'service_token' });
});

test('valid Authorization: Bearer on whitelisted route → next() called', async () => {
  process.env.GENOA_SERVICE_TOKEN = 'sv_t_test_secret_value_32_chars__';
  const req = fakeReq({
    path: '/geodata/clutter',
    headers: { authorization: 'Bearer sv_t_test_secret_value_32_chars__' }
  });
  const { called } = await run(req);
  assert.equal(called, true);
  assert.equal(req.session.auth, 'service_token');
});

test('wrong service token → 401 INVALID_SERVICE_TOKEN (no fall-through)', async () => {
  process.env.GENOA_SERVICE_TOKEN = 'sv_t_test_secret_value_32_chars__';
  const req = fakeReq({
    path: '/geodata/manifest',
    headers: { 'x-service-token': 'wrong-token-value' }
  });
  const { res, called } = await run(req);
  assert.equal(called, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'INVALID_SERVICE_TOKEN');
});

test('service token presented but no GENOA_SERVICE_TOKEN configured → 503', async () => {
  // No GENOA_SERVICE_TOKEN env.
  const req = fakeReq({
    path: '/geodata/manifest',
    headers: { 'x-service-token': 'anything' }
  });
  const { res, called } = await run(req);
  assert.equal(called, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'SERVICE_TOKEN_NOT_CONFIGURED');
});

test('rotation: two configured tokens, either works', async () => {
  process.env.GENOA_SERVICE_TOKEN = 'newToken_32_chars_padding_aaaaaa, oldToken_32_chars_padding_aaaaaa';
  for (const t of ['newToken_32_chars_padding_aaaaaa', 'oldToken_32_chars_padding_aaaaaa']){
    const req = fakeReq({
      path: '/geodata/manifest',
      headers: { 'x-service-token': t }
    });
    const { called } = await run(req);
    assert.equal(called, true, `rotation token ${t.slice(0,8)}… should authenticate`);
  }
});

test('service token on a non-whitelisted route is ignored — cookie auth still required', async () => {
  process.env.GENOA_SERVICE_TOKEN  = 'sv_t_test_secret_value_32_chars__';
  // Cookie env intentionally missing to prove the service token is NOT
  // honored on a non-whitelisted path.
  const req = fakeReq({
    path: '/exhibits/compute',
    headers: { 'x-service-token': 'sv_t_test_secret_value_32_chars__' }
  });
  const { res, called } = await run(req);
  assert.equal(called, false);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'AUTH_NOT_CONFIGURED');
});

test('no service token header, no cookie → cookie path still rules (503 / 401)', async () => {
  process.env.GENOA_SERVICE_TOKEN  = 'sv_t_test_secret_value_32_chars__';
  const req = fakeReq({ path: '/geodata/manifest', headers: {} });
  const { res, called } = await run(req);
  assert.equal(called, false);
  // Cookie env missing → AUTH_NOT_CONFIGURED.  This proves the service
  // token path doesn't accidentally bless cookie-less requests.
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, 'AUTH_NOT_CONFIGURED');
});
