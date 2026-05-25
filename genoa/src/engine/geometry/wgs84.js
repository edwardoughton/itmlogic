// WGS-84 ellipsoid constants + Karney (2013) geodesic formulae.
//
// REFERENCES
//   Karney, C.F.F. (2013).  "Algorithms for geodesics."  J. Geodesy
//     87 (1), 43-55.  https://geographiclib.sourceforge.io/geod.html
//   NIMA TR 8350.2 (2000).  WGS-84 reference ellipsoid.
//   Vincenty, T. (1975).  "Direct and Inverse Solutions of Geodesics
//     on the Ellipsoid with Application of Nested Equations."  Survey
//     Review, XXIII (176): 88-93.  (Predecessor algorithm; superseded
//     by Karney for FCC-grade work because Vincenty has ~mm residual
//     and fails to converge on near-antipodal pairs.)
//
// PRECISION
//   Karney's series solution converges to MACHINE PRECISION
//   (sub-nanometre round-trip residual) for ALL pairs of points on
//   the WGS-84 ellipsoid, including antipodal pairs that Vincenty's
//   iteration cannot reach.  Genoa uses the canonical reference
//   implementation maintained by Karney himself: the
//   geographiclib-geodesic npm package (MIT-licensed, zero runtime
//   dependencies, audited port of the geographiclib C++ library).
//
// LEGACY NAMING
//   The previous Vincenty implementation exported `vincentyDirect` and
//   `vincentyInverse`.  Those names are retained as aliases that now
//   delegate to the Karney implementation, so existing callsites keep
//   working.  New code should use `karneyDirect` / `karneyInverse`.
//
// All inputs are in degrees / km; outputs in degrees / km / degrees.

import pkg from 'geographiclib-geodesic';
const { Geodesic } = pkg;

// Single shared WGS-84 geodesic instance.  Geographiclib initialises
// the series coefficients (A1, A2, A3, C1, C2, C3) from f only, so
// reusing one instance is the recommended pattern.
const _GEOD = Geodesic.WGS84;

// WGS-84 ellipsoid parameters (NIMA TR 8350.2).
export const WGS84_A_M       = 6378137.0;                 // semi-major axis (m)
export const WGS84_F         = 1 / 298.257223563;         // flattening
export const WGS84_B_M       = WGS84_A_M * (1 - WGS84_F); // semi-minor axis
export const WGS84_A_KM      = WGS84_A_M / 1000;
export const WGS84_B_KM      = WGS84_B_M / 1000;
export const WGS84_E2        = WGS84_F * (2 - WGS84_F);   // first eccentricity²
export const WGS84_EP2       = WGS84_E2 / (1 - WGS84_E2); // second eccentricity²

const _wrapLon = lon => ((lon + 540) % 360) - 180;
const _wrapAz  = az  => ((az  + 360) % 360);

/**
 * Karney's DIRECT formula.  Given a starting point, an initial bearing,
 * and a distance, return the destination point and final bearing on
 * the WGS-84 ellipsoid.
 *
 * @param {number} lat       starting latitude  in degrees
 * @param {number} lon       starting longitude in degrees
 * @param {number} az_deg    initial bearing    in degrees from true north (clockwise)
 * @param {number} dist_km   distance to travel in kilometers
 * @returns {{ lat:number, lon:number, final_bearing_deg:number, iterations:number }}
 */
export function karneyDirect(lat, lon, az_deg, dist_km){
  const r = _GEOD.Direct(Number(lat), Number(lon), Number(az_deg), Number(dist_km) * 1000);
  return {
    lat:               r.lat2,
    lon:               _wrapLon(r.lon2),
    final_bearing_deg: _wrapAz(r.azi2),
    iterations:        1   // Karney's direct path is a closed-form series — no iteration.
  };
}

/**
 * Karney's INVERSE formula.  Given two points, return the geodesic
 * distance + initial / final bearings on the WGS-84 ellipsoid.
 *
 * @param {number} lat1, lon1, lat2, lon2 — degrees
 * @returns {{ distance_km:number, initial_bearing_deg:number, final_bearing_deg:number, iterations:number, converged:boolean }}
 */
export function karneyInverse(lat1, lon1, lat2, lon2){
  const r = _GEOD.Inverse(Number(lat1), Number(lon1), Number(lat2), Number(lon2));
  const ok = Number.isFinite(r.s12) && Number.isFinite(r.azi1) && Number.isFinite(r.azi2);
  return {
    distance_km:         r.s12 / 1000,
    initial_bearing_deg: _wrapAz(r.azi1),
    final_bearing_deg:   _wrapAz(r.azi2),
    iterations:          1,
    converged:           ok
  };
}

// Legacy aliases — preserved so existing callsites keep working.  These
// are NOT separate Vincenty implementations; they delegate to Karney.
export const vincentyDirect  = karneyDirect;
export const vincentyInverse = karneyInverse;

export const WGS84 = Object.freeze({
  A_M: WGS84_A_M, B_M: WGS84_B_M, F: WGS84_F,
  A_KM: WGS84_A_KM, B_KM: WGS84_B_KM,
  E2: WGS84_E2, EP2: WGS84_EP2
});

export const GEODESIC_PROVENANCE = Object.freeze({
  algorithm:      'Karney (2013) — Algorithms for geodesics, J. Geodesy 87:43-55',
  implementation: 'geographiclib-geodesic (Karney\'s reference JavaScript port)',
  npm_package:    'geographiclib-geodesic',
  ellipsoid:      'WGS-84 (NIMA TR 8350.2)',
  license:        'MIT',
  reference_url:  'https://geographiclib.sourceforge.io/'
});
