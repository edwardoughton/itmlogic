// 47 CFR §73.62 / §73.45 / §73.150 — directional AM antenna pattern
// computation (MEOV — Measured Equivalent Operating Value).
//
// SCOPE
//   AM stations with directional antenna systems (DAS) radiate
//   different field strengths in different directions per §73.62.
//   The licensed pattern is published as a normalized azimuthal
//   field-strength curve and a set of MEOV monitor-point limits
//   (§73.45, §73.151).  For protection studies (§73.187 nighttime
//   skywave, §73.182 groundwave coverage), the relevant input is the
//   effective ERP toward the protected / interfering station — NOT
//   the omnidirectional rated power.
//
// METHODOLOGY
//   The pattern table maps azimuth (degrees from true north,
//   clockwise) to a relative field-strength factor f(az) ∈ [0..1]
//   where f = 1.0 represents the pattern's maximum (typically
//   normalized to the nondirectional equivalent).
//
//   Effective field at azimuth az:
//     E(az) = E_max · f(az)
//   Effective ERP at azimuth az (power scales as field²):
//     ERP_eff(az) = ERP_omni · f(az)²
//
//   §73.45 MEOV requires the actual monitored field at any
//   monitoring point to remain within +/- 5% of the licensed value.
//   §73.150 publishes the format of the pattern data submitted with
//   the §73.40 application.  The Genoa engine does NOT regenerate
//   the pattern from antenna physics — it interpolates the licensed
//   pattern across azimuths and applies it to the protection
//   studies.  Genoa's pattern_table input shape is shared with FM
//   directional antennas (§73.316) — the same patternFactor()
//   interpolator handles both bands.
//
// PATTERN TABLE SHAPE (input convention)
//   pattern_table: Array<[ az_deg, field_factor ]>
//   - az_deg ∈ [0, 360), clockwise from true north
//   - field_factor ∈ [0..1], normalized so max = 1.0
//   - Sorted by az_deg ascending (linear interpolation between rows)
//   - First row's az is conventionally 0; last row's az < 360 (the
//     interpolator wraps from last → first across the 0/360 boundary)
//
// LIMITATIONS
//   - Pattern is azimuth-only (no elevation dependence — full §73.150
//     proof patterns include vertical-plane data; we use horizontal-
//     plane only).
//   - We assume the licensed pattern equals the operating pattern
//     (i.e., MEOV is satisfied).  If the operator has a known
//     monitoring deviation, the actual field can be supplied as a
//     scaled pattern_table.
//   - We do not compute the pattern from tower-array geometry; the
//     §73.150 RTA (radiation theoretical analysis) is upstream of
//     this module.

import { patternFactor, isPattern2D } from './factor.js';

/**
 * Compute the effective ERP at a great-circle bearing for a
 * directional AM (or FM) antenna.
 *
 * @param {object} args
 * @param {number} args.erp_kw          omnidirectional rated ERP (kW)
 * @param {Array<[number, number]>|null} args.pattern_table
 *                                       null → nondirectional (factor 1.0)
 * @param {number} args.bearing_deg     azimuth from station to target (clockwise from north)
 * @returns {{
 *   erp_effective_kw, pattern_factor, bearing_deg, directional, pattern_applied
 * }}
 */
export function directionalErpAtBearing({ erp_kw, pattern_table, bearing_deg, elevation_deg = 0 }){
  const erp = Number(erp_kw);
  const az  = Number(bearing_deg);
  const el  = Number(elevation_deg);
  if (!Number.isFinite(erp) || erp < 0){
    return { erp_effective_kw: null, pattern_factor: null, bearing_deg: az, elevation_deg: el,
             directional: false, pattern_applied: false,
             error: 'erp_kw must be non-negative finite' };
  }
  if (!Number.isFinite(az)){
    return { erp_effective_kw: erp, pattern_factor: 1.0, bearing_deg: az, elevation_deg: el,
             directional: false, pattern_applied: false,
             error: 'bearing_deg must be finite' };
  }
  const isArrayPattern = Array.isArray(pattern_table) && pattern_table.length > 0;
  const is2DPattern    = isPattern2D(pattern_table);
  const directional    = isArrayPattern || is2DPattern;
  const f = directional ? patternFactor(pattern_table, az, Number.isFinite(el) ? el : 0) : 1.0;
  return {
    erp_effective_kw: Number((erp * f * f).toFixed(6)),
    pattern_factor:   Number(f.toFixed(6)),
    bearing_deg:      Number(((az % 360) + 360) % 360),
    elevation_deg:    Number.isFinite(el) ? el : 0,
    directional,
    pattern_dimensionality: is2DPattern ? '2D-az-el' : (isArrayPattern ? '1D-az-horizon' : null),
    pattern_applied:  directional
  };
}

/**
 * Compute the effective ERP for U toward D AND for D toward U on a
 * great-circle path.  Each station's pattern is applied at the
 * appropriate bearing.
 *
 * @param {object} args
 * @param {object} args.U                 { erp_kw, pattern_table?, lat, lon }
 * @param {object} args.D                 { erp_kw, pattern_table?, lat, lon }
 * @param {object} args.bearings          { u_to_d_deg, d_to_u_deg } from karneyInverse
 */
export function directionalErpForPair({ U, D, bearings }){
  const u_at_d = directionalErpAtBearing({
    erp_kw:        U.erp_kw,
    pattern_table: U.pattern_table || null,
    bearing_deg:   bearings.u_to_d_deg
  });
  const d_at_u = directionalErpAtBearing({
    erp_kw:        D.erp_kw,
    pattern_table: D.pattern_table || null,
    bearing_deg:   bearings.d_to_u_deg
  });
  return {
    u_toward_d: u_at_d,
    d_toward_u: d_at_u,
    any_directional: !!u_at_d.directional || !!d_at_u.directional
  };
}

export const AM_DIRECTIONAL_PROVENANCE = Object.freeze({
  regulation:    '47 CFR §73.62 (DAS authorization), §73.45 (MEOV monitoring), §73.150 (proof of performance), §73.151 (formula DA)',
  reference:     'FCC AM Engineering Handbook (NAB) Chapter 7; OET Form 302-AM antenna data',
  field_factor_convention: 'pattern_table = [[az_deg, field_factor]…]; field_factor ∈ [0..1] normalized to max=1.0; clockwise from true north',
  power_scaling: 'ERP_eff(az) = ERP_omni · f(az)² — power scales as field²',
  modeled: [
    'Horizontal-plane azimuth pattern interpolation (linear)',
    'Pattern application on the great-circle bearing for protection-study pairs (§73.187, §73.215, §74.1204)',
    'Power-vs-field-squared scaling for ERP'
  ],
  not_modeled: [
    'Elevation-plane (vertical) pattern from §73.150 RTA',
    'MEOV monitoring deviations beyond ±5% (assumed within tolerance)',
    'Pattern derivation from tower-array geometry (RTA upstream)',
    'Pattern interaction with ground conductivity at low azimuths'
  ],
  license_basis: '17 U.S.C. § 105 — methodology from §73.62 / §73.45 / §73.150, US Government public domain'
});
