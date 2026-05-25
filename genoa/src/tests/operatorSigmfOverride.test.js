// Tests for the operator-supplied SigMF override path
// (evidence/measurements/operatorOverride.js).

import test from 'node:test';
import assert from 'node:assert/strict';

import { loadOperatorSigmfOverride }
  from '../evidence/measurements/operatorOverride.js';
import { buildSigmfFromKiwiCapture }
  from '../evidence/measurements/buildSigmfFromKiwiCapture.js';
import { computeResidualTable, extractCalibration }
  from '../evidence/sdrCalibration.js';

const KRDM = {
  callsign:       'KRDM',
  service:        'AM',
  frequency_khz:  1240,
  tx_lat:         44.272,
  tx_lon:         -121.174,
  rx_lat:         44.05,
  rx_lon:         -121.31,
  captured_at:    '2026-05-10T19:35:37Z',
  duration_seconds: 30,
  rssi_dbm:       -73.5,
  antenna_gain_dbi: 0,
  cable_loss_db:    1,
  lna_gain_db:     20,
  kiwi_host:      'kk6pr.ddns.net:8077',
  ztr_capture_id: 71268,
  ztr_station_id: 100074
};

test('returns null when neither inline nor url is supplied', async () => {
  const r = await loadOperatorSigmfOverride({});
  assert.equal(r, null);
});

test('inline path: parses the SigMF blob and returns sdrResp shape', async () => {
  const meta = buildSigmfFromKiwiCapture(KRDM);
  const r    = await loadOperatorSigmfOverride({ inline: meta });
  assert.equal(r.available, true);
  assert.equal(r.sdrResp.available, true);
  assert.equal(r.sdrResp.source, 'inputs.sigmf_meta');
  assert.equal(r.sdrResp.calibrated, true);
  assert.equal(r.sdrResp.n_records, 1);
  assert.equal(r.sdrResp.captures_field, 'inputs.sigmf_meta');
  // The records[] should be the raw SigMF captures[] (with field_dBu
  // mirror) so sdrCalibration consumes it without translation.
  assert.equal(r.sdrResp.records[0].field_dBu, 14.5);
  assert.equal(r.sdrResp.records[0].rssi_dbm, -73.5);
  assert.equal(r.sdrResp.records[0].lat, 44.05);
  // sigmf_meta hung off for the evidence block.
  assert.equal(r.sdrResp.sigmf_meta.calibrated, true);
});

test('inline path: end-to-end through computeResidualTable', async () => {
  const meta    = buildSigmfFromKiwiCapture(KRDM);
  const r       = await loadOperatorSigmfOverride({ inline: meta });
  const cal     = extractCalibration({
    calibrated:       true,
    antenna_gain_dbi: 0,
    cable_loss_db:    1,
    lna_gain_db:      20
  });
  const residuals = computeResidualTable({
    tx:          { ...meta.global['genoa:tx'], erp_kw: 5, ground_sigma_msm: 4 },
    calibration: cal,
    captures:    r.sdrResp.records
  });
  assert.equal(residuals.n_evaluated, 1);
  assert.equal(residuals.rows[0].measured_dBu, 14.5);
  assert.ok(Number.isFinite(residuals.rows[0].predicted_dBu));
  assert.ok(Number.isFinite(residuals.rows[0].delta_dB));
  assert.match(residuals.rows[0].mode, /AM groundwave/);
});

test('inline path: empty payload (no captures) reports available:false', async () => {
  const r = await loadOperatorSigmfOverride({ inline: { not: 'a sigmf doc' } });
  // parseSigmfMeta is permissive — a blob with no captures[] still
  // "parses" but carries no measurement evidence.  We treat zero
  // records as not-available (no point attaching empty evidence).
  assert.equal(r.available, false);
  assert.match(r.error, /0 records/);
});

test('url path: rejects non-string url', async () => {
  const r = await loadOperatorSigmfOverride({ url: 12345 });
  assert.equal(r.available, false);
  assert.match(r.error, /must be a string/);
});

test('url path: HTTP non-2xx is reported, not thrown', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const r = await loadOperatorSigmfOverride({
    url:       'https://example.org/missing.sigmf-meta.json',
    fetchImpl
  });
  assert.equal(r.available, false);
  assert.match(r.error, /HTTP 404/);
});

test('url path: fetch throws is reported, not propagated', async () => {
  const fetchImpl = async () => { throw new Error('ECONNREFUSED'); };
  const r = await loadOperatorSigmfOverride({
    url:       'https://example.org/x.sigmf-meta.json',
    fetchImpl
  });
  assert.equal(r.available, false);
  assert.match(r.error, /ECONNREFUSED/);
});

test('url path: ZTR app URL with ZTR_API_TOKEN attaches a Bearer header', async () => {
  let capturedHeaders = null;
  const meta = buildSigmfFromKiwiCapture(KRDM);
  const fetchImpl = async (_url, opts) => {
    capturedHeaders = opts.headers;
    return { ok: true, status: 200, json: async () => meta };
  };
  const prev = process.env.ZTR_API_TOKEN;
  process.env.ZTR_API_TOKEN = 'test-token-xyz';
  try {
    const r = await loadOperatorSigmfOverride({
      url:       'https://zerotrustradio-app-vvhi8.ondigitalocean.app/api/sdr/captures/71268/audio',
      fetchImpl
    });
    assert.equal(r.available, true);
    assert.equal(capturedHeaders.authorization, 'Bearer test-token-xyz');
  } finally {
    if (prev === undefined) delete process.env.ZTR_API_TOKEN;
    else process.env.ZTR_API_TOKEN = prev;
  }
});

test('url path: non-ZTR URL does NOT leak the token', async () => {
  let capturedHeaders = null;
  const meta = buildSigmfFromKiwiCapture(KRDM);
  const fetchImpl = async (_url, opts) => {
    capturedHeaders = opts.headers;
    return { ok: true, status: 200, json: async () => meta };
  };
  const prev = process.env.ZTR_API_TOKEN;
  process.env.ZTR_API_TOKEN = 'test-token-xyz';
  try {
    const r = await loadOperatorSigmfOverride({
      url:       'https://elsewhere.example/x.sigmf-meta.json',
      fetchImpl
    });
    assert.equal(r.available, true);
    assert.equal(capturedHeaders.authorization, undefined);
  } finally {
    if (prev === undefined) delete process.env.ZTR_API_TOKEN;
    else process.env.ZTR_API_TOKEN = prev;
  }
});

test('inline takes precedence when both inline and url are supplied', async () => {
  const meta = buildSigmfFromKiwiCapture(KRDM);
  let fetchCalled = false;
  const fetchImpl = async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; };
  const r = await loadOperatorSigmfOverride({
    inline:    meta,
    url:       'https://example.org/should-not-fetch.json',
    fetchImpl
  });
  assert.equal(r.available, true);
  assert.equal(fetchCalled, false);
  assert.equal(r.sdrResp.captures_field, 'inputs.sigmf_meta');
});
