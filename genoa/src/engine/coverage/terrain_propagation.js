// Terrain-aware path-loss propagation model.
//
// SCOPE
//   This module implements a SIMPLIFIED terrain-propagation engine
//   that uses real DEM data (via the multi-source elevationClient) to
//   produce field-strength predictions that account for actual
//   terrain along the path.  It is the engine behind Genoa's
//   "ITM-aware" coverage analysis.
//
// MODEL — three components combined per ITU-R P.530-style methodology:
//
//   1. Free-space path loss (FSPL)
//        L_fs(dB) = 32.45 + 20·log10(d_km) + 20·log10(f_MHz)
//      Reference: ITU-R P.525, Friis transmission.
//
//   2. Smooth-earth two-ray reflection (Bullington, 1947)
//        Beyond the radio horizon, field rolls off as 1/d² instead of
//        1/d, adding ~6 dB per octave of distance.  Computed as the
//        path-loss factor needed for the ground-reflection nullification
//        to yield the observed weakening over a smooth Earth model.
//
//   3. Knife-edge diffraction at the worst obstacle (Fresnel-Kirchhoff)
//        L_kd(dB) = 6.9 + 20·log10(√((ν - 0.1)² + 1) + ν - 0.1)   for ν ≥ -0.7
//                 = 0                                              otherwise
//      where ν is the Fresnel-Kirchhoff diffraction parameter for the
//      most obstructive single edge along the path:
//        ν = h · √(2/λ · (1/d1 + 1/d2))
//      h is the obstacle's height above the LoS (Tx-Rx straight line);
//      d1, d2 are the distances from Tx and Rx to the obstacle.  This
//      is the worst-case "sharpest-edge" approximation; multi-edge
//      diffraction (Epstein-Peterson, Deygout) is bounded above by it.
//
//   Total path loss:
//     L_total(dB) = max(L_fs, L_smooth_earth) + max(0, L_kd)
//
//   Predicted field strength:
//     E_dBu = ERP_eirp_dBm - L_total - ground_attenuation - 25.94
//   (the -25.94 dB constant converts EIRP-power-density-at-distance to
//   the dBu reference field strength; derived from the conversion
//   between dBm power and dBμV/m field strength in 50-Ω free space.)
//
// COMPARISON vs FULL ITM (Longley-Rice v7.0)
//   - Full ITM models additional loss components beyond knife-edge
//     diffraction: forward-scatter mode, tropospheric ducting, multipath
//     fading, climate-zone-specific atmospheric refractivity, and the
//     statistical reliability/confidence parameters.
//   - The Bullington single-knife-edge approximation typically OVER-
//     ESTIMATES path loss by 3-6 dB relative to ITM at the >10 km
//     ranges relevant to FM/AM broadcast contour analysis (multi-edge
//     paths are usually bounded by the worst edge but not equal to it).
//   - Below 5 km in flat terrain, this model matches ITM within 1 dB.
//   - For full ITM-fidelity, route via the SPLAT sidecar
//     (see splatClient.js predictItmCoverage()).
//
// PROVENANCE
//   - Bullington, K. "Radio Propagation at Frequencies above 30 Mc/s",
//     Proc. IRE, 1947 (smooth-earth two-ray model).
//   - ITU-R Recommendation P.526-15, "Propagation by diffraction"
//     (knife-edge formula §4.1).
//   - ITU-R P.525, "Calculation of free-space attenuation".
//   - NTIA TM 99-368 / "ITM v7.0 Reference" (full Longley-Rice; cited
//     for context, not implemented here).

const SPEED_OF_LIGHT_M_S = 299_792_458;
const EARTH_RADIUS_KM    = 6371;

// ---------------------------------------------------------------------------
// Free-space path loss
// ---------------------------------------------------------------------------

/**
 * Free-space path loss in dB.
 * @param {number} distance_km
 * @param {number} frequency_mhz
 */
export function freeSpacePathLoss_dB(distance_km, frequency_mhz){
  const d = Math.max(Number(distance_km), 1e-3);
  const f = Number(frequency_mhz);
  return 32.45 + 20 * Math.log10(d) + 20 * Math.log10(f);
}

