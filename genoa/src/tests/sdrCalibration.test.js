// SDR calibration + predicted-vs-measured residual table tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCalibration,
  applyCalibration,
  predictedFieldAtCapture,
  computeResidualTable,
  SDR_CALIBRATION_PROVENANCE
} from '../evidence/sdrCalibration.js';

/* ---------- extractCalibration ---------- */

test('extractCalibration: missing source → calibrated:false with reason', () => {
  const c = extractCalibration(null);
  assert.equal(c.calibrated, false);
  assert.match(c.reason, /no source/);
});

test('extractCalibration: full chain at root → calibrated=true + has_minimum_chain=true', () => {
  const c = extractCalibration({
    calibrated:        true,
    antenna_gain_dbi:  3,
    cable_loss_db:     2,
    lna_gain_db:       20,
    sensitivity_floor_dbm: -110,
    last_calibration_date: '2025-12-01',
    calibration_method:    'lab-attenuator',
    traceable: true,
    uncertainty_db: 1.5
  });
  assert.equal(c.calibrated, true);
  assert.equal(c.has_minimum_chain, true);
  assert.equal(c.antenna_gain_dbi, 3);
  assert.equal(c.cable_loss_db, 2);
  assert.equal(c.lna_gain_db, 20);
  assert.equal(c.traceable, true);
  assert.equal(c.uncertainty_db, 1.5);
});

test('extractCalibration: nested under .calibration / .receiver / .sdr', () => {
  const c1 = extractCalibration({ calibration: { calibrated: true, antenna_gain_dbi: 5, cable_loss_db: 1, lna_gain_db: 18 } });
  assert.equal(c1.calibrated, true);
  assert.equal(c1.antenna_gain_dbi, 5);

  const c2 = extractCalibration({ receiver: { calibrated: true, gain_dbi: 4 } });
  assert.equal(c2.calibrated, true);
  assert.equal(c2.antenna_gain_dbi, 4);

  const c3 = extractCalibration({ sdr: { is_calibrated: true, ant_gain_dbi: 6 } });
  assert.equal(c3.calibrated, true);
  assert.equal(c3.antenna_gain_dbi, 6);
});

test('extractCalibration: schema variants — antenna_factor_db_per_m vs antenna_gain_dbi', () => {
  const c = extractCalibration({ calibrated: true, antenna_factor_db_per_m: 12 });
  assert.equal(c.antenna_factor_db_per_m, 12);
});

test('extractCalibration: no calibrated flag → calibrated:false even with values', () => {
  const c = extractCalibration({ antenna_gain_dbi: 3 });
  assert.equal(c.calibrated, false);
});

/* ---------- applyCalibration ---------- */

test('applyCalibration: direct field_dBu reading short-circuits the chain', () => {
  const r = applyCalibration({ field_dBu: 60.5 }, { calibrated: true });
  assert.equal(r.field_dBu, 60.5);
  assert.equal(r.source, 'direct_field_strength_reading');
});

test('applyCalibration: direct mV/m reading converts to dBu', () => {
  const r = applyCalibration({ field_mvm: 1.0 }, null);   // 1 mV/m = 60 dBu
  assert.ok(Math.abs(r.field_dBu - 60) < 0.01);
});

test('applyCalibration: RSSI to field via chain (default 107 conversion)', () => {
  // RSSI = -50 dBm, no LNA, 0 dBi antenna, 0 dB cable
  // E_dBu = -50 - 0 - 0 + 0 + 107 = 57 dBu
  const r = applyCalibration({ rssi_dbm: -50 }, { calibrated: true });
  assert.equal(r.field_dBu, 57);
  assert.match(r.chain.conversion_basis, /107 dB/);
});

test('applyCalibration: RSSI to field via per-antenna factor', () => {
  // RSSI = -50 dBm, LNA = 20, antenna_gain = 0 dBi, cable_loss = 2,
  // antenna_factor_db_per_m = 12
  // E_dBu = -50 - 20 - 0 + 2 + 12 = -56 dBu  (a quiet, deep-rural reading)
  const r = applyCalibration({ rssi_dbm: -50 },
    { calibrated: true, antenna_gain_dbi: 0, cable_loss_db: 2,
      lna_gain_db: 20, antenna_factor_db_per_m: 12 });
  assert.equal(r.field_dBu, -56);
  assert.match(r.chain.conversion_basis, /per-antenna/);
});

test('applyCalibration: capture with no signal reading returns no_signal_reading', () => {
  const r = applyCalibration({ id: 'x' }, { calibrated: true });
  assert.equal(r.field_dBu, null);
  assert.equal(r.source, 'no_signal_reading');
});

/* ---------- predictedFieldAtCapture ---------- */

test('predictedFieldAtCapture: FM at known geometry returns finite predicted dBu', () => {
  // KSLX-FM analog: 6 kW, 100 m HAAT, capture 50 km away on 100.7 MHz
  const r = predictedFieldAtCapture({
    tx: { lat: 33.45, lon: -112.07, haat_m: 100, erp_kw: 6, frequency: 100.7, service: 'FM' },
    capture: { lat: 33.45, lon: -111.5 }    // ~53 km east
  });
  assert.ok(Number.isFinite(r.predicted_dBu));
  assert.ok(r.distance_km > 40 && r.distance_km < 80);
  assert.equal(r.mode, 'FM F(50,50)');
});

