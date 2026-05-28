// AM nighttime NIF contour → GeoJSON exporter (RFC 7946).
//
// Converts the §73.182 nighttime NIF study attached to an exhibit
// (evidence.am_night_nif from src/engine/am/nightOrchestrator.js)
// into a single FeatureCollection ready to drop into Mapbox / Leaflet
// / qgis without extra processing.
//
// The collection contains:
//   - 1 Polygon Feature        — the proposed station's NIF boundary
//   - 1 Point Feature          — the proposed station itself (with its DA mode)
//   - N Point Features         — every interferer used in the §73.182(k)
//                                 RSS pool (call, class, freq, distance,
//                                 relation)
//   - 0..M LineString Features — failing-azimuth radials (proposed → boundary)
//                                 so an engineer can SEE which sector loses
//                                 protection at-a-glance, not just read it
//                                 in the appendix
//
// Properties on every feature carry enough metadata that the GeoJSON is
// self-describing — a downstream tool doesn't need the exhibit to render
// it sensibly.
//
// FAIL-SOFT
//   - When the exhibit has no am_night_nif evidence (FM exhibit, FCCAM
//     unconfigured, etc.) the exporter returns ok:false with the reason
//     so the route can return a clean 404 rather than a generic 500.

import { Buffer } from 'node:buffer';

export const GEOJSON_CONTENT_TYPE = 'application/geo+json';

/**
 * Build the FeatureCollection.  Pure — no I/O.
 *
 * @param {object} exhibit               full exhibit-v2 object
 * @returns {{ ok:true, features:object } | { ok:false, error:string }}
 */
export function buildAmNightNifGeoJson(exhibit){
  if (!exhibit || typeof exhibit !== 'object'){
    return { ok: false, error: 'exhibit required' };
  }
  const nif = exhibit.evidence?.am_night_nif;
  if (!nif){
    return { ok: false, error: 'exhibit has no evidence.am_night_nif (compute an AM exhibit with FCCAM configured)' };
  }
  if (nif.available !== true){
    return { ok: false, error: nif.error || 'am_night_nif study did not complete' };
  }
  const proposed = nif.proposed || exhibit.station_inputs || {};
  if (!Number.isFinite(Number(proposed.lat)) || !Number.isFinite(Number(proposed.lon))){
    return { ok: false, error: 'proposed station lacks lat/lon' };
  }

  const features = [];

  // 1. NIF polygon — closed ring [[lon,lat], ...].
  const ring = (nif.polygon || [])
    .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon)))
    .map((p) => [Number(p.lon), Number(p.lat)]);
  if (ring.length >= 4){
    // Ensure the ring is closed per RFC 7946.
    const first = ring[0];
    const last  = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]){
      ring.push([first[0], first[1]]);
    }
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [ring] },
      properties: {
        kind:                  'nif_contour',
        regulation:            nif.regulation || '47 CFR §73.182',
        source:                nif.source     || 'fccam',
        n_azimuths:            nif.summary?.n_azimuths           ?? null,
        n_failing_azimuths:    nif.summary?.n_failing_azimuths   ?? null,
        n_no_service_azimuths: nif.summary?.n_no_service_azimuths ?? null,
        mean_radius_km:        nif.summary?.mean_radius_km       ?? null,
        min_radius_km:         nif.summary?.min_radius_km        ?? null,
        max_radius_km:         nif.summary?.max_radius_km        ?? null,
        worst_margin_db:       nif.summary?.worst_margin_db      ?? null,
        n_interferers_used:    nif.summary?.n_interferers_used   ?? null,
        proposed_call:         proposed.call         || null,
        proposed_facility_id:  proposed.facility_id  || null,
        proposed_freq_khz:     proposed.freq_khz     ?? null,
        proposed_erp_kw:       proposed.erp_kw       ?? null,
        proposed_class:        proposed.fcc_class    || null,
        fetched_at:            nif.fetched_at        || null
      }
    });
  }

  // 2. Proposed station marker.
  features.push({
    type: 'Feature',
    geometry: { type: 'Point',
                coordinates: [Number(proposed.lon), Number(proposed.lat)] },
    properties: {
      kind:           'proposed_station',
      call:           proposed.call         || null,
      facility_id:    proposed.facility_id  || null,
      fcc_class:      proposed.fcc_class    || null,
      freq_khz:       proposed.freq_khz     ?? null,
      erp_kw:         proposed.erp_kw       ?? null,
      pattern_mode:   proposed.pattern_table ? 'DA' : 'omni'
    }
  });

  // 3. Interferer markers.
  for (const i of (nif.interferers || [])){
    if (!Number.isFinite(Number(i.lat)) || !Number.isFinite(Number(i.lon))) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point',
                  coordinates: [Number(i.lon), Number(i.lat)] },
      properties: {
        kind:         'interferer',
        call:         i.call        || null,
        facility_id:  i.station_id  || null,
        fcc_class:    i.fcc_class   || null,
        freq_khz:     i.freq_khz    ?? null,
        erp_kw:       i.erp_kw      ?? null,
        relation:     i.relation    || null,
        distance_km:  Number.isFinite(i.distance_km) ? Number(i.distance_km) : null
      }
    });
  }

  // 4. Failing-azimuth radials — line from proposed to NIF point on
  //    that azimuth.  Helps the engineer SEE which sector breaks.
  for (const p of (nif.contour || [])){
    const failing = p?.binding && p.binding.pass === false;
    const noService = p?.saturated === 'no_service';
    if (!failing && !noService) continue;
    if (!Number.isFinite(Number(p.lat)) || !Number.isFinite(Number(p.lon))) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString',
                  coordinates: [
                    [Number(proposed.lon), Number(proposed.lat)],
                    [Number(p.lon), Number(p.lat)]
                  ] },
      properties: {
        kind:        'failing_radial',
        azimuth_deg: p.azimuth_deg,
        distance_km: p.distance_km,
        binding_relation: p.binding?.relation || null,
        margin_db:        p.binding?.margin_db ?? null,
        saturated:        p.saturated || null
      }
    });
  }

  return {
    ok: true,
    features: {
      type:     'FeatureCollection',
      bbox:     bboxOf(features),
      features,
      properties: {
        regulation: '47 CFR §73.182 (AM nighttime allocation) + §73.190(c) (Wang skywave)',
        source:     nif.source     || 'fccam',
        generated_at: nif.fetched_at || new Date().toISOString(),
        license_basis: '17 USC §105 (FCC engine output, US Government public domain)'
      }
    }
  };
}

