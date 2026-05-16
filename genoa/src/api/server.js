// Genoa API entry.  Hardened startup, fail-soft on every optional
// dependency.  Health binds synchronously; migrations / sidecar polling
// happen in the background after the server is already listening.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import healthRoutes    from './routes/health.js';
import curveRoutes     from './routes/curves.js';
import exhibitRoutes    from './routes/exhibits.js';
import exhibitJobRoutes from './routes/exhibitJobs.js';
import facilityRoutes   from './routes/facilities.js';
import sweepRoutes      from './routes/sweep.js';
import peCertificationRoutes from './routes/peCertification.js';
import amDaDesignRoutes from './routes/amDaDesign.js';
import amNightRoutes    from './routes/amNight.js';
import allotmentRoutes  from './routes/allotment.js';
import comparablesRoutes from './routes/comparables.js';
import exhibitDiffRoutes from './routes/exhibitDiff.js';
import section73215ShowingRoutes from './routes/section73215Showing.js';
import lmsFilingRoutes from './routes/lmsFiling.js';
import captureRoutes   from './routes/captures.js';
import geodataRoutes   from './routes/geodata.js';
import authRoutes       from './routes/auth.js';
import { errorHandler } from './middleware/errors.js';
import { requireAuth }  from './middleware/auth.js';
import { migrate }   from '../db/migrate.js';
import { poolReady } from '../db/pool.js';
import { startOrphanReaper } from './services/jobStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

process.on('uncaughtException',  (err) => { console.error('[genoa] uncaughtException:',  err && err.stack || err); process.exit(1); });
process.on('unhandledRejection', (err) => { console.error('[genoa] unhandledRejection:', err && err.stack || err); process.exit(1); });

const PORT     = parseInt(process.env.PORT || '8080', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));

// Health (mount before everything; keep it cheap).
app.use(healthRoutes);

// Static UI.  In production the React app is built to src/ui/dist/.
// During local dev (vite dev server on :5173) this directory may not
// exist yet; serve whichever path is present so the API still boots.
const distDir   = path.resolve(__dirname, '../ui/dist');
const publicDir = path.resolve(__dirname, '../ui/public');
const uiRoot    = (await import('node:fs')).existsSync(distDir) ? distDir : publicDir;
console.log(`[genoa-api] serving UI from ${path.relative(process.cwd(), uiRoot)}`);
app.use(express.static(uiRoot, {
  index: 'index.html',
  maxAge: NODE_ENV === 'production' ? '1h' : 0
}));

// Auth (publicly accessible: login / logout / me).  Mounted BEFORE the
// requireAuth gate so the login endpoint itself isn't gated.  Any
// /api path that isn't /api/auth/* falls through to requireAuth.
app.use('/api', authRoutes);

// Auth gate for every other /api/* route.  Health (mounted at root,
// not under /api) and the static UI bundle remain public; the React
// app fetches /api/auth/me on mount and renders <Login/> on 401.
app.use('/api', requireAuth);

// API routes (gated)
app.use('/api', curveRoutes);
app.use('/api', facilityRoutes);
app.use('/api', exhibitJobRoutes);   // async job endpoints (mount before exhibitRoutes is harmless; paths don't collide)
app.use('/api', sweepRoutes);        // parameter-sweep endpoint (POST /api/exhibits/sweep)
app.use('/api', peCertificationRoutes); // PE certify / verify-cert (POST /api/exhibits/{certify,verify-cert,verify-build,verify-replay-token})
app.use('/api', amDaDesignRoutes);   // AM DA pattern design (POST /api/am-da/{design,null})
app.use('/api', amNightRoutes);      // AM nighttime allocation (POST /api/am-night/nif — §73.182 NIF contour)
app.use('/api', allotmentRoutes);    // FM allotment search (POST /api/allotment/search — §73.201/§73.207/§73.215)
app.use('/api', comparablesRoutes);  // Comparable-facility benchmarking (POST /api/comparables/fm — §73.211)
app.use('/api', exhibitDiffRoutes);  // Move-in / what-if exhibit diff (POST /api/exhibits/diff)
app.use('/api', section73215ShowingRoutes);  // §73.215 short-spacing showing (POST /api/exhibits/short-spacing-showing)
app.use('/api', lmsFilingRoutes);    // FCC Form 301-FM filing package (POST /api/exhibits/filing-package{,/download,/summary})
app.use('/api', captureRoutes);      // SDR capture audio proxy (GET /api/captures/:id/audio)
app.use('/api', geodataRoutes);      // geodata evidence layers (GET /api/geodata/{sample,clutter,vegetation,conductivity,terrain/status,manifest})
app.use('/api', exhibitRoutes);

// Last-resort error handler
app.use(errorHandler);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[genoa-api] listening on 0.0.0.0:${PORT} (${NODE_ENV}) node=${process.versions.node}`);
  console.log(`[genoa-api] db_configured=${poolReady()} terrain_sidecar=${!!process.env.TERRAIN_SIDECAR_URL} measurement_sidecar=${!!process.env.MEASUREMENT_SIDECAR_URL} identity_sidecar=${!!process.env.IDENTITY_SIDECAR_URL}`);
});
server.on('error', (err) => { console.error('[genoa-api] listen error:', err && err.stack || err); process.exit(1); });

// Background orphan-job reaper.  Flips any RUNNING job whose updated_at
// hasn't moved in JOB_REAP_STALE_AFTER_MS (default 15 min) to FAILED
// with code JOB_ORPHANED, so a worker death mid-compute surfaces as a
// real failure on the UI poll instead of "Computing exhibit…" forever.
// No-ops cleanly when DB is unconfigured.
const stopReaper = startOrphanReaper({ logger: console });

(async () => {
  if (poolReady()){
    try { const r = await migrate(); console.log('[genoa-api] migrations applied:', r.applied); }
    catch (e){ console.warn('[genoa-api] migration skipped:', e.message); }
  } else {
    console.warn('[genoa-api] DATABASE_URL not set — running in stateless mode (compute / exports work; persistence routes return 503)');
  }
})();

const stop = (sig) => () => {
  console.log(`[genoa-api] received ${sig}, draining`);
  stopReaper();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
};
process.on('SIGTERM', stop('SIGTERM'));
process.on('SIGINT',  stop('SIGINT'));
