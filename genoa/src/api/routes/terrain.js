// Self-hosted terrain-DEM proxy — /terrain/{z}/{x}/{y}.png → public
// Terrarium elevation tiles, served same-origin so MapLibre can read the
// DEM pixels for the hillshade layer without a CORS/canvas-taint problem
// (and so no third-party host appears in the frontend, matching /basemap
// and /tiles).  Terrarium-encoded RGB → elevation; the map source declares
// encoding:'terrarium'.
//
//   TERRAIN_DEM_URL  base URL of the {z}/{x}/{y}.png tileset.  Defaults to
//                    the AWS Open Data Terrain Tiles mirror.
//
// Mounted PUBLIC (before the /api auth gate).

import express from 'express';

const router = express.Router();
const DEM_BASE = (process.env.TERRAIN_DEM_URL || 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium').replace(/\/$/, '');
// Only proxy well-formed tile paths — blocks path traversal / SSRF.
const TILE_RE = /^\/\d{1,2}\/\d{1,7}\/\d{1,7}\.png$/;

router.get('/*', async (req, res) => {
  if (!TILE_RE.test(req.path)){
    return res.status(400).json({ error: 'expected /{z}/{x}/{y}.png' });
  }
  try {
    const upstream = await fetch(DEM_BASE + req.path);
    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'etag', 'last-modified']){
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    res.setHeader('cache-control', upstream.headers.get('cache-control') || 'public, max-age=604800');
    res.setHeader('access-control-allow-origin', '*');
    res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    res.status(502).json({ error: 'terrain upstream unreachable', detail: String(err?.message || err) });
  }
});

export default router;
