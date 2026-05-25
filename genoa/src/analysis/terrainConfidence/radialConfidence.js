// Per-radial confidence assessment.
//
// Produces:
//   1. CONTINUOUS confidence_score (0..100) — for chart consumers and
//      operators who want fine-grained per-radial detail
//   2. BUCKETED disposition (HIGH / MEDIUM / LOW / UNMEASURED) — for the
//      legacy summary + bullet renderer.  Buckets are derived FROM the
//      continuous score with explicit thresholds.
//
// Continuous score function:
//   confidence_score = 100
//                    − clamp(100 · obstruction_index, 0, 30)       # terrain shadowing
//                    − clamp( 25 · roughness_score,   0, 25)       # terrain roughness
//                    − clamp(  2.5 · |sdr_residual_db|, 0, 35)     # measurement variance
//                    − clamp(  5 · max(0, |itm_delta_db| − 5), 0, 20)  # ITM Δ
//   Result is clamped to [0, 100].  When NO measurement basis exists
//   (no terrain data + no SDR + no ITM), score is null and disposition
//   is UNMEASURED.
//
// Bucket thresholds (derived from continuous score):
//   score >= 80      → HIGH
//   score >= 50      → MEDIUM
//   score >= 0       → LOW
//   no_evidence      → UNMEASURED
//
// Reason codes (keys for the report):
//   terrain_shadowing      — obstruction_index ≥ 0.30  (28+ points off)
//   diffraction_possible   — 0.10 ≤ obstruction_index < 0.30
//   measurement_variance   — |sdr_residual_db| > tolerance
//   model_limit            — |itm_delta_db| > 10 dB
//   no_measurement_basis   — no SDR + no DEM + no ITM
//
// Reference: per user request gap #3 — replace binary buckets with
// gradient scores so real-world RF environments can be reported with
// nuance rather than HIGH-cliff-LOW jumps at threshold boundaries.

import { TOLERANCE_DB, MODERATE_DB, classifyDeviation } from './curveDeviation.js';

function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

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

  // SDR residual severity — typeof guard first, then Number.isFinite,
  // to avoid the Number(null)===0 → Number.isFinite(0)===true gotcha
  // that PR #205 / #206 already fixed in the evidence-presence check
  // but had been left in this severity check.  Same trap; same fix.
  let residualBucket = 'within';
  if (typeof sdr_residual_db === 'number' && Number.isFinite(sdr_residual_db)){
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
  // Same typeof guard for the same gotcha.
  if (typeof itm_delta_db === 'number' && Number.isFinite(itm_delta_db)
      && Math.abs(itm_delta_db) > ITM_MODEL_LIMIT_DB){
    reasons.push('model_limit');
  }

  // Disposition.  Critical correctness gate:
  //   HIGH must mean "we have evidence the prediction is sound" — i.e.
  //   we actually MEASURED something (SDR residual or ITM Δ within
  //   tolerance) OR we computed real terrain metrics that came out
  //   benign.  Defaulting to HIGH on an exhibit with NO terrain data,
  //   NO SDR residual, and NO ITM Δ produces the "100% HIGH / 0 dB
  //   residual / terrain severity 0.000" trifecta that AM engineers
  //   read as "we measured perfection" — when we didn't measure
  //   anything at all.  AM under §73.184 has no DEM input by design,
  //   so without SDR drive-tests the honest disposition is UNMEASURED.
  // Measurement-basis check.  CAREFUL: Number(null) === 0 and
  // Number.isFinite(0) === true, so the obvious
  //   Number.isFinite(Number(sdr_residual_db))
  // returns TRUE for null/undefined — exactly the AM-without-drive-test
  // case we're trying to detect.  Use Number.isFinite directly (strict
  // version that returns false for non-numbers) and only treat actual
  // finite numeric values as evidence.
  const hasTerrainEvidence = terrain && terrain.available === true;
  const hasResidualEvidence = (typeof sdr_residual_db === 'number' && Number.isFinite(sdr_residual_db))
                            || (typeof itm_delta_db    === 'number' && Number.isFinite(itm_delta_db));

  // Continuous confidence score in [0, 100] — gradient replacement
  // for the previous binary buckets.  Each penalty has its own
  // weight + ceiling so a single severe metric can't drive the score
  // below the others' contributions.
  let confidence_score = null;
  if (hasTerrainEvidence || hasResidualEvidence){
    const obstr = Number(terrain?.obstruction_index || 0);
    const rough = Number(terrain?.roughness_score   || 0);
    const sdr   = Number.isFinite(Number(sdr_residual_db)) ? Math.abs(Number(sdr_residual_db)) : 0;
    const itm   = Number.isFinite(Number(itm_delta_db))    ? Math.abs(Number(itm_delta_db))    : 0;
    const pTerrainShadow  = clamp(100 * obstr,                     0, 30);   // up to 30 pts
    const pTerrainRough   = clamp( 25 * rough,                     0, 25);   // up to 25 pts
    const pSdrVariance    = clamp(  2.5 * sdr,                     0, 35);   // up to 35 pts
    const pItmDeparture   = clamp(  5 * Math.max(0, itm - 5),      0, 20);   // up to 20 pts
    confidence_score = Math.max(0, Math.min(100,
      100 - pTerrainShadow - pTerrainRough - pSdrVariance - pItmDeparture));
    // Severe-signal cap: when any input lands in the severe band the
    // score must drop into the LOW bucket regardless of other inputs.
    // Otherwise a -14 dB residual at flat terrain would score ~65
    // (MEDIUM) which contradicts the legacy semantic that severe
    // residuals are always LOW.  Cap at 49 so the bucket threshold
    // (≥ 50 = MEDIUM) is guaranteed missed.
    if (terrainBucket === 'severe' || residualBucket === 'severe'
        || reasons.includes('model_limit')){
      confidence_score = Math.min(confidence_score, 49);
    }
    confidence_score = Math.round(confidence_score * 10) / 10;
  }

  // Bucket derived FROM the continuous score.  Thresholds match the
  // legacy bucket semantics (HIGH = "evidence is sound", MEDIUM =
  // "moderate caution", LOW = "severe concern"); UNMEASURED is the
  // no-evidence case.
  let confidence;
  if (confidence_score == null){
    confidence = 'UNMEASURED';
    reasons.push('no_measurement_basis');
  } else if (confidence_score >= 80){
    confidence = 'HIGH';
  } else if (confidence_score >= 50){
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  return {
    azimuth_deg,
    confidence,
    confidence_score,
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
