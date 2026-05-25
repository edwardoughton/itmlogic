// Genoa ASR sidecar — REST API for FCC Antenna Structure Registration lookups.
//
// Tier hierarchy (operator-locked policy — FCC official ALWAYS first):
//
//   Tier 1 (PRIMARY, always):   local Postgres asr_towers table loaded
//                               weekly from FCC ULS r_tower.zip
//                               (data.fcc.gov/download/pub/uls/complete/
//                               r_tower.zip — the FCC-published source
//                               of truth).  Sub-100 ms lookups by ASR#
//                               or by lat/lon proximity.  ~1.7M towers.
//
//   Tier 2 (RESERVED, future):  independent ASR mirror (e.g.
//                               chelstein/asr-server when it lands as
//                               its own DO app).  Slot reserved here
//                               for documentation completeness; the
//                               main API's asrClient.js will gain the
//                               wire-up when the second mirror exists.
//
//   Tier 3 (FALLBACK):          ZTR rich-station _tower passthrough.
//                               This sidecar does NOT call ZTR — that
//                               wiring lives in the main API's
//                               asrClient.extractFromRichStation, which
//                               runs BEFORE the call to this sidecar.
//                               Documented here for tier-chain clarity.
//
//   Tier 4 (LAST RESORT):       Python subprocess (asr_html_bridge.py)
//                               that hits REC Networks (api.recnet.net /
//                               recnet.com/towerfind via cloudscraper)
//                               then radio-locator.com.  Same Node +
//                               Python-bridge pattern as the NEC sidecar.
//                               Slow (~3-8 s per lookup); used only when
//                               the bulk DB has no record AND an asr_number
//                               is supplied.
//
// Endpoints:
//   GET  /healthz                    — liveness; reports last bulk-load state
//   GET  /asr/by-number/:asr         — exact match in asr_towers; tier-4 fallback if not found
//   GET  /asr/by-location?lat&lon&radius_m=1000&limit=1
//                                    — haversine within candidate set
//   GET  /asr/diag/nearest?lat&lon&n=5     — debug: N closest regardless of radius
//   GET  /asr/diag/by-state?state=VA       — debug: counts + sample by state
//
// Boots:
//   1. Apply schema.sql (idempotent).
//   2. Read asr_load_state.records_total.  If 0 OR > LOAD_REFRESH_DAYS old,
//      kick the bulk loader in the background (server still answers other
//      lookups in the meantime; /healthz reports loading=true).
//      Setting ASR_FORCE_RELOAD=1 forces the reload regardless of staleness
//      (used after a parser fix to wipe + re-populate the table).
//   3. After the first successful load, schedule a weekly refresh.

import express from 'express';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { runBulkLoad } from './ulsBulkLoader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.SIDECAR_PORT) || 8087;
const LOAD_REFRESH_DAYS = Number(process.env.ASR_LOAD_REFRESH_DAYS) || 7;
const HTML_BRIDGE_TIMEOUT_MS = Number(process.env.ASR_HTML_BRIDGE_TIMEOUT_MS) || 15_000;

if (!process.env.DATABASE_URL){
  console.error('[asr-sidecar] DATABASE_URL is required');
  process.exit(1);
}

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
  application_name: 'genoa-asr-sidecar'
});

let loaderState = { running: false, last_error: null };

