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
  const r = await p.query(
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

  await p.query(
    `INSERT INTO genoa_exhibit_version (exhibit_id, version_no, payload)
     VALUES ($1, 1, $2)`,
    [exhibitId, exhibit]
  );

  // Warning event log
  for (const w of exhibit.warnings || []){
    await p.query(
      `INSERT INTO genoa_warning_event (exhibit_id, code, severity, phase, detail)
       VALUES ($1,$2,$3,$4,$5)`,
      [exhibitId, w.code, w.severity, w.phase || null, w.detail || null]
    );
  }
  return { id: exhibitId, created_at: r.rows[0].created_at };
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
