// FCC Antenna Structure Registration (ASR) cross-check client.
//
// SCOPE
//   Every antenna structure subject to FAA/FCC review (typically
//   towers > 60 m AGL or near airports) must be registered in the
//   FCC's Antenna Structure Registration database under 47 CFR
//   §17.4.  An FCC application that uses a tower MUST cite the
//   tower's ASR number and the registered values must agree with
//   the application's antenna data: tower lat/lon, overall height
//   AGL, height AMSL, lighting and painting requirements.
//
//   This client looks up an ASR record by registration number OR
//   geographic proximity to a (lat, lon), normalizes the result, and
//   surfaces it as `evidence.asr`.  Mismatches between the
//   application's data and the ASR record raise warnings.
//
// SOURCES (multi-tier, same fallback pattern as facilityClient)
//
//   1. ZTR rich-station response — many station records carry an
//      `asr_number` and a copy of the registered tower data on
//      `_tower` or `tower` field.  This is fastest.
//
//   2. opendata.fcc.gov Socrata — the FCC publishes the full ASR
//      database as a public Socrata dataset (default
//      https://opendata.fcc.gov/resource/wzue-cz5e.json).  No auth
//      required; an X-App-Token raises rate limits but is optional.
//      This is the recommended programmatic source.
//
//   3. ASR_SIDECAR_URL operator-managed sidecar — operator runs
//      their own ASR proxy (e.g., the chelstein/asr-bridge sidecar)
//      that talks to FCC ULS and returns clean JSON.  Useful for
//      caching / bulk lookups in front of the public Socrata API.
//
//   4. FCC ASR HTML — https://wireless2.fcc.gov/UlsApp/AsrSearch/
//      No public JSON API at the legacy URL; the search endpoint
//      serves HTML.  The adapter scrapes the published HTML table
//      when the user explicitly opts in via ASR_HTML_FALLBACK=1
//      (off by default to avoid HTML-scrape brittleness).
//
// CROSS-CHECK FIELDS
//   The §17.4 application data the orchestrator can verify against
//   the ASR record:
//
//     asr_number              — registration number (string)
//     latitude_deg, longitude_deg
//     overall_height_m        — height of structure above ground
//     overall_height_agl_m    — alias for overall_height_m
//     overall_height_amsl_m   — height above mean sea level (AMSL)
//     ground_elevation_m      — site elevation
//     lighting_requirement    — FAA Form 7460 lighting type
//     painting_requirement    — FAA Form 7460 painting requirement
//     owner                   — registered tower owner
//     status                  — ACTIVE, GRANTED, DISMISSED, etc.
//     faa_study_number        — links to FAA OE/AAA determination
//
// OUTPUT SHAPE
//   {
//     available: bool,
//     source:    'zerotrustradio' | 'fcc-opendata-socrata' | 'asr-sidecar' | 'fcc-uls-html' | null,
//     endpoint, fetched_at,
//     asr_number, latitude_deg, longitude_deg, overall_height_m,
//     overall_height_amsl_m, ground_elevation_m,
//     lighting_requirement, painting_requirement, owner, status,
//     faa_study_number,
//     // Cross-check details (filled by checkAsrAgainstApplication)
//     cross_check?: { matches, mismatches: [...] }
//   }

const DEFAULT_TIMEOUT_MS  = 8_000;
// HISTORICAL — the FCC retired the Socrata ASR mirror at wzue-cz5e
// (returns 404 as of 2026-05).  Default is now null; canonical
// resolution path is genoa-asr-sidecar (ASR_SIDECAR_URL) which loads
// FCC ULS r_tower.zip weekly into Postgres + adds REC Networks
// API tier-3 fallback.  Operator can still pin a working Socrata
// dataset by setting ASR_SOCRATA_URL explicitly if one becomes
// available again.
const DEFAULT_SOCRATA_URL = null;

