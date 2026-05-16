// Outcome-A adapter + cross-validator tests.
// All upstreams are mocked — no real ZTR is contacted.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeFacilityClient } from '../api/services/facilityClient.js';
import { validateAgainstFccContour } from '../evidence/curveValidation/ztrFccContourValidator.js';
import { guardNarrative } from '../narrative/guard.js';

const KSLX_LAT = 33.33144;
const KSLX_LON = -112.06375;

function mockFetch(handler){
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, opts) => handler(String(url), opts);
  return () => { globalThis.fetch = orig; };
}
function jsonResp(body, ok = true, status){
  return { ok, status: status ?? (ok ? 200 : 502), json: async () => body };
}

const RICH_STATION_KSLX = {
  id: 757546,
  callsign: 'KSLX-FM',
  facility_id: '11282',
  latitude: KSLX_LAT,
  longitude: KSLX_LON,
  haat_m: 561,
  station_class: 'C',
  amsl_m: 922,
  _fcc_contour: {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { field: 60, erp: 100, curve: 'F(50,50)', channel: 264, nradial: 360 },
        geometry: makeRing(KSLX_LAT, KSLX_LON, 28) },
      { type: 'Feature', properties: { field: 54, erp: 100, curve: 'F(50,50)', channel: 264, nradial: 360 },
        geometry: makeRing(KSLX_LAT, KSLX_LON, 38) },
      { type: 'Feature', properties: { field: 40, erp: 100, curve: 'F(50,50)', channel: 264, nradial: 360 },
        geometry: makeRing(KSLX_LAT, KSLX_LON, 67) }
    ]
  },
  _captures: [
    { id: 9001, frequency_khz: 100700, mode: 'fm', status: 'captured', created_at: '2026-04-01T00:00:00Z' }
  ]
};

