import React, { useMemo, useState } from 'react';
import RackPanel from './RackPanel.jsx';
import FindingBadge from './FindingBadge.jsx';

// EvidenceRack — a card grid that summarises every evidence channel
// emitted by the engine for the current exhibit.  Each card shows:
//   • title (e.g. "FCC Rule Results")
//   • a FindingBadge for the rolled-up status
//   • a one-line summary string
//   • a "Why this result?" expander that lists individual sub-findings
//
// This is a presentation-only component — it derives everything from
// the passed-in `exhibit` object and is forgiving of missing fields.

function safe(obj, path, dflt){
  try {
    return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj) ?? dflt;
  } catch { return dflt; }
}

function rollupStatus(list){
  if (!Array.isArray(list) || list.length === 0) return 'NOT_RUN';
  const order = ['FILING_BLOCKER','BLOCKER','FAIL','SCREENING_FAIL','INCOMPLETE','NOT_RUN','SCREENING_PASS','ADVISORY','SKIP','INFO','PASS'];
  for (const s of order){
    if (list.some(x => (x?.status || x) === s)) return s;
  }
  return 'NOT_RUN';
}

function pickFindings(exhibit, key){
  const candidates = [
    safe(exhibit, `findings.${key}`),
    safe(exhibit, `${key}.findings`),
    safe(exhibit, `${key}`),
    safe(exhibit, `evidence.${key}.findings`)
  ];
  for (const c of candidates){
    if (Array.isArray(c)) return c;
  }
  return [];
}

function deriveCard(exhibit, def){
  if (typeof def.derive === 'function'){
    try { return def.derive(exhibit) || {}; } catch { return {}; }
  }
  return {};
}

const CARDS = [
  {
    id: 'fcc_rules',
    title: 'FCC Rule Results',
    derive: (ex) => {
      const findings = pickFindings(ex, 'fcc_rule_results');
      const status   = safe(ex, 'fcc_rule_results.status') || rollupStatus(findings);
      const summary  = safe(ex, 'fcc_rule_results.summary')
        || `${findings.length} rule check${findings.length === 1 ? '' : 's'} evaluated`;
      return { status, summary, findings };
    }
  },
  {
    id: 'am_allocation',
    title: 'AM Allocation',
    derive: (ex) => {
      const findings = pickFindings(ex, 'am_allocation');
      const status   = safe(ex, 'am_allocation.status') || rollupStatus(findings);
      const summary  = safe(ex, 'am_allocation.summary') || 'Allocation conformance';
      return { status, summary, findings };
    }
  },
  {
    id: 'am_physics',
    title: 'AM Physics',
    derive: (ex) => {
      const findings = pickFindings(ex, 'am_physics');
      const status   = safe(ex, 'am_physics.status') || rollupStatus(findings);
      const summary  = safe(ex, 'am_physics.summary') || 'Ground-wave / sky-wave physics';
      return { status, summary, findings };
    }
  },
  {
    id: 'environmental_rf',
    title: 'Environmental RF',
    derive: (ex) => {
      const findings = pickFindings(ex, 'environmental_rf');
      const status   = safe(ex, 'environmental_rf.status') || rollupStatus(findings);
      const summary  = safe(ex, 'environmental_rf.summary') || 'OET-65 / MPE evaluation';
      return { status, summary, findings };
    }
  },
  {
    id: 'sdr',
    title: 'SDR',
    derive: (ex) => {
      const findings = pickFindings(ex, 'sdr');
      const status   = safe(ex, 'sdr.status') || rollupStatus(findings);
      const summary  = safe(ex, 'sdr.summary') || 'Measurement / capture cross-check';
      return { status, summary, findings };
    }
  },
  {
    id: 'filing_readiness',
    title: 'Filing Readiness',
    derive: (ex) => {
      const findings = pickFindings(ex, 'filing_readiness');
      const score    = safe(ex, 'filing_readiness.score');
      const mode     = safe(ex, 'filing_readiness.mode');
      const status   = safe(ex, 'filing_readiness.status')
        || (mode === 'filing_candidate' ? 'PASS'
          : mode === 'engineering_review' ? 'ADVISORY'
          : mode === 'demo' ? 'INCOMPLETE'
          : rollupStatus(findings));
      const summary  = score != null
        ? `Score ${score}/100${mode ? ` · ${mode}` : ''}`
        : (safe(ex, 'filing_readiness.summary') || 'Composite filing-readiness score');
      return { status, summary, findings };
    }
  },
  {
    id: 'validation',
    title: 'Validation',
    derive: (ex) => {
      const findings = pickFindings(ex, 'validation');
      const status   = safe(ex, 'validation.status') || rollupStatus(findings);
      const summary  = safe(ex, 'validation.summary')
        || `${findings.length} validation check${findings.length === 1 ? '' : 's'}`;
      return { status, summary, findings };
    }
  },
  {
    id: 'provenance',
    title: 'Provenance',
    derive: (ex) => {
      const findings = pickFindings(ex, 'provenance');
      const engine   = safe(ex, 'engine_provenance.engine') || safe(ex, 'provenance.engine');
      const version  = safe(ex, 'engine_provenance.version') || safe(ex, 'provenance.version');
      const status   = safe(ex, 'provenance.status') || (engine ? 'INFO' : 'NOT_RUN');
      const summary  = engine
        ? `${engine}${version ? ` · v${version}` : ''}`
        : 'Engine provenance pending';
      return { status, summary, findings };
    }
  }
];

