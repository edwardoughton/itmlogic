// Per-radial ITM-aware coverage analysis.
//
// SCOPE
//   For each requested radial azimuth, sample real DEM elevations
//   along the path from the transmitter outward, run the terrain-
//   aware path-loss model (terrain_propagation.js) at each sample
//   distance, and find the distance at which the predicted field
//   strength crosses the service threshold.  Compare against the
//   FCC §73.333 F(50,50) tabulated distance to surface the
//   "terrain-vs-flat" delta on every radial.
//
// USE
//   This produces an FCC-style coverage map that REFLECTS REAL
//   TERRAIN.  Where the §73.333 table predicts a 60 dBu contour at
//   60 km on a flat-Earth assumption, an ITM-aware analysis with a
//   ridge in the way might show 40 km in that direction (knife-edge
//   diffraction loss) or 80 km in another (multipath enhancement
//   from a valley reflection).  The radial-table delta is the
//   single most useful data product an FCC-filing engineer wants.
//
// PIPELINE
//   1. For each radial az ∈ radials_deg:
//      a. Generate sample points along the radial via Karney geodesic
//         from `from_km` to `to_km`, `samples` points per radial
//      b. Fetch DEM elevations at every sample point via the multi-
//         source elevationClient (USGS 3DEP / Open-Meteo / OpenTopoData,
//         tried in order with cross-validation)
//      c. For each (distance d_i, elevation h_i) pair:
//         - Build the cumulative terrain profile [{distance_km, elevation_m}]
//           up to d_i
//         - Run terrainPathLoss() on that profile
//         - Compute the predicted field strength via predictFieldStrengthDbu
//      d. Find the smallest d_i at which the predicted field crosses
//         the service threshold (e.g. 60 dBu for FM Class A, 54 dBu for B)
//   2. Stamp the result on evidence.itm_coverage with full provenance
//
// OUTPUT SHAPE (per radial)
//   {
//     az,
//     terrain_distance_km,        — distance to threshold via terrain-aware
//     terrain_field_at_distance,  — dBu at terrain_distance_km
//     fcc_distance_km,            — distance to threshold via FCC §73.333 table
//     delta_km,                   — (terrain - fcc); negative = terrain blocks
//     terrain_path_loss_db,       — total path loss at terrain_distance_km
//     worst_edge,                 — diffraction edge details
//     n_samples_dem_sourced,      — coverage of real DEM (vs flat fallback)
//     mode: 'los' | 'diffraction' | 'beyond-horizon'
//   }

import { buildSamplePoints, fetchElevationsFallback } from '../../evidence/terrain/elevationClient.js';
import {
  terrainPathLoss,
  itmV122PathLoss,
  preloadItmV122,
  predictFieldStrengthDbu,
  TERRAIN_PROPAGATION_PROVENANCE,
  ITM_V122_PROPAGATION_PROVENANCE
} from './terrain_propagation.js';
import { fccDistanceKm } from '../curves/fcc/index.mjs';

const DEFAULT_RX_AMSL_GROUND_OFFSET_M = 9.1;     // §73.683 / OET-69 standard receiver height

/**
 * Run an ITM-aware coverage analysis along one radial.
 *
 * @param {object} args
 * @param {Array<{distance_km, elevation_m}>} args.profile  full-radial DEM profile
 * @param {number} args.tx_amsl_m
 * @param {number} args.erp_kw
 * @param {number} args.frequency_mhz
 * @param {number} args.target_field_dbu      service threshold (e.g. 60)
 * @param {number} [args.rx_height_above_ground_m=9.1]  §73.683 standard receiver
 * @param {string} [args.engine='itm-v122']   propagation engine; see below
 * @returns {{
 *   crossing_distance_km: number|null,
 *   field_at_crossing_dbu: number|null,
 *   path_loss_at_crossing_db: number|null,
 *   worst_edge: object|null,
 *   profile_searched: number,
 *   beyond_max_range: boolean
 * }}
 */
