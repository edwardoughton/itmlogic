// SDR residual interpretation — pipeline entry.
//
// PURE ANALYSIS LAYER.  Consumes the SDR residual table that lives on
// exhibit.evidence.sdr_calibration (or evidence.sdr_residuals); produces
// a deterministic engineering-narrative + summary statistics.
//
// Never modifies the exhibit.

import {
  classifyResidual, summarizeResiduals,
  CLASS_WITHIN, CLASS_MODERATE, CLASS_SIGNIFICANT, CLASS_UNKNOWN,
  WITHIN_DB, MODERATE_DB
} from './classifyResiduals.js';
import { generateNarrative } from './generateNarrative.js';

export {
  classifyResidual, summarizeResiduals, generateNarrative,
  CLASS_WITHIN, CLASS_MODERATE, CLASS_SIGNIFICANT, CLASS_UNKNOWN,
  WITHIN_DB, MODERATE_DB
};

export function interpretResiduals(exhibit){
  const table = readResidualTable(exhibit);
  const summary = summarizeResiduals(table);
  const narrative = generateNarrative(summary);
  return { ...summary, engineering_interpretation_text: narrative };
}

function readResidualTable(exhibit){
  if (!exhibit || typeof exhibit !== 'object') return [];
  const cal = exhibit.evidence?.sdr_calibration;
  if (cal && Array.isArray(cal.residuals)) return cal.residuals;
  if (Array.isArray(exhibit.evidence?.sdr_residuals)) return exhibit.evidence.sdr_residuals;
  return [];
}
