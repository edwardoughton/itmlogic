// Pattern factor — 2-D azimuth × elevation interpolation with 1-D legacy.
//
// SUPPORTED PATTERN SHAPES
//
//   1-D legacy (horizon slice; existing data and existing callsites)
//     [[az_deg, field_factor], …]
//     - field_factor in [0..1], peak normalized to 1.0
//     - sorted by az_deg ascending
//     - last row's az_deg is < 360; the interpolator wraps from
//       last → first across the 0/360 boundary
//     - elevation is implicitly 0° (horizon); the factor is returned
//       unchanged for any requested elevation (omnidirectional in
//       the elevation plane)
//
//   2-D explicit grid (azimuth × elevation; for downtilt-aware,
//   skywave-departure, NEC2++/PyNEC RP outputs, etc.)
//     {
//       azimuths_deg:    [a0, a1, …],          // sorted ascending, < 360
//       elevations_deg:  [e0, e1, …],          // sorted ascending; -90..+90
//                                              // (positive = above horizon)
//       factors:         [[…], […], …]         // factors[el][az]
//                                              //   shape: el_count × az_count
//                                              //   each in [0..1], peak = 1.0
//     }
//     The interpolator bilinearly interpolates between the four
//     surrounding grid cells; az wraps at 360, el is clamped to the
//     supplied range.
//
// CALLSITE CONTRACT
//   patternFactor(table, az_deg, elevation_deg = 0)
//
//   - Returns 1.0 when table is null/undefined (omnidirectional).
//   - Returns the legacy 1-D interpolation when table is an array.
//   - Returns the 2-D bilinear interpolation when table is an object
//     with azimuths_deg + elevations_deg + factors.
//
//   The default elevation_deg = 0 keeps every existing callsite
//   binary-compatible — horizontal-plane studies (§73.215, §74.1204,
//   §73.187 contour-pair) work unchanged.  Callers that need
//   elevation-aware analysis (OET-65 site-boundary downtilt,
//   skywave departure angle) pass an explicit elevation.
//
// VALIDATION
//   The interpolator is intentionally permissive — out-of-range
//   inputs (az < 0, el > 90) are wrapped/clamped rather than
//   throwing.  Higher-level validators (pattern_table schema in
//   am_directional) catch malformed tables.

export function patternFactor(table, az_deg, elevation_deg = 0){
  if (!table) return 1.0;
  // Dispatch on table shape.
  if (Array.isArray(table)) return interp1dHorizon(table, az_deg);
  if (typeof table === 'object'
      && Array.isArray(table.azimuths_deg)
      && Array.isArray(table.elevations_deg)
      && Array.isArray(table.factors)){
    return interp2dBilinear(table, az_deg, elevation_deg);
  }
  return 1.0;
}

// ---------------------------------------------------------------------------
// 1-D legacy: azimuth-only interpolation at the horizon
// ---------------------------------------------------------------------------

function interp1dHorizon(table, az_deg){
  const az = ((Number(az_deg) % 360) + 360) % 360;
  for (let i = 0; i < table.length; i++){
    const [a1, v1] = table[i];
    const [a2, v2] = table[(i + 1) % table.length];
    const a2w = (a2 < a1) ? a2 + 360 : a2;
    const azw = (az < a1) ? az + 360 : az;
    if (azw >= a1 && azw <= a2w){
      const t = (azw - a1) / Math.max(1e-6, (a2w - a1));
      return v1 + t * (v2 - v1);
    }
  }
  return 1.0;
}

// ---------------------------------------------------------------------------
// 2-D bilinear: az × el grid
// ---------------------------------------------------------------------------

function interp2dBilinear(table, az_deg, el_deg){
  const A = table.azimuths_deg;
  const E = table.elevations_deg;
  const F = table.factors;
  if (!A.length || !E.length || F.length !== E.length) return 1.0;

  // Wrap azimuth to [0, 360); clamp elevation to grid range.
  const az = ((Number(az_deg) % 360) + 360) % 360;
  const el = Math.max(E[0], Math.min(E[E.length - 1], Number(el_deg)));

  // Find bracketing az indices.  Treat the grid as wrapping from
  // last → first across 0/360.
  const a_lo_idx = lastLEIndex(A, az, /*wrap=*/true);
  const a_hi_idx = (a_lo_idx + 1) % A.length;
  const a1 = A[a_lo_idx];
  let   a2 = A[a_hi_idx];
  let   azw = az;
  if (a2 < a1){ a2 += 360; if (azw < a1) azw += 360; }
  const ta = (a2 === a1) ? 0 : (azw - a1) / (a2 - a1);

  // Bracketing el indices (no wrap).
  const e_lo_idx = lastLEIndex(E, el, /*wrap=*/false);
  const e_hi_idx = Math.min(e_lo_idx + 1, E.length - 1);
  const e1 = E[e_lo_idx];
  const e2 = E[e_hi_idx];
  const te = (e2 === e1) ? 0 : (el - e1) / (e2 - e1);

  // Pull the four corner factors.
  const f_e1_a1 = pickFactor(F, e_lo_idx, a_lo_idx);
  const f_e1_a2 = pickFactor(F, e_lo_idx, a_hi_idx);
  const f_e2_a1 = pickFactor(F, e_hi_idx, a_lo_idx);
  const f_e2_a2 = pickFactor(F, e_hi_idx, a_hi_idx);

  // Bilinear blend.
  const f_e1 = f_e1_a1 + ta * (f_e1_a2 - f_e1_a1);
  const f_e2 = f_e2_a1 + ta * (f_e2_a2 - f_e2_a1);
  return f_e1 + te * (f_e2 - f_e1);
}

function lastLEIndex(arr, x, wrap){
  // Return the last index i such that arr[i] <= x.
  // When wrap=true and x is between the last and first (wrapping past
  // 360), return arr.length - 1.
  for (let i = arr.length - 1; i >= 0; i--){
    if (arr[i] <= x) return i;
  }
  return wrap ? arr.length - 1 : 0;
}

function pickFactor(F, ei, ai){
  const row = F[ei];
  if (!Array.isArray(row) || !row.length) return 1.0;
  const v = Number(row[ai % row.length]);
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1.0;
}

// ---------------------------------------------------------------------------
// Helpers for callers building / converting pattern tables
// ---------------------------------------------------------------------------

/**
 * Convert a 1-D horizon table into a 2-D grid that's omnidirectional
 * in elevation (factor independent of el).  Useful when a single
 * code path expects 2-D input and the data is legacy 1-D.
 */
export function expand1dTo2d(table_1d, { elevations_deg = [-90, 0, 90] } = {}){
  if (!Array.isArray(table_1d) || !table_1d.length) return null;
  const azimuths_deg = table_1d.map(([a]) => Number(a));
  const horizonRow   = table_1d.map(([_, v]) => Number(v));
  const factors      = elevations_deg.map(() => horizonRow.slice());
  return { azimuths_deg, elevations_deg, factors };
}

/**
 * Detect whether a pattern_table is 2-D shape.
 */
export function isPattern2D(table){
  return !!(table
    && typeof table === 'object'
    && !Array.isArray(table)
    && Array.isArray(table.azimuths_deg)
    && Array.isArray(table.elevations_deg)
    && Array.isArray(table.factors));
}
