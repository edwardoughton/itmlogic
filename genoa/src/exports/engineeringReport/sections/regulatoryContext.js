// Regulatory-context section — inserted between Methodology and
// Engineering Considerations.  Renders the classifier output (see
// src/engine/regulatory/context.js) into the same paragraphs-with-kv
// section type the renderText / renderPdf paths already understand.

import {
  REGULATORY_CONTEXT_DISCLAIMER,
  CFR_73_311_CONTOUR_USE,
  AM_M3_OVERSTATEMENT_CAVEAT
} from '../../../engine/regulatory/context.js';

export function buildRegulatoryContextSection(exhibit){
  const ctx = exhibit?.regulatoryContext;
  if (!ctx) return null;

  const svc  = String(exhibit?.station_inputs?.service || '').toUpperCase();
  const isAm = svc === 'AM' || svc === 'AX';

  const paragraphs = [
    ctx.userFacingSummary || ''
  ];
  if (Array.isArray(ctx.notes)){
    for (const n of ctx.notes){
      if (n) paragraphs.push(n);
    }
  }
  // §73.311 — what contours are FOR.  Citation surfaces on every
  // exhibit because every exhibit's headline result is a contour.
  paragraphs.push(CFR_73_311_CONTOUR_USE);
  // AM-specific: M3 over-states coverage in many regions + seasonal σ.
  if (isAm){
    paragraphs.push(AM_M3_OVERSTATEMENT_CAVEAT);
  }
  paragraphs.push(REGULATORY_CONTEXT_DISCLAIMER);

  return {
    id:      'regulatory-context',
    type:    'paragraphs-with-kv',
    heading: 'REGULATORY CONTEXT',
    paragraphs,
    rows: [
      ['Facility status',          ctx.facilityStatus         || '—'],
      ['Study intent',             ctx.studyIntent            || '—'],
      ['Current-rule compliance',  ctx.currentRuleCompliance  || '—'],
      ['Interpretation',           ctx.licenseInterpretation  || '—'],
      ['Filing risk',              ctx.filingRisk             || '—']
    ]
  };
}
