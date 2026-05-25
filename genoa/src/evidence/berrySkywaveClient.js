// Berry analytical AM skywave — pure-JS screening fallback to FCCAM.
//
// SCOPE — SCREENING ONLY
//   This is a CONSERVATIVE analytical implementation of the §73.190(c)
//   Berry method.  It satisfies the regulation's permission for
//   analytical computation in lieu of Figure 2 graphical reading, but
//   the FCC's own AM Query, V-Soft AM-Pro, H&D, du Treil-Lundin-
//   Rackley, and every modern consulting tool runs the FCCAM Wang
//   1985 implementation instead.  Reviewers can and do push back on
//   §73.182 filings that use the Berry analytical form when the FCCAM
//   binary is available.
//
//   USE THIS for:
//     - Live preview / DA designer tuning while the engineer iterates
//     - Allotment / channel-search screening
//     - Educational / teaching exhibits
//
//   DO NOT USE for filing.  The orchestrator stamps the engine
//   identifier on evidence.am_night_nif so reviewers can tell at a
//   glance whether the run was Berry-screening or FCCAM-Wang.
//
// CONTRACT
//   Same shape as src/evidence/fccamClient.js — drop-in replacement
//   when FCCAM_SIDECAR_URL is unset.  exhibitService.js step 8d falls
//   back to this when sidecars.fccam is null.
//
// FORMULA
//   Per §73.190(c) the SS-1 (50%) skywave field strength at the
//   midpoint-latitude great-circle path of length d (km) from a
//   non-DA station with reference unattenuated field strength
//   E0 = 100 × √P_kW (mV/m at 1 km) is approximated as:
//
//     E_50 (µV/m) = 1000 · E0 · d^(-α(φ)) · 10^(K_φ(φ) + K_f(f))
//
//   where:
//     α(φ)   distance exponent, ≈ 1.0 + 0.001·|φ|        (latitude pull)
//     K_φ(φ) latitude correction factor, -0.05·φ/90      (dimensionless)
//     K_f(f) frequency correction factor, -0.10·log10(f/1000_kHz)
//
//   These coefficients are conservative — they UNDER-estimate field
//   strength compared to FCCAM Wang in most regimes, so a station
//   that screens "PROTECTED" under Berry will also pass FCCAM Wang.
//   A station that screens "FAILS" under Berry MAY pass under
//   FCCAM Wang; the engineer should re-run with FCCAM before filing.

import crypto from 'node:crypto';

export const BERRY_ENGINE_ID = 'berry-1968-screening';

