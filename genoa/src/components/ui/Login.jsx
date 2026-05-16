import React, { useState } from 'react';
import LogoMark from './LogoMark.jsx';

// Full-screen login hero.  Big sail logo, animated contour rings
// pulsing outward, glassy card, warm-amber accents.  Pure SVG so it
// scales cleanly and ships zero raster assets.

export default function Login({ onSuccess }){
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [busy,     setBusy]     = useState(false);

  async function submit(e){
    e?.preventDefault();
    if (!password) return;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/auth/login', {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'content-type': 'application/json' },
        body:        JSON.stringify({ password })
      });
      if (r.ok){ onSuccess?.(); return; }
      const j = await r.json().catch(() => ({}));
      setError(j.detail || j.error || `Sign-in failed (${r.status})`);
    } catch (err){
      setError(err.message || 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center bg-black">
      {/* Background — radial warm-amber glow over deep teal-black */}
      <svg
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="xMidYMid slice"
        viewBox="0 0 1600 1000"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="bgGlow" cx="50%" cy="46%" r="65%">
            <stop offset="0%"   stopColor="#1a3142" stopOpacity="1"/>
            <stop offset="40%"  stopColor="#0a1a25" stopOpacity="1"/>
            <stop offset="100%" stopColor="#020608" stopOpacity="1"/>
          </radialGradient>
          <radialGradient id="amberGlow" cx="50%" cy="46%" r="35%">
            <stop offset="0%"   stopColor="#f3c86d" stopOpacity="0.22"/>
            <stop offset="60%"  stopColor="#c4745a" stopOpacity="0.06"/>
            <stop offset="100%" stopColor="#000000" stopOpacity="0"/>
          </radialGradient>
          <linearGradient id="grid" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%"  stopColor="rgba(214,163,106,0.0)"/>
            <stop offset="50%" stopColor="rgba(214,163,106,0.10)"/>
            <stop offset="100%" stopColor="rgba(214,163,106,0.0)"/>
          </linearGradient>
        </defs>

        <rect width="1600" height="1000" fill="url(#bgGlow)"/>
        <rect width="1600" height="1000" fill="url(#amberGlow)"/>

        {/* Faint horizon grid — same vibe as the chart room */}
        {Array.from({ length: 14 }).map((_, i) => (
          <line
            key={`h-${i}`}
            x1="0"
            x2="1600"
            y1={70 * (i + 1)}
            y2={70 * (i + 1)}
            stroke="rgba(214,163,106,0.05)"
            strokeWidth="0.5"
          />
        ))}
        {Array.from({ length: 22 }).map((_, i) => (
          <line
            key={`v-${i}`}
            x1={75 * (i + 1)}
            x2={75 * (i + 1)}
            y1="0"
            y2="1000"
            stroke="rgba(214,163,106,0.05)"
            strokeWidth="0.5"
          />
        ))}

        {/* Animated contour rings centered behind the card */}
        <g style={{ transformOrigin: '800px 460px' }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <circle
              key={`pulse-${i}`}
              cx="800"
              cy="460"
              r="180"
              fill="none"
              stroke={i % 2 === 0 ? 'rgba(243,200,109,0.35)' : 'rgba(111,211,255,0.22)'}
              strokeWidth="1"
            >
              <animate
                attributeName="r"
                from="120"
                to="720"
                dur="6s"
                begin={`${i * 1.2}s`}
                repeatCount="indefinite"
              />
              <animate
                attributeName="opacity"
                from="0.55"
                to="0"
                dur="6s"
                begin={`${i * 1.2}s`}
                repeatCount="indefinite"
              />
            </circle>
          ))}
        </g>

        {/* Bottom CFR ribbon — quiet, tasteful */}
        <text
          x="800"
          y="970"
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontSize="11"
          letterSpacing="6"
          fill="rgba(214,163,106,0.40)"
        >
          47 CFR §§ 73.183 · 73.184 · 73.313 · 73.333 · 73.811 · 74.1204
        </text>
      </svg>

      {/* Content card */}
      <div className="relative z-10 w-[440px] max-w-[92vw] px-2">
        <div className="flex flex-col items-center mb-8">
          {/* Big sail logo, centered */}
          <div style={{ width: 168, height: 168 }} className="mb-4 drop-shadow-[0_8px_30px_rgba(243,200,109,0.25)]">
            <LogoMark size={168} withWordmark={false} />
          </div>
          <div
            className="font-display italic font-semibold text-cream text-[64px] leading-none"
            style={{ letterSpacing: '0.005em', textShadow: '0 6px 30px rgba(243,200,109,0.25), 0 2px 8px rgba(0,0,0,0.6)' }}
          >
            Genoa
          </div>
          <div className="font-mono text-[12px] tracking-[0.42em] uppercase text-gold mt-3">
            FCC&nbsp;Propagation&nbsp;Studio
          </div>
          <div className="font-display italic text-textDim text-[14px] mt-3 text-center">
            Carry the signal farther on a single tack.
          </div>
        </div>

        <form
          onSubmit={submit}
          className="rounded-xl border border-rule bg-black/55 backdrop-blur-md px-7 py-7 space-y-5 shadow-[0_30px_80px_rgba(0,0,0,0.6),0_0_0_1px_rgba(243,200,109,0.05)]"
        >
          <div>
            <label className="block font-mono text-textDim text-[10px] tracking-rack uppercase mb-2">
              Authorization Key
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              placeholder="••••••••••"
              className="w-full bg-black/70 border border-rule rounded-md px-4 py-3 font-mono text-cream text-[15px] tracking-wider focus:outline-none focus:border-gold/60 focus:bg-black/85 transition-colors"
            />
          </div>

          {error ? (
            <div className="font-mono text-red text-[11px] bg-red/10 border border-red/40 rounded px-3 py-2">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={busy || !password}
            className="w-full bg-gradient-to-b from-gold/30 to-gold/10 hover:from-gold/40 hover:to-gold/20 border border-gold/50 rounded-md py-3 font-mono text-cream text-[13px] tracking-[0.32em] uppercase disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-[0_0_30px_rgba(243,200,109,0.18)] hover:shadow-[0_0_40px_rgba(243,200,109,0.30)]"
          >
            {busy ? 'Authenticating…' : 'Sign in'}
          </button>

          <div className="font-mono text-[10px] text-textDim tracking-rack uppercase text-center pt-1">
            Authorized&nbsp;personnel&nbsp;only · §73.x&nbsp;workbench
          </div>
        </form>
      </div>
    </div>
  );
}
