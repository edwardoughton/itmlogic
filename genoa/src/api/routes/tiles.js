// Vector-tile reverse proxy — /tiles/* → Martin (droplet vector tile server).
//
// The browser fetches tiles same-origin over HTTPS (https://host/tiles/…)
// so there's no mixed-content block and the tile server is never exposed
// to clients directly.  Read-only (GET); forwards path + query verbatim
// and streams the upstream body (protobuf tile or JSON catalog/TileJSON)
// back with its content-type.  Martin serves /catalog, /{source} (TileJSON),
// and /{source}/{z}/{x}/{y} (no extension).
//
//   TILES_UPSTREAM_URL  upstream base (default: droplet Martin :3000).
//                       PG_TILESERV_URL still honored as a fallback.
//   TILES_UPSTREAM_SECRET  optional shared secret sent as x-tiles-secret,
//                          for when the droplet firewalls the port to
//                          require it (no-op while unset).
//
// Mounted PUBLIC (before the /api auth gate): the tile server is already a
// public endpoint, so gating adds no security but would risk breaking tile
// loads.  Move under requireAuth later if tiles should be gated.

import express from 'express';

const router   = express.Router();
const UPSTREAM  = String(process.env.TILES_UPSTREAM_URL || process.env.PG_TILESERV_URL || 'http://165.245.171.116:3000').replace(/\/+$/, '');
const SECRET    = process.env.TILES_UPSTREAM_SECRET || process.env.PG_TILESERV_SECRET || '';

router.get('/*', async (req, res) => {
  // req.url is relative to the /tiles mount, e.g. /stations/6/10/25
  const target = UPSTREAM + req.url;
  try {
    const upstream = await fetch(target, SECRET ? { headers: { 'x-tiles-secret': SECRET } } : undefined);
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    res.set('cache-control', upstream.headers.get('cache-control') || 'public, max-age=300');
    const body = Buffer.from(await upstream.arrayBuffer());
    res.send(body);
  } catch (err) {
    res.status(502).json({ error: 'tile upstream unreachable', upstream: UPSTREAM, detail: String(err?.message || err) });
  }
});

export default router;
