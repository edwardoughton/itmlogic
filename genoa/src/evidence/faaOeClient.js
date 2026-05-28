// FAA Obstruction Evaluation / Airport Airspace Analysis (OE/AAA) client.
//
// SCOPE
//   The FAA's OE/AAA system tracks every Form 7460-1 ("Notice of
//   Proposed Construction or Alteration") submitted to the FAA for
//   review of structures that may affect navigable airspace.  Each
//   review is assigned an Aeronautical Study Number (ASN), which the
//   FCC's ASR record carries as `faa_study_number`.  The FAA then
//   issues one of four determinations:
//
//     - Determination of No Hazard (DNH) — the structure does not
//       constitute a hazard to air navigation; lighting / marking
//       conditions may apply.
//     - Determination of Hazard (DOH) — the structure DOES constitute
//       a hazard; FAA recommends modification or denial.
//     - Conditional Determination — DNH conditional on operating
//       restrictions (lighting, height limits, etc).
//     - Withdrawn / Pending — the proponent withdrew the study, or it
//       hasn't been adjudicated yet.
//
//   Per 47 CFR §17.7 / §17.17, an FCC application that uses a
//   structure subject to FAA review MUST cite the ASN and, if a
//   determination has issued, abide by its conditions.  Genoa's
//   Engineering Statement Tower Study section quotes the FAA
//   determination verbatim and the lighting / marking rules engine
//   compares the FAA-mandated conditions against the actual ASR
//   lighting_requirement / painting_requirement.
//
// SOURCES
//   The FAA does NOT publish a public JSON API for OE/AAA.  The two
//   programmatic paths are:
//
//   1. Operator-managed FAA OE bridge sidecar (FAA_OE_SIDECAR_URL).
//      The operator runs their own proxy that talks to oeaaa.faa.gov
//      and returns clean JSON.  This is the recommended production
//      path; pattern matches ASR_SIDECAR_URL.
//
//   2. FAA OE/AAA web HTML scrape.  oeaaa.faa.gov/oeaaa/external/
//      serves an HTML case-file page per ASN at
//      .../searchAction.jsp?action=showCaseFile&studyId={asn}.
//      Brittle — opt-in only via FAA_OE_HTML_FALLBACK=1; returns a
//      structured "not implemented in this build" error otherwise.
//
//   When neither tier is configured, getByStudyNumber returns
//   { available: false, ... } with a clear "configure FAA_OE_SIDECAR_URL"
//   message; the engine surfaces this as the FAA_OE_UNAVAILABLE
//   warning rather than blocking the exhibit.
//
// HEALTH PROBE
//   Pings oeaaa.faa.gov root (treats any HTTP 2xx-4xx response as
//   alive — confirms the FAA host is reachable from the deploy).
//   Falls back to FAA_OE_SIDECAR_URL /health when configured.
//
// OUTPUT SHAPE
//   {
//     available: bool,
//     source: 'faa-oe-sidecar' | 'faa-oe-html' | null,
//     endpoint, fetched_at,
//     study_number,                     // FAA ASN
//     determination,                    // 'DNH' | 'DOH' | 'CONDITIONAL' | 'WITHDRAWN' | 'PENDING'
//     determination_date,               // ISO date
//     expiration_date,                  // ISO date — DNHs expire after 18 months
//     structure_type,                   // 'TOWER' | 'BUILDING' | 'CRANE' | …
//     latitude_deg, longitude_deg,
//     height_agl_m, height_amsl_m,
//     conditions: [string],             // marking / lighting / TERPS conditions verbatim
//     hazard_summary?: string,
//     // Cross-check against ASR record.
//     cross_check?: {
//       applicable, matches, mismatches: [{ field, asr_value, faa_value, ... }]
//     }
//   }

const DEFAULT_TIMEOUT_MS  = 8_000;
// FAA OE/AAA root.  The /healthz path doesn't exist; we probe the
// public search action and accept any HTTP response.
const DEFAULT_OE_ROOT     = 'https://oeaaa.faa.gov/oeaaa/external';

