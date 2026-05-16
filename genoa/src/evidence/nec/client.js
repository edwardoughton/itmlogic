// Genoa NEC client — talks to the GPL-isolated NEC2++ / PyNEC sidecar.
//
// LICENSE BOUNDARY (CRITICAL)
//   NEC2++ / PyNEC are GPL v2.  This client file does NOT import,
//   link, or statically embed any GPL'd code — it only makes HTTP
//   calls to the sidecar process (sidecars/nec/server.js).  The
//   sidecar is built/run as a separate container; Genoa's main
//   image and process never touch the GPL'd binaries.  Every NEC
//   evidence block carries `provenance.license_boundary =
//   "external sidecar"` so reviewers can verify the boundary.
//
// USE
//   Set NEC_SIDECAR_URL on the API deploy.  Calls are wrapped in the
//   compute-budget deadline so a slow sidecar can't stall the
//   exhibit.  When the sidecar is unreachable OR PyNEC is missing,
//   the orchestrator emits a NEC_MODEL_UNAVAILABLE warning and ships
//   the exhibit without the NEC block — never blocks filing.

const DEFAULT_TIMEOUT_MS = 90_000;

export function makeNecClient({
  baseUrl   = process.env.NEC_SIDECAR_URL || null,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}){
  if (!baseUrl) return null;
  return {
    baseUrl,

    async health(){
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const r = await fetch(joinUrl(baseUrl, '/health'), { signal: ctrl.signal });
        clearTimeout(t);
        if (!r.ok) return { reachable: false, status: r.status };
        return { reachable: true, ...(await r.json().catch(() => ({}))) };
      } catch (e){ return { reachable: false, error: String(e.message) }; }
    },

    /**
     * Run an arbitrary wire-segment NEC model.
     * @param {object} model — see sidecars/nec/server.js header for schema
     * @param {{ timeoutMs?: number }} [opts]
     */
    async run(model, opts = {}){
      return postJson(baseUrl, '/model/run', model, opts.timeoutMs ?? timeoutMs);
    },

    /**
     * Convenience: build a vertical-tower AM array from a high-level
     * spec then run.  See sidecars/nec/server.js header for shape.
     */
    async runAmArray(spec, opts = {}){
      return postJson(baseUrl, '/model/am-array', spec, opts.timeoutMs ?? timeoutMs);
    },

    /**
     * Convenience: take an existing model + add probe points (e.g.
     * monitor-point coordinates) and run.
     */
    async runNearField(model, points, opts = {}){
      return postJson(baseUrl, '/model/near-field',
                       { model, points }, opts.timeoutMs ?? timeoutMs);
    }
  };
}

async function postJson(baseUrl, path, body, timeoutMs){
  const ctrl = new AbortController();
  const t    = setTimeout(() => ctrl.abort(), timeoutMs);
  const endpoint = joinUrl(baseUrl, path);
  try {
    const r = await fetch(endpoint, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  ctrl.signal
    });
    clearTimeout(t);
    let j = null;
    try { j = await r.json(); } catch { /* fall through */ }
    if (!r.ok){
      return {
        ok:        false,
        endpoint,
        http_status: r.status,
        error:     j?.error  || `HTTP ${r.status}`,
        detail:    j?.detail || null
      };
    }
    return { ok: true, endpoint, ...j };
  } catch (e){
    clearTimeout(t);
    return {
      ok:        false,
      endpoint,
      error:     e?.name === 'AbortError' ? 'NEC_BRIDGE_TIMEOUT' : 'NEC_SIDECAR_UNREACHABLE',
      detail:    String(e.message || e)
    };
  }
}

function joinUrl(base, suffix){
  if (base.endsWith('/')) base = base.slice(0, -1);
  if (!suffix.startsWith('/')) suffix = '/' + suffix;
  return base + suffix;
}

/**
 * Convert a NEC sidecar response into a Genoa pattern_table at the
 * horizon (theta = 90°) so it flows into the existing directional-
 * pattern code paths (am_directional.js → §73.62, §73.215, §74.1204,
 * §73.187).  Returns null if no horizon slice is present.
 */
export function necPatternToTable(necResponse, { elevation_deg = 0 } = {}){
  const p = necResponse?.pattern;
  if (!p || !Array.isArray(p.theta_deg) || !Array.isArray(p.phi_deg) || !Array.isArray(p.gain_dbi)){
    return null;
  }
  const want_theta = 90 - Number(elevation_deg);    // NEC: theta = polar from zenith
  let bestIdx = 0;
  let bestDelta = Math.abs(p.theta_deg[0] - want_theta);
  for (let i = 1; i < p.theta_deg.length; i++){
    const d = Math.abs(p.theta_deg[i] - want_theta);
    if (d < bestDelta){ bestDelta = d; bestIdx = i; }
  }
  const row = p.gain_dbi[bestIdx];
  if (!Array.isArray(row) || row.length !== p.phi_deg.length) return null;
  const max_dbi = Math.max(...row.filter(Number.isFinite));
  if (!Number.isFinite(max_dbi)) return null;
  const out = [];
  for (let i = 0; i < p.phi_deg.length; i++){
    const az = Number(p.phi_deg[i]);
    const db = Number(row[i]);
    if (!Number.isFinite(az) || !Number.isFinite(db)) continue;
    out.push([az, Math.max(0, Math.min(1, Math.pow(10, (db - max_dbi) / 20)))]);
  }
  return out.length ? out : null;
}

export const NEC_PROVENANCE = Object.freeze({
  module:            'src/evidence/nec/client.js',
  sidecar:           'src/sidecars/nec/',
  upstream_engine:   'NEC2++ (necpp) + PyNEC',
  upstream_repo:     'https://github.com/tmolteno/necpp',
  upstream_license:  'GPL v2',
  derived_from:      'NEC2 — Lawrence Livermore (1981, public domain)',
  license_boundary:  'external sidecar — Genoa main process never imports or links GPL\'d code',
  regulation_basis: [
    '47 CFR §73.62  — directional AM pattern authorization',
    '47 CFR §73.150 — proof of performance, RTA',
    '47 CFR §73.45  — MEOV monitor-point fields',
    '47 CFR §1.1310 / OET-65 — near-field RF exposure'
  ],
  pattern_convention: 'Far-field gain reported as dBi over (theta × phi); ' +
                      'necPatternToTable() converts to Genoa pattern_table = ' +
                      '[[az_deg, field_factor]] at the chosen elevation slice, ' +
                      'with field_factor = 10^((dBi - max_dBi)/20) normalized to peak=1.'
});
