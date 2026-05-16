// NEC client tests (success, failure, timeout) + pattern adapter.
//
// LICENSE BOUNDARY
//   These tests do NOT exercise NEC2++ / PyNEC directly.  They only
//   verify the HTTP client boundary between Genoa and the GPL'd
//   sidecar, using a fake fetch.  The sidecar process itself is
//   tested separately (see src/sidecars/nec/README.md smoke-test).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeNecClient,
  necPatternToTable,
  NEC_PROVENANCE
} from '../evidence/nec/client.js';

function withFetch(fakeFetch, fn){
  const orig = global.fetch;
  global.fetch = fakeFetch;
  return Promise.resolve(fn()).finally(() => { global.fetch = orig; });
}

const REF_PATTERN = {
  theta_deg: [0, 30, 60, 90, 120, 150, 180],
  phi_deg:   [0, 90, 180, 270],
  // gain_dbi[theta][phi] — at theta=90 (horizon, idx 3), peak at phi=0
  gain_dbi: [
    [-10, -10, -10, -10],
    [-5,  -5,  -5,  -5 ],
    [ 0,  -3,  -6,  -3 ],
    [ 3,   0,  -6,   0 ],            // horizon row (idx 3)
    [ 0,  -3,  -6,  -3 ],
    [-5,  -5,  -5,  -5 ],
    [-10, -10, -10, -10]
  ]
};

const REF_RESPONSE = {
  ok: true, model_valid: true, frequency_mhz: 1.0,
  geometry:    { n_wires: 1, total_length_m: 75, n_segments: 21 },
  ground:      { type: 'sommerfeld', conductivity_s_m: 0.005, dielectric_constant: 13 },
  feedpoint:   { r_ohm: 36.5, x_ohm: 21.4, vswr_50: 1.43 },
  pattern:     REF_PATTERN,
  near_field:  [{ x: 10, y: 0, z: 2, e_v_m: 12.3, h_a_m: 0.04, s_mw_cm2: 0.2 }],
  warnings:    [],
  provenance: {
    engine: 'necpp/PyNEC', source: 'NEC2++ sidecar',
    license_boundary: 'external sidecar', sidecar_version: '0.1.0',
    generated_at: '2026-05-06T00:00:00Z',
    model_hash:   'a'.repeat(64)
  }
};

/* ---------------- client construction + health ---------------- */

test('makeNecClient: returns null when NEC_SIDECAR_URL unset', () => {
  const c = makeNecClient({ baseUrl: null });
  assert.equal(c, null);
});

test('makeNecClient: surfaces baseUrl', () => {
  const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
  assert.equal(c.baseUrl, 'http://nec.test:8085');
});

test('client.health: pynec_available=true on a healthy sidecar', async () => {
  await withFetch(async (url) => {
    if (url.endsWith('/health')){
      return { ok: true, status: 200, async json(){ return { ok: true, pynec_available: true, pynec_version: '1.7.4' }; }};
    }
    throw new Error('unexpected URL ' + url);
  }, async () => {
    const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
    const r = await c.health();
    assert.equal(r.reachable, true);
    assert.equal(r.pynec_available, true);
    assert.equal(r.pynec_version, '1.7.4');
  });
});

test('client.health: returns reachable:false when sidecar down', async () => {
  await withFetch(async () => { throw new Error('ECONNREFUSED'); }, async () => {
    const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
    const r = await c.health();
    assert.equal(r.reachable, false);
    assert.match(r.error, /ECONNREFUSED/);
  });
});

/* ---------------- client.run ---------------- */

test('client.run: success returns ok:true with provenance + pattern', async () => {
  await withFetch(async () => ({ ok: true, status: 200, async json(){ return REF_RESPONSE; } }),
    async () => {
      const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
      const r = await c.run({
        frequency_mhz: 1.0,
        ground: { type: 'pec' },
        wires: [{ tag: 1, segments: 21, x1: 0, y1: 0, z1: 0, x2: 0, y2: 0, z2: 75, radius_m: 0.25 }],
        excitations: [{ tag: 1, segment: 1, voltage_real: 1, voltage_imag: 0 }]
      });
      assert.equal(r.ok, true);
      assert.equal(r.model_valid, true);
      assert.equal(r.provenance.license_boundary, 'external sidecar');
      assert.equal(r.feedpoint.r_ohm, 36.5);
      assert.equal(r.pattern.theta_deg.length, 7);
    });
});

test('client.run: HTTP 500 surfaces error + http_status', async () => {
  await withFetch(async () => ({ ok: false, status: 500, async json(){ return { ok: false, error: 'PYNEC_BRIDGE_FAILED', detail: 'segfault' }; } }),
    async () => {
      const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
      const r = await c.run({ frequency_mhz: 1.0, wires: [], excitations: [] });
      assert.equal(r.ok, false);
      assert.equal(r.http_status, 500);
      assert.equal(r.error, 'PYNEC_BRIDGE_FAILED');
      assert.match(r.detail, /segfault/);
    });
});

