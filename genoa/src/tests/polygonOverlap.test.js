// Polygon-overlap geometry tests for §73.215.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContourPolygon,
  polygonOverlap
} from '../engine/geometry/polygonOverlap.js';

test('buildContourPolygon: empty radials returns empty', () => {
  assert.deepEqual(buildContourPolygon({ lat: 40, lon: -100, radials: [] }), []);
  assert.deepEqual(buildContourPolygon({ lat: 40, lon: -100, radials: [{ az: 0, distance_km: 10 }, { az: 90, distance_km: 10 }] }), []);
});

test('buildContourPolygon: 4 cardinal radials at 50 km builds a closed 5-vertex ring', () => {
  const ring = buildContourPolygon({
    lat: 40, lon: -100,
    radials: [
      { az: 0,   distance_km: 50 },
      { az: 90,  distance_km: 50 },
      { az: 180, distance_km: 50 },
      { az: 270, distance_km: 50 }
    ]
  });
  assert.equal(ring.length, 5);                         // closed
  assert.deepEqual(ring[0], ring[ring.length - 1]);     // first === last
});

test('polygonOverlap: bounding-box rejection — far-apart polygons report no overlap', () => {
  const A = buildContourPolygon({ lat: 40, lon: -100, radials: cardinal(20) });
  const B = buildContourPolygon({ lat: 50, lon: -90,  radials: cardinal(20) });
  const r = polygonOverlap(A, B);
  assert.equal(r.overlap, false);
  assert.equal(r.overlap_area_km2, 0);
  assert.match(r.method, /bbox-rejected/);
});

test('polygonOverlap: identical polygons fully overlap', () => {
  const A = buildContourPolygon({ lat: 40, lon: -100, radials: cardinal(50) });
  const r = polygonOverlap(A, A);
  assert.equal(r.overlap, true);
  assert.ok(r.overlap_area_km2 > 1000);                    // ~ π × 50² = 7854 km²
});

test('polygonOverlap: partial overlap of two co-located rings of different size', () => {
  const A = buildContourPolygon({ lat: 40, lon: -100,  radials: cardinal(50) });
  const B = buildContourPolygon({ lat: 40, lon: -99.5, radials: cardinal(50) });   // shifted ~43 km east
  const r = polygonOverlap(A, B);
  assert.equal(r.overlap, true);
  // Sutherland-Hodgman of two circles offset by less than their
  // diameter produces a non-zero, finite overlap area.
  assert.ok(r.overlap_area_km2 > 100);
  assert.ok(r.overlap_area_km2 < 7854);                    // less than full
});

test('polygonOverlap: degenerate input returns no-overlap with reason', () => {
  const r = polygonOverlap([], []);
  assert.equal(r.overlap, false);
  assert.match(r.method, /insufficient input/);
});

function cardinal(km){
  return [
    { az: 0,   distance_km: km }, { az: 45,  distance_km: km },
    { az: 90,  distance_km: km }, { az: 135, distance_km: km },
    { az: 180, distance_km: km }, { az: 225, distance_km: km },
    { az: 270, distance_km: km }, { az: 315, distance_km: km }
  ];
}
