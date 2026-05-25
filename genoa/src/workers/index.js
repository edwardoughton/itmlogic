// Genoa worker — async jobs.
//
// Phase 1 (this file): polling loop that reads pending jobs from
// Postgres and dispatches them.  No external broker (Redis / SQS)
// dependency by design: the same Postgres schema that holds the
// exhibits also holds the work queue.
//
// Job kinds:
//   'export_pdf'       — render PDF when implemented
//   'validation_run'   — re-execute the validation suite
//   'measurement_ingest' — fetch a SigMF object from Spaces, parse,
//                          attach as evidence to an exhibit
//
// This stub registers the handler signatures and the polling loop;
// each handler currently is a no-op recording "not implemented".

import { pool, poolReady, dbHealthy } from '../db/pool.js';
import { runValidationSuite } from '../engine/validation/runner.js';

const POLL_MS = parseInt(process.env.WORKER_POLL_MS || '5000', 10);

const HANDLERS = {
  validation_run:     handleValidationRun,
  export_pdf:         handleExportPdf,
  measurement_ingest: handleMeasurementIngest
};

async function handleValidationRun(_payload){
  if (!poolReady()) return { status: 'skipped', reason: 'no DATABASE_URL' };
  const r = await runValidationSuite();
  await pool().query(
    `INSERT INTO genoa_validation_run
       (curve_version, n_cases, n_run, n_pass,
        n_authoritative_run, n_authoritative_pass, authoritative_pass, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [r.curve_version, r.n_cases, r.n_run, r.n_pass,
     r.n_run, r.n_pass, r.authoritative_pass, r]
  );
  return { status: 'ok', n_run: r.n_run, n_pass: r.n_pass, authoritative_pass: r.authoritative_pass };
}

async function handleExportPdf(_payload){
  return { status: 'not_implemented', reason: 'PDF renderer is a TODO; see src/exports/pdf/stub.js' };
}

async function handleMeasurementIngest(_payload){
  return { status: 'not_implemented', reason: 'wire up object-store fetch + sigmf parse + evidence attach' };
}

async function tick(){
  if (!poolReady()) return;
  if (!(await dbHealthy())) return;
  // Phase 1: no genoa_job table yet; this loop is a placeholder for the
  // queue.  When the queue table is added, the worker will pick up the
  // oldest 'pending' row and call HANDLERS[row.kind].
  void HANDLERS; // referenced so lint doesn't complain
}

async function main(){
  console.log(`[genoa-worker] started; poll ${POLL_MS} ms; db_configured=${poolReady()}`);
  setInterval(() => { tick().catch(e => console.warn('[genoa-worker] tick error:', e.message)); }, POLL_MS);
}

main().catch(err => {
  console.error('[genoa-worker] fatal:', err && err.stack || err);
  process.exit(1);
});
