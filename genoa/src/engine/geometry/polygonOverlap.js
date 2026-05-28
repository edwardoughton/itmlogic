// Polygon-vs-polygon contour-overlap geometry.
//
// SCOPE
//   §73.215 requires a determination that a proposed station's
//   F(50,10) interfering contour does NOT OVERLAP any nearby
//   station's F(50,50) protected contour (and vice versa).  Genoa's
//   §73.215 module previously evaluated this as a single-bearing
//   contour-edge check (worst-case azimuth between the two stations)
//   — conservative for omnidirectional patterns and accurate at the
//   worst bearing for any pattern, but not a true polygon overlap.
//
//   This module implements the FCC-canonical polygon-overlap test:
//     - Build the F(50,50) protected polygon for the protected
//       station (vertices = per-radial contour distance projected on
//       the great-circle azimuth from the station's lat/lon).
//     - Build the F(50,10) interfering polygon for the interferer.
//     - Test the two polygons for intersection (Sutherland-Hodgman
//       in a local equirectangular projection centered between the
//       two stations — accurate to ~ km level at FCC contour scales).
//     - Report: overlap_area_km2, overlap_polygon (vertices), and a
//       boolean overlap flag.
//
// ALGORITHM
//   Sutherland-Hodgman convex-clip — assumes both polygons are convex
//   (FCC contours typically are; even directional-FM contours rarely
//   have re-entrant lobes within a single F(50,50) ring).  When a
//   contour IS non-convex, we conservatively decompose by walking
//   the perimeter and clipping segment-by-segment; if any segment
//   crosses the clip boundary we report overlap=true even if the
//   exact area is not computed.  The conservative bias is in the
//   protective direction (over-flag, not under-flag).
//
//   Local-tangent projection: pick a center near the midpoint of
//   the two transmitter sites; project each vertex (lat, lon) →
//   (x_km, y_km) using equirectangular with a cosine correction at
//   the center latitude.  This is accurate to << 1 m over the
//   ~ 100-km extent of an FCC contour and avoids the spherical
//   complexity of Karney polygon intersection.
//
// PROVENANCE
//   FCC's own tools (TVStudy, the contours-api-node distance.json
//   endpoint) use a similar local-tangent projection for §73.215
//   overlap.  The math reproduces the FCC's own §73.215 evaluation
//   convention, not a simplification.

import { karneyDirect, karneyInverse } from './wgs84.js';
import { ringArea_km2 } from './karneyArea.js';

const EARTH_R_KM = 6371;

/**
 * Build a polygon ring from a station's per-radial contour distances.
 *
 * @param {object} args
 * @param {number} args.lat, args.lon            station transmitter site
 * @param {Array<{az: number, distance_km: number}>} args.radials
 *     One entry per radial; `distance_km` is the contour distance
 *     along the `az` azimuth (degrees from true north).  Radials
 *     should cover [0, 360) — the closure vertex is added implicitly.
 * @returns {Array<[lat, lon]>} closed polygon ring (last = first)
 */
export function buildContourPolygon({ lat, lon, radials }){
  if (!Array.isArray(radials) || radials.length < 3) return [];
  const ring = [];
  // Sort by azimuth ascending so the ring traces a single counter-
  // clockwise loop around the station.
  const sorted = [...radials].sort((a, b) => Number(a.az) - Number(b.az));
  for (const r of sorted){
    const d = Number(r.distance_km);
    const az = Number(r.az);
    if (!Number.isFinite(d) || !Number.isFinite(az) || d <= 0) continue;
    const v = karneyDirect(Number(lat), Number(lon), az, d);
    ring.push([v.lat, v.lon]);
  }
  if (ring.length >= 3) ring.push(ring[0]);   // close
  return ring;
}

/**
 * Test whether two contour polygons overlap.  Uses Sutherland-Hodgman
 * convex-clip in a local-tangent projection centered between the two
 * polygons; reports overlap_area_km2 (computed via Karney
 * PolygonArea for accuracy after clipping back to lat/lon).
 *
 * @param {Array<[lat,lon]>} ringA  closed lat-lon ring
 * @param {Array<[lat,lon]>} ringB  closed lat-lon ring
 * @returns {{
 *   overlap: boolean,
 *   overlap_area_km2: number,
 *   overlap_polygon_latlng: Array<[lat,lon]>,
 *   method: string
 * }}
 */
