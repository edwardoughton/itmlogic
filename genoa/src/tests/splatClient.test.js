// SPLAT sidecar client tests.  All upstreams mocked; no real splat is
// contacted.  Tests cover:
//
//   - With no SPLAT_SIDECAR_URL configured, makeSplatClient returns null.
//   - capability() reports reachable when /version 200s, surfaces the
//     new metadata fields (splat_version, git_commit_sha, build_time,
//     auth_required, sdf_dir), and computes dem_provisioned from a
//     live /api/v1/sdf probe (true when count>0, false when count==0,
//     null when /sdf is unreachable).
//   - capability() reports unreachable + error string on /version failure.
//   - run() forwards body shape to /api/v1/splat/run and reports
//     available iff returncode === 0.
//   - DEM-missing (returncode != 0) surfaces honestly without faking
//     a SPLAT result.
//   - Auth: when apiToken is set, every endpoint receives
//     `Authorization: Bearer <token>`; when unset, the header is omitted.
//   - SDF lifecycle: list / upload / delete forward correctly.
//   - Artifact list + fetch return parsed JSON / raw bytes respectively.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeSplatClient } from '../evidence/terrain/splatClient.js';

function mockFetch(handler){
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => handler(String(url), opts);
  return () => { globalThis.fetch = orig; };
}
function jsonResp(body, ok = true, status){
  return {
    ok,
    status:  status ?? (ok ? 200 : 502),
    headers: { get: () => null },
    json:    async () => body,
    arrayBuffer: async () => new ArrayBuffer(0)
  };
}
function bytesResp(bytes, ok = true, status, contentType = 'application/octet-stream'){
  const ab = bytes.buffer instanceof ArrayBuffer ? bytes.buffer : new Uint8Array(bytes).buffer;
  return {
    ok,
    status:  status ?? (ok ? 200 : 404),
    headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? contentType : null) },
    json:    async () => ({}),
    arrayBuffer: async () => ab
  };
}

// ---------------- constructor ----------------

test('makeSplatClient returns null when SPLAT_SIDECAR_URL is unset', () => {
  assert.equal(makeSplatClient({ baseUrl: null }), null);
});

test('auth_configured reflects whether apiToken was supplied', () => {
  const a = makeSplatClient({ baseUrl: 'http://x', apiToken: null });
  const b = makeSplatClient({ baseUrl: 'http://x', apiToken: 'sekret' });
  const c = makeSplatClient({ baseUrl: 'http://x', apiToken: '   ' });  // whitespace -> null
  assert.equal(a.auth_configured, false);
  assert.equal(b.auth_configured, true);
  assert.equal(c.auth_configured, false);
});

// ---------------- capability() ----------------

test('capability(): reachable sidecar with full version metadata + dem_provisioned=true', async () => {
  const restore = mockFetch((url) => {
    if (url.endsWith('/version')) {
      return jsonResp({
        sidecar:        'genoa-splat-sidecar',
        splat_bin:      '/app/splat',
        splat_version:  'splat 1.4.2',
        git_commit_sha: 'abc123',
        build_time:     '2026-05-07T00:00:00Z',
        workdir:        '/app/work',
        sdf_dir:        'sdf',
        auth_required:  false
      });
    }
    if (url.endsWith('/api/v1/sdf')) {
      return jsonResp({ sdf_dir: 'sdf', max_upload_bytes: 67108864, count: 4, tiles: [] });
    }
    return jsonResp({}, false, 404);
  });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.capability();
    assert.equal(r.available, true);
    assert.equal(r.source, 'splat-sidecar');
    assert.equal(r.sidecar_name, 'genoa-splat-sidecar');
    assert.equal(r.splat_bin, '/app/splat');
    assert.equal(r.splat_version, 'splat 1.4.2');
    assert.equal(r.git_commit_sha, 'abc123');
    assert.equal(r.build_time, '2026-05-07T00:00:00Z');
    assert.equal(r.sdf_dir, 'sdf');
    assert.equal(r.auth_required, false);
    assert.equal(r.tile_count, 4);
    assert.equal(r.dem_provisioned, true);
    assert.match(r.notes, /4 terrain tile/);
  } finally { restore(); }
});