// Build a 36-vertex ring at exact distance `radiusKm` from a center.
function makeRing(lat, lon, radiusKm){
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

test('adapter.getRichStation returns ZTR rich payload with provenance', async () => {
  const restore = mockFetch((url) => {
    assert.match(url, /\/api\/radiodns\/station\/757546/);
    return jsonResp(RICH_STATION_KSLX);
  });
  try {
    const c = makeFacilityClient({ ztrUrl: 'http://ztr.test' });
    const r = await c.getRichStation(757546);
    assert.equal(r.available, true);
    assert.equal(r.source, 'zerotrustradio');
    assert.match(r.endpoint, /\/api\/radiodns\/station\/757546/);
    assert.equal(r.station.callsign, 'KSLX-FM');
  } finally { restore(); }
});

test('adapter.getFccContour pulls the FeatureCollection from rich station', async () => {
  const restore = mockFetch(() => jsonResp(RICH_STATION_KSLX));
  try {
    const c = makeFacilityClient({ ztrUrl: 'http://ztr.test' });
    const r = await c.getFccContour({ stationId: 757546 });
    assert.equal(r.available, true);
    assert.equal(r.feature_count, 3);
    assert.equal(r.upstream_api, 'https://geo.fcc.gov/api/contours/entity.json');
  } finally { restore(); }
});

test('adapter.getSdrEvidence reflects _captures', async () => {
  const restore = mockFetch(() => jsonResp(RICH_STATION_KSLX));
  try {
    const c = makeFacilityClient({ ztrUrl: 'http://ztr.test' });
    const r = await c.getSdrEvidence({ stationId: 757546 });
    assert.equal(r.available, true);
    assert.equal(r.n_records, 1);
    assert.equal(r.calibrated, false);
  } finally { restore(); }
});

test('adapter.getTerrainHaatRadials normalizes the new ZTR endpoint', async () => {
  const restore = mockFetch((url) => {
    assert.match(url, /\/api\/broadcast\/stations\/11282\/terrain-haat/);
    return jsonResp({
      method: '47 CFR §73.313 arc-averaged HAAT',
      arc: { from_km: 3, to_km: 16, samples: 14, step_deg: 10 },
      tx: { lat: KSLX_LAT, lon: KSLX_LON, amsl_m: 922 },
      dem: { source: 'OpenTopoData', dataset: 'SRTM 30m' },
      n_radials: 36,
      radials: Array.from({length: 36}, (_, i) => ({
        azimuth_deg: i*10, haat_m: 540 + i, avg_elev_m: 400, min_elev_m: 380, max_elev_m: 420, samples: 14, reason: null
      }))
    });
  });
  try {
    const c = makeFacilityClient({ ztrUrl: 'http://ztr.test' });
    const r = await c.getTerrainHaatRadials({ facility_id: '11282', radial_step_deg: 10 });
    assert.equal(r.available, true);
    assert.equal(r.n_radials, 36);
    assert.equal(r.dem.source, 'OpenTopoData');
    assert.match(r.endpoint, /\/api\/broadcast\/stations\/11282\/terrain-haat/);
  } finally { restore(); }
});

/* ---------------- Curve cross-check ---------------- */

function fakeExhibit(meanRadials){
  return {
    station_inputs: { lat: KSLX_LAT, lon: KSLX_LON },
    polygons: meanRadials.map(([dBu, mean]) => ({
      contour_id: 'c'+dBu, label: `${dBu} dBu`,
      field_strength: { value: dBu, unit: 'dBu' },
      mean_radial_km: mean
    })),
    method_versions: { curve_dataset: { curve_version: '0.2' } },
    engine_signature: { module: 'genoa-engine', version: '2.0.0', hash: 'abc' }
  };
}

test('FCC cross-check passes when engine mean ≈ FCC mean within tolerance', () => {
  const exhibit = fakeExhibit([[60, 27.5], [54, 38.4], [40, 66.6]]);
  const r = validateAgainstFccContour(exhibit, RICH_STATION_KSLX._fcc_contour, { source: 'zerotrustradio', endpoint: '/x', upstream_api: 'https://geo.fcc.gov/...' }, { tolerance_km: 5 });
  assert.equal(r.n_run, 3);
  assert.equal(r.n_pass, 3);
  assert.equal(r.authoritative_pass, true);
  assert.equal(r.source, 'zerotrustradio');
  assert.match(r.method, /FCC contour cross-check/);
});

test('FCC cross-check fails when engine deviates beyond tolerance', () => {
  // engine says 60 dBu mean = 50 km but FCC ring radius was ~28 → 22 km error
  const exhibit = fakeExhibit([[60, 50], [54, 38.4], [40, 66.6]]);
  const r = validateAgainstFccContour(exhibit, RICH_STATION_KSLX._fcc_contour, {}, { tolerance_km: 5 });
  assert.equal(r.authoritative_pass, false);
  assert.ok(r.results.some(x => x.status === 'fail' && x.target_dBu === 60));
});

test('FCC cross-check returns reference_cases_present=false when the contour is empty', () => {
  const r = validateAgainstFccContour(fakeExhibit([[60, 28]]), { type: 'FeatureCollection', features: [] });
  assert.equal(r.reference_cases_present, false);
  assert.equal(r.authoritative_pass, false);
});

/* ---------------- Narrative guard ---------------- */

test('guard scrubs forbidden FCC/AI claims', () => {
  const text = 'This station is FCC approved and AI-certified for compliance.';
  const r = guardNarrative(text, {});
  assert.ok(r.rewrites >= 2, 'expected at least two rewrites');
  assert.ok(!/FCC\s+approved/i.test(r.text));
  assert.ok(!/AI-certified/i.test(r.text));
  assert.ok(r.text.includes('[REMOVED'));
});

test('guard removes "validation passed" when authoritative_pass is not true', () => {
  const exhibit = { validation: { runs: [{ authoritative_pass: false }] } };
  const r = guardNarrative('Curve validation passed for this exhibit.', exhibit);
  assert.ok(r.rewrites >= 1);
  assert.ok(!/validation\s+passed/i.test(r.text));
});

test('guard allows "validation passed" when authoritative_pass=true', () => {
  const exhibit = { validation: { runs: [{ authoritative_pass: true }] } };
  const r = guardNarrative('Curve validation passed for this exhibit.', exhibit);
  assert.equal(r.rewrites, 0);
  assert.match(r.text, /validation\s+passed/i);
});

test('guard removes terrain source name when no terrain evidence is attached', () => {
  const r = guardNarrative('Driven by SRTM30m DEM data.', { evidence: { terrain: { available: false } } });
  assert.ok(r.rewrites >= 1);
  assert.ok(!/SRTM/i.test(r.text));
});

test('guard does NOT scrub disclaimer language ("no terrain evidence attached")', () => {
  const r = guardNarrative('No SigMF measurement records are attached. No terrain evidence attached.', { evidence: { measurements: { available: false }, terrain: { available: false } } });
  assert.equal(r.rewrites, 0, 'guard must allow disclaimers to remain readable');
});

test('guard scrubs affirmative measurement claims', () => {
  const r = guardNarrative('Measured field strength = 62 dBu at the receiver.', { evidence: { measurements: { available: false } } });
  assert.ok(r.rewrites >= 1);
});

test('guard removes specific population claims when placeholder', () => {
  const exhibit = { population_estimate: { method: 'placeholder' } };
  const r = guardNarrative('This contour reaches 1,250,000 people.', exhibit);
  assert.ok(r.rewrites >= 1);
  assert.ok(!/1,250,000\s+people/i.test(r.text));
});
