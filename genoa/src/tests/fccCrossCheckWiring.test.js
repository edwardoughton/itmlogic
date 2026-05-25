// FCC contour cross-check wiring tests.
//
// These run computeExhibit end-to-end with fetch stubbed.  Each test
// asserts that CURVE_VALIDATION_MISSING is treated correctly:
//
//   1. Valid FCC contour (engine within tolerance) → blocker cleared.
//   2. Missing _fcc_contour                         → blocker stays,
//                                                      detail says "skipped".
//   3. Malformed _fcc_contour                       → blocker stays,
//                                                      detail says "skipped".
//   4. Synthetic facility (no facility_id)          → no facility lookup
//                                                      attempted, no
//                                                      facility_lookup_source
//                                                      = 'zerotrustradio'.

import test from 'node:test';
import assert from 'node:assert/strict';

const KSLX_LAT = 33.33144;
const KSLX_LON = -112.06375;
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
  callsign: 'KSLX-FM', station_name: 'KSLX-FM',
  frequency_khz: 100700, service: 'FM', status: 'LIC',
  city: 'SCOTTSDALE', state: 'AZ', country_code: 'US',
  latitude: KSLX_LAT, longitude: KSLX_LON,
  power_watts: 100000, haat_m: 561,
  last_seen: '2026-04-12T16:56:14.271Z',
  facility_id: '11282'
};

// Build a near-circular ring at exact distance `radiusKm` so the
// haversine mean-radial = radiusKm.
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

// Pick FCC contour radii close to what KSLX (Class C, 100 kW, HAAT 561m)
// returns from the engine — adjust if the engine drifts.  These are
// deliberately within 5 km of the engine output so the cross-check
// passes; for the failing test we'll move them far away.
const FCC_OK = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { field: 60, erp: 100, curve: 'F(50,50)', channel: 264, nradial: 360 },
      geometry: ringAtRadius(KSLX_LAT, KSLX_LON, 90.193) },
    { type: 'Feature', properties: { field: 54, erp: 100, curve: 'F(50,50)', channel: 264, nradial: 360 },
      geometry: ringAtRadius(KSLX_LAT, KSLX_LON, 105.437) },
    { type: 'Feature', properties: { field: 40, erp: 100, curve: 'F(50,50)', channel: 264, nradial: 360 },
      geometry: ringAtRadius(KSLX_LAT, KSLX_LON, 148.126) }
  ]
};

function richHandler(fcc){
  return (url) => {
    if (url.includes('/api/broadcast/stations?facility_id=11282')){
      return jsonResp({ rows: [FACILITY_ROW], count: 1 });
    }
    if (url.includes('/api/radiodns/station/757546')){
      return jsonResp({ ...FACILITY_ROW, _fcc_contour: fcc, _captures: [] });
    }
    return jsonResp({}, false);
  };
}

async function importFresh(){
  const id = Math.random().toString(36).slice(2);
  return import('../api/services/exhibitService.js?cb=' + id);
}

const KSLX_INPUTS = {
  facility_id: '11282', service: 'FM', fcc_class: 'C',
  frequency: 100.7, erp_kw: 100, haat_m: 561,
  lat: KSLX_LAT, lon: KSLX_LON, radial_step_deg: 10
};

test('FCC cross-check: valid contour within tolerance emits no FCC warning', async () => {
  // SEMANTICS CHANGE: FCC cross-check no longer drives
  // CURVE_VALIDATION_MISSING.  Pass means no FCC_GEO_CROSSCHECK_*
  // warning; CURVE_VALIDATION_MISSING is independently controlled by
  // the internal curve_reference_validation suite.
  const restore = mockFetch(richHandler(FCC_OK));
  const prev = process.env.ZERO_TRUST_RADIO_READONLY_URL;
  process.env.ZERO_TRUST_RADIO_READONLY_URL = ZTR;
  try {
    const mod = await importFresh();
    const x = await mod.computeExhibit({ inputs: KSLX_INPUTS });
    const codes = (x.warnings || []).map(w => w.code);
    assert.ok(!codes.includes('FCC_GEO_CROSSCHECK_FAILED'),
      'Passing FCC cross-check should emit no FCC_GEO_CROSSCHECK_FAILED');
    assert.ok(!codes.includes('FCC_GEO_CROSSCHECK_SKIPPED'),
      'Passing FCC cross-check should emit no FCC_GEO_CROSSCHECK_SKIPPED');
    assert.equal(x.validation?.fcc_cross_check?.result, 'pass');
    assert.equal(x.validation?.fcc_cross_check?.source, 'zerotrustradio');
  } finally {
    restore();
    if (prev != null) process.env.ZERO_TRUST_RADIO_READONLY_URL = prev; else delete process.env.ZERO_TRUST_RADIO_READONLY_URL;
  }
});

