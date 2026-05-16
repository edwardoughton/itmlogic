import React from 'react';
import MetricReadout from './MetricReadout.jsx';

// Regulatory-context card.  Renders the classifier output (see
// src/engine/regulatory/context.js) so reviewers can see whether a
// failing §73.207/§73.215 study is on a brand-new proposed filing
// ("redesign or waiver required") or on an existing licensed facility
// ("legacy/waiver risk flag, not standalone illegality").
//
// Tone is driven by filingRisk: low=cyan (informational), medium=amber
// (review), high=red (must address).  When regulatoryContext is absent
// the parent component should not render this card.

const RISK_TONE = {
  low:    'cyan',
  medium: 'amber',
  high:   'red'
};

const RISK_LED = {
  low:    'cyan',
  medium: 'amber',
  high:   'red'
};

// Pretty-print the classifier's snake_case enum values without
// fabricating new semantics — the labels mirror the spec verbatim.
function pretty(v){
  if (!v) return '—';
  return String(v).replace(/_/g, ' ');
}

export default function RegulatoryContextCard({ ctx }) {
  if (!ctx) return null;
  const tone = RISK_TONE[ctx.filingRisk] || 'default';
  const led  = RISK_LED[ctx.filingRisk]  || null;
  return (
    <div className="space-y-2">
      <MetricReadout
        label="Facility status"
        value={pretty(ctx.facilityStatus)}
        tone={ctx.facilityStatus === 'licensed' ? 'cyan' : ctx.facilityStatus === 'proposed' ? 'amber' : 'default'}
        led={ctx.facilityStatus === 'licensed' ? 'cyan' : null}
      />
      <MetricReadout
        label="Study intent"
        value={pretty(ctx.studyIntent)}
        tone={ctx.studyIntent === 'modification' ? 'red' : 'default'}
      />
      <MetricReadout
        label="Current-rule compliance"
        value={pretty(ctx.currentRuleCompliance)}
        tone={ctx.currentRuleCompliance === 'fails_current_rules'
                ? 'red'
                : ctx.currentRuleCompliance === 'passes_current_rules'
                  ? 'green'
                  : 'default'}
      />
      <MetricReadout
        label="Interpretation"
        value={pretty(ctx.licenseInterpretation)}
        tone={ctx.licenseInterpretation === 'ordinary_compliant' ? 'green'
             : ctx.licenseInterpretation === 'licensed_with_legacy_conflicts' ? 'amber'
             : ctx.licenseInterpretation === 'requires_engineering_review' ? 'red'
             : 'default'}
      />
      <MetricReadout
        label="Filing risk"
        value={pretty(ctx.filingRisk)}
        tone={tone}
        led={led}
      />
      {ctx.userFacingSummary && (
        <div className="font-mono text-[11px] text-textDim leading-relaxed pt-2 border-t border-[rgba(214,163,106,0.10)] mt-2">
          {ctx.userFacingSummary}
        </div>
      )}
      {Array.isArray(ctx.notes) && ctx.notes.length > 0 && (
        <ul className="mt-2 space-y-1">
          {ctx.notes.map((n, i) => (
            <li key={i} className="font-mono text-[10px] text-textDim leading-relaxed">
              <span className="text-textDim mr-1.5">·</span>{n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
