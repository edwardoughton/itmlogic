// Operator-supplied SigMF override for the measurement-evidence flow.
//
// PURPOSE
//   The default measurement-evidence path is ZTR-driven: exhibitService
//   pulls captures off the rich-station response via getSdrEvidence().
//   This module adds a parallel path: an operator can attach a SigMF
//   blob directly on the job inputs, either inline (inputs.sigmf_meta)
//   or as a URL (inputs.sigmf_url), and have it normalised into the
//   same `sdrResp` shape the rest of the pipeline already consumes.
//
//   Producer side: scripts/sigmfFromKiwiCapture.js (CLI that turns a
//   KiwiSDR session + station metadata into a SigMF blob).
//
// AUTH
//   When the URL points at the ZTR app and ZTR_API_TOKEN is set in env,
//   the fetch attaches a Bearer header.  Detection is by URL prefix —
//   the URL must start with the configured ZTR app base
//   (process.env.ZTR_APP_URL or the public ondigitalocean.app default).
//
// SHAPE NOTES
//   parseSigmfMeta returns its own normalised records[] (keyed by
//   measured_dBu, lat, lon, timestamp) for the evidence block.  But
//   sdrCalibration.applyCalibration consumes the raw SigMF captures[]
//   directly — those carry per-capture `field_dBu` / `rssi_dbm` mirrors
//   that the builder stamps in.  We expose BOTH:
//     sdrResp.records      = the raw SigMF captures[] (for residuals)
//     sdrResp.sigmf_meta   = the parseSigmfMeta evidence block
//
//   This means downstream computeResidualTable() works without changes
//   while the evidence block still carries the SigMF metadata.

const ZTR_APP_URL_DEFAULT = 'https://zerotrustradio-app-vvhi8.ondigitalocean.app';

/**
 * Load operator-supplied SigMF override into an sdrResp-shaped object.
 *
 * @param {object} args
 * @param {object|null} args.inline    inputs.sigmf_meta — parsed JSON blob
 * @param {string|null} args.url       inputs.sigmf_url — fetchable URL
 * @param {number} args.timeoutMs      fetch timeout (default 15000)
 * @param {Function} [args.fetchImpl]  override globalThis.fetch (for tests)
 * @returns {Promise<null|{available, sdrResp, error?}>}
 *   null when neither inline nor url was supplied.
 */
export async function loadOperatorSigmfOverride({
  inline    = null,
  url       = null,
  timeoutMs = 15000,
  fetchImpl = globalThis.fetch
} = {}){
  if (!inline && !url) return null;

  let meta = null;
  let fetchedFrom = null;

  if (inline && typeof inline === 'object'){
    meta        = inline;
    fetchedFrom = 'inputs.sigmf_meta';
  } else if (url){
    if (typeof url !== 'string') {
      return { available: false, error: 'inputs.sigmf_url must be a string' };
    }
    const headers = { accept: 'application/json' };
    const ztrBase = process.env.ZTR_APP_URL || ZTR_APP_URL_DEFAULT;
    if (process.env.ZTR_API_TOKEN && url.startsWith(ztrBase)){
      headers['authorization'] = `Bearer ${process.env.ZTR_API_TOKEN}`;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { headers, signal: ctrl.signal });
      if (!res.ok){
        return { available: false, error: `fetch ${url} returned HTTP ${res.status}` };
      }
      meta = await res.json();
      fetchedFrom = url;
    } catch (e){
      return { available: false, error: `fetch ${url} failed: ${e.message}` };
    } finally {
      clearTimeout(timer);
    }
  }

  if (!meta || typeof meta !== 'object'){
    return { available: false, error: 'sigmf payload is not a JSON object' };
  }

  const { parseSigmfMeta } = await import('./sigmf.js');
  let parsed;
  try {
    parsed = parseSigmfMeta(meta, { source: fetchedFrom });
  } catch (e){
    return { available: false, error: `parseSigmfMeta failed: ${e.message}` };
  }
  if (!parsed.available){
    return { available: false, error: 'parsed SigMF reports available:false' };
  }
  if (!parsed.n_records || parsed.n_records === 0){
    // parseSigmfMeta is permissive — a blob with no captures[] still
    // "parses" but carries no measurement evidence.  Treat as no-op.
    return { available: false, error: 'parsed SigMF carried 0 records' };
  }

  const sdrResp = {
    available:                 true,
    source:                    parsed.source || 'inputs.sigmf_meta',
    endpoint:                  null,
    fetched_at:                new Date().toISOString(),
    captures_field:            fetchedFrom,
    n_records:                 parsed.n_records,
    n_records_raw:             parsed.n_records,
    n_dropped_service_filter:  0,
    n_dropped_sanity_filter:   0,
    calibrated:                parsed.calibrated,
    // Use raw SigMF captures[] (with per-capture field_dBu / rssi_dbm
    // mirrors stamped by the builder) so sdrCalibration.applyCalibration
    // sees the keys it expects.  parseSigmfMeta's normalised records[]
    // is hung off .sigmf_meta below for the evidence block.
    records:                   Array.isArray(meta.captures) ? meta.captures : [],
    sigmf_meta:                parsed
  };

  return { available: true, sdrResp };
}