export function makeAsrClient({
  ztrUrl    = process.env.ZERO_TRUST_RADIO_READONLY_URL || null,
  socrataUrl     = process.env.ASR_SOCRATA_URL     || (process.env.ASR_SOCRATA_DISABLE === '1' ? null : DEFAULT_SOCRATA_URL),
  socrataAppToken = process.env.ASR_SOCRATA_APP_TOKEN || null,
  asrSidecarUrl = process.env.ASR_SIDECAR_URL || null,
  htmlFallback  = process.env.ASR_HTML_FALLBACK === '1',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn   = (typeof fetch === 'function' ? fetch : null)
} = {}){
  if (!ztrUrl && !asrSidecarUrl && !htmlFallback && !socrataUrl) return null;
  if (!fetchFn) return null;

  // Surfaces a primary baseUrl for /readyz UI tooltips.  Sidecar
  // first now that Socrata is dead by default.
  const baseUrl = asrSidecarUrl || socrataUrl || null;

  // Liveness probe for /readyz.  Probes genoa-asr-sidecar /healthz
  // first (canonical path), falls through to Socrata only if the
  // sidecar is unconfigured.  Counts ANY HTTP response (2xx-4xx) as
  // "host reachable" for Socrata — only network / DNS / TLS /
  // timeout failures register as unhealthy.
  async function health(){
    if (asrSidecarUrl){
      try {
        const r = await fetchFn(joinUrl(asrSidecarUrl, '/healthz'),
                                { signal: AbortSignal.timeout(3000) });
        if (r.ok) return true;
      } catch { /* fall through */ }
    }
    if (socrataUrl){
      try {
        const headers = socrataAppToken ? { 'X-App-Token': socrataAppToken } : {};
        const r = await fetchFn(`${socrataUrl}?$limit=1`,
                                { signal: AbortSignal.timeout(3000), headers });
        return r.status >= 200 && r.status < 600;
      } catch { return false; }
    }
    return false;
  }

  return {
    baseUrl,
    health,
    sources: {
      ztr:           !!ztrUrl,
      socrata:       !!socrataUrl,
      asr_sidecar:   !!asrSidecarUrl,
      uls_html:      htmlFallback
    },

    /**
     * Lookup ASR by explicit registration number.  Tier order:
     *   1. ASR_SIDECAR_URL (genoa-asr-sidecar) — FCC ULS r_tower.zip
     *      bulk DB (the FCC-published source of truth).  The sidecar's
     *      own internal fallback chain (tier-2 reserved → tier-3 ZTR
     *      passthrough → tier-4 REC Networks / radio-locator) means
     *      a single call here covers the full resolution chain.
     *   2. opendata.fcc.gov Socrata — historical (dataset retired 2026-05).
     *   3. FCC ULS HTML scrape (only when htmlFallback enabled).
     */
    async getByAsrNumber(asr_number){
      if (!asr_number) return { available: false, source: null, error: 'asr_number required' };
      // Tier 1: genoa-asr-sidecar /asr/by-number/:asr — already
      // includes its own internal tier-3 (REC API + REC web + radio-
      // locator) fallback so a single call covers bulk-DB → REC chain.
      if (asrSidecarUrl){
        try {
          const u = joinUrl(asrSidecarUrl, `/asr/by-number/${encodeURIComponent(asr_number)}`);
          const r = await fetchFn(u, { signal: AbortSignal.timeout(timeoutMs) });
          if (r.ok){
            const j = await r.json();
            if (j?.available) return j;
          }
        } catch { /* fall through */ }
      }
      // Tier 2: opendata.fcc.gov Socrata (only if explicitly configured).
      if (socrataUrl){
        const out = await querySocrataByNumber(asr_number, {
          socrataUrl, socrataAppToken, timeoutMs, fetchFn
        });
        if (out?.available) return out;
      }
      // Tier 3: FCC ULS HTML scrape (operator-opted-in).
      if (htmlFallback){
        return { available: false, source: null, error: 'FCC ULS HTML scraping not implemented in this build (set ASR_SOCRATA_URL or ASR_SIDECAR_URL for clean JSON access)' };
      }
      return {
        available: false, source: null,
        error: 'No ASR lookup source returned a record (Socrata empty?  Set ASR_SOCRATA_APP_TOKEN to raise rate limits, or ASR_SIDECAR_URL for an operator proxy).'
      };
    },

    /**
     * Lookup nearby antenna structures by lat/lon proximity.
     * Returns up to `limit` records within `radius_m` metres.
     * Socrata-only (the legacy ULS HTML form-search lacks a clean
     * geospatial filter; an operator proxy can also expose this).
     */
    async getByLocation({ lat, lon, radius_m = null, limit = 1 } = {}){
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))){
        return { available: false, source: null, error: 'lat / lon required' };
      }
      // 1km → 5km → 25km → 100km → 200km ladder.  The wide upper rungs
      // catch broadcast towers where FCC LMS antenna coords drift from
      // the registered ASR coords (common: LMS records antenna mounting
      // point, ASR records tower base, can differ by 50-200 m or more
      // for guyed/co-located setups).  Engineer of record verifies the
      // match before filing — wider net beats EVIDENCE MISSING.
      const ladder = radius_m ? [Number(radius_m)] : [1000, 5000, 25000, 100000, 200000];
      const tried = [];

      // Tier 1: genoa-asr-sidecar /asr/by-location.
      if (asrSidecarUrl){
        let lastSidecarError = null;
        for (const r_m of ladder){
          try {
            const u = joinUrl(asrSidecarUrl, `/asr/by-location?lat=${lat}&lon=${lon}&radius_m=${r_m}&limit=${limit}`);
            const r = await fetchFn(u, { signal: AbortSignal.timeout(timeoutMs) });
            if (r.ok){
              const j = await r.json();
              tried.push({ radius_m: r_m, available: !!j?.available, distance_m: j?.distance_m ?? null, error: j?.error || null });
              if (j?.available){
                // Annotate with the ladder so reviewers can see how
                // far we had to search to find this match.
                return { ...j, search_ladder: tried };
              }
              lastSidecarError = j?.error || null;
            } else {
              tried.push({ radius_m: r_m, http: r.status, error: 'sidecar non-2xx' });
            }
          } catch (e){
            tried.push({ radius_m: r_m, error: String(e.message || e) });
          }
        }
        // Sidecar reachable but every ring missed.  Surface the
        // FINAL ring's specific error, not the generic Tier-2 fallback
        // text.  Caller can then render NOT_REGISTERED with citation.
        if (tried.length){
          return {
            available: false,
            source: 'asr-sidecar',
            error: `no ASR record within ${ladder[ladder.length - 1]} m of ${lat},${lon}` +
                   (lastSidecarError ? ` — sidecar: ${lastSidecarError}` : ''),
            search_ladder: tried
          };
        }
      }
      // Tier 2: opendata.fcc.gov Socrata (historical).
      if (socrataUrl){
        const out = await querySocrataByLocation({
          lat: Number(lat), lon: Number(lon), radius_m: ladder[ladder.length - 1], limit,
          socrataUrl, socrataAppToken, timeoutMs, fetchFn
        });
        if (out) return { ...out, search_ladder: tried };
      }
      return {
        available: false,
        source: null,
        error: 'No ASR location-lookup source returned a record (set ASR_SIDECAR_URL to a running genoa-asr-sidecar).',
        search_ladder: tried
      };
    },

    /**
     * Extract ASR data from an already-fetched ZTR rich-station response.
     * This is the fastest path when ZTR's rich payload includes tower
     * data — we don't pay an extra HTTP round-trip.
     *
     * Defensive: ZTR has shipped tower data under several keys
     * across releases.  We try them all.
     */
    extractFromRichStation(richStationResponse){
      if (!richStationResponse?.available) {
        return { available: false, source: null, error: 'rich station response unavailable' };
      }
      const s = richStationResponse.station || {};
      // Defensive field-name lookup for ASR-shaped data.
      const asr_number = pickFirst(s,
        ['asr_number', 'asrn', 'asr_id', 'antenna_structure_registration',
         '_tower.asr_number', 'tower.asr_number', '_asr.number']);
      if (!asr_number){
        return {
          available: false, source: null, endpoint: richStationResponse.endpoint,
          error: 'ZTR rich-station response did not carry an asr_number'
        };
      }
      // Tower-data sub-object names ZTR has used.
      const tower = s._tower || s.tower || s._asr || s.asr || s;
      const lat = pickNumeric(tower, ['latitude_deg', 'latitude', 'lat']);
      const lon = pickNumeric(tower, ['longitude_deg', 'longitude', 'lon', 'lng']);
      const overall_height_m   = pickNumeric(tower, ['overall_height_m', 'overall_height_agl_m', 'height_m', 'tower_height_m', 'overall_height_above_ground_m']);
      const ground_elev_m      = pickNumeric(tower, ['ground_elevation_m', 'site_elevation_m', 'site_elev_m', 'elevation_m']);
      const overall_amsl_m     = pickNumeric(tower, ['overall_height_amsl_m', 'overall_height_above_msl_m', 'tower_top_amsl_m'])
                              ?? (Number.isFinite(overall_height_m) && Number.isFinite(ground_elev_m)
                                  ? overall_height_m + ground_elev_m : null);
      return {
        available:               true,
        source:                  'zerotrustradio',
        endpoint:                richStationResponse.endpoint,
        fetched_at:              richStationResponse.fetched_at,
        asr_number:              String(asr_number),
        latitude_deg:            lat,
        longitude_deg:           lon,
        overall_height_m,
        overall_height_amsl_m:   overall_amsl_m,
        ground_elevation_m:      ground_elev_m,
        lighting_requirement:    pickFirst(tower, ['lighting_requirement', 'lighting', 'faa_lighting', 'lighting_required']),
        painting_requirement:    pickFirst(tower, ['painting_requirement', 'painting', 'faa_painting', 'painting_required']),
        owner:                   pickFirst(tower, ['owner', 'tower_owner', 'registered_owner']),
        status:                  pickFirst(tower, ['status', 'asr_status', 'registration_status']),
        faa_study_number:        pickFirst(tower, ['faa_study_number', 'faa_study', 'faa_id', 'aeronautical_study_number'])
      };
    }
  };
}

