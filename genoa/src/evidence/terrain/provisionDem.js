// Genoa DEM tile provisioner — drives the splat sidecar's
// /api/v1/sdf/convert/srtm/<n> endpoint.
//
// Goal: given a tx (lat, lon) + radius_km, make sure the splat sidecar
// has SDF tiles staged for every 1°×1° SRTM-3 tile that intersects the
// coverage circle, so a subsequent splatClient.predictItmCoverage() call
// runs terrain-aware instead of falling back to flat-earth.
//
// Flow:
//   1. Compute the list of tiles needed via srtmCatalog.tilesForBounds.
//   2. List the sidecar's current SDF inventory.
//   3. Skip any tiles already covered (set membership on SW-corner
//      coords parsed from the .sdf names).
//   4. For each missing tile, fetch the .hgt.zip from a public mirror
//      (configurable via SRTM_TILE_URL_TEMPLATE) and POST to
//      splatClient.convertSrtmHgt.  The sidecar unzips + runs srtm2sdf
//      + stages the .sdf in WORKDIR/sdf/.
//   5. Return a per-tile report so the caller can tell what worked,
//      what was already there, and what failed.
//
// Fail-soft: a failed mirror fetch or sidecar conversion error doesn't
// abort the whole batch — each tile records its own status.  The
// caller decides whether the partial coverage is good enough.
//
// Concurrency: tiles are fetched serially by default to be polite to
// the public mirror.  Set `concurrency` > 1 if the mirror tolerates
// it — the public ESA STEP server has been seen to rate-limit at ~5
// concurrent connections, so default 1 is safest.

import { tilesForBounds, missingFrom, urlFor } from './srtmCatalog.js';

const FETCH_TIMEOUT_MS  = 60_000;   // public mirrors can be slow
const CONVERT_TIMEOUT_MS = 90_000;  // srtm2sdf is fast but allow buffer

export async function provisionDemForCoverage({
  tx,
  radius_km        = 80,
  splatClient,
  url_template     = null,        // override SRTM_TILE_URL_TEMPLATE per-call
  concurrency      = 1,           // serial by default
  log              = console
} = {}){
  if (!splatClient){
    return { available: false, error: 'splatClient required' };
  }
  if (!tx || !Number.isFinite(Number(tx.lat)) || !Number.isFinite(Number(tx.lon))){
    return { available: false, error: 'tx.lat / tx.lon required' };
  }

  // 1. Build the wishlist.
  const requested = tilesForBounds({
    lat: Number(tx.lat),
    lon: Number(tx.lon),
    radius_km,
  });
  if (requested.length === 0){
    return { available: false, error: 'no SRTM tiles intersect coverage circle' };
  }

  // 2. Probe the sidecar's current SDF inventory.
  const inventory = await splatClient.listSdfTiles();
  if (!inventory.available){
    log.warn?.('[provisionDem] sidecar inventory unreachable:', inventory.error);
  }

  // 3. Set difference.
  const missing = missingFrom(requested, inventory.tiles || []);
  const skipped = requested.length - missing.length;
  log.info?.(`[provisionDem] requested=${requested.length} skipped=${skipped} missing=${missing.length}`);

  // 4. Fetch + convert each missing tile.  Build the worker once,
  // reuse for either serial or pooled concurrency.
  const provisioned = [];
  const failed      = [];

  async function provisionOne(tile){
    const url = urlFor(`${tile.name}.zip`, url_template || undefined);
    let zipBytes;
    try {
      const ac = new AbortController();
      const t  = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      const r  = await fetch(url, { signal: ac.signal });
      clearTimeout(t);
      if (!r.ok){
        failed.push({ tile: tile.name, stage: 'fetch', status: r.status, url, error: `HTTP ${r.status}` });
        return;
      }
      zipBytes = new Uint8Array(await r.arrayBuffer());
    } catch (err){
      failed.push({ tile: tile.name, stage: 'fetch', url, error: String(err?.message || err) });
      return;
    }

    // Server-side conversion.  Note the converter timeout in the
    // splatClient is UPLOAD_TIMEOUT_MS (60s); the sidecar's own
    // srtm2sdf timeout is 120s.
    const result = await splatClient.convertSrtmHgt(`${tile.name}.zip`, zipBytes);
    if (!result.available){
      failed.push({
        tile:   tile.name,
        stage:  'convert',
        status: result.status,
        error:  result.error,
      });
      return;
    }
    provisioned.push({
      tile:        tile.name,
      sdf_name:    result.name,
      size_bytes:  result.size_bytes,
      url:         result.url,
      runtime_seconds: result.runtime_seconds,
    });
  }

  if (concurrency <= 1){
    for (const tile of missing){
      await provisionOne(tile);
    }
  } else {
    // Simple pooled worker: chunk the missing list and run in parallel.
    const queue = [...missing];
    const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length){
        await provisionOne(queue.shift());
      }
    });
    await Promise.all(workers);
  }

  return {
    available:    failed.length === 0 && missing.length > 0
                  ? true
                  : (provisioned.length > 0),  // partial-success counts as available
    requested:    requested.length,
    skipped,
    provisioned:  provisioned.length,
    failed:       failed.length,
    tiles: {
      provisioned,
      skipped: skipped > 0
        ? requested.filter(t => !missing.some(m => m.name === t.name)).map(t => t.name)
        : [],
      failed,
    },
    coverage: {
      tx_lat:    Number(tx.lat),
      tx_lon:    Number(tx.lon),
      radius_km,
    },
  };
}