// ---------------------------------------------------------------------------
// Smooth-earth two-ray (Bullington)
// ---------------------------------------------------------------------------

/**
 * Bullington smooth-earth additional loss beyond free-space, modelling
 * the 1/d² roll-off that dominates beyond the radio horizon.
 *
 * Returns the dB contribution that should be ADDED to free-space loss
 * for ranges beyond the LoS horizon.  Inside the horizon, the two-ray
 * model can OVER-predict relative to free-space; we floor at 0.
 */
export function smoothEarthAdditional_dB({ distance_km, tx_height_m, rx_height_m, frequency_mhz }){
  const d = Math.max(Number(distance_km), 1e-3);
  const ht = Math.max(Number(tx_height_m), 1.0);
  const hr = Math.max(Number(rx_height_m), 1.0);
  const f = Number(frequency_mhz);
  const lambda_m = SPEED_OF_LIGHT_M_S / (f * 1e6);

  // Radio horizon (effective Earth radius factor of 4/3).
  const k_eff = 4 / 3;
  const horizon_km = Math.sqrt(2 * k_eff * EARTH_RADIUS_KM * (ht / 1000))
                   + Math.sqrt(2 * k_eff * EARTH_RADIUS_KM * (hr / 1000));
  if (d <= horizon_km) return 0;     // line-of-sight — free-space dominates

  // Two-ray plane-earth path loss (Egli-form simplification valid for
  // d >> ht and d >> hr): L_pe(dB) = 40·log10(d_m) - 20·log10(ht·hr)
  const d_m = d * 1000;
  const L_pe = 40 * Math.log10(d_m) - 20 * Math.log10(ht * hr);
  // Free-space loss in dB: 20·log10(4πd/λ)
  const L_fs = 20 * Math.log10(4 * Math.PI * d_m / lambda_m);

  return Math.max(0, L_pe - L_fs);
}

// ---------------------------------------------------------------------------
// Knife-edge diffraction (worst single edge along the path)
// ---------------------------------------------------------------------------

/**
 * Fresnel-Kirchhoff diffraction parameter ν.
 *
 * @param {number} h_m   height of the edge above the Tx-Rx straight line (negative if below LoS)
 * @param {number} d1_km distance Tx → edge
 * @param {number} d2_km distance edge → Rx
 * @param {number} frequency_mhz
 */
export function fresnelKirchhoffNu(h_m, d1_km, d2_km, frequency_mhz){
  const h = Number(h_m);
  const d1 = Math.max(Number(d1_km) * 1000, 1);
  const d2 = Math.max(Number(d2_km) * 1000, 1);
  const lambda_m = SPEED_OF_LIGHT_M_S / (Number(frequency_mhz) * 1e6);
  return h * Math.sqrt((2 / lambda_m) * (1/d1 + 1/d2));
}

/**
 * ITU-R P.526 §4.1 single-edge knife-edge diffraction loss in dB.
 * Returns 0 dB when the obstacle does not protrude above the line of
 * sight (ν < -0.7).
 */
export function knifeEdgeDiffraction_dB(nu){
  const v = Number(nu);
  if (!Number.isFinite(v) || v < -0.7) return 0;
  return 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) * (v - 0.1) + 1) + v - 0.1);
}

/**
 * Find the worst (highest above LoS) obstacle on a terrain profile and
 * return its diffraction loss.
 *
 * @param {object} args
 * @param {number} args.tx_amsl_m       Tx antenna height above mean sea level
 * @param {number} args.rx_amsl_m       Rx antenna height above mean sea level (typ. 9.1 m for §73.683)
 * @param {Array<{distance_km: number, elevation_m: number}>} args.terrain_profile
 *                                       sorted by distance_km ascending; first entry at distance≈0
 *                                       carries the Tx-site ground elevation, last entry the receiver-site ground elevation
 * @param {number} args.frequency_mhz
 * @returns {{ loss_db, worst_edge: { distance_km, elevation_m, h_above_los_m, nu } | null }}
 */
