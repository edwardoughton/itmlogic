// Genoa map-sidecar client.
//
// Fetches a printable contour-map PNG from the headless-Chromium map
// sidecar (genoa/src/sidecars/map/) and returns it as a Buffer.  The
// engineering-statement PDF embeds the result as a numbered exhibit
// page; the LMS filing-package contour-map deliverable references the
// same render.
//
// Fail-soft: when MAP_SIDECAR_URL is unset, or the sidecar returns an
// error, this resolves to `null` instead of throwing.  The PDF render
// pipeline then skips the contour-map section gracefully — never
// crashes the export over a sidecar outage.
//
// Defensive: every byte returned to the caller is verified to start
// with a PNG magic header (89 50 4E 47 0D 0A 1A 0A).  If the sidecar
// somehow returns HTML, JSON, or a JSON-stringified Uint8Array (which
// happens when a Node service forgets to wrap a typed-array in
// Buffer.from), we log + return null instead of letting pdfkit blow
// up downstream with "Unknown image format".

// Map sidecar fetch timeout.  Per the operator's standing rule —
// "no rush on the speed of creation; everything can run as long as
// needed for the job to finish; downstream waits for upstream before
// its clock starts" — the API gives the map sidecar a generous ceiling
// rather than racing it.  The sidecar's own internal hard fallback
// (render.html HARD_FALLBACK_MS = 9 s) prevents a runaway Chromium
// from holding a connection open the full window, so increasing the
// client-side ceiling only HELPS slow-render cases finish; it can't
// stretch a healthy render's actual latency.
//
// 240 s (4 min) default matches the engineering-statement PDF
// generation envelope the operator described.  Operator can override
// via MAP_SIDECAR_TIMEOUT_MS for short-budget pipelines.
// The map sidecar is OPTIONAL — when it's slow or unreachable, the
// PDF embeds a "deferred to engineer" placeholder instead of a render.
// 60 seconds is the right ceiling: under healthy load the chromium /
// Leaflet render returns in 5–15 s, so 60 s is 4× headroom; beyond
// that we'd rather ship the PDF with a placeholder than block the
// engineer's compute for another three minutes.  Operators who run a
// custom map sidecar on slower hardware can bump this via
// MAP_SIDECAR_TIMEOUT_MS on the deploy.
const DEFAULT_TIMEOUT_MS = Number(process.env.MAP_SIDECAR_TIMEOUT_MS) || 60_000;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function isPng(buf){
  if (!Buffer.isBuffer(buf) || buf.length < 8) return false;
  return buf.subarray(0, 8).equals(PNG_MAGIC);
}

export async function fetchMapRender(exhibit, options = {}){
  const url = process.env.MAP_SIDECAR_URL;
  if (!url) return null;
  if (!exhibit || typeof exhibit !== 'object') return null;
  // Sidecar requires station_inputs.{lat,lon}; if missing the render
  // will be a "coordinates missing" placeholder, which is still useful
  // as a sanity check, so we send it anyway and let the sidecar decide.

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || DEFAULT_TIMEOUT_MS);
  try {
    const r = await fetch(`${url.replace(/\/+$/, '')}/render`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ exhibit, options }),
      signal:  controller.signal
    });
    if (!r.ok){
      const detail = await r.text().catch(() => '');
      console.warn(`[mapClient] sidecar render failed: HTTP ${r.status}${detail ? ' — ' + detail.slice(0, 200) : ''}`);
      return null;
    }
    const ct = String(r.headers.get('content-type') || '').toLowerCase();
    if (!ct.startsWith('image/')){
      const detail = await r.text().catch(() => '');
      console.warn(`[mapClient] sidecar returned non-image content-type "${ct}"; refusing to embed.${detail ? ' body: ' + detail.slice(0, 200) : ''}`);
      return null;
    }
    const ab = await r.arrayBuffer();
    const buf = Buffer.from(ab);
    if (!isPng(buf)){
      console.warn(`[mapClient] sidecar response did not start with a PNG magic header (len=${buf.length}); refusing to embed.  First 16 bytes: ${buf.subarray(0, 16).toString('hex')}`);
      return null;
    }
    return buf;
  } catch (err){
    console.warn('[mapClient] sidecar unreachable:', err?.message || err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Synchronous helper used by section builders that already have the
// rendered image stuffed into options.contour_map_png (Buffer or
// base64 string).  Returns either a verified-PNG Buffer or null.
export function coerceMapBuffer(input){
  if (!input) return null;
  if (Buffer.isBuffer(input)) return isPng(input) ? input : null;
  if (typeof input === 'string'){
    // Strip data: URI prefix if present.
    const stripped = input.startsWith('data:') ? input.split(',')[1] : input;
    try {
      const buf = Buffer.from(stripped, 'base64');
      return isPng(buf) ? buf : null;
    } catch { return null; }
  }
  return null;
}