test('client.run: PyNEC missing surfaces PYNEC_NOT_INSTALLED', async () => {
  await withFetch(async () => ({ ok: false, status: 502, async json(){ return { ok: false, error: 'PYNEC_NOT_INSTALLED', detail: 'pip install PyNEC' }; }}),
    async () => {
      const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
      const r = await c.run({ frequency_mhz: 1.0, wires: [], excitations: [] });
      assert.equal(r.ok, false);
      assert.equal(r.error, 'PYNEC_NOT_INSTALLED');
    });
});

test('client.run: timeout surfaces NEC_BRIDGE_TIMEOUT', async () => {
  await withFetch(async (_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => {
      const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
    });
  }), async () => {
    const c = makeNecClient({ baseUrl: 'http://nec.test:8085', timeoutMs: 50 });
    const r = await c.run({ frequency_mhz: 1.0, wires: [], excitations: [] });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'NEC_BRIDGE_TIMEOUT');
  });
});

test('client.run: connection refused surfaces NEC_SIDECAR_UNREACHABLE', async () => {
  await withFetch(async () => { const e = new Error('ECONNREFUSED'); e.name = 'TypeError'; throw e; },
    async () => {
      const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
      const r = await c.run({ frequency_mhz: 1.0, wires: [], excitations: [] });
      assert.equal(r.ok, false);
      assert.equal(r.error, 'NEC_SIDECAR_UNREACHABLE');
    });
});

/* ---------------- client.runAmArray + runNearField ---------------- */

test('client.runAmArray: forwards spec to /model/am-array', async () => {
  let captured = null;
  await withFetch(async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, async json(){ return REF_RESPONSE; } };
  }, async () => {
    const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
    await c.runAmArray({
      frequency_khz: 1240,
      towers: [{ tag: 1, x_m: 0, y_m: 0, height_m: 75, drive: { amplitude: 1, phase_deg: 0 } }]
    });
    assert.match(captured.url, /\/model\/am-array$/);
    assert.equal(captured.body.frequency_khz, 1240);
  });
});

test('client.runNearField: combines model + extra points to /model/near-field', async () => {
  let captured = null;
  await withFetch(async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, async json(){ return REF_RESPONSE; } };
  }, async () => {
    const c = makeNecClient({ baseUrl: 'http://nec.test:8085' });
    await c.runNearField(
      { frequency_mhz: 1, wires: [], excitations: [] },
      [{ x: 10, y: 0, z: 2 }]
    );
    assert.match(captured.url, /\/model\/near-field$/);
    assert.equal(captured.body.points.length, 1);
    assert.equal(captured.body.points[0].x, 10);
  });
});

/* ---------------- pattern adapter ---------------- */

test('necPatternToTable: extracts horizon (theta=90) slice into pattern_table', () => {
  const tbl = necPatternToTable(REF_RESPONSE, { elevation_deg: 0 });
  // horizon row [3, 0, -6, 0] dBi → max=3, factors:
  //   phi=0    f = 10^((3 - 3)/20) = 1.0
  //   phi=90   f = 10^((0 - 3)/20) ≈ 0.708
  //   phi=180  f = 10^((-6 - 3)/20) ≈ 0.355
  //   phi=270  f = 10^((0 - 3)/20) ≈ 0.708
  assert.equal(tbl.length, 4);
  assert.deepEqual(tbl.map(([az]) => az), [0, 90, 180, 270]);
  assert.ok(Math.abs(tbl[0][1] - 1.0)   < 0.01);
  assert.ok(Math.abs(tbl[1][1] - 0.708) < 0.01);
  assert.ok(Math.abs(tbl[2][1] - 0.355) < 0.01);
  assert.ok(Math.abs(tbl[3][1] - 0.708) < 0.01);
});

test('necPatternToTable: returns null on missing pattern', () => {
  assert.equal(necPatternToTable({}), null);
  assert.equal(necPatternToTable({ pattern: { theta_deg: [], phi_deg: [], gain_dbi: [] } }), null);
});

test('necPatternToTable: picks closest theta slice for a non-horizon elevation', () => {
  const tbl = necPatternToTable(REF_RESPONSE, { elevation_deg: 30 });
  // requested theta = 60 (idx 2 in REF_PATTERN); row [0, -3, -6, -3]
  // max=0 → factors [1.0, 0.708, 0.501, 0.708]
  assert.ok(Math.abs(tbl[0][1] - 1.0)   < 0.01);
  assert.ok(Math.abs(tbl[2][1] - 0.501) < 0.01);
});

/* ---------------- provenance ---------------- */

test('NEC_PROVENANCE names NEC2++ + GPL boundary + regulation cites', () => {
  assert.match(NEC_PROVENANCE.upstream_engine, /NEC2\+\+/);
  assert.equal(NEC_PROVENANCE.upstream_license, 'GPL v2');
  assert.match(NEC_PROVENANCE.license_boundary, /external sidecar/);
  assert.ok(NEC_PROVENANCE.regulation_basis.some(r => /73\.62/.test(r)));
  assert.ok(NEC_PROVENANCE.regulation_basis.some(r => /73\.150/.test(r)));
  assert.ok(NEC_PROVENANCE.regulation_basis.some(r => /1\.1310/.test(r)));
});