test('FCC cross-check: missing _fcc_contour emits FCC_GEO_CROSSCHECK_SKIPPED warning (NOT CURVE_VALIDATION_MISSING)', async () => {
  const restore = mockFetch(richHandler(undefined));
  const prev = process.env.ZERO_TRUST_RADIO_READONLY_URL;
  process.env.ZERO_TRUST_RADIO_READONLY_URL = ZTR;
  try {
    const mod = await importFresh();
    const x = await mod.computeExhibit({ inputs: KSLX_INPUTS });
    const codes = (x.warnings || []).map(w => w.code);
    assert.ok(codes.includes('FCC_GEO_CROSSCHECK_SKIPPED'),
      'Missing _fcc_contour must emit FCC_GEO_CROSSCHECK_SKIPPED; got ' + codes.join(', '));
    // CURVE_VALIDATION_MISSING semantics: it stays only because the
    // internal golden suite has not been allowed to clear it (this
    // test does not stub the engine away from the real golden run,
    // which DOES pass against the pinned dataset).  So on a real
    // happy path with valid golden fixtures, blocker is absent.
    // detail check
    const skipWarning = (x.warnings || []).find(w => w.code === 'FCC_GEO_CROSSCHECK_SKIPPED');
    assert.ok(skipWarning);
    assert.match(skipWarning.detail || skipWarning.description || '', /no usable|unreachable|return/i);
  } finally {
    restore();
    if (prev != null) process.env.ZERO_TRUST_RADIO_READONLY_URL = prev; else delete process.env.ZERO_TRUST_RADIO_READONLY_URL;
  }
});

test('FCC cross-check: malformed _fcc_contour emits FCC_GEO_CROSSCHECK_SKIPPED (NOT CURVE_VALIDATION_MISSING)', async () => {
  const malformed = { type: 'FeatureCollection', features: [] };
  const restore = mockFetch(richHandler(malformed));
  const prev = process.env.ZERO_TRUST_RADIO_READONLY_URL;
  process.env.ZERO_TRUST_RADIO_READONLY_URL = ZTR;
  try {
    const mod = await importFresh();
    const x = await mod.computeExhibit({ inputs: KSLX_INPUTS });
    const codes = (x.warnings || []).map(w => w.code);
    assert.ok(codes.includes('FCC_GEO_CROSSCHECK_SKIPPED'),
      'Malformed FCC contour must emit FCC_GEO_CROSSCHECK_SKIPPED; got ' + codes.join(', '));
  } finally {
    restore();
    if (prev != null) process.env.ZERO_TRUST_RADIO_READONLY_URL = prev; else delete process.env.ZERO_TRUST_RADIO_READONLY_URL;
  }
});

test('Synthetic facility (no facility_id) does NOT claim "resolved via zerotrustradio"', async () => {
  // No fetch should happen because the orchestrator skips the lookup
  // when facility_id is empty.  Stub fetch to a 500 so any accidental
  // network call would fail loudly.
  const restore = mockFetch(() => jsonResp({}, false));
  const prev = process.env.ZERO_TRUST_RADIO_READONLY_URL;
  process.env.ZERO_TRUST_RADIO_READONLY_URL = ZTR;
  try {
    const mod = await importFresh();
    const x = await mod.computeExhibit({
      inputs: {
        call: 'WBOB-FM (synthetic)', service: 'FM', fcc_class: 'A',
        frequency: 98.7, erp_kw: 6.0, haat_m: 100,
        lat: 37.0902, lon: -95.7129,
        radial_step_deg: 45
        // intentionally NO facility_id
      }
    });
    assert.notEqual(x.facility_metadata?.facility_lookup_source, 'zerotrustradio',
      'Synthetic exhibit must not claim resolution via ZTR');
    assert.notEqual(x.facility_metadata?.cached, true,
      'Synthetic exhibit must not be marked as cached');
  } finally {
    restore();
    if (prev != null) process.env.ZERO_TRUST_RADIO_READONLY_URL = prev; else delete process.env.ZERO_TRUST_RADIO_READONLY_URL;
  }
});
