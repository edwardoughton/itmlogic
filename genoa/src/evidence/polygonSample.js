// Deterministic uniform interior point sample of a closed polygon ring.
//
// Used by the FCC Census polygon population estimator: we drop a regular
// grid over the polygon's bounding box, keep the points inside the
// polygon, and return them in a deterministic order so two independent
// runs against the same exhibit hit the same Census blocks.
//
// All inputs / outputs are [lat, lon] pairs (Genoa's polygon convention).

const DEG_PER_KM_LAT = 1 / 110.574;

/**
 * Standard ray-casting point-in-polygon.  Ring is [[lat, lon], ...] and
 * MUST be closed (first vertex == last vertex; not strictly required by
 * the algorithm but matches every other Genoa polygon helper).
 */
export function pointInPolygon(point, ring){
  const [lat, lon] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const [lat_i, lon_i] = ring[i];
    const [lat_j, lon_j] = ring[j];
    const intersects =
      (lon_i > lon) !== (lon_j > lon) &&
      lat < (lat_j - lat_i) * (lon - lon_i) / ((lon_j - lon_i) || 1e-12) + lat_i;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function bboxOfRing(ring){
  let lat_min = +Infinity, lat_max = -Infinity;
  let lon_min = +Infinity, lon_max = -Infinity;
  for (const [lat, lon] of ring){
    if (lat < lat_min) lat_min = lat;
    if (lat > lat_max) lat_max = lat;
    if (lon < lon_min) lon_min = lon;
    if (lon > lon_max) lon_max = lon;
  }
  return { lat_min, lat_max, lon_min, lon_max };
}

export function ringCentroid(ring){
  // Naive arithmetic mean — adequate for picking ONE seed sample
  // inside roughly-convex contour rings.
  let lat_sum = 0, lon_sum = 0;
  // Skip the duplicated closing vertex if present.
  const n = ring.length > 1 && ring[0][0] === ring[ring.length-1][0]
            && ring[0][1] === ring[ring.length-1][1]
          ? ring.length - 1
          : ring.length;
  for (let i = 0; i < n; i++){
    lat_sum += ring[i][0];
    lon_sum += ring[i][1];
  }
  return [lat_sum / n, lon_sum / n];
}

/**
 * Drop a regular grid over the ring's bbox and keep the points that
 * fall inside the polygon.  Returns up to `n_target * 2` interior
 * points (over-targeted to ensure we get roughly `n_target` after the
 * point-in-polygon filter knocks out the corners).  Deterministic.
 *
 * Always prepends the polygon centroid so the sample is biased to the
 * interior.
 *
 * @param {Array<[number, number]>} ring closed [[lat, lon], ...]
 * @param {number} n_target target sample count (default 16)
 */
export function uniformInteriorSample(ring, n_target = 16){
  if (!Array.isArray(ring) || ring.length < 3) return [];
  const bbox = bboxOfRing(ring);
  if (!Number.isFinite(bbox.lat_min) || bbox.lat_max <= bbox.lat_min){
    return [];
  }

  // For roughly-circular contours, ~78% of the bbox is inside the
  // polygon (π/4 of the circumscribed square).  Over-target the grid
  // slightly so the post-filter point count lands near n_target.
  const per_side = Math.max(3, Math.ceil(Math.sqrt(n_target / 0.6)));
  const dlat = (bbox.lat_max - bbox.lat_min) / per_side;
  const dlon = (bbox.lon_max - bbox.lon_min) / per_side;

  const out = [];
  // Centroid first.
  const c = ringCentroid(ring);
  if (pointInPolygon(c, ring)) out.push(c);

  for (let i = 0; i < per_side; i++){
    for (let j = 0; j < per_side; j++){
      const lat = bbox.lat_min + (i + 0.5) * dlat;
      const lon = bbox.lon_min + (j + 0.5) * dlon;
      if (pointInPolygon([lat, lon], ring)){
        out.push([lat, lon]);
      }
    }
  }

  return out;
}

/**
 * Approximate area (km²) of a lat/lon bounding box.  Uses the local
 * cos(midlat) correction.  Adequate for Census-block bboxes (typically
 * a few hundred meters to a few km on a side).
 */
export function bboxAreaKm2({ lat_min, lat_max, lon_min, lon_max }){
  const midlat = (lat_min + lat_max) / 2 * Math.PI / 180;
  const dlat_km = (lat_max - lat_min) / DEG_PER_KM_LAT;
  const dlon_km = (lon_max - lon_min) * 111.320 * Math.cos(midlat);
  return Math.abs(dlat_km * dlon_km);
}
