// §73.215 short-spacing-showing route.
//
//   POST /api/exhibits/short-spacing-showing
//     body: { exhibit }
//     → 200 { ok, applicable, short_spaced_pairs, boilerplate_narrative, ... }
//
// Pure transform over an existing exhibit's regulatory_compliance
// payload — no fetches, no engines.  Returns 400 when the exhibit
// has no §73.207 study attached, otherwise the showing payload.

import express from 'express';
import { buildSection73215Showing } from '../../exports/section73215Showing.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

r.post('/exhibits/short-spacing-showing', asyncHandler(async (req, res) => {
  const { exhibit = null } = req.body || {};
  if (!exhibit){
    return res.status(400).json({ ok: false,
      error: 'request body must include `exhibit` (compute() output)' });
  }
  const showing = buildSection73215Showing(exhibit);
  if (!showing.ok){
    return res.status(400).json(showing);
  }
  res.json(showing);
}));

export default r;
