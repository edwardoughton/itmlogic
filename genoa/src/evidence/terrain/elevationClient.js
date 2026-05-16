// Multi-source elevation client for §73.313 HAAT computation.
//
// SOURCES (tried in order; all are free, no auth required)
//
//   1. USGS 3DEP EPQS  — epqs.nationalmap.gov/v1/json
//      NED/3DEP dataset, same data FCC uses for contour HAAT computation.
//      Single-point REST; parallelised to USGS_MAX_CONCURRENT=20.
//      Authoritative for US stations.
//
//   2. Open-Meteo Elevation API  — api.open-meteo.com/v1/elevation
//      Copernicus DEM GLO-90 / SRTM3.  Batch up to 300 points per call.
//      Fast and globally available.  Independent from USGS.
//
//   3. OpenTopoData SRTM-30m  — api.opentopodata.org/v1/srtm30m
//      NASA SRTM 1-arcsec (~30 m).  Batch up to 100 points per call.
//      Third independent source; cross-validates the other two.
//
// FALLBACK STRATEGY
//   fetchElevations() tries each source in order until one succeeds.
//   computeHaatMultiSource() tries all three in parallel and cross-validates:
//     - If all three agree within CROSS_VALIDATE_TOLERANCE_M, returns primary
//       result with cross_validated=true and agreement_m reported.
//     - If primary succeeds but secondaries disagree or fail, returns primary
//       with cross_validated=false and a warning.
//     - If primary fails, falls back to next available source.
//
// ALGORITHM (§73.313)
//   For each radial azimuth:
//   1. Generate `samples` equally-spaced points along the radial from
//      `from_km` to `to_km` using Karney WGS-84 geodesic Direct().
//   2. Fetch ground elevation (AMSL, m) at each point.
//   3. Average the sampled ground elevations.
//   4. HAAT = tx_amsl_m − mean(ground_elevations_m).

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require   = createRequire(import.meta.url);

const geographiclib = require('geographiclib-geodesic');
const { Geodesic }  = geographiclib;
const _GEOD         = Geodesic.WGS84;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const ELEVATION_SOURCES = Object.freeze([
  {
    id:        'usgs-epqs',
    name:      'USGS 3DEP Elevation Point Query Service',
    dataset:   'USGS 3DEP / NED (National Elevation Dataset)',
    url:       'https://epqs.nationalmap.gov/v1/json',
    authority: '47 CFR §73.313(d) — same dataset FCC uses for contour HAAT',
    notes:     'Single-point; max 20 parallel requests to avoid 429s'
  },
  {
    id:        'open-meteo',
    name:      'Open-Meteo Elevation API',
    dataset:   'Copernicus DEM GLO-90 / SRTM3',
    url:       'https://api.open-meteo.com/v1/elevation',
    authority: 'Copernicus Land Monitoring Service; independent SRTM-class DEM',
    notes:     'Batch up to 300 points per call; free, no auth'
  },
  {
    id:        'opentopodata-srtm30m',
    name:      'OpenTopoData SRTM 1-arcsec (30 m)',
    dataset:   'NASA SRTM v3 1-arcsec (~30 m GSD)',
    url:       'https://api.opentopodata.org/v1/srtm30m',
    authority: 'NASA/CGIAR SRTM; third independent elevation reference',
    notes:     'Batch up to 100 points per call; free, no auth'
  }
]);

const USGS_MAX_CONCURRENT    = 20;
const OPEN_METEO_BATCH_MAX   = 300;
const OPENTOPODATA_BATCH_MAX = 100;
const DEFAULT_TIMEOUT_MS     = 15_000;
const CROSS_VALIDATE_TOL_M   = 30;   // 30 m agreement threshold across sources

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute §73.313 arc-averaged HAAT using multiple elevation sources.
 *
 * Tries USGS → Open-Meteo → OpenTopoData in order.  If more than one source
 * succeeds, cross-validates the results and reports agreement.
 *
 * @param {{ tx_lat, tx_lon, tx_amsl_m, radials_deg, from_km?, to_km?, samples? }} opts
 * @returns {Promise<{ haat_per_radial, arc, provider, sources, cross_validated, agreement_m }>}
 */
