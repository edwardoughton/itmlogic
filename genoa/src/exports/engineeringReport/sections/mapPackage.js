// Map Package section — the embedded printable contour map.
//
// Reads a pre-fetched PNG from `options.contour_map_png` (Buffer or
// base64 string).  The HTTP entry points (api/routes/exhibits.js for
// stateless PDF, api/services/jobRunner.js for async-job PDF) fetch
// the render from the map sidecar BEFORE calling buildEngineeringReport
// and pass it through `options`.  When no render is available
// (sidecar not configured, sidecar unreachable, or render timed out)
// this section emits a deferred-to-engineer placeholder rather than
// silently dropping — so the operator knows the map page is missing
// and why.

import { coerceMapBuffer } from '../../../sidecars/mapClient.js';

export function buildMapPackageSection(exhibit, options = {}){
  const buf = coerceMapBuffer(options.contour_map_png);
  if (!buf){
    return {
      id:      'map-package',
      type:    'paragraphs',
      heading: 'Contour Map',
      paragraphs: [
        'No contour map render is attached to this exhibit (the Genoa map sidecar was not configured at PDF render time, or the render timed out).  The §73.333 contour distances are reported in the Contour Results exhibit; coordinate provenance and radial table appear in the Radials appendix; this section would normally include the printable contour map composed by the Genoa map sidecar.',
        'To attach the map, configure MAP_SIDECAR_URL on the deploy and re-run the PDF export.  The map sidecar renders a Leaflet-composed PNG with the §73.333 service / interfering contour polygons, transmitter site marker, NAD83 coordinates, scale bar, north arrow, and station banner — the standard H&D-style contour-map deliverable for an FCC filing.'
      ]
    };
  }
  return {
    id:      'map-package',
    type:    'image',
    heading: 'Contour Map',
    caption: 'Service / interfering contours per 47 CFR §73.333.  Transmitter site shown as filled circle; NAD83 datum; scale bar and north arrow at lower-right.  Composed by Genoa map sidecar (Chromium-rendered Leaflet, OSM/CARTO base, sidecar SHA see Build Attestation).',
    image_buffer: buf,
    image_format: 'png'
  };
}
