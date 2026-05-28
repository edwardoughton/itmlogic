// FCC contours.js orchestration parity tests.
//
// Verifies HAAT clamp [30, 1600] m, distance floor at 1 km, and
// spherical-Earth (R=6371) projection match the upstream FCC
// controllers/contours.js conventions.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampHaatToFcc,
  applyFccDistanceFloor,
  fccSphericalDestPoint,
  FCC_HAAT_MIN_M,
  FCC_HAAT_MAX_M,
  FCC_DIST_FLOOR_KM,
  FCC_SPHERE_R_KM,
  FCC_ORCHESTRATION_PROVENANCE
} from '../engine/curves/fcc/orchestration.mjs';
import { fccDistanceKm } from '../engine/curves/fcc/index.mjs';
import { buildExhibit, FM_CLASS_A } from './_helpers.js';
import { compute } from '../engine/index.js';
import { runValidationSuite } from '../engine/validation/runner.js';

test('clampHaatToFcc: low / high / in-range', () => {
  assert.deepEqual(clampHaatToFcc(10),   { haat_used_m: 30,   clamped: 'low'  });
  assert.deepEqual(clampHaatToFcc(30),   { haat_used_m: 30,   clamped: null   });
  assert.deepEqual(clampHaatToFcc(500),  { haat_used_m: 500,  clamped: null   });
  assert.deepEqual(clampHaatToFcc(1600), { haat_used_m: 1600, clamped: null   });
  assert.deepEqual(clampHaatToFcc(2000), { haat_used_m: 1600, clamped: 'high' });
  assert.deepEqual(clampHaatToFcc(NaN),  { haat_used_m: 30,   clamped: 'low'  });
});

test('applyFccDistanceFloor: negative / positive / NaN', () => {
  assert.equal(applyFccDistanceFloor(-1),  FCC_DIST_FLOOR_KM);
  assert.equal(applyFccDistanceFloor(0),   0);
  assert.equal(applyFccDistanceFloor(5.7), 5.7);
  assert.equal(applyFccDistanceFloor(NaN), FCC_DIST_FLOOR_KM);
});

test('fccDistanceKm clamps HAAT and reports clamped value', () => {
  const low  = fccDistanceKm({ haat_m: 10,   target_dBu: 60, erp_kw: 100, mode: '50,50', frequency_mhz: 100.7 });
  const ref  = fccDistanceKm({ haat_m: 30,   target_dBu: 60, erp_kw: 100, mode: '50,50', frequency_mhz: 100.7 });
  const high = fccDistanceKm({ haat_m: 2000, target_dBu: 60, erp_kw: 100, mode: '50,50', frequency_mhz: 100.7 });
  const ceil = fccDistanceKm({ haat_m: 1600, target_dBu: 60, erp_kw: 100, mode: '50,50', frequency_mhz: 100.7 });

  assert.equal(low.haat_used_m,  FCC_HAAT_MIN_M);
  assert.equal(low.haat_clamp,   'low');
  assert.equal(high.haat_used_m, FCC_HAAT_MAX_M);
  assert.equal(high.haat_clamp,  'high');
  // Clamped HAAT yields the same distance as the boundary input.
  assert.ok(Math.abs(low.distance_km  - ref.distance_km)  < 1e-9);
  assert.ok(Math.abs(high.distance_km - ceil.distance_km) < 1e-9);
});

test('fccSphericalDestPoint: byte-equivalent to FCC contours.js getLatLonFromDist', () => {
  // Reference values produced by the FCC formula directly inlined
  // here, then asserted against the vendored helper for parity.  Test
  // location: KSLX-FM transmitter (37.0902, -95.7129), bearing 90°,
  // distance 90 km.
  const lat0 = 37.0902, lon0 = -95.7129, az = 90, d = 90;
  const lat1 = lat0 * Math.PI / 180;
  const lon1 = lon0 * Math.PI / 180;
  const azR  = az * Math.PI / 180;
  const R    = FCC_SPHERE_R_KM;
  const lat2 = Math.asin(Math.sin(lat1)*Math.cos(d/R) + Math.cos(lat1)*Math.sin(d/R)*Math.cos(azR));
  const lon2 = lon1 + Math.atan2(Math.sin(azR)*Math.sin(d/R)*Math.cos(lat1), Math.cos(d/R) - Math.sin(lat1)*Math.sin(lat2));
  const ref  = [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];

  const got = fccSphericalDestPoint(lat0, lon0, az, d);
  assert.ok(Math.abs(got[0] - ref[0]) < 1e-12);
  assert.ok(Math.abs(got[1] - ref[1]) < 1e-12);
});

test('Spherical vs Karney: vertices differ by < 250 m at FCC contour scale', async () => {
  // Build the same FM exhibit twice — once with WGS-84 Karney (2013)
  // geodesic (default), once with FCC spherical projection.  Vertex
  // coordinates must agree to within ~100 m.
  const validationRun = await runValidationSuite();
  const baseOpts = { validation: { runs: [validationRun], reference_cases_present: validationRun.reference_cases_present } };
  const x_wgs = await compute({ inputs: FM_CLASS_A, evidence: {}, options: baseOpts });
  const x_fcc = await compute({ inputs: FM_CLASS_A, evidence: {}, options: { ...baseOpts, projection: 'fcc-spherical' } });

  assert.equal(x_wgs.method_versions.projection, 'wgs84-karney');
  assert.equal(x_fcc.method_versions.projection, 'fcc-spherical');
  assert.equal(x_wgs.polygons.length, x_fcc.polygons.length);

  for (let i = 0; i < x_wgs.polygons.length; i++){
    const a = x_wgs.polygons[i].ring_latlng;
    const b = x_fcc.polygons[i].ring_latlng;
    assert.equal(a.length, b.length);
    for (let j = 0; j < a.length; j++){
      const dlat = (a[j][0] - b[j][0]) * 111.0;             // ~km per degree of lat
      const dlon = (a[j][1] - b[j][1]) * 111.0 * Math.cos(a[j][0] * Math.PI / 180);
      const d_km = Math.hypot(dlat, dlon);
      assert.ok(d_km < 0.25, `vertex ${i}.${j} differs by ${d_km*1000} m (>250 m)`);
    }
  }
});

test('FM exhibit stamps method_versions.fcc_orchestration provenance', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  assert.ok(x.method_versions.fcc_orchestration);
  assert.equal(x.method_versions.fcc_orchestration.commit, FCC_ORCHESTRATION_PROVENANCE.commit);
  assert.equal(x.method_versions.fcc_orchestration.file,   'controllers/contours.js');
});

test('FCC orchestration: out-of-range HAAT input is clamped end-to-end', async () => {
  // Above the FCC tabulation: HAAT 2500 m is clamped to 1600 m.  The
  // resulting contour distance must equal the haat=1600 case exactly.
  const x_high = await buildExhibit({ ...FM_CLASS_A, haat_m: 2500 });
  const x_ref  = await buildExhibit({ ...FM_CLASS_A, haat_m: 1600 });
  for (let i = 0; i < x_ref.radial_table.length; i++){
    const a = x_high.radial_table[i].contour_distances_km;
    const b = x_ref.radial_table[i].contour_distances_km;
    for (const k of Object.keys(b)){
      assert.ok(Math.abs(a[k] - b[k]) < 1e-9,
        `clamped 2500 m ≠ 1600 m at radial ${i}/${k}: ${a[k]} vs ${b[k]}`);
    }
  }
});
