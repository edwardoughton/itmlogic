// AM directional antenna design routes.
//
//   POST /api/am-da/design       — synthesize horizontal pattern from
//                                   tower geometry (closed-form §73.150)
//   POST /api/am-da/null         — nudge a single tower's drive phase
//                                   so a null lands at a target azimuth
//
// Both routes are stateless and synchronous (sub-millisecond per call
// for arrays up to 12 towers).  The pattern_table they return drops
// straight into inputs.pattern_table on the FacilityRack.

import express from 'express';
import { synthesizeAmDaPattern, nudgeNullToAzimuth } from '../../engine/pattern/am_da_synthesizer.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

function tryDesign(spec){
  try {
    return { ok: true, ...synthesizeAmDaPattern(spec) };
  } catch (e){
    return { ok: false, error: 'BAD_SPEC', detail: String(e.message || e) };
  }
}

r.post('/am-da/design', asyncHandler(async (req, res) => {
  const result = tryDesign(req.body || {});
  if (!result.ok) return res.status(400).json(result);
  res.json(result);
}));

r.post('/am-da/null', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const spec   = body.spec || {};
  const target = Number(body.target_az_deg);
  if (!Number.isFinite(target)){
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'target_az_deg must be a number' });
  }
  let nudge;
  try {
    nudge = nudgeNullToAzimuth(spec, target, {
      tower_index:    body.tower_index,
      phase_step_deg: body.phase_step_deg,
      search_span_deg: body.search_span_deg
    });
  } catch (e){
    return res.status(400).json({ error: 'BAD_SPEC', detail: String(e.message || e) });
  }
  const result = tryDesign({ ...spec, towers: nudge.adjusted_towers });
  if (!result.ok) return res.status(400).json(result);
  res.json({
    ...result,
    nudge: {
      adjusted_tower_index: nudge.adjusted_tower_index,
      adjusted_towers:      nudge.adjusted_towers,
      achieved_null_db:     nudge.achieved_null_db,
      target_az_deg:        target
    }
  });
}));

export default r;