test('capability(): tile_count=0 -> dem_provisioned=false with provisioning hint', async () => {
  const restore = mockFetch((url) => {
    if (url.endsWith('/version')) return jsonResp({ sidecar: 'genoa-splat-sidecar', auth_required: false });
    if (url.endsWith('/api/v1/sdf')) return jsonResp({ sdf_dir: 'sdf', count: 0, tiles: [] });
    return jsonResp({}, false, 404);
  });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.capability();
    assert.equal(r.tile_count, 0);
    assert.equal(r.dem_provisioned, false);
    assert.match(r.notes, /no terrain tiles provisioned/);
  } finally { restore(); }
});

test('capability(): /sdf unreachable -> dem_provisioned=null with diagnostic note', async () => {
  const restore = mockFetch((url) => {
    if (url.endsWith('/version')) return jsonResp({ sidecar: 'genoa-splat-sidecar' });
    if (url.endsWith('/api/v1/sdf')) return jsonResp({}, false, 503);
    return jsonResp({}, false, 404);
  });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.capability();
    assert.equal(r.available, true);
    assert.equal(r.tile_count, null);
    assert.equal(r.dem_provisioned, null);
    assert.match(r.notes, /tile inventory could not be probed/);
  } finally { restore(); }
});

test('capability(): unreachable sidecar reports error', async () => {
  const restore = mockFetch(() => { throw new Error('connect ECONNREFUSED'); });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.capability();
    assert.equal(r.available, false);
    assert.equal(r.reachable, false);
    assert.match(r.error, /ECONNREFUSED/);
  } finally { restore(); }
});

test('capability(): non-2xx /version is treated as unreachable', async () => {
  const restore = mockFetch(() => jsonResp({}, false, 503));
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.capability();
    assert.equal(r.available, false);
    assert.equal(r.reachable, false);
  } finally { restore(); }
});

test('capability(): auth_required surfaced from sidecar /version', async () => {
  const restore = mockFetch((url) => {
    if (url.endsWith('/version')) return jsonResp({ sidecar: 'genoa-splat-sidecar', auth_required: true });
    if (url.endsWith('/api/v1/sdf')) return jsonResp({ count: 0, tiles: [] });
    return jsonResp({}, false, 404);
  });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test', apiToken: 'sekret' });
    const r = await c.capability();
    assert.equal(r.auth_required, true);
    assert.equal(r.auth_configured, true);
  } finally { restore(); }
});

// ---------------- run() ----------------

test('run(): forwards body and reports available when returncode===0', async () => {
  let captured = null;
  const restore = mockFetch((url, opts) => {
    captured = { url, body: JSON.parse(opts.body), headers: opts.headers };
    return jsonResp({
      command:        ['/app/splat', '-t', 'tx.qth'],
      command_string: 'splat -t tx.qth',
      returncode:     0,
      stdout:         'ok',
      stderr:         ''
    });
  });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.run({ tx_qth: 'tx.qth', flags: ['-c', '10.0'], timeout_seconds: 10 });
    assert.equal(r.available, true);
    assert.equal(r.source, 'splat-sidecar');
    assert.equal(r.returncode, 0);
    assert.match(captured.url, /\/api\/v1\/splat\/run$/);
    assert.equal(captured.body.tx_qth, 'tx.qth');
    assert.deepEqual(captured.body.flags, ['-c', '10.0']);
    assert.equal(captured.body.timeout_seconds, 10);
  } finally { restore(); }
});

test('run(): returncode!=0 reports available=false (DEM-missing or splat error)', async () => {
  const restore = mockFetch(() => jsonResp({
    command:        ['/app/splat', '-t', 'tx.qth'],
    command_string: 'splat -t tx.qth',
    returncode:     1,
    stdout:         '',
    stderr:         'No DEM data found for region.'
  }));
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.run({ tx_qth: 'tx.qth' });
    assert.equal(r.available, false, 'returncode != 0 must NOT be reported as available');
    assert.equal(r.returncode, 1);
    assert.match(r.stderr, /No DEM/);
  } finally { restore(); }
});

test('run(): missing tx_qth short-circuits before network', async () => {
  let called = false;
  const restore = mockFetch(() => { called = true; return jsonResp({}); });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.run({});
    assert.equal(called, false);
    assert.equal(r.available, false);
    assert.match(r.error, /tx_qth required/);
  } finally { restore(); }
});

test('run(): network failure is reported, not silently dropped', async () => {
  const restore = mockFetch(() => { throw new Error('socket hang up'); });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.run({ tx_qth: 'tx.qth' });
    assert.equal(r.available, false);
    assert.match(r.error, /socket hang up/);
  } finally { restore(); }
});

// ---------------- auth header forwarding ----------------

