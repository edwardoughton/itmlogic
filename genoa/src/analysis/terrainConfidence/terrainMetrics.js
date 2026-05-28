// Terrain metrics — per-radial elevation-profile statistics.
//
// PURE ANALYSIS LAYER.  Does not feed back into the FCC contour math.
// Reads the elevation profile (if attached to a radial) and reduces it
// to four scalars used downstream by curveDeviation/radialConfidence.
//
// Profile shape accepted (any of the following on the radial object):
//   - radial.terrain_profile = [{ distance_km, elevation_m }, ...]
//   - radial.elevations_m    = [m, m, ...]                    (regular spacing)
//   - radial.profile_m       = [m, m, ...]                    (alias)
//
// If no profile is attached we still return a metrics object with
// available:false so callers can reason about coverage.

const SLOPE_CHANGE_THRESHOLD_PCT = 1.0;   // 1 % slope change ⇒ a "change"
const OBSTRUCTION_RELIEF_M       = 50;    // protrusion above LOS line (m)
const ROUGHNESS_NORM_M           = 200;   // 1-σ elevation = score of 1.0

export function computeTerrainMetrics(radial){
  if (!radial || typeof radial !== 'object'){
    return blank('no radial');
  }
  const profile = readProfile(radial);
  if (!profile || profile.length < 3){
    return blank(profile ? 'profile too short' : 'no profile attached');
  }

  const elevs = profile.map(p => p.elevation_m);
  const mean  = avg(elevs);
  const variance = avg(elevs.map(e => (e - mean) * (e - mean)));
  const stddev   = Math.sqrt(variance);

  // Slope = (Δelev / Δdist) per segment.  Count sign changes ≥ threshold.
  let slope_changes = 0;
  let prevSlope = null;
  for (let i = 1; i < profile.length; i++){
    const dKm = Math.max(1e-6, profile[i].distance_km - profile[i - 1].distance_km);
    const slope = (profile[i].elevation_m - profile[i - 1].elevation_m) / (dKm * 1000); // m/m
    if (prevSlope != null){
      const relChange = Math.abs(slope - prevSlope) * 100;
      if (relChange >= SLOPE_CHANGE_THRESHOLD_PCT
          && Math.sign(slope) !== Math.sign(prevSlope)) slope_changes++;
    }
    prevSlope = slope;
  }

  // Obstruction index: fraction of profile points whose elevation rises
  // ≥ OBSTRUCTION_RELIEF_M above the line connecting the radial endpoints.
  const first = profile[0];
  const last  = profile[profile.length - 1];
  const span  = Math.max(1e-6, last.distance_km - first.distance_km);
  let obstr = 0;
  for (const p of profile){
    const t = (p.distance_km - first.distance_km) / span;
    const losE = first.elevation_m + t * (last.elevation_m - first.elevation_m);
    if ((p.elevation_m - losE) >= OBSTRUCTION_RELIEF_M) obstr++;
  }
  const obstruction_index = obstr / profile.length;

  // Roughness score: σ scaled to [0, 1+] where 1 ≈ ROUGHNESS_NORM_M.
  // Combined with obstruction_index and slope-change density.
  const path_km          = Math.max(1e-3, last.distance_km - first.distance_km);
  const slope_freq_per_km = slope_changes / path_km;
  const roughness_score   = clamp01(stddev / ROUGHNESS_NORM_M)
                          + 0.5 * obstruction_index
                          + 0.05 * slope_freq_per_km;

  return {
    available:                  true,
    samples:                    profile.length,
    path_length_km:             round2(path_km),
    mean_elevation_m:           round2(mean),
    elevation_variance_m2:      round2(variance),
    elevation_stddev_m:         round2(stddev),
    slope_change_count:         slope_changes,
    slope_change_freq_per_km:   round2(slope_freq_per_km),
    obstruction_index:          round3(obstruction_index),
    roughness_score:            round3(roughness_score)
  };
}

// ─────────── helpers ───────────

function readProfile(radial){
  if (Array.isArray(radial.terrain_profile) && radial.terrain_profile.length){
    return radial.terrain_profile
      .filter(p => Number.isFinite(p?.distance_km) && Number.isFinite(p?.elevation_m))
      .sort((a, b) => a.distance_km - b.distance_km);
  }
  const arr = Array.isArray(radial.elevations_m) ? radial.elevations_m
            : Array.isArray(radial.profile_m)    ? radial.profile_m
            : null;
  if (!arr || !arr.length) return null;
  // Synthesize evenly-spaced distances over the radial's contour-most-distant
  // value (or fall back to 1 km steps).
  const total_km = pickFiniteMax(radial.contour_distances_km) || (arr.length * 0.5);
  const step_km  = total_km / (arr.length - 1);
  return arr.map((m, i) => ({ distance_km: i * step_km, elevation_m: Number(m) }))
            .filter(p => Number.isFinite(p.elevation_m));
}

function pickFiniteMax(obj){
  if (!obj || typeof obj !== 'object') return null;
  let max = null;
  for (const v of Object.values(obj)){
    if (Number.isFinite(v) && (max == null || v > max)) max = v;
  }
  return max;
}

function blank(reason){
  return {
    available:                  false,
    reason,
    samples:                    0,
    mean_elevation_m:           null,
    elevation_variance_m2:      null,
    elevation_stddev_m:         null,
    slope_change_count:         0,
    slope_change_freq_per_km:   0,
    obstruction_index:          0,
    roughness_score:            0
  };
}

function avg(a){ return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function round2(x){ return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; }
function round3(x){ return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null; }
