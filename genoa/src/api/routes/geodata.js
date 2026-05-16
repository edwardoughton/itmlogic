// Geodata evidence endpoints.
//
// Wires the geodata service to HTTP.  Every endpoint:
//   - validates lat/lon (numeric, in range)
//   - returns auditable JSON (source path, sha256 if attested, CRS,
//     pixel/class value, interpretation, warnings, replay command)
//   - degrades gracefully when a dataset, the gdal binary, or the
//     postgres pool isn't present
//
// These layers are deterministic evidence only — they do NOT modify
// FCC FORTRAN parity, the FCC contour curves, or any §73.207/§73.215
// verdict.

import express from 'express';
import { makeGeodataService, GEODATA_INVALID_COORDS, GEODATA_LAYER_NOT_FOUND } from '../../evidence/geodata/index.js';
import { pool, poolReady } from '../../db/pool.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

// Lazy singleton so the manifest sha-map is loaded once per process.
let _svc = null;
function getSvc(){
  if (_svc) return _svc;
  const query = poolReady()
    ? (sql, params) => pool().query(sql, params)
    : null;
  _svc = makeGeodataService({ query });
  return _svc;
}
// Test-only override hook (e.g. injecting a stub raster sampler).
export function _setGeodataServiceForTesting(svc){ _svc = svc; }

function parseLatLon(req){
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)
      || lat < -90 || lat > 90 || lon < -180 || lon > 180){
    const e = new Error('lat and lon are required, must be numeric, lat ∈ [-90,90], lon ∈ [-180,180]');
    e.code = GEODATA_INVALID_COORDS;
    e.httpStatus = 400;
    throw e;
  }
  return { lat, lon };
}

// Fan-out across every layer.
r.get('/geodata/sample', asyncHandler(async (req, res) => {
  const { lat, lon } = parseLatLon(req);
  res.json(await getSvc().sampleAll({ lat, lon }));
}));

r.get('/geodata/clutter', asyncHandler(async (req, res) => {
  const { lat, lon } = parseLatLon(req);
  res.json(await getSvc().sample({ layer: 'nlcd_impervious_2024', lat, lon }));
}));

r.get('/geodata/landcover/mexico', asyncHandler(async (req, res) => {
  const { lat, lon } = parseLatLon(req);
  res.json(await getSvc().sample({ layer: 'nalcms_mexico_2020v2', lat, lon }));
}));

r.get('/geodata/vegetation', asyncHandler(async (req, res) => {
  const { lat, lon } = parseLatLon(req);
  res.json(await getSvc().sample({ layer: 'vegetation_perennial_herbaceous_2024', lat, lon }));
}));

r.get('/geodata/conductivity', asyncHandler(async (req, res) => {
  const { lat, lon } = parseLatLon(req);
  res.json(await getSvc().sample({ layer: 'm3_conductivity_postgis', lat, lon }));
}));

r.get('/geodata/terrain/status', asyncHandler(async (_req, res) => {
  res.json(await getSvc().terrainStatus());
}));

// Manifest — readiness of every configured layer, paths + shas + CRS.
r.get('/geodata/manifest', asyncHandler(async (_req, res) => {
  res.json(await getSvc().manifest());
}));

// Translate domain error codes to HTTP responses.
r.use((err, _req, res, next) => {
  if (!err) return next();
  if (err.code === GEODATA_INVALID_COORDS) return res.status(400).json({ error: err.code, message: err.message });
  if (err.code === GEODATA_LAYER_NOT_FOUND) return res.status(404).json({ error: err.code });
  return next(err);
});

export default r;
