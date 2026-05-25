// Curve deviation — compare an FCC-curve-predicted field strength to a
// measured field strength (SDR, drive test, ITM cross-check).
//
// Returns the signed Δ in dB and a coarse classification:
//   within_tolerance — |Δ| < 6 dB
//   moderate         — 6 ≤ |Δ| ≤ 10 dB
//   severe           — |Δ| > 10 dB
//
// The classification thresholds are *engineering-advisory*; they do not
// gate compliance and do not modify the underlying curve outputs.

export const TOLERANCE_DB = 6;
export const MODERATE_DB  = 10;

export function computeCurveDeviation(predicted_dbu, measured_dbu){
  const p = Number(predicted_dbu);
  const m = Number(measured_dbu);
  if (!Number.isFinite(p) || !Number.isFinite(m)){
    return {
      available:        false,
      delta_db:         null,
      abs_delta_db:     null,
      classification:   'unknown',
      reason:           !Number.isFinite(p) ? 'predicted not finite' : 'measured not finite'
    };
  }
  const delta = m - p;            // positive ⇒ measured > predicted
  const abs   = Math.abs(delta);
  let classification;
  if (abs < TOLERANCE_DB)        classification = 'within_tolerance';
  else if (abs <= MODERATE_DB)   classification = 'moderate';
  else                           classification = 'severe';
  return {
    available:      true,
    predicted_dbu:  round1(p),
    measured_dbu:   round1(m),
    delta_db:       round1(delta),
    abs_delta_db:   round1(abs),
    classification
  };
}

// Convenience: classify a residual that is already a delta (e.g. the SDR
// residual reported in dB), without needing a separate predicted/measured
// pair.  Same thresholds.
export function classifyDeviation(delta_db){
  const d = Number(delta_db);
  if (!Number.isFinite(d)) return 'unknown';
  const abs = Math.abs(d);
  if (abs < TOLERANCE_DB)      return 'within_tolerance';
  if (abs <= MODERATE_DB)      return 'moderate';
  return 'severe';
}

function round1(x){ return Number.isFinite(x) ? Math.round(x * 10) / 10 : null; }
