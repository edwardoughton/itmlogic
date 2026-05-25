// SDR-capture audio proxy.
//
// ZTR's capture audio endpoint is
//   <ZTR_APP_URL>/api/sdr/captures/<capture_id>/audio
// which is auth-gated and on a different origin from the genoa UI
// (genoaiq.com).  Cross-origin <audio src=...> from the browser would
// need either a public bucket or a CORS-credentials handshake.
// Simpler and more secure: proxy via genoa.
//
//   GET /api/captures/:capture_id/audio
//     -> proxies to ZTR_APP_URL/api/sdr/captures/:capture_id/audio
//     -> attaches ZTR_API_TOKEN as Bearer when configured
//     -> streams the response body verbatim (Content-Type passthrough)
//
// The UI's evidence panel renders <audio controls src="/api/captures/:id/audio">
// so the browser doesn't see the ZTR origin at all.

import express from 'express';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

const ZTR_APP_URL_DEFAULT = 'https://zerotrustradio-app-vvhi8.ondigitalocean.app';

r.get('/captures/:capture_id/audio', asyncHandler(async (req, res) => {
  const id = String(req.params.capture_id || '').trim();
  // Defensive: capture ids are numeric.  Reject anything else to stop
  // the proxy from being used as an open SSRF vector.
  if (!/^[0-9]+$/.test(id)){
    return res.status(400).json({
      error:   'BAD_REQUEST',
      detail:  'capture_id must be a numeric ZTR capture id'
    });
  }

  const base = (process.env.ZTR_APP_URL || ZTR_APP_URL_DEFAULT).replace(/\/+$/, '');
  const url  = `${base}/api/sdr/captures/${id}/audio`;
  const headers = {};
  if (process.env.ZTR_API_TOKEN){
    headers['authorization'] = `Bearer ${process.env.ZTR_API_TOKEN}`;
  }
  // Pass through Range so the browser's <audio> can seek.
  if (req.headers.range) headers['range'] = req.headers.range;

  let upstream;
  try {
    upstream = await fetch(url, { headers });
  } catch (e){
    return res.status(502).json({
      error:  'UPSTREAM_FETCH_FAILED',
      detail: String(e.message),
      url
    });
  }
  if (!upstream.ok && upstream.status !== 206){
    return res.status(upstream.status).json({
      error:  'UPSTREAM_HTTP',
      status: upstream.status,
      url
    });
  }

  res.status(upstream.status);
  // Mirror the headers the browser's <audio> element cares about so
  // seeking + progress display work.
  const passthrough = [
    'content-type', 'content-length', 'accept-ranges',
    'content-range', 'cache-control', 'last-modified', 'etag'
  ];
  for (const h of passthrough){
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  // Default to audio/wav if upstream didn't tag it.
  if (!upstream.headers.get('content-type')){
    res.setHeader('content-type', 'audio/wav');
  }

  // Stream the body.  Use Node 20's Web-to-Node bridge.
  if (upstream.body && typeof upstream.body.getReader === 'function'){
    const reader = upstream.body.getReader();
    res.on('close', () => { try { reader.cancel(); } catch { /* ignore */ } });
    while (true){
      const { value, done } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))){
        await new Promise(resolve => res.once('drain', resolve));
      }
    }
  }
  res.end();
}));

export default r;
