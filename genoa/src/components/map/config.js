// Live-map geospatial config.
//
// Tiles come from Martin (vector tile server) via the same-origin /tiles
// proxy. The base is env-driven so ONE build works everywhere:
//   • production  → leave unset; defaults to same-origin '/tiles'
//                   (App Platform proxy → droplet Martin :3000, TLS).
//   • local dev   → the Vite dev server proxies /tiles to Martin.
//
// LAYERS is the single source of truth for what renders.  Add a layer by
// adding an entry here — never by hand-coding addLayer calls.  Each entry
// maps a Martin source (its source-layer name) to its MapLibre paint.

// MapLibre needs ABSOLUTE tile URLs — its tile worker calls new Request()
// with no base, so a leading-slash path ('/tiles/…') throws "Failed to
// parse URL".  Resolve a same-origin base against window.location.origin
// (→ https://host/tiles in prod, http://localhost:5173/tiles in dev).
const RAW_TILES_BASE = String(import.meta.env.VITE_TILES_BASE || '/tiles').replace(/\/+$/, '');
export const TILES_BASE = (RAW_TILES_BASE.startsWith('/') && typeof window !== 'undefined')
  ? window.location.origin + RAW_TILES_BASE
  : RAW_TILES_BASE;

// Martin serves each source at {base}/{source}/{z}/{x}/{y} (no extension).
export function tileUrl(sourceLayer){
  return `${TILES_BASE}/${sourceLayer}/{z}/{x}/{y}`;
}

export const LAYERS = [
  {
    id:          'stations',        // base for the MapLibre layer id (purpose-suffixed in MapView)
    sourceLayer: 'stations',        // Martin source id == MVT source-layer name (geo.stations → "stations")
    type:        'circle',
    label:       'Stations',
    minzoom:     0,
    paint: {
      // Cobalt stations on the navy base; gentle zoom-scaling around r=6.
      'circle-radius':       ['interpolate', ['linear'], ['zoom'], 4, 4, 9, 6, 14, 9],
      'circle-color':        '#4fd1ff',     // cobalt
      'circle-stroke-color': '#001f33',
      'circle-stroke-width': 2,
      'circle-opacity':      0.9
    }
  }
  // Future (add when the schemas land — config only, no component changes):
  //  { id: 'contours', sourceLayer: 'contours', type: 'line', paint: {...} }
  //  { id: 'coverage', sourceLayer: 'coverage', type: 'fill', paint: {...} }
];

// Initial view — centered on the current data (KAZM / Sedona).  Zoomed in
// enough that a single station reads as placed-on-a-map, not a dot in a
// void.
export const INITIAL_VIEW = { center: [-111.820544, 34.860547], zoom: 9 };

// Map style — a same-origin style.json served by the app
// (src/ui/public-static/styles/genoa.json → /styles/genoa.json), so it
// loads even when an ad-blocker kills external CDNs, and can be edited
// visually in maputnik (point maputnik at {origin}/styles/genoa.json)
// without a code change.  The style owns the BASEMAP; the data LAYERS
// above are added on top by MapView so they stay data-driven.  Override
// with VITE_MAP_STYLE.  Resolved to absolute for consistency with tiles.
const RAW_MAP_STYLE = String(import.meta.env.VITE_MAP_STYLE || '/styles/genoa.json');
export const MAP_STYLE_URL = (RAW_MAP_STYLE.startsWith('/') && typeof window !== 'undefined')
  ? window.location.origin + RAW_MAP_STYLE
  : RAW_MAP_STYLE;

// §73.333 contour polygons (GeoJSON), merged from the latest saved
// exhibit per station — served by the app, no Martin/PostGIS needed.
const RAW_CONTOURS = String(import.meta.env.VITE_CONTOURS_URL || '/api/map/contours.geojson');
export const CONTOURS_URL = (RAW_CONTOURS.startsWith('/') && typeof window !== 'undefined')
  ? window.location.origin + RAW_CONTOURS
  : RAW_CONTOURS;

// FCC ASR antenna structures (towers) near a point, as GeoJSON points —
// proxied by the app to the ASR sidecar's /asr/by-location (no raw IPs in
// the frontend).  Query string: ?lat=&lon=&radius_m=.
const RAW_TOWERS = String(import.meta.env.VITE_TOWERS_URL || '/api/map/towers.geojson');
export const TOWERS_URL = (RAW_TOWERS.startsWith('/') && typeof window !== 'undefined')
  ? window.location.origin + RAW_TOWERS
  : RAW_TOWERS;

// Co/adjacent-channel interference (GeoJSON) for one saved exhibit —
// subject + nearby primaries + conflict links, from the saved payload.
const RAW_INTERFERENCE = String(import.meta.env.VITE_INTERFERENCE_URL || '/api/map/interference.geojson');
export const INTERFERENCE_URL = (RAW_INTERFERENCE.startsWith('/') && typeof window !== 'undefined')
  ? window.location.origin + RAW_INTERFERENCE
  : RAW_INTERFERENCE;

// USFS tree-canopy density (CONUS), sampled on a grid around a point and
// returned as GeoJSON points carrying canopy_pct — proxied by the app to
// the geo-RF evidence sidecar (no raw IPs).  Query: ?lat=&lon=&radius_km=.
// Heavier than the other layers (many point samples) → loaded on demand
// when the operator enables the "Tree canopy" overlay.
const RAW_CANOPY = String(import.meta.env.VITE_CANOPY_URL || '/api/map/canopy.geojson');
export const CANOPY_URL = (RAW_CANOPY.startsWith('/') && typeof window !== 'undefined')
  ? window.location.origin + RAW_CANOPY
  : RAW_CANOPY;

// FCC §73.190 M3 ground-conductivity boundary lines (GeoJSON) within a
// bbox — proxied by the app from the m3_conductivity PostGIS table.
const RAW_CONDUCTIVITY = String(import.meta.env.VITE_CONDUCTIVITY_URL || '/api/map/conductivity.geojson');
export const CONDUCTIVITY_URL = (RAW_CONDUCTIVITY.startsWith('/') && typeof window !== 'undefined')
  ? window.location.origin + RAW_CONDUCTIVITY
  : RAW_CONDUCTIVITY;

// Terrain DEM tiles (Terrarium-encoded RGB) for the hillshade overlay,
// proxied same-origin via /terrain so MapLibre can read DEM pixels without
// a CORS taint.  {z}/{x}/{y} are filled by MapLibre, not us.
const RAW_DEM = String(import.meta.env.VITE_TERRAIN_DEM || '/terrain/{z}/{x}/{y}.png');
export const TERRAIN_DEM_URL = (RAW_DEM.startsWith('/') && typeof window !== 'undefined')
  ? window.location.origin + RAW_DEM
  : RAW_DEM;
