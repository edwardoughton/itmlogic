// Product / explainer page — public (pre-login) AND internal.
//
// Benefit-first: lead with the problem Genoa solves and what a
// non-specialist gets, then drop into the Part 73 engine internals and
// trust/architecture details lower down for engineers and buyers who
// care about implementation. Sales mechanics (lead capture, "spin up a
// sample exhibit") are a later pass — the demo CTA is a placeholder.
//
// Rendered by App before the auth gate, so visitors see it logged-out
// and the team sees it logged-in (TopNav switches Sign in / Sign out).

import React from 'react';
import TopNav from './TopNav.jsx';
import LogoMark from './LogoMark.jsx';

function Section({ id, eyebrow, title, children }){
  return (
    <section id={id} className="max-w-5xl mx-auto px-6 py-12 border-t border-rule/40">
      {eyebrow && <div className="font-mono text-[10px] tracking-rack uppercase text-amber mb-2">{eyebrow}</div>}
      {title && <h2 className="text-cream text-2xl font-bold mb-5">{title}</h2>}
      {children}
    </section>
  );
}

function Card({ title, children }){
  return (
    <div className="rounded-lg border border-rule/60 bg-black/40 p-5">
      <div className="text-cream font-semibold mb-2">{title}</div>
      <p className="text-textDim text-sm leading-relaxed">{children}</p>
    </div>
  );
}

// Plain bulleted list with an amber marker — used for the benefit-first
// "what it does" and "what you get" sections.
function CheckList({ items }){
  return (
    <ul className="space-y-3">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 text-textDim leading-relaxed">
          <span className="text-amber shrink-0 mt-1" aria-hidden="true">▸</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  );
}