/**
 * Compare ASR record against the application's antenna data and
 * report mismatches.  Returns the SAME `asr` record with a
 * `cross_check` block appended:
 *   { matches: bool, mismatches: [{ field, asr_value, app_value, tolerance, …}], notes }
 *
 * Tolerances chosen per FCC §17.4 / FAA Form 7460 review practice:
 *   - lat / lon: 1 second (~30 m) — the FCC application's site coordinates
 *     are typically rounded to the second; ASR records the same precision
 *   - overall_height_m: 1 m (FAA review tolerance)
 *
 * @param {object} args
 * @param {object} args.asr            normalized ASR record (from getByAsrNumber / extractFromRichStation)
 * @param {object} args.application    { lat, lon, antenna_height_m?, overall_height_m?, overall_height_amsl_m?, asr_number? }
 */
export function checkAsrAgainstApplication({ asr, application } = {}){
  if (!asr || asr.available !== true){
    return { ...asr, cross_check: { matches: null, applicable: false, reason: 'ASR record not available' } };
  }
  if (!application || typeof application !== 'object'){
    return { ...asr, cross_check: { matches: null, applicable: false, reason: 'application data missing' } };
  }
  const mismatches = [];

  // 1. ASR number cross-check (when application supplied one).
  if (application.asr_number && String(application.asr_number) !== String(asr.asr_number)){
    mismatches.push({
      field: 'asr_number',
      asr_value: asr.asr_number,
      app_value: String(application.asr_number),
      tolerance: 'exact match',
      severity: 'mismatch'
    });
  }

  // 2. Coordinate cross-check (1 second ≈ 30 m).
  const LAT_TOL_DEG = 1 / 3600;
  if (Number.isFinite(asr.latitude_deg) && Number.isFinite(Number(application.lat))){
    const dlat = Math.abs(asr.latitude_deg - Number(application.lat));
    if (dlat > LAT_TOL_DEG){
      mismatches.push({
        field: 'latitude_deg',
        asr_value: asr.latitude_deg,
        app_value: Number(application.lat),
        delta_arcsec: Number((dlat * 3600).toFixed(2)),
        tolerance: '1 arcsec (~30 m)',
        severity: dlat > LAT_TOL_DEG * 10 ? 'major' : 'minor'
      });
    }
  }
  if (Number.isFinite(asr.longitude_deg) && Number.isFinite(Number(application.lon))){
    const dlon = Math.abs(asr.longitude_deg - Number(application.lon));
    if (dlon > LAT_TOL_DEG){
      mismatches.push({
        field: 'longitude_deg',
        asr_value: asr.longitude_deg,
        app_value: Number(application.lon),
        delta_arcsec: Number((dlon * 3600).toFixed(2)),
        tolerance: '1 arcsec (~30 m at equator, less at higher latitudes)',
        severity: dlon > LAT_TOL_DEG * 10 ? 'major' : 'minor'
      });
    }
  }

  // 3. Overall height (1 m tolerance).
  const HEIGHT_TOL_M = 1.0;
  if (Number.isFinite(asr.overall_height_m) && Number.isFinite(Number(application.overall_height_m))){
    const dh = Math.abs(asr.overall_height_m - Number(application.overall_height_m));
    if (dh > HEIGHT_TOL_M){
      mismatches.push({
        field: 'overall_height_m',
        asr_value: asr.overall_height_m,
        app_value: Number(application.overall_height_m),
        delta_m: Number(dh.toFixed(2)),
        tolerance: '1 m',
        severity: dh > HEIGHT_TOL_M * 5 ? 'major' : 'minor'
      });
    }
  }

  // 4. Overall AMSL height (3 m tolerance — looser than AGL because
  //    derived = AGL + ground elevation, both quantized to 1 m).
  const AMSL_TOL_M = 3.0;
  if (Number.isFinite(asr.overall_height_amsl_m) && Number.isFinite(Number(application.overall_height_amsl_m))){
    const dh = Math.abs(asr.overall_height_amsl_m - Number(application.overall_height_amsl_m));
    if (dh > AMSL_TOL_M){
      mismatches.push({
        field: 'overall_height_amsl_m',
        asr_value: asr.overall_height_amsl_m,
        app_value: Number(application.overall_height_amsl_m),
        delta_m: Number(dh.toFixed(2)),
        tolerance: '3 m (AGL + ground elev quantization)',
        severity: dh > AMSL_TOL_M * 5 ? 'major' : 'minor'
      });
    }
  }

  return {
    ...asr,
    cross_check: {
      applicable: true,
      matches:    mismatches.length === 0,
      n_mismatches: mismatches.length,
      mismatches,
      tolerances: {
        coordinates: '1 arcsec',
        overall_height_m: '1 m',
        overall_height_amsl_m: '3 m'
      }
    }
  };
}

