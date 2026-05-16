// Census ACS 5-year population evidence adapter.
//
// Same evidence shape as fccCensusClient.js / populationClient.js,
// but uses the American Community Survey 5-year estimates at
// block-group granularity instead of the decennial counts from the
// FCC Census Block API.  ACS is more recent (rolling 5-year window)
// but requires multiple upstreams and is rate-limited by the Census
// API at 500 calls/day without CENSUS_API_KEY.
//
// METHOD
//   1. Sample N points across the polygon (deterministic uniform grid).
//   2. For each unique sample, call the Census Geocoder to obtain
//      {state, county, tract, block_group} FIPS codes.
//   3. For each unique (state, county) tuple, bulk-fetch:
//      a. ACS: total population (B01003_001E) per block-group.
//      b. Decennial 2020 DHC: AREALAND per block-group (the ACS
//         dataset does not publish AREALAND; we use the decennial
//         dataset for that geographic metadata only — the population
//         number always comes from the ACS estimate).
//   4. Per-sample density = ACS_bg_pop / (AREALAND / 1e6).
//   5. Average density × polygon_area_km² = persons.
//
// PROVENANCE
//   Returns the same evidence shape as the operator-managed
//   POPULATION_EVIDENCE_URL adapter and the FCC Census Block API
//   fallback:
//     { available, persons, source, dataset, vintage, method,
//       fetched_at, endpoint, contour_label }.
//
// DETERMINISM
//   Sample points come from a deterministic uniform grid; per-county
//   ACS / DEC results are cached in insertion order; floating-point
//   math is identical across runs.  Two compute() calls against the
//   same exhibit return the same persons number.

import { uniformInteriorSample } from './polygonSample.js';
import { ringArea_km2 }          from '../engine/geometry/karneyArea.js';

const DEFAULT_GEOCODER_URL = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates';
const DEFAULT_API_BASE_URL = 'https://api.census.gov/data';
const DEFAULT_VINTAGE      = 2022;
const DEFAULT_TIMEOUT_MS   = 10_000;
const DEFAULT_SAMPLES      = 16;
const DEFAULT_CONCURRENCY  = 4;
const POP_VARIABLE         = 'B01003_001E';
const DEC_AREALAND_DATASET = '2020/dec/dhc';

/**
 * Construct a Census ACS 5-year population client.
 *
 * Options:
 *   acsYear      — ACS 5-year vintage (default 2022).
 *   apiKey       — Census API key (default process.env.CENSUS_API_KEY).
 *   geocoderUrl  — Census Geocoder /geographies/coordinates endpoint.
 *   apiBaseUrl   — Census Data API base (default api.census.gov/data).
 *   samples      — target sample count per polygon (default 16).
 *   concurrency  — max parallel requests per polygon (default 4).
 *   timeoutMs    — per-request timeout (default 10 s).
 *   cache        — optional Map-like for block-group results.  When
 *                  omitted, an in-memory cache persists across calls.
 *   fetchFn      — fetch implementation (default global fetch); tests
 *                  pass a stub here.
 */
