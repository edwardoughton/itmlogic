// Safe JSON-from-fetch parser tests.  Proves the production crash
//   "Save failed: Unexpected token '<', '<!DOCTYPE '... is not valid JSON"
// can no longer surface to the user — every non-JSON response shape
// turns into a structured Error with a useful message instead of an
// uncaught SyntaxError inside response.json().

import test from 'node:test';
import assert from 'node:assert/strict';

import { readJsonOrThrow } from '../ui/lib/readJson.js';

function fakeResp({ status = 200, contentType = 'application/json', body = '{}' } = {}){
  return {
    ok:      status >= 200 && status < 300,
    status,
    headers: { get: (k) => k.toLowerCase() === 'content-type' ? contentType : null },
    text:    async () => body
  };
}

test('valid 2xx JSON returns the parsed body', async () => {
  const j = await readJsonOrThrow(fakeResp({ body: '{"id":7}' }));
  assert.deepEqual(j, { id: 7 });
});

test('HTML body with 200 status throws "Expected JSON" (the production crash)', async () => {
  // This is the exact failure mode that surfaced in the live UI.
  await assert.rejects(
    () => readJsonOrThrow(fakeResp({ contentType: 'text/html', body: '<!DOCTYPE html><html><head></head></html>' })),
    err => /Expected JSON but got text\/html/i.test(err.message)
  );
});

test('5xx with HTML body throws "HTTP 503: …" carrying the truncated body', async () => {
  await assert.rejects(
    () => readJsonOrThrow(fakeResp({ status: 503, contentType: 'text/html', body: '<!DOCTYPE html>service unavailable' })),
    err => /HTTP 503/.test(err.message) && /service unavailable/.test(err.message)
  );
});

test('5xx with JSON body returns the structured error message', async () => {
  await assert.rejects(
    () => readJsonOrThrow(fakeResp({ status: 503, contentType: 'application/json', body: '{"error":"DB_UNAVAILABLE","message":"DATABASE_URL not configured"}' })),
    err => /HTTP 503/.test(err.message) && /DATABASE_URL not configured/.test(err.message)
  );
});

test('Missing content-type defaults to "Expected JSON" failure (not a SyntaxError)', async () => {
  await assert.rejects(
    () => readJsonOrThrow(fakeResp({ contentType: '', body: 'not json' })),
    err => /Expected JSON/.test(err.message)
  );
});

test('Malformed JSON with claimed application/json content-type throws SyntaxError', async () => {
  await assert.rejects(
    () => readJsonOrThrow(fakeResp({ body: '{ broken' })),
    err => err instanceof SyntaxError
  );
});

test('Error object carries status / body / content_type for downstream branching', async () => {
  let caught = null;
  try {
    await readJsonOrThrow(fakeResp({ contentType: 'text/html', body: '<!DOCTYPE>' }));
  } catch (e){ caught = e; }
  assert.ok(caught);
  assert.equal(caught.status, 200);
  assert.equal(caught.content_type, 'text/html');
  assert.match(caught.body, /<!DOCTYPE>/);
});
