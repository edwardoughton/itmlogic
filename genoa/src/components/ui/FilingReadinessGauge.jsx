import React from 'react';

// Segmented horizontal meter — 20 segments, lit warm→cool by score.
// 0–49 demo (red), 50–84 engineering_review (amber), 85–100 filing_candidate (green).

export default function FilingReadinessGauge({ score = 0, mode = 'demo', blockersCount = 0, warningsCount = 0 }) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  const lit = Math.round((s / 100) * 20);
  const segs = Array.from({ length: 20 }, (_, i) => {
    if (i >= lit) return 'off';
    // band by index
    if (i < 10) return 'red';
    if (i < 17) return 'amber';
    return 'green';
  });

  const statusColor =
    mode === 'filing_candidate'   ? 'text-green'
  : mode === 'engineering_review' ? 'text-amber'
  :                                  'text-red';

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <div className="font-mono text-[10px] tracking-rack uppercase text-textDim">Filing readiness</div>
        <div className={`font-display italic font-semibold text-[36px] leading-none ${statusColor}`} style={{ textShadow: '0 4px 18px rgba(255,179,71,0.18)' }}>
          {s}<span className="text-textDim text-[14px] font-mono not-italic font-normal">/100</span>
        </div>
      </div>
      <div className="grid grid-cols-20 gap-[2px] h-3 mb-2" style={{ gridTemplateColumns: 'repeat(20, minmax(0,1fr))' }}>
        {segs.map((tone, i) => (
          <div key={i}
               className={`rounded-[1px] ${segCls(tone)}`}
               aria-hidden="true" />
        ))}
      </div>
      <div className="flex items-center gap-3 text-[10px] font-mono tracking-rack uppercase">
        <span className={statusColor}>{mode}</span>
        <span className="text-textDim">|</span>
        <span className="text-red">{blockersCount} blocker{blockersCount !== 1 ? 's' : ''}</span>
        <span className="text-textDim">|</span>
        <span className="text-amber">{warningsCount} warning{warningsCount !== 1 ? 's' : ''}</span>
      </div>
    </div>
  );
}

function segCls(tone){
  switch (tone){
    case 'red':   return 'bg-red'    + ' opacity-90';
    case 'amber': return 'bg-amber'  + ' opacity-90';
    case 'green': return 'bg-green'  + ' opacity-90';
    default:      return 'bg-[#15252f]';
  }
}
