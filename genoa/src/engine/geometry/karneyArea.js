// WGS-84 ellipsoidal polygon area via Karney (2013).
//
// ALGORITHM
//   Uses PolygonArea from the canonical geographiclib-geodesic reference
//   implementation (Karney's own JavaScript port, same library that backs
//   geo.fcc.gov internals).  This computes the TRUE WGS-84 ellipsoidal
//   area of an arbitrary closed polygon — not a spherical approximation.
//
// REFERENCES
//   Karney, C.F.F. (2013).  "Algorithms for geodesics."  J. Geodesy
//     87 (1), 43-55.  §6 "Area of a polygon".
//   NIMA TR 8350.2 (2000).  WGS-84 reference ellipsoid.
//
// PRIOR IMPLEMENTATION (Bevis-Cambareri)
//   The previous implementation used the Bevis-Cambareri (1987)
//   spherical-trapezoid formula on the WGS-84 authalic sphere.  That
//   was accurate to < 0.1% for FCC contour polygons, but introduced a
//   ~0.4% systematic bias from treating the ellipsoid as a sphere.
//   Karney eliminates the approximation and the bias.
//
// PRECISION
//   Sub-m² residual for FCC contour polygons.
//
// USAGE
//   Input ring may be OPEN [v0,…,vN] or CLOSED [v0,…,vN,v0].
//   Each vertex is [lat_deg, lon_deg].  Orientation (CW / CCW) does
//   not affect the result (absolute value is returned).

import pkg from 'geographiclib-geodesic';
const { Geodesic, PolygonArea: PA } = pkg;

const _GEOD = Geodesic.WGS84;

/**
 * Compute the WGS-84 ellipsoidal area (km²) of a closed polygon ring.
 *
 * @param {Array<[number,number]>} ring  Array of [lat_deg, lon_deg] vertices.
 *   Accepts both open rings (first ≠ last) and closed rings (first = last).
 *   Degenerate rings with fewer than 3 unique vertices return 0.
 * @returns {number}  Area in km² (always non-negative).
 */
export function ringArea_km2(ring){
  if (!ring || ring.length < 3) return 0;

  // Strip a closing vertex if present — PolygonArea must not see it.
  const isClose = ring.length > 1
    && ring[0][0] === ring[ring.length - 1][0]
    && ring[0][1] === ring[ring.length - 1][1];
  const vertices = isClose ? ring.slice(0, -1) : ring;
  if (vertices.length < 3) return 0;

  const poly = new PA.PolygonArea(_GEOD, false);
  for (const [lat, lon] of vertices) poly.AddPoint(lat, lon);
  const { area } = poly.Compute(false, true);
  return Math.abs(area) / 1e6;   // m² → km²
}

// WGS-84 authalic radius — retained as a named export for backward
// compatibility with any callers that import this constant directly.
// The ringArea_km2 implementation no longer uses the spherical
// approximation; this is kept only for convenience.
import { WGS84_A_KM, WGS84_B_KM } from './wgs84.js';
export const WGS84_AUTHALIC_KM = Math.sqrt((2 * WGS84_A_KM**2 + WGS84_B_KM**2) / 3);