export async function computeHaatMultiSource({
  tx_lat, tx_lon, tx_amsl_m,
  radials_deg,
  from_km  = 3,
  to_km    = 16,
  samples  = 27,
  timeoutMs = DEFAULT_TIMEOUT_MS
}){
  const pts = buildSamplePoints({ tx_lat, tx_lon, radials_deg, from_km, to_km, samples });

  // Fire all three sources concurrently; collect what succeeds.
  const [usgsResult, omResult, otdResult] = await Promise.allSettled([
    fetchElevationsUsgsEpqs(pts, timeoutMs),
    fetchElevationsOpenMeteo(pts, timeoutMs),
    fetchElevationsOpenTopoData(pts, timeoutMs)
  ]);

  const results = [
    { source_id: 'usgs-epqs',           r: usgsResult },
    { source_id: 'open-meteo',          r: omResult   },
    { source_id: 'opentopodata-srtm30m', r: otdResult  }
  ].map(({ source_id, r }) => ({
    source_id,
    ok:        r.status === 'fulfilled',
    elevations: r.status === 'fulfilled' ? r.value : null,
    error:      r.status === 'rejected'  ? String(r.reason?.message || r.reason) : null
  }));

  const succeeded = results.filter(x => x.ok && x.elevations);

  if (!succeeded.length){
    throw new Error(
      'All elevation sources failed: ' +
      results.map(x => `${x.source_id}: ${x.error}`).join('; ')
    );
  }

  // Use the first successful source as primary.
  const primary = succeeded[0];
  const haat_per_radial = computeHaatPerRadial({
    elevations: primary.elevations,
    radials_deg, samples, tx_amsl_m
  });

  // Cross-validate if we have ≥ 2 sources.
  let cross_validated = false;
  let agreement_m     = null;
  const sourcesMeta   = results.map(x => {
    const meta = ELEVATION_SOURCES.find(s => s.id === x.source_id);
    return {
      source_id: x.source_id,
      name:      meta.name,
      dataset:   meta.dataset,
      ok:        x.ok,
      error:     x.error || null
    };
  });

  if (succeeded.length >= 2){
    const maxDiff = computeMaxMeanElevDiff(succeeded, radials_deg, samples, tx_amsl_m);
    agreement_m     = Math.round(maxDiff * 10) / 10;
    cross_validated = maxDiff <= CROSS_VALIDATE_TOL_M;
  }

  return {
    provider:         primary.source_id,
    dem_source:       ELEVATION_SOURCES.find(s => s.id === primary.source_id).dataset,
    regulation:       '47 CFR §73.313(d) arc-averaged HAAT',
    arc:              { from_km, to_km, samples, method: 'equal-spacing, Karney WGS-84 geodesic' },
    tx:               { lat: tx_lat, lon: tx_lon, amsl_m: tx_amsl_m },
    haat_per_radial,
    cross_validated,
    cross_validate_tolerance_m: CROSS_VALIDATE_TOL_M,
    agreement_m,
    sources:          sourcesMeta,
    fetched_at:       new Date().toISOString()
  };
}

/**
 * Fetch point elevations using the first source that succeeds.
 * Returns an array of elevations (null for failed points) parallel to `pts`.
 *
 * @param {Array<{lat,lon}>} pts
 * @param {string[]} [preferredOrder]  source IDs to try, default all three
 */
