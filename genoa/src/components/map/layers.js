// Live-map LAYER REGISTRY — the single source of truth for every overlay.
//
// MapView reads this to set default visibility + draw order; MapPage renders
// the control panel from it (grouped, with status / cost / provenance); and
// the feature-detail panel uses each entry's classification + provenance +
// meaning to explain a clicked feature in engineering terms.
//
// One entry == one logical overlay (which may own several MapLibre layer ids,
// e.g. a contour set is fill + glow + line).  Adding a layer is a registry
// edit plus the MapLibre layer creation in MapView — never scattered ad-hoc
// checkboxes.
//
// FIELD CONTRACT
//   id              stable key; also the key in MapPage's `overlays` state
//   label           UI label
//   group           panel section ('RF Study' | 'Infrastructure' | 'Environment')
//   mapLayerIds     MapLibre layer ids this overlay shows/hides together
//   clickLayerId    which of those receives click → feature detail (optional)
//   defaultVisible  initial on/off
//   zOrder          relative draw order (higher = on top) — documentation +
//                   the order MapView adds them; not re-sorted at runtime
//   opacity         nominal opacity (metadata + export state)
//   cost            'low' | 'medium' | 'high'  — gates eager fetching
//   status          'active' | 'soon'
//   classification  'filing-controlling' | 'advisory' | 'infrastructure' | 'reference'
//   meaning         one-line engineering explanation for the detail panel
//   provenance      { dataset, source, resolution?, generated_at?, sha256?, effect }