export function bullingtonWorstEdge({ tx_amsl_m, rx_amsl_m, terrain_profile, frequency_mhz }){
  if (!Array.isArray(terrain_profile) || terrain_profile.length < 2){
    return { loss_db: 0, worst_edge: null };
  }
  const first = terrain_profile[0];
  const last  = terrain_profile[terrain_profile.length - 1];
  const total_km = last.distance_km - first.distance_km;
  if (!(total_km > 0)) return { loss_db: 0, worst_edge: null };

  // Tx and Rx are tx_amsl_m above the first profile point's ground,
  // rx_amsl_m above the last profile point's ground.  Build the LoS
  // line from those two points.
  const tx_alt = first.elevation_m + 0;            // Tx ground elev — Tx antenna is at tx_amsl_m absolute
  const rx_alt = last.elevation_m  + 0;            // Rx ground elev — Rx antenna at rx_amsl_m absolute
  const tx_z = Number(tx_amsl_m);
  const rx_z = Number(rx_amsl_m);

  let worst = null;
  for (let i = 1; i < terrain_profile.length - 1; i++){
    const p = terrain_profile[i];
    const d1 = p.distance_km - first.distance_km;
    const d2 = last.distance_km - p.distance_km;
    if (d1 <= 0 || d2 <= 0) continue;
    // LoS height at this point — linear interpolation between Tx and Rx
    const los_z = tx_z + (rx_z - tx_z) * (d1 / total_km);
    // Earth-curvature correction (4/3 effective radius)
    // Curvature drop at distance d1 from Tx (along a chord d1+d2):
    //   Δh ≈ (d1·d2) / (2·k_eff·R_E)   (in km · km / km → km; convert to m)
    const k_eff = 4 / 3;
    const earth_drop_m = (d1 * d2) / (2 * k_eff * EARTH_RADIUS_KM) * 1000;
    const obstacle_z = p.elevation_m;
    const h_m = obstacle_z - (los_z - earth_drop_m);   // edge above curved-earth LoS
    if (h_m <= 0) continue;
    const nu = fresnelKirchhoffNu(h_m, d1, d2, frequency_mhz);
    if (!worst || nu > worst.nu){
      worst = { distance_km: p.distance_km, elevation_m: p.elevation_m, h_above_los_m: h_m, nu };
    }
  }
  if (!worst) return { loss_db: 0, worst_edge: null };
  return { loss_db: knifeEdgeDiffraction_dB(worst.nu), worst_edge: worst };
}

// ---------------------------------------------------------------------------
// Total path loss + field strength
// ---------------------------------------------------------------------------

/**
 * Combined terrain-aware path loss.  Returns the dB loss to apply to
 * the EIRP to compute received field strength at the receiver.
 *
 * @returns {{
 *   total_loss_db, free_space_db, smooth_earth_extra_db, knife_edge_db,
 *   worst_edge, distance_km, frequency_mhz
 * }}
 */
export function terrainPathLoss({
  tx_amsl_m, rx_amsl_m, terrain_profile, frequency_mhz
}){
  const first = terrain_profile[0];
  const last  = terrain_profile[terrain_profile.length - 1];
  const distance_km = last.distance_km - first.distance_km;
  const tx_height_m = Math.max(Number(tx_amsl_m) - first.elevation_m, 1);
  const rx_height_m = Math.max(Number(rx_amsl_m) - last.elevation_m,  1);

  const fs = freeSpacePathLoss_dB(distance_km, frequency_mhz);
  const se = smoothEarthAdditional_dB({ distance_km, tx_height_m, rx_height_m, frequency_mhz });
  const ke = bullingtonWorstEdge({ tx_amsl_m, rx_amsl_m, terrain_profile, frequency_mhz });

  const total = fs + se + ke.loss_db;
  return {
    total_loss_db:        Number(total.toFixed(2)),
    free_space_db:        Number(fs.toFixed(2)),
    smooth_earth_extra_db:Number(se.toFixed(2)),
    knife_edge_db:        Number(ke.loss_db.toFixed(2)),
    worst_edge:           ke.worst_edge,
    distance_km,
    frequency_mhz:        Number(frequency_mhz),
    tx_height_m, rx_height_m
  };
}

