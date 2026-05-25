// Shared contour-pair D/U study helper.
//
// Both 47 CFR §74.1204 (FM translator interference) and 47 CFR §73.215
// (FM full-service contour protection) use the same pair-wise study:
//
//   Given a "U" station (the "undesired" potential interferer) and a
//   "D" station (the "desired" station whose protected contour must be
//   defended), compute:
//
//     1. r_D := D's F(50,50) protected-contour distance at D's class
//        threshold along the bearing toward U (worst case for the gate).
//     2. r_edge := |Tx_U → Tx_D| − r_D, the closest range from U to
//        D's protected-contour edge.  When U is INSIDE D's protected
//        contour, r_edge collapses to a tiny positive value (1 m) so
//        the field-strength lookup doesn't blow up; this is recorded
//        as `inside_protected_contour: true` and is an automatic gate
//        violation.
//     3. U_field := U's F(50,10) field strength (dBu) at r_edge.
//     4. D/U (dB) := D_protected_threshold_dBu − U_field_dBu.
//
//   The §74.1204(c) and §73.215 D/U gates are identical for the
//   restricted offsets (co-channel 20 dB, 1st-adj 6 dB, etc.); the
//   regulations differ only in scope (translator-vs-full-service vs
//   full-service-vs-full-service) and which threshold tables apply.
//
// This module exports a pure function that doesn't know about either
// rule — callers supply both parties and the gate.

import { fccDistanceKm, fccFieldDbuAtDistance } from '../curves/fcc/index.mjs';
import { karneyInverse } from '../geometry/wgs84.js';
import { directionalErpAtBearing } from '../pattern/am_directional.js';

/**
 * Run a single contour-pair D/U study.
 *
 * @param {object} U  Undesired station: { lat, lon, erp_kw, haat_m, frequency_mhz, call?, facility_id?, fcc_class? }
 * @param {object} D  Desired station: same shape; D.fcc_class drives the protected threshold lookup if `protected_field_dbu` not supplied
 * @param {object} opts
 * @param {string} opts.relationship                     channel-relationship label (e.g. 'co-channel', '1st-adjacent')
 * @param {number} opts.du_threshold_db                  D/U threshold (dB) — must be ≥ this for pass
 * @param {number} opts.protected_field_dbu              D's protected contour threshold (dBu)
 * @param {string} [opts.protected_mode='50,50']         curve mode for D's protected contour
 * @param {string} [opts.interfering_mode='50,10']       curve mode for U's interfering field
 * @returns Per-pair study record (see translator.js studyOnePrimary
 *          shape for fields).  `pass` is true/false/null; null = the
 *          study was skipped (frequencies / coordinates / curve lookup
 *          incomplete) — caller decides what skipped pairs mean.
 */
