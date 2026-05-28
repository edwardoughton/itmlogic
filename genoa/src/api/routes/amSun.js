// AM Sunrise / Sunset Authority route.
//
//   GET /api/am/sun?lat={lat}&lon={lon}&tzone={code}
//     → 200 { available, source: 'fcc_srsstime', timezone_code,
//             timezone_label, input, dms, monthly, replay, ... }
//     → 503 { ok:false, error: '...' } when FCC_SUN_SIDECAR_URL unset
//
// Thin passthrough over the sidecars.sun client.  Same fail-soft
// envelope as /api/am-night/nif — when the sidecar is unconfigured
// or unreachable, the route returns the diagnostic payload (200)
// rather than 5xx so the UI panel can render it inline without
// going through error handling.
//
// REGULATORY
//   - 47 CFR §73.99   — pre-sunrise / post-sunset authority
//   - 47 CFR §73.1209 — day/night-mode service hours

import express from 'express';
import { sidecars } from '../services/sidecars.js';
import { defaultTzForLatLon, isValidFccTzCode } from '../../evidence/fccSunClient.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

r.get('/am/sun', asyncHandler(async (req, res) => {
  const lat = Number(req.query.lat);
  const lon = Number(req.query.lon);
  let tzone = String(req.query.tzone || '').trim() || defaultTzForLatLon(lat, lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)){
    return res.status(400).json({
      available: false,
      error: 'lat and lon query parameters are required (finite numbers)'
    });
  }
  if (!isValidFccTzCode(tzone)){
    return res.status(400).json({
      available: false,
      error: `tzone "${tzone}" not in FCC codes (A/a/B/b/C/c/D/d/E/F/f/G/g)`
    });
  }
  if (!sidecars.sun){
    return res.json({
      available: false,
      error: 'FCC sunrise/sunset sidecar unavailable — AM timing appendix omitted (FCC_SUN_SIDECAR_URL unset)',
      regulation: '47 CFR §73.99 / §73.1209'
    });
  }

  const out = await sidecars.sun.fetchAmSun({ lat, lon, tzone });
  res.json(out);
}));

export default r;