test('predictedFieldAtCapture: missing coords returns missing_coords', () => {
  const r = predictedFieldAtCapture({
    tx: { lat: 33, lon: -112, haat_m: 100, erp_kw: 1, frequency: 100.7, service: 'FM' },
    capture: { /* lat/lon absent */ }
  });
  assert.equal(r.predicted_dBu, null);
  assert.equal(r.source, 'missing_coords');
});

test('predictedFieldAtCapture: AM service uses gwave path', () => {
  const r = predictedFieldAtCapture({
    tx: { lat: 33.45, lon: -112.07, erp_kw: 1, frequency: 1240, service: 'AM' },
    capture: { lat: 33.5, lon: -112.0, ground_sigma_msm: 8 }
  });
  // gwave returns either field_dBu or field_mvm; predictedFieldAtCapture
  // normalizes to dBu either way.
  assert.equal(r.mode, 'AM groundwave (gwave.js)');
  assert.ok(Number.isFinite(r.predicted_dBu) || r.error);
});

/* ---------- computeResidualTable ---------- */

test('computeResidualTable: empty captures → n_total=0', () => {
  const r = computeResidualTable({
    tx: { lat: 33, lon: -112, haat_m: 100, erp_kw: 1, frequency: 100.7, service: 'FM' },
    calibration: { calibrated: true, antenna_gain_dbi: 0, cable_loss_db: 0, lna_gain_db: 0 },
    captures: []
  });
  assert.equal(r.n_total, 0);
  assert.equal(r.rms_residual_dB, null);
});

test('computeResidualTable: calibrated captures + matching prediction → small RMS', () => {
  const tx = { lat: 33.45, lon: -112.07, haat_m: 100, erp_kw: 6, frequency: 100.7, service: 'FM' };
  // Simulate captures whose direct field_dBu reading happens to
  // equal Genoa's prediction (zero residual case).  Since we don't
  // know the prediction in advance, compute it first then craft
  // captures that match.
  const probe = predictedFieldAtCapture({
    tx, capture: { lat: 33.5, lon: -111.6 }
  });
  const captures = [
    { lat: 33.5, lon: -111.6, field_dBu: probe.predicted_dBu }
  ];
  const r = computeResidualTable({
    tx,
    calibration: { calibrated: true, antenna_gain_dbi: 0, cable_loss_db: 0, lna_gain_db: 0, has_minimum_chain: true },
    captures
  });
  assert.equal(r.n_total, 1);
  assert.equal(r.n_evaluated, 1);
  assert.ok(Math.abs(r.rms_residual_dB) < 0.01);
});

test('computeResidualTable: RSSI captures with no calibration → uncalibrated, table populated', () => {
  const tx = { lat: 33.45, lon: -112.07, haat_m: 100, erp_kw: 6, frequency: 100.7, service: 'FM' };
  const captures = [
    { lat: 33.5, lon: -111.6, rssi_dbm: -50 },
    { lat: 33.5, lon: -111.5, rssi_dbm: -55 }
  ];
  const r = computeResidualTable({
    tx, calibration: { calibrated: false, antenna_gain_dbi: 0, cable_loss_db: 0, lna_gain_db: 0 }, captures
  });
  assert.equal(r.n_total, 2);
  assert.equal(r.n_calibrated, 0);
  assert.equal(r.n_uncalibrated, 2);
  assert.ok(Number.isFinite(r.rms_residual_dB));
});

test('computeResidualTable: counts above/below predicted correctly', () => {
  const tx = { lat: 33.45, lon: -112.07, haat_m: 100, erp_kw: 6, frequency: 100.7, service: 'FM' };
  const probe = predictedFieldAtCapture({ tx, capture: { lat: 33.5, lon: -111.6 } });
  const captures = [
    { lat: 33.5, lon: -111.6, field_dBu: probe.predicted_dBu + 5 },   // above
    { lat: 33.5, lon: -111.6, field_dBu: probe.predicted_dBu - 3 }    // below
  ];
  const r = computeResidualTable({ tx,
    calibration: { calibrated: true, antenna_gain_dbi: 0, cable_loss_db: 0, lna_gain_db: 0, has_minimum_chain: true },
    captures });
  assert.equal(r.n_above_predicted, 1);
  assert.equal(r.n_below_predicted, 1);
  assert.ok(r.rms_residual_dB > 3);     // sqrt((5²+3²)/2) ≈ 4.12
});

/* ---------- provenance ---------- */

test('SDR_CALIBRATION_PROVENANCE names §73.314 + OET-69 + license basis', () => {
  assert.match(SDR_CALIBRATION_PROVENANCE.regulation, /73\.314/);
  assert.match(SDR_CALIBRATION_PROVENANCE.regulation, /73\.186/);
  assert.match(SDR_CALIBRATION_PROVENANCE.reference, /OET Bulletin 69/);
  assert.match(SDR_CALIBRATION_PROVENANCE.license_basis, /17 USC §105/);
});