/* -------------------- Socrata tier (opendata.fcc.gov) -------------------- */

// FCC ASR Socrata schema is documented at
// https://opendata.fcc.gov/Wireless/Antenna-Structure-Registration/wzue-cz5e
// Field names vary slightly across vintages; we use the existing
// pickFirst helper to tolerate either snake_case or camelCase
// variants without a hard schema dependency.
async function querySocrataByNumber(asr_number, { socrataUrl, socrataAppToken, timeoutMs, fetchFn }){
  // The FCC publishes the column as either `registration_number` or
  // `unique_system_identifier` across vintages.  Issue both queries
  // ORed via a $where IN clause; takes whichever returns a row.
  const where = `registration_number='${escapeSoql(asr_number)}' OR unique_system_identifier='${escapeSoql(asr_number)}'`;
  const url = `${socrataUrl}?$where=${encodeURIComponent(where)}&$limit=1`;
  try {
    const headers = socrataAppToken ? { 'X-App-Token': socrataAppToken } : {};
    const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), headers });
    if (!r.ok) return null;
    const arr = await r.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return normalizeSocrataRow(arr[0], url);
  } catch { return null; }
}

async function querySocrataByLocation({ lat, lon, radius_m, limit, socrataUrl, socrataAppToken, timeoutMs, fetchFn }){
  // Socrata geospatial filter.  ASR records have a `location` Point
  // column on the standard dataset; older vintages expose latitude /
  // longitude scalar columns.  Try the geospatial form first; fall
  // back to a bbox filter computed from radius_m if the host doesn't
  // recognise the function.
  const tryUrls = [
    `${socrataUrl}?$where=${encodeURIComponent(`within_circle(location, ${lat}, ${lon}, ${radius_m})`)}&$limit=${limit}`,
    `${socrataUrl}?$where=${encodeURIComponent(buildBboxWhere(lat, lon, radius_m))}&$limit=${limit}`
  ];
  const headers = socrataAppToken ? { 'X-App-Token': socrataAppToken } : {};
  for (const url of tryUrls){
    try {
      const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), headers });
      if (!r.ok) continue;
      const arr = await r.json();
      if (!Array.isArray(arr) || arr.length === 0) continue;
      const records = arr.map(row => normalizeSocrataRow(row, url));
      return {
        available:  true,
        source:     'fcc-opendata-socrata',
        endpoint:   url,
        fetched_at: new Date().toISOString(),
        n_records:  records.length,
        radius_m,
        records
      };
    } catch { /* try next */ }
  }
  return null;
}

