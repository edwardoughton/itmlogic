// Direct FCC Contours API client.
//
// Fetches the FCC's published terrain-aware service contour for a
// licensed station directly from geo.fcc.gov — no ZTR proxy required.
//
// ENDPOINT
//   https://geo.fcc.gov/api/contours/entity.json
//   ?facilityId=<id>&serviceType=<FM|AM|LPFM|FX>&unit=km
//
// The endpoint returns a GeoJSON FeatureCollection whose features are
// the FCC's ITM-computed service contours (one feature per contour
// filed — usually one, sometimes multiple for directional stations).
// Properties on each feature include: callsign, facility_id, field
// (dBu for FM/LPFM/FX; mV/m for AM), erp, haat per radial, etc.
//
// OUTPUT SHAPE
//   Same as facilityClient.getFccContour:
//   { available, source, endpoint, upstream_api, feature_count, contour }
//   where `contour` is the raw GeoJSON FeatureCollection from geo.fcc.gov.
//
// SERVICE TYPE MAPPING
//   Genoa service → FCC API serviceType parameter:
//     FM / FS / FB → FM    (FS = FM auxiliary; FB = FM booster)
//     FX           → FX    (FM translator)
//     LPFM / L1    → LPFM
//     AM           → AM

const DEFAULT_BASE_URL   = 'https://geo.fcc.gov/api/contours/entity.json';
const DEFAULT_TIMEOUT_MS = 12_000;

const SERVICE_TO_TYPE = {
  FM:   'FM',
  FS:   'FM',
  FB:   'FM',
  FX:   'FX',
  LPFM: 'LPFM',
  L1:   'LPFM',
  AM:   'AM'
};

export function makeFccContoursClient({
  baseUrl   = DEFAULT_BASE_URL,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn   = (typeof fetch === 'function' ? fetch : null)
} = {}){
  if (!fetchFn) return null;

  return {
    baseUrl,

    // Liveness probe used by /readyz.  geo.fcc.gov has no /health
    // route, so we hit the real endpoint with a known facility and
    // count any HTTP response (2xx, 3xx, 4xx) as "host reachable".
    // Only network / DNS / TLS failures register as unhealthy.
    async health(){
      try {
        const r = await fetchFn(`${baseUrl}?facilityId=11282&serviceType=FM&unit=km`,
                                { signal: AbortSignal.timeout(3000) });
        return r.status >= 200 && r.status < 600;
      } catch { return false; }
    },

    /**
     * Fetch the FCC published contour for a licensed station.
     *
     * @param {string|number} facilityId  FCC facility ID
     * @param {string}        service     Genoa service code (FM/AM/LPFM/FX/FS/FB)
     * @returns {object}  { available, source, endpoint, upstream_api, feature_count, contour }
     */
    async getContour(facilityId, service){
      if (!facilityId){
        return { available: false, source: null, error: 'facilityId required' };
      }
      const serviceType = SERVICE_TO_TYPE[String(service || '').toUpperCase()] || null;
      if (!serviceType){
        return { available: false, source: null,
                 error: `unknown service "${service}" — cannot map to FCC serviceType` };
      }
      const endpoint = `${baseUrl}?facilityId=${encodeURIComponent(facilityId)}&serviceType=${serviceType}&unit=km`;
      try {
        const r = await fetchFn(endpoint, { signal: AbortSignal.timeout(timeoutMs) });
        if (!r.ok){
          return { available: false, source: null, endpoint,
                   error: `HTTP ${r.status} from FCC Contours API` };
        }
        const json = await r.json();
        if (json?.status === 'error'){
          return { available: false, source: null, endpoint,
                   error: `FCC Contours API error: ${json.statusMessage || json.statusCode}` };
        }
        if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features) || !json.features.length){
          return { available: false, source: null, endpoint,
                   error: 'FCC Contours API returned no features for this station' };
        }
        return {
          available:     true,
          source:        'fcc-contours-direct',
          endpoint,
          upstream_api:  baseUrl,
          fetched_at:    new Date().toISOString(),
          feature_count: json.features.length,
          contour:       json
        };
      } catch (e){
        return { available: false, source: null, endpoint,
                 error: `FCC Contours API fetch failed: ${e.message}` };
      }
    }
  };
}

/**
 * Extract per-radial HAAT from an FCC contour response.
 *
 * The FCC's contour endpoint returns `contourData[]` — one entry per
 * azimuth (0..359 at 1° step) with `haat` (m) for that radial.  This
 * is the same HAAT FCC used to compute the contour vertex; using it
 * here lets the engine clear CONSTANT_HAAT_ASSUMED with sourced data
 * without requiring a separate terrain sidecar.
 *
 * @param {object} fccResp     Output of getContour() — { available, contour, ... }
 * @param {number} stepDeg     Engine's radial_step_deg (subsampling factor)
 * @returns {object|null}      Genoa-shape terrain bundle, or null if N/A
 *                             { radials: [{azimuth_deg, haat_m}],
 *                               rcamsl, elevation_data_source, nradial,
 *                               source, endpoint }
 */
export function extractHaatFromContour(fccResp, stepDeg = 10){
  if (!fccResp?.available) return null;
  const features = fccResp.contour?.features;
  if (!Array.isArray(features) || features.length === 0) return null;
  const props = features[0].properties || {};
  const contourData = props.contourData;
  if (!Array.isArray(contourData) || contourData.length === 0) return null;
  const step = Number(stepDeg) || 10;
  // FCC azimuths are integers 0..359.  Engine radials at step S are
  // [0, S, 2S, ...].  Subsample by az % step === 0.  Keep entries whose
  // haat field is non-finite — caller will fall back per-radial so the
  // engine sees a length-matched bundle.
  const byAz = new Map();
  for (const pt of contourData){
    if (typeof pt.azimuth !== 'number') continue;
    if (pt.azimuth % step !== 0) continue;
    byAz.set(pt.azimuth, Number.isFinite(pt.haat) ? pt.haat : null);
  }
  // Emit one row per engine radial [0, S, 2S, ..., 360-S].
  const radials = [];
  for (let az = 0; az < 360; az += step){
    radials.push({ azimuth_deg: az, haat_m: byAz.has(az) ? byAz.get(az) : null });
  }
  const n_finite = radials.filter(r => Number.isFinite(r.haat_m)).length;
  if (n_finite === 0) return null;
  return {
    radials,
    n_finite,
    rcamsl:                props.rcamsl ?? null,
    elevation_data_source: props.elevation_data_source || 'ned_1',
    nradial:               props.nradial || radials.length,
    source:                'fcc-contours-direct',
    endpoint:              fccResp.endpoint
  };
}
