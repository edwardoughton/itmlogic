import React, { useMemo, useState } from 'react';
import RackPanel from './RackPanel.jsx';

// MapPreview — a pure-SVG, no-Leaflet schematic of the predicted
// service area.  Designed for thumbnails, exhibit cards, and
// situations where we don't want a tile-server dependency.
//
// Props (all optional):
//   contours      : [{ name, field, color, km }]  concentric rings (km radius from tx)
//   tx            : { label }                     centre marker label
//   canopyKm      : number                        optional canopy/clutter halo
//   showCanopy    : boolean                       initial canopy visibility (default true)
//   width/height  : number                        viewport dimensions in px
//
// All distances are in km and projected linearly onto the SVG square.
// The component renders entirely from props — no network, no DOM apart
// from the SVG itself.

const DEFAULT_CONTOURS = [
  { name: 'Principal Community',    field: '70 dBu', color: '#22d39a', km: 5 },
  { name: 'City Grade',             field: '70 dBu', color: '#42b8ff', km: 8 },
  { name: 'Protected',              field: '60 dBu', color: '#ffb347', km: 18 },
  { name: '54 dBu',                 field: '54 dBu', color: '#c98aff', km: 32 }
];

function maxKm(contours, canopyKm){
  const xs = contours.map(c => Number(c.km) || 0).concat([Number(canopyKm) || 0]);
  const m = Math.max(...xs, 1);
  return m * 1.18; // 18% padding so the outer ring isn't clipped
}

export default function MapPreview({
  contours = DEFAULT_CONTOURS,
  tx = { label: 'TX' },
  canopyKm = null,
  showCanopy: showCanopyInitial = true,
  width  = 360,
  height = 360
}){
  const safeContours = Array.isArray(contours) && contours.length > 0
    ? contours : DEFAULT_CONTOURS;

  const [visible, setVisible] = useState(() =>
    Object.fromEntries(safeContours.map((c, i) => [c.name || `ring-${i}`, true]))
  );
  const [showCanopy, setShowCanopy] = useState(!!showCanopyInitial);
  const [showGrid,   setShowGrid]   = useState(true);

  const span = useMemo(() => maxKm(safeContours, canopyKm), [safeContours, canopyKm]);
  const cx   = width / 2;
  const cy   = height / 2;
  // 1 km in SVG units
  const scale = (Math.min(width, height) / 2) / span;
  const toR   = (km) => Math.max(0, Number(km) * scale);

  return (
    <RackPanel
      eyebrow="Geometry"
      title="Map preview"
      italicAccent="Schematic. Concentric contours centred on the transmitter."
      dense
    >
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_180px] gap-3 items-start">
        <div className="rounded-sm border border-rule bg-[#06141a] p-2">
          <svg
            role="img"
            aria-label="Service-area schematic"
            viewBox={`0 0 ${width} ${height}`}
            width="100%"
            height="100%"
            style={{ maxHeight: '420px' }}
          >
            <defs>
              <radialGradient id="canopyGrad" cx="50%" cy="50%" r="50%">
                <stop offset="0%"   stopColor="#22d39a" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#22d39a" stopOpacity="0.0"  />
              </radialGradient>
              <pattern id="gridP" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#10303a" strokeWidth="0.5" />
              </pattern>
            </defs>

            <rect x="0" y="0" width={width} height={height} fill="#06141a" />
            {showGrid && <rect x="0" y="0" width={width} height={height} fill="url(#gridP)" />}

            {/* compass cross-hairs */}
            <line x1={cx} y1="0" x2={cx} y2={height} stroke="#15333d" strokeWidth="0.7" />
            <line x1="0"  y1={cy} x2={width}  y2={cy} stroke="#15333d" strokeWidth="0.7" />

            {/* canopy / clutter halo */}
            {showCanopy && canopyKm != null && (
              <circle cx={cx} cy={cy} r={toR(canopyKm)} fill="url(#canopyGrad)" />
            )}

            {/* contour rings (outer-first so labels read correctly) */}
            {[...safeContours]
              .map((c, i) => ({ ...c, _i: i, _r: toR(c.km) }))
              .sort((a, b) => b._r - a._r)
              .map((c) => {
                const key = c.name || `ring-${c._i}`;
                if (!visible[key]) return null;
                return (
                  <g key={key}>
                    <circle
                      cx={cx} cy={cy} r={c._r}
                      fill="none"
                      stroke={c.color || '#42b8ff'}
                      strokeWidth="1.5"
                      strokeDasharray={c._i % 2 === 0 ? '' : '4 3'}
                      opacity="0.9"
                    />
                    <text
                      x={cx + c._r * 0.7071}
                      y={cy - c._r * 0.7071 - 4}
                      fill={c.color || '#42b8ff'}
                      fontFamily="ui-monospace, monospace"
                      fontSize="9"
                      textAnchor="start"
                    >
                      {c.field || ''} · {Number(c.km).toFixed(1)} km
                    </text>
                  </g>
                );
              })}

            {/* tx marker */}
            <g>
              <circle cx={cx} cy={cy} r="4" fill="#ffb347" />
              <circle cx={cx} cy={cy} r="9" fill="none" stroke="#ffb347" strokeWidth="0.8" opacity="0.6" />
              <text
                x={cx + 8} y={cy - 6}
                fill="#ffb347"
                fontFamily="ui-monospace, monospace"
                fontSize="10"
              >{tx?.label || 'TX'}</text>
            </g>

            {/* scale bar */}
            <g>
              <line
                x1={width - 80} y1={height - 14}
                x2={width - 80 + Math.min(60, toR(span / 4))} y2={height - 14}
                stroke="#9bb1bd" strokeWidth="1.2"
              />
              <text
                x={width - 80}
                y={height - 18}
                fill="#9bb1bd"
                fontFamily="ui-monospace, monospace"
                fontSize="9"
              >{(span / 4).toFixed(1)} km</text>
            </g>
          </svg>
        </div>

        <div className="flex flex-col gap-2 font-mono text-[10px] uppercase tracking-rack">
          <div className="text-textDim">Layers</div>
          {safeContours.map((c, i) => {
            const key = c.name || `ring-${i}`;
            return (
              <label key={key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!visible[key]}
                  onChange={() => setVisible(v => ({ ...v, [key]: !v[key] }))}
                />
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm"
                  style={{ background: c.color || '#42b8ff' }}
                  aria-hidden="true"
                />
                <span className="text-text truncate">{c.name || `ring ${i+1}`}</span>
              </label>
            );
          })}
          {canopyKm != null && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showCanopy}
                onChange={() => setShowCanopy(s => !s)}
              />
              <span className="text-text">Canopy halo</span>
            </label>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={showGrid}
              onChange={() => setShowGrid(s => !s)}
            />
            <span className="text-text">Grid</span>
          </label>
        </div>
      </div>
    </RackPanel>
  );
}