export function makeAcsCensusClient({
  acsYear     = DEFAULT_VINTAGE,
  apiKey      = process.env.CENSUS_API_KEY || null,
  geocoderUrl = DEFAULT_GEOCODER_URL,
  apiBaseUrl  = DEFAULT_API_BASE_URL,
  samples     = DEFAULT_SAMPLES,
  concurrency = DEFAULT_CONCURRENCY,
  timeoutMs   = DEFAULT_TIMEOUT_MS,
  cache       = null,
  fetchFn     = (typeof fetch === 'function' ? fetch : null)
} = {}){
  if (!fetchFn) return null;

  // Block-group cache shared across calls.
  // Key: 12-char FIPS '{state}{county}{tract}{bg}' -> { population, area_land_m2 }
  const blockGroupCache = cache || new Map();

  return {
    acsYear,
    cacheSize: () => blockGroupCache.size,

    async populationForContour({ geojson, contour_label }){
      if (!geojson?.geometry?.coordinates?.[0]?.length){
        return { available: false, source: null, error: 'no_geojson' };
      }
      // GeoJSON Polygon coords are [lon, lat]; Genoa rings are [lat, lon].
      const ring_lonlat = geojson.geometry.coordinates[0];
      const ring_latlng = ring_lonlat.map(([lon, lat]) => [lat, lon]);
      const polygon_area_km2 = ringArea_km2(ring_latlng);
      if (!Number.isFinite(polygon_area_km2) || polygon_area_km2 <= 0){
        return { available: false, source: null, error: 'invalid_polygon' };
      }

      const samplePoints = uniformInteriorSample(ring_latlng, samples);
      if (samplePoints.length === 0){
        return { available: false, source: null, error: 'no_interior_samples' };
      }

      const fetched_at = new Date().toISOString();
      const errors = [];

      // 1. For each sample, geocode -> {state, county, tract, block_group}.
      const geocoded = await runWithConcurrency(samplePoints, concurrency,
        async (pt) => {
          const [lat, lon] = pt;
          try {
            const geo = await fetchGeography({ lat, lon, geocoderUrl, timeoutMs, fetchFn });
            return { ok: true, pt, ...geo };
          } catch (e){
            errors.push(`geocoder ${lat.toFixed(2)},${lon.toFixed(2)}: ${e.message}`);
            return { ok: false, pt, error: e.message };
          }
        });

      const successes = geocoded.filter(r => r.ok);
      if (successes.length === 0){
        return {
          available: false,
          source:    null,
          endpoint:  geocoderUrl,
          error:     'census_geocoder_unreachable',
          attempt_errors: errors.slice(0, 3)
        };
      }

      // 2. For each unique (state, county), bulk ACS pop + DEC AREALAND.
      const counties = new Map();
      for (const r of successes){
        const key = `${r.state}|${r.county}`;
        if (!counties.has(key)) counties.set(key, { state: r.state, county: r.county });
      }
      for (const { state, county } of counties.values()){
        try {
          const acsRows = await fetchAcsBlockGroups({
            apiBaseUrl, acsYear, state, county, apiKey, timeoutMs, fetchFn
          });
          const decRows = await fetchDecAreaLand({
            apiBaseUrl, state, county, apiKey, timeoutMs, fetchFn
          });
          // Merge: bg_fips -> { population, area_land_m2 }.
          for (const [bg_fips, population] of acsRows){
            const area = decRows.get(bg_fips);
            if (area === undefined) continue;
            blockGroupCache.set(bg_fips, { population, area_land_m2: area });
          }
        } catch (e){
          errors.push(`acs/dec ${state}-${county}: ${e.message}`);
        }
      }

      // 3. Per-sample density.
      let density_sum = 0;
      let density_n   = 0;
      const unique_bgs = new Set();
      for (const r of successes){
        const bg_fips = `${r.state}${r.county}${r.tract}${r.block_group}`;
        const cached = blockGroupCache.get(bg_fips);
        if (!cached) continue;
        unique_bgs.add(bg_fips);
        const { population, area_land_m2 } = cached;
        if (!Number.isFinite(population) || !Number.isFinite(area_land_m2) || area_land_m2 <= 0) continue;
        const area_km2 = area_land_m2 / 1e6;
        density_sum += population / area_km2;
        density_n   += 1;
      }
      if (density_n === 0){
        return {
          available: false,
          source:    null,
          endpoint:  apiBaseUrl,
          error:     'no_block_group_data_resolved',
          attempt_errors: errors.slice(0, 3)
        };
      }

      const avg_density = density_sum / density_n;
      const persons     = Math.max(0, Math.round(avg_density * polygon_area_km2));

      return {
        available:   true,
        persons,
        source:      'US Census Bureau via ACS 5-year',
        dataset:     `American Community Survey 5-year ${acsYear}`,
        vintage:     Number(acsYear),
        method:      `Census Geocoder + ACS 5-year block-group point-sample density estimator (n=${samplePoints.length}, ${unique_bgs.size} unique block-groups)`,
        endpoint:    apiBaseUrl,
        fetched_at,
        contour_label,
        details: {
          polygon_area_km2,
          sample_count:             samplePoints.length,
          unique_block_group_count: unique_bgs.size,
          unique_county_count:      counties.size,
          api_errors:               errors.length,
          density_pop_per_km2:      avg_density
        }
      };
    }
  };
}

/* -------------------- internals -------------------- */

