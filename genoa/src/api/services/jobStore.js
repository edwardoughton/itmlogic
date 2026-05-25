// In-process + DB-backed job store for engineering export jobs.
//
// PURPOSE
// -------
// HTTP exhibit/export requests can take 10–60 s (compute + parity +
// PDF render).  Behind a strict platform proxy these requests die with
// HTTP 504.  This store + the runner that lives next door let the API
// return immediately with a job_id and let the work continue in the
// background.  Clients poll GET /api/exhibit/jobs/:id.
//
// PERSISTENCE
// -----------
// State lives in two places:
//   1. In-process Map  — fast path; serves the instance that ran the job.
//   2. Postgres        — durable; serves OTHER instances behind the load
//                        balancer.  Without this, /api/exhibit/jobs/:id
//                        polls returned 404 whenever the request was
//                        routed to an instance other than the one that
//                        ran setImmediate(runJob).  Also survives a
//                        process restart so an in-flight artifact can
//                        still be downloaded after a deploy.
//
// Artifact bytes (PDF / TXT) are written to engineering_export_jobs as
// BYTEA via migration 004.  ~50–200 KB rows; TOAST handles them.
//
// Falls back to in-process-only when DATABASE_URL is unset or migrations
// 003/004 haven't run.  This keeps unit tests and stateless dev
// deployments working unchanged.
//
// ORPHAN RECOVERY
// ---------------
// Compute jobs run in-process via setImmediate(runJob) inside the same
// gunicorn-style API worker that handled the POST.  When that worker
// dies mid-compute (deploy, OOM, App Platform scale-down, SIGKILL)
// the job's status stays RUNNING in PG forever — every cross-instance
// poll keeps reporting the stale progress message and the UI is stuck.
//
// startOrphanReaper() (called from server.js) runs a background
// setInterval that flips any RUNNING row whose updated_at hasn't moved
// in JOB_REAP_STALE_AFTER_MS (default 15 min) to FAILED with code
// JOB_ORPHANED.  Uses updated_at as a heartbeat proxy because every
// setProgress()/completeJob()/failJob() already bumps it via persist().

import { randomUUID } from 'node:crypto';
import { pool, poolReady } from '../../db/pool.js';

export const JOB_STATUS = Object.freeze({
  QUEUED:   'queued',
  RUNNING:  'running',
  COMPLETE: 'complete',
  FAILED:   'failed'
});

export const JOB_KIND = Object.freeze({
  EXHIBIT:                 'exhibit',
  ENGINEERING_REPORT_TXT:  'engineering_report_txt',
  ENGINEERING_REPORT_PDF:  'engineering_report_pdf'
});

export const ORPHAN_REASON = 'JOB_ORPHANED';

const memory = new Map();    // job_id → record (full record incl. artifact)
let dbAvailable = poolReady();

export function createJob({ kind, input = {}, options = {} }){
  if (!Object.values(JOB_KIND).includes(kind)){
    const err = new Error(`unknown job kind: ${kind}`);
    err.code = 'BAD_KIND';
    throw err;
  }
  const id  = randomUUID();
  const now = new Date().toISOString();
  const record = {
    id,
    kind,
    status:           JOB_STATUS.QUEUED,
    progress_message: 'Queued',
    input:            structuredClone(input),
    options:          structuredClone(options),
    result:           null,
    artifact:         null,    // { content_type, body, filename }
    artifact_url:     null,
    error:            null,
    created_at:       now,
    updated_at:       now
  };
  memory.set(id, record);
  persist(record).catch(() => { /* best-effort */ });
  return id;
}

// Sync read of in-process state ONLY.  Use getJobAsync when the caller
// can fall back to the DB (i.e. behind a load balancer where the job
// may have been created on a sibling instance).
export function getJob(id){
  return memory.get(id) || null;
}

