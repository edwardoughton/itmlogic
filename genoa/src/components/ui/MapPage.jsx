// Live Map page — Genoa RF study console.  Pick one saved exhibit and the
// map re-renders all relevant layers (contours, towers, terrain, canopy,
// water, brush, interference) framed to that report.  The overlay panel and
// the feature-detail panel are both driven by the shared layer registry, so
// every layer carries its engineering meaning, provenance, and regulatory
// standing — not just a checkbox.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import TopNav from './TopNav.jsx';
import MapView from '@components/map/MapView.jsx';
import FeatureDetail from '@components/map/FeatureDetail.jsx';
import MapLegend from '@components/map/MapLegend.jsx';
import { LAYER_REGISTRY, LAYER_GROUPS, initialOverlayState } from '@components/map/layers.js';

// Panel swatch per layer (presentation only — colors mirror the map paint).
const SWATCH = {
  stations:     { background: '#4fd1ff' },
  contours:     { background: '#ffc24d' },
  interference: { background: '#ff3b30', boxShadow: '0 0 0 1px #d8a23a inset' },
  towers:       { background: '#e0554d', boxShadow: '0 0 0 1px #ffffff' },
  terrain:      { background: 'linear-gradient(135deg,#41566a,#02070c)' },
  canopy:       { background: '#3fa53f' },
  water:        { background: '#3aa0d8' },
  brush:        { background: '#9a7d2e' },
  soil:         { background: '#b98b3a' },
  fire:         { background: '#d4632a' }
};
const COST_COLOR = { low: '#5fcf7a', medium: '#e7b84b', high: '#e06b5f' };

export default function MapPage({ authed, onNavigate, onLogout }){
  const [exhibits, setExhibits]     = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [overlays, setOverlays]     = useState(initialOverlayState);
  const [selection, setSelection]   = useState(null);   // clicked feature → detail panel
  const [status, setStatus]         = useState(null);
  const [err, setErr]               = useState(null);
  const [viewport, setViewport]     = useState(null);
  const mapStateRef                 = useRef(null);

  useEffect(() => {
    fetch('/api/map/exhibits', { credentials: 'same-origin' })
      .then(r => (r.ok ? r.json() : []))
      .then(rows => {
        const list = Array.isArray(rows) ? rows : [];
        setExhibits(list);
        setSelectedId(prev => prev ?? (list[0]?.id ?? null));
      })
      .catch(() => {});
  }, []);

  const selected = useMemo(
    () => exhibits.find(e => e.id === selectedId) || null,
    [exhibits, selectedId]
  );
  const label = e => `${e.call || e.facility_id || 'exhibit'}${e.facility_id ? ' · ' + e.facility_id : ''}`;
  const toggle = id => setOverlays(o => ({ ...o, [id]: !o[id] }));

  // Switching reports clears the stale feature selection from the prior one.
  const pickReport = (id) => { setSelectedId(id); setSelection(null); };

  const byGroup = useMemo(() => {
    const m = Object.fromEntries(LAYER_GROUPS.map(g => [g, []]));
    for (const L of LAYER_REGISTRY) (m[L.group] || (m[L.group] = [])).push(L);
    return m;
  }, []);

  const activeCount = useMemo(
    () => LAYER_REGISTRY.filter(L => L.status === 'active' && overlays[L.id]).length,
    [overlays]
  );

  // Export-ready map state — assembled now, exported later.  Kept in a ref
  // (and on window for inspection); structured, not yet serialized to a file.
  useEffect(() => {
    const active = LAYER_REGISTRY.filter(L => overlays[L.id]);
    mapStateRef.current = {
      selected_exhibit_id: selectedId,
      active_layers: active.map(L => L.id),
      layer_opacity: Object.fromEntries(active.map(L => [L.id, L.opacity])),
      viewport,
      selection: selection ? { layer: selection.layerKey, title: selection.title } : null,
      timestamp: new Date().toISOString(),
      provenance_summary: active.map(L => ({
        layer: L.id, classification: L.classification,
        dataset: L.provenance?.dataset, effect: L.provenance?.effect
      }))
    };
    if (typeof window !== 'undefined') window.__genoaMapState = mapStateRef.current;
  }, [selectedId, overlays, viewport, selection]);

  return (
    <div className="relative bg-black text-cream" style={{ height: '100vh', width: '100%', overflow: 'hidden' }}>
      <TopNav current="map" authed={!!authed} onNavigate={onNavigate} onLogout={onLogout} />
      <MapView
        onStatus={(s) => { if (s?.kind === 'error') setErr(s.text); else setStatus(s); }}
        selected={selected}
        overlays={overlays}
        onSelectFeature={setSelection}
        onViewport={setViewport}
      />

      {/* RF study console — control panel */}
      <div className="absolute top-3 left-4 z-30 w-64 rounded border border-rule bg-black/80 backdrop-blur-sm px-3 py-2.5 font-mono text-[11px]">
        <div className="flex items-center">
          <span className="text-cream tracking-rack uppercase text-[10px]">Genoa · RF Console</span>
          <span className="ml-auto text-textDim/70 text-[8px]">{activeCount} active</span>
        </div>

        <div className="mt-2 text-textDim text-[9px] uppercase tracking-rack">Report</div>
        <select
          value={selectedId ?? ''}
          onChange={e => pickReport(Number(e.target.value))}
          className="mt-1 w-full bg-black/60 border border-rule rounded px-2 py-1 text-cream text-[11px]"
        >
          {exhibits.length === 0 && <option value="">— no saved reports —</option>}
          {exhibits.map(e => <option key={e.id} value={e.id}>{label(e)}</option>)}
        </select>

        {LAYER_GROUPS.map(group => (
          <div key={group}>
            <div className="mt-3 text-textDim text-[9px] uppercase tracking-rack">{group}</div>
            {byGroup[group].map(L => {
              const soon = L.status !== 'active';
              const on   = overlays[L.id] === true;
              return (
                <label
                  key={L.id}
                  title={`${L.meaning}\n${L.provenance?.dataset || ''} — ${L.classification}`}
                  className={`flex items-center gap-2 mt-0.5 ${soon ? 'text-textDim/45' : 'cursor-pointer text-cream'}`}
                >
                  <input type="checkbox" disabled={soon} checked={!!on}
                         onChange={() => { if (!soon) toggle(L.id); }} />
                  <span className="inline-block w-2 h-2 rounded-full shrink-0" style={SWATCH[L.id] || {}} />
                  <span className="truncate">{L.label}</span>
                  {soon
                    ? <span className="ml-auto text-[8px] uppercase tracking-rack opacity-70">soon</span>
                    : <span className="ml-auto w-1.5 h-1.5 rounded-full shrink-0"
                            title={`data cost: ${L.cost}`}
                            style={{ background: COST_COLOR[L.cost] || '#888' }} />}
                </label>
              );
            })}
          </div>
        ))}

        {status && <div className="mt-2 text-textDim/80 text-[9px] break-words">{status.text}</div>}
        {err && <div className="mt-1 text-red-400 text-[9px] break-words">error: {err}</div>}
      </div>

      <FeatureDetail selection={selection} onClose={() => setSelection(null)} />
      <MapLegend overlays={overlays} />
    </div>
  );
}
