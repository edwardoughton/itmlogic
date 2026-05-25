import React from 'react';

// Visual seal block for the workbench right rail.  Shows the PE name /
// license / state / firm / signed-at / hash on a wax-seal styled card.
// When the exhibit isn't sealed, renders a quiet "unsealed" status so
// the operator knows a stamp is required before filing.

export default function PeSealCard({ exhibit, onCertify, onClear, hashMatch }){
  const cert = exhibit?.pe_certification;
  const sealed = cert?.certified === true;

  if (!sealed){
    return (
      <div className="rounded-md border border-rule px-4 py-3 bg-black/30">
        <div className="font-mono text-[10px] tracking-rack uppercase text-textDim">PE Certification</div>
        <div className="font-mono text-[11px] text-amber mt-1">
          Unsealed — engineering review required prior to FCC filing.
        </div>
        {exhibit ? (
          <button
            onClick={onCertify}
            className="mt-3 w-full font-mono text-[11px] tracking-rack uppercase border border-gold/50 hover:border-gold/80 rounded px-3 py-2 bg-gradient-to-b from-gold/20 to-gold/5 hover:from-gold/30 hover:to-gold/10 text-cream transition-colors"
          >
            Stamp&nbsp;exhibit
          </button>
        ) : null}
      </div>
    );
  }

  const eng = cert.engineer || {};
  const sealCircle = (
    <svg viewBox="0 0 100 100" width="68" height="68" aria-hidden="true">
      <defs>
        <radialGradient id="wax" cx="50%" cy="42%" r="55%">
          <stop offset="0%"   stopColor="#f3c86d"/>
          <stop offset="55%"  stopColor="#c4745a"/>
          <stop offset="100%" stopColor="#7a3320"/>
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="44" fill="url(#wax)" stroke="#1c2e3a" strokeWidth="1.4"/>
      <circle cx="50" cy="50" r="36" fill="none" stroke="rgba(28,46,58,0.55)" strokeWidth="0.8"/>
      <text x="50" y="42" textAnchor="middle" fontFamily="serif" fontStyle="italic" fontSize="11" fill="#1c2e3a" fontWeight="600">P.E.</text>
      <text x="50" y="56" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="6" letterSpacing="1" fill="#1c2e3a">SEALED</text>
      <text x="50" y="66" textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="5" letterSpacing="1.5" fill="#1c2e3a">{eng.license_state || '—'}</text>
    </svg>
  );

  const hashShort = (cert.exhibit_sha256 || '').slice(0, 12);
  const signedDate = cert.signed_at ? cert.signed_at.slice(0, 10) : '—';
  const signedTime = cert.signed_at ? cert.signed_at.slice(11, 19) + 'Z' : '';

  return (
    <div className="rounded-md border border-gold/40 px-4 py-3 bg-gradient-to-br from-amber/5 to-black/20 relative overflow-hidden">
      <div className="absolute -top-3 -right-3 opacity-90">
        {sealCircle}
      </div>
      <div className="font-mono text-[10px] tracking-rack uppercase text-gold">PE Certification — Sealed</div>
      <div className="mt-2 space-y-0.5 font-mono text-[11px] pr-16">
        <div className="text-cream truncate">{eng.name || '—'}</div>
        <div className="text-textDim">
          P.E. #{eng.license_no || '—'}
          {eng.license_state ? ` · ${eng.license_state}` : ''}
        </div>
        {eng.firm ? <div className="text-textDim truncate">{eng.firm}</div> : null}
        <div className="text-textDim">{signedDate} <span className="text-text/60">{signedTime}</span></div>
        <div className="text-textDim text-[10px] tracking-wider">
          SHA-256 <span className="text-cream">{hashShort}…</span>
        </div>
        {hashMatch === false ? (
          <div className="text-red text-[10px] mt-1">⚠ HASH MISMATCH — exhibit was modified after sealing.</div>
        ) : null}
      </div>
      {onClear ? (
        <button
          onClick={onClear}
          title="Clear seal (e.g. before re-running compute)"
          className="absolute bottom-2 right-2 font-mono text-[9px] tracking-rack uppercase text-textDim hover:text-red border border-rule hover:border-red/60 rounded px-2 py-0.5 bg-black/50"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
