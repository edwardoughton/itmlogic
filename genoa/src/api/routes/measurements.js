// Drive-test / field-measurement ingestion endpoint.
//
// POST /api/measurements/ingest
//   body: {
//     tx:    { lat, lon },
//     contour_set: [{ id, field_mvm, mean_radius_km }, ...],
//     reference_field_mVm_at_1km: <RMS@1km>,
//     points: [{ lat, lon, measured_mVm, freq_khz?, t_iso? }, ...],
//     radial_step_deg?:      number (default 10)
//     min_points_per_bin?:   number (default 3)
//   }
//   returns: ingestMeasurementsToResiduals() output.
//
// Operator workflow:
//   1. Drive the licensed service area with a calibrated SDR / field
//      strength meter logging (timestamp, lat, lon, measured field).
//   2. POST the log to this endpoint along with the tx coordinates +
//      the exhibit's contour set (city / primary / secondary / etc.)
//      from a prior compute.
//   3. The endpoint returns per-azimuth aggregated residual rows in
//      the same shape evidence.sdr_calibration.residuals expects.
//   4. Attach the result to the next compute via inputs.evidence
//      (or directly into evidence on the orchestrator side).
//
// FAIL-SOFT for invalid points (per-point reason codes attached) so
// a partial-quality log still produces useful evidence.

import express from 'express';
import { asyncHandler } from '../middleware/errors.js';
import { ingestMeasurementsToResiduals } from '../../evidence/measurementIngest.js';

const r = express.Router();

r.post('/measurements/ingest', asyncHandler(async (req, res) => {
  const body = req.body || {};
  if (!body.tx || !Number.isFinite(Number(body.tx.lat)) || !Number.isFinite(Number(body.tx.lon))){
    return res.status(400).json({ available: false, error: 'tx { lat, lon } required' });
  }
  if (!Array.isArray(body.points)){
    return res.status(400).json({ available: false, error: 'points array required' });
  }
  // 25,000 points × ~80 bytes/point JSON ≈ 2 MB — well under the 8 MB
  // Express body limit set in server.js.  Audit caught the prior 100k
  // cap conflicting with the 8 MB Express limit (Express rejects first
  // with a different shape than our 413).
  if (body.points.length > 25_000){
    return res.status(413).json({ available: false, error: 'points array too large (max 25,000 — split large drive logs into per-day chunks)' });
  }
  const out = ingestMeasurementsToResiduals({
    tx:                         body.tx,
    contour_set:                body.contour_set || [],
    reference_field_mVm_at_1km: body.reference_field_mVm_at_1km,
    points:                     body.points,
    radial_step_deg:            Number(body.radial_step_deg) || 10,
    min_points_per_bin:         Number(body.min_points_per_bin) || 3
  });
  res.json(out);
}));

export default r;