export default function ProductPage({ authed, onNavigate, onLogout }){
  return (
    <div className="min-h-screen bg-black text-cream">
      <TopNav current="product" authed={!!authed} onNavigate={onNavigate} onLogout={onLogout} />

      {/* Hero — benefit first */}
      <header className="max-w-5xl mx-auto px-6 pt-24 pb-12 text-center">
        <div className="flex justify-center mb-6"><LogoMark /></div>
        <div className="font-mono text-[11px] tracking-rack uppercase text-amber mb-4">FCC broadcast engineering, automated</div>
        <h1 className="text-cream text-4xl sm:text-5xl font-bold leading-tight mb-5">
          FCC propagation studies and filing exhibits — in minutes, not weeks.
        </h1>
        <p className="text-textDim text-lg max-w-2xl mx-auto leading-relaxed">
          Genoa turns a broadcast station's parameters into a complete, filing-ready
          FCC engineering statement — the kind of coverage-and-interference study that
          normally takes a consulting RF firm weeks — with every number self-checked
          against the FCC's own reference engine.
        </p>
        <p className="text-cream/90 text-base max-w-2xl mx-auto mt-5 font-medium">
          Less manual work. Faster answers. More confidence before you file.
        </p>
        <div className="mt-8 flex flex-wrap gap-3 justify-center">
          <a href="#start" className="rounded px-5 py-2.5 bg-amber text-black font-semibold text-sm hover:bg-cream transition-colors">
            Request a demo
          </a>
          <a
            href="/"
            onClick={(e) => { if (onNavigate){ e.preventDefault(); onNavigate('/'); } }}
            className="rounded px-5 py-2.5 border border-rule text-cream font-semibold text-sm hover:border-gold/60 transition-colors"
          >
            {authed ? 'Open the Studio' : 'Sign in to the Studio'}
          </a>
        </div>
      </header>

      {/* What it does — plain language */}
      <Section eyebrow="What Genoa does" title="One workflow, instead of a stack of tools and a consultant's invoice">
        <p className="text-textDim leading-relaxed mb-6">
          Preparing an FCC engineering exhibit normally means juggling curve tables,
          terrain data, and spacing rules across several disconnected tools — or paying
          a consulting engineer to assemble it all by hand. Genoa brings the whole study
          into a single workflow.
        </p>
        <p className="text-cream font-semibold mb-4">It helps stations and engineers:</p>
        <CheckList items={[
          "Check whether a facility meets the FCC's distance-spacing and contour-protection rules",
          'Map a station’s service and interference coverage over real terrain',
          'Generate the multi-page engineering statement used to support an FCC filing',
          'Flag conflicts early — and surface an advisory path back to compliance — before filing',
          'Reproduce and independently re-verify any study, exactly, on demand',
        ]} />
      </Section>

      {/* Why it matters — the problem */}
      <Section eyebrow="Why it matters" title="Answer “will this pass?” before you spend the time and money">
        <p className="text-textDim leading-relaxed">
          FCC engineering is slow, expensive, and unforgiving — one bad contour or a
          missed spacing conflict can sink a filing or stall a station for months.
          Genoa lets you get to a defensible answer in minutes, with traceable,
          self-checked results — so the time goes into making decisions instead of
          wrangling data.
        </p>
      </Section>

      {/* How it works — three plain steps */}
      <Section eyebrow="How it works" title="From call sign to signed exhibit">
        <ol className="space-y-4">
          {[
            ['Enter the facility', 'Look it up by call sign or facility ID, or type the parameters in directly.'],
            ['Analyze', 'Genoa runs the coverage, spacing, antenna-height, and interference analysis over real terrain.'],
            ['Review', 'See a plain pass / fail verdict, the self-validation results, and an automated consistency check.'],
            ['Generate', 'Download the engineering-statement PDF for your engineer of record to review and sign.'],
          ].map(([t, d], i) => (
            <li key={i} className="flex gap-4">
              <span className="font-mono text-amber text-sm shrink-0 w-6">{String(i + 1).padStart(2, '0')}</span>
              <span><span className="text-cream font-semibold">{t}.</span> <span className="text-textDim">{d}</span></span>
            </li>
          ))}
        </ol>
      </Section>

      {/* Results — outcomes */}
      <Section eyebrow="The result" title="What you get">
        <div className="grid sm:grid-cols-2 gap-x-10 gap-y-3">
          <CheckList items={[
            'Turnaround in minutes instead of weeks',
            'Lower consulting cost',
            'Consistent, reproducible reports',
          ]} />
          <CheckList items={[
            'Math verified against the FCC’s own engine',
            'Conflicts caught before they reach a filing',
            'Confidence the numbers will hold up to review',
          ]} />
        </div>
      </Section>

      {/* ---- Deeper / technical layer for engineers and buyers ---- */}

      {/* What it computes */}
      <Section eyebrow="Under the hood" title="The Part 73 engine">
        <p className="text-textDim leading-relaxed mb-6">
          For the engineers evaluating it: every figure is computed deterministically
          from the actual <span className="text-cream">47 CFR Part 73</span> rules, then
          cross-checked against the FCC's published curves and FORTRAN reference.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <Card title="§73.333 FM/TV contours">F(50,50) and F(50,10) curves → service, city-grade, and protected contours, per-radial and terrain-aware.</Card>
          <Card title="§73.207 / §73.215">Minimum distance separation and contour-protection for short-spaced stations, with full interference studies.</Card>
          <Card title="§73.313 HAAT">Height above average terrain, per-radial, derived from real elevation data (SRTM 30 m).</Card>
          <Card title="§73.182 / .184 / .190 AM">Groundwave + skywave field strength (RSS/NIF, the skywave formulas) for AM facilities.</Card>
        </div>
      </Section>

      {/* Why it's different */}
      <Section eyebrow="Why it's different" title="Built to be trusted, not just generated">
        <div className="grid sm:grid-cols-2 gap-4">
          <Card title="Deterministic & reproducible">Same inputs always produce the same numbers — SHA-256 hashed with replay tokens, so any exhibit can be independently re-verified.</Card>
          <Card title="Self-validating">Every exhibit carries a validation verdict: golden-suite curve checks, live geo.fcc.gov parity, and FORTRAN parity — visible to the reviewer.</Card>
          <Card title="AI consistency audit">An automated reviewer, grounded in the verbatim Part 73 rule text, flags internal contradictions for the engineer of record.</Card>
          <Card title="Engineer-of-record ready">Genoa does the deterministic computation and evidence assembly; a qualified broadcast engineer reviews and certifies. It never certifies on its own.</Card>
        </div>
      </Section>

      {/* CTA */}
      <Section id="start" eyebrow="Get started" title="See it on your own station">
        <p className="text-textDim leading-relaxed mb-6">
          The fastest pitch is a real exhibit. Reach out and we'll generate a sample
          engineering statement for a station you choose, so you can see the output
          quality before anything else.
        </p>
        <a
          href="mailto:chuck@mellowmountainradio.com?subject=Genoa%20demo%20request"
          className="inline-block rounded px-5 py-2.5 bg-amber text-black font-semibold text-sm hover:bg-cream transition-colors"
        >
          Request a demo
        </a>
        <p className="font-mono text-[10px] tracking-rack uppercase text-textDim/70 mt-10">
          Genoa FCC Propagation Studio — decision-support for broadcast engineering. Not a substitute for a licensed engineer of record.
        </p>
      </Section>
    </div>
  );
}