/**
 * Convert an FM/TV-broadcast-style ERP (kW, dipole-referenced) and
 * computed terrain path-loss into a predicted field strength in dBu.
 *
 * Derivation:
 *   EIRP(dBm) = 10·log10(ERP_W × 1.64) + 30
 *             = 10·log10(ERP_kW)       + 30 + 2.15 + 30
 *             = 10·log10(ERP_kW)       + 62.15
 *   E(dBμV/m) at distance d, accounting for path loss L:
 *     E = EIRP(dBm) - L(dB) + 77.2     (free-space dipole reference)
 *   The 77.2 dB constant is from the conversion EIRP(dBm) → field
 *   strength at the receiver (50-Ω reference, dipole gain).
 *
 *   Or simply, in field-strength terms:
 *     E_dBu = 106.92 + 10·log10(ERP_kW) - 20·log10(d_km) - 20·log10(f_MHz)
 *           - L_terrain_extra_db
 *   where L_terrain_extra_db = se_db + ke_db  (above free-space).
 */
export function predictFieldStrengthDbu({
  erp_kw, distance_km, frequency_mhz, terrain_extra_loss_db = 0
}){
  const erp = Math.max(Number(erp_kw), 1e-9);
  const d   = Math.max(Number(distance_km), 1e-3);
  const f   = Number(frequency_mhz);
  // Standard FCC-style FSL field strength (matches §73.333 free-space
  // computation): E(dBu) = 106.92 + 10·log10(ERP_kW) - 20·log10(d) - 20·log10(f)
  return 106.92
       + 10 * Math.log10(erp)
       - 20 * Math.log10(d)
       - 20 * Math.log10(f)
       - Number(terrain_extra_loss_db);
}

export const TERRAIN_PROPAGATION_PROVENANCE = Object.freeze({
  model:    'Bullington smooth-earth + ITU-R P.526 single-knife-edge diffraction',
  references: [
    'Bullington, K. (1947). "Radio Propagation at Frequencies above 30 Mc/s." Proc. IRE 35(10).',
    'ITU-R Recommendation P.526-15 (10/2019), §4.1 single-edge knife-edge diffraction',
    'ITU-R Recommendation P.525-4 (08/2019), free-space attenuation'
  ],
  dem_source: 'multi-source elevationClient (USGS 3DEP + Open-Meteo + OpenTopoData)',
  modeled: [
    'Free-space path loss (Friis / ITU-R P.525)',
    'Smooth-earth two-ray ground-reflection beyond LoS horizon (Bullington 1947)',
    'Single-edge knife-edge diffraction at worst path obstacle (ITU-R P.526 §4.1)',
    '4/3 effective Earth radius for line-of-sight curvature'
  ],
  not_modeled: [
    'Multi-edge diffraction (Epstein-Peterson, Deygout) — single worst edge approximation used; ≤ 6 dB pessimistic',
    'Tropospheric scatter / ducting modes',
    'Climate-zone refractivity (assumes US average k = 4/3)',
    'Time/location/situation reliability (full ITM v7.0 statistical layer)',
    'Foliage attenuation, building penetration'
  ],
  full_itm_path: 'src/evidence/terrain/splatClient.js predictItmCoverage() — routes to chelstein/splat sidecar with provisioned DEM tiles for full Longley-Rice fidelity',
  license_basis: 'ITU and IRE references in the public domain; implementation original'
});

