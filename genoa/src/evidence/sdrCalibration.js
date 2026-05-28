// SDR calibration + predicted-vs-measured residual analysis.
//
// SCOPE
//   Genoa's evidence.measurements block has long carried raw SDR
//   captures from ZTR (lat, lon, frequency, time, raw signal).  Until
//   now they were tagged `calibrated: false` and the engine treated
//   them as provenance only.  This module promotes them to
//   filing-grade evidence by:
//
//     1. Extracting calibration metadata from the rich-station
//        response (gain, cable loss, LNA, sensitivity floor, last
//        calibration date, calibration method).
//     2. Applying the calibration to convert raw RSSI/dBm into
//        E-field strength dBu = 20·log10(E_µV/m).
//     3. Computing predicted-vs-measured residuals: for each
//        capture, ask Genoa's curve engine for the predicted field
//        at that receiver lat/lon, take the calibrated measured
//        field, return delta_dB.
//     4. Aggregating: rms_residual_dB, n_above_predicted,
//        n_below_predicted, n_calibrated, n_uncalibrated, calibration
//        quality flag.
//
// RECEIVER CALIBRATION CHAIN (per OET-69 / standard SDR practice)
//
//   E_received_dBu = RSSI_dBm
//                  - LNA_gain_dB
//                  - antenna_gain_dBi
//                  + cable_loss_dB
//                  + 107                     // dBm→dBu conversion factor
//                                            // (50Ω, 0 dBm = 107 dBu in
//                                            // a matched antenna)
//
//   The +107 dB constant comes from the standard relationship
//     P(dBm) = 10·log10(P_mW / 1 mW)
//     E(dBu) = 20·log10(E_µV/m)
//   for an isotropic receiver in 50Ω, 1 m².  A more accurate model
//   uses the antenna factor AF (dB/m) supplied per-antenna; we
//   accept it under calibration.antenna_factor_db_per_m and prefer
//   it over the 107 default when present.
//
// CALIBRATION METADATA SHAPE (extracted from ZTR rich-station or
// per-record overrides)
//
//   calibration: {
//     calibrated:                bool,      // master flag
//     antenna_gain_dbi:          number,    // typ. -2..+12
//     antenna_factor_db_per_m:   number?,   // overrides the 107 constant
//     cable_loss_db:             number,
//     lna_gain_db:               number,
//     sensitivity_floor_dbm:     number?,   // for SNR / "below floor" flags
//     last_calibration_date:     iso-date?,
//     calibration_method:        string?,   // "lab-attenuator" | "field-substitution" | etc.
//     traceable:                 bool?,     // NIST-traceable calibration?
//     uncertainty_db:            number?    // 1-sigma calibration uncertainty
//   }
//
// REGULATORY USE
//   §73.314 (FM) / §73.186 (AM) — field-strength measurement
//                                  procedures.  Both require cali-
//                                  brated receivers with documented
//                                  calibration history.
//   OET-69                       — analogous receiver-calibration
//                                  framework for TV.
//
// NO IN-PROCESS GPL DEPENDENCY
//   This module is pure math + the existing fcc/index.mjs curves.
//   No external sidecars, no GPL'd libraries.

import { fccFieldDbuAtDistance, fccAmFieldMvmAtDistance } from '../engine/curves/fcc/index.mjs';
import { karneyInverse } from '../engine/geometry/wgs84.js';

const DEFAULT_FLOOR_DBM = -120;
const POWER_TO_FIELD_DB = 107;     // dBm→dBu conversion in 50Ω matched antenna

// ---------------------------------------------------------------------------
// Calibration extraction
// ---------------------------------------------------------------------------

/**
 * Pull calibration metadata from the ZTR rich-station response or
 * from a per-capture record.  Defensive across schema variants:
 * checks every common key spelling at both root and nested paths
 * (.calibration / ._calibration / .receiver / etc.).
 *
 * @param {object} source     rich-station or capture record
 * @returns {object} calibration block (always with `calibrated` flag)
 */
