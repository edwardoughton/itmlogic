// AM physics sidecar client.
//
// Wraps the operator's NEC-family SOMNEC2D sidecar — a historical
// FORTRAN electromagnetic ground-field solver that numerically
// evaluates modified Sommerfeld integrals to produce the NEC
// interpolation grid (SOM2D.NEC) used by NEC-2 / NEC2++ for AM
// directional-array near-field / far-field analysis over lossy ground.
//
// ADVISORY ONLY.  This sidecar produces independent physics evidence
// that sits beside FCC §73.183 / §73.184 / §73.190 / §73.182
// deterministic rule math.  It never overrides, modifies, or
// substitutes for FCC curve-derived contour distances, allocation
// results, or any filing-controlling rule calculation.
//
// CONTRACT
//
//   GET /healthz
//     → 200 { ok: true, service: 'genoa-am-physics', engine: 'somnec2d' }
//
//   POST /run/somnec
//     content-type: application/json
//     body: { epr, sig_s_m, frequency_mhz, print_grid, debug? }
//     → 200 {
//         ok: true,
//         engine: 'somnec2d',
//         advisory: true,
//         inputs:  { epr, sig_s_m, frequency_mhz, ... },
//         outputs: { grid_file: 'SOM2D.NEC', grid_sha256, grid_created },
//         stdout_summary?: { epscf, ar1_1_1, time_seconds }
//       }
//
// PROVENANCE
//   Sidecar runs FORTRAN somnec2d.f from
//     /opt/genoa/knowledge/am-groundwave/github/necpp/testharness/FORTRAN/somnec2d.f
//   on the operator's host (default port 18091).
//
// USE
//   Set AM_PHYSICS_SIDECAR_URL on the deploy.  When unset,
//   makeAmPhysicsClient returns null and the AM exhibit attaches
//   evidence.am_physics = { status: 'not_configured', advisory: true }
//   instead of failing the study.
//
// REGULATORY POSTURE
//   Genoa does NOT replace FCC allocation rules with NEC-family
//   physics output.  Genoa uses SOMNEC2D as an independent physics
//   engine BESIDE deterministic FCC rule calculations.  Filing math
//   remains §73.183 / §73.184 / §73.190 / §73.182.

const DEFAULT_TIMEOUT_MS = 120_000;

// FCC §73.190 Figure R3 default ground conductivity for unmeasured
// continental US soil (mS/m).  Used only when the facility/input
// does not supply a measured value.  The evidence block records
// 'default' as the source so reviewers see the assumption.
export const DEFAULT_GROUND_SIGMA_MS_M = 8;

// NEC convention default relative dielectric constant for average soil.
// Operators with a measured value (e.g. from a §73.186 conductivity
// study) should pass it via inputs.epr.
export const DEFAULT_EPR = 15;

/**
 * Unified ground-constants resolver shared by every AM physics
 * sidecar client (SOMNEC2D, NEC2++ / PyNEC).  Single source of truth
 * for the (εᵣ, σ, source-tag) tuple so the SOMNEC2D advisory and the
 * NEC moment-method advisory cannot drift apart — historically the
 * NEC sidecar carried a hard-coded dielectric_constant of 13 while
 * SOMNEC2D used 15; this helper eliminates that disagreement at the
 * client layer.
 *
 * @param {object} inp                       facility / station inputs
 * @param {number} [inp.ground_epr]          measured / operator dielectric
 * @param {number} [inp.ground_sigma_mS_m]   measured / operator conductivity
 * @param {object} [defaults]                override defaults (rarely needed)
 * @returns {{
 *   epr:         number,
 *   epr_source:  'input' | 'default',
 *   sigma_ms_m:  number,
 *   sig_s_m:     number,
 *   sigma_source:'input' | 'default'
 * }}
 */
export function _groundConstantsResolver(inp = {}, defaults = {}){
  const D_EPR   = Number(defaults.epr ?? DEFAULT_EPR);
  const D_SIGMA = Number(defaults.sigma_ms_m ?? DEFAULT_GROUND_SIGMA_MS_M);

  let epr = Number(inp.ground_epr);
  let epr_source = 'input';
  if (!Number.isFinite(epr) || epr <= 0){
    epr = D_EPR;
    epr_source = 'default';
  }

  let sigma_ms_m = Number(inp.ground_sigma_mS_m);
  let sigma_source = 'input';
  if (!Number.isFinite(sigma_ms_m) || sigma_ms_m <= 0){
    sigma_ms_m = D_SIGMA;
    sigma_source = 'default';
  }
  const sig_s_m = sigmaMsmToSm(sigma_ms_m) ?? 0;
  return { epr, epr_source, sigma_ms_m, sig_s_m, sigma_source };
}

/** Convert ground conductivity from mS/m (Genoa schema native) to S/m
 *  (NEC / SOMNEC2D native).  8 mS/m → 0.008 S/m.  Returns null for
 *  non-positive / non-finite inputs (incl. null, undefined). */
export function sigmaMsmToSm(ms){
  if (ms == null) return null;
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n / 1000;
}

/** Convert frequency from kHz (Genoa AM-band native) to MHz
 *  (NEC / SOMNEC2D native).  780 kHz → 0.780 MHz.  Returns null for
 *  non-positive / non-finite inputs (incl. null, undefined). */