test('auth: Authorization header is sent on every endpoint when apiToken is set', async () => {
  const seen = {};
  const restore = mockFetch((url, opts = {}) => {
    const key = url.split(/\?/)[0].split(/\/api\/v1\//)[1] || url.split('http://splat.test')[1];
    seen[key] = (opts.headers || {}).Authorization || null;
    if (url.endsWith('/version')) return jsonResp({ sidecar: 'g', auth_required: true });
    if (url.endsWith('/api/v1/sdf')) return jsonResp({ count: 1, tiles: [{ name: 'x.sdf' }] });
    if (url.endsWith('/api/v1/artifacts')) return jsonResp({ count: 0, artifacts: [] });
    if (url.includes('/api/v1/sdf/')) return jsonResp({ name: 'x.sdf' });
    if (url.includes('/api/v1/artifacts/')) return bytesResp(new Uint8Array([1, 2, 3]));
    if (url.endsWith('/api/v1/splat/run')) return jsonResp({ command: [], command_string: '', returncode: 0, stdout: '', stderr: '' });
    return jsonResp({}, false, 404);
  });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test', apiToken: 'sekret' });
    await c.version();
    await c.listSdfTiles();
    await c.listArtifacts();
    await c.uploadSdfTile('x.sdf', new Uint8Array([1, 2]));
    await c.deleteSdfTile('x.sdf');
    await c.getArtifact('out/coverage.ppm');
    await c.run({ tx_qth: 'tx.qth' });
    for (const [k, v] of Object.entries(seen)){
      assert.equal(v, 'Bearer sekret', `endpoint ${k} did not receive Authorization header`);
    }
  } finally { restore(); }
});

test('auth: Authorization header is omitted when apiToken is null', async () => {
  const seen = {};
  const restore = mockFetch((url, opts = {}) => {
    seen[url] = (opts.headers || {}).Authorization;
    if (url.endsWith('/version')) return jsonResp({ sidecar: 'g' });
    if (url.endsWith('/api/v1/sdf')) return jsonResp({ count: 0, tiles: [] });
    return jsonResp({}, false, 404);
  });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test', apiToken: null });
    await c.version();
    await c.listSdfTiles();
    for (const v of Object.values(seen)){
      assert.equal(v, undefined);
    }
  } finally { restore(); }
});

test('auth: 401 from sidecar surfaces as available=false with status', async () => {
  const restore = mockFetch(() => jsonResp({ error: 'unauthorized' }, false, 401));
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.run({ tx_qth: 'tx.qth' });
    assert.equal(r.available, false);
    assert.equal(r.status, 401);
    assert.match(r.error, /unauthorized/);
  } finally { restore(); }
});

// ---------------- SDF lifecycle ----------------

test('listSdfTiles(): forwards to /api/v1/sdf and parses count + tiles', async () => {
  let url = null;
  const restore = mockFetch((u) => {
    url = u;
    return jsonResp({ sdf_dir: 'sdf', max_upload_bytes: 67108864, count: 2, tiles: [
      { name: 'a.sdf', size_bytes: 1234, modified_at: '2026-05-07T00:00:00Z' },
      { name: 'b.sdf', size_bytes: 5678, modified_at: '2026-05-07T00:01:00Z' }
    ]});
  });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.listSdfTiles();
    assert.equal(r.available, true);
    assert.match(url, /\/api\/v1\/sdf$/);
    assert.equal(r.count, 2);
    assert.equal(r.tiles.length, 2);
    assert.equal(r.tiles[0].name, 'a.sdf');
  } finally { restore(); }
});

test('uploadSdfTile(): POSTs bytes to /api/v1/sdf/<name>', async () => {
  let captured = null;
  const restore = mockFetch((url, opts) => {
    captured = { url, method: opts.method, body: opts.body, headers: opts.headers };
    return jsonResp({ name: '38:39:-77:-76.sdf', size_bytes: 1234, modified_at: '2026-05-07T00:00:00Z' }, true, 201);
  });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const r = await c.uploadSdfTile('38:39:-77:-76.sdf', bytes);
    assert.equal(r.available, true);
    assert.equal(r.name, '38:39:-77:-76.sdf');
    assert.equal(captured.method, 'POST');
    assert.match(captured.url, /\/api\/v1\/sdf\/38%3A39%3A-77%3A-76\.sdf$/);
    assert.equal(captured.headers['content-type'], 'application/octet-stream');
    assert.equal(captured.body, bytes);
  } finally { restore(); }
});

