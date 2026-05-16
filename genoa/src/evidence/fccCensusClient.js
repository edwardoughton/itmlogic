// FCC Census API population evidence adapter.
//
// Replaces the POPULATION_PLACEHOLDER for any closed contour polygon
// using the public FCC Census Block API at
// https://geo.fcc.gov/api/census/area.  No custom sidecar required.
//
// METHOD
//   1. Drop a deterministic uniform grid of N points across the
//      polygon and keep the ones inside (src/evidence/polygonSample.js).
//   2. For each unique sample point, hit the FCC Census API to obtain
//      { block_fips, bbox, block_pop_2020 } for the Census 2020 block
//      containing that point.
//   3. Cache results by block_fips so subsequent samples in the same
//      block (and ALL future polygons that hit that block) reuse the
//      cached pop / area.
//   4. Estimate per-sample density = block_pop / block_area_km², then
//      average across samples and multiply by the polygon area to get
//      the polygon population estimate.
//
// SCALE
//   ~28k US broadcast stations × ~16 samples = ~450k API calls per
//   full sweep, but blocks reused heavily across nearby exhibits
//   collapse the long-tail to ~hundreds of thousands of unique blocks
//   total.  The block cache survives across stations within a single
//   process; a persistent cache (file or DB) can be wired in via the
//   `cache` constructor option.  Concurrency is capped at 4 in-flight
//   FCC requests per polygon to stay polite on the upstream.
//
// PROVENANCE
//   Every successful call returns the same evidence shape as the
//   POPULATION_EVIDENCE_URL adapter (src/evidence/populationClient.js):
//   { available, persons, source, dataset, vintage, method,
//     fetched_at, endpoint, contour_label }.
//
// DETERMINISM
//   Sample points come from a deterministic uniform grid; per-block
//   results are cached in insertion order; floating-point math is
//   identical across runs.  Two compute() calls against the same
//   exhibit return the same population number.

import {
  uniformInteriorSample,
  bboxAreaKm2,
  pointInPolygon
} from './polygonSample.js';
import { ringArea_km2 } from '../engine/geometry/karneyArea.js';

const DEFAULT_BASE_URL    = 'https://geo.fcc.gov/api/census/area';
const DEFAULT_TIMEOUT_MS  = 10_000;
const DEFAULT_SAMPLES     = 16;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_CENSUS_YEAR = 2020;
const POP_FIELD_BY_YEAR   = { 2020: 'block_pop_2020', 2010: 'block_pop_2010' };

/**
 * Construct an FCC Census population client.
 *
 * Options:
 *   baseUrl       — FCC Census /area endpoint (default geo.fcc.gov).
 *   censusYear    — 2010 or 2020.  Drives the population field name.
 *   samples       — target sample count per polygon (default 16).
 *   concurrency   — max parallel FCC requests per polygon (default 4).
 *   timeoutMs     — per-request timeout (default 10 s).
 *   cache         — optional Map-like with .get(k) / .set(k, v).  When
 *                   omitted, an in-memory cache is created at
 *                   construction time and persists across calls.
 *   fetchFn       — fetch implementation (default global fetch); tests
 *                   pass a stub here.
 */