async function ensureSchema(){
  const sql = await readFile(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('[asr-sidecar] schema applied');
}

async function maybeRunBulkLoad(){
  const r = await pool.query(`SELECT records_total, last_loaded_at FROM asr_load_state WHERE id = 1`);
  const row = r.rows[0];
  const forced = process.env.ASR_FORCE_RELOAD === '1';
  const stale = !row
    || !row.records_total
    || (row.last_loaded_at && (Date.now() - new Date(row.last_loaded_at).getTime()) > LOAD_REFRESH_DAYS * 24 * 3600 * 1000);
  if (!stale && !forced){
    console.log(`[asr-sidecar] DB has ${row.records_total} towers loaded ${row.last_loaded_at}; skipping refresh`);
    return;
  }
  if (forced) console.log('[asr-sidecar] ASR_FORCE_RELOAD=1 — forcing bulk reload despite fresh data');
  console.log('[asr-sidecar] kicking bulk load in background');
  loaderState.running = true;
  runBulkLoad(pool, console)
    .then(s => { loaderState.running = false; loaderState.last_summary = s; })
    .catch(e => { loaderState.running = false; loaderState.last_error = String(e.message); console.error('[asr-sidecar] bulk load failed:', e); });
}

function scheduleWeeklyRefresh(){
  const ms = LOAD_REFRESH_DAYS * 24 * 3600 * 1000;
  setInterval(() => { maybeRunBulkLoad().catch(e => console.error(e)); }, ms);
  console.log(`[asr-sidecar] weekly refresh scheduled every ${LOAD_REFRESH_DAYS} days`);
}

async function htmlScrapeFallback(asrNumber){
  return new Promise(resolve => {
    const proc = spawn(process.env.PYNEC_PYTHON_BIN || 'python3',
                       [join(__dirname, 'asr_html_bridge.py'), String(asrNumber)],
                       { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      resolve({ available: false, source: 'asr-html-bridge', error: `bridge timeout after ${HTML_BRIDGE_TIMEOUT_MS} ms` });
    }, HTML_BRIDGE_TIMEOUT_MS);
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0){
        resolve({ available: false, source: 'asr-html-bridge', error: `bridge exit ${code}; stderr=${stderr.slice(0, 200)}` });
        return;
      }
      try { resolve(JSON.parse(stdout.trim().split('\n').pop() || '{}')); }
      catch (e){ resolve({ available: false, source: 'asr-html-bridge', error: `bridge JSON parse: ${e.message}; stdout=${stdout.slice(0, 200)}` }); }
    });
    proc.on('error', e => {
      clearTimeout(timer);
      resolve({ available: false, source: 'asr-html-bridge', error: `bridge spawn: ${e.message}` });
    });
  });
}

function rowToRecord(row, tier){
  return {
    available:                 true,
    source:                    `asr-sidecar-tier${tier}`,
    source_tier:               tier,
    asr_number:                row.asr_number,
    unique_system_id:          row.unique_system_id,
    status:                    row.status,
    registration_purpose:      row.registration_purpose,
    owner:                     row.owner_name,
    owner_frn:                 row.owner_frn,
    latitude_deg:              row.latitude_deg,
    longitude_deg:             row.longitude_deg,
    height_of_structure_m:     row.height_of_structure_m,
    ground_elevation_m:        row.ground_elevation_m,
    overall_height_m:          row.overall_height_agl_m,
    overall_height_amsl_m:     row.overall_height_amsl_m,
    structure_type:            row.structure_type,
    faa_study_number:          row.faa_study_number,
    faa_circular_number:       row.faa_circular_number,
    faa_emi_flag:              row.faa_emi_flag,
    nepa_flag:                 row.nepa_flag,
    date_faa_determination:    row.date_faa_determination,
    painting_requirement:      row.painting_lighting,
    lighting_requirement:      row.mark_light_code,
    structure_address:         row.structure_address,
    structure_city:            row.structure_city,
    structure_state:           row.structure_state,
    fetched_at:                new Date().toISOString(),
    endpoint:                  `genoa-asr-sidecar:${PORT}`
  };
}

const app = express();
app.use(express.json({ limit: '256kb' }));

app.use((req, _res, next) => {
  if (req.path.startsWith('/asr/')){
    console.log(`[asr-sidecar] ${req.method} ${req.originalUrl}`);
  }
  next();
});

app.get('/healthz', async (_req, res) => {
  try {
    const r = await pool.query(`SELECT records_total, records_with_coords, records_with_owner,
                                       last_loaded_at, last_source_url, load_duration_seconds, load_error
                                FROM asr_load_state WHERE id = 1`);
    const sizes = await pool.query(`
      SELECT
        pg_total_relation_size('asr_towers')      AS towers_bytes,
        pg_total_relation_size('asr_zip_archive') AS archive_bytes,
        (SELECT COUNT(*) FROM asr_zip_archive)    AS archive_count,
        (SELECT MIN(snapshot_date) FROM asr_zip_archive) AS archive_oldest,
        (SELECT MAX(snapshot_date) FROM asr_zip_archive) AS archive_newest
    `).catch(() => ({ rows: [{}] }));
    res.json({
      ok:           true,
      sidecar:      'genoa-asr-sidecar',
      version:      '0.1.0',
      bulk_load:    r.rows[0] || { records_total: 0 },
      storage: {
        towers_bytes:    Number(sizes.rows[0]?.towers_bytes  || 0),
        archive_bytes:   Number(sizes.rows[0]?.archive_bytes || 0),
        archive_count:   Number(sizes.rows[0]?.archive_count || 0),
        archive_oldest:  sizes.rows[0]?.archive_oldest || null,
        archive_newest:  sizes.rows[0]?.archive_newest || null
      },
      loader_running: loaderState.running,
      loader_error:   loaderState.last_error
    });
  } catch (e){
    res.status(500).json({ ok: false, error: String(e.message) });
  }
});

