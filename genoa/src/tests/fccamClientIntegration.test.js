// FCCAM client integration suite — exercises the full HTTP path
// (URL building, batch shape, /healthz, /version, error envelopes,
// golden-suite manifest loading) without depending on the real
// Fccam.for binary.
//
// HOW
//   When FCCAM_SIDECAR_URL is unset (the CI default), this suite
//   stands up an in-process Node HTTP mock that emulates the
//   FCCAM contract:
//     GET /healthz   → { ok: true, binary_present: true }
//     GET /version   → { engine, source_sha256, binary_sha256, files }
//     POST /run      → deterministic synthetic field per a closed-form
//                       formula (mockFieldUvm) that mirrors
//                       inverse-distance fall-off; same inputs → same
//                       output, replay-deterministic input_sha256.
//     POST /run-batch → vectorized over the same formula.
//   The same mockFieldUvm() is reused to populate the golden-suite
//   manifest cases, so the round-trip assertion is genuine: client
//   posts → mock applies the formula → client unwraps → suite checks
//   the round-trip matches the manifest's pre-computed expected value.
//
//   When FCCAM_SIDECAR_URL IS set (operator pointed it at a real
//   binary), the mock is skipped and the suite runs against the live
//   sidecar exactly as before.
//
// WHY NOT just unit-test
//   fccamClient.test.js already exercises the client in isolation
//   with a stubbed fetchFn.  This suite adds the network layer:
//   real HTTP, real JSON serialization, real response parsing, real
//   manifest-loading from disk.  The mock is intentionally simple
//   so a regression in serialization / port handling shows up here
//   even when the unit tests stay green.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';
import crypto from 'node:crypto';
import { makeFccamClient, midpointLatitude } from '../evidence/fccamClient.js';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const GOLDEN_PATH = path.join(__dirname, '..', '..', 'data', 'golden', 'am_skywave_reference_suite.json');

// ---------------------------------------------------------------------------
// mock — must agree with the formula used to populate the golden manifest.
// Synthetic; clearly NOT FCCAM-grade.  Inverse-distance with a sqrt(ERP)
// scaling and a small frequency-dependent factor so different cases produce
// different values.
// ---------------------------------------------------------------------------

function mockFieldUvm({ erp_kw, freq_khz, distance_km, midpoint_lat, percent_time }){
  // Tiny model: 1500 µV/m base × √ERP / max(1, distance) with a frequency
  // pull (1 + 0.1·sin(freq/100)) and a 10/50 percent-time scaling.  None of
  // these knobs match real Wang/Berry curves; they're here only so the mock
  // produces deterministic, distinct outputs.
  const base = 1500 * Math.sqrt(erp_kw) / Math.max(1, distance_km);
  const fpull = 1 + 0.1 * Math.sin(freq_khz / 100);
  const lat = 1 + 0.0005 * Math.abs(midpoint_lat);
  const pct = percent_time === 10 ? 1.4 : 1.0;
  return Number((base * fpull * lat * pct).toFixed(4));
}

const FAKE_SOURCE_SHA = 'a'.repeat(64);
const FAKE_BINARY_SHA = 'b'.repeat(64);

function startMockSidecar(){
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const body = chunks.length ? Buffer.concat(chunks).toString('utf8') : '';
        const respond = (status, payload) => {
          res.statusCode = status;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(payload));
        };

        if (req.method === 'GET' && req.url === '/healthz'){
          return respond(200, { ok: true, binary_present: true });
        }
        if (req.method === 'GET' && req.url === '/version'){
          return respond(200, {
            engine:        'fccam-mock',
            version:       'mock-0',
            binary_present: true,
            source_sha256:  FAKE_SOURCE_SHA,
            binary_sha256:  FAKE_BINARY_SHA,
            files: { 'Fccam.for': { sha256: FAKE_SOURCE_SHA, size: 1024 } },
            container_started_at: new Date().toISOString(),
            regulation:    '47 CFR §73.190(c) (mock); §73.182 (mock)',
            license_basis: '17 USC §105 (mock)'
          });
        }
        if (req.method === 'POST' && req.url === '/run'){
          let inputs;
          try { inputs = JSON.parse(body || '{}'); }
          catch { return respond(400, { ok: false, error: 'bad json' }); }
          const field = mockFieldUvm(inputs);
          const sha = crypto.createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
          return respond(200, {
            ok:             true,
            engine:         'fccam-mock',
            field_uv_m:     field,
            flag:           null,
            input_sha256:   sha,
            inputs,
            engine_version: 'mock-0',
            source_sha256:  FAKE_SOURCE_SHA,
            stdout:         `MOCK FIELD = ${field} UV/M`,
            stderr:         ''
          });
        }
        if (req.method === 'POST' && req.url === '/run-batch'){
          let parsed;
          try { parsed = JSON.parse(body || '{}'); }
          catch { return respond(400, { ok: false, error: 'bad json' }); }
          const requests = Array.isArray(parsed?.requests) ? parsed.requests : [];
          const results = requests.map((inputs) => {
            const field = mockFieldUvm(inputs);
            const sha = crypto.createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
            return {
              ok:           true,
              engine:       'fccam-mock',
              field_uv_m:   field,
              flag:         null,
              input_sha256: sha,
              inputs
            };
          });
          return respond(200, {
            ok:        true,
            n_requests: results.length,
            n_ok:       results.length,
            n_failed:   0,
            results,
            engine_version: 'mock-0',
            source_sha256:  FAKE_SOURCE_SHA
          });
        }
        respond(404, { ok: false, error: 'not found' });
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

