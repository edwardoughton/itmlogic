// Engineering export job queue — execution architecture tests.
//
// These tests verify the job submission / polling / artifact lifecycle
// works the way the UI now relies on, and that the 504-prone synchronous
// paths are no longer the default in the frontend.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

import {
  createJob, getJob, JOB_KIND, JOB_STATUS, _resetForTests
} from '../api/services/jobStore.js';
import { runJob, scheduleJob } from '../api/services/jobRunner.js';
import { FM_CLASS_A } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const APP_JSX = path.join(ROOT, 'src/ui/App.jsx');

// ── unit: submission is fast ───────────────────────────────────────────────

test('createJob + scheduleJob returns within 1 second (no synchronous compute)', () => {
  _resetForTests();
  const t0 = Date.now();
  const id = createJob({
    kind: JOB_KIND.EXHIBIT,
    input: { inputs: FM_CLASS_A, options: {} }
  });
  scheduleJob(id);
  const dt = Date.now() - t0;
  assert.ok(id, 'createJob should return an id');
  assert.ok(dt < 1000, `createJob+scheduleJob took ${dt}ms; must be < 1000ms`);
  // The job must be in 'queued' (or already 'running') — never blocked
  // until completion.
  const view = getJob(id);
  assert.ok([JOB_STATUS.QUEUED, JOB_STATUS.RUNNING].includes(view.status));
});

// ── unit: failed compute stores the actual error (not just HTTP 504) ──────

test('failed compute stores the engine error on the job', async () => {
  _resetForTests();
  // Engine is intentionally permissive for partially-populated FM
  // inputs (degraded-mode exhibit + blocker warnings), so { call: 'BAD' }
  // alone now produces 'complete'.  Force a hard throw by passing an
  // unknown service, which methodFor() rejects with "unknown service".
  //
  // Important: createJob stores body.input directly, and jobRunner's
  // computeReq() then wraps it as { inputs: r.input, options: r.options }.
  // So r.input here IS the form fields — passing { inputs: {...} } would
  // double-nest and the engine would never see `service`.  Match the
  // shape the real /api/exhibit/jobs route uses.
  const id = createJob({
    kind:  JOB_KIND.EXHIBIT,
    input: { call: 'BAD', service: 'BOGUS_SERVICE' }
  });
  await runJob(id);   // synchronous-await for deterministic test timing
  const job = getJob(id);
  assert.equal(job.status, JOB_STATUS.FAILED);
  assert.ok(job.error, 'failed job must carry a structured error');
  assert.ok(typeof job.error.message === 'string' && job.error.message.length > 0,
    'error.message must be populated');
  // No stack-trace leak in the public view (toView strips heavy fields).
});

// ── unit: completed PDF job carries an artifact_url ───────────────────────

test('completed PDF job exposes artifact_url and binary PDF body', async () => {
  _resetForTests();
  const id = createJob({
    kind:  JOB_KIND.ENGINEERING_REPORT_PDF,
    input: { inputs: FM_CLASS_A, options: {} }
  });
  await runJob(id);
  const job = getJob(id);
  assert.equal(job.status, JOB_STATUS.COMPLETE, job.error?.message);
  assert.ok(job.artifact_url && job.artifact_url.includes(`/api/exhibit/jobs/${id}/artifact`));
  assert.ok(job.artifact && Buffer.isBuffer(job.artifact.body));
  assert.equal(job.artifact.content_type, 'application/pdf');
  assert.equal(job.artifact.body.slice(0, 4).toString('ascii'), '%PDF',
    'PDF artifact must start with %PDF magic bytes');
  assert.ok(/^genoa-engineering-statement-/.test(job.artifact.filename));
});

// ── unit: TXT report job carries a UTF-8 body ─────────────────────────────

test('completed TXT engineering-report job carries a text body', async () => {
  _resetForTests();
  const id = createJob({
    kind:  JOB_KIND.ENGINEERING_REPORT_TXT,
    input: { inputs: FM_CLASS_A, options: {} }
  });
  await runJob(id);
  const job = getJob(id);
  assert.equal(job.status, JOB_STATUS.COMPLETE, job.error?.message);
  assert.ok(job.artifact_url);
  const text = job.artifact.body.toString('utf8');
  assert.ok(text.includes('ENGINEERING STATEMENT'), 'TXT artifact must include the report heading');
});

// ── unit: input is not mutated by the runner ──────────────────────────────

test('jobRunner does not mutate the caller input object', async () => {
  _resetForTests();
  const input = { inputs: { ...FM_CLASS_A }, options: {} };
  const before = JSON.stringify(input);
  const id = createJob({ kind: JOB_KIND.EXHIBIT, input });
  await runJob(id);
  assert.equal(JSON.stringify(input), before,
    'caller input must be untouched by createJob/runJob');
});

