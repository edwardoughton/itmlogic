// MapLibre GL canvas — the ONE place that touches the GL instance.
//
// Builds the style from BASE_STYLE, then adds every entry in the LAYERS
// registry as a pg_tileserv vector source + layer.  Render only; no FCC
// math, no DB access — PostGIS is the source of truth, pg_tileserv the
// API, this is just the renderer (per the platform architecture).
//
// Reports status (loaded / rendered-feature-count / errors) via onStatus
// so the page HUD can surface what the map is actually doing.

import React, { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Protocol } from 'pmtiles';
import { MAP_STYLE_URL, INITIAL_VIEW, LAYERS, tileUrl, CONTOURS_URL, TOWERS_URL, CANOPY_URL, TERRAIN_DEM_URL, INTERFERENCE_URL, CONDUCTIVITY_URL } from './config.js';
import { LAYER_REGISTRY } from './layers.js';

// dBu / mV/m label for a contour feature.
function fieldLabel(p){
  if (p.field_strength_dbu != null) return `${p.field_strength_dbu} dBu`;
  if (p.field_strength_mvm != null) return `${p.field_strength_mvm} mV/m`;
  return null;
}

// Register the pmtiles:// protocol once so a self-hosted PMTiles basemap
// (referenced from the style.json, served same-origin via /basemap) reads
// via HTTP range requests.  No-op until a pmtiles source is used.
if (!globalThis.__genoaPmtilesRegistered){
  maplibregl.addProtocol('pmtiles', new Protocol().tile);
  globalThis.__genoaPmtilesRegistered = true;
}

