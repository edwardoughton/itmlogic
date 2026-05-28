// Self-hosted basemap proxy — /basemap → a PMTiles file on Spaces.
//
// PMTiles is a single-file tile archive read over HTTP *range* requests,
// so this forwards the Range header and passes back 206 / Content-Range.
// Serving it same-origin (https://host/basemap) means the basemap renders
// even when an ad-blocker / privacy extension blocks third-party CDNs —
// the failure mode we hit with the external CARTO basemap.
//
//   BASEMAP_URL  full URL of the .pmtiles object (e.g. a DO Spaces URL).
//
// The map style then references it as:
//   { "type": "vector", "url": "pmtiles://https://<host>/basemap" }
//
// Mounted PUBLIC (before the /api auth gate); returns 503 until configured.

import express from 'express';
import { Readable } from 'node:stream';

const router = express.Router();
const BASEMAP_URL = process.env.BASEMAP_URL || '';
const UPSTREAM_TIMEOUT_MS = parseInt(process.env.BASEMAP_TIMEOUT_MS || '20000', 10);

router.get('/*', async (req, res) => {
  if (!BASEMAP_URL){
    return res.status(503).json({
      error: 'BASEMAP_URL not configured',
      hint:  'set BASEMAP_URL to the Spaces URL of the basemap .pmtiles file'
    });
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), UPSTREAM_TIMEOUT_MS);
  res.on('close', () => clearTimeout(timer));
  try {
    const range    = req.headers.range;
    const upstream = await fetch(BASEMAP_URL, {
      headers: range ? { Range: range } : undefined,
      signal:  ac.signal
    });
    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'last-modified']){
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('cache-control', upstream.headers.get('cache-control') || 'public, max-age=86400');
    if (!upstream.body){
      res.end();
      return;
    }
    // Stream the upstream body straight through — never buffer the whole
    // archive.  A no-Range request would otherwise pull the entire
    // multi-hundred-MB PMTiles file into memory and exceed the gateway
    // timeout (the 504 we were seeing); buffering also serialized every
    // range read through a full arrayBuffer().
    Readable.fromWeb(upstream.body).pipe(res).on('error', () => { try { res.destroy(); } catch { /* noop */ } });
  } catch (err) {
    clearTimeout(timer);
    if (!res.headersSent){
      const aborted = err?.name === 'AbortError';
      res.status(aborted ? 504 : 502).json({
        error:  aborted ? 'basemap upstream timeout' : 'basemap upstream unreachable',
        detail: String(err?.message || err)
      });
    }
  }
});

export default router;