test('uploadSdfTile(): missing name short-circuits', async () => {
  let called = false;
  const restore = mockFetch(() => { called = true; return jsonResp({}); });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.uploadSdfTile('', new Uint8Array([1]));
    assert.equal(called, false);
    assert.equal(r.available, false);
    assert.match(r.error, /name required/);
  } finally { restore(); }
});

test('uploadSdfTile(): missing bytes short-circuits', async () => {
  let called = false;
  const restore = mockFetch(() => { called = true; return jsonResp({}); });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.uploadSdfTile('x.sdf', null);
    assert.equal(called, false);
    assert.equal(r.available, false);
    assert.match(r.error, /bytes required/);
  } finally { restore(); }
});

test('uploadSdfTile(): 413 from sidecar surfaces as available=false with status', async () => {
  const restore = mockFetch(() => jsonResp({ error: 'too large' }, false, 413));
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.uploadSdfTile('x.sdf', new Uint8Array([1]));
    assert.equal(r.available, false);
    assert.equal(r.status, 413);
  } finally { restore(); }
});

test('deleteSdfTile(): forwards DELETE to /api/v1/sdf/<name>', async () => {
  let captured = null;
  const restore = mockFetch((url, opts) => {
    captured = { url, method: opts.method };
    return jsonResp({ deleted: 'x.sdf' });
  });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.deleteSdfTile('x.sdf');
    assert.equal(r.available, true);
    assert.equal(r.deleted, 'x.sdf');
    assert.equal(captured.method, 'DELETE');
    assert.match(captured.url, /\/api\/v1\/sdf\/x\.sdf$/);
  } finally { restore(); }
});

test('deleteSdfTile(): 404 surfaces as available=false with status', async () => {
  const restore = mockFetch(() => jsonResp({ error: 'not found' }, false, 404));
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.deleteSdfTile('missing.sdf');
    assert.equal(r.available, false);
    assert.equal(r.status, 404);
  } finally { restore(); }
});

// ---------------- artifact retrieval ----------------

test('listArtifacts(): forwards to /api/v1/artifacts', async () => {
  const restore = mockFetch((url) => {
    assert.match(url, /\/api\/v1\/artifacts$/);
    return jsonResp({ workdir: '/app/work', count: 1, artifacts: [
      { path: 'out/coverage.ppm', size_bytes: 1024, modified_at: '...', url: '/api/v1/artifacts/out/coverage.ppm' }
    ]});
  });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.listArtifacts();
    assert.equal(r.available, true);
    assert.equal(r.count, 1);
    assert.equal(r.artifacts[0].path, 'out/coverage.ppm');
  } finally { restore(); }
});

test('getArtifact(): returns raw bytes + content_type', async () => {
  const payload = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]);  // JPEG-ish header
  const restore = mockFetch((url) => {
    assert.match(url, /\/api\/v1\/artifacts\/out\/coverage\.ppm$/);
    return bytesResp(payload, true, 200, 'image/x-portable-pixmap');
  });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.getArtifact('out/coverage.ppm');
    assert.equal(r.available, true);
    assert.equal(r.size_bytes, 4);
    assert.equal(r.content_type, 'image/x-portable-pixmap');
    assert.deepEqual(Array.from(r.bytes), [0xFF, 0xD8, 0xFF, 0xE0]);
  } finally { restore(); }
});

test('getArtifact(): 404 surfaces as available=false', async () => {
  const restore = mockFetch(() => bytesResp(new Uint8Array(), false, 404));
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.getArtifact('missing.ppm');
    assert.equal(r.available, false);
    assert.equal(r.status, 404);
    assert.match(r.error, /not found/);
  } finally { restore(); }
});

test('getArtifact(): missing path short-circuits', async () => {
  let called = false;
  const restore = mockFetch(() => { called = true; return jsonResp({}); });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    const r = await c.getArtifact('');
    assert.equal(called, false);
    assert.equal(r.available, false);
  } finally { restore(); }
});

test('getArtifact(): nested-path components are URL-encoded individually', async () => {
  let url = null;
  const restore = mockFetch((u) => {
    url = u;
    return bytesResp(new Uint8Array());
  });
  try {
    const c = makeSplatClient({ baseUrl: 'http://splat.test' });
    await c.getArtifact('out/has space/file name.ppm');
    // Slashes between components are preserved (not encoded), but each
    // component's spaces become %20.
    assert.match(url, /\/api\/v1\/artifacts\/out\/has%20space\/file%20name\.ppm$/);
  } finally { restore(); }
});
