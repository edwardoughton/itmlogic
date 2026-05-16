// Regulatory-context section — inserted between Methodology and
// Engineering Considerations.  Renders the classifier output (see
// src/engine/regulatory/context.js) into the same paragraphs-with-kv
// section type the renderText / renderPdf paths already understand.

import { REGULATORY_CONTEXT_DISCLAIMER } from '../../../engine/regulatory/context.js';

export function buildRegulatoryContextSection(exhibit){
  const ctx = exhibit?.regulatoryContext;
  if (!ctx) return null;

  const paragraphs = [
    ctx.userFacingSummary || ''
  ];
  if (Array.isArray(ctx.notes)){
    for (const n of ctx.notes){
      if (n) paragraphs.push(n);
    }
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