export function studyContourPair(U, D, {
  relationship,
  du_threshold_db,
  protected_field_dbu,
  protected_mode   = '50,50',
  interfering_mode = '50,10'
} = {}){
  const study = {
    u_call:                            U?.call          || null,
    u_facility_id:                     U?.facility_id   || null,
    d_call:                            D?.call          || null,
    d_facility_id:                     D?.facility_id   || null,
    d_class:                           D?.fcc_class     || null,
    d_frequency_mhz:                   Number(D?.frequency_mhz),
    u_frequency_mhz:                   Number(U?.frequency_mhz),
    relationship:                      relationship          || null,
    du_threshold_db:                   du_threshold_db        ?? null,
    d_protected_field_dbu:             protected_field_dbu    ?? null,
    separation_km:                     null,
    d_protected_distance_km:           null,
    u_distance_to_d_protected_edge_km: null,
    u_field_dbu_at_d_edge:             null,
    du_actual_db:                      null,
    inside_protected_contour:          false,
    // Directional-pattern application (§73.62 / §73.316).  Reported
    // verbatim regardless of whether either station carries a
    // pattern_table — when both are non-directional the factors are
    // 1.0 and bearings are still useful for narrative.
    bearings:                          null,
    u_pattern_factor:                  1.0,
    d_pattern_factor:                  1.0,
    u_erp_effective_kw:                null,
    d_erp_effective_kw:                null,
    directional_pattern_applied:       false,
    pass:                              null,
    skipped:                           false,
    skipped_reason:                    null
  };

  if (!U || !D){
    study.skipped        = true;
    study.skipped_reason = 'U or D station object missing';
    return study;
  }
  if (!Number.isFinite(study.u_frequency_mhz) || !Number.isFinite(study.d_frequency_mhz)){
    study.skipped        = true;
    study.skipped_reason = 'U or D frequency missing';
    return study;
  }
  const lat1 = Number(U.lat), lon1 = Number(U.lon);
  const lat2 = Number(D.lat), lon2 = Number(D.lon);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)){
    study.skipped        = true;
    study.skipped_reason = 'U or D coordinates missing';
    return study;
  }
  if (!Number.isFinite(du_threshold_db) || !Number.isFinite(protected_field_dbu)){
    study.skipped        = true;
    study.skipped_reason = 'du_threshold_db or protected_field_dbu missing';
    return study;
  }

  // Inverse geodesic from D → U gives the bearing D→U directly.
  const inv_du = karneyInverse(lat2, lon2, lat1, lon1);
  study.separation_km = inv_du.distance_km;
  // initial_bearing_deg is the azimuth from D toward U.
  // The reciprocal U→D bearing is final_bearing_deg + 180 (mod 360).
  const bearing_d_to_u = inv_du.initial_bearing_deg;
  const bearing_u_to_d = ((inv_du.final_bearing_deg + 180) % 360 + 360) % 360;
  study.bearings = {
    u_to_d_deg: Number(bearing_u_to_d.toFixed(3)),
    d_to_u_deg: Number(bearing_d_to_u.toFixed(3))
  };

  // Apply directional patterns (when supplied) on the great-circle
  // bearing.  Contour-pair studies operate at the horizon
  // (elevation_deg = 0) — the protected/interfering edges are at
  // ground level on a smooth-Earth model.  When U.pattern_table or
  // D.pattern_table is a 2-D az×el grid the factor() interpolator
  // reads the el=0 slice; 1-D legacy tables are unaffected.
  // Pattern's effect on power: ERP_eff = ERP_omni · f(az)².
  const u_dir = directionalErpAtBearing({
    erp_kw:         Number(U.erp_kw),
    pattern_table:  U.pattern_table || null,
    bearing_deg:    bearing_u_to_d,
    elevation_deg:  0
  });
  const d_dir = directionalErpAtBearing({
    erp_kw:         Number(D.erp_kw),
    pattern_table:  D.pattern_table || null,
    bearing_deg:    bearing_d_to_u,
    elevation_deg:  0
  });
  study.u_pattern_factor            = u_dir.pattern_factor;
  study.d_pattern_factor            = d_dir.pattern_factor;
  study.u_erp_effective_kw          = u_dir.erp_effective_kw;
  study.d_erp_effective_kw          = d_dir.erp_effective_kw;
  study.directional_pattern_applied = u_dir.pattern_applied || d_dir.pattern_applied;
  study.pattern_dimensionality      = u_dir.pattern_dimensionality || d_dir.pattern_dimensionality || null;
  study.elevation_deg               = 0;

  let rD;
  try {
    rD = fccDistanceKm({
      haat_m:        Number(D.haat_m),
      target_dBu:    protected_field_dbu,
      erp_kw:        d_dir.erp_effective_kw,        // directional toward U
      mode:          protected_mode,
      frequency_mhz: study.d_frequency_mhz
    }).distance_km;
  } catch (e){
    study.skipped        = true;
    study.skipped_reason = `D protected-contour distance failed: ${e.message}`;
    return study;
  }
  study.d_protected_distance_km = rD;

  let rEdge = study.separation_km - rD;
  if (!Number.isFinite(rEdge) || rEdge <= 0){
    rEdge = 0.001;                         // 1 m — keeps log-domain stable
    study.inside_protected_contour = true;
  }
  study.u_distance_to_d_protected_edge_km = rEdge;

  let uField;
  try {
    uField = fccFieldDbuAtDistance({
      haat_m:        Number(U.haat_m),
      distance_km:   rEdge,
      erp_kw:        u_dir.erp_effective_kw,         // directional toward D
      mode:          interfering_mode,
      frequency_mhz: study.u_frequency_mhz
    }).field_dBu;
  } catch (e){
    study.skipped        = true;
    study.skipped_reason = `U F(${interfering_mode}) at D's edge failed: ${e.message}`;
    return study;
  }
  study.u_field_dbu_at_d_edge = uField;

  const du = protected_field_dbu - uField;
  study.du_actual_db = du;
  study.pass         = du >= du_threshold_db;
  return study;
}

/**
 * Channel-relationship classifier shared by §74.1204 and §73.215.
 * FM grid is 200 kHz; IF spurs at ±10.6 / ±10.8 MHz.
 */
export function classifyFmOffsetKhz(delta_khz){
  const d = Math.abs(Math.round(delta_khz));
  if (d === 0)                         return { rel: 'cochannel',       label: 'co-channel'        };
  if (d === 200)                       return { rel: 'first_adjacent',  label: '1st-adjacent'      };
  if (d === 400)                       return { rel: 'second_adjacent', label: '2nd-adjacent'      };
  if (d === 600)                       return { rel: 'third_adjacent',  label: '3rd-adjacent'      };
  if (d === 10600 || d === 10800)      return { rel: 'if_offset',       label: 'IF (10.6/10.8 MHz)' };
  return                                      { rel: 'non_restricted',  label: 'non-restricted'    };
}
