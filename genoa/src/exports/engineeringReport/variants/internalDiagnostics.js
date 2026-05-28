// Internal-diagnostics variant — engineering ops + debugging surface.
//
// This file also hosts the public variant entry point
// `buildEngineeringReportVariant(exhibit, opts)` which composes the
// upstream buildEngineeringReport() with the appropriate per-variant
// post-processor.  Callers should use this instead of importing
// buildEngineeringReport directly when they need a non-'full' variant.
//
// Posture
//   Everything the full report contains, PLUS the raw provenance hashes,
//   replay command, and engine/build fingerprints that the customer-facing
//   variants strip.  Intended for Genoa engineers reproducing a customer
//   case offline.
//
// Behavior
//   - All sections are preserved verbatim (no filtering, no row scrubbing).
//   - Meta is tagged variant='internal' and the subtitle is amended so a
//     printed copy is unmistakable.
//
// Returns a NEW document object — the caller's full doc is not mutated.

import { buildEngineeringReport }            from '../index.js';
import { applyExecutiveSummaryVariant }      from './executiveSummary.js';
import { applyFilingExhibitVariant }         from './filingExhibit.js';

export const VARIANT_IDS = Object.freeze([
  'full', 'exec_summary', 'filing_exhibit', 'internal'
]);

export function buildEngineeringReportVariant(exhibit, opts){
  const variant = (opts && opts.variant) || 'full';
  if (!VARIANT_IDS.includes(variant)){
    throw new Error('buildEngineeringReportVariant: unknown variant: ' + variant);
  }
  // Build the base document with all sections.  Pass through the rest
  // of opts so contour_map_png et al. still reach the section builders.
  const doc = buildEngineeringReport(exhibit, opts);
  switch (variant){
    case 'exec_summary':   return applyExecutiveSummaryVariant(doc);
    case 'filing_exhibit': return applyFilingExhibitVariant(doc);
    case 'internal':       return applyInternalDiagnosticsVariant(doc);
    case 'full':
    default:               return doc;
  }
}

export function applyInternalDiagnosticsVariant(doc){
  if (!doc || !Array.isArray(doc.sections)) return doc;
  const meta = {
    ...(doc.meta || {}),
    variant:  'internal',
    subtitle: (doc.meta?.subtitle || 'FCC Propagation Study') + ' — Internal Diagnostics'
  };
  return { meta, sections: doc.sections.slice() };
}
