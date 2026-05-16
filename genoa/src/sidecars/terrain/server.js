// Genoa terrain sidecar — HAAT computation via public DEM APIs.
//
// This sidecar implements §73.313 per-radial HAAT from real terrain data.
// It can also forward requests to SPLAT or itmlogic for full ITM coverage
// analysis once those binaries are provisioned.
//
// BACKENDS (select via TERRAIN_BACKEND env var)
//   usgs-epqs   — USGS 3DEP Elevation Point Query Service (NED / 3DEP,
//                 the same dataset FCC uses for its own contour HAAT).
//                 No API key required.  Free public service.
//                 URL: https://epqs.nationalmap.gov/v1/json
//
//   multi       — Try all three elevation sources in parallel (USGS 3DEP,
//                 Open-Meteo Copernicus DEM, OpenTopoData SRTM-30m) and
//                 cross-validate.  Falls back to whichever source succeeds.
//
//   splat       — chelstein/splat binary + DEM tiles in WORKDIR.
//                 Returns 503 until DEM tiles are provisioned.
//
//   itmlogic    — chelstein/itmlogic Python module.
//                 Returns 503 until DEM tiles are provisioned.
//
// ELEVATION SOURCES (multi-source fallback chain)
//   1. USGS 3DEP EPQS     — epqs.nationalmap.gov  — official NED, same as FCC
//   2. Open-Meteo         — api.open-meteo.com    — Copernicus DEM / SRTM3
//   3. OpenTopoData SRTM  — api.opentopodata.org  — NASA SRTM 1-arcsec
//
// HAAT ALGORITHM (per §73.313)
//   For each requested radial azimuth:
//   1. Generate `samples` equally-spaced points along the radial from
//      `from_km` to `to_km` using the WGS-84 Karney geodesic Direct().
//   2. Query elevation at each point (with multi-source fallback).
//   3. Average the sampled ground elevations.
//   4. HAAT = tx_amsl_m − mean(ground_elevations_m).
//
//   This matches the FCC §73.313(d) arc-averaging method for computed HAAT.
//
// ENDPOINTS
//   GET  /health    → 200 "ok"
//   GET  /version   → { sidecar, backend, upstream_tools, elevation_sources }
//   POST /v1/haat   → { provider, arc, haat_per_radial, sources, cross_validated }
//     body: {
//       tx_lat, tx_lon, tx_amsl_m,
//       radials_deg: number[],
//       from_km?: number  (default 3),
//       to_km?:   number  (default 16),
//       samples?: number  (default 27)
//     }

import express from 'express';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  computeHaatMultiSource,
  fetchElevationsFallback,
  buildSamplePoints,
  computeHaatPerRadial,
  fetchElevationsUsgsEpqs,
  ELEVATION_SOURCES
} from '../../evidence/terrain/elevationClient.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT         = parseInt(process.env.SIDECAR_PORT || process.env.PORT || '8081', 10);
const BACKEND      = process.env.TERRAIN_BACKEND || null;
const SPLAT_BIN    = process.env.SPLAT_BIN    || 'splat';
const ITMLOGIC_BIN = process.env.ITMLOGIC_BIN || 'python3 -m itmlogic';
const ZTRPSITS_BIN = process.env.ZTRPSITS_BIN || 'ztrpsits';
const VERSION      = '0.3.0';

const app = express();
app.use(express.json({ limit: '256kb' }));
app.disable('x-powered-by');

app.get('/health',  (_req, res) => res.type('text').send('ok'));
app.get('/version', (_req, res) => res.json({
  sidecar: { name: 'genoa-terrain-sidecar', version: VERSION },
  backend: BACKEND,
  elevation_sources: ELEVATION_SOURCES,
  upstream_tools: {
    'chelstein/splat':    { binary: SPLAT_BIN,    available: which(SPLAT_BIN.split(/\s+/)[0]) },
    'chelstein/itmlogic': { binary: ITMLOGIC_BIN, available: null },
    'chelstein/ZTRpsITS': { binary: ZTRPSITS_BIN, available: which(ZTRPSITS_BIN.split(/\s+/)[0]) }
  }
}));