// ── grep: UI no longer uses the synchronous 504-prone export path ─────────

test('UI compute() and engineering exports use the async job endpoints', () => {
  const src = fs.readFileSync(APP_JSX, 'utf8');
  // compute() must hit the async job endpoint, not the synchronous one.
  assert.ok(/runJobAndWait\(\s*['"]exhibit['"]/.test(src),
    'UI compute() must use runJobAndWait with kind "exhibit"');
  // The engineering-report download must use the job endpoint, not the
  // synchronous /export/engineering-report.{txt,pdf} POST.
  assert.ok(/runJobAndWait\(\s*kind\b/.test(src)
            || /runJobAndWait\(\s*['"]engineering_report/.test(src),
    'engineering-statement download must go through runJobAndWait');
  // And the synchronous engineering-report path must no longer be the
  // primary code path the UI hits — the only mention should be in
  // server-side comments / dead doc; the active fetch is to /api/exhibit/jobs.
  const fetchEngReport = (src.match(/fetch\([^)]*\/api\/exhibits\/export\/engineering-report\./g) || []);
  assert.equal(fetchEngReport.length, 0,
    'UI must not fetch the synchronous engineering-report endpoint');
});

// ── HTTP integration: POST 202 + polling + artifact streaming ─────────────

test('HTTP /api/exhibit/jobs end-to-end (POST 202 + polling + artifact)', async (t) => {
  const port    = 18299 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${port}`;
  // requireAuth fail-closes when AUTH_* env is missing.  Supply a
  // syntactic password hash + a known session secret, then mint a
  // cookie directly (same HMAC+base64url that middleware/auth.js
  // signSession() emits) so every /api/* fetch carries an auth.
  const AUTH_SESSION_SECRET = 'genoa-test-session-secret-do-not-use-in-prod-32b';
  const AUTH_PASSWORD_HASH  = 'scrypt$00$00';
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 3600 }))
    .toString('base64url');
  const sig = crypto.createHmac('sha256', Buffer.from(AUTH_SESSION_SECRET, 'utf8'))
    .update(payload).digest('base64url');
  const sessionCookie = `genoa_session=${payload}.${sig}`;
  const proc = spawn(process.execPath, ['src/api/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test', DATABASE_URL: '',
           AUTH_PASSWORD_HASH, AUTH_SESSION_SECRET,
           FACILITY_DISABLE_FCC_FMQ: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => { try { proc.kill('SIGTERM'); } catch {} });
  await waitForHealth(baseUrl + '/healthz', 8000);
  const authFetch = (url, init = {}) => fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), cookie: sessionCookie }
  });

  // Submit a TXT engineering-report job.
  const t0 = Date.now();
  const post = await authFetch(baseUrl + '/api/exhibit/jobs', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify({
      kind:    'engineering_report_txt',
      input:   { inputs: FM_CLASS_A, options: {} }
    })
  });
  const postTime = Date.now() - t0;
  assert.equal(post.status, 202, 'POST should return 202 Accepted');
  assert.ok(postTime < 1000, `POST took ${postTime}ms; must return < 1000ms`);
  const submitted = await post.json();
  assert.equal(submitted.status, 'queued');
  assert.ok(submitted.job_id);

  // Poll until complete.
  let view = null;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline){
    const r = await authFetch(baseUrl + `/api/exhibit/jobs/${submitted.job_id}`);
    assert.equal(r.status, 200);
    view = await r.json();
    if (view.status === 'complete' || view.status === 'failed') break;
    await new Promise(res => setTimeout(res, 250));
  }
  assert.equal(view.status, 'complete', view.error?.message);
  assert.ok(view.artifact_url && view.artifact_url.includes('/artifact'));

  // Stream the artifact.
  const ar = await authFetch(baseUrl + view.artifact_url);
  assert.equal(ar.status, 200);
  assert.ok(/text\/plain/.test(ar.headers.get('content-type')));
  const body = await ar.text();
  assert.ok(body.includes('ENGINEERING STATEMENT'));

  // Polling for an unknown id returns 404.
  const r404 = await authFetch(baseUrl + '/api/exhibit/jobs/00000000-0000-0000-0000-000000000000');
  assert.equal(r404.status, 404);

  // Bad kind returns 400.
  const r400 = await authFetch(baseUrl + '/api/exhibit/jobs', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify({ kind: 'nope', input: {} })
  });
  assert.equal(r400.status, 400);
});

async function waitForHealth(url, timeoutMs){
  const start = Date.now();
  while (Date.now() - start < timeoutMs){
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server did not become healthy in ' + timeoutMs + 'ms');
}
