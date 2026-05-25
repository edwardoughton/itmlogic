import React from 'react';
import RackPanel from './RackPanel.jsx';

// ChartScope — oscilloscope/spectrum-scope bezel for the contour map.
// Children are rendered into the scope-grid div so the existing Leaflet
// instance stays a vanilla JS concern attached via ref.

export default function ChartScope({
  mode = '47 CFR §73.333 F(50,50)',
  status = 'Live',
  children,
  caption,
  legend = []
}) {
  return (
    <RackPanel
      eyebrow="Chart Room"
      title="Contour Scope"
      italicAccent="A clean contour, by lamplight."
      tone="cyan"
      right={(
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="rack-eyebrow">Mode</div>
            <div className="font-mono text-[11px] text-cream">{mode}</div>
          </div>
          <div className="text-right">
            <div className="rack-eyebrow">Status</div>
            <div className="font-mono text-[11px] text-amber">{status}</div>
          </div>
        </div>
      )}
    >
      <div className="scope-bezel">
        <div className="scope-grid relative" style={{ height: 540 }}>
          {/* Children: existing Leaflet container. */}
          {children}
          <div className="scanline" />
        </div>
      </div>
      {caption && (
        <div className="font-mono text-[11px] text-textDim mt-2">{caption}</div>
      )}
      {legend && legend.length > 0 && (
        <div className="flex flex-wrap gap-4 mt-2 font-mono text-[11px] text-text">
          {legend.map((l, i) => (
            <span key={i} className="inline-flex items-center gap-2">
              <span className="inline-block w-3 h-1 rounded-sm" style={{ background: l.color }} />
              <span>{l.label}</span>
            </span>
          ))}
        </div>
      )}
    </RackPanel>
  );
}
