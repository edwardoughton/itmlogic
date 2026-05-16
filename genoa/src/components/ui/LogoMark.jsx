// Genoa — signal sail mark.  Pure SVG, no external assets.
// A circular dark badge with a stylized sail of three amber/gold
// contour arcs (60 / 54 / 40 dBu nesting), a faint cyan signal line up
// the mast, and a vertical broadcast tick.  Plays the dual role of
// "luxury yacht jib" + "RF contour map" — Caldwell-warm, not corporate.

import React from 'react';

export default function LogoMark({ size = 56, withWordmark = true, className = '' }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="logo-sail" style={{ width: size, height: size, flex: '0 0 ' + size + 'px' }}>
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="sailGrad" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%"   stopColor="#f3c86d" />
              <stop offset="55%"  stopColor="#d6a36a" />
              <stop offset="100%" stopColor="#c4745a" />
            </linearGradient>
            <linearGradient id="mast" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%"  stopColor="#f4eee0" />
              <stop offset="100%" stopColor="#7a6132" />
            </linearGradient>
            <radialGradient id="badge" cx="50%" cy="44%" r="60%">
              <stop offset="0%"   stopColor="#10222e" />
              <stop offset="80%"  stopColor="#06121a" />
              <stop offset="100%" stopColor="#04090d" />
            </radialGradient>
          </defs>
          {/* Badge */}
          <circle cx="32" cy="32" r="30" fill="url(#badge)" stroke="rgba(214,163,106,0.35)" strokeWidth="0.8"/>
          {/* Faint contour rings */}
          <circle cx="32" cy="32" r="25" fill="none" stroke="rgba(111,211,255,0.16)" strokeWidth="0.5"/>
          <circle cx="32" cy="32" r="19" fill="none" stroke="rgba(214,163,106,0.18)" strokeWidth="0.5"/>
          {/* Mast */}
          <line x1="22" y1="6" x2="22" y2="58" stroke="url(#mast)" strokeWidth="1.6" strokeLinecap="round"/>
          {/* Cyan signal tick (subtle) */}
          <line x1="22" y1="6" x2="22" y2="14" stroke="#6fd3ff" strokeWidth="1.2" strokeLinecap="round" opacity="0.85"/>
          {/* The genoa sail — three nested luff arcs read as 60/54/40 dBu contours */}
          <path d="M22,8  C 44,18 56,36 50,54 L22,54 Z" fill="url(#sailGrad)" stroke="#1c2e3a" strokeWidth="1.2" strokeLinejoin="round"/>
          <path d="M22,16 C 33,22 42,34 38,52" fill="none" stroke="rgba(28,46,58,0.55)" strokeWidth="0.7"/>
          <path d="M22,24 C 32,28 39,38 36,52" fill="none" stroke="rgba(28,46,58,0.4)"  strokeWidth="0.55"/>
          {/* Horizon tick */}
          <line x1="6" y1="48" x2="58" y2="48" stroke="rgba(214,163,106,0.25)" strokeWidth="0.5"/>
        </svg>
      </div>
      {withWordmark && (
        <div className="leading-tight">
          <div className="font-display text-[28px] font-semibold italic text-cream"
               style={{ letterSpacing: '0.005em', textShadow: '0 4px 16px rgba(0,0,0,0.5)' }}>
            Genoa
          </div>
          <div className="font-mono text-[10px] tracking-[0.32em] uppercase text-gold mt-0.5">
            FCC&nbsp;Propagation&nbsp;Studio
          </div>
        </div>
      )}
    </div>
  );
}
