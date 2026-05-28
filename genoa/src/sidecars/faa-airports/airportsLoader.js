// FAA-airports bulk loader.
//
// Pulls two CSVs from OurAirports.com (free, MIT-licensed redistribution
// of FAA NASR + ICAO sources):
//
//   airports.csv  ~10 MB, ~80k worldwide entries
//   runways.csv   ~10 MB, ~50k runway records
//
// Joins runways → airports on airport_ref, computes longest_runway_ft
// per airport, filters to scope (US public-use), bulk-INSERTs into
// faa_airports.
//
// Same chunking strategy as asr/ulsBulkLoader.js: BATCH = 2000 rows ×
// ~17 columns = 34,000 params, well under Postgres's 65,535-param Bind
// limit.  TRUNCATE + COPY-equivalent so the table holds the freshest
// snapshot at all times.
//
// CSV parser is hand-rolled (no dep) — OurAirports CSVs are RFC-4180
// quoted commas with no embedded newlines, so a line-by-line split +
// quote-aware field tokenizer is sufficient.

import { createHash } from 'node:crypto';

const AIRPORTS_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const RUNWAYS_URL  = 'https://davidmegginson.github.io/ourairports-data/runways.csv';

const ACCEPTED_TYPES = new Set([
  'small_airport',
  'medium_airport',
  'large_airport',
  'heliport'
]);

const FT_PER_M = 3.280839895;
const BATCH    = 2000;

