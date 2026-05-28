// Geodata sidecar + HTTP raster sampler.
//
// Two layers of coverage:
//
//   1. makeHttpRasterSampler — stub the global fetch and assert the
//      sampler hits the correct URL with the bearer header, and
//      passes through the sidecar's response in the rasterSampler
//      shape.
//
//   2. Sidecar server — boot makeApp() in-process with a stub
//      `runCommand`, fire requests against it, assert the
//      gdallocationinfo wrapper behavior + auth + path allowlist.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { makeHttpRasterSampler } from '../evidence/geodata/httpRasterSampler.js';
import { makeApp } from '../sidecars/geodata/server.js';

// ── HTTP sampler unit tests ──────────────────────────────────────

function fakeFetch(handler){
  return async (url, opts) => {
    const r = await handler(url, opts);
    return {
      ok:     r.status >= 200 && r.status < 300,
      status: r.status,
      text:   async () => (r.body == null ? '' : JSON.stringify(r.body))
    };
  };
}

test('httpRasterSampler GETs the sidecar with bearer + passes response through', async () => {
  let seenUrl, seenAuth;
  const sampler = makeHttpRasterSampler({
    baseUrl:  'http://sidecar.local:8089',
    apiToken: 'tok_abc',
    fetchFn:  fakeFetch(async (url, opts) => {
      seenUrl  = url;
      seenAuth = opts?.headers?.authorization;
      return { status: 200, body: { available: true, value: 12,
                                    replay: 'gdallocationinfo -wgs84 -valonly /opt/genoa/foo.tif -111 34' } };
    })
  });
  const r = await sampler.sampleRaster({ tif: '/opt/genoa/foo.tif', lon: -111, lat: 34 });
  assert.equal(seenAuth, 'Bearer tok_abc');
  assert.match(seenUrl, /\/raster\/sample\?path=%2Fopt%2Fgenoa%2Ffoo\.tif&lon=-111&lat=34$/);
  assert.equal(r.available, true);
  assert.equal(r.value, 12);
  assert.match(r.replay, /^gdallocationinfo /);
});

test('httpRasterSampler reports sidecar_unreachable on fetch error', async () => {
  const sampler = makeHttpRasterSampler({
    baseUrl: 'http://nope.invalid',
    fetchFn: async () => { throw new Error('ECONNREFUSED'); }
  });
  const r = await sampler.sampleRaster({ tif: '/x.tif', lon: 0, lat: 0 });
  assert.equal(r.available, false);
  assert.equal(r.reason, 'sidecar_unreachable');
  assert.match(r.error, /ECONNREFUSED/);
  assert.match(r.replay, /^gdallocationinfo /);  // local replay still synthesized
});

test('httpRasterSampler.statRaster passes through exists/size', async () => {
  const sampler = makeHttpRasterSampler({
    baseUrl: 'http://sc',
    fetchFn: fakeFetch(async () => ({ status: 200,
                                      body: { exists: true, is_file: true, size: 35906,
                                              mtime: '2026-05-15T15:48:30.000Z' } }))
  });
  const st = await sampler.statRaster('/opt/genoa/foo.tif');
  assert.equal(st.exists, true);
  assert.equal(st.size,   35906);
});

// ── Sidecar server tests ─────────────────────────────────────────

// Boot the sidecar Express app on a random port with a stub
// runCommand so we don't actually need gdal on the test host.
async function bootSidecar({ token, runCommand, allowPrefixes = ['/opt/genoa'] }){
  process.env.GEODATA_ROOT = '/opt/genoa';
  process.env.GEODATA_ALLOW_PREFIXES = allowPrefixes.join(',');
  if (token) process.env.GEODATA_SIDECAR_TOKEN = token;
  else delete process.env.GEODATA_SIDECAR_TOKEN;
  // Re-import server.js to pick up env (makeApp reads them at module load).
  const mod = await import('../sidecars/geodata/server.js?cb=' + Math.random());
  const app = mod.makeApp({ runCommand });
  return await new Promise((resolve) => {
    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      resolve({ srv, url: `http://127.0.0.1:${port}` });
    });
  });
}
function closeServer(srv){ return new Promise((r) => srv.close(r)); }