// ---------------------------------------------------------------------------
// suite-level fixture: prefer the operator's real sidecar when configured;
// otherwise stand up the in-process mock for the duration of the suite.
// ---------------------------------------------------------------------------

const REAL_BASE = (process.env.FCCAM_SIDECAR_URL || '').trim();
let mockHandle  = null;
let baseUrl     = REAL_BASE;
let usingMock   = false;

test.before(async () => {
  if (!REAL_BASE){
    mockHandle = await startMockSidecar();
    baseUrl = mockHandle.baseUrl;
    usingMock = true;
    process.env.FCCAM_SIDECAR_URL = baseUrl;
    delete process.env.FCCAM_API_TOKEN;
  }
});
test.after(async () => {
  if (mockHandle){
    await new Promise((resolve) => mockHandle.server.close(() => resolve()));
  }
});

// ---------------------------------------------------------------------------
// the actual integration assertions
// ---------------------------------------------------------------------------

test('FCCAM sidecar /healthz reports binary present', async () => {
  const c = makeFccamClient({ baseUrl });
  assert.ok(c, 'client should construct');
  const ok = await c.health();
  assert.equal(ok, true, 'sidecar /healthz must respond 200');
});

test('FCCAM sidecar /version stamps source_sha256 + binary_sha256', async () => {
  const v = await makeFccamClient({ baseUrl }).version();
  assert.equal(v.available, true);
  assert.match(v.source_sha256 || '', /^[a-f0-9]{64}$/i, 'source_sha256 missing');
  assert.match(v.binary_sha256 || '', /^[a-f0-9]{64}$/i, 'binary_sha256 missing');
});

test('FCCAM golden suite — every reference station matches within tolerance', async () => {
  let manifest;
  try {
    manifest = JSON.parse(await fs.readFile(GOLDEN_PATH, 'utf8'));
  } catch (e){
    assert.fail(`golden manifest not found at ${GOLDEN_PATH}: ${e.message}`);
  }
  const cases = pickCases(manifest, usingMock);
  if (cases.length === 0){
    assert.fail('am_skywave_reference_suite.json has no cases for this run mode (real / mock)');
  }
  const c = makeFccamClient({ baseUrl });
  const TOLERANCE_UV_M = Number(manifest.tolerance_uv_m) || 5.0;
  const failures = [];
  for (const caseDef of cases){
    const mid = Number.isFinite(caseDef.midpoint_lat)
      ? caseDef.midpoint_lat
      : midpointLatitude(caseDef.tx_lat, caseDef.tx_lon, caseDef.rx_lat, caseDef.rx_lon);
    const r = await c.fieldAtDistance({
      erp_kw:       caseDef.erp_kw,
      freq_khz:     caseDef.freq_khz,
      distance_km:  caseDef.distance_km,
      midpoint_lat: mid,
      percent_time: caseDef.percent_time ?? 50
    });
    if (!r.available){
      failures.push({ id: caseDef.id, reason: r.error });
      continue;
    }
    const delta = Math.abs(r.field_uv_m - caseDef.expected_field_uv_m);
    if (delta > TOLERANCE_UV_M){
      failures.push({
        id: caseDef.id,
        expected: caseDef.expected_field_uv_m,
        got: r.field_uv_m,
        delta,
        tolerance: TOLERANCE_UV_M
      });
    }
  }
  assert.deepEqual(failures, [], `golden cases out of tolerance:\n${JSON.stringify(failures, null, 2)}`);
});

// Mock cases live under `mock_cases` so the operator-populated `cases`
// (real FCC reference stations) can sit untouched in the same manifest.
function pickCases(manifest, usingMock){
  if (usingMock){
    if (Array.isArray(manifest.mock_cases) && manifest.mock_cases.length > 0){
      return manifest.mock_cases;
    }
    // Fallback: synthesize cases with mockFieldUvm() so the suite has
    // something to assert against even with a freshly-cleared manifest.
    return SYNTHESIZED_MOCK_CASES();
  }
  return Array.isArray(manifest.cases) ? manifest.cases : [];
}

function SYNTHESIZED_MOCK_CASES(){
  const seeds = [
    { id: 'syn-700-200km',  freq_khz: 700, erp_kw: 50,  distance_km: 200, midpoint_lat:  39.5 },
    { id: 'syn-1000-400km', freq_khz: 1000, erp_kw: 25, distance_km: 400, midpoint_lat:  35.0 },
    { id: 'syn-1450-150km', freq_khz: 1450, erp_kw: 5,  distance_km: 150, midpoint_lat:  41.2 }
  ];
  return seeds.map((s) => ({
    ...s,
    percent_time:        50,
    expected_field_uv_m: mockFieldUvm({ ...s, percent_time: 50 })
  }));
}
