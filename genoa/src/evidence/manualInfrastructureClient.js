// Manual infrastructure inventory loader.
//
// Reads `genoa/data/manual-infrastructure-sites.json` synchronously
// (the JSON is small — < 10 KB — and the route handler is fully
// synchronous through the scoring path).  This is the MANUAL
// `infrastructure_source` for the AM Co-Location Opportunity Engine.
//
// FUTURE SOURCES (not implemented in this file yet)
//   - ASR_REGISTRY  — FCC Antenna Structure Registration nightly dump
//   - FCC_FMQ       — FM Query lat/lon for FM auxiliary co-location
//   - FCC_AM        — FCC AM Query for daytime / nighttime auxiliary
//
// PURITY
//   The loader does exactly one fs.readFileSync per call.  No caching
//   layer is wired in because the file is tiny and the cost of a fresh
//   parse keeps the loader deterministic in tests.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// genoa/src/evidence/manualInfrastructureClient.js
//        → ../../data/manual-infrastructure-sites.json
const DEFAULT_INVENTORY_PATH = path.resolve(
  __dirname, '..', '..', 'data', 'manual-infrastructure-sites.json'
);

const R_EARTH_KM = 6371.0088;

/**
 * Load every record from the manual inventory JSON.
 *
 * @param {function(object):boolean} [filterFn] optional predicate.
 * @param {object}                    [opts]
 * @param {string}                    [opts.path] override the file path.
 * @returns {object[]} parsed records (always a fresh array).
 */
export function loadManualInfrastructureSites(filterFn, opts = {}){
  const file = opts.path || DEFAULT_INVENTORY_PATH;
  const raw  = fs.readFileSync(file, 'utf8');
  const arr  = JSON.parse(raw);
  if (!Array.isArray(arr)){
    throw new Error(`manual infrastructure inventory at ${file} did not parse to an array`);
  }
  if (typeof filterFn === 'function') return arr.filter(filterFn);
  return arr;
}

/**
 * Filter a list of inventory records by distance from a center point
 * and by an optional set of `infrastructure_filters`.
 *
 * @param {object[]} sites
 * @param {{ center:{lat:number,lon:number}, radius_km:number, filters?:object }} opts
 * @returns {object[]} a fresh array of records that pass every filter.
 *   Each surviving record is shallow-cloned with an added
 *   `distance_from_center_km` field for downstream ranking.
 */
export function filterInfrastructureSites(sites, { center, radius_km, filters } = {}){
  if (!Array.isArray(sites)) return [];
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lon)){
    return [];
  }
  const f = filters || {};

  const includeKind = (kind) => {
    switch (kind){
      case 'TOWER':   return f.include_towers   !== false;
      case 'ASR':     return f.include_asr      !== false;
      case 'AM_SITE': return f.include_am_sites !== false;
      case 'FM_SITE': return f.include_fm_sites !== false;
      case 'TV_SITE': return f.include_tv_sites !== false;
      default:        return true;
    }
  };

  const ownerNeedle = typeof f.owner_contains === 'string'
    ? f.owner_contains.trim().toLowerCase()
    : '';

  const minH = Number.isFinite(Number(f.min_tower_height_m)) ? Number(f.min_tower_height_m) : null;
  const maxH = Number.isFinite(Number(f.max_tower_height_m)) ? Number(f.max_tower_height_m) : null;

  const out = [];
  for (const s of sites){
    if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    if (!includeKind(s.kind)) continue;
    if (minH != null && (s.height_m == null || s.height_m < minH)) continue;
    if (maxH != null && (s.height_m == null || s.height_m > maxH)) continue;
    if (ownerNeedle && !String(s.owner || '').toLowerCase().includes(ownerNeedle)) continue;

    const d = greatCircleKm(center.lat, center.lon, s.lat, s.lon);
    if (Number.isFinite(radius_km) && d > radius_km) continue;
    out.push({ ...s, distance_from_center_km: d });
  }
  // Closest first — downstream scorer doesn't care about order, but a
  // stable distance-sorted list keeps the response deterministic.
  out.sort((a, b) => a.distance_from_center_km - b.distance_from_center_km);
  return out;
}

// ---------- private helpers ----------

function greatCircleKm(lat1, lon1, lat2, lon2){
  const phi1 = lat1 * Math.PI / 180, phi2 = lat2 * Math.PI / 180;
  const dphi = (lat2 - lat1) * Math.PI / 180;
  const dlam = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return 2 * R_EARTH_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Exported for tests only.
export const __test__ = { greatCircleKm, DEFAULT_INVENTORY_PATH };
