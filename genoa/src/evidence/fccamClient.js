// Genoa FCCAM (AM skywave) client.
//
// Talks to the FCCAM sidecar — a FastAPI wrapper around the FCC's
// public-domain Fccam.for skywave program (Wang 1985 model permitted
// under 47 CFR §73.190(c)).  The sidecar runs alongside the existing
// fcc-fortran-engine on the operator's droplet; see
// genoa/src/sidecars/fccam/README.md for deploy instructions.
//
// This client is the authoritative source for 50% skywave field
// strength used by §73.182 AM nighttime allocation analysis.  When
// FCCAM_SIDECAR_URL is unset, makeFccamClient returns null and any
// downstream AM-night code MUST degrade explicitly rather than
// substitute a different model — silently swapping engines would
// break the determinism contract.
//
// SERVICE CONTRACT (see genoa/src/sidecars/fccam/main.py)
//
//   GET  /healthz
//     → 200 { ok: true, binary_present: bool }
//
//   GET  /version
//     → { engine: 'fccam', version, source_sha256, binary_sha256,
//         files: { 'Fccam.for': { sha256, size } },
//         regulation: '47 CFR §73.190(c) ...',
//         license_basis: '17 USC §105 ...' }
//
//   POST /run
//     body: {
//       erp_kw:        number,    // > 0, ≤ 50_000
//       freq_khz:      number,    // 535..1705, US 10-kHz grid
//       distance_km:   number,    // > 0, ≤ 8000
//       midpoint_lat:  number,    // -90..90, great-circle path midpoint
//       percent_time:  10 | 50,   // skywave statistic; 50 is the §73.182 default
//       mode:          'field_at_distance' | 'distance_to_field',
//       field_uv_m?:   number     // required when mode=distance_to_field
//     }
//     → 200 {
//          ok, engine: 'fccam',
//          field_uv_m | distance_km,
//          flag:        null | string,
//          input_sha256, inputs,
//          stdout, stderr,
//          source_sha256, engine_version
//        }
//
//   POST /run-batch
//     body: { requests: [/run input objects, 1..1024 ] }
//     → 200 { ok, n_requests, n_ok, n_failed, results: [...] }
//
// USE
//   Genoa-side wiring goes in src/api/services/sidecars.js as
//     fccam: makeFccamClient(),
//   in parallel with `fortranFcc: makeFortranFccClient()`.
//   AM nighttime analysis (§73.182) consumes it; nothing else does.
//
// REGULATORY CITATIONS
//   - 47 CFR §73.182 — AM nighttime engineering standards of allocation
//   - 47 CFR §73.190(c) — Wang skywave formula explicitly permitted
//   - 17 USC §105 — FCC code is US Government work product, public domain

const DEFAULT_TIMEOUT_MS = 10_000;

