// Genoa geodata sidecar.
//
// Tiny HTTP service that wraps the /opt/genoa corpus on the droplet
// (alongside the FORTRAN sidecar at :8080).  The App Platform Genoa
// container can't see /opt/genoa, so this sidecar exposes the only
// two operations Genoa needs:
//
//   GET  /raster/sample?path=<abs>&lat=<lat>&lon=<lon>
//        → run `gdallocationinfo -wgs84 -valonly <path> <lon> <lat>`,
//          return the parsed result in a Genoa-compatible shape:
//          { available, value | outside_extent | nodata,
//            replay (the command), stderr? }
//
//   GET  /raster/status?path=<abs>
//        → { exists, size?, mtime? } — used by the manifest endpoint
//          on the Genoa side to fill in per-layer readiness.
//
//   GET  /healthz
//   GET  /version  — sidecar build info + corpus root + gdal version
//
// Auth: bearer token via GEODATA_SIDECAR_TOKEN (mandatory in prod,
// optional in dev).  Same pattern as the FORTRAN sidecar.
//
// All operations are READ-ONLY and path-validated against an
// allowlist of prefixes (default: GEODATA_ROOT, defaults to
// /opt/genoa) so a compromised App-Platform secret can't read
// arbitrary files off the droplet.

import express from 'express';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
const pExec = promisify(execFile);

const PORT          = parseInt(process.env.PORT || '8089', 10);
const GEODATA_ROOT  = process.env.GEODATA_ROOT || '/opt/genoa';
const TOKEN         = (process.env.GEODATA_SIDECAR_TOKEN || '').trim();
const GDAL_BIN      = process.env.GDAL_LOCATIONINFO_BIN || 'gdallocationinfo';
const SAMPLE_TIMEOUT_MS = parseInt(process.env.GEODATA_SAMPLE_TIMEOUT_MS || '5000', 10);

// Restrict path access to GEODATA_ROOT.  Extra allowlist entries can
// be added via GEODATA_ALLOW_PREFIXES (comma-separated absolute paths).
const ALLOW_PREFIXES = [
  path.resolve(GEODATA_ROOT),
  ...(process.env.GEODATA_ALLOW_PREFIXES || '')
       .split(',').map((s) => s.trim()).filter(Boolean).map((s) => path.resolve(s))
];

function withinAllowlist(p){
  const abs = path.resolve(p);
  return ALLOW_PREFIXES.some((prefix) => abs === prefix || abs.startsWith(prefix + path.sep));
}

function requireToken(req, res, next){
  if (!TOKEN) return next();   // disabled in dev / unit tests
  const h = String(req.headers['authorization'] || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  const presented = m ? m[1].trim() : '';
  if (!presented || presented !== TOKEN){
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }
  next();
}

function badRequest(res, error, detail){
  res.status(400).json({ error, detail });
}

async function gdalVersion(){
  try {
    const { stdout } = await pExec('gdalinfo', ['--version'], { timeout: 3000 });
    return stdout.trim();
  } catch { return null; }
}

export function makeApp({ runCommand = pExec } = {}){
  const app = express();

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.get('/version', requireToken, async (_req, res) => {
    res.json({
      sidecar:        'geodata',
      version:        '1.0.0',
      corpus_root:    GEODATA_ROOT,
      allow_prefixes: ALLOW_PREFIXES,
      gdal_version:   await gdalVersion(),
      started_at:     STARTED_AT
    });
  });

  app.get('/raster/sample', requireToken, async (req, res, next) => {
    try {
      const p   = String(req.query.path || '');
      const lat = Number(req.query.lat);
      const lon = Number(req.query.lon);
      if (!p) return badRequest(res, 'MISSING_PATH', 'path query param required');
      if (!withinAllowlist(p)){
        return res.status(403).json({ error: 'PATH_NOT_ALLOWED', path: p });
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lon)
          || lat < -90 || lat > 90 || lon < -180 || lon > 180){
        return badRequest(res, 'INVALID_COORDS', 'lat ∈ [-90,90], lon ∈ [-180,180]');
      }
      const replay = `${GDAL_BIN} -wgs84 -valonly ${p} ${lon} ${lat}`;
      // Existence check first so we can distinguish raster_unavailable
      // from binary_unavailable cleanly.
      try { await fs.access(p); }
      catch { return res.json({ available: false, reason: 'raster_unavailable',
                                tif: p, replay }); }
      let stdout, stderr;
      try {
        ({ stdout, stderr } = await runCommand(
          GDAL_BIN,
          ['-wgs84', '-valonly', p, String(lon), String(lat)],
          { timeout: SAMPLE_TIMEOUT_MS, maxBuffer: 64 * 1024 }
        ));
      } catch (e){
        if (e && e.code === 'ENOENT'){
          return res.json({ available: false, reason: 'binary_unavailable',
                            binary: GDAL_BIN, replay });
        }
        return res.json({ available: false, reason: 'sample_failed',
                          error: String(e?.message || e),
                          stderr: e?.stderr, replay });
      }
      const trimmed = String(stdout || '').trim();
      if (!trimmed){
        return res.json({ available: true, outside_extent: true, value: null,
                          replay, stderr: (stderr || '').trim() || undefined });
      }
      if (/^nan$/i.test(trimmed)){
        return res.json({ available: true, value: null, nodata: true, replay });
      }
      const num = Number(trimmed);
      return res.json({
        available: true,
        value: Number.isFinite(num) ? num : trimmed,
        replay
      });
    } catch (e){ next(e); }
  });

  app.get('/raster/status', requireToken, async (req, res, next) => {
    try {
      const p = String(req.query.path || '');
      if (!p) return badRequest(res, 'MISSING_PATH', 'path query param required');
      if (!withinAllowlist(p)){
        return res.status(403).json({ error: 'PATH_NOT_ALLOWED', path: p });
      }
      try {
        const st = await fs.stat(p);
        return res.json({
          exists: true,
          is_file: st.isFile(),
          is_dir:  st.isDirectory(),
          size:    st.isFile() ? st.size : null,
          mtime:   st.mtime.toISOString()
        });
      } catch {
        return res.json({ exists: false });
      }
    } catch (e){ next(e); }
  });

  // Serve the corpus-level MASTER_SHA256SUMS.txt so the Genoa API can
  // populate per-layer sha attestation when running off-host (App
  // Platform).  Dedicated endpoint, not a generic file proxy — the
  // path is fixed to the canonical location at the corpus root.
  app.get('/master-shas', requireToken, async (_req, res, next) => {
    try {
      const p = path.join(GEODATA_ROOT, 'MASTER_SHA256SUMS.txt');
      try {
        const txt = await fs.readFile(p, 'utf8');
        const st  = await fs.stat(p);
        res.type('text/plain').set('x-master-shas-mtime', st.mtime.toISOString()).send(txt);
      } catch (e){
        res.status(404).json({ error: 'NOT_FOUND', path: p });
      }
    } catch (e){ next(e); }
  });

  app.use((err, _req, res, _next) => {
    res.status(500).json({ error: 'INTERNAL', detail: String(err?.message || err) });
  });
  return app;
}

const STARTED_AT = new Date().toISOString();

// Only listen when invoked directly (not when imported by tests).
const isDirect = import.meta.url === `file://${process.argv[1]}`;
if (isDirect){
  const app = makeApp();
  app.listen(PORT, () => {
    console.log(`[geodata-sidecar] listening on :${PORT}; corpus=${GEODATA_ROOT}; auth=${TOKEN ? 'on' : 'off'}`);
  });
}