function buildBboxWhere(lat, lon, radius_m){
  // Approximate bbox: 1° lat ≈ 111 km; 1° lon ≈ 111 km × cos(lat).
  // Tolerance is in metres so divide by 111_000 (cos correction for lon).
  const dlat = radius_m / 111_000;
  const dlon = radius_m / (111_000 * Math.max(0.05, Math.cos(lat * Math.PI / 180)));
  const lat_min = lat - dlat;
  const lat_max = lat + dlat;
  const lon_min = lon - dlon;
  const lon_max = lon + dlon;
  // Try the most common scalar lat/lon column names; the OR chain
  // means whichever schema the dataset uses, ONE of the comparisons
  // resolves cleanly (the other is treated as a false predicate).
  return `latitude between ${lat_min} and ${lat_max} AND longitude between ${lon_min} and ${lon_max}`;
}

function normalizeSocrataRow(row, endpoint){
  if (!row || typeof row !== 'object') return { available: false, source: null, error: 'Socrata row not an object' };
  // Robust field-name lookup — FCC column names have changed across
  // vintages.  pickFirst tries every alias and returns the first match.
  const asr_number = pickFirst(row, [
    'registration_number', 'asr_number', 'asrn', 'unique_system_identifier'
  ]);
  // Latitude / longitude — column may be a Point ("location") or scalars.
  let lat = pickNumeric(row, ['latitude', 'latitude_deg']);
  let lon = pickNumeric(row, ['longitude', 'longitude_deg']);
  if (!Number.isFinite(lat) && row.location && row.location.coordinates){
    // GeoJSON Point: [lon, lat].
    const c = row.location.coordinates;
    if (Array.isArray(c) && c.length === 2){ lon = num(c[0]); lat = num(c[1]); }
  }
  // Heights — FCC publishes in feet on the legacy dataset; metres on
  // the modern dataset.  Detect by column suffix.
  const height_agl_ft = pickNumeric(row, ['overall_height_above_ground', 'overall_height_ft']);
  const height_amsl_ft = pickNumeric(row, ['overall_height_amsl', 'overall_height_amsl_ft']);
  const ground_elev_ft = pickNumeric(row, ['ground_elevation', 'ground_elevation_ft', 'elevation_above_msl']);
  const FT_TO_M = 0.3048;
  const overall_height_m = pickNumeric(row, ['overall_height_m', 'overall_height_agl_m'])
    ?? (Number.isFinite(height_agl_ft) ? height_agl_ft * FT_TO_M : null);
  const overall_height_amsl_m = pickNumeric(row, ['overall_height_amsl_m'])
    ?? (Number.isFinite(height_amsl_ft) ? height_amsl_ft * FT_TO_M : null);
  const ground_elevation_m = pickNumeric(row, ['ground_elevation_m'])
    ?? (Number.isFinite(ground_elev_ft) ? ground_elev_ft * FT_TO_M : null);
  return {
    available:               !!asr_number,
    source:                  'fcc-opendata-socrata',
    endpoint,
    fetched_at:              new Date().toISOString(),
    asr_number:              asr_number ? String(asr_number) : null,
    latitude_deg:            Number.isFinite(lat) ? lat : null,
    longitude_deg:           Number.isFinite(lon) ? lon : null,
    overall_height_m:        Number.isFinite(overall_height_m) ? Number(overall_height_m.toFixed(3)) : null,
    overall_height_amsl_m:   Number.isFinite(overall_height_amsl_m) ? Number(overall_height_amsl_m.toFixed(3)) : null,
    ground_elevation_m:      Number.isFinite(ground_elevation_m) ? Number(ground_elevation_m.toFixed(3)) : null,
    lighting_requirement:    pickFirst(row, ['lighting_paint', 'lighting', 'faa_lighting', 'lighting_requirement']),
    painting_requirement:    pickFirst(row, ['painting', 'paint_requirement', 'painting_requirement']),
    owner:                   pickFirst(row, ['entity_name', 'owner', 'licensee_name', 'registrant_name']),
    status:                  pickFirst(row, ['status_code', 'status', 'registration_status']),
    faa_study_number:        pickFirst(row, ['faa_study_number', 'faa_study', 'aeronautical_study_number'])
  };
}

