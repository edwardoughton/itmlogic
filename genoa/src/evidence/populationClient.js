// Sourced population evidence adapter.
//
// Genoa NEVER invents population numbers.  This module asks an external
// adapter (env: POPULATION_EVIDENCE_URL) for a population estimate over
// a contour polygon and returns ONLY a fully-validated record:
//
//   {
//     available:   true,
//     persons:     <integer>,
//     source:      <string, e.g. "US Census Bureau ACS 5-year">,
//     dataset:     <string, e.g. "ACS 2022 5-year">,
//     vintage:     <number | string, e.g. 2022>,
//     method:      <string, e.g. "block-group geometry intersection">,
//     fetched_at:  <ISO timestamp>,
//     endpoint:    <URL the response came from>,
//     sha256:      <optional content hash>,
//     contour_label: <string, e.g. "60 dBu (1 mV/m service)">
//   }
//
// If POPULATION_EVIDENCE_URL is unset, the adapter returns null.
// If the upstream response is missing any required field
// (persons, source, vintage, method, fetched_at), the adapter returns
//   { available: false, source: null, error: 'malformed_response',
//     missing: [...field_names] }
// and the caller MUST keep POPULATION_PLACEHOLDER.
//
// This is the authority-style validation gate the directive asked for:
// "only clear POPULATION_PLACEHOLDER when estimate exists, source is
//  identified, vintage/year is present, geometry/method is described,
//  timestamp/provenance is stamped."

const DEFAULT_TIMEOUT_MS = 15_000;
const REQUIRED_FIELDS = ['persons', 'source', 'vintage', 'method', 'fetched_at'];

export function makePopulationClient({
  baseUrl = process.env.POPULATION_EVIDENCE_URL || null,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}){
  if (!baseUrl) return null;
  return {
    baseUrl,
    async populationForContour({ geojson, contour_label }){
      if (!geojson || !geojson.type) {
        return { available: false, source: null, error: 'no_geojson' };
      }
      const endpoint = joinUrl(baseUrl, '/v1/population/contour');
      let raw;
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ geojson, contour_label }),
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!r.ok) {
          return { available: false, source: null, endpoint, error: `HTTP ${r.status}` };
        }
        raw = await r.json();
      } catch (e) {
        return { available: false, source: null, endpoint, error: String(e.message) };
      }
      return validateResponse(raw, { endpoint, contour_label });
    }
  };
}

// Pure: takes a parsed upstream payload and validates it.  Exported so
// tests can exercise the validation gate independently of the network.
export function validateResponse(raw, { endpoint = null, contour_label = null } = {}){
  if (!raw || typeof raw !== 'object'){
    return { available: false, source: null, endpoint, error: 'malformed_response', missing: REQUIRED_FIELDS };
  }
  const missing = [];
  for (const k of REQUIRED_FIELDS){
    if (raw[k] === undefined || raw[k] === null || raw[k] === '') missing.push(k);
  }
  // Type checks beyond plain presence.
  if (!missing.includes('persons') && !Number.isFinite(Number(raw.persons))){
    missing.push('persons');
  }
  if (!missing.includes('vintage')
      && !(Number.isFinite(Number(raw.vintage)) || typeof raw.vintage === 'string')){
    missing.push('vintage');
  }
  if (!missing.includes('fetched_at') && !isIsoTimestamp(raw.fetched_at)){
    missing.push('fetched_at');
  }
  if (missing.length){
    return { available: false, source: null, endpoint, error: 'malformed_response', missing };
  }
  return {
    available:     true,
    persons:       Math.round(Number(raw.persons)),
    source:        String(raw.source),
    dataset:       raw.dataset ? String(raw.dataset) : null,
    vintage:       raw.vintage,
    method:        String(raw.method),
    fetched_at:    raw.fetched_at,
    endpoint,
    sha256:        raw.sha256 || null,
    contour_label
  };
}

function isIsoTimestamp(s){
  if (typeof s !== 'string' || s.length < 10) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

function joinUrl(base, suffix){
  if (base.endsWith('/')) base = base.slice(0, -1);
  if (!suffix.startsWith('/')) suffix = '/' + suffix;
  return base + suffix;
}

export const POPULATION_REQUIRED_FIELDS = REQUIRED_FIELDS;
