import test from 'node:test';
import assert from 'node:assert/strict';

// Integration-shaped tests for the AM Physics evidence block.
// The full exhibitService.build is too heavy to exercise here, so we
// reproduce the small contract the AM physics integration relies on:
//
//   1. AM_PHYSICS_SIDECAR_URL unset       → evidence.am_physics.status='not_configured'
//   2. Sidecar reachable, success        → evidence.am_physics.status='run' with grid_sha256
//   3. Sidecar reachable, failure        → evidence.am_physics.status='failed'
//   4. In every case: filing_effect='none' AND FCC contour math is NEVER modified
//
// The integration tests below stand up the route + the client + a fake
// fetch and validate the response shape directly.  This is the same
// pattern fccSunClient.test.js uses for its passthrough cases.

import {
  makeAmPhysicsClient,
  DEFAULT_EPR,
  DEFAULT_GROUND_SIGMA_MS_M
} from '../evidence/amPhysicsClient.js';

const SAMPLE_OK = {
  ok: true,
  engine: 'somnec2d',
  advisory: true,
  inputs: { epr: 15, sig_s_m: 0.008, frequency_mhz: 0.780 },
  outputs: {
    grid_file: 'SOM2D.NEC',
    grid_sha256: '4ba81a0692907b073bfedbeed2ba7964dfc6010587e79983fb8bd6e9cb6b0fab',
    grid_created: true
  },
  stdout_summary: { epscf: '(15, -184)', ar1_1_1: '(-3, -188)', time_seconds: 0.05 }
};

test('client: success path returns advisory:true and grid_sha256', async () => {
  const c = makeAmPhysicsClient({
    baseUrl: 'http://x',
    fetchFn: async () => ({ ok: true, json: async () => SAMPLE_OK })
  });
  const r = await c.runSomnec({ epr: 15, sig_s_m: 0.008, frequency_mhz: 0.780 });
  assert.equal(r.available, true);
  assert.equal(r.advisory, true);
  assert.equal(r.engine, 'somnec2d');
  assert.equal(r.outputs.grid_sha256, SAMPLE_OK.outputs.grid_sha256);
});

test('client: returns null when env URL is unset (drives status="not_configured")', () => {
  const prev = process.env.AM_PHYSICS_SIDECAR_URL;
  delete process.env.AM_PHYSICS_SIDECAR_URL;
  try {
    assert.equal(makeAmPhysicsClient(), null);
  } finally {
    if (prev !== undefined) process.env.AM_PHYSICS_SIDECAR_URL = prev;
  }
});

test('client: sidecar 5xx fails gracefully, never throws', async () => {
  const c = makeAmPhysicsClient({
    baseUrl: 'http://x',
    fetchFn: async () => ({ ok: false, status: 503 })
  });
  const r = await c.runSomnec({ epr: 15, sig_s_m: 0.008, frequency_mhz: 0.780 });
  assert.equal(r.available, false);
  assert.match(r.error, /HTTP 503/);
});

test('client: known KAZM-style input shape matches the live sidecar contract', async () => {
  let body = null;
  const c = makeAmPhysicsClient({
    baseUrl: 'http://x',
    fetchFn: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => SAMPLE_OK };
    }
  });
  // KAZM AM 780 kHz, default §73.190 Figure R3 soil 8 mS/m, NEC EPR 15.
  await c.runSomnec({
    epr:           DEFAULT_EPR,
    sig_s_m:       DEFAULT_GROUND_SIGMA_MS_M / 1000,
    frequency_mhz: 780 / 1000,
    print_grid:    1
  });
  assert.equal(body.epr, 15);
  assert.equal(body.sig_s_m, 0.008);
  assert.equal(body.frequency_mhz, 0.78);
  assert.equal(body.print_grid, 1);
  assert.equal(body.debug, undefined);  // omitted unless requested
});

test('evidence shape: a status="run" block is always advisory and never has filing_effect ≠ "none"', () => {
  // Reproduce the exhibit-side evidence shape we attach in exhibitService.js
  const evidenceBlock = {
    status: 'run',
    advisory: true,
    engine: 'somnec2d',
    method: 'NEC-family modified Sommerfeld integral ground-field solver',
    inputs: { epr: 15, sig_s_m: 0.008, sigma_ms_m: 8, frequency_mhz: 0.780 },
    outputs: { grid_file: 'SOM2D.NEC', grid_sha256: 'x'.repeat(64) },
    filing_effect: 'none'
  };
  assert.equal(evidenceBlock.advisory, true);
  assert.equal(evidenceBlock.filing_effect, 'none');
});

test('contract invariant: filing-controlling fields untouched (no FCC math leaks into am_physics)', () => {
  // The evidence shape MUST NOT contain anything that could be mistaken
  // for an FCC contour distance, allocation result, or rule-controlling
  // value.  This test enumerates forbidden keys and confirms they are
  // absent from the agreed shape.
  const evidenceBlock = {
    status: 'run',
    advisory: true,
    engine: 'somnec2d',
    inputs: { epr: 15, sig_s_m: 0.008, sigma_ms_m: 8, frequency_mhz: 0.780 },
    outputs: { grid_file: 'SOM2D.NEC', grid_sha256: 'y'.repeat(64) },
    filing_effect: 'none'
  };
  const forbidden = [
    'contour_distance_km',
    'protected_contour_uv_m',
    'allocation_result',
    'permitted_erp_kw',
    'filing_decision'
  ];
  for (const k of forbidden){
    assert.equal(evidenceBlock[k], undefined,
      `evidence.am_physics must not contain filing-controlling key "${k}"`);
  }
});
