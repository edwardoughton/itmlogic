// AM PSRA/PSSA route — POST /api/am/psra-pssa
//
//   body: {
//     proposed: {
//       call?, facility_id?, lat, lon,
//       freq_khz, fcc_class,
//       p_daytime_kw,
//       timezone_code?,
//       pattern_table?, pattern_mode?
//     },
//     options?: {
//       radius_km?, max_protected?, rss_share?, month_for_power?
//     }
//   }
//   → 200 {
//       available: boolean,
//       sun, windows, monthly, power, protected_pairs,
//       provenance, regulation
//     }
//
// Pulls sidecars.{sun, fccam, facility} from the registry and hands
// the request to the psraPssaExhibit orchestrator.  Same fail-soft
// envelope as /api/am-night/nif — 200 with diagnostics, never 5xx
// on upstream outage.

import express from 'express';
import { psraPssaExhibit } from '../../engine/am/psraPssaOrchestrator.js';
import { sidecars } from '../services/sidecars.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

r.post('/am/psra-pssa', asyncHandler(async (req, res) => {
  const { proposed = null, options = {} } = req.body || {};
  if (!proposed || typeof proposed !== 'object'){
    return res.status(400).json({
      available: false,
      error: 'request body must include `proposed` (lat, lon, freq_khz, fcc_class, p_daytime_kw, ...)'
    });
  }
  const result = await psraPssaExhibit(
    { proposed, options },
    {
      fccamClient:    sidecars.fccam,
      facilityClient: sidecars.facility,
      sunClient:      sidecars.sun
    }
  );
  res.json(result);
}));

export default r;
