import express from 'express';
import { dbHealthy, dbProbe, poolReady } from '../../db/pool.js';
import { sidecarStatus } from '../services/sidecars.js';
import { probeAllSources } from '../services/sourcesHealth.js';

const r = express.Router();

// Liveness — never blocks, never touches DB / sidecars.
r.get('/healthz', (_req, res) => res.type('text').send('ok'));
r.get('/health',  (_req, res) => res.type('text').send('ok'));

// Readiness — DB is required, sidecars are optional.
//
// HTTP CODE NOTE
//   Returns 200 even when the underlying DB is unreachable.  Health
//   state is conveyed by `ok` in the JSON body.  Why: App Platform's
//   edge proxy intercepts upstream 5xx responses and substitutes its
//   own HTML error page — so a 503 here would prevent the operator
//   from ever reading the diagnostic body that explains *why* the
//   readiness probe failed.  Liveness (the container is up) is the
//   appropriate semantic for this status code; readiness (the app is
//   wired correctly) is the body.
// /readyz JSON shape (additive-only — fields below are appended, never
// removed, so existing consumers keep working):
//   {
//     ok:            boolean,
//     db_configured: boolean,
//     db_healthy:    boolean,
//     sidecars: {
//       <name>: {
//         configured:    boolean,
//         healthy:       boolean,
//         baseUrl?:      string|null,
//         latency_ms?:   number,
//         role?:         'fcc'|'advisory_physics'|'environmental'|
//                        'identity'|'rendering'|'reference_engine'|
//                        'observability'|null,
//         filing_effect?:'authoritative'|'none'|null
//       }, ...
//     }
//   }
// `role` and `filing_effect` are sourced from SIDECAR_REGISTRY in
// services/sidecars.js so operators can answer "did losing this sidecar
// move a §73.* number?" at a glance without leaving the readiness probe.
r.get('/readyz', async (_req, res) => {
  const db = await dbHealthy();
  const sc = await sidecarStatus();
  const ok = db || !poolReady();   // stateless mode is also "ready"
  res.status(200).json({
    ok,
    db_configured: poolReady(),
    db_healthy:    db,
    sidecars:      sc
  });
});

// /health/db — detailed DB probe.  Runs SELECT current_database(),
// current_user, now(), version() through the SHARED pool, surfacing
// SSL policy and connection latency.  Same 200-always semantics as
// /readyz so the operator can read the diagnostic body even when the
// pool is misconfigured (most common cause: SSL self-signed certificate
// failure on managed Postgres providers — set
// PG_SSL_REJECT_UNAUTHORIZED=false).  No credentials, no host, no
// password are echoed.
r.get('/health/db', async (_req, res) => {
  const probe = await dbProbe();
  res.status(200).json(probe);
});

// Per-source fallback-chain health — probes every primary, secondary,
// and tertiary upstream the orchestrator can reach.  Use this to
// answer "if ZTR went down right now, would the next exhibit still
// produce sourced HAAT, FCC contour, population, and nearby primaries?"
// Returns 503 only if at least one critical query has zero reachable
// sources (i.e., a tier-collapse).  Other partial failures are 200 with
// per-tier reachability details so the operator can pick a fallback.
r.get('/api/sources/health', async (_req, res) => {
  const status = await probeAllSources();
  res.status(status.all_critical_have_a_reachable_source ? 200 : 503).json(status);
});

export default r;
