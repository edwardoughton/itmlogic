// Polygon utilities for closed contour rings.
// All polygons must be CLOSED (first vertex == last vertex) before any
// downstream consumer (Leaflet, GeoJSON, area math) sees them.

export function closeRing(latlngs){
  if (!latlngs.length) return latlngs;
  const [a0, b0] = latlngs[0];
  const [aN, bN] = latlngs[latlngs.length - 1];
  if (a0 === aN && b0 === bN) return latlngs;
  return [...latlngs, [a0, b0]];
}

export function isClosed(latlngs){
  if (latlngs.length < 4) return false;
  const [a0, b0] = latlngs[0];
  const [aN, bN] = latlngs[latlngs.length - 1];
  return a0 === aN && b0 === bN;
}

// Polygon area on the WGS-84 authalic sphere (Karney spherical-excess).
// Replaces the equirectangular shoelace approximation that ran here
// previously (which was ~1% high on Class C contours due to the
// longitude-degree shrinkage at the ring extremes).  See
// ./karneyArea.js for the formula and references.
export { ringArea_km2 } from './karneyArea.js';