function EvidenceCard({ def, exhibit }){
  const { status, summary, findings } = deriveCard(exhibit, def);
  const [open, setOpen] = useState(false);
  const has = Array.isArray(findings) && findings.length > 0;
  return (
    <div className="border border-rule rounded-sm bg-[#0d1b22] p-3 flex flex-col gap-2">
      <header className="flex items-start justify-between gap-2">
        <div className="font-mono text-[11px] uppercase tracking-rack text-text">{def.title}</div>
        <FindingBadge status={status || 'NOT_RUN'} />
      </header>
      <div className="font-mono text-[11px] text-textDim leading-snug">
        {summary || '—'}
      </div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="self-start font-mono text-[10px] uppercase tracking-rack text-cyan hover:text-text"
        aria-expanded={open}
      >
        {open ? 'Hide details' : 'Why this result?'}
      </button>
      {open && (
        <ul className="border-t border-rule pt-2 mt-1 space-y-1.5">
          {has ? findings.slice(0, 12).map((f, i) => {
            const fStatus = (typeof f === 'string') ? f : (f?.status || 'INFO');
            const fLabel  = (typeof f === 'string') ? f : (f?.label || f?.id || f?.rule || f?.message || '—');
            const fDetail = (typeof f === 'object') ? (f?.detail || f?.message || '') : '';
            return (
              <li key={i} className="flex flex-col gap-1 text-[11px] font-mono">
                <div className="flex items-center gap-2">
                  <FindingBadge status={fStatus} />
                  <span className="text-text truncate">{fLabel}</span>
                </div>
                {fDetail && fDetail !== fLabel ? (
                  <div className="text-textDim text-[10px] pl-1">{fDetail}</div>
                ) : null}
              </li>
            );
          }) : (
            <li className="font-mono text-[10px] uppercase tracking-rack text-textDim">
              No sub-findings recorded for this channel.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function EvidenceRack({ exhibit }){
  const cards = useMemo(() => CARDS, []);
  return (
    <RackPanel
      eyebrow="Evidence"
      title="Findings rack"
      italicAccent="Every channel surfaces a defensible status. Expand a card to see why."
      tone="cyan"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {cards.map(def => (
          <EvidenceCard key={def.id} def={def} exhibit={exhibit} />
        ))}
      </div>
    </RackPanel>
  );
}
