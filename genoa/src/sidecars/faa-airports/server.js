// Genoa FAA-airports sidecar — REST API for §17.7(c) airport-proximity
// gate.
//
// Why this sidecar exists: requiredTowerCompliance() in the engine
// previously trusted a single `near_airport` boolean on station_inputs.
// The engineer of record has to verify §17.7(c) by hand for every
// filing.  This sidecar bulk-loads OurAirports.com (free,
// daily-refreshed, MIT-licensed redistribution of FAA NASR + ICAO data),
// filters to public-use airports/heliports, and exposes:
//
//   GET /healthz                    liveness; bulk-load state
//   GET /airports/near?lat&lon&radius_nm[=6]
//                                   nearest public-use airports within
//                                   `radius_nm` great-circle nautical
//                                   miles, with longest-runway length so
//                                   the caller can pick the right
//                                   §17.7(c) threshold (4 nm short / 6 nm
//                                   long / 5,000 ft heliport).
//   GET /airports/by-id/:id         exact match (OurAirports id)
//
// Boots the same way as the asr sidecar:
//   1. Apply schema.sql (idempotent)
//   2. If records_total == 0 OR > LOAD_REFRESH_DAYS old, kick the bulk
//      loader in the background while the HTTP server still answers
//      lookups.  /healthz reports loader_running=true during the load.
//   3. Schedule weekly refresh.

import express from 'express';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBulkLoad } from './airportsLoader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SIDECAR_PORT) || 8088;
const LOAD_REFRESH_DAYS = Number(process.env.AIRPORTS_LOAD_REFRESH_DAYS) || 7;

if (!process.env.DATABASE_URL){
  console.error('[airports-sidecar] DATABASE_URL is required');
  process.exit(1);
}

// Same sslmode=no-verify rewrite the asr sidecar uses to defeat pg's
// sslmode=require → verify-full alias when DO ships a self-signed cert.
function buildPgConnectionString(){
  const raw = process.env.DATABASE_URL;
  if (process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false') return raw;
  try {
    const u = new URL(raw);
    u.searchParams.set('sslmode', 'no-verify');
    return u.toString();
  } catch {
    return raw;
  }
}

const pool = new pg.Pool({
  connectionString: buildPgConnectionString(),
  ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PG_POOL_MAX) || 5,
  application_name: 'genoa-faa-airports-sidecar'
});

let loaderState = { running: false, last_error: null };

