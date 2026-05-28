// FCC contours.js orchestration parity layer.
//
// PURPOSE
//   The vendored FCC propagation engine (tvfm_curves.js, PR #31) gives
//   us bit-exact F(50,50) / F(50,10) lookups.  But the upstream HTTP
//   orchestrator (controllers/contours.js) wraps each per-radial call
//   in three small conventions that affect the output of
//   geo.fcc.gov/api/contours/contours.json:
//
//     1. HAAT clamp.  FCC clamps HAAT to [30, 1600] m before the
//        curve lookup.  The FCC tabulation only covers that range;
//        higher / lower HAAT inputs are flattened to the boundary.
//        tvfmfs_metric internally also clamps and returns the clamped
//        result, but it does not echo the clamped value back to the
//        caller — Genoa records the clamp here so the radial table
//        carries `haat_used_m` for traceability.
//
//     2. Distance floor.  When tvfmfs_metric returns a negative
//        distance (rare; only at extreme low-ERP edge cases), FCC
//        replaces the value with 1 km (`if (dist < 0) dist = 1;`).
//        Genoa's adapter previously THREW on non-positive distance;
//        we now match FCC behavior so radial-table integrity is
//        preserved across the full input space.
//
//     3. Spherical Earth projection.  FCC projects each radial's
//        polygon vertex with a great-circle destination on a sphere
//        of radius R = 6371 km.  Genoa defaults to WGS-84 Karney
//        (2013) geodesic (sub-nanometre round-trip residual vs the
//        FCC sphere's ≤ 30 m error) — this module exposes the FCC
//        formula for callers that need byte-equivalent vertex
//        coordinates.
//
// PROVENANCE
//   Source: github.com/fcc/contours-api-node, controllers/contours.js,
//   commit b55870d3f20618e886cd02379008ef980229d44b.  See
//   ./PROVENANCE.md.  17 USC §105 — public domain.

export const FCC_HAAT_MIN_M    = 30;
export const FCC_HAAT_MAX_M    = 1600;
export const FCC_DIST_FLOOR_KM = 1;
export const FCC_SPHERE_R_KM   = 6371;

/**
 * Clamp a HAAT value to the FCC F(50,50)/F(50,10) tabulated range.
 *
 * @param {number} haat_m
 * @returns {{ haat_used_m: number, clamped: 'low' | 'high' | null }}
 */
export function clampHaatToFcc(haat_m){
  const h = Number(haat_m);
  if (!Number.isFinite(h)) return { haat_used_m: FCC_HAAT_MIN_M, clamped: 'low' };
  if (h < FCC_HAAT_MIN_M)  return { haat_used_m: FCC_HAAT_MIN_M, clamped: 'low' };
  if (h > FCC_HAAT_MAX_M)  return { haat_used_m: FCC_HAAT_MAX_M, clamped: 'high' };
  return { haat_used_m: h, clamped: null };
}

/**
 * FCC contours.js per-radial distance floor.  Negative or NaN distances
 * become 1 km.  Positive values pass through unchanged.
 *
 * @param {number} dist_km
 */
export function applyFccDistanceFloor(dist_km){
  const d = Number(dist_km);
  if (!Number.isFinite(d) || d < 0) return FCC_DIST_FLOOR_KM;
  return d;
}

/**
 * Spherical-Earth great-circle destination, R = 6371 km.  Byte-
 * equivalent to FCC contours.js `getLatLonFromDist`.  Returns
 * [lat_deg, lon_deg].
 */
export function fccSphericalDestPoint(lat_deg, lon_deg, az_deg, dist_km){
  const lat1 = lat_deg * Math.PI / 180;
  const lon1 = lon_deg * Math.PI / 180;
  const az   = az_deg  * Math.PI / 180;
  const R    = FCC_SPHERE_R_KM;
  const d    = Number(dist_km);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d / R) +
    Math.cos(lat1) * Math.sin(d / R) * Math.cos(az)
  );
  const lon2 = lon1 + Math.atan2(
    Math.sin(az) * Math.sin(d / R) * Math.cos(lat1),
    Math.cos(d / R) - Math.sin(lat1) * Math.sin(lat2)
  );

  return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
}

export const FCC_ORCHESTRATION_PROVENANCE = Object.freeze({
  repo:    'github.com/fcc/contours-api-node',
  commit:  'b55870d3f20618e886cd02379008ef980229d44b',
  file:    'controllers/contours.js',
  vendor_path: 'src/engine/curves/fcc/orchestration.mjs',
  vendored_at: '2026-05-04',
  notes:   'orchestration conventions ported, not the HTTP handler itself',
  license_basis: '17 U.S.C. § 105 — US Government work product, public domain in the United States'
});