export const LAYER_REGISTRY = [
  {
    id: 'stations', label: 'Stations', group: 'RF Study',
    mapLayerIds: ['stations-circle'], clickLayerId: 'stations-circle',
    defaultVisible: true, zOrder: 60, opacity: 0.9, cost: 'low', status: 'active',
    classification: 'reference',
    meaning: 'Licensed broadcast stations from the FCC catalog (reference geography).',
    provenance: { dataset: 'FCC FM/AM station catalog', source: '/tiles/stations (Martin vector tiles)', effect: 'reference' }
  },
  {
    id: 'contours', label: '§73.333 / §73.184 contours', group: 'RF Study',
    mapLayerIds: ['contours-fill', 'contours-glow', 'contours-line', 'contours-label'], clickLayerId: 'contours-line',
    defaultVisible: true, zOrder: 50, opacity: 0.9, cost: 'low', status: 'active',
    classification: 'filing-controlling',
    meaning: 'Protected & service field-strength contours that determine filing compliance.',
    provenance: { dataset: 'Genoa engine F(50,50) / groundwave contours', source: '/api/map/contours.geojson', effect: 'filing-controlling' }
  },
  {
    id: 'interference', label: 'Interference (§73.207/215)', group: 'RF Study',
    mapLayerIds: ['interference-links', 'interference-neighbors', 'interference-subject'],
    clickLayerId: 'interference-neighbors',
    defaultVisible: false, zOrder: 72, opacity: 0.95, cost: 'low', status: 'active',
    classification: 'filing-controlling',
    meaning: 'Nearby co/adjacent-channel stations and the §73.207/§73.215 conflicts that gate the filing.',
    provenance: { dataset: 'FCC FMQ/AMQ neighbors + Genoa interference study', source: '/api/map/interference.geojson', effect: 'filing-controlling' }
  },
  {
    id: 'towers', label: 'FCC towers (ASR)', group: 'Infrastructure',
    mapLayerIds: ['towers-pulse', 'towers-core'], clickLayerId: 'towers-core',
    defaultVisible: true, zOrder: 65, opacity: 0.85, cost: 'medium', status: 'active',
    classification: 'infrastructure',
    meaning: 'Registered antenna structures (§17.4 ASR) — candidate/host towers and obstructions.',
    provenance: { dataset: 'FCC ULS Antenna Structure Registration (r_tower)', source: '/api/map/towers.geojson', effect: 'infrastructure record' }
  },
  {
    id: 'terrain', label: 'Terrain / hillshade', group: 'Environment',
    mapLayerIds: ['terrain-hillshade'], defaultVisible: false, zOrder: 5, opacity: 0.45,
    cost: 'medium', status: 'active', classification: 'advisory',
    meaning: 'Shaded relief — explains coverage shadowing; filing-relevant when used for FM HAAT / ITM.',
    provenance: { dataset: 'Terrarium DEM (AWS Open Terrain Tiles)', resolution: '~30 m (z-dependent)', source: '/terrain/{z}/{x}/{y}.png', effect: 'advisory (filing-relevant via HAAT/ITM)' }
  },
  {
    id: 'canopy', label: 'Tree canopy', group: 'Environment',
    mapLayerIds: ['canopy-heat'], defaultVisible: false, zOrder: 10, opacity: 0.85,
    cost: 'high', status: 'active', classification: 'advisory',
    meaning: 'Tree-canopy density — environmental clutter that attenuates VHF/UHF coverage.',
    provenance: { dataset: 'USFS Tree Canopy Cover (CONUS)', resolution: '~30 m', source: '/api/map/canopy.geojson', effect: 'advisory / environmental RF context' }
  },
  {
    id: 'water', label: 'Water', group: 'Environment',
    mapLayerIds: ['water-hi', 'water-hi-edge', 'water-hi-rivers'], defaultVisible: false,
    zOrder: 16, opacity: 0.6, cost: 'low', status: 'active', classification: 'advisory',
    meaning: 'Hydrography — over-water paths enhance propagation (low-loss, possible ducting).',
    provenance: { dataset: 'Self-hosted basemap hydrography (Protomaps)', source: 'basemap vector (water)', effect: 'advisory' }
  },
  {
    id: 'brush', label: 'Brush', group: 'Environment',
    mapLayerIds: ['brush-hi'], defaultVisible: false, zOrder: 15, opacity: 0.42,
    cost: 'low', status: 'active', classification: 'advisory',
    meaning: 'Scrub / grassland landcover — wildland clutter and the fuel layer for fire risk.',
    provenance: { dataset: 'Basemap landcover scrub/grassland (Protomaps)', source: 'basemap vector (landcover)', effect: 'advisory' }
  },
  {
    id: 'soil', label: 'Soil conductivity', group: 'Environment',
    mapLayerIds: ['conductivity-lines'], clickLayerId: 'conductivity-lines',
    defaultVisible: false, zOrder: 12, opacity: 0.8, cost: 'medium', status: 'active',
    classification: 'filing-controlling',
    meaning: 'Ground conductivity σ (mS/m) boundaries — drives AM groundwave reach (§73.190 Figure M3).',
    provenance: { dataset: 'FCC §73.190 Figure M3 conductivity (boundary segments)', source: '/api/map/conductivity.geojson', effect: 'filing-controlling (AM groundwave)' }
  },
  {
    id: 'fire', label: 'Fire risk', group: 'Environment',
    mapLayerIds: [], defaultVisible: false, zOrder: 11, opacity: 0.5, cost: 'medium', status: 'soon',
    classification: 'advisory',
    meaning: 'Wildfire hazard around the site (planned) — operational risk to infrastructure.',
    provenance: { dataset: '(planned)', source: '(planned)', effect: 'advisory' }
  }
];

export const LAYER_GROUPS = ['RF Study', 'Infrastructure', 'Environment'];

// id → entry
export const LAYER_BY_ID = Object.freeze(
  Object.fromEntries(LAYER_REGISTRY.map(l => [l.id, l]))
);

// MapLibre layer id → registry entry (so a click on any sub-layer resolves
// to the overlay it belongs to).
const MAPLAYER_TO_ENTRY = Object.freeze(
  Object.fromEntries(
    LAYER_REGISTRY.flatMap(l => l.mapLayerIds.map(mid => [mid, l]))
  )
);
export function layerForMapId(mapLayerId){
  return MAPLAYER_TO_ENTRY[mapLayerId] || null;
}

// Initial `overlays` state for MapPage — explicit booleans keyed by id, only
// for active layers (soon layers are shown disabled and never toggled on).
export function initialOverlayState(){
  const out = {};
  for (const l of LAYER_REGISTRY) if (l.status === 'active') out[l.id] = !!l.defaultVisible;
  return out;
}

// Layers that should NOT be fetched/sampled until explicitly enabled.
export function isHighCost(id){ return LAYER_BY_ID[id]?.cost === 'high'; }
