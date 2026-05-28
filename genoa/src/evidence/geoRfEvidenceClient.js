// Geo-RF Evidence sidecar client.
//
// Wraps the operator-hosted Geo-RF Evidence sidecar — a microservice that
// surfaces environmental geospatial datasets relevant to RF propagation
// (tree-canopy density, landcover classes, and RF/environment statistical
// model artifacts).  Used for advisory confidence-scoring and observed-
// vs-predicted residual support.
//
// ADVISORY ONLY.  This sidecar produces independent environmental
// evidence.  It never overrides, modifies, or substitutes for FCC
// curve-derived contour distances, allocation results, or any filing-
// controlling rule calculation:
//
//   - FCC §73.184 AM groundwave distances
//   - §73.182 AM nighttime allocation
//   - §73.190 skywave results
//   - §73.313 / §73.333 FM contour distances
//   - §73.207 / §73.215 compliance results
//   - any PASS/FAIL filing determination
//
// CONTRACT
//
//   GET /healthz
//     → 200 {
//         ok: true,
//         service: 'genoa-geo-rf-evidence',
//         datasets: {
//           tree_canopy_conus: true,
//           tau_rf_models:     true,
//           canada_landcover:  true
//         }
//       }
//
//   GET /sample/tree-canopy?lat={lat}&lon={lon}
//     → 200 {
//         ok: true,
//         dataset: 'science_tcc_CONUS_2022_v2023-5',
//         lat, lon,
//         value_raw: '35',      // string from raster sample
//         stderr:    '',
//         advisory:  true
//       }
//
// USE
//   Set GEO_RF_EVIDENCE_SIDECAR_URL on the deploy (and optionally
//   GEO_RF_EVIDENCE_API_TOKEN for bearer auth).  When unset,
//   makeGeoRfEvidenceClient returns null and the exhibit attaches
//   evidence.geo_rf_evidence = { status:'not_configured', advisory:true }
//   instead of failing the study.
//
// REGULATORY POSTURE
//   Environmental RF evidence is advisory only.  Does not modify FCC
//   filing-controlling contour or allocation calculations.

