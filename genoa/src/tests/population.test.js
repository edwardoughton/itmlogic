// Population evidence adapter — validation gate.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makePopulationClient, validateResponse, POPULATION_REQUIRED_FIELDS } from '../evidence/populationClient.js';

const VALID = {
  persons:    1234567,
  source:     'US Census Bureau',
  dataset:    'ACS 2022 5-year',
  vintage:    2022,
  method:     'block-group geometry intersection',
  fetched_at: '2026-05-01T12:00:00Z',
  sha256:     'a'.repeat(64)
};

function mockFetch(handler){
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => handler(String(url), opts);
  return () => { globalThis.fetch = orig; };
}
function jsonResp(body, ok = true, status){
  return { ok, status: status ?? (ok ? 200 : 502), json: async () => body };
}

test('makePopulationClient returns null when POPULATION_EVIDENCE_URL is unset', () => {
  const c = makePopulationClient({ baseUrl: null });
  assert.equal(c, null);
});

test('valid upstream response → available=true with full provenance', async () => {
  const restore = mockFetch((url) => {
    assert.match(url, /\/v1\/population\/contour$/);
    return jsonResp(VALID);
  });
  try {
    const c = makePopulationClient({ baseUrl: 'http://pop.test' });
    const r = await c.populationForContour({
      geojson:       { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } },
      contour_label: '60 dBu (1 mV/m service)'
    });
    assert.equal(r.available, true);
    assert.equal(r.persons, 1234567);
    assert.equal(r.source,  'US Census Bureau');
    assert.equal(r.vintage, 2022);
    assert.equal(r.method,  'block-group geometry intersection');
    assert.ok(r.fetched_at);
    assert.match(r.endpoint, /\/v1\/population\/contour$/);
    assert.equal(r.contour_label, '60 dBu (1 mV/m service)');
  } finally { restore(); }
});

test('upstream HTTP failure → available=false, error reported', async () => {
  const restore = mockFetch(() => jsonResp({}, false, 503));
  try {
    const c = makePopulationClient({ baseUrl: 'http://pop.test' });
    const r = await c.populationForContour({ geojson: { type: 'Feature' }, contour_label: '' });
    assert.equal(r.available, false);
    assert.match(r.error, /HTTP\s*503/i);
  } finally { restore(); }
});

test('upstream network error → available=false, error reported', async () => {
  const restore = mockFetch(() => { throw new Error('connection reset'); });
  try {
    const c = makePopulationClient({ baseUrl: 'http://pop.test' });
    const r = await c.populationForContour({ geojson: { type: 'Feature' }, contour_label: '' });
    assert.equal(r.available, false);
    assert.match(r.error, /connection reset/);
  } finally { restore(); }
});

test('missing geojson is rejected before the network call', async () => {
  let called = false;
  const restore = mockFetch(() => { called = true; return jsonResp(VALID); });
  try {
    const c = makePopulationClient({ baseUrl: 'http://pop.test' });
    const r = await c.populationForContour({ geojson: null, contour_label: 'x' });
    assert.equal(called, false);
    assert.equal(r.available, false);
    assert.equal(r.error, 'no_geojson');
  } finally { restore(); }
});

/* ---------------- validateResponse (no network) ---------------- */

test('validateResponse: missing every required field is reported', () => {
  const r = validateResponse({});
  assert.equal(r.available, false);
  assert.equal(r.error, 'malformed_response');
  for (const k of POPULATION_REQUIRED_FIELDS){
    assert.ok(r.missing.includes(k), 'missing list should include ' + k);
  }
});

test('validateResponse: missing source alone keeps validation closed', () => {
  const r = validateResponse({ ...VALID, source: '' });
  assert.equal(r.available, false);
  assert.deepEqual(r.missing, ['source']);
});

test('validateResponse: missing vintage alone keeps validation closed', () => {
  const r = validateResponse({ ...VALID, vintage: null });
  assert.equal(r.available, false);
  assert.deepEqual(r.missing, ['vintage']);
});

test('validateResponse: missing method alone keeps validation closed', () => {
  const r = validateResponse({ ...VALID, method: '' });
  assert.equal(r.available, false);
  assert.deepEqual(r.missing, ['method']);
});

test('validateResponse: missing fetched_at alone keeps validation closed', () => {
  const r = validateResponse({ ...VALID, fetched_at: undefined });
  assert.equal(r.available, false);
  assert.deepEqual(r.missing, ['fetched_at']);
});

test('validateResponse: malformed fetched_at fails type check', () => {
  const r = validateResponse({ ...VALID, fetched_at: 'not-a-date' });
  assert.equal(r.available, false);
  assert.ok(r.missing.includes('fetched_at'));
});

test('validateResponse: non-numeric persons fails type check', () => {
  const r = validateResponse({ ...VALID, persons: 'one million' });
  assert.equal(r.available, false);
  assert.ok(r.missing.includes('persons'));
});

test('validateResponse: persons is rounded to a whole number', () => {
  const r = validateResponse({ ...VALID, persons: 1234567.6 });
  assert.equal(r.available, true);
  assert.equal(r.persons, 1234568);
});

test('validateResponse: vintage may be a string year (e.g. "2022")', () => {
  const r = validateResponse({ ...VALID, vintage: '2022' });
  assert.equal(r.available, true);
  assert.equal(r.vintage, '2022');
});
