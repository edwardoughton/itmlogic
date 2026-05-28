import React from 'react';

// Polar SVG plot of a normalized AM DA pattern.
//
//   pattern: [[az_deg, f(az)], ...]  (f ∈ [0, 1])
//   highlightAz: optional azimuth (deg) to mark with a dashed radial line
//
// Coords: 0° = up (true north), increasing clockwise per §73.150.

export default function PolarPattern({ pattern, highlightAz, size = 400, label }){
  if (!Array.isArray(pattern) || !pattern.length){
    return (
      <div className="font-mono text-[11px] text-textDim italic px-3 py-6 text-center">
        — no pattern computed —
      </div>
    );
  }
  const cx = size / 2, cy = size / 2;
  const R  = size / 2 - 16;

  const pts = pattern.map(([az, f]) => {
    const r = R * Math.max(0, Math.min(1, f));
    const t = (az - 90) * Math.PI / 180;
    return [cx + r * Math.cos(t), cy + r * Math.sin(t)];
  });
  const pointsAttr = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');

  const rings = [0.25, 0.5, 0.75, 1.0].map(f => R * f);
  const cardinals = [0, 45, 90, 135, 180, 225, 270, 315];
  const labelAz   = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

  let hi = null;
  if (Number.isFinite(highlightAz)){
    const t = (highlightAz - 90) * Math.PI / 180;
    hi = { x: cx + R * Math.cos(t), y: cy + R * Math.sin(t) };
  }

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="block mx-auto">
      {rings.map((r, i) => (
        <circle
          key={`ring-${i}`}
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={i === 3 ? 'rgba(214,163,106,0.45)' : 'rgba(214,163,106,0.15)'}
          strokeWidth={i === 3 ? 1 : 0.5}
        />
      ))}
      {cardinals.map((az, i) => {
        const t = (az - 90) * Math.PI / 180;
        const x2 = cx + R * Math.cos(t), y2 = cy + R * Math.sin(t);
        return (
          <line
            key={`card-${i}`}
            x1={cx} y1={cy} x2={x2} y2={y2}
            stroke={az % 90 === 0 ? 'rgba(214,163,106,0.30)' : 'rgba(214,163,106,0.12)'}
            strokeWidth="0.5"
          />
        );
      })}
      {cardinals.map((az, i) => {
        const t = (az - 90) * Math.PI / 180;
        const x = cx + (R + 10) * Math.cos(t), y = cy + (R + 10) * Math.sin(t) + 4;
        return (
          <text
            key={`lbl-${i}`}
            x={x.toFixed(1)} y={y.toFixed(1)}
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontSize="10"
            fill={az % 90 === 0 ? '#f3c86d' : 'rgba(214,163,106,0.55)'}
          >
            {labelAz[i]}
          </text>
        );
      })}
      <polygon
        points={pointsAttr}
        fill="rgba(243,200,109,0.18)"
        stroke="#f3c86d"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      {hi ? (
        <line
          x1={cx} y1={cy} x2={hi.x.toFixed(2)} y2={hi.y.toFixed(2)}
          stroke="#6fd3ff" strokeWidth="1.2" strokeDasharray="4,3"
        />
      ) : null}
      <circle cx={cx} cy={cy} r="2" fill="#f3c86d"/>
      {label ? (
        <text
          x={cx} y={size - 4}
          textAnchor="middle"
          fontFamily="ui-monospace, monospace"
          fontSize="10"
          fill="rgba(214,163,106,0.6)"
        >
          {label}
        </text>
      ) : null}
    </svg>
  );
}
