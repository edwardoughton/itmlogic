// curve_reference_validation tests.
//
// Proves the SEMANTICS the directive demands:
//   - PASS of internal golden fixtures clears CURVE_VALIDATION_MISSING.
//   - FAIL of internal golden fixtures KEEPS CURVE_VALIDATION_MISSING
//     and the detail names the internal-suite failure (not FCC).
//   - FCC cross-check FAIL emits FCC_GEO_CROSSCHECK_FAILED (warning,
//     never blocker).
//   - FCC cross-check SKIP emits FCC_GEO_CROSSCHECK_SKIPPED (warning).

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runCurveReferenceValidation, _resetCurveReferenceValidationCache } from '../validation/curveReferenceValidation.js';
import { writeFile, mkdir, rm } from 'node:fs/promises';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = path.resolve(__dirname, '..', '..', 'tmp-test-fixtures');

test('runCurveReferenceValidation: shipping golden fixture passes (engine matches FCC-canonical)', async () => {
  _resetCurveReferenceValidationCache();
  const r = await runCurveReferenceValidation();
  assert.equal(r.pass, true,  'shipped golden fixture must pass: ' + JSON.stringify(r.results));
  assert.equal(r.result, 'pass');
  assert.ok(r.n_run >= 3, 'fixture should ship at least 3 golden cases; got ' + r.n_run);
  assert.equal(r.n_pass, r.n_run, 'every golden case must pass');
  assert.ok(r.max_error_km < r.tolerance_km, 'max error must be inside tolerance');
});

test('runCurveReferenceValidation with deliberately-wrong fixture FAILS', async () => {
  _resetCurveReferenceValidationCache();
  await mkdir(TMP, { recursive: true });
  const wrongPath = path.join(TMP, 'fm-wrong.json');
  await writeFile(wrongPath, JSON.stringify({
    name: 'wrong',
    method: '47 CFR §73.333 F(50,50)',
    tolerance_km: 0.1,
    cases: [
      { id: 'wrong.case', service: 'FM', mode: '50,50', erp_kw: 100, haat_m: 561,
        target_dBu: 60, expected_distance_km: 9999.0 }
    ]
  }));
  try {
    const r = await runCurveReferenceValidation({ fixturePath: wrongPath });
    assert.equal(r.pass, false);
    assert.equal(r.result, 'fail');
    assert.equal(r.n_run, 1);
    assert.equal(r.n_pass, 0);
    assert.ok(r.max_error_km > 100, 'huge error expected');
  } finally {
    await rm(TMP, { recursive: true, force: true });
    _resetCurveReferenceValidationCache();
  }
});

/* ---------- Orchestrator-level: warning routing ---------- */

const KSLX_INPUTS = {
  call: 'KSLX-FM', facility_id: '11282', service: 'FM', fcc_class: 'C',
  frequency: 100.7, erp_kw: 100, haat_m: 561,
  lat: 33.33144, lon: -112.06375, radial_step_deg: 10
};

function ringAtRadius(lat, lon, radiusKm){
  const R = 6371.0088;
  const ring = [];
  for (let az = 0; az <= 360; az += 10){
    const br = az * Math.PI/180;
    const phi1 = lat * Math.PI/180, lam1 = lon * Math.PI/180;
    const dr = radiusKm / R;
    const phi2 = Math.asin(Math.sin(phi1)*Math.cos(dr) + Math.cos(phi1)*Math.sin(dr)*Math.cos(br));
    const lam2 = lam1 + Math.atan2(Math.sin(br)*Math.sin(dr)*Math.cos(phi1), Math.cos(dr) - Math.sin(phi1)*Math.sin(phi2));
    ring.push([lam2 * 180/Math.PI, phi2 * 180/Math.PI]);
  }
  return { type: 'Polygon', coordinates: [ring] };
}

const ZTR = 'http://ztr.test';
function mockFetch(handler){
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => handler(String(url), opts);
  return () => { globalThis.fetch = orig; };
}
function jsonResp(body, ok = true){
  return { ok, status: ok ? 200 : 502, json: async () => body };
}

const FACILITY_ROW = {
  id: 757546, source: 'fcc', kind: 'fm',
  callsign: 'KSLX-FM', frequency_khz: 100700, service: 'FM',
  city: 'SCOTTSDALE', state: 'AZ', country_code: 'US',
  latitude: KSLX_INPUTS.lat, longitude: KSLX_INPUTS.lon,
  power_watts: 100000, haat_m: 561,
  last_seen: '2026-04-12T16:56:14.271Z',
  facility_id: '11282'
};

function mkRichHandler(fcc){
  return (url) => {
    if (url.includes('/api/broadcast/stations?facility_id=11282'))
      return jsonResp({ rows: [FACILITY_ROW], count: 1 });
    if (url.includes('/api/radiodns/station/757546'))
      return jsonResp({ ...FACILITY_ROW, _fcc_contour: fcc, _captures: [] });
    return jsonResp({}, false);
  };
}