/**
 * RFC 7946 §5: bbox = [west, south, east, north] (lon-min, lat-min, lon-max, lat-max).
 * Computed from every coordinate touched by every feature.
 */
function bboxOf(features){
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  function visit(coords){
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number'){
      const [lon, lat] = coords;
      if (Number.isFinite(lon)){ if (lon < west) west = lon; if (lon > east) east = lon; }
      if (Number.isFinite(lat)){ if (lat < south) south = lat; if (lat > north) north = lat; }
      return;
    }
    for (const c of coords) visit(c);
  }
  for (const f of features) visit(f?.geometry?.coordinates);
  if (![west, east, south, north].every(Number.isFinite)) return undefined;
  return [west, south, east, north];
}

/**
 * Serialize to a Buffer with `application/geo+json` content type.
 * Convenience for the route handler.
 */
export function serializeAmNightNifGeoJson(exhibit, { pretty = false } = {}){
  const r = buildAmNightNifGeoJson(exhibit);
  if (!r.ok) return r;
  const json = pretty ? JSON.stringify(r.features, null, 2) : JSON.stringify(r.features);
  return {
    ok: true,
    body: Buffer.from(json, 'utf8'),
    content_type: GEOJSON_CONTENT_TYPE
  };
}

export const AM_NIGHT_NIF_GEOJSON_PROVENANCE = Object.freeze({
  module:        'src/exports/geojson/amNightNif.js',
  regulation:    '47 CFR §73.182 (AM nighttime allocation) + §73.190(c) (Wang skywave)',
  modeled: [
    'NIF boundary as a closed Polygon (RFC 7946-compliant)',
    'Proposed station Point feature',
    'Interferer Point features with relation / class / freq / distance',
    'Failing-azimuth LineString features (proposed → boundary point)',
    'FeatureCollection-level bbox + provenance properties'
  ],
  not_modeled: [
    'Polygon-overlap with each interferer\'s protected contour (separate exhibit appendix)',
    'Daytime groundwave contour (use exhibit.geojson for that — already FM-exporter shape)'
  ],
  license_basis: '17 USC §105 (FCC engine output, US Government public domain)'
});
