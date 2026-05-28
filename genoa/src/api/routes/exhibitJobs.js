// Engineering export job routes (asynchronous compute / report rendering).
//
// Mounted under /api by src/api/server.js.
//
//   POST  /api/exhibit/jobs                 → 202 { job_id, status:'queued' }
//   GET   /api/exhibit/jobs                 → list of recent jobs (debug)
//   GET   /api/exhibit/jobs/:id             → 200 { job_id, status, ... }
//   GET   /api/exhibit/jobs/:id/artifact    → streams TXT / PDF / JSON
//
// These exist to keep public HTTP requests under the 30-60 s proxy
// timeout for full compute + parity + PDF render workflows.  The old
// synchronous endpoints are still wired in src/api/routes/exhibits.js
// for callers that want a quick small export.

import express from 'express';
import { asyncHandler } from '../middleware/errors.js';

import {
  JOB_KIND, JOB_STATUS,
  createJob, getJob, getJobAsync, listJobs, toView
} from '../services/jobStore.js';
import { scheduleJob } from '../services/jobRunner.js';

const r = express.Router();

const MAX_BODY_KIND = new Set(Object.values(JOB_KIND));

// POST /api/exhibit/jobs  — enqueue a job, return 202 immediately.
r.post('/exhibit/jobs', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const kind = body.kind;
  if (!MAX_BODY_KIND.has(kind)){
    return res.status(400).json({
      error:   'BAD_REQUEST',
      message: `kind must be one of ${[...MAX_BODY_KIND].join(', ')}`
    });
  }
  const id = createJob({
    kind,
    input:   body.input   || {},
    options: body.options || {}
  });
  scheduleJob(id);
  res.status(202).json({
    job_id: id,
    status: JOB_STATUS.QUEUED
  });
}));

// GET /api/exhibit/jobs  — debug listing.
r.get('/exhibit/jobs', asyncHandler(async (_req, res) => {
  res.json({ jobs: listJobs() });
}));

// GET /api/exhibit/jobs/:id  — poll endpoint (cheap; UI hits every 2 s).
//
// Uses getJobAsync so a poll routed to a sibling instance (App Platform
// load-balances across instances; the job may have been created on the
// instance that handled the POST) finds the job in the DB mirror
// instead of returning 404.
//
// Two-stage read: the cross-instance read defaults to LIGHT (no
// artifact_body BYTEA, no result_json JSONB) so the 2 s-cadence polling
// doesn't pull megabytes of PDF / exhibit JSON from PG on every hop —
// that used to wedge the connection pool and surface as a gateway 504.
// When the light read shows status=COMPLETE we re-fetch with light=false
// so the response still inlines the result_json the UI wants.
r.get('/exhibit/jobs/:id', asyncHandler(async (req, res) => {
  let job = await getJobAsync(req.params.id);          // light by default
  if (!job) return res.status(404).json({ error: 'NOT_FOUND', message: 'job not found' });
  if (job.status === JOB_STATUS.COMPLETE && !job.result){
    // Light read stripped result_json — re-fetch full so the UI gets
    // the exhibit inline on the completing poll.  Doesn't touch
    // artifact_body (still served separately via /artifact).
    const full = await getJobAsync(req.params.id, { light: false });
    if (full) job = full;
  }
  // Include progress_message + (when complete) the structured result so
  // the UI doesn't need a second round-trip for the exhibit JSON case.
  const view = toView(job);
  if (job.status === JOB_STATUS.COMPLETE && job.result){
    view.result = job.result;
  }
  res.json(view);
}));

// GET /api/exhibit/jobs/:id/artifact  — streams the rendered artifact
// (PDF / TXT) or the exhibit JSON.  Same cross-instance fallback as the
// poll endpoint.  Full read (artifact_body is the whole point).
r.get('/exhibit/jobs/:id/artifact', asyncHandler(async (req, res) => {
  const job = await getJobAsync(req.params.id, { light: false });
  if (!job) return res.status(404).json({ error: 'NOT_FOUND', message: 'job not found' });
  if (job.status === JOB_STATUS.FAILED){
    return res.status(500).json({ error: 'JOB_FAILED', detail: job.error || null });
  }
  if (job.status !== JOB_STATUS.COMPLETE){
    return res.status(409).json({
      error:   'JOB_NOT_READY',
      status:  job.status,
      message: 'artifact is not yet available; poll /api/exhibit/jobs/:id'
    });
  }
  if (job.artifact && job.artifact.body){
    res.type(job.artifact.content_type || 'application/octet-stream');
    if (job.artifact.filename){
      res.set('Content-Disposition', `attachment; filename="${job.artifact.filename}"`);
    }
    return res.send(job.artifact.body);
  }
  // Exhibit-kind jobs return JSON.
  if (job.result && job.result.exhibit){
    res.type('application/json');
    return res.send(JSON.stringify(job.result.exhibit, null, 2));
  }
  res.status(500).json({
    error:   'ARTIFACT_EVICTED',
    message: 'artifact body is no longer available (likely process restart)'
  });
}));

export default r;