import { GEO_RF_DATASET_SLOTS, makeEmptyDatasetMap } from '../types/geoRfEvidence.schema.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export function makeGeoRfEvidenceClient({
  baseUrl   = process.env.GEO_RF_EVIDENCE_SIDECAR_URL || null,
  apiToken  = (process.env.GEO_RF_EVIDENCE_API_TOKEN || '').trim() || null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn   = (typeof fetch === 'function' ? fetch : null)
} = {}){
  if (!baseUrl) return null;
  if (!fetchFn) return null;
  return {
    baseUrl,
    hasToken: !!apiToken,

    async health(){
      try {
        const r = await fetchWithTimeout(fetchFn,
          joinUrl(baseUrl, '/healthz'),
          { headers: auth(apiToken) }, 5_000);
        if (!r.ok) return false;
        const j = await r.json().catch(() => ({}));
        return !!j.ok;
      } catch { return false; }
    },

    /**
     * Full health payload (with dataset availability map).  Returns
     * { ok, datasets:{...} } on success, { ok:false } on failure.
     * Never throws.
     */
    async healthDetail(){
      try {
        const r = await fetchWithTimeout(fetchFn,
          joinUrl(baseUrl, '/healthz'),
          { headers: auth(apiToken) }, 5_000);
        if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
        return await r.json().catch(() => ({ ok: false, error: 'invalid JSON' }));
      } catch (e){
        return { ok: false, error: String(e?.message || e) };
      }
    },

    /**
     * Sample tree-canopy at a point.
     *
     * @returns {Promise<{available:boolean, dataset?, value_raw?,
     *                    value_numeric?, error?, fetched_at?}>}
     */
    async sampleTreeCanopy({ lat, lon } = {}, opts = {}){
      const fLat = Number(lat), fLon = Number(lon);
      if (!Number.isFinite(fLat) || !Number.isFinite(fLon)){
        return { available: false, error: 'lat / lon must be finite numbers' };
      }
      const url = joinUrl(baseUrl, '/sample/tree-canopy')
                  + `?lat=${encodeURIComponent(fLat.toFixed(6))}`
                  + `&lon=${encodeURIComponent(fLon.toFixed(6))}`;
      const t0 = Date.now();
      try {
        const r = await fetchWithTimeout(fetchFn, url,
          { headers: auth(apiToken) }, opts.timeoutMs ?? timeoutMs);
        if (!r.ok){
          return { available: false, error: `HTTP ${r.status}`,
                   endpoint: url, elapsed_ms: Date.now() - t0 };
        }
        const j = await r.json();
        if (j?.ok === false){
          return { available: false,
                   error: j.error || 'sidecar returned ok:false',
                   endpoint: url, elapsed_ms: Date.now() - t0 };
        }
        // value_raw is a string from the raster sample (e.g. "35").
        // Empty / whitespace-only stdout means the point is outside the
        // raster's coverage (e.g. Canada / Mexico / HI / AK / PR for the
        // CONUS-only USFS TCC dataset) — treat as "no coverage" rather
        // than coercing the empty string to a misleading numeric 0.
        const raw = j?.value_raw;
        const rawTrim = (raw == null ? '' : String(raw).trim());
        const value_numeric = rawTrim === ''
          ? null
          : (Number.isFinite(Number(rawTrim)) ? Number(rawTrim) : null);
        return {
          available:     true,
          endpoint:      url,
          fetched_at:    new Date().toISOString(),
          elapsed_ms:    Date.now() - t0,
          dataset:       j.dataset || null,
          lat:           j.lat ?? fLat,
          lon:           j.lon ?? fLon,
          value_raw:     raw ?? null,
          value_numeric,
          stderr:        j.stderr || null,
          advisory:      j.advisory !== false,
          interpretation: interpretCanopy(value_numeric)
        };
      } catch (e){
        return { available: false, error: String(e?.message || e),
                 endpoint: url, elapsed_ms: Date.now() - t0 };
      }
    },

    /**
     * Canopy rose — N azimuths (default 12) at a fixed distance from
     * the tx.  All samples run in parallel via Promise.all so the
     * worst-case wall-clock is ~one HTTP round-trip, not N.  Empty /
     * out-of-coverage points return value_numeric:null per the
     * single-point contract (no misleading 0 coercion).
     *
     * @returns {Promise<{ available, distance_km, n_azimuths, samples:
     *           Array<{ az_deg, lat, lon, value_numeric, value_raw,
     *                   available, interpretation }> }>}
     */
    async sampleCanopyRose({ lat, lon, distance_km, n_azimuths = 12 } = {}, opts = {}){
      const fLat  = Number(lat), fLon = Number(lon), fDist = Number(distance_km);
      const nAz   = Math.max(4, Math.min(36, Math.floor(Number(n_azimuths) || 12)));
      if (!Number.isFinite(fLat) || !Number.isFinite(fLon) || !Number.isFinite(fDist) || fDist <= 0){
        return { available: false, error: 'lat / lon / distance_km required (finite, positive)',
                 distance_km: null, n_azimuths: nAz, samples: [] };
      }
      const azimuths = Array.from({ length: nAz }, (_, i) => (i * 360) / nAz);
      const samples = await Promise.all(azimuths.map(async (az) => {
        const [sLat, sLon] = projectLatLon(fLat, fLon, az, fDist);
        const r = await this.sampleTreeCanopy({ lat: sLat, lon: sLon }, opts);
        return {
          az_deg:         az,
          lat:            sLat,
          lon:            sLon,
          value_numeric:  r.value_numeric ?? null,
          value_raw:      r.value_raw ?? null,
          available:      r.available && r.value_numeric != null,
          interpretation: r.interpretation || null
        };
      }));
      return {
        available:   samples.some(s => s.available),
        distance_km: fDist,
        n_azimuths:  nAz,
        samples
      };
    },

    /**
     * Attempt a single-call composite point sample via `/sample/all`.  The
     * sidecar's `/sample/all` endpoint (when implemented) returns a per-
     * slot payload in one round trip:
     *
     *   GET /sample/all?lat=&lon=
     *     → 200 { ok:true, datasets: { tree_canopy:{...}, landcover:{...},
     *                                  tau_rf_models:{...}, ... } }
     *
     * Returns `{available:true, datasets:{...}}` on success, or
     * `{available:false, error}` if the endpoint is not implemented (404)
     * or the call fails — callers then fall back to parallel per-point
     * endpoints.  Never throws.
     */
    async sampleAll({ lat, lon } = {}, opts = {}){
      const fLat = Number(lat), fLon = Number(lon);
      if (!Number.isFinite(fLat) || !Number.isFinite(fLon)){
        return { available: false, error: 'lat / lon must be finite numbers' };
      }
      const url = joinUrl(baseUrl, '/sample/all')
                  + `?lat=${encodeURIComponent(fLat.toFixed(6))}`
                  + `&lon=${encodeURIComponent(fLon.toFixed(6))}`;
      const t0 = Date.now();
      try {
        const r = await fetchWithTimeout(fetchFn, url,
          { headers: auth(apiToken) }, opts.timeoutMs ?? timeoutMs);
        if (!r.ok){
          return { available: false, error: `HTTP ${r.status}`,
                   endpoint: url, elapsed_ms: Date.now() - t0 };
        }
        const j = await r.json().catch(() => null);
        if (!j || j.ok === false || !j.datasets || typeof j.datasets !== 'object'){
          return { available: false,
                   error: j?.error || 'sidecar /sample/all returned no datasets',
                   endpoint: url, elapsed_ms: Date.now() - t0 };
        }
        return {
          available:  true,
          datasets:   j.datasets,
          endpoint:   url,
          elapsed_ms: Date.now() - t0,
          fetched_at: new Date().toISOString()
        };
      } catch (e){
        return { available: false, error: String(e?.message || e),
                 endpoint: url, elapsed_ms: Date.now() - t0 };
      }
    },

    /**
     * Composite "everything we know for a facility" sample.  Strategy:
     *
     *   1. Try `/sample/all` (single round trip) — if the sidecar exposes
     *      it, prefer that.  When the sidecar omits a dataset slot we
     *      record `{available:false}` rather than inventing values.
     *   2. Fall back to parallel per-point endpoints (`/healthz` +
     *      `/sample/tree-canopy`) and synthesize the multi-slot envelope
     *      from the health probe's dataset-availability map.
     *
     * Optional `canopy_rose_distance_km` triggers a second-tier rose
     * sample (12 azimuths at that distance) attached under both
     * `tree_canopy` (canonical) and `tree_canopy_conus` (back-compat).
     *
     * Always emits `map_marker` (lat/lon/label/popup_text) at the
     * facility point so the contour map can render an advisory marker.
     *
     * @returns the normalized evidence.geo_rf_evidence object shape
     */
    async sampleGeoRfEvidenceForFacility({ lat, lon, service, call, facility_id, canopy_rose_distance_km } = {}, opts = {}){
      // Treat null/undefined/'' as missing — Number(null)===0 would
      // otherwise falsely pass isFinite and try to sample at 0,0.
      const fLat = (lat === null || lat === undefined || lat === '') ? NaN : Number(lat);
      const fLon = (lon === null || lon === undefined || lon === '') ? NaN : Number(lon);
      const inputs = {
        lat:         Number.isFinite(fLat) ? fLat : null,
        lon:         Number.isFinite(fLon) ? fLon : null,
        service:     service     || null,
        call:        call        || null,
        facility_id: facility_id || null
      };
      if (!Number.isFinite(fLat) || !Number.isFinite(fLon)){
        return geoRfEnvelope({
          status: 'failed',
          inputs,
          datasets: makeEmptyDatasetMap(),
          error:  'coordinates_missing'
        });
      }
      const roseDist = Number(canopy_rose_distance_km);
      const wantRose = Number.isFinite(roseDist) && roseDist > 0;

      // ── Path 1: try /sample/all first ────────────────────────────────
      const [all, health, rose] = await Promise.all([
        this.sampleAll({ lat: fLat, lon: fLon }, opts),
        this.healthDetail(),
        wantRose
          ? this.sampleCanopyRose({ lat: fLat, lon: fLon, distance_km: roseDist }, opts)
          : Promise.resolve(null)
      ]);

      let canopy = null;          // tree_canopy_conus shape (back-compat)
      let datasets;
      let elapsed_ms;

      if (all.available){
        // Use the sidecar's multi-slot payload; backfill any missing
        // slots with {available:false} — NEVER invent data.
        datasets = mergeDatasetSlots(all.datasets, makeEmptyDatasetMap());
        // For back-compat: synthesize `tree_canopy_conus` from
        // `tree_canopy` so existing renderers continue to work.
        if (datasets.tree_canopy && datasets.tree_canopy.available && !datasets.tree_canopy_conus.available){
          datasets.tree_canopy_conus = { ...datasets.tree_canopy };
        }
        canopy = datasets.tree_canopy_conus;
        elapsed_ms = all.elapsed_ms;
      } else {
        // ── Path 2: per-point fallback ─────────────────────────────────
        const c = await this.sampleTreeCanopy({ lat: fLat, lon: fLon }, opts);
        const sidecarDatasets = (health && health.ok && health.datasets) || {};
        const canopySlot = c.available
          ? {
              available:      true,
              dataset:        c.dataset,
              value_raw:      c.value_raw,
              value_numeric:  c.value_numeric,
              interpretation: c.interpretation
            }
          : {
              available: !!sidecarDatasets.tree_canopy_conus,
              error:     c.error || null
            };
        datasets = {
          ...makeEmptyDatasetMap(),
          tree_canopy:       canopySlot,
          tree_canopy_conus: canopySlot,
          tau_rf_models: {
            available: !!sidecarDatasets.tau_rf_models,
            role:      'RF/environment statistical model artifact'
          },
          landcover: {
            available: !!(sidecarDatasets.landcover || sidecarDatasets.canada_landcover),
            role:      'NLCD / NRCan landcover (CONUS + cross-border)'
          },
          canada_landcover: {
            available: !!sidecarDatasets.canada_landcover,
            role:      'available for Canadian coordinates / cross-border studies'
          },
          fcc_m3_conductivity_availability: {
            available: !!sidecarDatasets.fcc_m3_conductivity_availability,
            role:      'FCC §73.190 Fig. M3 ground conductivity coverage indicator (advisory)'
          },
          water_proximity: {
            available: !!sidecarDatasets.water_proximity,
            role:      'surface-water / coastal proximity (advisory propagation context)'
          },
          climate_projection_availability: {
            available: !!sidecarDatasets.climate_projection_availability,
            role:      'climate-projection raster availability flag (advisory)'
          },
          sdr_residual_support: {
            available: !!sidecarDatasets.sdr_residual_support,
            role:      'observed-vs-predicted residual support (advisory)'
          }
        };
        canopy = canopySlot;
        elapsed_ms = c.elapsed_ms;
      }

      if (rose){
        // Attach to both slot names so old + new readers see it.
        if (datasets.tree_canopy && typeof datasets.tree_canopy === 'object'){
          datasets.tree_canopy.rose = rose;
        }
        if (datasets.tree_canopy_conus && typeof datasets.tree_canopy_conus === 'object'){
          datasets.tree_canopy_conus.rose = rose;
        }
      }

      const canopyAvail   = !!(canopy && canopy.available);
      const anyAvail      = Object.values(datasets).some(d => d && d.available);
      const sidecarUp     = !!(health && health.ok) || all.available;
      const status        = (canopyAvail || anyAvail) ? 'run' : (sidecarUp ? 'failed' : 'offline');

      // Map marker — always emitted when we have facility coordinates, so
      // the contour map can render an advisory pin even when no canopy
      // value is available.  Point sample only — never a raster tile.
      const canopyValue = canopy?.value_numeric;
      const popupText   = canopyValue != null
        ? `Tree canopy value: ${canopyValue}. Advisory environmental RF evidence only.`
        : `Tree canopy value: N. Advisory environmental RF evidence only.`;

      const map_marker = {
        lat:        fLat,
        lon:        fLon,
        label:      'Geo-RF Evidence (advisory)',
        popup_text: popupText
      };

      // Confidence-scoring context: short, structured, deterministic so
      // Appendix I and the panel can both reference it.  Never feeds back
      // into FCC math.
      const confidence_scoring_context = {
        role:      'advisory_inputs_only',
        canopy_density:    canopyValue ?? null,
        canopy_interpretation: canopy?.interpretation || null,
        contributes_to:  ['observed_vs_predicted_residual_explanation',
                          'confidence_scoring_advisory_context'],
        filing_effect:   'none'
      };

      // Observed-vs-predicted residual support — flag-shaped; the actual
      // residuals live in evidence.sdr_residuals, this is just the
      // advisory cross-link.
      const residual_support = {
        slot:           'sdr_residual_support',
        available:      !!datasets.sdr_residual_support?.available,
        role:           'cross-references SDR observed-vs-predicted residuals (advisory context)',
        filing_effect:  'none'
      };

      return geoRfEnvelope({
        status,
        inputs,
        datasets,
        map_marker,
        confidence_scoring_context,
        residual_support,
        sidecar_service: health?.service || 'genoa-geo-rf-evidence',
        baseUrl,
        elapsed_ms,
        fetched_at: new Date().toISOString()
      });
    }
  };
}

