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
import amSunRoutes      from './routes/amSun.js';
import amPhysicsRoutes  from './routes/amPhysics.js';
import geoRfEvidenceRoutes from './routes/geoRfEvidence.js';
import amPsraPssaRoutes from './routes/amPsraPssa.js';
import allotmentRoutes  from './routes/allotment.js';
import comparablesRoutes from './routes/comparables.js';
import exhibitDiffRoutes from './routes/exhibitDiff.js';
import section73215ShowingRoutes from './routes/section73215Showing.js';
import lmsFilingRoutes from './routes/lmsFiling.js';
import readinessRoutes from './routes/readiness.js';
import captureRoutes   from './routes/captures.js';
import geodataRoutes   from './routes/geodata.js';
import measurementsRoutes from './routes/measurements.js';
import amSiteOptimizerRoutes from './routes/amSiteOptimizer.js';
import amColocationOpportunitiesRoutes from './routes/amColocationOpportunities.js';
import authRoutes       from './routes/auth.js';
import tileRoutes       from './routes/tiles.js';
import basemapRoutes    from './routes/basemap.js';
import terrainRoutes    from './routes/terrain.js';
import mapDataRoutes    from './routes/mapData.js';
import advisoryReviewRoutes from './routes/advisoryReview.js';
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
  setHeaders: (res, filePath) => {
    // index.html must always revalidate, otherwise a cached shell keeps
    // pointing at a stale (pre-deploy) hashed bundle for up to its TTL —
    // the "deployed but still see old behavior" trap.  The hashed assets
    // (index-<hash>.js/.css) are content-addressed, so cache them hard.
    if (filePath.endsWith('.html')){
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (NODE_ENV === 'production'){
      res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    }
  }
}));

// Vector-tile proxy → pg_tileserv (public; same-origin so the map page
// fetches https://host/tiles/* with no mixed-content block).  Mounted
// before the /api auth gate and the SPA fallback.
app.use('/tiles', tileRoutes);

// Self-hosted PMTiles basemap proxy (public; range-forwarding) → Spaces.
app.use('/basemap', basemapRoutes);

// Terrain-DEM proxy (public) → Terrarium elevation tiles, same-origin so
// the hillshade layer can read DEM pixels without a CORS taint.
app.use('/terrain', terrainRoutes);

// Auth (publicly accessible: login / logout / me).  Mounted BEFORE the
// requireAuth gate so the login endpoint itself isn't gated.  Any
// /api path that isn't /api/auth/* falls through to requireAuth.
app.use('/api', authRoutes);

// Public live-map data (GeoJSON for MapLibre sources) — FCC contour
// geometry, not sensitive; mounted before the auth gate so the map's
// same-origin GeoJSON fetch never hits a 401.
app.use('/api', mapDataRoutes);

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
app.use('/api', amSunRoutes);        // FCC sunrise/sunset authority (GET /api/am/sun — §73.99 PSRA/PSSA + §73.1209)
app.use('/api', amPhysicsRoutes);    // AM Physics SOMNEC2D advisory evidence (POST /api/am/physics/somnec — independent NEC ground-field solver)
app.use('/api', geoRfEvidenceRoutes); // Geo-RF Evidence — advisory environmental geospatial datasets (tree canopy, landcover, tau RF models); never modifies FCC rule outputs
app.use('/api', amPsraPssaRoutes);   // §73.99(b)(1)/(2) PSRA/PSSA reduced-power exhibit (POST /api/am/psra-pssa)
app.use('/api', allotmentRoutes);    // FM allotment search (POST /api/allotment/search — §73.201/§73.207/§73.215)
app.use('/api', comparablesRoutes);  // Comparable-facility benchmarking (POST /api/comparables/fm — §73.211)
app.use('/api', exhibitDiffRoutes);  // Move-in / what-if exhibit diff (POST /api/exhibits/diff)
app.use('/api', section73215ShowingRoutes);  // §73.215 short-spacing showing (POST /api/exhibits/short-spacing-showing)
app.use('/api', lmsFilingRoutes);    // FCC Form 301-FM filing package (POST /api/exhibits/filing-package{,/download,/summary})
app.use('/api', readinessRoutes);    // Filing-readiness score (POST /api/exhibits/readiness — Phase-7 readiness)
app.use('/api', advisoryReviewRoutes); // Advisory cross-check (POST /api/advisory/review — KB-grounded rfengineer; advisory only, never changes a verdict)
app.use('/api', captureRoutes);      // SDR capture audio proxy (GET /api/captures/:id/audio)
app.use('/api', geodataRoutes);      // geodata evidence layers (GET /api/geodata/{sample,clutter,vegetation,conductivity,terrain/status,manifest})
app.use('/api', measurementsRoutes); // drive-test ingestion (POST /api/measurements/ingest)
app.use('/api', amSiteOptimizerRoutes); // AM regional relocation optimizer (POST /api/am/site-optimizer — SCREENING ONLY)
app.use('/api', amColocationOpportunitiesRoutes); // AM co-location opportunity engine (POST /api/am/colocation-opportunities — SCREENING ONLY)
app.use('/api', exhibitRoutes);

// SPA fallback — any GET request that isn't /api/*, /healthz, /readyz,
// or a static asset should serve index.html so client-side routes
// like /am-relocation can be deep-linked.  Mounted after every API
// route, so JSON 404s for unknown /api/* paths still come from the
// API layer (no HTML leak).  Skips requests that already accept a
// non-HTML content type, so curl / fetch / asset probes aren't fed
// the SPA shell by accident.
app.get(/^\/(?!api\/|healthz|readyz)(?!.*\.[a-zA-Z0-9]+$).*/, (req, res, next) => {
  const accept = String(req.headers.accept || '');
  if (accept && !accept.includes('text/html') && !accept.includes('*/*')) return next();
  const indexPath = path.join(uiRoot, 'index.html');
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  return res.sendFile(indexPath, (err) => { if (err) next(err); });
});

// Last-resort error handler
app.use(errorHandler);

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[genoa-api] listening on 0.0.0.0:${PORT} (${NODE_ENV}) node=${process.versions.node}`);
  console.log(`[genoa-api] db_configured=${poolReady()} identity_sidecar=${!!process.env.IDENTITY_SIDECAR_URL}`);
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