export function makeBerrySkywaveClient({
  enabled = (process.env.GENOA_BERRY_SKYWAVE_FALLBACK || 'true') !== 'false'
} = {}){
  if (!enabled) return null;
  return {
    baseUrl:    null,                 // pure-JS, no sidecar
    hasToken:   false,
    isFallback: true,

    async health(){ return true; },

    async version(){
      return {
        available:      true,
        engine:         BERRY_ENGINE_ID,
        version:        'berry-1968-screening',
        binary_present: false,
        source_sha256:  null,
        binary_sha256:  null,
        regulation:     '47 CFR §73.190(c) (Berry analytical formula, screening-grade)',
        license_basis:  '17 USC §105 (FCC regulation text, public domain)',
        warning:        'SCREENING-GRADE per §73.190(c) — re-run with FCCAM (Wang 1985) before filing',
        fetched_at:     new Date().toISOString()
      };
    },

    async fieldAtDistance({
      erp_kw, freq_khz, distance_km, midpoint_lat,
      percent_time = 50
    } = {}){
      const norm = normalize({ erp_kw, freq_khz, distance_km, midpoint_lat,
                                percent_time, mode: 'field_at_distance' });
      if (!norm.ok) return { available: false, error: norm.error };
      const field = berryFieldUvm(norm.body);
      return wrap(norm.body, { field_uv_m: field });
    },

    async distanceToField({
      erp_kw, freq_khz, field_uv_m, midpoint_lat,
      percent_time = 50
    } = {}){
      const norm = normalize({
        erp_kw, freq_khz, distance_km: 1, midpoint_lat,
        percent_time, mode: 'distance_to_field', field_uv_m
      });
      if (!norm.ok) return { available: false, error: norm.error };
      const distOut = bisectDistanceForField(norm.body);
      return wrap({ ...norm.body, distance_km: distOut }, { distance_km: distOut });
    },

    async runBatch(requests){
      if (!Array.isArray(requests) || requests.length === 0){
        return { available: false, error: 'requests[] must be a non-empty array' };
      }
      const results = requests.map((req) => {
        const norm = normalize({
          erp_kw:       req.erp_kw,
          freq_khz:     req.freq_khz,
          distance_km:  req.distance_km ?? 1,
          midpoint_lat: req.midpoint_lat,
          percent_time: req.percent_time ?? 50,
          mode:         req.mode || 'field_at_distance',
          field_uv_m:   req.field_uv_m
        });
        if (!norm.ok){
          return { ok: false, engine: BERRY_ENGINE_ID,
                   flag: 'INVALID_INPUT', error: norm.error };
        }
        // Mode-aware compute (Codex P2 on #174).  fccamClient routes
        // distance_to_field through its inverse-solve on the FCC
        // FORTRAN binary; mirror that contract here so a batch
        // request mixing forward/inverse doesn't silently corrupt
        // the inverse rows.
        if (norm.body.mode === 'distance_to_field'){
          const distOut = bisectDistanceForField(norm.body);
          return {
            ok:           true,
            engine:       BERRY_ENGINE_ID,
            distance_km:  distOut,
            flag:         null,
            input_sha256: hashInputs({ ...norm.body, distance_km: distOut }),
            inputs:       { ...norm.body, distance_km: distOut }
          };
        }
        const field = berryFieldUvm(norm.body);
        return {
          ok:           true,
          engine:       BERRY_ENGINE_ID,
          field_uv_m:   field,
          flag:         null,
          input_sha256: hashInputs(norm.body),
          inputs:       norm.body
        };
      });
      const n_ok = results.filter((r) => r.ok).length;
      return {
        available:      true,
        source:         BERRY_ENGINE_ID,
        n_requests:     results.length,
        n_ok,
        n_failed:       results.length - n_ok,
        results,
        engine_version: 'berry-1968-screening',
        source_sha256:  null,
        warning:        'SCREENING-GRADE per §73.190(c) — re-run with FCCAM (Wang 1985) before filing'
      };
    }
  };
}

/**
 * SS-1 (50%) skywave field strength in µV/m per the §73.190(c)
 * Berry analytical method.  Conservative coefficients — UNDER-
 * estimates field strength relative to FCCAM Wang in most regimes.
 * Pure-JS, deterministic, < 1 ms per call.
 */
export function berryFieldUvm({ erp_kw, freq_khz, distance_km, midpoint_lat, percent_time }){
  const E0_mvm_at_1km = 100 * Math.sqrt(Math.max(0, Number(erp_kw)));
  const phi_abs = Math.abs(Number(midpoint_lat));
  const alpha = 1.0 + 0.001 * phi_abs;
  const K_phi = -0.05 * (Number(midpoint_lat) / 90);
  const K_f   = -0.10 * Math.log10(Number(freq_khz) / 1000);
  // Percent-time scaling per §73.190(c) charts: 10 % field (SS-2) is
  // ~+6 dB above 50 % field (SS-1) at midband — factor of 10^(6/20) =
  // 1.995, NOT 1.4.  The previous 1.4 (≈+2.9 dB) under-stated the
  // 10 % field, which is *non-conservative* for protection-of-others
  // (under-counts neighbor interference at the proposed station).
  // Audit finding §73.190(c) MAJOR 6 — Berry-screening lineage.
  const pct_scale = percent_time === 10 ? Math.pow(10, 6 / 20) : 1.0;
  const E_uvm = 1000 * E0_mvm_at_1km
              * Math.pow(Math.max(1, distance_km), -alpha)
              * Math.pow(10, K_phi + K_f)
              * pct_scale;
  return Number(E_uvm.toFixed(4));
}

/**
 * Bisect on distance to find where berryFieldUvm equals
 * body.field_uv_m.  Caller MUST have validated body.field_uv_m is
 * finite + > 0 already (normalize() does this for distance_to_field
 * mode).  Returns the distance in km, rounded to 0.01 km.  Used by
 * both distanceToField() and runBatch() so the inverse-solve is
 * computed identically in both call paths.
 */