async function fetchGeography({ lat, lon, geocoderUrl, timeoutMs, fetchFn }){
  const url = `${geocoderUrl}?x=${encodeURIComponent(lon)}&y=${encodeURIComponent(lat)}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
  const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from Census Geocoder`);
  const json = await r.json();
  const layers = json?.result?.geographies?.['Census Block Groups'];
  if (!Array.isArray(layers) || layers.length === 0){
    throw new Error('no block-group geography returned');
  }
  const bg = layers[0];
  // Normalize to FIPS strings; Census returns these as numeric in some
  // payloads.  Pad state to 2, county to 3, tract to 6, block group to 1.
  return {
    state:       padFips(bg.STATE,  2),
    county:      padFips(bg.COUNTY, 3),
    tract:       padFips(bg.TRACT,  6),
    block_group: padFips(bg.BLKGRP, 1)
  };
}

async function fetchAcsBlockGroups({ apiBaseUrl, acsYear, state, county, apiKey, timeoutMs, fetchFn }){
  const params = new URLSearchParams({
    get: `${POP_VARIABLE},NAME`,
    for: 'block group:*',
    in:  `state:${state} county:${county}`
  });
  if (apiKey) params.set('key', apiKey);
  const url = `${apiBaseUrl}/${acsYear}/acs/acs5?${params.toString()}`;
  const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`ACS HTTP ${r.status}`);
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('ACS returned no rows');
  return rowsToFipsMap(rows, POP_VARIABLE);
}

async function fetchDecAreaLand({ apiBaseUrl, state, county, apiKey, timeoutMs, fetchFn }){
  // ACS does not publish AREALAND; the 2020 Decennial DHC dataset does.
  // Population always comes from ACS — only the geographic metadata is
  // sourced from the decennial here.
  const params = new URLSearchParams({
    get: 'AREALAND,NAME',
    for: 'block group:*',
    in:  `state:${state} county:${county}`
  });
  if (apiKey) params.set('key', apiKey);
  const url = `${apiBaseUrl}/${DEC_AREALAND_DATASET}?${params.toString()}`;
  const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`DEC HTTP ${r.status}`);
  const rows = await r.json();
  if (!Array.isArray(rows) || rows.length < 2) throw new Error('DEC returned no rows');
  return rowsToFipsMap(rows, 'AREALAND');
}

// Census Data API returns rows of the form
//   [['var1', 'var2', ..., 'state', 'county', 'tract', 'block group'], [v1, v2, ..., '04', '013', '010101', '1'], ...]
// rowsToFipsMap turns that into Map<bg_fips_12, value_for_field>.
function rowsToFipsMap(rows, valueField){
  const header = rows[0];
  const valIdx    = header.indexOf(valueField);
  const stateIdx  = header.indexOf('state');
  const countyIdx = header.indexOf('county');
  const tractIdx  = header.indexOf('tract');
  const bgIdx     = header.indexOf('block group');
  if ([valIdx, stateIdx, countyIdx, tractIdx, bgIdx].some(i => i < 0)){
    throw new Error(`Census API returned unexpected columns: ${header.join(',')}`);
  }
  const out = new Map();
  for (let i = 1; i < rows.length; i++){
    const row = rows[i];
    const fips = `${padFips(row[stateIdx], 2)}${padFips(row[countyIdx], 3)}${padFips(row[tractIdx], 6)}${padFips(row[bgIdx], 1)}`;
    const value = Number(row[valIdx]);
    if (Number.isFinite(value)) out.set(fips, value);
  }
  return out;
}

function padFips(v, width){
  return String(v ?? '').padStart(width, '0');
}

/**
 * Bounded-concurrency Promise.all.  Preserves order of inputs in the
 * output array.  Used to keep at most N Census API calls in flight.
 */
async function runWithConcurrency(items, n, worker){
  const out = new Array(items.length);
  let i = 0;
  async function lane(){
    while (true){
      const idx = i++;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, n) }, lane));
  return out;
}

/* -------------------- exports for tests -------------------- */

export {
  fetchGeography      as _fetchGeography,
  fetchAcsBlockGroups as _fetchAcsBlockGroups,
  fetchDecAreaLand    as _fetchDecAreaLand,
  rowsToFipsMap       as _rowsToFipsMap,
  padFips             as _padFips,
  runWithConcurrency  as _runWithConcurrency
};
