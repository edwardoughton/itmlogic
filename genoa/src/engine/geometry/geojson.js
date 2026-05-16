// Convert internal [lat, lon] rings to RFC 7946 GeoJSON.
// GeoJSON coordinate order is [lon, lat]; rings must be closed.

import { closeRing } from './polygon.js';

export function ringToGeoJsonCoords(latlngs){
  return closeRing(latlngs).map(([lat, lon]) => [lon, lat]);
}

export function featureCollection(features){
  return { type: 'FeatureCollection', features };
}

export function contourFeature(latlngs, properties){
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ringToGeoJsonCoords(latlngs)] },
    properties
  };
}
