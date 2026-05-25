// AM Co-Location Opportunity Engine route.
//
//   POST /api/am/colocation-opportunities
//     body: see ../../engine/am/colocationOpportunities.js — runColocationOpportunities()
//     returns: ranked candidate hosts (grid + infrastructure) with
//              co-location analytics, status_category classification,
//              and explainability.
//
// SCREENING-GRADE ONLY.  Every response carries SCREENING and
// ENGINEER-REVIEW-REQUIRED labels; engineer-grade analysis is required
// before any filing.  Mounted at /api in src/api/server.js next to the
// amSiteOptimizerRoutes mount.

import express from 'express';
import { asyncHandler } from '../middleware/errors.js';
import { runColocationOpportunities } from '../../engine/am/colocationOpportunities.js';

const r = express.Router();

r.post('/am/colocation-opportunities', asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body || typeof body !== 'object'){
    return res.status(400).json({ available: false, error: 'JSON body required' });
  }
  const out = runColocationOpportunities(body);
  if (out.available === false){
    return res.status(400).json(out);
  }
  res.json(out);
}));

export default r;