export function makeFccCensusClient({
  baseUrl     = DEFAULT_BASE_URL,
  censusYear  = DEFAULT_CENSUS_YEAR,
  samples     = DEFAULT_SAMPLES,
  concurrency = DEFAULT_CONCURRENCY,
  timeoutMs   = DEFAULT_TIMEOUT_MS,
  cache       = null,
  fetchFn     = (typeof fetch === 'function' ? fetch : null)
} = {}){
  if (!fetchFn) return null;
  const blockCache = cache || new Map();
  const popField   = POP_FIELD_BY_YEAR[censusYear] || POP_FIELD_BY_YEAR[2020];

  return {
    baseUrl,
    censusYear,
    cacheSize: () => blockCache.size,

    // Liveness probe used by /readyz.  geo.fcc.gov has no /health
    // route, so we hit the real /area endpoint with a known sample
    // point and count any HTTP response (2xx-4xx) as "host reachable".
    // Only network / DNS / TLS failures register as unhealthy.
    async health(){
      try {
        const r = await fetchFn(`${baseUrl}?lat=37.0902&lon=-95.7129&censusYear=${censusYear}&format=json`,
                                { signal: AbortSignal.timeout(3000) });
        return r.status >= 200 && r.status < 600;
      } catch { return false; }
    },

    /**
     * Compute polygon population from sampled FCC Census blocks.
     *
     * @param {object} args
     * @param {object} args.geojson         GeoJSON Feature with Polygon geometry.
     * @param {string} args.contour_label   e.g. '60 dBu (1 mV/m service)'
     * @returns evidence record (see populationClient.js for shape)
     */
    async populationForContour({ geojson, contour_label }){
      if (!geojson?.geometry?.coordinates?.[0]?.length){
        return { available: false, source: null, error: 'no_geojson' };
      }
      // Inputs.  GeoJSON Polygon coords are [lon, lat]; Genoa rings
      // are [lat, lon].  Convert in-place for sampling.
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
      const blocks = await runWithConcurrency(samplePoints, concurrency,
        async (pt) => {
          const [lat, lon] = pt;
          try {
            const b = await fetchBlock({ lat, lon, baseUrl, censusYear, popField,
                                          timeoutMs, fetchFn, blockCache });
            return { ok: true, block: b, pt };
          } catch (e){
            errors.push(String(e.message || e));
            return { ok: false, error: e.message, pt };
          }
        });

      const successes = blocks.filter(r => r.ok);
      if (successes.length === 0){
        return {
          available: false,
          source:    null,
          endpoint:  baseUrl,
          error:     'fcc_census_unreachable',
          attempt_errors: errors.slice(0, 3)
        };
      }

      // Estimate per-sample density.  Skip blocks with non-finite area.
      let density_sum = 0;
      let density_n   = 0;
      const unique_blocks = new Map();
      for (const r of successes){
        const b = r.block;
        if (!b) continue;
        unique_blocks.set(b.block_fips, b);
        if (!Number.isFinite(b.block_area_km2) || b.block_area_km2 <= 0) continue;
        density_sum += b.block_pop / b.block_area_km2;
        density_n   += 1;
      }
      if (density_n === 0){
        return {
          available: false,
          source:    null,
          endpoint:  baseUrl,
          error:     'no_block_areas_resolved'
        };
      }
      const avg_density = density_sum / density_n;
      const persons     = Math.max(0, Math.round(avg_density * polygon_area_km2));

      return {
        available:    true,
        persons,
        source:       'US Census Bureau via FCC Census Block API',
        dataset:      `Decennial Census ${censusYear}`,
        vintage:      Number(censusYear),
        method:       `FCC Census Block API polygon point-sample density estimator (n=${samplePoints.length}, ${unique_blocks.size} unique blocks)`,
        endpoint:     baseUrl,
        fetched_at,
        contour_label,
        details: {
          polygon_area_km2,
          sample_count:        samplePoints.length,
          unique_block_count:  unique_blocks.size,
          api_errors:          errors.length,
          density_pop_per_km2: avg_density
        }
      };
    }
  };
}

/* -------------------- internals -------------------- */

async function fetchBlock({ lat, lon, baseUrl, censusYear, popField,
                            timeoutMs, fetchFn, blockCache }){
  // First lookup: don't know the block FIPS yet, so we can't dedupe
  // until after the API call.  But after one success per block, every
  // future point inside the same block hits cache.
  const url = `${baseUrl}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&censusYear=${encodeURIComponent(censusYear)}&format=json`;
  const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok){
    throw new Error(`HTTP ${r.status} from FCC Census`);
  }
  const json = await r.json();
  const result = json?.results?.[0];
  if (!result || !result.block_fips){
    throw new Error('FCC Census returned no block result');
  }
  const fips = String(result.block_fips);
  const cached = blockCache.get(fips);
  if (cached) return cached;

  const bbox = result.bbox && result.bbox.length === 4
    ? { lon_min: result.bbox[0], lat_min: result.bbox[1],
        lon_max: result.bbox[2], lat_max: result.bbox[3] }
    : null;
  const block_area_km2 = bbox ? bboxAreaKm2(bbox) : null;
  const block = {
    block_fips:        fips,
    county_fips:       result.county_fips || null,
    state_fips:        result.state_fips  || null,
    state_code:        result.state_code  || null,
    block_pop:         Number.isFinite(Number(result[popField])) ? Number(result[popField]) : 0,
    block_area_km2,
    bbox,
    fetched_at:        new Date().toISOString()
  };
  blockCache.set(fips, block);
  return block;
}

/**
 * Bounded-concurrency Promise.all.  Preserves order of inputs in the
 * output array.  Used to keep at most N FCC API calls in flight.
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

export { fetchBlock as _fetchBlock, runWithConcurrency as _runWithConcurrency };
