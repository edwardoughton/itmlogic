// Map legend — shows the color/symbol encoding for whichever overlays are
// currently visible.  Ordered by the layer registry so it mirrors the panel.
// Pure presentation; reads the same `overlays` state as MapView.

import React from 'react';
import { LAYER_REGISTRY } from './layers.js';

const Line = ({ color, dash }) => (
  <span style={{ display: 'inline-block', width: 16, height: 0, borderTop: `2px ${dash ? 'dashed' : 'solid'} ${color}` }} />
);
const Dot = ({ color, ring }) => (
  <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: color,
                 boxShadow: ring ? `0 0 0 1.5px ${ring}` : 'none' }} />
);
const Ring = ({ color }) => (
  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', boxShadow: `0 0 0 2px ${color} inset` }} />
);
const Bar = ({ stops }) => (
  <span style={{ display: 'inline-block', width: 34, height: 8, borderRadius: 2, background: `linear-gradient(90deg, ${stops})` }} />
);
const Relief = () => (
  <span style={{ display: 'inline-block', width: 16, height: 10, borderRadius: 2, background: 'linear-gradient(135deg,#5b708a,#0a1a27 70%)' }} />
);

// Legend rows per layer id (only rendered when that overlay is visible).
const LEGEND = {
  stations:     { title: 'Stations',          rows: [{ sw: <Dot color="#4fd1ff" />, label: 'FCC station' }] },
  contours:     { title: 'Contours (field strength)', rows: [
    { sw: <Line color="#ffc24d" />, label: '60 dBu · service' },
    { sw: <Line color="#f0b53f" />, label: '54 dBu · city' },
    { sw: <Line color="#c08a2a" />, label: '40 dBu · protected' }
  ] },
  interference: { title: 'Interference', rows: [
    { sw: <Dot color="#ff3b30" />, label: 'conflict (fails all rules)' },
    { sw: <Dot color="#d8a23a" />, label: 'cleared neighbor' },
    { sw: <Ring color="#7fe0ff" />, label: 'subject station' }
  ] },
  towers:       { title: 'FCC towers (ASR)', rows: [{ sw: <Dot color="#e0554d" ring="#ffffff" />, label: 'antenna structure' }] },
  terrain:      { title: 'Terrain', rows: [{ sw: <Relief />, label: 'hillshade relief' }] },
  canopy:       { title: 'Tree canopy', rows: [{ sw: <Bar stops="rgba(27,99,43,0.5),#3fa53f,#bdffb4" />, label: 'sparse → dense' }] },
  water:        { title: 'Water', rows: [{ sw: <Dot color="#3aa0d8" />, label: 'hydrography' }] },
  brush:        { title: 'Brush', rows: [{ sw: <Dot color="#9a7d2e" />, label: 'scrub / grassland' }] },
  soil:         { title: 'Soil σ (mS/m)', rows: [
    { sw: <Line color="#8c3b12" />, label: '< 2 · poor (dry/rock)' },
    { sw: <Line color="#caa12e" />, label: '4 – 8' },
    { sw: <Line color="#6f9e3a" />, label: '8 – 15' },
    { sw: <Line color="#2f6fd8" />, label: '≥ 30 · excellent (wet)' }
  ] }
};

export default function MapLegend({ overlays }){
  const sections = LAYER_REGISTRY.filter(L => overlays?.[L.id] === true && LEGEND[L.id]);
  if (sections.length === 0) return null;
  return (
    <div className="absolute bottom-3 right-3 z-30 w-52 rounded border border-rule bg-black/80 backdrop-blur-sm px-3 py-2 font-mono text-[10px] text-cream max-h-[60vh] overflow-auto">
      <div className="text-textDim/70 uppercase tracking-rack text-[9px] mb-1">Legend</div>
      {sections.map(L => {
        const lg = LEGEND[L.id];
        return (
          <div key={L.id} className="mb-1.5">
            <div className="text-cream/90 text-[9px] uppercase tracking-rack">{lg.title}</div>
            {lg.rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2 mt-0.5">
                <span className="w-4 flex justify-center shrink-0">{r.sw}</span>
                <span className="text-textDim/85">{r.label}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