export function makeFccamClient({
  baseUrl   = process.env.FCCAM_SIDECAR_URL || null,
  apiToken  = (process.env.FCCAM_API_TOKEN || '').trim() || null,
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
        const r = await fetchWithTimeout(fetchFn, joinUrl(baseUrl, '/healthz'),
                                         { headers: authHeaders(apiToken) },
                                         3_000);
        return r.ok;
      } catch { return false; }
    },

    // Service version + Fccam.for source-file SHA, for stamping
    // method_versions.fcc_am_skywave_engine.* on the exhibit so the
    // AM-night analysis carries provenance the reviewer can replay.
    async version(){
      try {
        const r = await fetchWithTimeout(fetchFn, joinUrl(baseUrl, '/version'),
                                         { headers: authHeaders(apiToken) },
                                         5_000);
        if (!r.ok) return { available: false, error: `HTTP ${r.status}` };
        const j = await r.json();
        return { available: true, endpoint: joinUrl(baseUrl, '/version'),
                 fetched_at: new Date().toISOString(), ...j };
      } catch (e){
        return { available: false, error: String(e?.message || e) };
      }
    },

    /**
     * Skywave field at a given distance.
     *
     * @returns {Promise<{
     *   available: boolean,
     *   field_uv_m?: number,
     *   flag?: string|null,
     *   input_sha256?: string,
     *   ...
     * }>}
     */
    async fieldAtDistance({
      erp_kw, freq_khz, distance_km, midpoint_lat,
      percent_time = 50
    } = {}, opts = {}){
      const body = makeBody({
        erp_kw, freq_khz, distance_km, midpoint_lat,
        percent_time, mode: 'field_at_distance'
      });
      if (body.error) return body;
      return await postRun(fetchFn, baseUrl, apiToken, body, opts.timeoutMs ?? timeoutMs);
    },

    /**
     * Inverse: distance at which the skywave field decays to a given
     * target field strength.  Used to project a station's "NIF
     * radius" against a per-class protection threshold.
     */
    async distanceToField({
      erp_kw, freq_khz, field_uv_m, midpoint_lat,
      percent_time = 50
    } = {}, opts = {}){
      const body = makeBody({
        erp_kw, freq_khz, midpoint_lat, percent_time,
        mode: 'distance_to_field',
        // FCCAM still needs a distance seed — wired as 1 km so the
        // FORTRAN binary takes the "solve for distance" branch.  See
        // Fccam.for header.
        distance_km: 1,
        field_uv_m
      });
      if (body.error) return body;
      return await postRun(fetchFn, baseUrl, apiToken, body, opts.timeoutMs ?? timeoutMs);
    },

    /**
     * Batch — fan a list of skywave computes out in one round-trip.
     * Used by §73.182 nighttime allocation orchestrator: one request
     * per (proposed-station × interferer-station × azimuth) tuple.
     */
    async runBatch(requests, opts = {}){
      if (!Array.isArray(requests) || requests.length === 0){
        return { available: false, error: 'requests[] must be a non-empty array' };
      }
      const normalized = [];
      for (const req of requests){
        const body = makeBody({
          erp_kw:       req.erp_kw,
          freq_khz:     req.freq_khz,
          distance_km:  req.distance_km ?? 1,
          midpoint_lat: req.midpoint_lat,
          percent_time: req.percent_time ?? 50,
          mode:         req.mode         || 'field_at_distance',
          field_uv_m:   req.field_uv_m
        });
        if (body.error){
          return { available: false, error: `request validation: ${body.error}` };
        }
        normalized.push(body);
      }
      try {
        const r = await fetchWithTimeout(fetchFn, joinUrl(baseUrl, '/run-batch'), {
          method:  'POST',
          headers: { 'content-type': 'application/json', ...authHeaders(apiToken) },
          body:    JSON.stringify({ requests: normalized })
        }, opts.timeoutMs ?? (timeoutMs * 6));
        if (r.status === 404){
          return { available: false, error: '/run-batch not deployed on the FCCAM service',
                   endpoint: joinUrl(baseUrl, '/run-batch') };
        }
        if (!r.ok){
          return { available: false, error: `HTTP ${r.status}`,
                   endpoint: joinUrl(baseUrl, '/run-batch') };
        }
        const j = await r.json();
        const results = j.results || [];
        return { available: true, source: 'fccam',
                 endpoint:   joinUrl(baseUrl, '/run-batch'),
                 fetched_at: new Date().toISOString(),
                 n_requests: normalized.length,
                 n_ok:       results.filter(x => x?.ok === true).length,
                 n_failed:   results.filter(x => x?.ok === false).length,
                 results };
      } catch (e){
        return { available: false, error: String(e?.message || e),
                 endpoint: joinUrl(baseUrl, '/run-batch') };
      }
    }
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeBody(input){
  const body = {
    erp_kw:       Number(input.erp_kw),
    freq_khz:     Number(input.freq_khz),
    distance_km:  Number(input.distance_km),
    midpoint_lat: Number(input.midpoint_lat),
    percent_time: Number(input.percent_time ?? 50),
    mode:         input.mode || 'field_at_distance'
  };
  if (input.field_uv_m !== undefined){
    body.field_uv_m = Number(input.field_uv_m);
  }
  const required = ['erp_kw', 'freq_khz', 'distance_km', 'midpoint_lat'];
  for (const k of required){
    if (!Number.isFinite(body[k])){
      return { available: false, error: `${k} must be a finite number`, error_field: k };
    }
  }
  if (body.mode === 'distance_to_field'){
    if (!Number.isFinite(body.field_uv_m) || body.field_uv_m <= 0){
      return { available: false, error: 'field_uv_m (>0) is required when mode=distance_to_field' };
    }
  }
  if (![10, 50].includes(body.percent_time)){
    return { available: false, error: 'percent_time must be 10 or 50 (FCCAM tabulates only these)' };
  }
  // §73.182 only applies to AM (535-1705 kHz).
  if (body.freq_khz < 535 || body.freq_khz > 1705){
    return { available: false, error: 'freq_khz outside the US AM band (535-1705 kHz)' };
  }
  if (body.freq_khz % 10 !== 0){
    return { available: false, error: `freq_khz ${body.freq_khz} is not on the US 10-kHz AM grid` };
  }
  return body;
}