export function findFieldStrengthCrossingOnRadial({
  profile, tx_amsl_m, erp_kw, frequency_mhz,
  target_field_dbu,
  rx_height_above_ground_m = DEFAULT_RX_AMSL_GROUND_OFFSET_M,
  // 'itm-v122' = validated JS port of NTIA ITM v1.2.2 (default; 12/12
  //              fixtures match C++ to ≤0.05 dB).
  // 'bullington' = legacy Bullington smooth-earth + ITU-R P.526 single-
  //              knife-edge.  Kept for fallback / A-B diagnostics.
  engine = 'itm-v122'
}){
  if (!Array.isArray(profile) || profile.length < 2){
    return { crossing_distance_km: null, field_at_crossing_dbu: null, path_loss_at_crossing_db: null, worst_edge: null, profile_searched: 0, beyond_max_range: false };
  }
  const pathLoss = engine === 'itm-v122' ? itmV122PathLoss : terrainPathLoss;
  let last_above = null;
  let last_below = null;
  let lastResult = null;
  // Sweep from near to far; the field starts high and decreases.
  // The first sample at which field_dbu < target_field_dbu is
  // bracketed for linear interpolation.
  for (let i = 1; i < profile.length; i++){
    const cumulative = profile.slice(0, i + 1);
    const last_pt = cumulative[cumulative.length - 1];
    const rx_amsl_m = last_pt.elevation_m + rx_height_above_ground_m;
    const loss = pathLoss({
      tx_amsl_m, rx_amsl_m,
      terrain_profile: cumulative,
      frequency_mhz
    });
    const extra = loss.smooth_earth_extra_db + loss.knife_edge_db;
    const field = predictFieldStrengthDbu({
      erp_kw, distance_km: loss.distance_km, frequency_mhz,
      terrain_extra_loss_db: extra
    });
    lastResult = { distance_km: loss.distance_km, field_dbu: field, loss_db: loss.total_loss_db, worst_edge: loss.worst_edge };
    if (field >= target_field_dbu){
      last_above = lastResult;
    } else {
      last_below = lastResult;
      break;     // first sample below threshold; bracket
    }
  }

  if (last_above && last_below){
    // Linear interpolate between the bracketing samples in dBu vs km.
    const t = (target_field_dbu - last_above.field_dbu)
            / (last_below.field_dbu - last_above.field_dbu);
    const cross_km = last_above.distance_km + t * (last_below.distance_km - last_above.distance_km);
    return {
      crossing_distance_km:    Number(cross_km.toFixed(3)),
      field_at_crossing_dbu:   Number(target_field_dbu),
      path_loss_at_crossing_db:Number((last_above.loss_db + t * (last_below.loss_db - last_above.loss_db)).toFixed(2)),
      worst_edge:              last_below.worst_edge || last_above.worst_edge || null,
      profile_searched:        profile.length,
      beyond_max_range:        false
    };
  }
  if (last_above && !last_below){
    // Field never dropped below threshold within the profile range —
    // contour extends beyond the profile's max distance.
    return {
      crossing_distance_km:    null,
      field_at_crossing_dbu:   last_above.field_dbu,
      path_loss_at_crossing_db:last_above.loss_db,
      worst_edge:              last_above.worst_edge,
      profile_searched:        profile.length,
      beyond_max_range:        true
    };
  }
  // First sample already below threshold — contour is closer than
  // the first profile point; not resolvable at this sample density.
  return {
    crossing_distance_km:    last_below ? last_below.distance_km : null,
    field_at_crossing_dbu:   last_below ? last_below.field_dbu : null,
    path_loss_at_crossing_db:last_below ? last_below.loss_db : null,
    worst_edge:              last_below ? last_below.worst_edge : null,
    profile_searched:        profile.length,
    beyond_max_range:        false
  };
}

/**
 * Run a full ITM-aware coverage study along all requested radials.
 * Fetches DEM from elevationClient, computes terrain path-loss per
 * radial, finds field-strength crossing distances, and compares to
 * FCC §73.333 tabulated distances.
 *
 * @param {object} args
 * @param {number} args.tx_lat, args.tx_lon
 * @param {number} args.tx_amsl_m
 * @param {number} args.erp_kw
 * @param {number} args.haat_m            for FCC §73.333 baseline lookup
 * @param {number} args.frequency_mhz
 * @param {number[]} args.radials_deg
 * @param {number} args.target_field_dbu     service threshold (e.g. 60)
 * @param {number} [args.from_km=1]          first sample distance
 * @param {number} [args.to_km=80]           last sample distance
 * @param {number} [args.samples=40]         samples per radial (≈ 2 km step at 80 km)
 * @param {string} [args.fcc_mode='50,50']   FCC curve family for baseline
 * @param {string} [args.engine='itm-v122']  'itm-v122' | 'bullington'
 */
