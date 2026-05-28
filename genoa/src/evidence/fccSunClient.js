// FCC sunrise/sunset sidecar client.
//
// Wraps the operator's FCC SRSSTIME sidecar (a microservice that
// re-implements the FCC's published Sunrise/Sunset Calculation
// schedule used in §73.99 pre-sunrise / post-sunset authority
// (PSRA / PSSA) and AM day/night mode switching) — running at
// http://159.223.153.153:8091.
//
// CONTRACT
//
//   GET /healthz
//     → 200 "ok" (or {ok:true})
//
//   GET /api/am/sun?lat={lat}&lon={lon}&tzone={code}
//     Authorization: Bearer <FCC_SUN_API_TOKEN>
//     → 200 {
//         source:        'fcc_srsstime',
//         timezone_code: 'C',
//         timezone_label: 'Mountain Standard Time',
//         input:   { lat, lon },
//         dms:     { lat: { degrees, minutes, seconds },
//                    lon: { degrees, minutes, seconds } },
//         monthly: { '1': { sunrise, sunset }, '2': {...}, ..., '12': {...} },
//         replay:  '<reviewer-replay-string>'
//       }
//
//   FCC timezone codes per 47 CFR §73.99 / SRSSTIME documentation:
//     A   Atlantic Standard Time            (UTC-4)
//     a   Atlantic Daylight Time            (UTC-3)
//     B   Eastern Standard Time             (UTC-5)
//     b   Eastern Daylight Time             (UTC-4)
//     C   Central Standard Time             (UTC-6)
//     c   Central Daylight Time             (UTC-5)
//     D   Mountain Standard Time (Arizona)  (UTC-7)
//     d   Mountain Daylight Time            (UTC-6)
//     E   Pacific Standard Time             (UTC-8)
//     F   Alaska Standard Time              (UTC-9)
//     f   Alaska Daylight Time              (UTC-8)
//     G   Hawaii-Aleutian Standard Time     (UTC-10)
//     g   Hawaii-Aleutian Daylight Time     (UTC-9)
//
// USE
//   Set FCC_SUN_SIDECAR_URL on the deploy (and FCC_SUN_API_TOKEN
//   for bearer auth).  When unset, makeFccSunClient returns null
//   and the AM Sunrise/Sunset Authority panel renders the
//   "sidecar unavailable" warning instead of failing the study.
//
// REGULATORY
//   - 47 CFR §73.99   — pre-sunrise / post-sunset authority
//   - 47 CFR §73.1209 — day/night-mode service hours

const DEFAULT_TIMEOUT_MS = 8_000;

export const FCC_TIMEZONE_CODES = Object.freeze([
  { code: 'A', label: 'Atlantic Standard Time',                 utc_offset: -4 },
  { code: 'a', label: 'Atlantic Daylight Time',                 utc_offset: -3 },
  { code: 'B', label: 'Eastern Standard Time',                  utc_offset: -5 },
  { code: 'b', label: 'Eastern Daylight Time',                  utc_offset: -4 },
  { code: 'C', label: 'Central Standard Time',                  utc_offset: -6 },
  { code: 'c', label: 'Central Daylight Time',                  utc_offset: -5 },
  { code: 'D', label: 'Mountain Standard Time (Arizona)',       utc_offset: -7 },
  { code: 'd', label: 'Mountain Daylight Time',                 utc_offset: -6 },
  { code: 'E', label: 'Pacific Standard Time',                  utc_offset: -8 },
  { code: 'F', label: 'Alaska Standard Time',                   utc_offset: -9 },
  { code: 'f', label: 'Alaska Daylight Time',                   utc_offset: -8 },
  { code: 'G', label: 'Hawaii-Aleutian Standard Time',          utc_offset: -10 },
  { code: 'g', label: 'Hawaii-Aleutian Daylight Time',          utc_offset:  -9 }
]);

export function isValidFccTzCode(code){
  return FCC_TIMEZONE_CODES.some((t) => t.code === code);
}