export function extractCalibration(source){
  if (!source || typeof source !== 'object'){
    return defaultCalibration('no source supplied');
  }
  // Probe every plausible sub-object location.
  const probes = [
    source,
    source.calibration,  source._calibration,
    source.receiver,     source._receiver,
    source.sdr,          source._sdr,
    source.station       // sometimes ZTR nests under .station.calibration
  ].filter(p => p && typeof p === 'object');

  const pick = (...keys) => {
    for (const p of probes) for (const k of keys){
      const v = p[k];
      if (v !== undefined && v !== null && v !== '') return v;
    }
    return null;
  };
  const num = (v) => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const bool = (v) => v === true || v === 'true' || v === 1;

  const cal = {
    calibrated:               bool(pick('calibrated', 'is_calibrated', 'cal_applied')),
    antenna_gain_dbi:         num(pick('antenna_gain_dbi', 'antenna_gain', 'ant_gain_dbi', 'gain_dbi')),
    antenna_factor_db_per_m:  num(pick('antenna_factor_db_per_m', 'antenna_factor', 'AF_db_per_m')),
    cable_loss_db:            num(pick('cable_loss_db', 'cable_loss', 'feedline_loss_db')),
    lna_gain_db:              num(pick('lna_gain_db', 'lna_gain', 'preamp_gain_db')),
    sensitivity_floor_dbm:    num(pick('sensitivity_floor_dbm', 'noise_floor_dbm', 'mds_dbm')),
    last_calibration_date:    pick('last_calibration_date', 'cal_date', 'calibrated_at'),
    calibration_method:       pick('calibration_method', 'cal_method'),
    traceable:                bool(pick('traceable', 'nist_traceable')),
    uncertainty_db:           num(pick('uncertainty_db', 'cal_uncertainty_db'))
  };

  // Sanity-fill missing pieces with conservative defaults so the
  // chain math doesn't crash, but DON'T flip calibrated:true unless
  // the source said so.
  cal.cable_loss_db    = cal.cable_loss_db    ?? 0;
  cal.lna_gain_db      = cal.lna_gain_db      ?? 0;
  cal.antenna_gain_dbi = cal.antenna_gain_dbi ?? 0;
  cal.sensitivity_floor_dbm = cal.sensitivity_floor_dbm ?? DEFAULT_FLOOR_DBM;
  cal.has_minimum_chain = cal.antenna_gain_dbi != null
                       && cal.cable_loss_db    != null
                       && cal.lna_gain_db      != null;
  return cal;
}

function defaultCalibration(reason){
  return {
    calibrated: false,
    has_minimum_chain: false,
    antenna_gain_dbi:  0,
    antenna_factor_db_per_m: null,
    cable_loss_db:     0,
    lna_gain_db:       0,
    sensitivity_floor_dbm: DEFAULT_FLOOR_DBM,
    last_calibration_date: null,
    calibration_method:    null,
    traceable:             false,
    uncertainty_db:        null,
    reason
  };
}

// ---------------------------------------------------------------------------
// Apply calibration to a single capture
// ---------------------------------------------------------------------------

/**
 * Convert a raw capture's RSSI (or other power measurement) to
 * E-field strength in dBu using the calibration chain.  When the
 * calibration chain doesn't have antenna_factor_db_per_m, falls
 * back to the standard 107 dB matched-antenna conversion factor.
 *
 * @param {object} capture       { rssi_dbm? | signal_dbm? | field_dbu? | field_mvm? }
 * @param {object} calibration   from extractCalibration()
 * @returns {{ field_dBu: number|null, source: string, ... }}
 */
export function applyCalibration(capture, calibration){
  if (!capture || typeof capture !== 'object'){
    return { field_dBu: null, source: 'invalid_capture', error: 'no capture' };
  }
  // Direct field-strength reading wins (no math needed).
  if (Number.isFinite(Number(capture.field_dBu ?? capture.dbu))){
    return {
      field_dBu: Number(capture.field_dBu ?? capture.dbu),
      source:    'direct_field_strength_reading',
      calibration_applied: !!calibration?.calibrated
    };
  }
  if (Number.isFinite(Number(capture.field_mvm ?? capture.mvm))){
    // mV/m → dBu = 20·log10(mV/m × 1000)  i.e. µV/m → dBu
    const mvm = Number(capture.field_mvm ?? capture.mvm);
    return {
      field_dBu: 20 * Math.log10(Math.max(mvm * 1000, 1e-9)),
      source:    'direct_field_strength_reading_mvm',
      calibration_applied: !!calibration?.calibrated
    };
  }
  // Otherwise convert from RSSI / signal power via the chain.
  const rssi_dbm = Number(capture.rssi_dbm ?? capture.signal_dbm ?? capture.power_dbm);
  if (!Number.isFinite(rssi_dbm)){
    return {
      field_dBu: null,
      source:    'no_signal_reading',
      error:     'capture has no rssi_dbm / signal_dbm / power_dbm / field_dBu / field_mvm'
    };
  }
  const cal = calibration || defaultCalibration('no calibration');
  const conv = Number.isFinite(cal.antenna_factor_db_per_m)
                 ? cal.antenna_factor_db_per_m
                 : POWER_TO_FIELD_DB;
  const field_dBu = rssi_dbm
                  - (cal.lna_gain_db || 0)
                  - (cal.antenna_gain_dbi || 0)
                  + (cal.cable_loss_db || 0)
                  + conv;
  return {
    field_dBu: Number(field_dBu.toFixed(2)),
    source:    'rssi_to_field_chain',
    calibration_applied: !!cal.calibrated,
    chain: {
      rssi_dbm:                Number(rssi_dbm.toFixed(2)),
      lna_gain_db:             cal.lna_gain_db,
      antenna_gain_dbi:        cal.antenna_gain_dbi,
      cable_loss_db:           cal.cable_loss_db,
      conversion_factor_db:    conv,
      conversion_basis:        Number.isFinite(cal.antenna_factor_db_per_m)
                                  ? 'antenna_factor_db_per_m (per-antenna)'
                                  : `${POWER_TO_FIELD_DB} dB (50Ω matched-antenna default)`
    }
  };
}

