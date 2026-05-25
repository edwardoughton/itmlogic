// AM Regional Relocation Optimizer route.
//
//   POST /api/am/site-optimizer
//     body: see ../../engine/am/siteOptimizer.js — runSiteOptimizer()
//     returns: ranked candidate sites with per-goal sub-scores,
//              status labels, explainability, and limitations.
//
// SCREENING-GRADE ONLY.  Every response carries the SCREENING ONLY
// label on every candidate; engineer-grade NIF / §73.182 / DA-N
// analysis is required before any filing.  Mounted at /api in
// src/api/server.js next to the existing measurementsRoutes mount.

import express from 'express';
import { asyncHandler } from '../middleware/errors.js';
import { runSiteOptimizer } from '../../engine/am/siteOptimizer.js';

const r = express.Router();

r.post('/am/site-optimizer', asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body || typeof body !== 'object'){
    return res.status(400).json({ available: false, error: 'JSON body required' });
  }
  const out = runSiteOptimizer(body);
  if (out.available === false){
    return res.status(400).json(out);
  }
  res.json(out);
}));

export default r;