/**
 * Best-effort default FCC timezone code from a (lat, lon).  Used
 * by the UI to preset the dropdown; the engineer can still pick
 * any code.  Conservative — always picks Standard time variants
 * since FCC authorizations default to standard time per §73.99.
 *
 * @returns {string} one of 'A'..'G' (uppercase = standard time)
 */
export function defaultTzForLatLon(lat, lon){
  const lo = Number(lon);
  const la = Number(lat);
  if (!Number.isFinite(lo) || !Number.isFinite(la)) return 'B';   // EST safest default
  // Alaska (Aleutian outliers handled by Hawaii-Aleutian for far western Aleutians)
  if (la >= 51 && lo <= -130) return 'F';                          // Alaska Standard
  if (la >= 18 && la <= 23 && lo <= -154 && lo >= -161) return 'G'; // Hawaii
  if (la >= 17 && la <= 19 && lo <= -65  && lo >= -68 ) return 'A'; // Puerto Rico (AST)
  // Continental US longitude bands:
  //   Pacific:     lon ≤ -114
  //   Mountain:    -114 < lon ≤ -101
  //   Central:     -101 < lon ≤ -87
  //   Eastern:     -87  < lon
  if (lo <= -114) return 'E';
  if (lo <= -101){
    // Arizona stays on Mountain Standard year-round → FCC code 'D'.
    // We can't tell from lat/lon alone if a station is in AZ vs NM/CO,
    // so use the safer 'D' (MST) for the whole band; engineer overrides
    // for DST if needed.
    return 'D';
  }
  if (lo <=  -87) return 'C';
  return 'B';
}

export function makeFccSunClient({
  baseUrl   = process.env.FCC_SUN_SIDECAR_URL || null,
  apiToken  = (process.env.FCC_SUN_API_TOKEN || '').trim() || null,
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
        return r.ok;
      } catch { return false; }
    },

    /**
     * Per-month sunrise/sunset for a given site + FCC timezone code.
     *
     * @returns {Promise<{available:boolean, ...sidecarPayload, error?:string}>}
     */
    async fetchAmSun({ lat, lon, tzone = 'B' } = {}, opts = {}){
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))){
        return { available: false, error: 'lat / lon must be finite numbers' };
      }
      if (!isValidFccTzCode(tzone)){
        return { available: false, error: `tzone "${tzone}" not in FCC timezone codes (A/a/B/b/C/c/D/d/E/F/f/G/g)` };
      }
      const url = joinUrl(baseUrl, '/api/am/sun')
                  + `?lat=${encodeURIComponent(Number(lat).toFixed(6))}`
                  + `&lon=${encodeURIComponent(Number(lon).toFixed(6))}`
                  + `&tzone=${encodeURIComponent(tzone)}`;
      try {
        const r = await fetchWithTimeout(fetchFn, url,
          { headers: auth(apiToken) }, opts.timeoutMs ?? timeoutMs);
        if (!r.ok){
          return { available: false, error: `HTTP ${r.status}`,
                   endpoint: url };
        }
        const j = await r.json();
        return {
          available:    true,
          endpoint:     url,
          fetched_at:   new Date().toISOString(),
          ...j
        };
      } catch (e){
        return { available: false, error: String(e?.message || e),
                 endpoint: url };
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

export const FCC_SUN_CLIENT_PROVENANCE = Object.freeze({
  module:        'src/evidence/fccSunClient.js',
  upstream:      'FCC SRSSTIME (operator sidecar)',
  regulation:    '47 CFR §73.99 (pre-sunrise/post-sunset authority) + §73.1209 (day/night mode service hours)',
  license_basis: '17 USC §105 (FCC schedule data, US Government public domain)',
  modeled: [
    'Monthly local-time sunrise/sunset for any (lat, lon) + FCC timezone code',
    'Bearer-auth wrapper with fail-soft sidecar-unreachable handling',
    'Best-effort default timezone code from lat/lon (conservative — uses Standard time variants)'
  ],
  not_modeled: [
    'PSRA / PSSA reduced-power calculation (separate engine — uses these sunrise/sunset times as inputs)',
    'AM nighttime power schedule (separate engine in src/engine/am/)'
  ]
});