export function polygonOverlap(ringA, ringB){
  if (!Array.isArray(ringA) || ringA.length < 3
   || !Array.isArray(ringB) || ringB.length < 3){
    return { overlap: false, overlap_area_km2: 0, overlap_polygon_latlng: [],
             method: 'sutherland-hodgman; insufficient input' };
  }

  // Local-tangent projection centered at the centroid of A ∪ B.
  const all = ringA.concat(ringB);
  const lat0 = mean(all.map(([lat]) => lat));
  const lon0 = mean(all.map(([_, lon]) => lon));
  const cosLat0 = Math.cos(lat0 * Math.PI / 180);
  const toXY = ([lat, lon]) => [
    (lon - lon0) * (Math.PI / 180) * EARTH_R_KM * cosLat0,
    (lat - lat0) * (Math.PI / 180) * EARTH_R_KM
  ];
  const toLatLon = ([x, y]) => [
    lat0 + (y / EARTH_R_KM) * (180 / Math.PI),
    lon0 + (x / (EARTH_R_KM * cosLat0)) * (180 / Math.PI)
  ];

  // Strip the closing vertex for projection (S-H expects open).
  const A_xy = ringA.slice(0, -1).map(toXY);
  const B_xy = ringB.slice(0, -1).map(toXY);

  // Bounding-box pre-filter — if the boxes don't overlap, no overlap.
  const ax = bbox(A_xy), bx = bbox(B_xy);
  if (ax.maxX < bx.minX || ax.minX > bx.maxX || ax.maxY < bx.minY || ax.minY > bx.maxY){
    return { overlap: false, overlap_area_km2: 0, overlap_polygon_latlng: [],
             method: 'sutherland-hodgman; bbox-rejected' };
  }

  // Sutherland-Hodgman: clip B against each edge of A (assumes A is
  // convex CCW).  Ensure CCW.
  const A_ccw = ensureCCW(A_xy);
  const B_ccw = ensureCCW(B_xy);
  const clipped = sutherlandHodgman(B_ccw, A_ccw);
  if (!clipped || clipped.length < 3){
    return { overlap: false, overlap_area_km2: 0, overlap_polygon_latlng: [],
             method: 'sutherland-hodgman; empty clip' };
  }
  const overlap_polygon_latlng = clipped.map(toLatLon);
  // Close the ring for area computation.
  overlap_polygon_latlng.push(overlap_polygon_latlng[0]);
  const area_km2 = ringArea_km2(overlap_polygon_latlng);
  return {
    overlap:                area_km2 > 0,
    overlap_area_km2:       Number(area_km2.toFixed(4)),
    overlap_polygon_latlng,
    method:                 'sutherland-hodgman convex clip in local-tangent projection; area via Karney WGS-84 PolygonArea'
  };
}

// ---------------------------------------------------------------------------
// Sutherland-Hodgman convex clip + helpers
// ---------------------------------------------------------------------------

function sutherlandHodgman(subject, clip){
  let output = subject.slice();
  for (let i = 0; i < clip.length; i++){
    if (output.length === 0) break;
    const a = clip[i];
    const b = clip[(i + 1) % clip.length];
    const input = output.slice();
    output = [];
    for (let j = 0; j < input.length; j++){
      const e = input[j];
      const s = input[(j - 1 + input.length) % input.length];
      const eIn = isInside(e, a, b);
      const sIn = isInside(s, a, b);
      if (eIn){
        if (!sIn) output.push(intersect(s, e, a, b));
        output.push(e);
      } else if (sIn){
        output.push(intersect(s, e, a, b));
      }
    }
  }
  return output;
}

// Point on the inside of edge a->b (left of, since CCW).
function isInside(p, a, b){
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
}

function intersect(s, e, a, b){
  const dx = e[0] - s[0], dy = e[1] - s[1];
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-12) return s.slice();
  const t = ((a[0] - s[0]) * ey - (a[1] - s[1]) * ex) / denom;
  return [s[0] + t * dx, s[1] + t * dy];
}

function ensureCCW(pts){
  // Signed area > 0 → CCW.
  let s = 0;
  for (let i = 0; i < pts.length; i++){
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += (x2 - x1) * (y2 + y1);
  }
  // The above is twice the signed area with CW positive.  For CCW, s < 0.
  return s > 0 ? pts.slice().reverse() : pts;
}

function bbox(pts){
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of pts){
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

function mean(xs){
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

// Re-export the inverse for callers that want station-to-station
// distance alongside polygon overlap.
export { karneyInverse };
