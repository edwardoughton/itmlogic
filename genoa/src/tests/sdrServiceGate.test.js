// SDR evidence service-gate tests.
// The gate is read from process.env.SDR_EVIDENCE_SERVICES inside
// exhibitService.computeExhibit at call time.  These tests stub fetch
// for facility + rich-station endpoints and verify:
//
//   service === 'AM'  → SDR pull happens (engineer evidence attached
//                        when ZTR returns captures)
//   service === 'FM'  → SDR pull SKIPPED (default gate is AM only),
//                        engine warning replaced with a gate-aware
//                        message naming SDR_EVIDENCE_SERVICES
//
// Engine math is unchanged in either path; this is purely about which
// evidence is attached and what the warning says.

import test from 'node:test';
import assert from 'node:assert/strict';

const KSLX_LAT = 33.33144;
const KSLX_LON = -112.06375;

function mockFetch(handler){
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => handler(String(url), opts);
  return () => { globalThis.fetch = orig; };
}
function jsonResp(body, ok = true){
  return { ok, status: ok ? 200 : 502, json: async () => body };
}

const ZTR = 'http://ztr.test';

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

const RICH = {
  id: 757546, callsign: 'KSLX-FM', facility_id: '11282',
  latitude: KSLX_LAT, longitude: KSLX_LON, haat_m: 561,
  _fcc_contour: { type: 'FeatureCollection', features: [] },
  _captures: [
    { id: 9001, frequency_khz: 100700, mode: 'fm', status: 'captured', created_at: '2026-04-01T00:00:00Z' }
  ]
};

function buildHandler(){
  return (url) => {
    if (url.includes('/api/broadcast/stations?facility_id=11282')){
      return jsonResp({ rows: [FACILITY_ROW], count: 1 });
    }
    if (url.includes('/api/radiodns/station/757546')){
      return jsonResp(RICH);
    }
    if (url.includes('/api/broadcast/stations/11282/terrain-haat')){
      return jsonResp({ method: '47 CFR §73.313 arc-averaged HAAT', n_radials: 0, radials: [] }, false);
    }
    return jsonResp({}, false);
  };
}

async function importFresh(){
  // Re-import sidecars + service AFTER env vars are set so module-level
  // env reads (in sidecars.js → makePopulationClient / makeFacilityClient)
  // see the right state.  ESM caches imports per spec, so each test gets
  // a unique query suffix to bust the cache.
  const id = Math.random().toString(36).slice(2);
  return import('../api/services/exhibitService.js?cb=' + id);
}

test('service=AM: SDR captures attach (default gate accepts AM)', async () => {
  const restore = mockFetch(buildHandler());
  const prev = { ZTR: process.env.ZERO_TRUST_RADIO_READONLY_URL, GATE: process.env.SDR_EVIDENCE_SERVICES };
  process.env.ZERO_TRUST_RADIO_READONLY_URL = ZTR;
  delete process.env.SDR_EVIDENCE_SERVICES;   // default = "AM"
  try {
    const mod = await importFresh();
    const x = await mod.computeExhibit({
      inputs: {
        facility_id: '11282', service: 'AM',
        frequency: 1240, erp_kw: 1.0, haat_m: 100,
        ground_sigma_mS_m: 8,
        lat: KSLX_LAT, lon: KSLX_LON, radial_step_deg: 45
      }
    });
    assert.equal(x.evidence.measurements?.available, true,
      'AM should attach SDR captures when service is in the gate');
    const codes = x.warnings.map(w => w.code);
    assert.ok(!codes.includes('SDR_MEASUREMENTS_MISSING'),
      'SDR_MEASUREMENTS_MISSING should not be emitted when captures attach');
  } finally {
    restore();
    if (prev.ZTR  != null) process.env.ZERO_TRUST_RADIO_READONLY_URL = prev.ZTR; else delete process.env.ZERO_TRUST_RADIO_READONLY_URL;
    if (prev.GATE != null) process.env.SDR_EVIDENCE_SERVICES = prev.GATE;
  }
});

test('service=FM: SDR pull is SKIPPED; warning carries gate detail', async () => {
  const restore = mockFetch(buildHandler());
  const prev = { ZTR: process.env.ZERO_TRUST_RADIO_READONLY_URL, GATE: process.env.SDR_EVIDENCE_SERVICES };
  process.env.ZERO_TRUST_RADIO_READONLY_URL = ZTR;
  delete process.env.SDR_EVIDENCE_SERVICES;
  try {
    const mod = await importFresh();
    const x = await mod.computeExhibit({
      inputs: {
        facility_id: '11282', service: 'FM', fcc_class: 'C',
        frequency: 100.7, erp_kw: 100, haat_m: 561,
        lat: KSLX_LAT, lon: KSLX_LON, radial_step_deg: 45
      }
    });
    assert.notEqual(x.evidence.measurements?.available, true,
      'FM should NOT attach SDR captures when gate excludes FM');
    const m = x.warnings.find(w => w.code === 'SDR_MEASUREMENTS_MISSING');
    assert.ok(m, 'FM should still carry SDR_MEASUREMENTS_MISSING');
    assert.match(m.detail || '', /SDR_EVIDENCE_SERVICES/i,
      'Warning detail should name the env gate so reviewers know why');
    assert.match(m.detail || '', /\bFM\b/,
      'Warning detail should name the excluded service');
  } finally {
    restore();
    if (prev.ZTR  != null) process.env.ZERO_TRUST_RADIO_READONLY_URL = prev.ZTR; else delete process.env.ZERO_TRUST_RADIO_READONLY_URL;
    if (prev.GATE != null) process.env.SDR_EVIDENCE_SERVICES = prev.GATE;
  }
});

test('SDR_EVIDENCE_SERVICES=AM,FM: FM pull happens', async () => {
  const restore = mockFetch(buildHandler());
  const prev = { ZTR: process.env.ZERO_TRUST_RADIO_READONLY_URL, GATE: process.env.SDR_EVIDENCE_SERVICES };
  process.env.ZERO_TRUST_RADIO_READONLY_URL = ZTR;
  process.env.SDR_EVIDENCE_SERVICES = 'AM,FM';
  try {
    const mod = await importFresh();
    const x = await mod.computeExhibit({
      inputs: {
        facility_id: '11282', service: 'FM', fcc_class: 'C',
        frequency: 100.7, erp_kw: 100, haat_m: 561,
        lat: KSLX_LAT, lon: KSLX_LON, radial_step_deg: 45
      }
    });
    assert.equal(x.evidence.measurements?.available, true,
      'FM should attach SDR captures when SDR_EVIDENCE_SERVICES includes FM');
  } finally {
    restore();
    if (prev.ZTR  != null) process.env.ZERO_TRUST_RADIO_READONLY_URL = prev.ZTR; else delete process.env.ZERO_TRUST_RADIO_READONLY_URL;
    if (prev.GATE != null) process.env.SDR_EVIDENCE_SERVICES = prev.GATE; else delete process.env.SDR_EVIDENCE_SERVICES;
  }
});