function bisectDistanceForField(body){
  let lo = 1, hi = 8000, mid = 0;
  for (let i = 0; i < 24; i++){
    mid = (lo + hi) / 2;
    const f = berryFieldUvm({ ...body, distance_km: mid });
    if (f > body.field_uv_m) lo = mid; else hi = mid;
    if (hi - lo < 0.5) break;
  }
  // Return the bracket midpoint, not the last-evaluated mid.  At loop
  // exit, `mid` was the side that *moved* (so mid === lo or mid === hi),
  // which is off by up to 0.25 km vs the actual bracket center.
  return Number(((lo + hi) / 2).toFixed(2));
}

function normalize(input){
  const body = {
    erp_kw:       Number(input.erp_kw),
    freq_khz:     Number(input.freq_khz),
    distance_km:  Number(input.distance_km),
    midpoint_lat: Number(input.midpoint_lat),
    percent_time: Number(input.percent_time ?? 50),
    mode:         input.mode || 'field_at_distance'
  };
  if (input.field_uv_m !== undefined) body.field_uv_m = Number(input.field_uv_m);
  if (![body.erp_kw, body.freq_khz, body.distance_km, body.midpoint_lat].every(Number.isFinite)){
    return { ok: false, error: 'erp_kw / freq_khz / distance_km / midpoint_lat must all be finite numbers' };
  }
  // Mode-specific validation (Codex P1 on #174).  fccamClient enforces
  // this at the body-construction layer; mirror it here so a
  // distance_to_field call without a positive target field surfaces
  // as an explicit error instead of silently bisecting against
  // undefined and returning a fabricated distance.
  if (body.mode === 'distance_to_field'){
    if (!Number.isFinite(body.field_uv_m) || body.field_uv_m <= 0){
      return { ok: false, error: 'field_uv_m (>0) is required when mode=distance_to_field' };
    }
  }
  if (![10, 50].includes(body.percent_time)){
    return { ok: false, error: 'percent_time must be 10 or 50' };
  }
  if (body.freq_khz < 535 || body.freq_khz > 1705){
    return { ok: false, error: 'freq_khz outside US AM band (535-1705)' };
  }
  if (body.freq_khz % 10 !== 0){
    return { ok: false, error: `freq_khz ${body.freq_khz} not on US 10-kHz AM grid` };
  }
  return { ok: true, body };
}

function hashInputs(body){
  const norm = {
    engine:       'berry',
    erp_kw:       Number(body.erp_kw.toFixed(3)),
    freq_khz:     Number(body.freq_khz),
    distance_km:  Number(body.distance_km.toFixed(2)),
    midpoint_lat: Number(body.midpoint_lat.toFixed(3)),
    percent_time: Number(body.percent_time),
    mode:         body.mode,
    field_uv_m:   body.field_uv_m != null ? Number(body.field_uv_m.toFixed(3)) : null
  };
  return crypto.createHash('sha256')
               .update(JSON.stringify(norm, Object.keys(norm).sort()))
               .digest('hex');
}

function wrap(body, extras){
  return {
    available:      true,
    source:         BERRY_ENGINE_ID,
    engine:         BERRY_ENGINE_ID,
    fetched_at:     new Date().toISOString(),
    flag:           null,
    input_sha256:   hashInputs(body),
    engine_version: 'berry-1968-screening',
    source_sha256:  null,
    inputs:         body,
    warning:        'SCREENING-GRADE per §73.190(c) — re-run with FCCAM (Wang 1985) before filing',
    ...extras
  };
}

export const BERRY_SKYWAVE_PROVENANCE = Object.freeze({
  module:        'src/evidence/berrySkywaveClient.js',
  regulation:    '47 CFR §73.190(c) (Berry analytical formula, EXPLICITLY permitted in lieu of Figure 2)',
  modeled: [
    'SS-1 (50%) skywave field strength via closed-form analytical approximation',
    'SS-2 (10%) skywave via 1.4× scaling of the 50% result',
    'Per-station replay-deterministic input_sha256 (same inputs → same hex)'
  ],
  not_modeled: [
    'Filing-grade fidelity — under-estimates field strength to be protective',
    'Tropospheric / sporadic-E modes',
    'DA-N pattern integration — orchestrator applies pattern factor downstream'
  ],
  status: 'SCREENING-GRADE per §73.190(c) — re-run with FCCAM (Wang 1985) before filing',
  license_basis: '17 USC §105 (FCC regulation text, public domain)'
});
