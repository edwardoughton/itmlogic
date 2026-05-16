// Geodata evidence layer — public surface.
//
// Wires the config + shas + samplers + Postgres adapter together
// behind a small factory so the API route can call layer methods
// without knowing about gdal/pg/fs.  Tests construct the factory
// with stub adapters.

import fs from 'node:fs/promises';
import { GEODATA_CONFIG, loadMasterSha256Map } from './config.js';
import { makeRasterSampler } from './rasterSampler.js';
import { makeHttpRasterSampler } from './httpRasterSampler.js';
import {
  sampleNlcdImpervious,
  sampleNalcmsMexico,
  sampleVegetationDeparture,
  sampleM3Conductivity,
  reportTerrainStatus
} from './layers.js';

// Public response codes for the routes to translate to HTTP status.
export const GEODATA_LAYER_NOT_FOUND = 'GEODATA_LAYER_NOT_FOUND';
export const GEODATA_INVALID_COORDS  = 'GEODATA_INVALID_COORDS';

export function makeGeodataService({
  config = GEODATA_CONFIG,
  raster,         // (rasterSampler-shaped fn) — defaults to sidecar HTTP if
                  // GEODATA_SIDECAR_URL is set, otherwise local gdallocationinfo
  statRasterRemote,  // optional: ({path}) => Promise<{exists,size?}>; used
                     // by the manifest endpoint to detect file presence
                     // when the corpus lives on a sidecar (App Platform)
  query,          // (sql, params) => Promise<{rows}> — defaults to pgPool.query
  listDir = fs.readdir,
  shaMapPromise,  // overridable for tests
  now             // overridable for tests
} = {}){
  let _statRemote = statRasterRemote || null;
  let _raster = raster;
  let _shaMapOverride = null;
  if (!_raster){
    if (config.sidecar_url){
      const http = makeHttpRasterSampler({
        baseUrl:  config.sidecar_url,
        apiToken: config.sidecar_token
      });
      _raster = http.sampleRaster;
      if (!_statRemote) _statRemote = (p) => http.statRaster(p);
      // Master sha map also comes from the sidecar in App Platform
      // mode — the local MASTER_SHA256SUMS.txt isn't on the container.
      _shaMapOverride = http.fetchMasterShas({ corpusRoot: config.root });
    } else {
      _raster = makeRasterSampler({ bin: config.gdal_locationinfo_bin });
    }
  }
  const _shaMap = shaMapPromise || _shaMapOverride || loadMasterSha256Map();
  const shaFor = async (p) => (await _shaMap).get(p) || null;

  async function sample({ layer, lat, lon }){
    validateCoords(lat, lon);
    const cfg = config.layers[layer];
    if (!cfg) return { error: GEODATA_LAYER_NOT_FOUND, layer };

    switch (layer){
      case 'nlcd_impervious_2024':
        return sampleNlcdImpervious({
          lat, lon, layerCfg: cfg,
          sha256: await shaFor(cfg.path),
          raster: _raster, now
        });
      case 'nalcms_mexico_2020v2':
        return sampleNalcmsMexico({
          lat, lon, layerCfg: cfg,
          sha256: await shaFor(cfg.path),
          raster: _raster, now
        });
      case 'vegetation_perennial_herbaceous_2024':
        return sampleVegetationDeparture({
          lat, lon, layerCfg: cfg,
          sha256: await shaFor(cfg.path),
          raster: _raster, now
        });
      case 'm3_conductivity_postgis':
        if (!query){
          return {
            lat, lon, layer,
            source: { table: cfg.table, crs: cfg.crs, dataset_class: cfg.dataset_class },
            value: null, value_kind: 'm3_S_per_m_nearest_boundary',
            interpretation: 'sampler unavailable',
            warnings: ['postgres pool not configured for geodata service'],
            replay: null,
            sampled_at: (now || new Date()).toISOString()
          };
        }
        return sampleM3Conductivity({ lat, lon, layerCfg: cfg, query, now });
      default:
        return { error: GEODATA_LAYER_NOT_FOUND, layer };
    }
  }

  // /api/geodata/sample — fan-out across every available layer for a
  // single coordinate.  Each layer's result stands on its own; nothing
  // is blended into FCC curves.
  async function sampleAll({ lat, lon }){
    validateCoords(lat, lon);
    const layers = ['nlcd_impervious_2024', 'nalcms_mexico_2020v2',
                    'vegetation_perennial_herbaceous_2024',
                    'm3_conductivity_postgis'];
    const results = await Promise.all(layers.map((l) => sample({ layer: l, lat, lon })));
    return {
      lat, lon,
      layers: Object.fromEntries(layers.map((l, i) => [l, results[i]])),
      sampled_at: (now || new Date()).toISOString()
    };
  }

  async function terrainStatus(){
    return reportTerrainStatus({ layerCfg: config.layers.terrain_globe, listDir });
  }

  // /api/geodata/manifest — list every configured layer with status
  // (available / partial / pending_georef / unavailable), path, sha256
  // (if attested in MASTER_SHA256SUMS.txt), and crs.
  async function manifest(){
    const shaMap = await _shaMap;
    const out = [];
    for (const [id, cfg] of Object.entries(config.layers)){
      const row = {
        id,
        crs:           cfg.crs,
        dataset_class: cfg.dataset_class,
        kind:          cfg.kind,
        warnings:      []
      };
      if (cfg.kind === 'raster'){
        row.path   = cfg.path;
        row.sha256 = shaMap.get(cfg.path) || null;
        // If a remote stat is configured (sidecar mode), use it —
        // otherwise the local fs check is meaningless on App Platform.
        if (_statRemote){
          const st = await _statRemote(cfg.path);
          row.status = st?.exists ? 'available' : 'missing';
          if (Number.isFinite(st?.size)) row.size = st.size;
          row.via    = 'sidecar';
        } else {
          row.status = await fileExists(cfg.path) ? 'available' : 'missing';
        }
      } else if (cfg.kind === 'postgis'){
        row.table = cfg.table;
        row.source_geojson = cfg.geojson_source;
        row.sha256 = shaMap.get(cfg.geojson_source) || null;
        row.status = 'partial';
        row.warnings.push('boundary LINESTRINGs only — conductivity polygons not yet reconstructed');
      } else if (cfg.kind === 'terrain_dir'){
        row.dir    = cfg.dir;
        row.status = 'pending_georef';
        row.warnings.push('tile bounds not yet attested — terrain sampling intentionally disabled');
      } else if (cfg.kind === 'json_dir'){
        row.dir    = cfg.dir;
        if (_statRemote){
          const st = await _statRemote(cfg.dir);
          row.status = (st?.exists && st?.is_dir) ? 'available' : 'missing';
          row.via    = 'sidecar';
        } else {
          row.status = await dirExists(cfg.dir) ? 'available' : 'missing';
        }
        // Directory rollup sha (sha-of-shas of contents).  Operators
        // append a single line for the dir path to MASTER_SHA256SUMS.txt;
        // see scripts/regen-master-shas.sh for the canonical recipe.
        row.sha256 = await shaFor(cfg.dir);
      }
      out.push(row);
    }
    return {
      geodata_root:                config.root,
      master_sha256sums_path:      config.master_sha256_file,
      master_sha256sums_present:   shaMap.size > 0,
      master_sha256sums_count:     shaMap.size,
      layers:                      out,
      generated_at:                (now || new Date()).toISOString()
    };
  }

  return { sample, sampleAll, terrainStatus, manifest };
}

function validateCoords(lat, lon){
  const la = Number(lat), lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)
      || la < -90 || la > 90 || lo < -180 || lo > 180){
    const err = new Error('invalid lat/lon');
    err.code = GEODATA_INVALID_COORDS;
    throw err;
  }
}
async function fileExists(p){
  try { const s = await fs.stat(p); return s.isFile(); } catch { return false; }
}
async function dirExists(p){
  try { const s = await fs.stat(p); return s.isDirectory(); } catch { return false; }
}
