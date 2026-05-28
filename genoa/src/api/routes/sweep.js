// POST /api/exhibits/sweep — parameter-sweep endpoint.
//
// Sweeps ERP × HAAT × pattern around a base facility and returns
// ranked compliant configurations.  See
// src/engine/parameterSweep/sweepEngine.js for the underlying engine.
//
// Body:
//   {
//     base_inputs:     { call, facility_id, service, frequency, lat, lon, ... },
//     sweep:           { erp_kw: {min,max,step},
//                        haat_m: {min,max,step},
//                        patterns?: [...] },
//     max_combinations: number   (default 1000, hard cap 5000),
//     top_n:            number   (default 10),
//     concurrency:      number   (default 8),
//     only_compliant:   bool     (default true)
//   }
//
// Response:
//   See sweepEngine.js return shape.  When `best` is non-null, it's
//   shaped like:
//     { combo: { erp_kw, haat_m, pattern_table? },
//       summary: { service_contour_area_km2, n_blockers, ... },
//       is_compliant: true,
//       score, coverage_km2, efficiency_km2_per_kw,
//       compliance: { '73.207', '73.215', 'oet65', 'no_blockers',
//                     distance_path } }
//
// Evidence handling:
//   The route runs the orchestrator ONCE on base_inputs to resolve
//   nearby_primaries / FCC LMS / etc., then sweeps with that evidence
//   reused for every combo.  Per-combo runtime is dominated by curve
//   table interpolation, not network I/O.
//
//   IMPORTANT — the engine consumes evidence.terrain_haat_per_radial
//   in PREFERENCE to inputs.haat_m (engine/index.js HAAT-per-radial
//   block).  If we passed the base exhibit's terrain block straight
//   through, every combo's haat_m would be silently ignored and the
//   sweep would rank against a single fixed HAAT profile.  We strip
//   the per-radial array so each combo's haat_m drives a flat HAAT
//   profile via flatHaatPerRadial(); other evidence categories are
//   preserved.

import express from 'express';
import { sweepParameters } from '../../engine/parameterSweep/sweepEngine.js';
import { runCurveReferenceValidation } from '../../validation/curveReferenceValidation.js';
import { computeExhibit, getOrRunValidation } from '../services/exhibitService.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

r.post('/exhibits/sweep', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const baseInputs = body.base_inputs;
  const sweepRanges = body.sweep;

  if (!baseInputs || typeof baseInputs !== 'object'){
    return res.status(400).json({
      error: 'BAD_REQUEST',
      detail: 'base_inputs is required'
    });
  }
  if (!sweepRanges || typeof sweepRanges !== 'object'){
    return res.status(400).json({
      error: 'BAD_REQUEST',
      detail: 'sweep ranges are required (erp_kw and/or haat_m)'
    });
  }

  // Guard malformed max_combinations early so the client gets a 400
  // rather than the engine's raw Error -> 500.
  if (body.max_combinations != null){
    const m = Number(body.max_combinations);
    if (!Number.isFinite(m) || m < 1){
      return res.status(400).json({
        error: 'BAD_REQUEST',
        detail: `max_combinations must be a positive integer (got ${body.max_combinations})`
      });
    }
  }

  // Resolve evidence + validation ONCE for the base station.  We run
  // the full orchestrator so nearby_primaries / FCC LMS / terrain are
  // populated; then the sweep reuses that evidence for every combo.
  // (Engine is deterministic so per-combo runs don't need to re-fetch.)
  let baseExhibit;
  try {
    baseExhibit = await computeExhibit({ inputs: baseInputs, options: body.base_options || {} });
  } catch (err){
    return res.status(400).json({
      error: 'BASE_COMPUTE_FAILED',
      detail: 'Initial compute on base_inputs failed; cannot establish evidence baseline.',
      cause:  String(err?.message || err)
    });
  }

  // Strip per-radial terrain HAAT (and the request flag) — see file
  // header for the full reasoning.  All other evidence (nearby_primaries,
  // fcc_lms, measurements, identity, terrain provenance metadata) is
  // preserved so §73.207 / §73.215 / OET-65 still see the right inputs.
  const fullEvidence = baseExhibit?.evidence || {};
  // eslint-disable-next-line no-unused-vars
  const { terrain_haat_per_radial, terrain_haat_requested, ...evidence } = fullEvidence;

  const curveRefRun = await runCurveReferenceValidation();
  const legacyRun   = await getOrRunValidation();
  const validation  = {
    runs: [curveRefRun, legacyRun],
    reference_cases_present: curveRefRun.pass || legacyRun.reference_cases_present
  };

  const result = await sweepParameters({
    baseInputs,
    sweepRanges,
    evidence,
    validation,
    options: {
      max_combinations: body.max_combinations,
      top_n:            body.top_n,
      concurrency:      body.concurrency,
      only_compliant:   body.only_compliant
    }
  });

  // Surface the base exhibit's regulatory_context (if present) so the
  // caller can interpret the sweep results in the right frame:
  // licensed-existing vs proposed-new vs modification.
  if (baseExhibit?.regulatoryContext){
    result.base_regulatory_context = baseExhibit.regulatoryContext;
  }

  res.json(result);
}));

export default r;
