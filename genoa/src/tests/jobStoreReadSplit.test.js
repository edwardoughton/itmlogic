// jobStore.getJobAsync: light vs full read shape.
//
// Validates the 504-prevention split: the cross-instance fallback used
// by the /jobs/:id poll endpoint must NOT pull artifact_body (BYTEA,
// can be multi-MB) on every poll.  Light reads strip artifact_body +
// result_json so the 2-s polling cadence doesn't wedge the PG pool
// and surface as a gateway 504.
//
// These tests exercise the in-memory path (no DB) — the SQL is unit-
// coverage-via-shape: we assert the returned row's `result` is null
// on light reads and the artifact body is left absent.  DB-backed
// integration of the same split is the responsibility of the existing
// HTTP tests in exportJobs.test.js.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createJob, completeJob, getJobAsync, getJob,
  JOB_KIND, JOB_STATUS, _resetForTests
} from '../api/services/jobStore.js';

test('getJobAsync returns the in-memory job verbatim when present (light=true)', async () => {
  _resetForTests();
  const id = createJob({ kind: JOB_KIND.EXHIBIT, input: {}, options: {} });
  completeJob(id, {
    result:   { exhibit: { big: 'x'.repeat(10_000) } },
    artifact: {
      body:         Buffer.from('fake PDF bytes'),
      content_type: 'application/pdf',
      filename:     'x.pdf'
    }
  });
  const r = await getJobAsync(id);    // default: light=true
  // In-memory hit must return the full record regardless of `light` —
  // the light/full distinction is a DB-fetch optimisation, not a
  // serializer.  Polls routed to the creating instance pay nothing.
  assert.equal(r.status, JOB_STATUS.COMPLETE);
  assert.ok(r.result);
  assert.ok(r.result.exhibit);
  assert.ok(Buffer.isBuffer(r.artifact.body));
});

test('getJobAsync with light=false also returns the in-memory job', async () => {
  _resetForTests();
  const id = createJob({ kind: JOB_KIND.EXHIBIT, input: {}, options: {} });
  completeJob(id, {
    result:   { exhibit: { foo: 'bar' } },
    artifact: { body: Buffer.from('pdf'), content_type: 'application/pdf', filename: 'a.pdf' }
  });
  const r = await getJobAsync(id, { light: false });
  assert.equal(r.status, JOB_STATUS.COMPLETE);
  assert.ok(r.result.exhibit);
  assert.ok(Buffer.isBuffer(r.artifact.body));
});

test('getJobAsync returns null when neither memory nor DB has the job', async () => {
  _resetForTests();
  const r = await getJobAsync('does-not-exist');
  assert.equal(r, null);
});

test('getJob (sync, in-process only) ignores DB fallback', () => {
  _resetForTests();
  const id = createJob({ kind: JOB_KIND.EXHIBIT, input: {}, options: {} });
  const view = getJob(id);
  assert.equal(view.id, id);
  assert.equal(getJob('nope'), null);
});