// ---------------------------------------------------------------------------
// Predicted-vs-measured residual table
// ---------------------------------------------------------------------------

/**
 * Compute the predicted Genoa field at a receiver lat/lon for one
 * capture, given the transmitter's parameters.  Uses fccFieldDbuAtDistance
 * (FM/LPFM/FX) or fccAmFieldMvmAtDistance (AM) via the vendored FCC engine.
 *
 * @param {object} args
 * @param {object} args.tx              { lat, lon, haat_m, erp_kw, frequency, service }
 * @param {object} args.capture         { lat, lon, frequency_khz | frequency_mhz, ground_sigma_msm? }
 * @returns {{ predicted_dBu, distance_km, mode, source }}
 */
export function predictedFieldAtCapture({ tx, capture }){
  const tx_lat = Number(tx.lat),  tx_lon = Number(tx.lon);
  const rx_lat = Number(capture.lat ?? capture.latitude);
  const rx_lon = Number(capture.lon ?? capture.longitude);
  if (![tx_lat, tx_lon, rx_lat, rx_lon].every(Number.isFinite)){
    return { predicted_dBu: null, distance_km: null, source: 'missing_coords' };
  }
  const distance_km = karneyInverse(tx_lat, tx_lon, rx_lat, rx_lon).distance_km;
  if (!Number.isFinite(distance_km) || distance_km <= 0){
    return { predicted_dBu: null, distance_km, source: 'invalid_distance' };
  }
  const service = String(tx.service || '').toUpperCase();
  if (service === 'AM'){
    try {
      // fccAmFieldMvmAtDistance returns a bare number in mV/m (not an
      // object).  Convert to dBu via E_dBu = 20·log10(E_µV/m).
      const mvm = fccAmFieldMvmAtDistance({
        frequency_khz:     Number(tx.frequency ?? tx.frequency_khz),
        distance_km,
        erp_kw:            Number(tx.erp_kw),
        // The AM curve fn expects `conductivity_msm`; accept legacy
        // `ground_sigma_msm` / `ground_sigma_mS_m` keys off the
        // tx / capture so callers don't have to guess.
        conductivity_msm:  Number(capture.ground_sigma_msm ?? capture.conductivity_msm
                                  ?? tx.ground_sigma_mS_m  ?? tx.ground_sigma_msm
                                  ?? tx.conductivity_msm)  || 8
      });
      const e_mvm = Number(mvm);
      if (!Number.isFinite(e_mvm) || e_mvm <= 0){
        return { predicted_dBu: null, distance_km,
                 source: 'fcc_am_failed', error: `non-positive field ${mvm}` };
      }
      return {
        predicted_dBu: Number((20 * Math.log10(e_mvm * 1000)).toFixed(2)),
        predicted_mvm: e_mvm,
        distance_km,
        mode:          'AM groundwave (gwave.js)',
        source:        'fcc-canonical'
      };
    } catch (e){
      return { predicted_dBu: null, distance_km, source: 'fcc_am_failed', error: String(e.message) };
    }
  }
  // FM / LPFM / FX — F(50,50) at the receiver location.
  try {
    const r = fccFieldDbuAtDistance({
      haat_m:        Number(tx.haat_m),
      distance_km,
      erp_kw:        Number(tx.erp_kw),
      mode:          '50,50',
      frequency_mhz: Number(tx.frequency ?? tx.frequency_mhz)
    });
    return {
      predicted_dBu: r.field_dBu,
      distance_km,
      mode:          'FM F(50,50)',
      source:        'fcc-canonical'
    };
  } catch (e){
    return { predicted_dBu: null, distance_km, source: 'fcc_fm_failed', error: String(e.message) };
  }
}

