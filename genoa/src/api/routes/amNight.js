// AM nighttime allocation routes.
//
//   POST /api/am-night/nif
//     body: {
//       proposed: { lat, lon, freq_khz, erp_kw, fcc_class,
//                   pattern_table?, pattern_mode?: 'omni'|'DA',
//                   facility_id? },
//       options?: { radius_km?, azimuths_deg?, duDbOverride?, max_interferers? }
//     }
//     → 200 { available, contour, polygon, interferers, summary, provenance }
//
// The route is a thin wrapper around src/engine/am/nightOrchestrator.js.
// FCCAM and the LMS facility client are pulled from the sidecars
// registry; when either is missing the route returns
// { available: false, error } rather than a 5xx — the DA designer
// previews this in the live overlay and the exhibit appendix can surface
// the same diagnostic verbatim.
//
// REGULATORY
//   - 47 CFR §73.182  — engineering standards of allocation, AM nighttime
//   - 47 CFR §73.183  — protection ratios per class + relation
//   - 47 CFR §73.190  — engineering charts, Wang skywave model

import express from 'express';
import { nighttimeNifStudy } from '../../engine/am/nightOrchestrator.js';
import { sidecars } from '../services/sidecars.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

r.post('/am-night/nif', asyncHandler(async (req, res) => {
  const { proposed = null, options = {} } = req.body || {};
  if (!proposed || typeof proposed !== 'object'){
    return res.status(400).json({
      available: false,
      error: 'request body must include `proposed` (lat, lon, freq_khz, erp_kw, fcc_class).'
    });
  }
  const result = await nighttimeNifStudy(
    { proposed, options },
    { fccamClient: sidecars.fccam, facilityClient: sidecars.facility }
  );
  // available:false is a legitimate response (sidecar down, primaries
  // empty, validation rejection) — return 200 so the UI can render
  // the explanatory payload without going through error handling.
  res.json(result);
}));

export default r;