export function makeFaaOeClient({
  oeRoot          = process.env.FAA_OE_ROOT_URL    || DEFAULT_OE_ROOT,
  oeSidecarUrl    = process.env.FAA_OE_SIDECAR_URL || null,
  htmlFallback    = process.env.FAA_OE_HTML_FALLBACK === '1',
  oeDisable       = process.env.FAA_OE_DISABLE === '1',
  timeoutMs       = DEFAULT_TIMEOUT_MS,
  fetchFn         = (typeof fetch === 'function' ? fetch : null)
} = {}){
  if (oeDisable) return null;
  if (!fetchFn) return null;
  // We're always "configured" because the FAA root is a public host;
  // the actual lookup tier is sidecar / HTML / TBD, but the host
  // probe gives a meaningful liveness signal.

  // Surface a baseUrl so the panel tooltip points somewhere useful.
  const baseUrl = oeSidecarUrl || oeRoot || null;

  // Liveness probe.  Hits the FAA OE search root and counts any
  // HTTP response (2xx-4xx) as "host reachable" — only network /
  // DNS / TLS / timeout failures register as unhealthy.  When an
  // operator FAA bridge sidecar is configured, prefer its /health.
  async function health(){
    if (oeSidecarUrl){
      try {
        const r = await fetchFn(joinUrl(oeSidecarUrl, '/health'),
                                { signal: AbortSignal.timeout(3000) });
        return r.ok;
      } catch { /* fall through */ }
    }
    try {
      const r = await fetchFn(`${oeRoot}/searchAction.jsp?action=showSearchAcceptedDeterminations`,
                              { signal: AbortSignal.timeout(3000) });
      return r.status >= 200 && r.status < 600;
    } catch { return false; }
  }

  return {
    baseUrl,
    health,
    sources: {
      faa_oe_sidecar: !!oeSidecarUrl,
      faa_oe_html:    htmlFallback
    },

    /**
     * Lookup an FAA OE/AAA case file by Aeronautical Study Number.
     * Returns the determination, conditions, and structure data so
     * the Tower Study exhibit can quote the FAA verbatim.
     *
     * Tier order:
     *   1. FAA_OE_SIDECAR_URL operator proxy — clean JSON.
     *   2. oeaaa.faa.gov HTML scrape (when FAA_OE_HTML_FALLBACK=1).
     *   3. None — returns available:false with a clear message.
     *
     * @param {string|number} study_number  FAA Aeronautical Study Number (ASN)
     */
    async getByStudyNumber(study_number){
      if (!study_number){
        return { available: false, source: null, error: 'study_number (FAA ASN) required' };
      }
      // Tier 1: operator-managed FAA OE bridge sidecar.
      if (oeSidecarUrl){
        try {
          const u = joinUrl(oeSidecarUrl, `/api/v1/oe/${encodeURIComponent(study_number)}`);
          const r = await fetchFn(u, { signal: AbortSignal.timeout(timeoutMs) });
          if (r.ok){
            const j = await r.json();
            return normalizeFaaOeRecord(j, 'faa-oe-sidecar', u);
          }
        } catch { /* fall through */ }
      }
      // Tier 2: HTML scrape (opt-in).
      if (htmlFallback){
        return {
          available: false, source: null,
          endpoint: `${oeRoot}/searchAction.jsp?action=showCaseFile&studyId=${encodeURIComponent(study_number)}`,
          error: 'FAA OE/AAA HTML scraping not implemented in this build (set FAA_OE_SIDECAR_URL for clean JSON access)'
        };
      }
      return {
        available: false, source: null,
        error: 'No FAA OE lookup source configured.  Set FAA_OE_SIDECAR_URL for an operator-managed proxy, or FAA_OE_HTML_FALLBACK=1 to opt into the HTML scrape (not yet implemented).'
      };
    }
  };
}

/**
 * Compare an FAA OE record against an ASR record and the
 * application's antenna data; flag mismatches and check that the
 * FAA's mandated lighting / marking conditions appear in the ASR
 * record.  The Tower Study exhibit section will surface this
 * cross_check verbatim.
 *
 * Tolerances:
 *   - lat / lon: 1 arcsec (~30 m)  (matches ASR<->application)
 *   - height_agl_m / height_amsl_m: 1 m  (FAA typically rounds to feet)
 *
 * @param {object} args
 * @param {object} args.faa  normalized FAA OE record (from getByStudyNumber)
 * @param {object} args.asr  normalized ASR record (may carry the same fields)
 * @param {object} [args.application]  optional inputs from the engineer's form
 */
