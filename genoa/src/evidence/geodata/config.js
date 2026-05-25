// Geodata layer configuration.
//
// Paths default to the canonical /opt/genoa corpus laid out by the
// operator (see GENOA_PROPAGATION_ARCHITECTURE.md on the prod server).
// Every path is overridable via env so unit tests and alternate
// deployments don't need the /opt tree.
//
// We do NOT throw if a path is missing on disk — each sampler reports
// its own availability so the manifest endpoint can show partial
// readiness instead of crashing the API.

import path from 'node:path';

const ROOT = process.env.GEODATA_ROOT || '/opt/genoa';

export const GEODATA_CONFIG = {
  root: ROOT,
  master_sha256_file:
    process.env.GEODATA_MASTER_SHA256_FILE
    || path.join(ROOT, 'MASTER_SHA256SUMS.txt'),
  manifests_dir:
    process.env.GEODATA_MANIFESTS_DIR
    || path.join(ROOT, 'manifests'),
  gdal_locationinfo_bin:
    process.env.GDAL_LOCATIONINFO_BIN || 'gdallocationinfo',
  // When set, raster sampling + presence checks go over HTTP to the
  // geodata sidecar (genoa/src/sidecars/geodata/) instead of touching
  // the local filesystem.  Required on DO App Platform where the
  // corpus lives on a separate droplet.
  sidecar_url:    process.env.GEODATA_SIDECAR_URL || null,
  sidecar_token:  (process.env.GEODATA_SIDECAR_TOKEN || '').trim() || null,

  layers: {
    nlcd_impervious_2024: {
      path: process.env.GEODATA_NLCD_PATH
        || path.join(ROOT, 'sources/nlcd/Annual_NLCD_FctImp_2024_CU_C1V1/Annual_NLCD_FctImp_2024_CU_C1V1.tif'),
      crs:           'EPSG:5070',
      dataset_class: 'NLCD impervious surface (0-100 %)',
      kind:          'raster'
    },
    nalcms_mexico_2020v2: {
      path: process.env.GEODATA_NALCMS_PATH
        || path.join(ROOT, 'sources/landcover/mex_land_cover_2020v2_30m_tif/MEX_NALCMS_landcover_2020v2_30m/data/MEX_NALCMS_landcover_2020v2_30m.tif'),
      crs:           'EPSG:6362',
      dataset_class: 'Mexico NALCMS land cover (19 classes)',
      kind:          'raster'
    },
    vegetation_perennial_herbaceous_2024: {
      path: process.env.GEODATA_VEGETATION_PATH
        || path.join(ROOT, 'sources/vegetation/2024_perennial_herbaceous_departure/2024_perennial_herbaceous_departure_20250608.tif'),
      crs:           'EPSG:5070',
      dataset_class: 'Perennial herbaceous departure (vegetation/fuel/clutter)',
      kind:          'raster'
    },
    m3_conductivity_postgis: {
      table:         process.env.GEODATA_M3_TABLE || 'm3_conductivity',
      geojson_source: process.env.GEODATA_M3_GEOJSON
        || path.join(ROOT, 'live-data/m3/AM_m3.geojson'),
      crs:           'EPSG:4326',
      dataset_class: 'FCC §73.190 M3 ground conductivity (BOUNDARY SEGMENTS — polygons not yet reconstructed)',
      kind:          'postgis'
    },
    terrain_globe: {
      dir: process.env.GEODATA_GLOBE_DIR
        || path.join(ROOT, 'sources/terrain/globe_all10'),
      crs:           'EPSG:4326',
      dataset_class: 'NOAA GLOBE 10-arc-second terrain tiles',
      kind:          'terrain_dir'
    },
    fcc_contour_evidence: {
      dir: process.env.GEODATA_FCC_PARITY_DIR
        || path.join(ROOT, 'live-data/fcc-contours/tests'),
      crs:           'EPSG:4326',
      dataset_class: 'FCC contour-API parity captures',
      kind:          'json_dir'
    }
  }
};

// Load MASTER_SHA256SUMS.txt — a `<sha256>  <relative path>` file
// produced by the corpus manager.  Returns a Map<absolutePath, sha256>.
// Returns an empty Map if the file isn't present (the layers still work,
// they just won't carry a hash).
import fs from 'node:fs/promises';
export async function loadMasterSha256Map(){
  const out = new Map();
  try {
    const txt = await fs.readFile(GEODATA_CONFIG.master_sha256_file, 'utf8');
    for (const raw of txt.split('\n')){
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
      if (!m) continue;
      const [, sha, rel] = m;
      out.set(path.resolve(GEODATA_CONFIG.root, rel), sha.toLowerCase());
    }
  } catch { /* file absent — layers run without sha annotation */ }
  return out;
}