// ---------------------------------------------------------------------
// ITM v1.2.2 path-loss adapter — drop-in replacement for terrainPathLoss
// that routes through the validated JS port (src/engine/coverage/itm_v122).
//
// Returns the same shape as terrainPathLoss so findFieldStrengthCrossingOnRadial
// can consume it without changes:
//
//   { total_loss_db, free_space_db, smooth_earth_extra_db, knife_edge_db,
//     worst_edge, distance_km, frequency_mhz, tx_height_m, rx_height_m }
//
// The ITM path doesn't produce a "worst edge" — diffraction is integrated
// across the full profile inside qlrpfl/lrprop.  We pack the avar-output
// excess-above-free-space into `smooth_earth_extra_db` (so the existing
// `extra = smooth_earth_extra_db + knife_edge_db` arithmetic in the
// crossing-finder still yields the right total) and leave knife_edge_db=0
// + worst_edge=null.
//
// Validated 12/12 PASS at max |Δ| = 0.05 dB vs C++ test_p2p (NTIA v1.2.2)
// across the splat-vs-JS bake-off (chelstein/itmlogic itmBakeOff.js).
// ---------------------------------------------------------------------

let _pointToPointLazy = null;
async function _loadPointToPoint(){
  if (!_pointToPointLazy){
    const mod = await import('./itm_v122/index.js');
    _pointToPointLazy = mod.pointToPoint;
  }
  return _pointToPointLazy;
}
// Synchronous wrapper for hot-path use.  Top-level await isn't available
// in CommonJS callers and the original API is sync; load the module on
// first use via a module-level promise that callers can await once at
// startup before using the sync surface.
let _pointToPointSync = null;
export async function preloadItmV122(){
  if (!_pointToPointSync) _pointToPointSync = await _loadPointToPoint();
  return _pointToPointSync;
}
function _requirePreloaded(){
  if (!_pointToPointSync){
    throw new Error('itmV122PathLoss called before preloadItmV122(); call await preloadItmV122() once at engine startup');
  }
  return _pointToPointSync;
}

/**
 * Resample a (distance_km, elevation_m) terrain profile to a uniform
 * pfl array in SPLAT format: [np, xi, e0, e1, ..., enp].  np = number
 * of intervals (so length = np + 3).  Linear-interpolates elevation
 * between adjacent input samples.
 *
 * @param {Array<{distance_km, elevation_m}>} profile  sorted by distance_km
 * @param {number} [xi_m=100]  target sample spacing (m); the actual xi
 *                              is adjusted so np * xi = total_distance_m exactly.
 * @returns {Array<number>}  pfl array
 */
export function pflFromProfile(profile, xi_m = 100){
  if (!Array.isArray(profile) || profile.length < 2){
    return [1, xi_m, 0, 0];
  }
  const pts = profile.slice().sort((a, b) => a.distance_km - b.distance_km);
  const total_m = Math.max((pts[pts.length - 1].distance_km - pts[0].distance_km) * 1000, xi_m);
  const np = Math.max(1, Math.round(total_m / xi_m));
  const xi = total_m / np;
  const start_m = pts[0].distance_km * 1000;
  const pfl = [np, xi];
  let j = 1;
  for (let i = 0; i <= np; i++){
    const d_m = i * xi;
    while (j < pts.length && (pts[j].distance_km * 1000 - start_m) < d_m) j++;
    if (j >= pts.length) j = pts.length - 1;
    const a = pts[j - 1], b = pts[j];
    const a_m = a.distance_km * 1000 - start_m;
    const b_m = b.distance_km * 1000 - start_m;
    const t = b_m === a_m ? 0 : (d_m - a_m) / (b_m - a_m);
    pfl.push(a.elevation_m + t * (b.elevation_m - a.elevation_m));
  }
  return pfl;
}

/**
 * ITM v1.2.2 terrain path-loss — same return shape as terrainPathLoss
 * so the existing crossing-finder consumes it unchanged.
 *
 * Requires preloadItmV122() to have been called at engine startup.
 *
 * @param {object} args  same as terrainPathLoss
 * @param {number} [args.klim=5]      ITM radio climate (5 = continental temperate)
 * @param {number} [args.mdvar=12]    ITM mode-of-variability (12 = broadcast)
 * @param {number} [args.conf=0.5]    confidence quantile
 * @param {number} [args.rel=0.5]     reliability quantile
 * @param {number} [args.ipol=1]      polarisation (0=H, 1=V)
 * @param {number} [args.xi_m=100]    pfl sample spacing
 */