export async function computeItmCoverage({
  tx_lat, tx_lon, tx_amsl_m,
  erp_kw, haat_m, frequency_mhz,
  radials_deg,
  target_field_dbu,
  from_km = 1,
  to_km   = 80,
  samples = 40,
  fcc_mode = '50,50',
  // Propagation engine.  'itm-v122' is the validated JS port of NTIA
  // ITM v1.2.2 (default, 12/12 fixtures match C++ to ≤0.05 dB).
  // 'bullington' is the legacy Bullington smooth-earth + ITU-R P.526
  // path; kept for fallback + side-by-side comparison.
  engine = 'itm-v122'
}){
  // Pre-load the ITM v1.2.2 JS port once per process so the per-sample
  // sync call doesn't dynamic-import inside the hot loop.  Cheap no-op
  // on subsequent calls.
  if (engine === 'itm-v122'){
    try { await preloadItmV122(); }
    catch (e){ return { available: false, error: `ITM v1.2.2 preload failed: ${e.message}` }; }
  }

  // 1. Sample points along every radial.
  const pts = buildSamplePoints({ tx_lat, tx_lon, radials_deg, from_km, to_km, samples });

  // 2. Fetch elevations via multi-source fallback.
  let elevations, dem_source_id;
  try {
    const fb = await fetchElevationsFallback(pts);
    elevations    = fb.elevations;
    dem_source_id = fb.source_id;
  } catch (e){
    return {
      available: false,
      error:     `DEM fetch failed: ${e.message}`,
      cite:      '47 CFR §73.333 (with terrain via Bullington/ITU-R P.526)'
    };
  }

  // 3. FCC baseline distance (frequency / class-independent for the
  // tabulated curves; same value across all radials at fixed HAAT/ERP).
  let fcc_baseline_km = null;
  try {
    const r = fccDistanceKm({
      haat_m, target_dBu: target_field_dbu,
      erp_kw, mode: fcc_mode, frequency_mhz
    });
    fcc_baseline_km = r.distance_km;
  } catch { /* ignore; per-radial output still useful */ }

  // 4. Per-radial coverage.
  const radials = radials_deg.map((az, ri) => {
    const start = ri * samples;
    const radial_elevs = elevations.slice(start, start + samples);
    // Build the per-radial terrain profile.  Prepend a synthetic
    // sample at distance 0 carrying the Tx ground elevation
    // (approximated as tx_amsl_m - mean(near-tx samples)) so the LoS
    // computation has a Tx-side anchor.  When the elevation client
    // returned null at any point, we use the previous good value
    // (terrain typically continuous over 2 km steps).
    let last_good_elev = null;
    const profile = [];
    // distance=0 anchor: use the first sample's elevation as Tx-site ground
    const tx_ground = radial_elevs.find(e => Number.isFinite(e)) ?? 0;
    profile.push({ distance_km: 0, elevation_m: tx_ground });
    let n_dem_sourced = 0;
    for (let si = 0; si < samples; si++){
      const d_km = from_km + (to_km - from_km) * (si / (samples - 1));
      const e = radial_elevs[si];
      const elev = Number.isFinite(e) ? (n_dem_sourced++, last_good_elev = e) : (last_good_elev ?? tx_ground);
      profile.push({ distance_km: d_km, elevation_m: elev });
    }

    const cross = findFieldStrengthCrossingOnRadial({
      profile, tx_amsl_m, erp_kw, frequency_mhz,
      target_field_dbu,
      engine
    });

    let mode = 'los';
    if (cross.worst_edge && cross.worst_edge.h_above_los_m > 0) mode = 'diffraction';
    if (cross.beyond_max_range) mode = 'beyond-horizon-or-max-range';

    return {
      az,
      terrain_distance_km:      cross.crossing_distance_km,
      terrain_field_dbu:        cross.field_at_crossing_dbu,
      terrain_path_loss_db:     cross.path_loss_at_crossing_db,
      fcc_distance_km:          fcc_baseline_km,
      delta_km:                 (cross.crossing_distance_km != null && fcc_baseline_km != null)
                                ? Number((cross.crossing_distance_km - fcc_baseline_km).toFixed(3))
                                : null,
      worst_edge:               cross.worst_edge,
      n_samples_dem_sourced:    n_dem_sourced,
      n_samples_total:          samples,
      mode,
      beyond_max_range:         cross.beyond_max_range
    };
  });

  const isItm = engine === 'itm-v122';
  return {
    available:        true,
    engine,
    cite:             isItm
                        ? '47 CFR §73.333 / §73.184 with terrain via NTIA ITM v1.2.2 (Longley-Rice)'
                        : '47 CFR §73.333 / §73.184 with terrain via Bullington / ITU-R P.526',
    method:           isItm
                        ? 'per-radial NTIA ITM v1.2.2 (qlrpfl → lrprop → alos/adiff/ascat → avar); profile resampled to xi=100 m via pflFromProfile; field-strength crossing via linear interpolation'
                        : 'per-radial Bullington smooth-earth + ITU-R P.526 single-knife-edge diffraction; field-strength crossing via linear interpolation',
    dem_source:       dem_source_id,
    arc:              { from_km, to_km, samples, target_field_dbu, fcc_mode },
    tx:               { lat: tx_lat, lon: tx_lon, amsl_m: tx_amsl_m },
    fcc_baseline_km,
    radials,
    fetched_at:       new Date().toISOString(),
    provenance:       isItm
                        ? ITM_V122_PROPAGATION_PROVENANCE
                        : TERRAIN_PROPAGATION_PROVENANCE
  };
}
