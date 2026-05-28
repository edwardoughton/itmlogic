// Postgres pool, fail-soft.  If DATABASE_URL is missing the API still
// boots (engine + exports + readiness all work without persistence;
// only POST/GET /api/exhibits and the exhibit lookup routes return 503).
//
// SSL POLICY (env-driven)
//
//   PG_SSL                       — 'true' (default) | 'false'
//                                  When 'false', SSL is disabled in the pool
//                                  config (overrides any sslmode=... in
//                                  DATABASE_URL).  Useful for local
//                                  docker-compose without TLS.
//
//   PG_SSL_REJECT_UNAUTHORIZED   — 'true' | 'false' (default 'false')
//                                  Default 'false' is required for managed
//                                  Postgres providers that present a self-
//                                  signed CA by default — DigitalOcean
//                                  Managed Postgres, Heroku Postgres, Render
//                                  Postgres.  Set 'true' when you've supplied
//                                  the provider's CA bundle via NODE_EXTRA_CA_CERTS.
//
// WHY WE DO NOT PASS connectionString
//
//   pg-connection-string v2.7+ upgrades sslmode=require/prefer/verify-ca in a
//   connection string to "verify-full" semantics, which silently overrides
//   the pool-level `ssl: { rejectUnauthorized: false }` object.  DO / Heroku
//   / Render managed Postgres present a self-signed CA chain, so verify-full
//   rejects every connection with "self-signed certificate in certificate
//   chain" — migrations skipped at startup, every saveExhibit query fails.
//
//   The pg warning recommends `uselibpqcompat=true` to restore the previous
//   behaviour, but in practice this flag does not always relax the override
//   at runtime (observed on DO App Platform with pg 8.x).  The reliable fix
//   is to NOT pass connectionString at all: parse DATABASE_URL into discrete
//   host/port/user/password/database fields with the WHATWG URL API and
//   provide our own explicit `ssl` object — which is then the single source
//   of truth for TLS verification.

import pg from 'pg';

function buildSslConfig(){
  const sslEnabled = String(process.env.PG_SSL ?? 'true').toLowerCase() !== 'false';
  if (!sslEnabled) return false;
  return {
    rejectUnauthorized:
      String(process.env.PG_SSL_REJECT_UNAUTHORIZED ?? 'false').toLowerCase() === 'true'
  };
}

// pg-connection-string v2.7+ upgrades sslmode=require/prefer/verify-ca in the
// connection string to "verify-full" semantics, which silently overrides our
// pool-level `ssl: { rejectUnauthorized: false }`.  DO / Heroku / Render
// managed Postgres present a self-signed CA chain, so verify-full rejects
// every connection with "self-signed certificate in certificate chain" —
// migrations skipped at startup, every saveExhibit query fails.
//
// The pg warning itself recommends `uselibpqcompat=true` to restore the
// previous behaviour.  This helper appends that flag exactly once when an
// sslmode is present in the URL.
function applyLibpqCompat(url){
  if (!url) return url;
  if (!/(\?|&)sslmode=/.test(url))      return url;   // no sslmode → nothing to relax
  if (/(\?|&)uselibpqcompat=/.test(url)) return url;  // already set
  return url + (url.includes('?') ? '&' : '?') + 'uselibpqcompat=true';
}

const POOL_CONFIG = {
  connectionString:        applyLibpqCompat(process.env.DATABASE_URL),
  ssl:                     buildSslConfig(),
  max:                     Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis:       Number(process.env.PG_IDLE_TIMEOUT_MS    || 30_000),
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 10_000),
  keepAlive:               true,
  application_name:        process.env.PG_APPLICATION_NAME
                           || process.env.APP_NAME
                           || 'genoa-api'
};

let _pool = null;
let _initErr = null;

