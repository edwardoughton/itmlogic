// Geo-RF Evidence sidecar route.
//
//   GET /api/geo-rf-evidence/health
//     → 200 { ok, configured, healthy, baseUrl, service, datasets }
//
//   GET /api/geo-rf-evidence/sample?lat=&lon=&service=&call=&facility_id=
//     → 200 { ...envelope }   (status=run|not_configured|failed|offline)
//
//   The envelope carries multiple dataset slots
//   (tree_canopy, landcover, tau_rf_models,
//    fcc_m3_conductivity_availability, water_proximity,
//    climate_projection_availability, sdr_residual_support, and the
//    legacy tree_canopy_conus / canada_landcover aliases) plus a
//    `map_marker` for the contour map and a `confidence_scoring_context`
//    structure for Appendix I.  The client tries `/sample/all` first and
//    falls back to parallel point endpoints.  Slots the sidecar doesn't
//    expose appear as `{available:false}` — never invented data.
//
// ADVISORY ONLY.  Independent environmental RF evidence beside FCC rule
// math.  Never overrides §73.184 / §73.182 / §73.190 / §73.313 / §73.207
// / §73.215 calculations.
//
// REGULATORY POSTURE
//   Environmental RF evidence is advisory only.  Does not modify FCC
//   filing-controlling contour or allocation calculations.

import express from 'express';
import { sidecars } from '../services/sidecars.js';
import { geoRfNotConfigured } from '../../evidence/geoRfEvidenceClient.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

r.get('/geo-rf-evidence/health', asyncHandler(async (req, res) => {
  if (!sidecars.geoRfEvidence){
    return res.json({
      ok:         false,
      configured: false,
      healthy:    false,
      service:    'genoa-geo-rf-evidence',
      datasets:   {}
    });
  }
  const detail = await sidecars.geoRfEvidence.healthDetail();
  res.json({
    ok:         true,
    configured: true,
    healthy:    !!detail?.ok,
    baseUrl:    sidecars.geoRfEvidence.baseUrl,
    service:    detail?.service || 'genoa-geo-rf-evidence',
    datasets:   detail?.datasets || {},
    error:      detail?.ok ? undefined : (detail?.error || 'sidecar unreachable')
  });
}));

r.get('/geo-rf-evidence/sample', asyncHandler(async (req, res) => {
  const lat         = Number(req.query.lat);
  const lon         = Number(req.query.lon);
  const service     = req.query.service ? String(req.query.service) : null;
  const call        = req.query.call ? String(req.query.call) : null;
  const facility_id = req.query.facility_id ? String(req.query.facility_id) : null;

  if (!sidecars.geoRfEvidence){
    return res.json(geoRfNotConfigured({ lat, lon, service, call, facility_id }));
  }
  const out = await sidecars.geoRfEvidence.sampleGeoRfEvidenceForFacility({
    lat, lon, service, call, facility_id
  });
  res.json(out);
}));

export default r;
