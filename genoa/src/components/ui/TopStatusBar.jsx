import React, { useEffect, useState } from 'react';
import LogoMark   from './LogoMark.jsx';
import LedStatus  from './LedStatus.jsx';

// Top status bar — the studio control surface.
// Shows: brand mark, system LED, mode (FCC method), engine version,
// readiness score with status, commit SHA, and a UTC clock.

export default function TopStatusBar({
  systemStatus = 'nominal',   // 'nominal' | 'degraded' | 'blocked' | 'offline'
  mode         = '47 CFR §73.333 F(50,50)',
  engineVersion = 'genoa-engine v2.0.0',
  readinessScore = null,
  readinessStatus = null,
  commitSha   = 'uncommitted'
}) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const utc = now.toISOString().slice(11, 19) + 'Z';

  const readinessColor =
    readinessStatus === 'filing_candidate'   ? 'text-green'
  : readinessStatus === 'engineering_review' ? 'text-amber'
  : readinessStatus === 'demo'               ? 'text-red'
  :                                            'text-textDim';

  return (
    <header className="sticky top-0 z-30 border-b border-panelEdge backdrop-blur-sm"
            style={{ background: 'linear-gradient(180deg, rgba(7,21,29,0.92), rgba(7,21,29,0.78))' }}>
      <div className="px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
        <LogoMark size={42} />
        <div className="hidden md:block w-px h-8 bg-rule" />
        <Cell label="System">
          <LedStatus status={systemStatus} />
        </Cell>
        <Cell label="Mode" value={mode} valueCls="text-cream" />
        <Cell label="Engine" value={engineVersion} />
        <Cell label="Readiness"
              value={readinessScore == null ? '—' : `${readinessScore}/100`}
              valueCls={readinessColor}
              sub={readinessStatus || ''} />
        <Cell label="Build" value={commitSha === 'uncommitted' ? 'uncommitted' : commitSha.slice(0, 7)} />
        <div className="ml-auto flex items-center gap-3">
          <Cell label="UTC" value={utc} valueCls="text-cyan" />
        </div>
      </div>
      <div className="px-5 pb-2 text-[11px] text-textDim italic font-display">
        Carry the signal farther on a single tack.
      </div>
    </header>
  );
}

function Cell({ label, value, valueCls = 'text-text', sub, children }) {
  return (
    <div className="flex flex-col">
      <span className="font-mono text-[9px] tracking-tag uppercase text-textDim">{label}</span>
      {children
        ? <span className="font-mono text-[12px] tabular-nums">{children}</span>
        : <span className={`font-mono text-[12px] tabular-nums ${valueCls}`}>{value}</span>}
      {sub && <span className="font-mono text-[9px] uppercase tracking-rack text-textDim mt-0.5">{sub}</span>}
    </div>
  );
}