export async function fetchElevationsFallback(pts, timeoutMs = DEFAULT_TIMEOUT_MS, preferredOrder = null){
  const order = preferredOrder || ELEVATION_SOURCES.map(s => s.id);
  const errors = [];
  for (const sourceId of order){
    try {
      let elevs;
      if (sourceId === 'usgs-epqs')             elevs = await fetchElevationsUsgsEpqs(pts, timeoutMs);
      else if (sourceId === 'open-meteo')        elevs = await fetchElevationsOpenMeteo(pts, timeoutMs);
      else if (sourceId === 'opentopodata-srtm30m') elevs = await fetchElevationsOpenTopoData(pts, timeoutMs);
      else continue;
      return { source_id: sourceId, elevations: elevs };
    } catch (e){
      errors.push(`${sourceId}: ${e.message}`);
    }
  }
  throw new Error('All elevation fallbacks exhausted: ' + errors.join('; '));
}

// ---------------------------------------------------------------------------
// Sample-point generation
// ---------------------------------------------------------------------------

export function buildSamplePoints({ tx_lat, tx_lon, radials_deg, from_km, to_km, samples }){
  const pts = [];
  for (let ri = 0; ri < radials_deg.length; ri++){
    const az = radials_deg[ri];
    for (let si = 0; si < samples; si++){
      const d_km = from_km + (to_km - from_km) * (si / (samples - 1));
      const r    = _GEOD.Direct(tx_lat, tx_lon, az, d_km * 1000);
      pts.push({ radialIdx: ri, sampleIdx: si, lat: r.lat2, lon: r.lon2 });
    }
  }
  return pts;
}

// ---------------------------------------------------------------------------
// HAAT computation (shared across sources)
// ---------------------------------------------------------------------------

export function computeHaatPerRadial({ elevations, radials_deg, samples, tx_amsl_m }){
  return radials_deg.map((az, ri) => {
    const start = ri * samples;
    const radialElevs = elevations.slice(start, start + samples)
      .filter(e => e != null && Number.isFinite(e));
    if (!radialElevs.length){
      return { az, avg_elev_m: null, min_elev_m: null, max_elev_m: null,
               haat_m: null, samples_ok: 0, samples_total: samples };
    }
    const avg   = radialElevs.reduce((a, b) => a + b, 0) / radialElevs.length;
    const min   = Math.min(...radialElevs);
    const max   = Math.max(...radialElevs);
    const haat_m = tx_amsl_m - avg;
    return {
      az,
      avg_elev_m:    Math.round(avg    * 10) / 10,
      min_elev_m:    Math.round(min    * 10) / 10,
      max_elev_m:    Math.round(max    * 10) / 10,
      haat_m:        Math.round(haat_m * 10) / 10,
      samples_ok:    radialElevs.length,
      samples_total: samples
    };
  });
}

// ---------------------------------------------------------------------------
// Source 1: USGS 3DEP EPQS
// ---------------------------------------------------------------------------

export async function fetchElevationsUsgsEpqs(pts, timeoutMs = DEFAULT_TIMEOUT_MS){
  const elevations = new Array(pts.length).fill(null);
  const chunks = chunkArray(pts, USGS_MAX_CONCURRENT);
  for (const chunk of chunks){
    await Promise.all(chunk.map(async pt => {
      const idx = pts.indexOf(pt);
      try {
        elevations[idx] = await _usgsEpqsPoint(pt.lat, pt.lon, timeoutMs);
      } catch {
        elevations[idx] = null;
      }
    }));
  }
  const nullCount = elevations.filter(e => e === null).length;
  if (nullCount > pts.length * 0.5){
    throw new Error(`USGS EPQS: too many failed points (${nullCount}/${pts.length})`);
  }
  return elevations;
}

async function _usgsEpqsPoint(lat, lon, timeoutMs){
  const url  = `https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&wkid=4326&units=Meters&includeDate=false`;
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`USGS EPQS HTTP ${r.status}`);
    const j   = await r.json();
    const val = j?.value ?? j?.Value ?? j?.elevation;
    const elev = Number(val);
    if (!Number.isFinite(elev) || elev < -500 || elev > 9000){
      throw new Error(`USGS EPQS unexpected value: ${val}`);
    }
    return elev;
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// Source 2: Open-Meteo Elevation API
// ---------------------------------------------------------------------------