// Escape feature property values before injecting into popup HTML — tile
// attributes are external input and could contain markup.
function esc(v){
  return String(v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// [[minLng,minLat],[maxLng,maxLat]] over every coordinate in a GeoJSON FC,
// recursing through Polygon/MultiPolygon/LineString nesting.  Returns null
// when the collection has no usable coordinates (so callers can fall back).
function boundsOf(fc){
  if (!fc || !Array.isArray(fc.features) || !fc.features.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, seen = false;
  const visit = (c) => {
    if (typeof c[0] === 'number'){
      const [x, y] = c;
      if (Number.isFinite(x) && Number.isFinite(y)){
        minX = Math.min(minX, x); minY = Math.min(minY, y);
        maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); seen = true;
      }
    } else for (const cc of c) visit(cc);
  };
  for (const f of fc.features) if (f?.geometry?.coordinates) visit(f.geometry.coordinates);
  return seen ? [[minX, minY], [maxX, maxY]] : null;
}

export default function MapView({ onStatus, selected, overlays, onSelectFeature, onViewport }){
  const containerRef = useRef(null);
  const mapRef       = useRef(null);
  const [ready, setReady] = useState(false);   // map 'load' fired
  // Latest callbacks via refs so the create-once map handlers always call the
  // current prop without tearing the map down.
  const statusRef    = useRef(onStatus);
  statusRef.current  = onStatus;
  const report = (s) => { if (statusRef.current) statusRef.current(s); };
  const selectRef    = useRef(onSelectFeature);
  selectRef.current  = onSelectFeature;
  const emitSelect   = (sel) => { if (selectRef.current) selectRef.current(sel); };
  const viewportRef  = useRef(onViewport);
  viewportRef.current = onViewport;
  // Latest overlays via ref so the pulse animation reads current toggle
  // state without restarting.  rafRef holds the beacon-pulse rAF handle;
  // towersHasDataRef gates the pulse so it stays idle (lets the map reach
  // 'idle') until towers are actually loaded AND the overlay is on.
  const overlaysRef       = useRef(overlays);
  overlaysRef.current     = overlays;
  const rafRef            = useRef(null);
  const towersHasDataRef  = useRef(false);
  // The tree-canopy grid is expensive to sample, so it's fetched on demand
  // (only while the overlay is on).  Tracks the report id whose canopy is
  // currently loaded so toggling off→on doesn't refetch the same area.
  const canopyKeyRef      = useRef(null);
  // Same opt-in pattern for the soil-conductivity layer (medium-cost query).
  const soilKeyRef        = useRef(null);
  // { id, bounds } of the report whose contours are currently loaded —
  // set by the selected-report effect so the canopy effect can sample the
  // whole contour footprint (not just a circle around the station).
  const contourInfoRef    = useRef({ id: null, bounds: null });

  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const layerIds = LAYERS.map(L => `${L.id}-${L.type}`);
    const map = new maplibregl.Map({
      container:          containerRef.current,
      style:              MAP_STYLE_URL,
      center:             INITIAL_VIEW.center,
      zoom:               INITIAL_VIEW.zoom,
      attributionControl: { compact: true }
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }));
    // Safety net: if the container gets its real size after init (lazy
    // mount / layout), force MapLibre to remeasure so the canvas isn't 0px.
    requestAnimationFrame(() => { try { map.resize(); } catch {} });

    map.on('error', (e) => {
      const err = e?.error || e;
      const src = e?.sourceId ? ` [src:${e.sourceId}]` : '';
      const st  = err?.status ? ` ${err.status}` : '';
      const url = err?.url ? ` ${err.url}` : '';
      report({ kind: 'error', text: `${(err?.message || String(err)).slice(0, 200)}${src}${st}${url}` });
    });

    map.on('load', () => {
      // Terrain hillshade — Terrarium DEM via the same-origin /terrain
      // proxy.  Added first so it sits at the bottom of the data stack
      // (over the basemap, under all data overlays).  Off by default;
      // toned for the dark navy base so it adds relief without washing
      // the map out.
      if (!map.getSource('genoa:dem')){
        map.addSource('genoa:dem', {
          type: 'raster-dem', tiles: [TERRAIN_DEM_URL], encoding: 'terrarium', tileSize: 256, maxzoom: 15
        });
        map.addLayer({ id: 'terrain-hillshade', type: 'hillshade', source: 'genoa:dem',
          layout: { visibility: 'none' },
          paint: {
            'hillshade-exaggeration':          0.45,
            'hillshade-shadow-color':          '#02070c',
            'hillshade-highlight-color':       '#41566a',
            'hillshade-accent-color':          '#0a1a27',
            'hillshade-illumination-direction': 315
          } });
      }

      // Tree-canopy density field — graduated green dots, drawn at the
      // BOTTOM of the data stack (under contours/stations/towers) as
      // environmental context.  Loaded on demand by the canopy effect.
      if (!map.getSource('genoa:canopy')){
        map.addSource('genoa:canopy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        // Smooth green density wash (weighted by canopy_pct) — reads as a
        // vegetation layer rather than scattered dots.  0 % samples carry
        // zero weight, so the valley floor stays transparent.
        map.addLayer({ id: 'canopy-heat', type: 'heatmap', source: 'genoa:canopy',
          layout: { visibility: 'none' },   // off by default (opt-in)
          paint: {
            'heatmap-weight':    ['interpolate', ['linear'], ['get', 'canopy_pct'], 0, 0, 100, 1],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 9, 1.1, 13, 1.6],
            'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
              0.00, 'rgba(8,28,10,0)',
              0.15, 'rgba(27,99,43,0.35)',
              0.40, 'rgba(63,165,63,0.55)',
              0.70, 'rgba(116,224,122,0.72)',
              1.00, 'rgba(189,255,180,0.88)'],
            'heatmap-radius':    ['interpolate', ['linear'], ['zoom'], 5, 16, 8, 28, 11, 48, 14, 80],
            'heatmap-opacity':   0.85
          } });
      }

      // Water + Brush highlights — styled directly on the self-hosted
      // basemap's own vector layers (no sampling): the 'water' source-layer
      // (polygons + river/stream lines) and the 'landcover' scrub/grassland
      // classes.  Off by default; brighten those features when toggled.
      if (!map.getLayer('water-hi')){
        map.addLayer({ id: 'water-hi', type: 'fill', source: 'protomaps', 'source-layer': 'water',
          filter: ['==', '$type', 'Polygon'], layout: { visibility: 'none' },
          paint: { 'fill-color': '#15557a', 'fill-opacity': 0.6 } });
        map.addLayer({ id: 'water-hi-edge', type: 'line', source: 'protomaps', 'source-layer': 'water',
          filter: ['==', '$type', 'Polygon'], layout: { visibility: 'none' },
          paint: { 'line-color': '#4fd1ff', 'line-width': 0.8, 'line-opacity': 0.5 } });
        map.addLayer({ id: 'water-hi-rivers', type: 'line', source: 'protomaps', 'source-layer': 'water',
          filter: ['in', ['get', 'kind'], ['literal', ['river', 'stream', 'canal']]], layout: { visibility: 'none' },
          paint: { 'line-color': '#3aa0d8', 'line-opacity': 0.75,
                   'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 12, 1.8] } });
      }
      if (!map.getLayer('brush-hi')){
        map.addLayer({ id: 'brush-hi', type: 'fill', source: 'protomaps', 'source-layer': 'landcover',
          filter: ['in', ['get', 'kind'], ['literal', ['scrub', 'grassland']]], layout: { visibility: 'none' },
          paint: {
            'fill-color': ['match', ['get', 'kind'], 'scrub', '#9a7d2e', 'grassland', '#6f7a3a', '#8a7d33'],
            'fill-opacity': 0.42
          } });
      }

      // FCC §73.190 M3 ground-conductivity σ boundary lines — colored from
      // poor/dry (warm) to highly conductive/wet (cool), the way the FCC M3
      // map is drawn.  Loaded on demand (opt-in) by the soil effect.
      if (!map.getSource('genoa:conductivity')){
        map.addSource('genoa:conductivity', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        const sigma = ['to-number', ['get', 'm3_value'], 0];
        map.addLayer({ id: 'conductivity-lines', type: 'line', source: 'genoa:conductivity',
          layout: { visibility: 'none', 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['step', sigma,
              '#8c3b12', 2, '#b5651d', 4, '#caa12e', 8, '#6f9e3a', 15, '#2f9e8f', 30, '#2f6fd8'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 9, 1.1, 13, 2.0],
            'line-opacity': 0.82
          } });
        const sHover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
        map.on('mousemove', 'conductivity-lines', (ev) => {
          const f = ev.features?.[0]; if (!f) return;
          map.getCanvas().style.cursor = 'pointer';
          const v = f.properties?.m3_value;
          sHover.setLngLat(ev.lngLat)
            .setHTML(`<div style="font:600 11px/1.3 monospace;color:#bfe3ff">σ ${esc(v ?? '?')} mS/m</div>`)
            .addTo(map);
        });
        map.on('mouseleave', 'conductivity-lines', () => { map.getCanvas().style.cursor = ''; sHover.remove(); });
        map.on('click', 'conductivity-lines', (ev) => {
          const f = ev.features?.[0]; if (!f) return;
          const v = f.properties?.m3_value;
          emitSelect({
            layerKey: 'soil',
            title: `σ ${v ?? '?'} mS/m`,
            subtitle: '§73.190 M3 conductivity boundary',
            rows: [['conductivity', v != null ? `${v} mS/m` : null]].filter(r => r[1] != null),
            properties: f.properties || {}, lngLat: ev.lngLat
          });
        });
      }

      // §73.333 / §73.184 contours (GeoJSON from saved exhibits).  The inner
      // SERVICE contour reads brightest/thickest; the outer PROTECTED contour
      // is thinner and dimmer, with a subtle amber glow underneath.  Width and
      // opacity scale with zoom so the set stays legible at every scale.
      const contourColor = ['match', ['get', 'contour_id'],
        'service_60dbu', '#ffc24d',
        'city_54dbu',    '#f0b53f',
        'protected_40dbu', '#c08a2a',
        /* default */    '#9a7b2e'];
      // Per-contour relative weight (service = inner = strongest), used only
      // where there's no zoom term (glow width).  Where a property also
      // varies with zoom, the zoom-interpolate MUST be top-level and the
      // per-contour value lives in each stop as a match — MapLibre forbids a
      // nested 'zoom' subexpression.
      const contourWeight = ['match', ['get', 'contour_id'],
        'service_60dbu', 1.0, 'city_54dbu', 0.85, 'protected_40dbu', 0.7, 0.8];
      // [service, city, protected, default] → a contour_id match expression.
      const byContour = (s, c, p, d) => ['match', ['get', 'contour_id'],
        'service_60dbu', s, 'city_54dbu', c, 'protected_40dbu', p, d];
      if (!map.getSource('genoa:contours')){
        // Starts empty; the selected-report effect sets the data.
        map.addSource('genoa:contours', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'contours-fill', type: 'fill', source: 'genoa:contours',
          paint: { 'fill-color': contourColor,
                   'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.06, 11, 0.13] } });
        map.addLayer({ id: 'contours-glow', type: 'line', source: 'genoa:contours',
          paint: { 'line-color': contourColor, 'line-blur': 4.5,
                   'line-width': ['*', contourWeight, 9],
                   'line-opacity': ['interpolate', ['linear'], ['zoom'],
                     5,  byContour(0.34, 0.28, 0.20, 0.26),
                     11, byContour(0.55, 0.45, 0.34, 0.40)] } });
        map.addLayer({ id: 'contours-line', type: 'line', source: 'genoa:contours',
          paint: { 'line-color': contourColor,
                   'line-width': ['interpolate', ['linear'], ['zoom'],
                     5,  byContour(2.5, 2.0, 1.6, 1.9),
                     13, byContour(5.5, 4.6, 3.8, 4.2)],
                   'line-opacity': ['interpolate', ['linear'], ['zoom'],
                     5,  byContour(0.90, 0.78, 0.62, 0.72),
                     11, byContour(1.0, 0.90, 0.78, 0.85)] } });
        // Field-strength labels along each contour (e.g. "60 dBu") — the
        // hallmark of a real RF coverage map.  Placed on the line, repeated,
        // shown from mid zoom so they don't crowd the wide view.
        map.addLayer({ id: 'contours-label', type: 'symbol', source: 'genoa:contours',
          minzoom: 7,
          layout: {
            'symbol-placement': 'line', 'symbol-spacing': 260,
            'text-field': ['case',
              ['!=', ['to-string', ['get', 'field_strength_dbu']], ''],
                ['concat', ['to-string', ['get', 'field_strength_dbu']], ' dBu'],
              ['!=', ['to-string', ['get', 'field_strength_mvm']], ''],
                ['concat', ['to-string', ['get', 'field_strength_mvm']], ' mV/m'],
              ''],
            'text-font': ['Noto Sans Medium'], 'text-size': 10.5,
            'text-letter-spacing': 0.04, 'text-max-angle': 30, 'text-padding': 4
          },
          paint: { 'text-color': '#ffe0a0', 'text-halo-color': '#1a1205', 'text-halo-width': 1.6, 'text-opacity': 0.95 } });

        // Hover tooltip (contour name + field strength) and click → detail.
        const cHover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
        map.on('mousemove', 'contours-line', (ev) => {
          const f = ev.features?.[0]; if (!f) return;
          map.getCanvas().style.cursor = 'pointer';
          const p = f.properties || {};
          const fl = fieldLabel(p);
          cHover.setLngLat(ev.lngLat)
            .setHTML(`<div style="font:600 11px/1.3 monospace;color:#ffd98a">${esc(p.label || p.contour_id || 'contour')}${fl ? ` · ${esc(fl)}` : ''}</div>`)
            .addTo(map);
        });
        map.on('mouseleave', 'contours-line', () => { map.getCanvas().style.cursor = ''; cHover.remove(); });
        map.on('click', 'contours-line', (ev) => {
          const f = ev.features?.[0]; if (!f) return;
          const p = f.properties || {};
          emitSelect({
            layerKey: 'contours',
            title: p.label || p.contour_id || 'Contour',
            subtitle: [p.call, p.contour_id].filter(Boolean).join(' · ') || 'Contour',
            rows: [
              ['field', fieldLabel(p)],
              ['mean radius', p.mean_radial_km != null ? `${(+p.mean_radial_km).toFixed(1)} km` : null],
              ['area', p.area_km2 != null ? `${Math.round(+p.area_km2)} km²` : null],
              ['method', p.method],
              ['call', p.call]
            ].filter(r => r[1] != null && r[1] !== ''),
            properties: p, lngLat: ev.lngLat
          });
        });
      }

      // Selected-station focus marker — a cobalt highlight ring + call label
      // at the centre of the contour set, so the station the study belongs to
      // is unmistakable.  Set per report by the selected-report effect.
      if (!map.getSource('genoa:focus')){
        map.addSource('genoa:focus', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        map.addLayer({ id: 'focus-halo', type: 'circle', source: 'genoa:focus',
          paint: { 'circle-color': '#4fd1ff', 'circle-opacity': 0.10, 'circle-blur': 0.6,
                   'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 10, 11, 20] } });
        map.addLayer({ id: 'focus-ring', type: 'circle', source: 'genoa:focus',
          paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#7fe0ff',
                   'circle-stroke-width': 2.4, 'circle-stroke-opacity': 0.95,
                   'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 5, 11, 8] } });
        map.addLayer({ id: 'focus-label', type: 'symbol', source: 'genoa:focus',
          layout: {
            'text-field': ['get', 'call'], 'text-size': 12, 'text-offset': [0, 1.3],
            'text-anchor': 'top', 'text-font': ['Noto Sans Regular'], 'text-allow-overlap': true
          },
          paint: { 'text-color': '#cfeefc', 'text-halo-color': '#001018', 'text-halo-width': 1.4 } });
      }

      for (const L of LAYERS){
        const srcId   = `genoa:${L.sourceLayer}`;
        const layerId = `${L.id}-${L.type}`;
        if (!map.getSource(srcId)){
          map.addSource(srcId, { type: 'vector', tiles: [tileUrl(L.sourceLayer)], minzoom: 0, maxzoom: 22 });
        }
        // Guard: the style.json may already define this layer (e.g. once
        // it's styled in maputnik) — don't double-add.
        if (!map.getLayer(layerId)){
          map.addLayer({
            id:             layerId,
            type:           L.type,
            source:         srcId,
            'source-layer': L.sourceLayer,
            minzoom:        L.minzoom ?? 0,
            paint:          L.paint || {}
          });
        }

        if (L.type === 'circle'){
          // Click → unified feature-detail panel.
          map.on('click', layerId, (ev) => {
            const f = ev.features?.[0];
            if (!f) return;
            const p = f.properties || {};
            emitSelect({
              layerKey: 'stations',
              title: p.callsign || p.call || p.id || 'Station',
              subtitle: [p.service, p.frequency].filter(Boolean).join(' · ') || 'Station',
              rows: Object.entries(p).slice(0, 8),
              properties: p, lngLat: ev.lngLat
            });
          });
          // Hover inspector → lightweight tooltip that follows the cursor.
          const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 12 });
          map.on('mousemove', layerId, (ev) => {
            const f = ev.features?.[0];
            if (!f) return;
            map.getCanvas().style.cursor = 'pointer';
            const p = f.properties || {};
            const title = p.callsign || p.id || 'station';
            hover.setLngLat(ev.lngLat)
              .setHTML(`<div style="font:600 11px/1.3 monospace;color:#cfeefc">${esc(title)}</div>`)
              .addTo(map);
          });
          map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; hover.remove(); });
        }
      }

      // FCC ASR towers — pulsing red/white obstruction-beacon dots, drawn
      // ON TOP of everything.  Data is set per selected report (nearby
      // structures) by the selected-report effect; starts empty.
      if (!map.getSource('genoa:towers')){
        map.addSource('genoa:towers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        // Faint slow halo (radius + opacity animated each frame) — a gentle
        // breathing cue, not an attention-grabbing strobe.
        map.addLayer({ id: 'towers-pulse', type: 'circle', source: 'genoa:towers',
          paint: { 'circle-color': '#ff6b61', 'circle-radius': 4, 'circle-opacity': 0.0, 'circle-blur': 0.6 } });
        // Small dim-red core with a thin dark outline — subtle on the navy base.
        map.addLayer({ id: 'towers-core', type: 'circle', source: 'genoa:towers',
          paint: { 'circle-color': '#e0554d', 'circle-radius': 2.6,
                   'circle-stroke-color': '#2a0d0b', 'circle-stroke-width': 0.6, 'circle-opacity': 0.78 } });

        const towerHover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10 });
        map.on('mousemove', 'towers-core', (ev) => {
          const f = ev.features?.[0]; if (!f) return;
          map.getCanvas().style.cursor = 'pointer';
          const p = f.properties || {};
          const h = p.overall_height_m != null ? ` · ${Math.round(Number(p.overall_height_m))} m` : '';
          towerHover.setLngLat(ev.lngLat)
            .setHTML(`<div style="font:600 11px/1.3 monospace;color:#ffd1c9">ASR ${esc(p.asr_number || '?')}${h}</div>`)
            .addTo(map);
        });
        map.on('mouseleave', 'towers-core', () => { map.getCanvas().style.cursor = ''; towerHover.remove(); });
        map.on('click', 'towers-core', (ev) => {
          const f = ev.features?.[0];
          if (!f) return;
          const p = f.properties || {};
          const h = p.overall_height_m != null ? `${Math.round(Number(p.overall_height_m))} m AGL` : null;
          const where = [p.structure_city, p.structure_state].filter(Boolean).join(', ');
          emitSelect({
            layerKey: 'towers',
            title: p.asr_number ? `ASR ${p.asr_number}` : (p.owner || 'Tower'),
            subtitle: p.structure_type || 'FCC ASR structure',
            rows: [
              ['owner', p.owner], ['type', p.structure_type], ['height', h],
              ['status', p.status], ['location', where || null],
              ['distance', p.distance_m != null ? `${(p.distance_m / 1000).toFixed(1)} km` : null]
            ].filter(r => r[1] != null && r[1] !== ''),
            properties: p, lngLat: ev.lngLat
          });
        });
        map.on('mouseenter', 'towers-core', () => { map.getCanvas().style.cursor = 'pointer'; });

        // Beacon pulse.  Only dirties the map while towers are loaded AND
        // the overlay is on — otherwise the loop spins cheaply and lets the
        // map reach 'idle' so the feature-count status can report.
        const pulseStart = performance.now();
        const pulse = () => {
          const m = mapRef.current;
          if (!m){ return; }
          const on = overlaysRef.current?.towers !== false;
          if (on && towersHasDataRef.current && m.getLayer('towers-pulse')){
            const phase = ((performance.now() - pulseStart) % 2600) / 2600;
            m.setPaintProperty('towers-pulse', 'circle-radius', 3 + phase * 6);
            m.setPaintProperty('towers-pulse', 'circle-opacity', 0.18 * (1 - phase));
          }
          rafRef.current = requestAnimationFrame(pulse);
        };
        rafRef.current = requestAnimationFrame(pulse);
      }

      // Co/adjacent-channel interference — subject + nearby primaries +
      // conflict links, drawn ON TOP.  Data set per selected report.
      if (!map.getSource('genoa:interference')){
        map.addSource('genoa:interference', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        // Conflict links — dashed red lines from subject to stations that
        // fail every applicable rule.  Bottom of this group.
        map.addLayer({ id: 'interference-links', type: 'line', source: 'genoa:interference',
          filter: ['==', ['get', 'role'], 'conflict-link'], layout: { visibility: 'none' },
          paint: { 'line-color': '#ff4d4d', 'line-width': 1.2, 'line-opacity': 0.7, 'line-dasharray': [2, 2] } });
        // Neighbor stations.  Conflicts (fail every rule) are bold red so
        // they dominate; cleared co/adjacent-channel neighbors recede to a
        // small faint amber dot for context (an FM site can have hundreds).
        map.addLayer({ id: 'interference-neighbors', type: 'circle', source: 'genoa:interference',
          filter: ['==', ['get', 'role'], 'neighbor'], layout: { visibility: 'none' },
          paint: {
            // One zoom-interpolate (MapLibre allows only one per property);
            // the conflict/cleared sizing lives in each stop's output.
            'circle-radius': ['interpolate', ['linear'], ['zoom'],
              5,  ['case', ['get', 'conflict'], 5, 1.6],
              9,  ['case', ['get', 'conflict'], 8, 2.6],
              13, ['case', ['get', 'conflict'], 11, 4]],
            'circle-color':        ['case', ['get', 'conflict'], '#ff3b30', '#d8a23a'],
            'circle-opacity':      ['case', ['get', 'conflict'], 0.95, 0.38],
            'circle-stroke-color': '#1a0f02',
            'circle-stroke-width': ['case', ['get', 'conflict'], 1.2, 0]
          } });
        // Subject station — cyan ring so it stands apart from neighbors.
        map.addLayer({ id: 'interference-subject', type: 'circle', source: 'genoa:interference',
          filter: ['==', ['get', 'role'], 'subject'], layout: { visibility: 'none' },
          paint: {
            'circle-radius': 6, 'circle-color': 'rgba(0,0,0,0)',
            'circle-stroke-color': '#4fd1ff', 'circle-stroke-width': 2.4, 'circle-opacity': 1
          } });

        map.on('click', 'interference-neighbors', (ev) => {
          const f = ev.features?.[0];
          if (!f) return;
          const p = f.properties || {};
          const freq = p.frequency_mhz != null ? `${p.frequency_mhz} MHz`
                     : p.frequency_khz != null ? `${p.frequency_khz} kHz` : null;
          const dist = p.distance_km != null ? `${Math.round(Number(p.distance_km))} km` : null;
          const verdict = p.conflict ? `CONFLICT — fails ${p.failed_rules || 'all rules'}`
                                     : (p.qualified_via ? `clears via ${p.qualified_via}` : 'cleared');
          emitSelect({
            layerKey: 'interference',
            title: p.call || 'Station',
            subtitle: p.channel_relationship || 'co/adjacent-channel',
            rows: [
              ['service', p.service], ['class', p.fcc_class], ['freq', freq],
              ['distance', dist], ['relationship', p.channel_relationship], ['verdict', verdict]
            ].filter(r => r[1] != null && r[1] !== ''),
            properties: p, lngLat: ev.lngLat
          });
        });
        map.on('mouseenter', 'interference-neighbors', () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', 'interference-neighbors', () => { map.getCanvas().style.cursor = ''; });
      }

      report({ kind: 'info', text: `style loaded · ${LAYERS.length} layer(s) added` });
      setReady(true);
    });

    // Once the map settles, report how many features actually rendered —
    // distinguishes "tile served but nothing drawn" (source-layer/paint)
    // from "rendered, just not where you're looking".
    map.on('idle', () => {
      try {
        const present = layerIds.filter(id => map.getLayer(id));
        const n = present.length ? map.queryRenderedFeatures({ layers: present }).length : 0;
        report({ kind: 'features', text: `${n} feature(s) rendered` });
      } catch { /* querying before layers exist — ignore */ }
    });

    // Report viewport on move so the page can assemble export-ready state.
    map.on('moveend', () => {
      if (!viewportRef.current) return;
      try {
        const c = map.getCenter(); const b = map.getBounds();
        viewportRef.current({
          center: [+c.lng.toFixed(6), +c.lat.toFixed(6)],
          zoom:   +map.getZoom().toFixed(3),
          bearing: +map.getBearing().toFixed(2),
          pitch:   +map.getPitch().toFixed(2),
          bounds: [[+b.getWest().toFixed(6), +b.getSouth().toFixed(6)], [+b.getEast().toFixed(6), +b.getNorth().toFixed(6)]]
        });
      } catch { /* ignore */ }
    });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, []);   // create the map exactly once

  // Load the picked report's contours into the source, then SNAP the
  // viewport to the contour extent.  We fetch the GeoJSON ourselves (rather
  // than handing setData a URL) so we can frame the map to the geometry —
  // otherwise the camera relies on lat/lon, which Postgres returns as
  // strings, so the old Number.isFinite guard silently failed and never
  // moved the map.
  useEffect(() => {
    if (!ready || !mapRef.current || !selected) return;
    const map = mapRef.current;
    const cSrc = map.getSource('genoa:contours');
    const tSrc = map.getSource('genoa:towers');
    const iSrc = map.getSource('genoa:interference');
    const fSrc = map.getSource('genoa:focus');
    const focusAt = (lng, lt) => {
      if (fSrc && fSrc.setData && Number.isFinite(lng) && Number.isFinite(lt)){
        fSrc.setData({ type: 'FeatureCollection', features: [{
          type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lt] },
          properties: { call: selected.call || selected.facility_id || '' }
        }] });
      }
    };
    const url = `${CONTOURS_URL}?exhibit=${encodeURIComponent(selected.id)}`;
    const lat = Number(selected.lat), lon = Number(selected.lon);
    let cancelled = false;
    // Cancel in-flight fetches when the report switches (no stale data wins).
    const ac = new AbortController();
    const opts = { credentials: 'same-origin', signal: ac.signal };

    // Interference picture (subject + nearby co/adjacent-channel primaries
    // + conflict links) — cheap saved-payload read, fetched on every select.
    if (iSrc && iSrc.setData){
      fetch(`${INTERFERENCE_URL}?exhibit=${encodeURIComponent(selected.id)}`, opts)
        .then(r => (r.ok ? r.json() : { type: 'FeatureCollection', features: [] }))
        .then(fc => { if (!cancelled) iSrc.setData(fc && Array.isArray(fc.features) ? fc : { type: 'FeatureCollection', features: [] }); })
        .catch(() => {});
    }

    const flyToStation = () => {
      if (Number.isFinite(lat) && Number.isFinite(lon)){
        map.flyTo({ center: [lon, lat], zoom: 9, speed: 0.8 });
      }
    };

    // Pull the FCC towers near this report (centered + radius from the
    // contour extent when we have one, else the station point + 75 km).
    const loadTowers = (cLng, cLat, radius_m) => {
      if (!(tSrc && tSrc.setData) || !Number.isFinite(cLng) || !Number.isFinite(cLat)) return;
      const u = `${TOWERS_URL}?lat=${cLat}&lon=${cLng}&radius_m=${Math.round(radius_m)}`;
      fetch(u, opts)
        .then(r => (r.ok ? r.json() : { type: 'FeatureCollection', features: [] }))
        .then(fc => {
          if (cancelled) return;
          const safe = fc && Array.isArray(fc.features) ? fc : { type: 'FeatureCollection', features: [] };
          tSrc.setData(safe);
          towersHasDataRef.current = safe.features.length > 0;
        })
        .catch(() => {});
    };

    fetch(url, opts)
      .then(r => (r.ok ? r.json() : { type: 'FeatureCollection', features: [] }))
      .then(fc => {
        if (cancelled) return;
        if (cSrc && cSrc.setData) cSrc.setData(fc);
        const b = boundsOf(fc);
        contourInfoRef.current = { id: selected.id, bounds: b };
        if (b){
          map.fitBounds(b, { padding: 64, maxZoom: 11, duration: 900 });
          const cLng = (b[0][0] + b[1][0]) / 2, cLat = (b[0][1] + b[1][1]) / 2;
          // Highlight the station: its own coords when known, else the
          // contour centroid.
          focusAt(Number.isFinite(lon) ? lon : cLng, Number.isFinite(lat) ? lat : cLat);
          const spanLatM = (b[1][1] - b[0][1]) * 111_320;
          const spanLonM = (b[1][0] - b[0][0]) * 111_320 * Math.cos(cLat * Math.PI / 180);
          const radius_m = Math.min(200_000, Math.max(40_000, Math.hypot(spanLatM, spanLonM) / 2 * 1.15));
          loadTowers(cLng, cLat, radius_m);
        } else {
          focusAt(lon, lat);
          flyToStation();
          loadTowers(lon, lat, 75_000);
        }
      })
      .catch(() => { if (!cancelled){ flyToStation(); loadTowers(lon, lat, 75_000); } });

    return () => { cancelled = true; ac.abort(); };
  }, [ready, selected]);

  // Overlay visibility — driven entirely by the layer registry.  Each active
  // overlay's MapLibre layer ids are shown when overlays[id] === true.
  useEffect(() => {
    if (!ready || !mapRef.current || !overlays) return;
    const map = mapRef.current;
    const vis = (id, on) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'); };
    for (const L of LAYER_REGISTRY){
      if (L.status !== 'active') continue;
      const on = overlays[L.id] === true;
      for (const mid of L.mapLayerIds) vis(mid, on);
    }
  }, [ready, overlays]);

  // Tree-canopy overlay — sampled on demand (it's expensive).  Fetches the
  // canopy density grid only while the overlay is on, sampling a fixed
  // radius around the selected station, and refetches when the report
  // changes.  Toggling off→on for the same report reuses the loaded grid.
  const canopyOn = overlays?.canopy === true;
  useEffect(() => {
    if (!ready || !mapRef.current || !selected || !canopyOn) return;
    if (canopyKeyRef.current === selected.id) return;   // already loaded for this report
    const map = mapRef.current;
    const src = map.getSource('genoa:canopy');
    const lat = Number(selected.lat), lon = Number(selected.lon);
    if (!(src && src.setData)) return;
    let cancelled = false;
    const ac = new AbortController();

    // Prefer the full contour footprint (padded 8%) so the canopy field
    // covers the whole study area, not just a circle around the station.
    const info = contourInfoRef.current;
    let query;
    if (info && info.id === selected.id && info.bounds){
      const [[w, s], [e, n]] = info.bounds;
      const px = (e - w) * 0.08, py = (n - s) * 0.08;
      query = `bbox=${w - px},${s - py},${e + px},${n + py}`;
    } else if (Number.isFinite(lat) && Number.isFinite(lon)){
      query = `lat=${lat}&lon=${lon}&radius_km=45`;
    } else {
      return;
    }

    report({ kind: 'info', text: 'sampling tree canopy…' });
    fetch(`${CANOPY_URL}?${query}`, { credentials: 'same-origin', signal: ac.signal })
      .then(r => (r.ok ? r.json() : { type: 'FeatureCollection', features: [] }))
      .then(fc => {
        if (cancelled) return;
        const safe = fc && Array.isArray(fc.features) ? fc : { type: 'FeatureCollection', features: [] };
        src.setData(safe);
        canopyKeyRef.current = selected.id;
        report({ kind: 'info', text: `tree canopy · ${safe.features.length} sample(s)` });
      })
      .catch(() => {});

    return () => { cancelled = true; ac.abort(); };
  }, [ready, selected, canopyOn]);

  // Soil conductivity (§73.190 M3) — medium-cost PostGIS bbox query, loaded
  // on demand while the overlay is on, over the report's footprint.
  const soilOn = overlays?.soil === true;
  useEffect(() => {
    if (!ready || !mapRef.current || !selected || !soilOn) return;
    if (soilKeyRef.current === selected.id) return;
    const map = mapRef.current;
    const src = map.getSource('genoa:conductivity');
    const lat = Number(selected.lat), lon = Number(selected.lon);
    if (!(src && src.setData)) return;
    let cancelled = false;
    const ac = new AbortController();

    const info = contourInfoRef.current;
    let query;
    if (info && info.id === selected.id && info.bounds){
      const [[w, s], [e, n]] = info.bounds;
      const px = (e - w) * 0.1, py = (n - s) * 0.1;
      query = `bbox=${w - px},${s - py},${e + px},${n + py}`;
    } else if (Number.isFinite(lat) && Number.isFinite(lon)){
      query = `lat=${lat}&lon=${lon}&radius_km=80`;
    } else { return; }

    fetch(`${CONDUCTIVITY_URL}?${query}`, { credentials: 'same-origin', signal: ac.signal })
      .then(r => (r.ok ? r.json() : { type: 'FeatureCollection', features: [] }))
      .then(fc => {
        if (cancelled) return;
        const safe = fc && Array.isArray(fc.features) ? fc : { type: 'FeatureCollection', features: [] };
        src.setData(safe);
        soilKeyRef.current = selected.id;
        report({ kind: 'info', text: `soil σ · ${safe.features.length} segment(s)` });
      })
      .catch(() => {});

    return () => { cancelled = true; ac.abort(); };
  }, [ready, selected, soilOn]);

  // Inline absolute fill as well, so the canvas is sized even if the
  // utility classes don't resolve a height for any reason.
  return <div ref={containerRef} className="absolute inset-0" style={{ position: 'absolute', inset: 0 }} />;
}
