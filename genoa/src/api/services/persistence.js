// Exhibit persistence.  Wraps Postgres queries; gracefully returns
// structured 'not configured' errors when DATABASE_URL is missing.

import { pool, poolReady } from '../../db/pool.js';

export class PersistenceUnavailable extends Error {
  constructor(){ super('database not configured'); this.code = 'DB_UNAVAILABLE'; this.http_status = 503; }
}

function need(){
  if (!poolReady()) throw new PersistenceUnavailable();
  return pool();
}

export async function saveExhibit(exhibit){
  const p = need();
  const s  = exhibit.station_inputs || {};
  const fr = exhibit.filing_readiness || {};
  // Transactional save — exhibit + initial version + all warning_event
  // rows commit together or roll back together.  Previously each query
  // ran on the pool (auto-commit), so a crash between INSERT genoa_exhibit
  // and INSERT genoa_exhibit_version left an orphan exhibit row with no
  // version; a crash during the warning loop left a partial warning set.
  // Warning rows are also batched into a single multi-row INSERT to drop
  // 6–15 SSL round-trips per exhibit (~80–300 ms).
  const client = await p.connect();
  try {
    await client.query('BEGIN');

    const r = await client.query(
      `INSERT INTO genoa_exhibit
         (call_sign, facility_id, service, frequency, erp_kw, haat_m,
          lat, lon, method, schema_name, schema_version,
          filing_score, filing_status, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id, created_at`,
      [
        s.call || null, s.facility_id || null, s.service || null,
        s.frequency || null, s.erp_kw || null, s.haat_m_input || null,
        s.lat || null, s.lon || null,
        exhibit.calculation_method?.name || null,
        exhibit.schema?.name || null, exhibit.schema?.version || null,
        fr.score ?? null, fr.status || null,
        exhibit
      ]
    );
    const exhibitId = r.rows[0].id;

    await client.query(
      `INSERT INTO genoa_exhibit_version (exhibit_id, version_no, payload)
       VALUES ($1, 1, $2)`,
      [exhibitId, exhibit]
    );

    const warnings = Array.isArray(exhibit.warnings) ? exhibit.warnings : [];
    if (warnings.length > 0){
      // One round-trip for all warnings via $N-per-column multi-row INSERT.
      const cols    = ['exhibit_id', 'code', 'severity', 'phase', 'detail'];
      const values  = [];
      const tuples  = [];
      let i = 1;
      for (const w of warnings){
        values.push(exhibitId, w.code || null, w.severity || null,
                    w.phase || null, w.detail || null);
        tuples.push(`($${i++},$${i++},$${i++},$${i++},$${i++})`);
      }
      await client.query(
        `INSERT INTO genoa_warning_event (${cols.join(',')})
         VALUES ${tuples.join(',')}`,
        values
      );
    }

    await client.query('COMMIT');
    return { id: exhibitId, created_at: r.rows[0].created_at };
  } catch (e){
    try { await client.query('ROLLBACK'); } catch { /* best-effort */ }
    throw e;
  } finally {
    client.release();
  }
}

export async function listExhibits({ limit = 100 } = {}){
  const p = need();
  const r = await p.query(
    `SELECT id, call_sign, facility_id, service, frequency, erp_kw, haat_m,
            method, filing_score, filing_status, created_at
       FROM genoa_exhibit
      ORDER BY created_at DESC
      LIMIT $1`,
    [Math.min(500, Math.max(1, limit))]
  );
  return r.rows;
}

export async function getExhibit(id){
  const p = need();
  const r = await p.query(`SELECT * FROM genoa_exhibit WHERE id = $1`, [id]);
  return r.rows[0] || null;
}
