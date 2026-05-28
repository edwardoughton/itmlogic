// Persistent elevation cache (genoa_terrain_cache, migration 002).
//
// "Just run the calc" demands we don't re-probe the same lat/lon
// every time KZLZ runs.  This module wraps the cache table with
// read-through helpers used by fetchElevationsFallback().
//
// Lat/lon are quantized to 4 decimals (~10 m) per the table PK;
// that's fine for §73.313 HAAT (which arc-averages over 3–16 km).
//
// FAIL-SOFT: when the DB isn't configured or any cache op throws,
// the helpers return cache miss / no-op so the live-fetch path
// kicks in unchanged.  The cache is an optimization, never a
// dependency.

import { pool, poolReady } from '../../db/pool.js';

function q4(n){ return Math.round(n * 10000) / 10000; }

// Look up cached elevations for an array of points.  Returns an
// array the same length as `pts` with either the cached elevation
// or null (cache miss for that point).  Empty array on any error.
export async function lookupElevationsCache(pts){
  if (!Array.isArray(pts) || pts.length === 0) return new Array(pts.length).fill(null);
  if (!poolReady()) return new Array(pts.length).fill(null);
  try {
    // Build a deduped set of (lat_q4, lon_q4) tuples to query.
    const uniq = new Map();
    for (const p of pts){
      if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) continue;
      uniq.set(`${q4(p.lat)},${q4(p.lon)}`, [q4(p.lat), q4(p.lon)]);
    }
    if (uniq.size === 0) return new Array(pts.length).fill(null);
    const keys = [...uniq.values()];
    // Postgres VALUES list — one row per (lat, lon) tuple to look up.
    const placeholders = keys.map((_, i) => `($${i*2+1}::numeric, $${i*2+2}::numeric)`).join(',');
    const params = keys.flat();
    const sql = `
      SELECT lat_q4, lon_q4, elev_m::float8 AS elev_m
      FROM genoa_terrain_cache
      WHERE (lat_q4, lon_q4) IN (${placeholders})
    `;
    const r = await pool().query(sql, params);
    const hit = new Map(r.rows.map(row => [`${Number(row.lat_q4).toFixed(4)},${Number(row.lon_q4).toFixed(4)}`, Number(row.elev_m)]));
    return pts.map(p => {
      if (!Number.isFinite(p?.lat) || !Number.isFinite(p?.lon)) return null;
      const k = `${q4(p.lat).toFixed(4)},${q4(p.lon).toFixed(4)}`;
      return hit.has(k) ? hit.get(k) : null;
    });
  } catch (err){
    // DB unavailable / table missing / SQL error — fall back to live fetch.
    return new Array(pts.length).fill(null);
  }
}

// Write resolved elevations back to the cache.  No-op on DB
// unavailable.  Uses INSERT ... ON CONFLICT to upsert.
export async function storeElevationsCache(pts, elevations, source){
  if (!poolReady()) return;
  if (!Array.isArray(pts) || pts.length !== elevations.length) return;
  try {
    const rows = [];
    for (let i = 0; i < pts.length; i++){
      const e = elevations[i];
      if (!Number.isFinite(e) || !Number.isFinite(pts[i]?.lat) || !Number.isFinite(pts[i]?.lon)) continue;
      rows.push([q4(pts[i].lat), q4(pts[i].lon), e, source || 'unknown']);
    }
    if (rows.length === 0) return;
    // Batch upsert — one INSERT with VALUES list, ON CONFLICT DO UPDATE.
    const placeholders = rows.map((_, i) => `($${i*4+1}::numeric, $${i*4+2}::numeric, $${i*4+3}::numeric, $${i*4+4}::text)`).join(',');
    const params = rows.flat();
    const sql = `
      INSERT INTO genoa_terrain_cache (lat_q4, lon_q4, elev_m, source)
      VALUES ${placeholders}
      ON CONFLICT (lat_q4, lon_q4) DO UPDATE
        SET elev_m = EXCLUDED.elev_m,
            source = EXCLUDED.source,
            fetched_at = now()
    `;
    await pool().query(sql, params);
  } catch (err){
    // Swallow — cache is best-effort.
    // eslint-disable-next-line no-console
    console.warn('[terrainCache] store failed:', err?.message || err);
  }
}