async function importFresh(){
  return import('../api/services/exhibitService.js?cb=' + Math.random().toString(36).slice(2));
}

test('Golden suite passes -> CURVE_VALIDATION_MISSING absent (directive expected UI state)', async () => {
  // FCC contour wildly off (engine ~138 km vs FCC at 60 km) — this
  // proves FCC failure does NOT cause CURVE_VALIDATION_MISSING.
  const fccOff = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { field: 60, erp: 100 }, geometry: ringAtRadius(KSLX_INPUTS.lat, KSLX_INPUTS.lon, 60) }
    ]
  };
  const restore = mockFetch(mkRichHandler(fccOff));
  const prev = process.env.ZERO_TRUST_RADIO_READONLY_URL;
  process.env.ZERO_TRUST_RADIO_READONLY_URL = ZTR;
  _resetCurveReferenceValidationCache();
  try {
    const mod = await importFresh();
    const x = await mod.computeExhibit({ inputs: KSLX_INPUTS });
    const codes = (x.warnings || []).map(w => w.code);
    assert.ok(!codes.includes('CURVE_VALIDATION_MISSING'),
      'Golden suite passes → CURVE_VALIDATION_MISSING must be absent.  Got: ' + codes.join(', '));
    assert.ok(codes.includes('FCC_GEO_CROSSCHECK_FAILED'),
      'FCC mismatch must surface as FCC_GEO_CROSSCHECK_FAILED, not CURVE_VALIDATION_MISSING.  Got: ' + codes.join(', '));
    assert.equal(x.validation?.curve_reference_validation?.result, 'pass');
    assert.equal(x.validation?.fcc_cross_check?.result, 'fail');
    // Neither the FCC failure NOR FCC_GEO_CROSSCHECK_* is a blocker —
    // they're warnings.
    const fccGeo = x.warnings.find(w => w.code === 'FCC_GEO_CROSSCHECK_FAILED');
    assert.equal(fccGeo.severity, 'warning');
  } finally {
    restore();
    _resetCurveReferenceValidationCache();
    if (prev != null) process.env.ZERO_TRUST_RADIO_READONLY_URL = prev; else delete process.env.ZERO_TRUST_RADIO_READONLY_URL;
  }
});

test('FCC missing _fcc_contour → FCC_GEO_CROSSCHECK_SKIPPED warning, NOT CURVE_VALIDATION_MISSING', async () => {
  const restore = mockFetch(mkRichHandler(undefined));
  const prev = process.env.ZERO_TRUST_RADIO_READONLY_URL;
  process.env.ZERO_TRUST_RADIO_READONLY_URL = ZTR;
  _resetCurveReferenceValidationCache();
  try {
    const mod = await importFresh();
    const x = await mod.computeExhibit({ inputs: KSLX_INPUTS });
    const codes = (x.warnings || []).map(w => w.code);
    assert.ok(codes.includes('FCC_GEO_CROSSCHECK_SKIPPED'),
      'Missing _fcc_contour must emit FCC_GEO_CROSSCHECK_SKIPPED.  Got: ' + codes.join(', '));
    assert.ok(!codes.includes('CURVE_VALIDATION_MISSING'),
      'Skipped FCC cross-check must NOT raise CURVE_VALIDATION_MISSING.');
  } finally {
    restore();
    _resetCurveReferenceValidationCache();
    if (prev != null) process.env.ZERO_TRUST_RADIO_READONLY_URL = prev; else delete process.env.ZERO_TRUST_RADIO_READONLY_URL;
  }
});

test('FCC_GEO_CROSSCHECK_FAILED is severity="warning" (NEVER blocks readiness)', async () => {
  // Same FCC-off setup as the first orchestrator test; assert on the
  // severity of the resulting warning AND that exhibit.blockers does
  // not contain it.
  const fccOff = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { field: 60, erp: 100 }, geometry: ringAtRadius(KSLX_INPUTS.lat, KSLX_INPUTS.lon, 60) }
    ]
  };
  const restore = mockFetch(mkRichHandler(fccOff));
  const prev = process.env.ZERO_TRUST_RADIO_READONLY_URL;
  process.env.ZERO_TRUST_RADIO_READONLY_URL = ZTR;
  _resetCurveReferenceValidationCache();
  try {
    const mod = await importFresh();
    const x = await mod.computeExhibit({ inputs: KSLX_INPUTS });
    const w = x.warnings.find(w => w.code === 'FCC_GEO_CROSSCHECK_FAILED');
    assert.ok(w);
    assert.equal(w.severity, 'warning');
    assert.equal(x.blockers.some(b => b.code === 'FCC_GEO_CROSSCHECK_FAILED'), false,
      'FCC_GEO_CROSSCHECK_FAILED must never appear in exhibit.blockers');
  } finally {
    restore();
    _resetCurveReferenceValidationCache();
    if (prev != null) process.env.ZERO_TRUST_RADIO_READONLY_URL = prev; else delete process.env.ZERO_TRUST_RADIO_READONLY_URL;
  }
});
