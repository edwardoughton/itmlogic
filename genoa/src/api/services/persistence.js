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
            lat, lon, method, filing_score, filing_status, created_at
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

// Merged §73.333 contour polygons from the LATEST saved exhibit per
// station, as one GeoJSON FeatureCollection for the live map.  Each
// feature already carries [lon,lat] Polygon geometry + properties
// (contour_id, field_strength_dbu, call).  No recompute — read straight
// from saved exhibit payloads.
export async function listExhibitContours({ limit = 300, exhibitId = null } = {}){
  const p = need();
  // One specific saved report (the picker), or the latest per station.
  const r = exhibitId
    ? await p.query(
        `SELECT call_sign, payload->'geojson' AS geojson
           FROM genoa_exhibit WHERE id = $1`,
        [exhibitId])
    : await p.query(
        `SELECT DISTINCT ON (call_sign) call_sign, payload->'geojson' AS geojson
           FROM genoa_exhibit
          WHERE call_sign IS NOT NULL
            AND payload -> 'geojson' -> 'features' IS NOT NULL
          ORDER BY call_sign, created_at DESC
          LIMIT $1`,
        [Math.min(2000, Math.max(1, limit))]);
  const features = [];
  for (const row of r.rows){
    const fc = row.geojson;
    if (!fc || !Array.isArray(fc.features)) continue;
    for (const f of fc.features){
      if (!f?.geometry) continue;
      features.push({
        ...f,
        properties: { ...(f.properties || {}), call: f.properties?.call || row.call_sign }
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

// FCC §73.190 Figure M3 ground-conductivity boundary segments within a
// bbox, as a GeoJSON LineString FeatureCollection carrying m3_value (σ).
// The corpus is imported as boundary LINESTRINGs (zones not reconstructed),
// which is also how the FCC M3 map is drawn — σ contours.  Degrades to an
// empty collection when the table isn't present/imported (never throws).
export async function listConductivityLines({ bbox, limit = 6000 } = {}){
  const p = need();
  if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some(v => !Number.isFinite(v))){
    return { type: 'FeatureCollection', features: [] };
  }
  const [w, s, e, n] = bbox;
  // Table name is operator config (env), never user input — safe to inline.
  const table = (process.env.GEODATA_M3_TABLE || 'm3_conductivity').replace(/[^a-zA-Z0-9_."]/g, '');
  let r;
  try {
    r = await p.query(
      `SELECT m3_value, ST_AsGeoJSON(geom) AS gj
         FROM ${table}
        WHERE geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
        LIMIT $5`,
      [w, s, e, n, Math.min(20000, Math.max(1, limit))]);
  } catch {
    // Table missing / corpus not imported / PostGIS absent → empty overlay.
    return { type: 'FeatureCollection', features: [] };
  }
  const features = [];
  for (const row of r.rows){
    let geom;
    try { geom = JSON.parse(row.gj); } catch { continue; }
    if (!geom) continue;
    features.push({
      type: 'Feature', geometry: geom,
      properties: { m3_value: row.m3_value != null ? Number(row.m3_value) : null }
    });
  }
  return { type: 'FeatureCollection', features };
}
// GeoJSON FeatureCollection: the subject station, every nearby same/
// adjacent-channel primary (Point), and a conflict link (LineString) from
// the subject to each station that fails ALL applicable rules.  Joins the
// coordinates in evidence.nearby_primaries with the per-station verdict in
// interference_study.stations (keyed by facility_id||call).  No recompute —
// read straight from the saved payload.
export async function listExhibitInterference({ exhibitId = null } = {}){
  const p = need();
  if (!exhibitId) return { type: 'FeatureCollection', features: [] };
  const r = await p.query(
    `SELECT payload->'evidence'->'nearby_primaries' AS primaries,
            payload->'interference_study'           AS study,
            call_sign, lat, lon
       FROM genoa_exhibit WHERE id = $1`,
    [exhibitId]);
  const row = r.rows[0];
  if (!row) return { type: 'FeatureCollection', features: [] };

  const primaries = Array.isArray(row.primaries) ? row.primaries : [];
  const study     = row.study || {};
  const verdict   = new Map();
  for (const s of (Array.isArray(study.stations) ? study.stations : [])){
    const k = String(s.facility_id ?? s.call ?? '');
    if (k) verdict.set(k, s);
  }

  // Subject coordinates: prefer interference_study.subject, fall back to
  // the exhibit's own lat/lon columns.
  const subj  = study.subject || {};
  const subjLat = Number.isFinite(Number(subj.lat)) ? Number(subj.lat) : Number(row.lat);
  const subjLon = Number.isFinite(Number(subj.lon)) ? Number(subj.lon) : Number(row.lon);
  const haveSubj = Number.isFinite(subjLat) && Number.isFinite(subjLon);

  const features = [];
  if (haveSubj){
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [subjLon, subjLat] },
      properties: {
        role: 'subject',
        call: subj.call || row.call_sign || null,
        fcc_class: subj.fcc_class ?? null,
        frequency_mhz: subj.frequency_mhz ?? null,
        frequency_khz: subj.frequency_khz ?? null
      }
    });
  }

  for (const n of primaries){
    const lat = Number(n.lat), lon = Number(n.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const v = verdict.get(String(n.facility_id ?? n.call ?? '')) || null;
    const conflict = v ? v.pass_overall === false : false;
    const props = {
      role: 'neighbor',
      call: n.call ?? null,
      service: n.service ?? null,
      fcc_class: n.fcc_class ?? null,
      frequency_mhz: n.frequency_mhz ?? null,
      frequency_khz: n.frequency_khz ?? null,
      distance_km: n.distance_km ?? v?.distance_km ?? null,
      channel_relationship: n.channel_relationship ?? v?.channel_relationship ?? null,
      conflict,
      qualified_via: Array.isArray(v?.qualified_via) && v.qualified_via.length ? v.qualified_via.join(', ') : null,
      failed_rules:  Array.isArray(v?.failed_rules)  && v.failed_rules.length  ? v.failed_rules.join(', ')  : null
    };
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: props
    });
    // Conflict link — only for stations that fail every applicable rule.
    if (haveSubj && conflict){
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[subjLon, subjLat], [lon, lat]] },
        properties: { role: 'conflict-link', call: props.call, channel_relationship: props.channel_relationship }
      });
    }
  }
  return { type: 'FeatureCollection', features };
}
