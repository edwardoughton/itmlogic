// Feature detail panel — opens when a map feature is clicked.  Explains the
// feature in engineering terms using the layer registry: what it is, its
// regulatory standing (filing-controlling vs advisory vs infrastructure vs
// reference), its data provenance, and the raw properties (collapsible).
//
// Pure presentation — the parent owns the selection state and clears it.

import React, { useState } from 'react';
import { LAYER_BY_ID } from './layers.js';

const CLASS_STYLE = {
  'filing-controlling': { label: 'FILING-CONTROLLING', color: '#ffb000', note: 'Regulatory — determines compliance.' },
  'advisory':           { label: 'ADVISORY',           color: '#5fcf7a', note: 'Environmental RF context — not filing-controlling.' },
  'infrastructure':     { label: 'INFRASTRUCTURE',     color: '#e0795f', note: 'FCC infrastructure record.' },
  'reference':          { label: 'REFERENCE',          color: '#4fd1ff', note: 'Reference geography.' }
};

function fmt(v){
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
  return String(v);
}

export default function FeatureDetail({ selection, onClose }){
  const [rawOpen, setRawOpen] = useState(false);
  if (!selection) return null;

  const entry = LAYER_BY_ID[selection.layerKey] || null;
  const cls   = CLASS_STYLE[entry?.classification] || CLASS_STYLE.reference;
  const prov  = entry?.provenance || {};
  const rows  = selection.rows || [];               // [[label, value], …] highlights
  const raw   = selection.properties || {};

  return (
    <div className="absolute top-3 right-3 z-40 w-72 rounded border border-rule bg-black/85 backdrop-blur-sm font-mono text-[11px] text-cream">
      <div className="flex items-start gap-2 px-3 py-2 border-b border-rule">
        <div className="min-w-0">
          <div className="truncate text-cream text-[12px]">{selection.title || 'Feature'}</div>
          {selection.subtitle && <div className="truncate text-textDim text-[9px] uppercase tracking-rack">{selection.subtitle}</div>}
        </div>
        <button onClick={onClose} className="ml-auto text-textDim hover:text-cream leading-none text-[14px]">×</button>
      </div>

      <div className="px-3 py-2 space-y-2">
        <div>
          <span className="inline-block rounded px-1.5 py-0.5 text-[8px] tracking-rack"
                style={{ color: cls.color, border: `1px solid ${cls.color}55`, background: `${cls.color}14` }}>
            {cls.label}
          </span>
        </div>

        {entry?.meaning && <div className="text-textDim/90 leading-snug">{entry.meaning}</div>}

        {rows.length > 0 && (
          <div className="space-y-0.5">
            {rows.map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <span className="text-textDim/70 w-20 shrink-0">{k}</span>
                <span className="text-cream break-words">{fmt(v)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="pt-1 border-t border-rule/60 space-y-0.5 text-[9px]">
          <div className="text-textDim/70 uppercase tracking-rack">Provenance</div>
          {prov.dataset    && <div><span className="text-textDim/60">dataset </span>{prov.dataset}</div>}
          {prov.resolution && <div><span className="text-textDim/60">res </span>{prov.resolution}</div>}
          {prov.source     && <div className="break-words"><span className="text-textDim/60">source </span>{prov.source}</div>}
          {prov.generated_at && <div><span className="text-textDim/60">generated </span>{prov.generated_at}</div>}
          {prov.sha256     && <div className="break-words"><span className="text-textDim/60">sha256 </span>{prov.sha256.slice(0, 16)}…</div>}
          <div><span className="text-textDim/60">effect </span><span style={{ color: cls.color }}>{prov.effect || cls.note}</span></div>
        </div>

        {Object.keys(raw).length > 0 && (
          <div className="pt-1 border-t border-rule/60">
            <button onClick={() => setRawOpen(o => !o)} className="text-textDim/70 hover:text-cream text-[9px] uppercase tracking-rack">
              {rawOpen ? '▾' : '▸'} raw properties ({Object.keys(raw).length})
            </button>
            {rawOpen && (
              <div className="mt-1 max-h-44 overflow-auto space-y-0.5">
                {Object.entries(raw).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <span className="text-textDim/60 w-24 shrink-0 break-words">{k}</span>
                    <span className="text-cream/90 break-words">{fmt(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
