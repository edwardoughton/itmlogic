// Filing-readiness endpoint — Phase-10 surface for the score
// computed by src/engine/readiness/score.js.
//
//   POST /api/exhibits/readiness
//     body: { exhibit }
//     returns: {
//       score: number,
//       status: 'BLOCKED'|'REVIEW'|'FILING_CANDIDATE'|'ENGINEER_CERTIFICATION_READY',
//       blockers:     [{ code, detail, remedy }],
//       warnings:     [{ code, detail, remedy }],
//       advisory:     [{ code, detail, remedy }],
//       next_actions: [string],
//       breakdown:    { axis_name: points_awarded, ... },
//       axes:         { axis_name: max_points, ... }
//     }
//
// POST (not GET) because Genoa exhibits live in the client's
// workbench state, not a server-side DB — the caller posts the
// exhibit blob to score it.  This mirrors filing-package + sweep.

import express from 'express';
import { asyncHandler } from '../middleware/errors.js';
import { computeReadinessScore } from '../../engine/readiness/score.js';

const r = express.Router();

r.post('/exhibits/readiness', asyncHandler(async (req, res) => {
  const exhibit = req.body?.exhibit;
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'exhibit is required' });
  }
  const readiness = computeReadinessScore(exhibit);
  res.json(readiness);
}));

export default r;