// Cross-instance read.  Tries in-process first (zero-latency for the
// instance that ran the job), then the DB.  Hydrates the in-process
// map on a DB hit so subsequent polls on this instance are fast.
//
// `light` (default true) skips the heavy artifact_body BYTEA + result_json
// JSONB columns.  Polls use light=true so the 2s-cadence UI polling
// doesn't pull megabytes of PDF/JSON from PG on every cross-instance
// hop — which used to wedge the PG connection pool and trip the
// 30-60 s gateway timeout under load.  The /artifact endpoint passes
// light=false to fetch the full body; the poll endpoint upgrades to
// the full read only when status=COMPLETE and the caller actually wants
// the result JSON (see exhibitJobs.js GET /jobs/:id).
export async function getJobAsync(id, { light = true } = {}){
  const m = memory.get(id);
  if (m) return m;
  if (!dbAvailable) return null;
  const row = light ? await readDbRowLight(id) : await readDbRowFull(id);
  if (!row) return null;
  // Only hydrate the in-process cache from a FULL read — caching a
  // light row would mask the heavy data from a later /artifact call
  // until process restart.
  if (!light) memory.set(id, row);
  return row;
}

export function listJobs(){
  return Array.from(memory.values()).map(toView);
}

export function updateJob(id, patch){
  const r = memory.get(id);
  if (!r) return null;
  Object.assign(r, patch, { updated_at: new Date().toISOString() });
  persist(r).catch(() => { /* best-effort */ });
  return r;
}

export function setProgress(id, message){
  return updateJob(id, { status: JOB_STATUS.RUNNING, progress_message: message });
}

export function completeJob(id, { result = null, artifact = null, artifact_url = null } = {}){
  return updateJob(id, {
    status:           JOB_STATUS.COMPLETE,
    progress_message: 'Complete',
    result,
    artifact,
    artifact_url,
    error:            null
  });
}

// Error fields handled explicitly by failJob.  Any other own-enumerable
// property on the Error (e.g. the FCC engine's `flag` array, or upstream
// HTTP `status` and `body`) is preserved under `error.details` so the
// failed-job record carries enough diagnostic context for an operator
// to root-cause without rerunning the job.
const FAIL_ERR_STD_FIELDS = new Set(['name', 'message', 'stack', 'code', 'cause']);

export function failJob(id, err){
  const message = (err && (err.message || err.toString())) || 'unknown error';
  const code    = (err && err.code) || 'JOB_FAILED';
  const stack   = (err && err.stack) || null;
  const details = {};
  if (err && typeof err === 'object'){
    for (const k of Object.keys(err)){
      if (FAIL_ERR_STD_FIELDS.has(k)) continue;
      details[k] = err[k];
    }
  }
  const error = { code, message, stack };
  if (Object.keys(details).length) error.details = details;
  return updateJob(id, {
    status:           JOB_STATUS.FAILED,
    progress_message: 'Failed',
    error
  });
}

// JSON-serializable view (omits the heavy artifact body).
export function toView(r){
  if (!r) return null;
  return {
    job_id:           r.id,
    kind:             r.kind,
    status:           r.status,
    progress_message: r.progress_message || null,
    artifact_url:     r.artifact_url || null,
    error:            r.error || null,
    created_at:       r.created_at,
    updated_at:       r.updated_at
  };
}

// ─────────── DB mirror (best-effort, optional) ───────────

