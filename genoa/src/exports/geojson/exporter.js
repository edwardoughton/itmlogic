// GeoJSON exporter — RFC 7946 FeatureCollection.
// Each contour polygon becomes one Feature; `properties` carries the
// minimum set demanded by the spec: label, field_strength_dbu, method,
// mean_radial_km, call, facility_id.

export function exportGeoJson(exhibit, { pretty = false } = {}){
  if (!exhibit?.geojson?.features) throw new Error('exhibit.geojson missing or empty');
  return pretty
    ? JSON.stringify(exhibit.geojson, null, 2)
    : JSON.stringify(exhibit.geojson);
}

export const GEOJSON_CONTENT_TYPE = 'application/geo+json';
