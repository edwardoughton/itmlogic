// Top navigation bar.  Replaces the old fixed corner controls (Site
// Optimizer / Sign-out / study-music widget) with a single coherent nav
// strip pinned top-right.  Used by both the authed app pages and the
// public Product/explainer page, so it accepts an `authed` flag and
// renders Sign in / Sign out accordingly.
//
// `onNavigate` is the app's client-side navigate() (history pushState +
// popstate) so links stay SPA-snappy; falls back to a full-page href if
// not supplied.

import React from 'react';

const LINKS = [
  { key: 'studio',  label: 'Studio',  path: '/' },
  { key: 'map',     label: 'Map',     path: '/map' },
  { key: 'product', label: 'Product', path: '/product' },
];

export default function TopNav({ current, authed, onNavigate, onLogout, onOpenOptimizer }){
  const go = (path) => (e) => {
    if (onNavigate){ e.preventDefault(); onNavigate(path); }
    // else: let the <a href> do a normal navigation
  };
  return (
    <nav className="fixed top-3 right-4 z-40 flex items-center gap-2 font-mono text-[10px] tracking-rack uppercase">
      {LINKS.map(l => {
        const active = l.key === current;
        return (
          <a
            key={l.key}
            href={l.path}
            onClick={go(l.path)}
            aria-current={active ? 'page' : undefined}
            className={
              'rounded px-2.5 py-1 border bg-black/60 backdrop-blur-sm transition-colors ' +
              (active
                ? 'text-cream border-gold/70'
                : 'text-textDim hover:text-cream border-rule hover:border-gold/50')
            }
          >
            {l.label}
          </a>
        );
      })}

      {onOpenOptimizer && (
        <button
          onClick={onOpenOptimizer}
          title="Open the AM Regional Relocation Optimizer"
          className="rounded px-2.5 py-1 border bg-black/60 backdrop-blur-sm transition-colors text-amber border-amber/40 hover:text-cream hover:border-amber/80"
        >
          Site&nbsp;Optimizer&nbsp;(beta)&nbsp;→
        </button>
      )}

      {authed
        ? (
          <button
            onClick={onLogout}
            title="Sign out"
            className="rounded px-2.5 py-1 border bg-black/60 backdrop-blur-sm transition-colors text-textDim hover:text-cream border-rule hover:border-gold/50"
          >
            Sign&nbsp;out
          </button>
        )
        : (
          <a
            href="/"
            onClick={go('/')}
            title="Sign in to the Studio"
            className="rounded px-2.5 py-1 border bg-black/60 backdrop-blur-sm transition-colors text-textDim hover:text-cream border-rule hover:border-gold/50"
          >
            Sign&nbsp;in
          </a>
        )}
    </nav>
  );
}
