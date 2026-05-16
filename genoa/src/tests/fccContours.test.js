// FCC Contours direct API client tests.
// All network calls are stubbed — no real geo.fcc.gov traffic.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFccContoursClient, extractHaatFromContour } from '../evidence/fccContoursClient.js';

// Minimal GeoJSON FeatureCollection matching the real FCC contours API shape.
function fakeContourFC(facilityId = 41299, callsign = 'KDKB'){
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[[[-112.06, 33.94], [-112.00, 33.94], [-112.00, 33.35], [-112.06, 33.35], [-112.06, 33.94]]]]
      },
      properties: {
        callsign,
        facility_id: facilityId,
        serviceType: 'fm',
        field: 60,
        erp: 100,
        station_class: 'C'
      }
    }]
  };
}

test('makeFccContoursClient: constructs when fetch available', () => {
  const c = makeFccContoursClient({ fetchFn: async () => ({}) });
  assert.ok(c, 'client must construct when fetchFn provided');
  assert.ok(c.baseUrl.includes('geo.fcc.gov'));
});

test('makeFccContoursClient: getContour returns available=true for FM', async () => {
  const fc = fakeContourFC();
  const fetchFn = async (url) => {
    assert.match(url, /facilityId=41299/);
    assert.match(url, /serviceType=FM/);
    assert.match(url, /unit=km/);
    return { ok: true, async json(){ return fc; } };
  };
  const c = makeFccContoursClient({ fetchFn });
  const r = await c.getContour('41299', 'FM');
  assert.equal(r.available, true);
  assert.equal(r.source, 'fcc-contours-direct');
  assert.equal(r.feature_count, 1);
  assert.equal(r.contour.type, 'FeatureCollection');
  assert.match(r.endpoint, /facilityId=41299/);
});

test('makeFccContoursClient: FS and FB service codes map to FM serviceType', async () => {
  for (const svc of ['FS', 'FB']){
    const fetchFn = async (url) => {
      assert.match(url, /serviceType=FM/, `${svc} should map to FM`);
      return { ok: true, async json(){ return fakeContourFC(); } };
    };
    const c = makeFccContoursClient({ fetchFn });
    const r = await c.getContour('1', svc);
    assert.equal(r.available, true);
  }
});

test('makeFccContoursClient: AM station uses serviceType=AM', async () => {
  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature',
    geometry: { type: 'MultiPolygon', coordinates: [[[[0,0],[1,0],[1,1],[0,0]]]] },
    properties: { callsign: 'WBZ', facility_id: 25444, serviceType: 'am', field: 0.5 }
  }] };
  const fetchFn = async (url) => {
    assert.match(url, /serviceType=AM/);
    return { ok: true, async json(){ return fc; } };
  };
  const c = makeFccContoursClient({ fetchFn });
  const r = await c.getContour('25444', 'AM');
  assert.equal(r.available, true);
  assert.equal(r.feature_count, 1);
});

test('makeFccContoursClient: HTTP error returns available=false', async () => {
  const fetchFn = async () => ({ ok: false, status: 503 });
  const c = makeFccContoursClient({ fetchFn });
  const r = await c.getContour('41299', 'FM');
  assert.equal(r.available, false);
  assert.match(r.error, /HTTP 503/);
});

test('makeFccContoursClient: API error status returns available=false', async () => {
  const fetchFn = async () => ({
    ok: true,
    async json(){ return { status: 'error', statusCode: '400', statusMessage: 'serviceType missing' }; }
  });
  const c = makeFccContoursClient({ fetchFn });
  const r = await c.getContour('41299', 'FM');
  assert.equal(r.available, false);
  assert.match(r.error, /serviceType missing/);
});

test('makeFccContoursClient: empty FeatureCollection returns available=false', async () => {
  const fetchFn = async () => ({
    ok: true,
    async json(){ return { type: 'FeatureCollection', features: [] }; }
  });
  const c = makeFccContoursClient({ fetchFn });
  const r = await c.getContour('99999', 'FM');
  assert.equal(r.available, false);
  assert.match(r.error, /no features/);
});

test('makeFccContoursClient: network error returns available=false', async () => {
  const fetchFn = async () => { throw new Error('network timeout'); };
  const c = makeFccContoursClient({ fetchFn });
  const r = await c.getContour('41299', 'FM');
  assert.equal(r.available, false);
  assert.match(r.error, /network timeout/);
});

