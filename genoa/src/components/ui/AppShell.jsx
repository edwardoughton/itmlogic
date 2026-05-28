import React from 'react';
import TopStatusBar from './TopStatusBar.jsx';

// AppShell — the rack layout.  Top status bar + three columns on
// desktop, vertical stack on mobile.  Children are slotted into
// `left`, `center`, `right` (or via a single React.Fragment).

export default function AppShell({
  systemStatus, mode, engineVersion, readinessScore, readinessStatus, commitSha,
  left, center, right, footer
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <TopStatusBar
        systemStatus={systemStatus}
        mode={mode}
        engineVersion={engineVersion}
        readinessScore={readinessScore}
        readinessStatus={readinessStatus}
        commitSha={commitSha}
      />
      <main className="flex-1 px-5 pt-5 pb-12 grid gap-5 lg:grid-cols-[400px_minmax(0,1fr)_380px]">
        <aside className="lg:col-span-1 space-y-4">{left}</aside>
        <section className="lg:col-span-1 space-y-4 min-w-0">{center}</section>
        <aside className="lg:col-span-1 space-y-4">{right}</aside>
      </main>
      <footer className="px-5 py-4 border-t border-rule font-mono text-[10px] tracking-rack uppercase text-textDim flex flex-wrap gap-x-6 gap-y-1 justify-between">
        <span className="font-display italic text-gold normal-case tracking-normal text-[12px]">
          One tack — deterministic above, evidence beside, narrative on top.
        </span>
        <span>47 CFR §§ 73.183 · 73.184 · 73.313 · 73.333 · 73.811 · 74.1204</span>
        {footer}
      </footer>
    </div>
  );
}