async function ensureSchema(){
  const sql = await readFile(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[airports-sidecar] schema applied');
}

async function maybeRunBulkLoad(){
  const r = await pool.query(`SELECT records_total, last_loaded_at FROM faa_airports_load_state WHERE id = 1`);
  const row = r.rows[0];
  const stale = !row
    || !row.records_total
    || (row.last_loaded_at && (Date.now() - new Date(row.last_loaded_at).getTime()) > LOAD_REFRESH_DAYS * 24 * 3600 * 1000);
  if (!stale){
    console.log(`[airports-sidecar] DB has ${row.records_total} airports loaded ${row.last_loaded_at}; skipping refresh`);
    return;
  }
  console.log('[airports-sidecar] kicking bulk load in background');
  loaderState.running = true;
  runBulkLoad(pool, console)
    .then(s => { loaderState.running = false; loaderState.last_summary = s; })
    .catch(e => { loaderState.running = false; loaderState.last_error = String(e.message); });
}

function scheduleWeeklyRefresh(){
  const ms = LOAD_REFRESH_DAYS * 24 * 3600 * 1000;
  setInterval(() => { maybeRunBulkLoad().catch(e => console.error(e)); }, ms);
  console.log(`[airports-sidecar] weekly refresh scheduled every ${LOAD_REFRESH_DAYS} days`);
}

// ── Row → API record ──────────────────────────────────────
function rowToRecord(row, distance_m = null){
  return {
    airport_id:        row.airport_id,
    ident:             row.ident,
    iata_code:         row.iata_code,
    local_code:        row.local_code,
    type:              row.type,
    name:              row.name,
    lat:               row.latitude_deg,
    lon:               row.longitude_deg,
    elevation_ft:      row.elevation_ft,
    iso_country:       row.iso_country,
    iso_region:        row.iso_region,
    municipality:      row.municipality,
    scheduled_service: row.scheduled_service === 'yes',
    longest_runway_ft: row.longest_runway_ft,
    longest_runway_m:  row.longest_runway_m,
    has_lighted_rwy:   row.has_lighted_rwy,
    distance_m:        distance_m != null ? Math.round(distance_m) : null,
    distance_nm:       distance_m != null ? Number((distance_m / 1852).toFixed(3)) : null,
    source:            'genoa-faa-airports-sidecar-tier1',
    source_data:       'OurAirports.com (FAA NASR + ICAO redistribution)',
    fetched_at:        new Date().toISOString()
  };
}

// ── HTTP server ────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '64kb' }));

// Echo every inbound /airports/* request so we can confirm the wire
// from genoa's airportClient is actually reaching this sidecar.
app.use((req, _res, next) => {
  if (req.path.startsWith('/airports/')){
    console.log(`[airports-sidecar] ${req.method} ${req.originalUrl}`);
  }
  next();
});

app.get('/healthz', async (_req, res) => {
  try {
    const r = await pool.query(`SELECT records_total, records_us, records_heliport,
                                       last_loaded_at, last_source_url, load_duration_seconds, load_error
                                FROM faa_airports_load_state WHERE id = 1`);
    const sizes = await pool.query(`
      SELECT
        pg_total_relation_size('faa_airports')         AS airports_bytes,
        pg_total_relation_size('faa_airports_archive') AS archive_bytes,
        (SELECT COUNT(*) FROM faa_airports_archive)    AS archive_count
    `).catch(() => ({ rows: [{}] }));
    res.json({
      ok:           true,
      sidecar:      'genoa-faa-airports-sidecar',
      version:      '0.1.0',
      bulk_load:    r.rows[0] || { records_total: 0 },
      storage: {
        airports_bytes: Number(sizes.rows[0]?.airports_bytes || 0),
        archive_bytes:  Number(sizes.rows[0]?.archive_bytes  || 0),
        archive_count:  Number(sizes.rows[0]?.archive_count  || 0)
      },
      loader_running: loaderState.running,
      loader_error:   loaderState.last_error
    });
  } catch (e){
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

// ── /airports/near?lat&lon&radius_nm ──
//
// Haversine inside a (latitude_deg, longitude_deg) bounding-box prefilter
// so the index does the heavy lifting.  Returns rows ordered by ascending
// distance_m, capped at `limit` (default 10).
app.get('/airports/near', async (req, res) => {
  const lat        = parseFloat(req.query.lat);
  const lon        = parseFloat(req.query.lon);
  const radius_nm  = Math.min(parseFloat(req.query.radius_nm) || 6, 25);
  const limit      = Math.min(parseInt(req.query.limit, 10) || 10, 50);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)){
    return res.status(400).json({ available: false, error: 'lat / lon required' });
  }
  const radius_m = radius_nm * 1852;
  // 1 degree lat ≈ 111,320 m; 1 degree lon ≈ 111,320 × cos(lat)
  const dLat = radius_m / 111_320;
  const dLon = radius_m / (111_320 * Math.cos(lat * Math.PI / 180));
  try {
    const r = await pool.query(`
      SELECT *,
             6371000 * 2 * ASIN(SQRT(
                 POWER(SIN(RADIANS(latitude_deg - $1)/2), 2)
               + COS(RADIANS($1)) * COS(RADIANS(latitude_deg))
               * POWER(SIN(RADIANS(longitude_deg - $2)/2), 2)
             )) AS distance_m
      FROM faa_airports
      WHERE latitude_deg  BETWEEN $1 - $3 AND $1 + $3
        AND longitude_deg BETWEEN $2 - $4 AND $2 + $4
      ORDER BY distance_m ASC
      LIMIT $5
    `, [lat, lon, dLat, dLon, limit]);
    const inside = r.rows.filter(row => row.distance_m <= radius_m);
    return res.json({
      available: true,
      source:    'genoa-faa-airports-sidecar-tier1',
      query:     { lat, lon, radius_nm, radius_m, limit },
      n:         inside.length,
      airports:  inside.map(row => rowToRecord(row, row.distance_m))
    });
  } catch (e){
    console.error('[airports-sidecar] near query failed:', e);
    return res.status(500).json({ available: false, error: String(e.message) });
  }
});

// ── /airports/by-id/:id ──
app.get('/airports/by-id/:id', async (req, res) => {
  const id = String(req.params.id).trim();
  try {
    const r = await pool.query(`SELECT * FROM faa_airports WHERE airport_id = $1 LIMIT 1`, [id]);
    if (!r.rows.length){
      return res.status(404).json({ available: false, error: `no airport with id ${id}` });
    }
    return res.json({ available: true, ...rowToRecord(r.rows[0]) });
  } catch (e){
    return res.status(500).json({ available: false, error: String(e.message) });
  }
});

// ── Boot ───────────────────────────────────────────────
(async () => {
  try {
    await ensureSchema();
    await maybeRunBulkLoad();
    scheduleWeeklyRefresh();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[airports-sidecar] listening on 0.0.0.0:${PORT}`);
    });
  } catch (e){
    console.error('[airports-sidecar] boot failed:', e);
    process.exit(1);
  }
})();