test('makeFccContoursClient: missing facilityId returns available=false without network call', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return { ok: true, async json(){ return {}; } }; };
  const c = makeFccContoursClient({ fetchFn });
  const r = await c.getContour(null, 'FM');
  assert.equal(r.available, false);
  assert.equal(called, false, 'should not hit network when facilityId missing');
});

test('makeFccContoursClient: unknown service code returns available=false without network call', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return { ok: true, async json(){ return {}; } }; };
  const c = makeFccContoursClient({ fetchFn });
  const r = await c.getContour('12345', 'WIBBLE');
  assert.equal(r.available, false);
  assert.match(r.error, /cannot map/i);
  assert.equal(called, false);
});

test('makeFccContoursClient: LPFM maps to serviceType=LPFM', async () => {
  const fetchFn = async (url) => {
    assert.match(url, /serviceType=LPFM/);
    return { ok: true, async json(){ return fakeContourFC(); } };
  };
  const c = makeFccContoursClient({ fetchFn });
  const r = await c.getContour('99999', 'LPFM');
  assert.equal(r.available, true);
});

/* -------------------- extractHaatFromContour -------------------- */

function fcWithContourData(){
  // FCC returns contourData with one entry per integer azimuth 0..359.
  const contourData = [];
  for (let az = 0; az < 360; az++){
    contourData.push({
      x: -112 + az * 1e-4,
      y: 33  + az * 1e-4,
      azimuth: az,
      // Sinusoidal-like HAAT pattern so subsampling is verifiable.
      haat: 500 + 50 * Math.sin(az * Math.PI / 180)
    });
  }
  return {
    available: true,
    endpoint:  'https://geo.fcc.gov/api/contours/entity.json?facilityId=41299&serviceType=FM&unit=km',
    fetched_at: '2026-05-05T00:00:00Z',
    contour: {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'MultiPolygon', coordinates: [[[[0,0],[1,1],[1,0],[0,0]]]] },
        properties: {
          callsign: 'KDKB',
          facility_id: 41299,
          rcamsl: 871,
          nradial: 360,
          elevation_data_source: 'ned_1',
          contourData
        }
      }]
    }
  };
}

test('extractHaatFromContour: subsamples to 8 radials at step=45', () => {
  const fc = fcWithContourData();
  const out = extractHaatFromContour(fc, 45);
  assert.ok(out);
  assert.equal(out.radials.length, 8);
  assert.deepEqual(out.radials.map(r => r.azimuth_deg), [0, 45, 90, 135, 180, 225, 270, 315]);
  assert.equal(out.rcamsl, 871);
  assert.equal(out.elevation_data_source, 'ned_1');
  assert.equal(out.source, 'fcc-contours-direct');
});

test('extractHaatFromContour: subsamples to 36 radials at step=10', () => {
  const fc = fcWithContourData();
  const out = extractHaatFromContour(fc, 10);
  assert.equal(out.radials.length, 36);
  assert.equal(out.radials[0].azimuth_deg, 0);
  assert.equal(out.radials[35].azimuth_deg, 350);
});

test('extractHaatFromContour: returns null when fcc response not available', () => {
  assert.equal(extractHaatFromContour({ available: false }, 45), null);
  assert.equal(extractHaatFromContour(null, 45), null);
});

test('extractHaatFromContour: returns null when contourData missing', () => {
  const fc = fcWithContourData();
  delete fc.contour.features[0].properties.contourData;
  assert.equal(extractHaatFromContour(fc, 45), null);
});

test('extractHaatFromContour: keeps all radials at step pattern; non-finite haat → null', () => {
  // Length-matched bundles are required by the engine (engine/index.js
  // strict equality at the terrain HAAT branch).  When the FCC response
  // is missing a haat for a given radial, the bundle still emits an
  // entry with haat_m=null so the orchestrator can pad with flat HAAT
  // and preserve the array length.
  const fc = fcWithContourData();
  fc.contour.features[0].properties.contourData[0].haat = NaN;
  const out = extractHaatFromContour(fc, 45);
  assert.equal(out.radials.length, 8, 'all step-pattern azimuths emitted');
  assert.equal(out.radials[0].azimuth_deg, 0);
  assert.equal(out.radials[0].haat_m, null, 'NaN haat surfaces as null, not dropped');
  assert.equal(out.n_finite, 7);
  assert.ok(Number.isFinite(out.radials[1].haat_m));
});
