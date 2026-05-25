// Phase-10 API: POST /api/exhibits/readiness contract smoke test.

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import readinessRoutes from '../api/routes/readiness.js';

function makeApp(){
  const app = express();
  app.use(express.json({ limit: '8mb' }));
  app.use('/api', readinessRoutes);
  // Default error handler so asyncHandler exceptions don't hang the test.
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  return app;
}

async function post(app, path, body){
  // Mount on an ephemeral port and fetch through it; avoids supertest dep.
  const server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  try {
    const port = server.address().port;
    const r = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await r.json().catch(() => null);
    return { status: r.status, body: json };
  } finally {
    server.close();
  }
}

test('readiness API: returns shape { score, status, blockers, warnings, advisory, next_actions, breakdown, axes }', async () => {
  const app = makeApp();
  const r = await post(app, '/api/exhibits/readiness', {
    exhibit: {
      station_inputs: { call: 'WTEST', service: 'FM', frequency: 100.7,
                        lat: 40, lon: -75, haat_m: 100, erp_kw: 6 },
      evidence: {},
      warnings: [], blockers: []
    }
  });
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.score, 'number');
  assert.ok(['BLOCKED','REVIEW','FILING_CANDIDATE','ENGINEER_CERTIFICATION_READY'].includes(r.body.status));
  for (const k of ['blockers','warnings','advisory','next_actions']){
    assert.ok(Array.isArray(r.body[k]), `${k} must be an array`);
  }
  assert.equal(typeof r.body.breakdown, 'object');
  assert.equal(typeof r.body.axes, 'object');
});

test('readiness API: 400 when exhibit missing', async () => {
  const app = makeApp();
  const r = await post(app, '/api/exhibits/readiness', {});
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'BAD_REQUEST');
});

test('readiness API: KZLZ-style INVALID HAAT exhibit lands BLOCKED', async () => {
  const app = makeApp();
  const r = await post(app, '/api/exhibits/readiness', {
    exhibit: {
      station_inputs: { call: 'KZLZ', service: 'FM', frequency: 105.3,
                        lat: 32.25, lon: -111.12, haat_m: 581, erp_kw: 0.58 },
      evidence: {
        terrain_haat_per_radial: Array.from({ length: 36 }, (_, i) => ({ az: i*10, haat_m: -170 })),
        tx_amsl_resolved: { value_m: 581, source: 'legacy_fallback' },
        fcc_parity_report: { fallback_tier: 3, passed: true }
      },
      haat_validation: {
        status: 'INVALID', basis: 'flat',
        issues: [{ code: 'HAAT_MEAN_INCONSISTENT', severity: 'blocker', detail: 'KZLZ bug pattern' }],
        stats: { operator_m: 581, mean_m: -170, delta_mean_vs_operator_m: -751 }
      },
      warnings: [], blockers: []
    }
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'BLOCKED');
  assert.ok(r.body.blockers.find(b => b.code === 'HAAT_INVALID'));
  assert.ok(r.body.next_actions.length > 0);
});