// Merge sidecar-returned dataset slots over a default `{available:false}`
// map.  Sidecar slots win, but unknown slots are dropped — keeps the
// envelope shape stable for downstream readers.
function mergeDatasetSlots(sidecarSlots, defaults){
  const out = { ...defaults };
  if (!sidecarSlots || typeof sidecarSlots !== 'object') return out;
  for (const slot of GEO_RF_DATASET_SLOTS){
    const v = sidecarSlots[slot];
    if (v == null) continue;
    if (typeof v === 'object' && !Array.isArray(v)){
      // Normalize available to boolean.
      out[slot] = { ...v, available: !!v.available };
    } else if (typeof v === 'boolean'){
      out[slot] = { available: v };
    }
  }
  return out;
}

/* ---------- helpers ---------- */

function geoRfEnvelope({ status, inputs, datasets = {}, error, ...extra }){
  return {
    status,                                // 'run' | 'not_configured' | 'failed' | 'offline'
    advisory:        true,
    filing_effect:   'none',
    inputs,
    datasets,
    notes: [
      'Environmental RF evidence is advisory only.',
      'Does not modify FCC filing-controlling contour or allocation calculations.'
    ],
    ...(error ? { error } : {}),
    ...extra
  };
}

/** Best-effort qualitative interpretation of canopy density (USFS TCC
 *  canopy values are 0–100 % closed canopy).  Used only for the
 *  appendix "interpretation" label; never feeds back into FCC math. */
