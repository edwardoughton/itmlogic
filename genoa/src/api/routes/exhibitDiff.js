// Exhibit-diff route — pure function over two exhibits.
//
//   POST /api/exhibits/diff
//     body: { before: <exhibit>, after: <exhibit> }
//     → 200 { ok, summary, station_inputs_delta, contour_delta, ... }
//
// No external dependencies, no sidecar fan-out — the route is a thin
// JSON-in/JSON-out wrapper over src/engine/exhibitDiff.js so the UI
// can render move-in / what-if comparisons without re-computing
// either exhibit.  The intended flow:
//
//   1. Operator computes the existing-license exhibit once
//      (POST /api/exhibits/compute, save to history).
//   2. Operator mutates inputs (lat/lon/erp/haat/freq/class) and
//      computes a "proposed" exhibit.
//   3. UI POSTs both to this route → renders the delta panel.

import express from 'express';
import { diffExhibits } from '../../engine/exhibitDiff.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

r.post('/exhibits/diff', asyncHandler(async (req, res) => {
  const { before = null, after = null } = req.body || {};
  if (!before || !after){
    return res.status(400).json({
      ok: false,
      error: 'request body must include `before` and `after` exhibits'
    });
  }
  const result = diffExhibits(before, after);
  // engine returns { ok: false, error } on bad shapes — route as 400.
  if (!result.ok){
    return res.status(400).json(result);
  }
  res.json(result);
}));

export default r;