async function persist(r){
  if (!dbAvailable) return;
  try {
    const p = pool();
    await p.query(
      `INSERT INTO engineering_export_jobs
         (id, kind, status, progress_message, input_json, options_json,
          result_json, artifact_url, error_json,
          artifact_body, artifact_content_type, artifact_filename,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         status                = EXCLUDED.status,
         progress_message      = EXCLUDED.progress_message,
         result_json           = EXCLUDED.result_json,
         artifact_url          = EXCLUDED.artifact_url,
         error_json            = EXCLUDED.error_json,
         artifact_body         = COALESCE(EXCLUDED.artifact_body,         engineering_export_jobs.artifact_body),
         artifact_content_type = COALESCE(EXCLUDED.artifact_content_type, engineering_export_jobs.artifact_content_type),
         artifact_filename     = COALESCE(EXCLUDED.artifact_filename,     engineering_export_jobs.artifact_filename),
         updated_at            = EXCLUDED.updated_at`,
      [
        r.id, r.kind, r.status, r.progress_message,
        JSON.stringify(r.input || {}),
        JSON.stringify(r.options || {}),
        r.result ? JSON.stringify(r.result) : null,
        r.artifact_url || null,
        r.error ? JSON.stringify(r.error) : null,
        r.artifact?.body || null,
        r.artifact?.content_type || null,
        r.artifact?.filename || null,
        r.created_at, r.updated_at
      ]
    );
  } catch (e){
    // Migration 003 / 004 may not be applied yet, OR the new BYTEA
    // columns are missing.  Try the legacy 13-arg insert (sans artifact
    // bytes) once before giving up — keeps writes flowing while a
    // deploy with the new schema rolls out.
    try {
      const p = pool();
      await p.query(
        `INSERT INTO engineering_export_jobs
           (id, kind, status, progress_message, input_json, options_json,
            result_json, artifact_url, error_json, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO UPDATE SET
           status           = EXCLUDED.status,
           progress_message = EXCLUDED.progress_message,
           result_json      = EXCLUDED.result_json,
           artifact_url     = EXCLUDED.artifact_url,
           error_json       = EXCLUDED.error_json,
           updated_at       = EXCLUDED.updated_at`,
        [
          r.id, r.kind, r.status, r.progress_message,
          JSON.stringify(r.input || {}),
          JSON.stringify(r.options || {}),
          r.result ? JSON.stringify(r.result) : null,
          r.artifact_url || null,
          r.error ? JSON.stringify(r.error) : null,
          r.created_at, r.updated_at
        ]
      );
    } catch {
      // Real failure (table missing entirely, DB down, etc) — drop into
      // in-process-only mode for this process's lifetime.
      dbAvailable = false;
    }
  }
}

// Light read — skips artifact_body (BYTEA, multi-MB for PDFs) and
// result_json (JSONB, can be MBs for a full exhibit).  This is the
// hot path: the UI polls /jobs/:id every 2 s and we don't want to
// scan / transfer megabytes per poll across the cross-instance fallback.
async function readDbRowLight(id){
  if (!dbAvailable) return null;
  try {
    const p = pool();
    const r = await p.query(
      `SELECT id, kind, status, progress_message,
              input_json, options_json,
              artifact_url, error_json,
              artifact_content_type, artifact_filename,
              (artifact_body IS NOT NULL) AS has_artifact_body,
              created_at, updated_at
         FROM engineering_export_jobs
        WHERE id = $1`,
      [id]
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id:               row.id,
      kind:             row.kind,
      status:           row.status,
      progress_message: row.progress_message,
      input:            row.input_json   || {},
      options:          row.options_json || {},
      // result + artifact.body are stripped in the light read.  Callers
      // that need them must re-fetch via getJobAsync(id, { light: false }).
      result:           null,
      artifact:         row.has_artifact_body
        ? {
            body:         null,    // sentinel: present in DB, not loaded here
            content_type: row.artifact_content_type || 'application/octet-stream',
            filename:     row.artifact_filename     || null
          }
        : null,
      artifact_url:     row.artifact_url || null,
      error:            row.error_json   || null,
      created_at:       (row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at),
      updated_at:       (row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at)
    };
  } catch {
    return null;
  }
}

// Full read — includes result_json + artifact_body.  Used by the
// /artifact endpoint and by completion-time polls (status=COMPLETE)
// where the UI wants the structured exhibit JSON inline.
async function readDbRowFull(id){
  if (!dbAvailable) return null;
  try {
    const p = pool();
    const r = await p.query(
      `SELECT id, kind, status, progress_message,
              input_json, options_json, result_json,
              artifact_url, error_json,
              artifact_body, artifact_content_type, artifact_filename,
              created_at, updated_at
         FROM engineering_export_jobs
        WHERE id = $1`,
      [id]
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      id:               row.id,
      kind:             row.kind,
      status:           row.status,
      progress_message: row.progress_message,
      input:            row.input_json   || {},
      options:          row.options_json || {},
      result:           row.result_json  || null,
      artifact:         row.artifact_body
        ? {
            body:         row.artifact_body,                          // pg returns Buffer for BYTEA
            content_type: row.artifact_content_type || 'application/octet-stream',
            filename:     row.artifact_filename     || null
          }
        : null,
      artifact_url:     row.artifact_url || null,
      error:            row.error_json   || null,
      created_at:       (row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at),
      updated_at:       (row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at)
    };
  } catch {
    return null;
  }
}