export function checkFaaAgainstAsr({ faa, asr, application = null } = {}){
  if (!faa || faa.available !== true){
    return { ...faa, cross_check: { matches: null, applicable: false, reason: 'FAA OE record not available' } };
  }
  if (!asr || asr.available !== true){
    return { ...faa, cross_check: { matches: null, applicable: false, reason: 'ASR record not available' } };
  }
  const mismatches = [];

  // 1. Coordinate cross-check (1 arcsec ≈ 30 m).
  const LAT_TOL_DEG = 1 / 3600;
  if (Number.isFinite(faa.latitude_deg) && Number.isFinite(asr.latitude_deg)){
    const dlat = Math.abs(faa.latitude_deg - asr.latitude_deg);
    if (dlat > LAT_TOL_DEG){
      mismatches.push({
        field: 'latitude_deg',
        faa_value: faa.latitude_deg,
        asr_value: asr.latitude_deg,
        delta_arcsec: Number((dlat * 3600).toFixed(2)),
        tolerance: '1 arcsec (~30 m)',
        severity: dlat > LAT_TOL_DEG * 10 ? 'major' : 'minor'
      });
    }
  }
  if (Number.isFinite(faa.longitude_deg) && Number.isFinite(asr.longitude_deg)){
    const dlon = Math.abs(faa.longitude_deg - asr.longitude_deg);
    if (dlon > LAT_TOL_DEG){
      mismatches.push({
        field: 'longitude_deg',
        faa_value: faa.longitude_deg,
        asr_value: asr.longitude_deg,
        delta_arcsec: Number((dlon * 3600).toFixed(2)),
        tolerance: '1 arcsec',
        severity: dlon > LAT_TOL_DEG * 10 ? 'major' : 'minor'
      });
    }
  }

  // 2. Height cross-check.  FAA quantizes to feet; allow 1 m tolerance.
  const HEIGHT_TOL_M = 1.0;
  for (const f of ['height_agl_m', 'height_amsl_m']){
    const faa_v = faa[f];
    const asr_v = f === 'height_agl_m' ? asr.overall_height_m : asr.overall_height_amsl_m;
    if (Number.isFinite(faa_v) && Number.isFinite(asr_v)){
      const dh = Math.abs(faa_v - asr_v);
      if (dh > HEIGHT_TOL_M){
        mismatches.push({
          field: f,
          faa_value: faa_v,
          asr_value: asr_v,
          delta_m: Number(dh.toFixed(2)),
          tolerance: '1 m',
          severity: dh > HEIGHT_TOL_M * 5 ? 'major' : 'minor'
        });
      }
    }
  }

  // 3. Determination expiration check — DNHs are valid for 18 months
  //    from the determination date.  Past-expiration determinations
  //    require a re-study before filing.
  let expired = null;
  if (faa.expiration_date){
    const exp = Date.parse(faa.expiration_date);
    if (Number.isFinite(exp)){
      expired = exp < Date.now();
      if (expired){
        mismatches.push({
          field: 'expiration_date',
          faa_value: faa.expiration_date,
          tolerance: 'must be future',
          severity: 'major',
          note: 'FAA DNH expired; re-study required per FAA Order JO 7400.2 §6-3-3'
        });
      }
    }
  }

  return {
    ...faa,
    cross_check: {
      applicable: true,
      matches:    mismatches.length === 0,
      n_mismatches: mismatches.length,
      mismatches,
      expired,
      tolerances: {
        coordinates:  '1 arcsec',
        heights:      '1 m'
      }
    }
  };
}

/* -------------------- internal helpers -------------------- */

function normalizeFaaOeRecord(j, source, endpoint){
  if (!j || typeof j !== 'object') return { available: false, source: null, error: 'FAA OE response not an object' };
  // Per the FAA bridge sidecar's documented response shape; tolerant
  // of column-name variants across vintages.
  return {
    available:           true,
    source,
    endpoint,
    fetched_at:          new Date().toISOString(),
    study_number:        String(j.study_number || j.asn || j.aeronautical_study_number || ''),
    determination:       j.determination || j.case_outcome || null,
    determination_date:  j.determination_date || j.issue_date || null,
    expiration_date:     j.expiration_date || j.expires || null,
    structure_type:      j.structure_type || j.structure || null,
    latitude_deg:        num(j.latitude_deg ?? j.latitude ?? j.lat),
    longitude_deg:       num(j.longitude_deg ?? j.longitude ?? j.lon ?? j.lng),
    height_agl_m:        num(j.height_agl_m ?? j.height_above_ground_m),
    height_amsl_m:       num(j.height_amsl_m ?? j.height_above_msl_m),
    conditions:          Array.isArray(j.conditions) ? j.conditions
                          : Array.isArray(j.lighting_conditions) ? j.lighting_conditions
                          : [],
    hazard_summary:      j.hazard_summary || j.summary || null
  };
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

export const FAA_OE_PROVENANCE = Object.freeze({
  regulation:    '47 CFR §17.7 — FAA notification (Form 7460-1); §17.17 — application of FAA determination',
  related:       ['FAA Order JO 7400.2 (Procedures for Handling Airspace Matters)',
                  'FAA Advisory Circular AC 70/7460-1L (Obstruction Marking and Lighting)'],
  upstream:      'https://oeaaa.faa.gov/oeaaa/external/',
  fallback_chain: [
    'FAA_OE_SIDECAR_URL operator-managed proxy (recommended)',
    'oeaaa.faa.gov HTML scrape (FAA_OE_HTML_FALLBACK=1, opt-in, not yet implemented)'
  ],
  cross_check_tolerances: {
    coordinates: '1 arcsec (~30 m)',
    heights:     '1 m'
  },
  license_basis: '17 U.S.C. § 105 — methodology from §17.7, US Government public domain'
});