app.get('/asr/archive', async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT snapshot_date, source_url, source_etag, source_last_modified,
             size_bytes, sha256, archived_at
        FROM asr_zip_archive
       ORDER BY snapshot_date DESC
    `);
    res.json({ count: r.rowCount, archives: r.rows });
  } catch (e){
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/asr/archive/:date', async (req, res) => {
  const date = String(req.params.date).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)){
    return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
  }
  try {
    const r = await pool.query(
      `SELECT zip_data, size_bytes, sha256, source_etag, archived_at
         FROM asr_zip_archive WHERE snapshot_date = $1`,
      [date]
    );
    if (r.rowCount === 0){
      return res.status(404).json({ error: `no archive for snapshot_date ${date} (rolling 4-week window)` });
    }
    const row = r.rows[0];
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', row.size_bytes);
    res.setHeader('Content-Disposition', `attachment; filename="r_tower-${date}.zip"`);
    res.setHeader('X-Snapshot-Date', date);
    res.setHeader('X-Source-Etag', row.source_etag || '');
    res.setHeader('X-SHA256', row.sha256);
    res.send(row.zip_data);
  } catch (e){
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/asr/by-number/:asr', async (req, res) => {
  const asr = String(req.params.asr).trim();
  if (!/^\d+$/.test(asr)){
    return res.status(400).json({ available: false, error: 'asr_number must be numeric' });
  }
  try {
    const r = await pool.query(`SELECT * FROM asr_towers WHERE asr_number = $1 LIMIT 1`, [asr]);
    if (r.rows.length){
      return res.json(rowToRecord(r.rows[0], 1));
    }
  } catch (e){
    console.warn('[asr-sidecar] tier-1 query failed:', e.message);
  }
  if (process.env.ASR_DISABLE_HTML_FALLBACK === '1'){
    return res.json({ available: false, source: 'asr-sidecar', error: 'not in bulk DB; tier-4 disabled' });
  }
  const fallback = await htmlScrapeFallback(asr);
  return res.json(fallback);
});

app.get('/asr/by-location', async (req, res) => {
  const lat      = parseFloat(req.query.lat);
  const lon      = parseFloat(req.query.lon);
  // Cap raised from 25 km to 200 km so the asrClient ladder can fall
  // through to a wide net when LMS antenna coords drift from the
  // registered ASR tower coords.  Engineer of record verifies the
  // match before filing anyway; a wider search beats EVIDENCE MISSING
  // on a tower that actually exists.
  const radius_m = Math.min(parseFloat(req.query.radius_m) || 1000, 200_000);
  const limit    = Math.min(parseInt(req.query.limit, 10) || 1, 25);
  // FCC ULS r_tower.zip uses single-letter codes ('C' Constructed,
  // 'G' Granted, 'N' Notified, 'T' Terminated, 'W' Withdrawn,
  // 'X' Cancelled).  Operator can disable the filter via
  // ?include_inactive=1 for diagnostics.
  const includeInactive = req.query.include_inactive === '1';
  if (!Number.isFinite(lat) || !Number.isFinite(lon)){
    return res.status(400).json({ available: false, error: 'lat / lon required' });
  }
  const dLat = radius_m / 111_320;
  const dLon = radius_m / (111_320 * Math.cos(lat * Math.PI / 180));
  try {
    const statusClause = includeInactive
      ? ''
      : `AND (status IS NULL OR status NOT IN ('TERMINATED','CANCELLED','WITHDRAWN','T','X','W'))`;
    const r = await pool.query(`
      SELECT *,
             6371000 * 2 * ASIN(SQRT(
                 POWER(SIN(RADIANS(latitude_deg - $1)/2), 2)
               + COS(RADIANS($1)) * COS(RADIANS(latitude_deg))
               * POWER(SIN(RADIANS(longitude_deg - $2)/2), 2)
             )) AS distance_m
      FROM asr_towers
      WHERE latitude_deg  BETWEEN $1 - $3 AND $1 + $3
        AND longitude_deg BETWEEN $2 - $4 AND $2 + $4
        ${statusClause}
      ORDER BY distance_m ASC
      LIMIT $5
    `, [lat, lon, dLat, dLon, limit]);

    if (r.rows.length === 0){
      return res.json({ available: false, source: 'asr-sidecar', error: `no ASR record within ${radius_m} m of ${lat},${lon}` });
    }
    const inside = r.rows.filter(row => row.distance_m <= radius_m);
    if (inside.length === 0){
      return res.json({ available: false, source: 'asr-sidecar', error: `no ASR record within ${radius_m} m (closest was ${Math.round(r.rows[0].distance_m)} m)` });
    }
    if (limit === 1){
      const rec = rowToRecord(inside[0], 1);
      rec.distance_m = Math.round(inside[0].distance_m);
      return res.json(rec);
    }
    return res.json({
      available: true,
      source:    'asr-sidecar-tier1',
      source_tier: 1,
      n:          inside.length,
      records:    inside.map(row => {
        const rec = rowToRecord(row, 1);
        rec.distance_m = Math.round(row.distance_m);
        return rec;
      })
    });
  } catch (e){
    console.error('[asr-sidecar] tier-1 location query failed:', e);
    return res.status(500).json({ available: false, error: String(e.message) });
  }
});

// ─── Diagnostic endpoints ─────────────────────────────────────────────
//
// /asr/diag/nearest?lat&lon&n=5
//   Returns the N nearest towers to (lat,lon) — no radius cap, no
//   status filter — so the operator can see how far the closest
//   registered tower really is when by-location returns empty.  Used to
//   debug "why doesn't this site find a tower?" cases.
//
// /asr/diag/by-state?state=VA
//   Counts asr_towers grouped by status for a US state, plus a sample
//   of the most-recent rows.  Used to verify the bulk DB has data for
//   the state we expect.
app.get('/asr/diag/nearest', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  const n   = Math.min(parseInt(req.query.n, 10) || 5, 25);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)){
    return res.status(400).json({ error: 'lat / lon required' });
  }
  try {
    const r = await pool.query(`
      SELECT asr_number, status, structure_type, structure_state, structure_city, owner_name,
             latitude_deg, longitude_deg, overall_height_agl_m,
             6371000 * 2 * ASIN(SQRT(
                 POWER(SIN(RADIANS(latitude_deg - $1)/2), 2)
               + COS(RADIANS($1)) * COS(RADIANS(latitude_deg))
               * POWER(SIN(RADIANS(longitude_deg - $2)/2), 2)
             )) AS distance_m
      FROM asr_towers
      WHERE latitude_deg  BETWEEN $1 - 5 AND $1 + 5
        AND longitude_deg BETWEEN $2 - 5 AND $2 + 5
      ORDER BY distance_m ASC
      LIMIT $3
    `, [lat, lon, n]);
    res.json({
      query:  { lat, lon, n },
      n:      r.rows.length,
      towers: r.rows.map(row => ({
        ...row,
        distance_m:  Math.round(row.distance_m),
        distance_km: Number((row.distance_m / 1000).toFixed(2))
      }))
    });
  } catch (e){
    res.status(500).json({ error: String(e.message) });
  }
});

app.get('/asr/diag/by-state', async (req, res) => {
  const state = String(req.query.state || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)){
    return res.status(400).json({ error: 'state required (2-letter code)' });
  }
  try {
    const counts = await pool.query(
      `SELECT status, COUNT(*) AS n FROM asr_towers WHERE structure_state = $1 GROUP BY status ORDER BY n DESC`,
      [state]
    );
    const sample = await pool.query(
      `SELECT asr_number, status, structure_type, structure_city, owner_name,
              latitude_deg, longitude_deg, overall_height_agl_m
         FROM asr_towers
        WHERE structure_state = $1
        ORDER BY date_action DESC NULLS LAST
        LIMIT 10`,
      [state]
    );
    const total = await pool.query(
      `SELECT COUNT(*) AS n FROM asr_towers WHERE structure_state = $1`,
      [state]
    );
    res.json({
      state,
      total:        Number(total.rows[0]?.n || 0),
      by_status:    counts.rows.map(r => ({ status: r.status, n: Number(r.n) })),
      sample:       sample.rows
    });
  } catch (e){
    res.status(500).json({ error: String(e.message) });
  }
});

(async () => {
  try {
    await ensureSchema();
    await maybeRunBulkLoad();
    scheduleWeeklyRefresh();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`[asr-sidecar] listening on 0.0.0.0:${PORT}`);
    });
  } catch (e){
    console.error('[asr-sidecar] boot failed:', e);
    process.exit(1);
  }
})();