export function khzToMhz(khz){
  if (khz == null) return null;
  const n = Number(khz);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n / 1000;
}

export function makeAmPhysicsClient({
  baseUrl   = process.env.AM_PHYSICS_SIDECAR_URL || null,
  apiToken  = (process.env.AM_PHYSICS_API_TOKEN || '').trim() || null,
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
          { headers: auth(apiToken) }, 3_000);
        if (!r.ok) return false;
        const j = await r.json().catch(() => ({}));
        return !!j.ok;
      } catch { return false; }
    },

    /**
     * Run SOMNEC2D.  Inputs in SOMNEC2D-native units (S/m, MHz).
     * Returns the full sidecar response wrapped with available:true
     * and a timestamp, or available:false on failure.
     *
     * @param {object} params
     * @param {number} params.epr            Relative dielectric constant (NEC EPR)
     * @param {number} params.sig_s_m        Conductivity, S/m (8 mS/m → 0.008)
     * @param {number} params.frequency_mhz  Frequency, MHz (780 kHz → 0.780)
     * @param {0|1}    [params.print_grid=1] SOMNEC IPT flag — 1 prints grid
     * @param {boolean}[params.debug=false]  Pass through to sidecar to keep
     *                                       full AR1/AR2/AR3 tables
     * @returns {Promise<{available:boolean, engine?:string, advisory?:boolean,
     *                    inputs?:object, outputs?:object, stdout_summary?:object,
     *                    fetched_at?:string, error?:string}>}
     */
    async runSomnec({ epr, sig_s_m, frequency_mhz, print_grid = 1, debug = false } = {}, opts = {}){
      const fEpr = Number(epr);
      const fSig = Number(sig_s_m);
      const fMhz = Number(frequency_mhz);
      if (!Number.isFinite(fEpr) || fEpr <= 0){
        return { available: false, error: 'epr must be a positive finite number (relative dielectric constant)' };
      }
      if (!Number.isFinite(fSig) || fSig <= 0){
        return { available: false, error: 'sig_s_m must be a positive finite number (S/m)' };
      }
      if (!Number.isFinite(fMhz) || fMhz <= 0){
        return { available: false, error: 'frequency_mhz must be a positive finite number (MHz)' };
      }
      const url = joinUrl(baseUrl, '/run/somnec');
      const body = JSON.stringify({
        epr:           fEpr,
        sig_s_m:       fSig,
        frequency_mhz: fMhz,
        print_grid:    print_grid ? 1 : 0,
        ...(debug ? { debug: true } : {})
      });
      const t0 = Date.now();
      try {
        const r = await fetchWithTimeout(fetchFn, url, {
          method:  'POST',
          headers: { 'content-type': 'application/json', ...auth(apiToken) },
          body
        }, opts.timeoutMs ?? timeoutMs);
        if (!r.ok){
          return { available: false, error: `HTTP ${r.status}`, endpoint: url,
                   elapsed_ms: Date.now() - t0 };
        }
        const j = await r.json();
        if (j?.ok === false){
          return { available: false,
                   error: j.error || 'sidecar returned ok:false',
                   endpoint: url,
                   elapsed_ms: Date.now() - t0 };
        }
        return {
          available:   true,
          endpoint:    url,
          fetched_at:  new Date().toISOString(),
          elapsed_ms:  Date.now() - t0,
          engine:      j.engine || 'somnec2d',
          advisory:    true,
          inputs:      j.inputs  || { epr: fEpr, sig_s_m: fSig, frequency_mhz: fMhz },
          outputs:     j.outputs || null,
          stdout_summary: j.stdout_summary || null
        };
      } catch (e){
        return { available: false, error: String(e?.message || e),
                 endpoint: url, elapsed_ms: Date.now() - t0 };
      }
    }
  };
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

export const AM_PHYSICS_CLIENT_PROVENANCE = Object.freeze({
  module:        'src/evidence/amPhysicsClient.js',
  upstream:      'SOMNEC2D (operator sidecar, NEC-family FORTRAN ground-field solver)',
  source_path:   '/opt/genoa/knowledge/am-groundwave/github/necpp/testharness/FORTRAN/somnec2d.f',
  method:        'Numerical evaluation of modified Sommerfeld integrals for lossy-ground field components; produces the SOM2D.NEC interpolation grid consumed by NEC-2 / NEC2++.',
  posture:       'ADVISORY — independent physics evidence only.  Does not modify FCC §73.183/§73.184/§73.190/§73.182 deterministic rule outputs.',
  license_basis: 'NEC-2 lineage is Lawrence Livermore National Laboratory public-domain FORTRAN (NEC family).',
  modeled: [
    'Lossy-ground field interpolation grid for NEC moment-method antenna solvers',
    'Sommerfeld integral evaluation for AM-band frequencies (0.5–1.7 MHz)',
    'Per-run grid SHA-256 for replay/provenance'
  ],
  not_modeled: [
    'FCC §73.184 groundwave contour distance — that remains the FCC curve engine',
    'FCC §73.190(c) skywave field strength — Wang 1985 / Berry analytical screening',
    'Filing-controlling rule math of any kind'
  ]
});