// ─────────── Orphan reaper ───────────
//
// Compute jobs run in-process via setImmediate(runJob).  When the API
// worker dies mid-compute (deploy, OOM, scale-down, SIGKILL), the job
// stays in RUNNING status forever — the UI polls and polls and never
// sees a terminal state.  reapOrphanedJobs() flips any RUNNING job
// whose updated_at hasn't moved in stale_after_ms to FAILED with code
// JOB_ORPHANED, so the UI can surface a real failure + retry path.
//
// updated_at is the heartbeat proxy: every setProgress() bumps it via
// persist(), so a healthy long compute (e.g. SPLAT inline sweep over
// 36 radials) stays fresh as it ticks through PROGRESS milestones.
// The default 15-min stale window comfortably exceeds the longest
// expected compute (gunicorn worker timeout 600 s + parity report +
// PDF render).

export async function reapOrphanedJobs({ stale_after_ms = 15 * 60 * 1000 } = {}){
  if (!dbAvailable) return { reaped: 0, scanned: 0, reason: 'db unavailable' };
  const cutoff = new Date(Date.now() - stale_after_ms).toISOString();
  try {
    const p = pool();
    // Atomic find-and-flip in a single UPDATE so two concurrent reapers
    // (one per replica) can't both "claim" the same row.  RETURNING
    // gives us the ids we touched so we can mirror into in-process state.
    const r = await p.query(
      `UPDATE engineering_export_jobs
          SET status           = 'failed',
              progress_message = 'Failed (orphaned)',
              error_json       = $2,
              updated_at       = NOW()
        WHERE status = 'running' AND updated_at < $1
        RETURNING id`,
      [cutoff, JSON.stringify({
        code:    ORPHAN_REASON,
        message: `job exceeded ${Math.round(stale_after_ms / 1000)}s without progress and was marked failed by the orphan reaper`
      })]
    );
    const reaped = r.rowCount || 0;
    // Mirror into the local in-process map so a stale local cache
    // doesn't resurrect the RUNNING view on the next getJob() hit.
    for (const row of (r.rows || [])){
      const m = memory.get(row.id);
      if (m){
        m.status           = JOB_STATUS.FAILED;
        m.progress_message = 'Failed (orphaned)';
        m.error            = { code: ORPHAN_REASON, message: 'job orphaned by reaper' };
        m.updated_at       = new Date().toISOString();
      }
    }
    return { reaped, scanned: reaped, cutoff };
  } catch (e){
    return { reaped: 0, scanned: 0, error: String(e?.message || e) };
  }
}

// Start a setInterval-driven reaper.  Returns a stop() function for
// graceful shutdown.  Default 60 s cadence + 15-min stale window
// means an orphaned job surfaces as FAILED within ~16 min worst case.
//
// ENV
//   JOB_REAP_INTERVAL_MS    default 60_000   (1 min between scans)
//   JOB_REAP_STALE_AFTER_MS default 900_000  (15 min without progress)
export function startOrphanReaper({ logger = console } = {}){
  const period_ms      = Math.max(5_000,  Number(process.env.JOB_REAP_INTERVAL_MS)    || 60_000);
  const stale_after_ms = Math.max(60_000, Number(process.env.JOB_REAP_STALE_AFTER_MS) || 15 * 60 * 1000);
  if (!dbAvailable){
    logger?.warn?.(`[job-reaper] DB unavailable; orphan reaper disabled`);
    return () => {};
  }
  logger?.log?.(`[job-reaper] started (period=${period_ms}ms stale_after=${stale_after_ms}ms)`);
  const t = setInterval(() => {
    reapOrphanedJobs({ stale_after_ms })
      .then((r) => {
        if (r.reaped > 0){
          logger?.warn?.(`[job-reaper] flipped ${r.reaped} orphaned job(s) to FAILED (cutoff=${r.cutoff})`);
        } else if (r.error){
          logger?.error?.(`[job-reaper] scan failed: ${r.error}`);
        }
      })
      .catch((e) => logger?.error?.(`[job-reaper] iteration failed: ${e?.message || e}`));
  }, period_ms);
  t.unref?.();
  return () => clearInterval(t);
}

// ─────────── Test-only helpers ───────────

export function _resetForTests(){
  memory.clear();
  dbAvailable = poolReady();
}