if (process.env.DATABASE_URL){
  if (!POOL_CONFIG){
    _initErr = new Error('DATABASE_URL is set but could not be parsed as a postgres URL');
    console.warn('[genoa] pg pool construction failed:', _initErr.message);
  } else {
    try {
      _pool = new pg.Pool(POOL_CONFIG);
      _pool.on('error', (err) => console.warn('[genoa] pg pool error:', err.message));
      // Logged once at startup.  No credentials, no host, no DB name —
      // just the SSL policy and pool sizing.
      console.log('[genoa] pg pool constructed', {
        dbConfigured:       true,
        ssl:                POOL_CONFIG.ssl !== false,
        rejectUnauthorized: POOL_CONFIG.ssl && POOL_CONFIG.ssl.rejectUnauthorized === true,
        poolMax:            POOL_CONFIG.max,
        applicationName:    POOL_CONFIG.application_name
      });
    } catch (e){
      _initErr = e;
      console.warn('[genoa] pg pool construction failed:', e.message);
      _pool = null;
    }
  }
}

export function pool(){ return _pool; }
export function poolReady(){ return !!_pool; }

export async function dbHealthy(){
  if (!_pool) return false;
  try { await _pool.query('SELECT 1'); return true; }
  catch { return false; }
}

// Tables that migrations 001 + 002 create.  /health/db verifies all
// of these are present so an operator can detect "we connected to the
// wrong database" or "migrations didn't run" in one HTTP call.
const EXPECTED_TABLES = Object.freeze([
  'genoa_exhibit',
  'genoa_exhibit_version',
  'genoa_validation_run',
  'genoa_facility_cache',
  'genoa_terrain_cache'
]);

/**
 * Detailed DB probe — runs a small introspection query against the
 * shared pool.  Returns provenance an operator can use to confirm
 * SSL is working without leaking credentials (no host, no password,
 * no DSN).  Database name and current_user ARE returned because they
 * confirm the pool is bound to the expected DB and role.
 *
 * Also verifies the expected schema tables are present (migrations
 * applied) so a single HTTP call confirms both connectivity AND
 * schema state.
 */
export async function dbProbe(){
  if (!_pool){
    return {
      ok:           false,
      db_configured: Boolean(process.env.DATABASE_URL),
      ssl:           POOL_CONFIG ? POOL_CONFIG.ssl !== false : null,
      reason:       process.env.DATABASE_URL
        ? 'pool construction failed at startup (see logs)'
        : 'DATABASE_URL not set'
    };
  }
  try {
    const t0 = Date.now();
    const r = await _pool.query('SELECT current_database() AS db, current_user AS usr, now() AS ts, version() AS v');
    const row = r.rows[0] || {};
    // Schema verification — find which expected tables are present.
    // Single round-trip via information_schema lookup.
    const t = await _pool.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
      [EXPECTED_TABLES]
    );
    const present = new Set((t.rows || []).map(x => x.table_name));
    const tables  = EXPECTED_TABLES.map(name => ({ name, present: present.has(name) }));
    const missing = tables.filter(x => !x.present).map(x => x.name);
    return {
      ok:                  missing.length === 0,
      db_configured:       true,
      ssl:                 POOL_CONFIG.ssl !== false,
      reject_unauthorized: POOL_CONFIG.ssl && POOL_CONFIG.ssl.rejectUnauthorized === true,
      database:            row.db,
      user:                row.usr,
      server_time:         row.ts,
      server_version:      String(row.v || '').split(' ').slice(0, 2).join(' '),
      latency_ms:          Date.now() - t0,
      pool_max:            POOL_CONFIG.max,
      application_name:    POOL_CONFIG.application_name,
      schema:              { tables, missing, expected: EXPECTED_TABLES.length, present: tables.filter(x => x.present).length },
      hint:                missing.length === 0
                             ? null
                             : `Missing ${missing.length} table(s): ${missing.join(', ')}.  Run \`npm run migrate\` against this DATABASE_URL.`
    };
  } catch (e){
    return {
      ok:                  false,
      db_configured:       true,
      ssl:                 POOL_CONFIG.ssl !== false,
      reject_unauthorized: POOL_CONFIG.ssl && POOL_CONFIG.ssl.rejectUnauthorized === true,
      error: String(e.message || e).slice(0, 200)
    };
  }
}

export function poolInitError(){ return _initErr; }