app.post('/v1/haat', async (req, res) => {
  const { tx_lat, tx_lon, tx_amsl_m, radials_deg,
          from_km = 3, to_km = 16, samples = 27 } = req.body || {};

  // Validate required inputs
  if (!Number.isFinite(tx_lat) || !Number.isFinite(tx_lon)){
    return res.status(400).json({ error: 'tx_lat and tx_lon required' });
  }
  if (!Number.isFinite(tx_amsl_m)){
    return res.status(400).json({ error: 'tx_amsl_m (antenna AMSL, meters) required' });
  }
  if (!Array.isArray(radials_deg) || !radials_deg.length){
    return res.status(400).json({ error: 'radials_deg must be a non-empty array' });
  }

  // usgs-epqs: USGS primary with multi-source fallback on error
  if (BACKEND === 'usgs-epqs'){
    try {
      const pts = buildSamplePoints({ tx_lat, tx_lon, radials_deg, from_km, to_km, samples });
      let elevations, source_id, source_fallback = false;
      try {
        elevations = await fetchElevationsUsgsEpqs(pts);
        source_id  = 'usgs-epqs';
      } catch (usgsErr){
        // USGS failed — try next source
        try {
          const fb = await fetchElevationsFallback(pts, 15_000, ['open-meteo', 'opentopodata-srtm30m']);
          elevations     = fb.elevations;
          source_id      = fb.source_id;
          source_fallback = true;
        } catch (fbErr){
          return res.status(502).json({
            error:  'ALL_ELEVATION_SOURCES_FAILED',
            detail: `USGS: ${usgsErr.message}; fallback: ${fbErr.message}`,
            sources: ELEVATION_SOURCES.map(s => s.id)
          });
        }
      }
      const haat_per_radial = computeHaatPerRadial({
        elevations, radials_deg, samples, tx_amsl_m
      });
      const meta = ELEVATION_SOURCES.find(s => s.id === source_id);
      return res.json({
        provider:         source_id,
        dem_source:       meta.dataset,
        regulation:       '47 CFR §73.313(d) arc-averaged HAAT',
        arc:              { from_km, to_km, samples, method: 'equal-spacing, Karney WGS-84 geodesic' },
        tx:               { lat: tx_lat, lon: tx_lon, amsl_m: tx_amsl_m },
        haat_per_radial,
        source_fallback,
        cross_validated:  false,
        sources:          ELEVATION_SOURCES.map(s => ({ ...s, used: s.id === source_id })),
        fetched_at:       new Date().toISOString()
      });
    } catch (e){
      return res.status(502).json({ error: 'HAAT_FAILED', detail: String(e.message) });
    }
  }

  // multi: all sources in parallel with cross-validation
  if (BACKEND === 'multi'){
    try {
      const result = await computeHaatMultiSource({
        tx_lat, tx_lon, tx_amsl_m, radials_deg, from_km, to_km, samples
      });
      return res.json(result);
    } catch (e){
      return res.status(502).json({
        error:  'ALL_ELEVATION_SOURCES_FAILED',
        detail: String(e.message),
        sources: ELEVATION_SOURCES.map(s => s.id)
      });
    }
  }

  if (BACKEND === 'splat' || BACKEND === 'itmlogic' || BACKEND === 'ztrpsits'){
    return res.status(503).json({
      error: 'TERRAIN_BACKEND_NOT_WIRED',
      detail: `Backend '${BACKEND}' requires DEM tiles provisioned in WORKDIR and subprocess wiring. See chelstein/splat, chelstein/itmlogic, chelstein/ZTRpsITS.`,
      upstream_tools: ['chelstein/splat', 'chelstein/itmlogic', 'chelstein/ZTRpsITS']
    });
  }

  // No TERRAIN_BACKEND set
  return res.status(503).json({
    error: 'TERRAIN_BACKEND_NOT_CONFIGURED',
    detail: 'Set TERRAIN_BACKEND=usgs-epqs or TERRAIN_BACKEND=multi (all three sources + cross-validate). For ITM coverage analysis set TERRAIN_BACKEND=splat|itmlogic|ztrpsits and provision DEM tiles.',
    available_backends: ['usgs-epqs', 'multi', 'splat', 'itmlogic', 'ztrpsits'],
    elevation_sources:  ELEVATION_SOURCES.map(s => ({ id: s.id, name: s.name, dataset: s.dataset }))
  });
});

function which(bin){
  try {
    const r = spawnSync('which', [bin], { encoding: 'utf8' });
    return r.status === 0 ? (r.stdout || '').trim() : false;
  } catch { return false; }
}

app.listen(PORT, '0.0.0.0', () =>
  console.log(`[genoa-terrain-sidecar] v${VERSION} listening on 0.0.0.0:${PORT} backend=${BACKEND || '(none)'}`));
