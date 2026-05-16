// FCC cross-check ERP gate.  Real-world KSLX-FM scenario:
//   geo.fcc.gov returns 3 features at 60 dBu — one at ERP=100 kW
//   (the licensed primary, dom_status='L') and two at ERP=12 kW
//   (HD multicast / auxiliary).  Genoa's engine produces ONE polygon
//   at ERP=100 kW.  Without an ERP gate, the two 12 kW features
//   inevitably show ~24 km error, dragging the cross-check to FAIL
//   even though the primary contour is a bit-perfect match.
//
// This test pins the new behavior: only the dominant / matching-ERP
// feature is scored; auxiliary features are reported with
// status='skipped' and an explicit reason.

import test from 'node:test';
import assert from 'node:assert/strict';

import { validateAgainstFccContour } from '../evidence/curveValidation/ztrFccContourValidator.js';

const KSLX_LAT = 33.33144;
const KSLX_LON = -112.06375;

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

const KSLX_EXHIBIT = {
  station_inputs: { lat: KSLX_LAT, lon: KSLX_LON, erp_kw: 100 },
  polygons: [
    { contour_id: 'c60', label: '60 dBu', field_strength: { value: 60, unit: 'dBu' }, mean_radial_km: 90.193 }
  ],
  method_versions: { curve_dataset: { curve_version: 'fcc' } },
  engine_signature: { module: 'genoa-engine', version: '2.0.0', hash: 'abc' }
};

// Reproduces the live FCC payload for KSLX: 1 primary + 2 HD aux.
const KSLX_FCC_REAL = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature',
      properties: { field: 60, erp: 100, dom_status: 'L', curve: 0, channel: 264 },
      geometry:   ringAtRadius(KSLX_LAT, KSLX_LON, 89.95) },     // primary
    { type: 'Feature',
      properties: { field: 60, erp: 12,  dom_status: '',  curve: 0, channel: 264 },
      geometry:   ringAtRadius(KSLX_LAT, KSLX_LON, 66.48) },     // HD-1
    { type: 'Feature',
      properties: { field: 60, erp: 12,  dom_status: '',  curve: 0, channel: 264 },
      geometry:   ringAtRadius(KSLX_LAT, KSLX_LON, 66.96) }      // HD-2
  ]
};

test('ERP gate: KSLX-style 1 primary + 2 HD-aux → cross-check PASSES on the primary only', () => {
  const r = validateAgainstFccContour(KSLX_EXHIBIT, KSLX_FCC_REAL, {
    source: 'zerotrustradio', endpoint: '/api/radiodns/station/757546'
  }, { tolerance_km: 5.0 });

  assert.equal(r.n_run, 1, 'only the primary 100 kW feature should be scored');
  assert.equal(r.n_pass, 1, 'primary should pass (engine 90.193 vs FCC 89.95, delta < 0.3 km)');
  assert.equal(r.authoritative_pass, true, 'cross-check overall must pass');

  const skipped = r.results.filter(x => x.status === 'skipped');
  assert.equal(skipped.length, 2, 'two HD-aux features should be skipped, not failed');
  for (const s of skipped){
    assert.match(s.reason || '', /auxiliary|HD|ERP/i,
      'skipped reason must explain it was an ERP mismatch');
  }
});

test('ERP gate: dom_status="L" overrides ERP mismatch (legacy auths sometimes report different ERPs)', () => {
  const fcc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature',
        properties: { field: 60, erp: 50, dom_status: 'L', curve: 0 },   // 50 kW + dominant
        geometry:   ringAtRadius(KSLX_LAT, KSLX_LON, 89.95) }
    ]
  };
  const r = validateAgainstFccContour(KSLX_EXHIBIT, fcc, {}, { tolerance_km: 5.0 });
  assert.equal(r.n_run, 1, 'dominant feature must be scored even with non-matching ERP');
  assert.equal(r.n_pass, 1);
});

test('ERP gate: when engine ERP unknown, all FCC features are scored (no overzealous skipping)', () => {
  const exhibitNoErp = { ...KSLX_EXHIBIT, station_inputs: { lat: KSLX_LAT, lon: KSLX_LON } };
  const fcc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature',
        properties: { field: 60, erp: 100, dom_status: '', curve: 0 },
        geometry:   ringAtRadius(KSLX_LAT, KSLX_LON, 89.95) }
    ]
  };
  const r = validateAgainstFccContour(exhibitNoErp, fcc, {}, { tolerance_km: 5.0 });
  assert.equal(r.n_run, 1, 'must default to scoring when engine ERP is unknown');
});