// ── CSV row tokenizer ─────────────────────────────────────
// Handles quoted fields with embedded commas: "ALOHA, OR"
function parseCsvLine(line){
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++){
    const c = line[i];
    if (inQuotes){
      if (c === '"' && line[i+1] === '"'){ cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function csvToObjects(text){
  const lines = text.split(/\r?\n/).filter(l => l.length);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++){
    const fields = parseCsvLine(lines[i]);
    if (fields.length < headers.length) continue;
    const o = {};
    for (let j = 0; j < headers.length; j++) o[headers[j]] = fields[j];
    rows.push(o);
  }
  return rows;
}

// ── HTTP helper with redirect follow + ETag capture ─────────────
async function fetchCsv(url, log){
  log.info?.(`[airports-loader] GET ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  const buf  = Buffer.from(await res.arrayBuffer());
  const etag = res.headers.get('etag') || null;
  return { body: buf, etag };
}

// ── Loader entry point ───────────────────────────────────
export async function runBulkLoad(pool, log = console){
  const t0 = Date.now();
  log.info?.('[airports-loader] starting bulk load');

  const apt = await fetchCsv(AIRPORTS_URL, log);
  const rwy = await fetchCsv(RUNWAYS_URL,  log);
  log.info?.(`[airports-loader] downloaded airports=${apt.body.length}B runways=${rwy.body.length}B`);

  const airports = csvToObjects(apt.body.toString('utf8'));
  const runways  = csvToObjects(rwy.body.toString('utf8'));
  log.info?.(`[airports-loader] parsed airports=${airports.length} runways=${runways.length}`);

  // Build longest-runway lookup keyed by airport id.
  const longestByAirportRef = new Map();
  const lightedByAirportRef = new Map();
  for (const r of runways){
    const ref = r.airport_ref;
    if (!ref) continue;
    const lengthFt = Number(r.length_ft);
    if (Number.isFinite(lengthFt) && lengthFt > 0){
      const cur = longestByAirportRef.get(ref) || 0;
      if (lengthFt > cur) longestByAirportRef.set(ref, lengthFt);
    }
    if (r.lighted === '1') lightedByAirportRef.set(ref, true);
  }

  // Filter + project airport rows.
  const rows = [];
  let nUS = 0, nHeli = 0;
  for (const a of airports){
    if (!ACCEPTED_TYPES.has(a.type)) continue;
    const lat = Number(a.latitude_deg);
    const lon = Number(a.longitude_deg);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const longestFt = longestByAirportRef.get(a.id) || null;
    const longestM  = longestFt != null ? longestFt / FT_PER_M : null;
    if (a.iso_country === 'US') nUS++;
    if (a.type === 'heliport')  nHeli++;
    rows.push([
      a.id,
      a.ident || null,
      a.iata_code || null,
      a.local_code || null,
      a.gps_code || null,
      a.type,
      a.name || null,
      lat,
      lon,
      Number.isFinite(Number(a.elevation_ft)) ? Number(a.elevation_ft) : null,
      a.iso_country || null,
      a.iso_region || null,
      a.municipality || null,
      a.scheduled_service || 'no',
      longestFt,
      longestM,
      lightedByAirportRef.has(a.id) || false,
      new Date().toISOString().slice(0, 10)
    ]);
  }
  log.info?.(`[airports-loader] kept ${rows.length} rows (US=${nUS}, heliports=${nHeli})`);

  // ── Bulk insert ──
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE faa_airports');

    const cols = [
      'airport_id', 'ident', 'iata_code', 'local_code', 'gps_code',
      'type', 'name', 'latitude_deg', 'longitude_deg', 'elevation_ft',
      'iso_country', 'iso_region', 'municipality', 'scheduled_service',
      'longest_runway_ft', 'longest_runway_m', 'has_lighted_rwy',
      'source_csv_date'
    ];
    const colsSql = cols.join(', ');
    const nCols = cols.length;
    let inserted = 0, batch = 0;
    for (let i = 0; i < rows.length; i += BATCH){
      const slice = rows.slice(i, i + BATCH);
      const params = slice.flat();
      const valuesSql = slice.map((_, k) => {
        const base = k * nCols;
        return '(' + Array.from({length: nCols}, (_, j) => `$${base + j + 1}`).join(', ') + ')';
      }).join(', ');
      await client.query(`INSERT INTO faa_airports (${colsSql}) VALUES ${valuesSql}`, params);
      inserted += slice.length;
      batch++;
    }
    log.info?.(`[airports-loader] inserted ${inserted} rows in ${batch} batches`);

    // Update load_state.
    const dur = (Date.now() - t0) / 1000;
    await client.query(`
      UPDATE faa_airports_load_state SET
        records_total    = $1,
        records_us       = $2,
        records_heliport = $3,
        last_loaded_at   = NOW(),
        last_source_url  = $4,
        last_etag        = $5,
        load_duration_seconds = $6,
        load_error       = NULL
      WHERE id = 1
    `, [rows.length, nUS, nHeli, AIRPORTS_URL, apt.etag, dur]);

    // ── Archive raw CSVs (rolling 4-week) ──
    const today = new Date().toISOString().slice(0, 10);
    const sha = createHash('sha256').update(apt.body).update(rwy.body).digest('hex');
    await client.query(`
      INSERT INTO faa_airports_archive
        (snapshot_date, source_url, source_etag, airports_csv, runways_csv, size_bytes, sha256)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (snapshot_date) DO UPDATE SET
        source_url = EXCLUDED.source_url,
        source_etag = EXCLUDED.source_etag,
        airports_csv = EXCLUDED.airports_csv,
        runways_csv = EXCLUDED.runways_csv,
        size_bytes = EXCLUDED.size_bytes,
        sha256 = EXCLUDED.sha256,
        archived_at = NOW()
    `, [today, AIRPORTS_URL, apt.etag, apt.body, rwy.body, apt.body.length + rwy.body.length, sha]);

    await client.query(`
      DELETE FROM faa_airports_archive
       WHERE archived_at < NOW() - INTERVAL '28 days'
    `);

    await client.query('COMMIT');
    return {
      records_total:    rows.length,
      records_us:       nUS,
      records_heliport: nHeli,
      duration_seconds: dur
    };
  } catch (err){
    await client.query('ROLLBACK').catch(() => {});
    log.error?.('[airports-loader] failed:', err);
    await pool.query(
      'UPDATE faa_airports_load_state SET load_error = $1 WHERE id = 1',
      [String(err.message)]
    ).catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
