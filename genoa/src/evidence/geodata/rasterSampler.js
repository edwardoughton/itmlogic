// Shared raster point-sample helper.
//
// Strategy: shell out to `gdallocationinfo -wgs84 -valonly <tif> <lon> <lat>`.
// This avoids pulling in a JS GeoTIFF dep (the corpus is ~tens of GB
// of LZW-compressed COGs and a native binary is the right tool).
//
// Behavior:
//   - If the binary is missing → returns { available:false, reason:'binary_unavailable' }.
//   - If the raster file is missing → returns { available:false, reason:'raster_unavailable' }.
//   - If the point is outside the raster's extent → gdallocationinfo
//     prints nothing to stdout; we surface that as outside_extent.
//   - If the pixel is NoData → numeric value is null with nodata=true.
//
// The shape returned is intentionally small; layer-specific samplers
// wrap it and add interpretation/warnings/replay.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
const pExec = promisify(execFile);

// Shape the replay command exactly as the operator would run it on the
// box — kept identical to the actual invocation below so reviewers can
// copy-paste and reproduce.
function replayCommand(bin, tif, lon, lat){
  return `${bin} -wgs84 -valonly ${tif} ${lon} ${lat}`;
}

export function makeRasterSampler({ bin } = {}){
  const binary = bin || 'gdallocationinfo';
  return async function sampleRaster({ tif, lon, lat, timeoutMs = 5_000 }){
    const replay = replayCommand(binary, tif, lon, lat);
    try {
      // Existence + readability check before invoking gdal — distinguishes
      // "raster missing" from "binary missing" cleanly.
      await fs.access(tif);
    } catch {
      return { available: false, reason: 'raster_unavailable', tif, replay };
    }
    let stdout, stderr;
    try {
      ({ stdout, stderr } = await pExec(
        binary,
        ['-wgs84', '-valonly', tif, String(lon), String(lat)],
        { timeout: timeoutMs, maxBuffer: 64 * 1024 }
      ));
    } catch (e){
      // ENOENT on the binary itself
      if (e && e.code === 'ENOENT'){
        return { available: false, reason: 'binary_unavailable', binary, replay };
      }
      return { available: false, reason: 'sample_failed',
               error: String(e?.message || e), stderr: e?.stderr, replay };
    }
    const trimmed = (stdout || '').trim();
    if (!trimmed){
      // Empty stdout = point outside raster extent (gdal prints nothing
      // and exits 0).  stderr may carry a "is outside the raster" notice.
      return { available: true, outside_extent: true, value: null, replay,
               stderr: (stderr || '').trim() || undefined };
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num)){
      // gdal sometimes prints the literal string 'nan' for NoData
      if (/^nan$/i.test(trimmed)){
        return { available: true, value: null, nodata: true, replay };
      }
      return { available: true, value: trimmed, replay };
    }
    return { available: true, value: num, replay };
  };
}
