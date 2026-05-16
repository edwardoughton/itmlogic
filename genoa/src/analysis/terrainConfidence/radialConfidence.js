// Per-radial confidence assessment.
//
// Combines terrain metrics with any available measured-vs-predicted
// residuals (SDR drive-test residual, optional ITM Δ) into a single
// HIGH/MEDIUM/LOW disposition with reason codes.
//
//   HIGH   — terrain is benign AND any measured residual is within tolerance
//   MEDIUM — moderate terrain or moderate residual; no severe red flags
//   LOW    — severe terrain (heavy obstruction / very high roughness) OR
//            a severe measured residual OR an ITM Δ that exceeds the
//            model-limit threshold.
//
// Reason codes (keys for the report):
//   terrain_shadowing      — high obstruction_index (≥ 0.30)
//   diffraction_possible   — moderate obstruction (0.10 ≤ idx < 0.30)
//   measurement_variance   — measured residual exceeds tolerance
//   model_limit            — ITM Δ from FCC curve > 10 dB (model regime gap)

import { TOLERANCE_DB, MODERATE_DB, classifyDeviation } from './curveDeviation.js';

export const ROUGH_HIGH_SCORE   = 1.0;
export const ROUGH_MEDIUM_SCORE = 0.5;
export const OBSTRUCTION_HIGH   = 0.30;
export const OBSTRUCTION_MED    = 0.10;
export const ITM_MODEL_LIMIT_DB = 10;

export function radialConfidence({
  terrain         = null,
  sdr_residual_db = null,
  itm_delta_db    = null,
  azimuth_deg     = null
} = {}){
  const reasons = [];

  // Terrain severity → bucket
  let terrainBucket = 'benign';
  if (terrain && terrain.available){
    const obstr = Number(terrain.obstruction_index || 0);
    const rough = Number(terrain.roughness_score   || 0);
    if (obstr >= OBSTRUCTION_HIGH || rough >= ROUGH_HIGH_SCORE){
      terrainBucket = 'severe';
      reasons.push('terrain_shadowing');
    } else if (obstr >= OBSTRUCTION_MED || rough >= ROUGH_MEDIUM_SCORE){
      terrainBucket = 'moderate';
      reasons.push('diffraction_possible');
    }
  }

  // SDR residual severity
  let residualBucket = 'within';
  if (Number.isFinite(Number(sdr_residual_db))){
    const cls = classifyDeviation(sdr_residual_db);
    if (cls === 'severe'){
      residualBucket = 'severe';
      reasons.push('measurement_variance');
    } else if (cls === 'moderate'){
      residualBucket = 'moderate';
      reasons.push('measurement_variance');
    }
  }

  // ITM Δ — drives the "model_limit" code only when very large.
  if (Number.isFinite(Number(itm_delta_db))
      && Math.abs(Number(itm_delta_db)) > ITM_MODEL_LIMIT_DB){
    reasons.push('model_limit');
  }

  // Disposition
  let confidence;
  if (terrainBucket === 'severe' || residualBucket === 'severe'
      || reasons.includes('model_limit')){
    confidence = 'LOW';
  } else if (terrainBucket === 'moderate' || residualBucket === 'moderate'){
    confidence = 'MEDIUM';
  } else {
    confidence = 'HIGH';
  }

  return {
    azimuth_deg,
    confidence,
    reasons,
    inputs: {
      terrain_available:      !!(terrain && terrain.available),
      obstruction_index:      terrain ? terrain.obstruction_index : null,
      roughness_score:        terrain ? terrain.roughness_score   : null,
      sdr_residual_db:        Number.isFinite(Number(sdr_residual_db)) ? Number(sdr_residual_db) : null,
      itm_delta_db:           Number.isFinite(Number(itm_delta_db))    ? Number(itm_delta_db)    : null,
      tolerance_db:           TOLERANCE_DB,
      moderate_db:            MODERATE_DB
    }
  };
}