test('sidecar /healthz returns ok without auth', async () => {
  const { srv, url } = await bootSidecar({ token: 'secret' });
  try {
    const r = await fetch(url + '/healthz');
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.ok, true);
  } finally { await closeServer(srv); }
});

test('sidecar /raster/sample requires bearer when token is set', async () => {
  const { srv, url } = await bootSidecar({
    token: 'secret-token',
    runCommand: async () => ({ stdout: '12\n', stderr: '' })
  });
  try {
    const noAuth = await fetch(url + '/raster/sample?path=/opt/genoa/foo.tif&lat=34&lon=-111');
    assert.equal(noAuth.status, 401);

    const ok = await fetch(url + '/raster/sample?path=/opt/genoa/foo.tif&lat=34&lon=-111',
                           { headers: { authorization: 'Bearer secret-token' } });
    // /opt/genoa/foo.tif doesn't actually exist on the test host — the
    // sidecar must report raster_unavailable (not a 500).  This proves
    // the existence check happens before gdal is invoked.
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.equal(j.available, false);
    assert.equal(j.reason,    'raster_unavailable');
    assert.match(j.replay,    /^gdallocationinfo /);
  } finally { await closeServer(srv); }
});

test('sidecar refuses paths outside the allowlist with 403', async () => {
  const { srv, url } = await bootSidecar({ token: '', allowPrefixes: ['/opt/genoa'] });
  try {
    const r = await fetch(url + '/raster/sample?path=/etc/passwd&lat=0&lon=0');
    assert.equal(r.status, 403);
    const j = await r.json();
    assert.equal(j.error, 'PATH_NOT_ALLOWED');
  } finally { await closeServer(srv); }
});

test('sidecar /raster/sample wraps gdallocationinfo stdout into a numeric value', async () => {
  // Point at a path that DOES exist on the test host (/tmp), allowlist
  // it, and stub runCommand to emit a numeric line.  This is the
  // happy-path proof that the sidecar -> Genoa contract returns the
  // shape Genoa's interpreters expect.
  const fs = await import('node:fs/promises');
  const p = `/tmp/genoa-geodata-sidecar-fake-${Date.now()}.tif`;
  await fs.writeFile(p, '');
  try {
    const { srv, url } = await bootSidecar({
      token: '',
      allowPrefixes: ['/tmp'],
      runCommand: async () => ({ stdout: '12\n', stderr: '' })
    });
    try {
      const r = await fetch(`${url}/raster/sample?path=${encodeURIComponent(p)}&lat=34&lon=-111`);
      assert.equal(r.status, 200);
      const j = await r.json();
      assert.equal(j.available, true);
      assert.equal(j.value,     12);
      assert.equal(j.outside_extent, undefined);
      assert.match(j.replay,    /-wgs84 -valonly/);
    } finally { await closeServer(srv); }
  } finally { await fs.unlink(p).catch(() => {}); }
});

test('sidecar /raster/sample reports outside_extent on empty stdout', async () => {
  const fs = await import('node:fs/promises');
  const p = `/tmp/genoa-geodata-sidecar-empty-${Date.now()}.tif`;
  await fs.writeFile(p, '');
  try {
    const { srv, url } = await bootSidecar({
      token: '',
      allowPrefixes: ['/tmp'],
      runCommand: async () => ({ stdout: '   \n', stderr: 'outside raster' })
    });
    try {
      const r = await fetch(`${url}/raster/sample?path=${encodeURIComponent(p)}&lat=34&lon=-111`);
      const j = await r.json();
      assert.equal(j.available, true);
      assert.equal(j.outside_extent, true);
      assert.equal(j.value, null);
    } finally { await closeServer(srv); }
  } finally { await fs.unlink(p).catch(() => {}); }
});

