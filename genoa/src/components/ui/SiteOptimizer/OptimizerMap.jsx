import React, { useEffect, useRef } from 'react';
import RackPanel from '../RackPanel.jsx';
import { primaryStatus, rankColor } from './statusUtil.js';
import InfrastructureLegend, { INFRA_MARKER_SPEC } from './InfrastructureLegend.jsx';

// OptimizerMap — Leaflet container.  Uses window.L (Leaflet is loaded
// globally from index.html, matching the existing Genoa contour map).
//
// Layers:
//   • current site               — diamond/star marker (distinct shape)
//   • search-radius              — translucent ring
//   • candidate markers          — coloured by rank
//   • candidate heat-circles     — semi-transparent overlay, shown when
//                                  zoomed out (z <= 9), simulating a
//                                  "heatmap of ranked candidates"
//   • infrastructure markers     — 9 visual treatments (5 kinds ×
//                                  selected/unselected + 1 non-evaluated
//                                  reserve).  Only added when
//                                  searchMode !== 'GRID'.
//
// All state changes flow through props.  When `selectedRank` changes
// the map pans to the candidate and opens its popup.

const HEATMAP_MAX_ZOOM = 9;

function escapeHtml(s){
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function svgDivIcon(L, color, label){
  // Distinct "diamond" star icon for the CURRENT site so it can be
  // told apart from candidate circles at any zoom level.
  const html = `
    <svg viewBox="0 0 28 28" width="28" height="28">
      <defs>
        <filter id="glow"><feGaussianBlur stdDeviation="1.4"/></filter>
      </defs>
      <polygon points="14,2 22,14 14,26 6,14"
               fill="${color}" stroke="#0a1a25" stroke-width="2" filter="url(#glow)"/>
      <text x="14" y="17" text-anchor="middle" font-family="ui-monospace,monospace"
            font-size="9" fill="#0a1a25" font-weight="700">${escapeHtml(label || '◆')}</text>
    </svg>`;
  return L.divIcon({
    html,
    className: 'optimizer-current-site-icon',
    iconSize:  [28, 28],
    iconAnchor:[14, 14]
  });
}

// Per-kind SVG glyph for infrastructure markers.  Two visual states are
// supported via the `selected` flag — selected markers get a bright
// outer ring.  The "non-evaluated" treatment is reserved for V1+ but
// rendered the same way as the spec so the legend stays accurate.
function infraDivIcon(L, kind, { selected }){
  const spec  = INFRA_MARKER_SPEC[kind] || INFRA_MARKER_SPEC.NON_EVAL;
  const color = spec.color;
  const ring  = selected
    ? `<circle cx="11" cy="11" r="10" fill="none" stroke="#ffe9b3" stroke-width="1.6"/>`
    : '';
  let body;
  switch (spec.shape){
    case 'square':
      body = `<rect x="4" y="4" width="14" height="14" fill="${color}" stroke="#0a1a25" stroke-width="1.4"/>`;
      break;
    case 'diamond':
      body = `<polygon points="11,2 20,11 11,20 2,11" fill="${color}" stroke="#0a1a25" stroke-width="1.4"/>`;
      break;
    case 'triangle':
      body = `<polygon points="11,3 20,19 2,19" fill="${color}" stroke="#0a1a25" stroke-width="1.4"/>`;
      break;
    case 'hexagon':
      body = `<polygon points="11,2 19,6 19,16 11,20 3,16 3,6" fill="${color}" stroke="#0a1a25" stroke-width="1.4"/>`;
      break;
    case 'ring':
      body = `<circle cx="11" cy="11" r="7" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="3 2"/>`;
      break;
    case 'circle':
    default:
      body = `<circle cx="11" cy="11" r="7" fill="${color}" stroke="#0a1a25" stroke-width="1.4"/>`;
  }
  const html = `<svg viewBox="0 0 22 22" width="22" height="22">${ring}${body}</svg>`;
  return L.divIcon({
    html,
    className: `optimizer-infra-icon optimizer-infra-${kind.toLowerCase()}${selected ? ' is-selected' : ''}`,
    iconSize:  [22, 22],
    iconAnchor:[11, 11]
  });
}

function inferInfraKind(candidate){
  const ref = candidate?.infrastructure_ref;
  if (ref && typeof ref.kind === 'string'){
    const k = ref.kind.toUpperCase();
    if (INFRA_MARKER_SPEC[k]) return k;
  }
  return 'NON_EVAL';
}

export default function OptimizerMap({
  currentSite,
  callsign,
  candidates,
  selectedRank,
  onSelectCandidate,
  searchRadiusKm,
  searchMode = 'GRID',
  infrastructureSites = []
}){
  const elRef    = useRef(null);
  const ctxRef   = useRef({
    map:           null,
    candLayer:     null,
    heatLayer:     null,
    infraLayer:    null,
    currentMarker: null,
    radiusCircle:  null,
    popupsByRank:  new Map()
  });

  // mount / unmount
  useEffect(() => {
    if (typeof window === 'undefined' || !window.L) return;
    if (ctxRef.current.map) return;
    const L = window.L;
    const lat = Number(currentSite?.lat) || 34.86;
    const lon = Number(currentSite?.lon) || -111.82;
    const map = L.map(elRef.current, { zoomControl: true, attributionControl: true })
      .setView([lat, lon], 9);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap · © CARTO'
    }).addTo(map);
    ctxRef.current.map        = map;
    ctxRef.current.candLayer  = L.layerGroup().addTo(map);
    ctxRef.current.heatLayer  = L.layerGroup().addTo(map);
    ctxRef.current.infraLayer = L.layerGroup().addTo(map);
    // toggle the heatmap layer based on zoom — collapsed to a single
    // boolean so we don't have to track listeners by hand.
    const onZoom = () => {
      const z = map.getZoom();
      const hl = ctxRef.current.heatLayer;
      if (!hl) return;
      if (z <= HEATMAP_MAX_ZOOM){
        if (!map.hasLayer(hl)) hl.addTo(map);
      } else {
        if (map.hasLayer(hl)) map.removeLayer(hl);
      }
    };
    map.on('zoomend', onZoom);
    onZoom();
    return () => {
      try { map.off('zoomend', onZoom); map.remove(); } catch {}
      ctxRef.current.map = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // re-draw current site marker + radius
  useEffect(() => {
    const L = window.L;
    const ctx = ctxRef.current;
    if (!L || !ctx.map) return;
    const lat = Number(currentSite?.lat);
    const lon = Number(currentSite?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    if (ctx.currentMarker){ ctx.map.removeLayer(ctx.currentMarker); ctx.currentMarker = null; }
    if (ctx.radiusCircle){ ctx.map.removeLayer(ctx.radiusCircle); ctx.radiusCircle = null; }
    ctx.currentMarker = L.marker([lat, lon], {
      icon:    svgDivIcon(L, '#ffb347', ''),
      zIndexOffset: 1000
    }).bindPopup(`<b>Current site — ${escapeHtml(callsign || '—')}</b><br/>${lat.toFixed(4)}, ${lon.toFixed(4)}`).addTo(ctx.map);
    const r = Number(searchRadiusKm);
    if (Number.isFinite(r) && r > 0){
      ctx.radiusCircle = L.circle([lat, lon], {
        radius:      r * 1000,
        color:       '#d6a36a',
        weight:      1,
        opacity:     0.7,
        dashArray:   '6 5',
        fillColor:   '#d6a36a',
        fillOpacity: 0.04,
        interactive: false
      }).addTo(ctx.map);
    }
  }, [currentSite?.lat, currentSite?.lon, callsign, searchRadiusKm]);

  // re-draw candidate markers + heatmap circles
  useEffect(() => {
    const L = window.L;
    const ctx = ctxRef.current;
    if (!L || !ctx.map) return;
    ctx.candLayer.clearLayers();
    ctx.heatLayer.clearLayers();
    ctx.popupsByRank.clear();

    const list = Array.isArray(candidates) ? candidates : [];
    if (list.length === 0) return;

    list.forEach((c) => {
      const lat = Number(c.lat), lon = Number(c.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const color  = rankColor(c.rank);
      const status = primaryStatus(c.status_labels);

      // markers — smaller for lower ranks
      const baseRadius = Math.max(5, 12 - Math.log2(Math.max(1, c.rank)));
      const marker = L.circleMarker([lat, lon], {
        radius:      baseRadius,
        color:       '#0a1a25',
        weight:      1.5,
        fillColor:   color,
        fillOpacity: 0.95
      });
      const popup = `
        <div style="font-family:ui-monospace,monospace;font-size:11px;line-height:1.4">
          <div style="font-weight:700;color:${color}">Rank #${c.rank} · score ${Number(c.score).toFixed(1)}</div>
          <div style="color:#a89c84">${lat.toFixed(4)}, ${lon.toFixed(4)}</div>
          <div style="margin-top:4px">
            <span style="color:#a89c84">Status:</span> ${escapeHtml(status)}
          </div>
          <div><span style="color:#a89c84">COL:</span> ${(Number(c.col_coverage_pct) * 100).toFixed(0)}% ·
               <span style="color:#a89c84">Day:</span> ${Number(c.daytime_reach_km).toFixed(1)} km</div>
          <div><span style="color:#a89c84">NIF:</span> ${escapeHtml(c.nif_status || '—')}</div>
          <div style="margin-top:4px;color:#efe6d6">${escapeHtml(c.notes || '')}</div>
          <div style="margin-top:6px"><i style="color:#6fd3ff">Click row in ledger for full detail.</i></div>
        </div>`;
      marker.bindPopup(popup);
      marker.bindTooltip(`#${c.rank} · ${status}`, { direction: 'top', offset: [0, -6] });
      marker.on('click', () => { if (onSelectCandidate) onSelectCandidate(c.rank); });
      marker.addTo(ctx.candLayer);
      ctx.popupsByRank.set(c.rank, marker);

      // heat-style background circle (semi-transparent, blends down)
      const heat = L.circle([lat, lon], {
        radius:      Math.max(800, (Number(c.score) || 50) * 60),
        color:       color,
        weight:      0,
        fillColor:   color,
        fillOpacity: 0.10,
        interactive: false
      });
      heat.addTo(ctx.heatLayer);
    });
  }, [candidates, onSelectCandidate]);

  // re-draw infrastructure layer (one marker per infrastructure-source
  // candidate, plus its 9-treatment glyph from INFRA_MARKER_SPEC).
  useEffect(() => {
    const L = window.L;
    const ctx = ctxRef.current;
    if (!L || !ctx.map || !ctx.infraLayer) return;
    ctx.infraLayer.clearLayers();
    if (searchMode === 'GRID') return;

    const list = Array.isArray(infrastructureSites) ? infrastructureSites : [];
    list.forEach((c) => {
      const ref = c.infrastructure_ref || {};
      const lat = Number(ref.lat ?? c.lat);
      const lon = Number(ref.lon ?? c.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      const kind = inferInfraKind(c);
      const isSel = c.rank === selectedRank;
      const icon = infraDivIcon(L, kind, { selected: isSel });
      const marker = L.marker([lat, lon], { icon, zIndexOffset: 500 });
      const name   = ref.name || c.notes || `Rank #${c.rank}`;
      const owner  = ref.owner || '—';
      const height = (ref.height_m != null) ? `${ref.height_m} m` : '—';
      const kindL  = kind.replace(/_/g, ' ');
      marker.bindTooltip(
        `<b>${escapeHtml(name)}</b><br/>${escapeHtml(owner)} · ${escapeHtml(kindL)} · ${escapeHtml(height)}`,
        { direction: 'top', offset: [0, -8] }
      );
      marker.on('click', () => { if (onSelectCandidate) onSelectCandidate(c.rank); });
      marker.addTo(ctx.infraLayer);
    });
  }, [infrastructureSites, searchMode, selectedRank, onSelectCandidate]);

  // pan + open popup when selection changes
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx.map || selectedRank == null) return;
    const m = ctx.popupsByRank.get(selectedRank);
    if (!m) return;
    const ll = m.getLatLng();
    ctx.map.panTo(ll);
    m.openPopup();
  }, [selectedRank]);

  return (
    <RackPanel
      eyebrow="Chart Room"
      title="Regional candidate map"
      italicAccent="Markers colour-coded by rank.  Zoom out for the heatmap layer."
      tone="cyan"
      right={(
        <div className="flex items-center gap-3 font-mono text-[10px] tracking-rack uppercase">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-3" style={{ background: '#ffb347', clipPath: 'polygon(50% 0,100% 50%,50% 100%,0 50%)' }} aria-hidden="true" />
            <span className="text-textDim">Current</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#ffb347' }} aria-hidden="true" />
            <span className="text-textDim">Rank 1</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: '#6fd3ff' }} aria-hidden="true" />
            <span className="text-textDim">Lower rank</span>
          </span>
        </div>
      )}
    >
      <div className="scope-bezel">
        <div className="scope-grid relative" style={{ height: 560 }}>
          <div ref={elRef} className="absolute inset-0 rounded-md" />
          <div className="scanline" />
          <InfrastructureLegend visible={searchMode !== 'GRID'} />
        </div>
      </div>
    </RackPanel>
  );
}