/**
 * Build a predicted-vs-measured residual table over a list of
 * captures.  Each row carries the calibration chain + Genoa
 * prediction + delta in dB.
 *
 * @param {object} args
 * @param {object} args.tx                    transmitter params (see predictedFieldAtCapture)
 * @param {object} args.calibration           result of extractCalibration()
 * @param {Array<object>} args.captures       SDR records with rssi_dbm or field_dBu
 * @returns {{
 *   n_total, n_evaluated, n_calibrated, n_uncalibrated,
 *   rms_residual_dB, mean_residual_dB,
 *   n_above_predicted, n_below_predicted,
 *   rows: [...],
 *   calibration, provenance
 * }}
 */
export function computeResidualTable({ tx, calibration, captures }){
  const cal = calibration || defaultCalibration('no calibration supplied');
  const rows = [];
  for (const capture of captures || []){
    const cal_result = applyCalibration(capture, cal);
    const measured_dBu = cal_result.field_dBu;
    const pred = predictedFieldAtCapture({ tx, capture });
    const delta_dB = (Number.isFinite(measured_dBu) && Number.isFinite(pred.predicted_dBu))
      ? Number((measured_dBu - pred.predicted_dBu).toFixed(2))
      : null;
    rows.push({
      capture_id:     capture.id ?? capture.capture_id ?? null,
      lat:            capture.lat ?? capture.latitude ?? null,
      lon:            capture.lon ?? capture.longitude ?? null,
      distance_km:    pred.distance_km,
      measured_dBu,
      predicted_dBu:  pred.predicted_dBu,
      delta_dB,
      calibration_applied: cal_result.calibration_applied || false,
      conversion_basis:    cal_result.chain?.conversion_basis ?? cal_result.source,
      mode:                pred.mode,
      error: cal_result.error || pred.error || null
    });
  }
  const evaluated = rows.filter(r => Number.isFinite(r.delta_dB));
  const n_above = evaluated.filter(r => r.delta_dB > 0).length;
  const n_below = evaluated.filter(r => r.delta_dB < 0).length;
  const sum_sq  = evaluated.reduce((a, r) => a + r.delta_dB * r.delta_dB, 0);
  const sum     = evaluated.reduce((a, r) => a + r.delta_dB, 0);
  return {
    n_total:           rows.length,
    n_evaluated:       evaluated.length,
    n_calibrated:      rows.filter(r => r.calibration_applied).length,
    n_uncalibrated:    rows.filter(r => !r.calibration_applied).length,
    rms_residual_dB:   evaluated.length ? Number(Math.sqrt(sum_sq / evaluated.length).toFixed(2)) : null,
    mean_residual_dB:  evaluated.length ? Number((sum / evaluated.length).toFixed(2)) : null,
    n_above_predicted: n_above,
    n_below_predicted: n_below,
    rows,
    calibration:       cal,
    provenance: {
      regulation:    String(tx.service || '').toUpperCase() === 'AM' ? '47 CFR §73.186' : '47 CFR §73.314',
      reference:     'OET Bulletin 69 (receiver-calibration framework)',
      conversion:    Number.isFinite(cal.antenna_factor_db_per_m)
                       ? 'per-antenna AF (dB/m)'
                       : `${POWER_TO_FIELD_DB} dB matched-antenna default`,
      engine:        'Genoa vendored FCC tvfm_curves.js / gwave.js',
      license_basis: '17 USC §105'
    }
  };
}

export const SDR_CALIBRATION_PROVENANCE = Object.freeze({
  module:     'src/evidence/sdrCalibration.js',
  regulation: '47 CFR §73.314 (FM) / §73.186 (AM) — field-strength measurement',
  reference:  'OET Bulletin 69 (receiver calibration); standard chain  E_dBu = RSSI_dBm − LNA − ant_gain + cable_loss + 107',
  modeled: [
    'Calibration metadata extraction from rich-station response (defensive against schema variants)',
    'RSSI→field conversion via per-antenna AF or 107 dB default',
    'Direct field-strength readings (dBu / mV/m) when the capture carries them',
    'Predicted field at each capture lat/lon via Genoa\'s vendored FCC engine',
    'Residual table with rms / mean / above/below predicted / calibration ratio'
  ],
  not_modeled: [
    'Frequency-dependent antenna response (uses a single AF for the band)',
    'Polarization mismatch losses (assumed matched)',
    'Multipath fading per capture (conservatively reported as raw delta_dB)',
    'Time-of-day skywave for AM (assumes daytime groundwave)',
    'Time-averaged exposure for §1.1310 / OET-65'
  ],
  license_basis: '17 USC §105 (regulation citations); module implementation original'
});
