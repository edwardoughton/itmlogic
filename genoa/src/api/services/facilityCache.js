// Facility cache — Postgres-backed write-through for facility lookups.
// Falls open: when DATABASE_URL is unset, reads return null and writes
// are no-ops.  Genoa NEVER writes to upstream facility sources; it only
// caches its own normalized copy locally.

import { pool, poolReady } from '../../db/pool.js';

const TTL_MS = 24 * 60 * 60 * 1000;   // 24h

export async function getCached(facility_id){
  if (!poolReady() || !facility_id) return null;
  try {
    const r = await pool().query(
      `SELECT facility_id, call_sign, service, frequency, raw, source, fetched_at
         FROM genoa_facility_cache
        WHERE facility_id = $1
          AND fetched_at > NOW() - INTERVAL '24 hours'
        LIMIT 1`,
      [String(facility_id)]
    );
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return { facility: row.raw, source: row.source, cached: true, fetched_at: row.fetched_at };
  } catch { return null; }
}

export async function putCached(facility){
  if (!poolReady() || !facility?.facility_id) return;
  try {
    await pool().query(
      `INSERT INTO genoa_facility_cache
         (facility_id, call_sign, service, frequency, raw, source, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (facility_id) DO UPDATE
         SET call_sign  = EXCLUDED.call_sign,
             service    = EXCLUDED.service,
             frequency  = EXCLUDED.frequency,
             raw        = EXCLUDED.raw,
             source     = EXCLUDED.source,
             fetched_at = now()`,
      [
        String(facility.facility_id),
        facility.call || null,
        facility.service || null,
        facility.frequency || null,
        facility,
        facility.facility_lookup_source?.upstream || null
      ]
    );
  } catch {/* swallow; cache is best-effort */}
}

export const FACILITY_CACHE_TTL_MS = TTL_MS;
