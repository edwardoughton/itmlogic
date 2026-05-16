// buildSigmfFromKiwiCapture: unit tests.
//
// Covers:
//   - End-to-end: KRDM-style AM input → sigmf-meta JSON →
//     parseSigmfMeta → calibrated:true + measured_dBu populated.
//   - The dBu calibration chain matches sdrCalibration.applyCalibration
//     exactly (so cross-validation is consistent).
//   - Required-field validation.
//   - Direct-override paths (field_dBu, field_mvm).

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSigmfFromKiwiCapture, ztrCaptureAudioUrl, ZTR_APP_URL_DEFAULT }
  from '../evidence/measurements/buildSigmfFromKiwiCapture.js';
import { parseSigmfMeta }             from '../evidence/measurements/sigmf.js';
import { applyCalibration, extractCalibration } from '../evidence/sdrCalibration.js';

// ---------- KRDM 1240 kHz Redmond OR fixture ----------

const KRDM = {
  callsign:       'KRDM',
  service:        'AM',
  frequency_khz:  1240,
  tx_lat:         44.272,
  tx_lon:         -121.174,
  rx_lat:         44.05,
  rx_lon:         -121.31,
  captured_at:    '2026-05-10T17:30:00Z',
  duration_seconds: 60,
  rssi_dbm:       -73.5,
  antenna_gain_dbi: 0,
  cable_loss_db:    1,
  lna_gain_db:     20,
  kiwi_host:      'kiwisdr.example.org:8073',
  capture_proxy_url: 'wss://proxy.example.org/relay'
};

test('builds a sigmf-meta JSON that parseSigmfMeta accepts as calibrated', () => {
  const meta = buildSigmfFromKiwiCapture(KRDM);
  const ev   = parseSigmfMeta(meta, { source: 'unit-test' });
  assert.equal(ev.available, true);
  assert.equal(ev.calibrated, true);
  assert.equal(ev.n_records, 1);
  assert.equal(ev.records[0].lat, KRDM.rx_lat);
  assert.equal(ev.records[0].lon, KRDM.rx_lon);
  assert.equal(ev.records[0].timestamp, KRDM.captured_at);
  assert.ok(Number.isFinite(ev.records[0].measured_dBu));
});

test('field_dBu matches sdrCalibration.applyCalibration to ≤0.01 dB', () => {
  const meta = buildSigmfFromKiwiCapture(KRDM);
  const cap  = meta.captures[0];

  // Reconstruct via the canonical chain in sdrCalibration.js so a
  // future change there can't silently desync this builder.
  const cal       = extractCalibration({
    calibrated: true,
    antenna_gain_dbi: KRDM.antenna_gain_dbi,
    cable_loss_db:    KRDM.cable_loss_db,
    lna_gain_db:      KRDM.lna_gain_db
  });
  const expected  = applyCalibration({ rssi_dbm: KRDM.rssi_dbm }, cal);
  assert.ok(Math.abs(cap.field_dBu - expected.field_dBu) < 0.01,
    `builder dBu ${cap.field_dBu} vs sdrCalibration ${expected.field_dBu}`);
});

test('parseSigmfMeta extracts measured_dBu via the annotation label regex', () => {
  const meta   = buildSigmfFromKiwiCapture(KRDM);
  const ev     = parseSigmfMeta(meta, { source: 'unit-test' });
  // -73.5 dBm  − 20 (LNA) − 0 (ant gain) + 1 (cable) + 107 = 14.5 dBu
  assert.equal(ev.records[0].measured_dBu, 14.5);
});

test('throws if a required field is missing', () => {
  assert.throws(() => buildSigmfFromKiwiCapture({ ...KRDM, callsign: undefined }),
                /missing required fields.*callsign/);
  assert.throws(() => buildSigmfFromKiwiCapture({ ...KRDM, frequency_khz: 'not-a-number' }),
                /missing required fields.*frequency_khz/);
  assert.throws(() => buildSigmfFromKiwiCapture({ ...KRDM, captured_at: null }),
                /missing required fields.*captured_at/);
});

test('throws if no signal reading is supplied', () => {
  const noSignal = { ...KRDM };
  delete noSignal.rssi_dbm;
  assert.throws(() => buildSigmfFromKiwiCapture(noSignal),
                /must supply rssi_dbm OR field_dBu_override OR field_mvm_override/);
});