test('sidecar /raster/status returns exists=false for missing paths', async () => {
  const { srv, url } = await bootSidecar({ token: '' });
  try {
    const r = await fetch(url + '/raster/status?path=/opt/genoa/does-not-exist.tif');
    const j = await r.json();
    assert.equal(j.exists, false);
  } finally { await closeServer(srv); }
});

test('sidecar /master-shas serves MASTER_SHA256SUMS.txt when present', async () => {
  // Write a temp MASTER_SHA256SUMS.txt under a synthetic corpus root,
  // point GEODATA_ROOT at it, then boot the sidecar.
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const os = await import('node:os');
  const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'geodata-shas-'));
  await fs.writeFile(path.join(tmpRoot, 'MASTER_SHA256SUMS.txt'),
    'aa'.repeat(32) + '  sources/nlcd/Annual_NLCD_FctImp_2024_CU_C1V1/Annual_NLCD_FctImp_2024_CU_C1V1.tif\n' +
    'bb'.repeat(32) + '  sources/vegetation/2024_perennial_herbaceous_departure/2024_perennial_herbaceous_departure_20250608.tif\n'
  );
  process.env.GEODATA_ROOT = tmpRoot;
  process.env.GEODATA_ALLOW_PREFIXES = tmpRoot;
  delete process.env.GEODATA_SIDECAR_TOKEN;
  const mod = await import('../sidecars/geodata/server.js?shas=' + Math.random());
  const app = mod.makeApp({});
  const http = await import('node:http');
  const srv = await new Promise((resolve) => {
    const s = http.createServer(app);
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const url = `http://127.0.0.1:${srv.address().port}`;
    const r = await fetch(url + '/master-shas');
    assert.equal(r.status, 200);
    const txt = await r.text();
    assert.match(txt, /Annual_NLCD_FctImp_2024_CU_C1V1\.tif/);
    assert.match(txt, /perennial_herbaceous_departure/);
  } finally {
    await closeServer(srv);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }
});

test('httpRasterSampler.fetchMasterShas parses sidecar output into absolute-path Map', async () => {
  const { makeHttpRasterSampler } = await import('../evidence/geodata/httpRasterSampler.js');
  const sampler = makeHttpRasterSampler({
    baseUrl: 'http://sc',
    fetchFn: async (_url, _opts) => ({
      ok: true, status: 200,
      text: async () =>
        'aa'.repeat(32) + '  sources/nlcd/Annual_NLCD_FctImp_2024_CU_C1V1/Annual_NLCD_FctImp_2024_CU_C1V1.tif\n' +
        '# comment line ignored\n' +
        'bb'.repeat(32) + '  sources/vegetation/2024_perennial_herbaceous_departure/2024_perennial_herbaceous_departure_20250608.tif\n'
    })
  });
  const m = await sampler.fetchMasterShas({ corpusRoot: '/opt/genoa' });
  assert.equal(m.size, 2);
  assert.equal(
    m.get('/opt/genoa/sources/nlcd/Annual_NLCD_FctImp_2024_CU_C1V1/Annual_NLCD_FctImp_2024_CU_C1V1.tif'),
    'aa'.repeat(32)
  );
  assert.equal(
    m.get('/opt/genoa/sources/vegetation/2024_perennial_herbaceous_departure/2024_perennial_herbaceous_departure_20250608.tif'),
    'bb'.repeat(32)
  );
});

test('httpRasterSampler.fetchMasterShas returns empty Map on 404', async () => {
  const { makeHttpRasterSampler } = await import('../evidence/geodata/httpRasterSampler.js');
  const sampler = makeHttpRasterSampler({
    baseUrl: 'http://sc',
    fetchFn: async () => ({ ok: false, status: 404, text: async () => '' })
  });
  const m = await sampler.fetchMasterShas({ corpusRoot: '/opt/genoa' });
  assert.equal(m.size, 0);
});