function interpretCanopy(v){
  if (v == null) return 'no coverage at this location (outside CONUS canopy dataset)';
  if (!Number.isFinite(v)) return 'unavailable';
  if (v <  10) return 'low canopy / open ground';
  if (v <  30) return 'sparse canopy';
  if (v <  60) return 'moderate canopy / vegetation context';
  if (v <  80) return 'dense canopy';
  return 'very dense canopy';
}

function auth(token){
  if (!token) return {};
  return { authorization: `Bearer ${token}` };
}

function joinUrl(base, path){
  return String(base).replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path);
}

async function fetchWithTimeout(fetchFn, url, init = {}, ms = DEFAULT_TIMEOUT_MS){
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetchFn(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

// Great-circle projection — destination (lat, lon) given a start
// (lat0, lon0), azimuth (deg, 0=N clockwise) and distance (km).
// Same math as engine/index.js#projectVertex; kept local so the
// client has no dependency on the engine module.
function projectLatLon(lat0, lon0, az_deg, d_km){
  const R = 6371.0088;
  const az = (Number(az_deg) || 0) * Math.PI / 180;
  const dr = (Number(d_km)   || 0) / R;
  const lat1 = (Number(lat0) || 0) * Math.PI / 180;
  const lon1 = (Number(lon0) || 0) * Math.PI / 180;
  const sinLat2 = Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(az);
  const lat2 = Math.asin(sinLat2);
  const y = Math.sin(az) * Math.sin(dr) * Math.cos(lat1);
  const x = Math.cos(dr) - Math.sin(lat1) * sinLat2;
  const lon2 = lon1 + Math.atan2(y, x);
  return [lat2 * 180 / Math.PI, ((lon2 * 180 / Math.PI) + 540) % 360 - 180];
}

/** Build a not_configured envelope without constructing a client (used by
 *  the exhibit orchestrator when GEO_RF_EVIDENCE_SIDECAR_URL is unset). */
export function geoRfNotConfigured(inputs){
  return geoRfEnvelope({
    status: 'not_configured',
    inputs: inputs || { lat: null, lon: null, service: null, call: null, facility_id: null },
    datasets: makeEmptyDatasetMap(),
    error: 'GEO_RF_EVIDENCE_SIDECAR_URL unset — sidecar not invoked'
  });
}

export const GEO_RF_EVIDENCE_CLIENT_PROVENANCE = Object.freeze({
  module:        'src/evidence/geoRfEvidenceClient.js',
  upstream:      'genoa-geo-rf-evidence (operator sidecar — environmental geospatial datasets)',
  posture:       'ADVISORY — independent environmental RF evidence only.  Does not modify FCC §73.184 / §73.182 / §73.190 / §73.313 / §73.207 / §73.215 deterministic rule outputs.',
  datasets: [
    'science_tcc_CONUS_2022_v2023-5 (USFS Tree Canopy Cover, CONUS, 2022)',
    'tau_statistic_for_rf_models — RF/environment statistical model artifacts',
    'can_land_cover_2020v2_30m_tif (NRCan Canada landcover, 2020 v2, 30 m) — cross-border studies'
  ],
  modeled: [
    'Per-point canopy density (% closed canopy) at facility transmitter coordinates',
    'Auxiliary dataset availability surfaced via health probe'
  ],
  not_modeled: [
    'FCC §73.184 contour distance — that remains the FCC curve engine',
    'FCC §73.182 / §73.190 AM nighttime allocation',
    'FCC §73.313 / §73.333 FM contour math',
    'Any filing-controlling rule calculation'
  ]
});