test('field_dBu_override bypasses the chain and is preserved verbatim', () => {
  const meta = buildSigmfFromKiwiCapture({ ...KRDM, rssi_dbm: undefined, field_dBu_override: 42.7 });
  assert.equal(meta.captures[0].field_dBu, 42.7);
  assert.match(meta.captures[0].field_basis, /direct_field_strength_reading$/);
});

test('field_mvm_override converts via 20·log10(mV/m × 1000)', () => {
  // 1 mV/m  → 60 dBu
  const meta = buildSigmfFromKiwiCapture({ ...KRDM, rssi_dbm: undefined, field_mvm_override: 1 });
  assert.ok(Math.abs(meta.captures[0].field_dBu - 60) < 0.01);
});

test('antenna_factor_db_per_m overrides the 107 dB default', () => {
  const meta = buildSigmfFromKiwiCapture({ ...KRDM, antenna_factor_db_per_m: 100 });
  // chain: -73.5 - 20 - 0 + 1 + 100 = 7.5
  assert.equal(meta.captures[0].field_dBu, 7.5);
  assert.match(meta.captures[0].field_basis, /antenna_factor_db_per_m/);
  assert.equal(meta.global['genoa:calibration_dB'], 100);
});

test('AM regulatory provenance is attached', () => {
  const meta = buildSigmfFromKiwiCapture(KRDM);
  assert.equal(meta.global['genoa:provenance'].regulation, '47 CFR §73.186');
  assert.match(meta.global['genoa:provenance'].chain, /RSSI_dBm/);
});

test('FM stations get §73.314 in provenance', () => {
  const meta = buildSigmfFromKiwiCapture({ ...KRDM, service: 'FM', frequency_khz: 100100 });
  assert.equal(meta.global['genoa:provenance'].regulation, '47 CFR §73.314');
});

test('geolocation is GeoJSON [lon, lat] not [lat, lon]', () => {
  const meta = buildSigmfFromKiwiCapture(KRDM);
  const coords = meta.captures[0]['core:geolocation'].coordinates;
  assert.equal(coords[0], KRDM.rx_lon);
  assert.equal(coords[1], KRDM.rx_lat);
});

// ---------- ZTR app capture-audio URL ----------

test('ztrCaptureAudioUrl returns the canonical /api/sdr/captures/<id>/audio URL', () => {
  assert.equal(ztrCaptureAudioUrl(71268),
    'https://zerotrustradio-app-vvhi8.ondigitalocean.app/api/sdr/captures/71268/audio');
  assert.equal(ZTR_APP_URL_DEFAULT,
    'https://zerotrustradio-app-vvhi8.ondigitalocean.app');
});

test('ztrCaptureAudioUrl trims trailing slash on the base', () => {
  assert.equal(ztrCaptureAudioUrl(71268, 'https://example.org/'),
    'https://example.org/api/sdr/captures/71268/audio');
});

test('ztrCaptureAudioUrl returns null when capture_id is empty', () => {
  assert.equal(ztrCaptureAudioUrl(null), null);
  assert.equal(ztrCaptureAudioUrl(undefined), null);
  assert.equal(ztrCaptureAudioUrl(''), null);
});

test('ztr_capture_id auto-derives the ZTR app audio_url', () => {
  const meta = buildSigmfFromKiwiCapture({ ...KRDM, ztr_capture_id: 71268, ztr_station_id: 100074 });
  assert.equal(meta.global['genoa:audio_url'],
    'https://zerotrustradio-app-vvhi8.ondigitalocean.app/api/sdr/captures/71268/audio');
  assert.equal(meta.global['genoa:ztr_capture_id'], '71268');
  assert.equal(meta.global['genoa:ztr_station_id'], '100074');
});

test('ztr_app_url overrides the default base for staging / custom domain', () => {
  const meta = buildSigmfFromKiwiCapture({
    ...KRDM,
    ztr_capture_id: 71268,
    ztr_app_url:    'https://staging.zerotrustradio.example'
  });
  assert.equal(meta.global['genoa:audio_url'],
    'https://staging.zerotrustradio.example/api/sdr/captures/71268/audio');
});

test('explicit audio_url overrides the derived ZTR URL', () => {
  const meta = buildSigmfFromKiwiCapture({
    ...KRDM,
    ztr_capture_id: 71268,
    audio_url:      'https://example.org/foo.wav'
  });
  assert.equal(meta.global['genoa:audio_url'], 'https://example.org/foo.wav');
});