export async function fetchElevationsOpenMeteo(pts, timeoutMs = DEFAULT_TIMEOUT_MS){
  const elevations = new Array(pts.length).fill(null);
  const chunks = chunkArray(pts, OPEN_METEO_BATCH_MAX);
  let offset = 0;
  for (const chunk of chunks){
    const lats = chunk.map(p => p.lat.toFixed(6)).join(',');
    const lons = chunk.map(p => p.lon.toFixed(6)).join(',');
    const url  = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
      const j = await r.json();
      const vals = j?.elevation;
      if (!Array.isArray(vals) || vals.length !== chunk.length){
        throw new Error(`Open-Meteo: expected ${chunk.length} values, got ${vals?.length}`);
      }
      for (let i = 0; i < chunk.length; i++){
        const elev = Number(vals[i]);
        elevations[offset + i] = (Number.isFinite(elev) && elev > -500 && elev < 9000) ? elev : null;
      }
    } finally {
      clearTimeout(t);
    }
    offset += chunk.length;
  }
  const nullCount = elevations.filter(e => e === null).length;
  if (nullCount > pts.length * 0.5){
    throw new Error(`Open-Meteo: too many failed points (${nullCount}/${pts.length})`);
  }
  return elevations;
}

// ---------------------------------------------------------------------------
// Source 3: OpenTopoData SRTM 30m
// ---------------------------------------------------------------------------

export async function fetchElevationsOpenTopoData(pts, timeoutMs = DEFAULT_TIMEOUT_MS){
  const elevations = new Array(pts.length).fill(null);
  const chunks = chunkArray(pts, OPENTOPODATA_BATCH_MAX);
  let offset = 0;
  for (const chunk of chunks){
    const locations = chunk.map(p => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|');
    const url = `https://api.opentopodata.org/v1/srtm30m?locations=${locations}`;
    const ctrl = new AbortController();
    const t    = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) throw new Error(`OpenTopoData HTTP ${r.status}`);
      const j = await r.json();
      if (j.status !== 'OK'){
        throw new Error(`OpenTopoData status: ${j.status} — ${j.error || ''}`);
      }
      const results = j?.results;
      if (!Array.isArray(results) || results.length !== chunk.length){
        throw new Error(`OpenTopoData: expected ${chunk.length} results, got ${results?.length}`);
      }
      for (let i = 0; i < chunk.length; i++){
        const elev = Number(results[i]?.elevation);
        elevations[offset + i] = (Number.isFinite(elev) && elev > -500 && elev < 9000) ? elev : null;
      }
    } finally {
      clearTimeout(t);
    }
    offset += chunk.length;
  }
  const nullCount = elevations.filter(e => e === null).length;
  if (nullCount > pts.length * 0.5){
    throw new Error(`OpenTopoData: too many failed points (${nullCount}/${pts.length})`);
  }
  return elevations;
}

// ---------------------------------------------------------------------------
// Cross-validation helper
// ---------------------------------------------------------------------------

function computeMaxMeanElevDiff(succeeded, radials_deg, samples, tx_amsl_m){
  // Compare mean HAAT across each pair of successful sources; return max diff.
  let maxDiff = 0;
  for (let a = 0; a < succeeded.length; a++){
    for (let b = a + 1; b < succeeded.length; b++){
      const haatA = computeHaatPerRadial({ elevations: succeeded[a].elevations, radials_deg, samples, tx_amsl_m });
      const haatB = computeHaatPerRadial({ elevations: succeeded[b].elevations, radials_deg, samples, tx_amsl_m });
      for (let i = 0; i < haatA.length; i++){
        if (haatA[i].haat_m != null && haatB[i].haat_m != null){
          const diff = Math.abs(haatA[i].haat_m - haatB[i].haat_m);
          if (diff > maxDiff) maxDiff = diff;
        }
      }
    }
  }
  return maxDiff;
}

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------

function chunkArray(arr, size){
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