async function postRun(fetchFn, baseUrl, apiToken, body, timeoutMs){
  try {
    const r = await fetchWithTimeout(fetchFn, joinUrl(baseUrl, '/run'), {
      method:  'POST',
      headers: { 'content-type': 'application/json', ...authHeaders(apiToken) },
      body:    JSON.stringify(body)
    }, timeoutMs);
    if (!r.ok){
      return { available: false, error: `HTTP ${r.status}`,
               endpoint: joinUrl(baseUrl, '/run') };
    }
    const j = await r.json();
    if (!j?.ok){
      return { available: false, error: j?.flag || j?.error || 'engine returned ok=false',
               endpoint: joinUrl(baseUrl, '/run'), raw: j };
    }
    return {
      available:      true,
      source:         'fccam',
      engine:         j.engine || 'fccam',
      endpoint:       joinUrl(baseUrl, '/run'),
      fetched_at:     new Date().toISOString(),
      field_uv_m:     Number.isFinite(j.field_uv_m) ? Number(j.field_uv_m) : null,
      distance_km:    Number.isFinite(j.distance_km) ? Number(j.distance_km) : null,
      flag:           j.flag || null,
      input_sha256:   j.input_sha256 || null,
      engine_version: j.engine_version || null,
      source_sha256:  j.source_sha256  || null,
      stdout:         j.stdout || null,
      stderr:         j.stderr || null,
      inputs:         body
    };
  } catch (e){
    return { available: false, error: String(e?.message || e),
             endpoint: joinUrl(baseUrl, '/run') };
  }
}

function authHeaders(apiToken){
  if (!apiToken) return {};
  return { authorization: `Bearer ${apiToken}` };
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

// ---------------------------------------------------------------------------
// midpoint-lat helper — exported because callers usually have station
// + receiver coordinates and need to derive the great-circle midpoint
// latitude FCCAM consumes.
// ---------------------------------------------------------------------------

/**
 * Great-circle midpoint latitude between two (lat,lon) points, in
 * degrees.  Uses the standard spherical-Earth formula (FCC §73.208
 * great-circle convention; sub-degree precision is fine for the
 * skywave-curve latitude lookup).
 */
export function midpointLatitude(latA, lonA, latB, lonB){
  const d2r = Math.PI / 180;
  const r2d = 180 / Math.PI;
  const φ1 = Number(latA) * d2r;
  const φ2 = Number(latB) * d2r;
  const λ1 = Number(lonA) * d2r;
  const λ2 = Number(lonB) * d2r;
  if (![φ1, φ2, λ1, λ2].every(Number.isFinite)) return NaN;
  const Δλ = λ2 - λ1;
  const Bx = Math.cos(φ2) * Math.cos(Δλ);
  const By = Math.cos(φ2) * Math.sin(Δλ);
  const φm = Math.atan2(
    Math.sin(φ1) + Math.sin(φ2),
    Math.sqrt((Math.cos(φ1) + Bx) ** 2 + By ** 2)
  );
  return φm * r2d;
}

export const FCCAM_CLIENT_PROVENANCE = Object.freeze({
  module:      'src/evidence/fccamClient.js',
  upstream:    'FCC Fccam.for (Wang 1985 skywave)',
  regulation:  '47 CFR §73.182 (AM nighttime allocation) + §73.190(c) (Wang formula)',
  license_basis: '17 USC §105 (US Government public-domain work product)',
  modeled: [
    '50% and 10% skywave field strength per §73.190',
    'Pairwise station-to-receiver skywave for §73.182(k) RSS summation'
  ],
  not_modeled: [
    'DA-N pattern application — separate concern; pattern is applied by the orchestrator before this client is called',
    'Sunrise/sunset transition periods — separate analysis pass',
    'Tropospheric / sporadic-E modes'
  ]
});