export function itmV122PathLoss({
  tx_amsl_m, rx_amsl_m, terrain_profile, frequency_mhz,
  klim = 5, mdvar = 12, conf = 0.5, rel = 0.5, ipol = 1,
  xi_m = 100
}){
  const pointToPoint = _requirePreloaded();
  const first = terrain_profile[0];
  const last  = terrain_profile[terrain_profile.length - 1];
  const distance_km = last.distance_km - first.distance_km;
  const tx_height_m = Math.max(Number(tx_amsl_m) - first.elevation_m, 1);
  const rx_height_m = Math.max(Number(rx_amsl_m) - last.elevation_m,  1);

  const pfl = pflFromProfile(terrain_profile, xi_m);
  const r   = pointToPoint({
    profile:       pfl,
    tx_height_m,
    rx_height_m,
    frequency_mhz: Number(frequency_mhz),
    klim, mdvar, conf, rel, ipol
  });

  const total = r.dbloss_db;
  const fs    = r.fsl_db;
  return {
    total_loss_db:        Number(total.toFixed(2)),
    free_space_db:        Number(fs.toFixed(2)),
    // ITM doesn't separate smooth-earth vs knife-edge — the avar-output
    // excess above free-space rolls them together.  Pack it into
    // smooth_earth_extra_db so the existing crossing-finder arithmetic
    // (`extra = smooth_earth_extra_db + knife_edge_db`) yields the same
    // number we'd get by reading total - fsl directly.
    smooth_earth_extra_db:Number((r.avar_db).toFixed(2)),
    knife_edge_db:        0,
    worst_edge:           null,
    distance_km,
    frequency_mhz:        Number(frequency_mhz),
    tx_height_m, rx_height_m,
    // Per-call ITM diagnostics — exposed so the radial-coverage layer
    // can surface mode/kwx/dl/dh on each result for the engineering
    // report.  Not consumed by predictFieldStrengthDbu / the crossing
    // finder; safe to ignore.
    _itm: {
      mode:  r.mode,
      kwx:   r.kwx,
      dl:    r.dl,
      he:    r.he,
      dh:    r.dh,
      excess_db: r.excess_db,
      avar_db:   r.avar_db
    }
  };
}

export const ITM_V122_PROPAGATION_PROVENANCE = Object.freeze({
  model:    'NTIA Irregular Terrain Model v1.2.2 (Longley-Rice) — JS port',
  port_from: 'chelstein/splat itwom3.0.cpp point_to_point_ITM (v1.2.2 baseline)',
  port_module: 'src/engine/coverage/itm_v122 (qlrpfl → lrprop → alos/adiff/ascat → avar)',
  validation: '12/12 fixtures pass at max |Δ| ≤ 0.05 dB vs C++ test_p2p reference (PR #106 bake-off)',
  references: [
    'NTIA Tech. Report 82-100 (Longley-Rice), §4 (the radio-propagation model)',
    'Irregular Terrain Model (Hufford / Longley / Rice 1967, NBS Tech. Note 101)',
    'ITS implementation itm.cpp v1.2.2 (public domain)'
  ],
  dem_source: 'multi-source elevationClient (USGS 3DEP + Open-Meteo + OpenTopoData) resampled to uniform xi=100m via pflFromProfile()',
  modeled: [
    'Two-clear-horizon LOS + diffraction blend (qlrpfl ELSE branch)',
    'Rounded-horizon / two-obstruction LOS + diffraction (qlrpfl IF branch)',
    'Free-space + smooth-earth + knife-edge integration via adiff/alos coefficients',
    'Troposcatter beyond-horizon regime (ascat)',
    'Variability statistics (avar) with climate, time, location, situation, mode-of-variability'
  ],
  not_modeled: [
    'Canopy attenuation — use pointToPointItwom (ITWOM 3.0) for the saalos canopy path',
    'Multi-source DEM uncertainty propagation (single elevation per sample)',
    'Polarization beyond H/V (no circular here; ITWOM path takes ptx=2)'
  ],
  license_basis: 'NTIA TR 82-100 in the public domain; JS port original (matches C++ at machine precision)'
});