function escapeSoql(s){
  // Single-quote SoQL string literals.  Per Socrata docs, embed a
  // single quote by doubling it.  We don't need to handle backslash.
  return String(s).replace(/'/g, "''");
}

/* -------------------- internal helpers -------------------- */

function normalizeAsrRecord(j, source, endpoint){
  if (!j || typeof j !== 'object') return { available: false, source: null, error: 'ASR response not an object' };
  return {
    available:               true,
    source,
    endpoint,
    fetched_at:              new Date().toISOString(),
    asr_number:              String(j.asr_number || j.registration_number || j.asrn || ''),
    latitude_deg:            num(j.latitude_deg ?? j.latitude ?? j.lat),
    longitude_deg:           num(j.longitude_deg ?? j.longitude ?? j.lon ?? j.lng),
    overall_height_m:        num(j.overall_height_m ?? j.overall_height_agl_m ?? j.height_m),
    overall_height_amsl_m:   num(j.overall_height_amsl_m),
    ground_elevation_m:      num(j.ground_elevation_m ?? j.site_elevation_m),
    lighting_requirement:    j.lighting_requirement ?? j.lighting ?? null,
    painting_requirement:    j.painting_requirement ?? j.painting ?? null,
    owner:                   j.owner ?? j.tower_owner ?? null,
    status:                  j.status ?? j.asr_status ?? null,
    faa_study_number:        j.faa_study_number ?? j.faa_study ?? null
  };
}

function pickFirst(obj, keys){
  if (!obj) return null;
  for (const k of keys){
    if (k.includes('.')){
      const parts = k.split('.');
      let v = obj;
      for (const p of parts){ if (v && typeof v === 'object') v = v[p]; else { v = null; break; } }
      if (v !== undefined && v !== null && v !== '') return v;
      continue;
    }
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function pickNumeric(obj, keys){
  const v = pickFirst(obj, keys);
  return num(v);
}

function num(v){
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function joinUrl(base, suffix){
  if (base.endsWith('/')) base = base.slice(0, -1);
  if (!suffix.startsWith('/')) suffix = '/' + suffix;
  return base + suffix;
}

export const ASR_PROVENANCE = Object.freeze({
  regulation:    '47 CFR §17.4 — Antenna Structure Registration',
  related:       ['47 CFR §17.7 (FAA notification)', 'FAA Form 7460-1 (notice of proposed construction)'],
  upstream:      'https://opendata.fcc.gov/resource/wzue-cz5e.json (Socrata)',
  fallback_chain: [
    'ZTR rich-station _tower / asr_number',
    'opendata.fcc.gov Socrata (ASR_SOCRATA_URL, default)',
    'ASR_SIDECAR_URL operator sidecar',
    'FCC ULS HTML (opt-in)'
  ],
  cross_check_tolerances: {
    coordinates: '1 arcsec (~30 m)',
    overall_height_m: '1 m',
    overall_height_amsl_m: '3 m'
  },
  license_basis: '17 U.S.C. § 105 — methodology from §17.4, US Government public domain'
});
