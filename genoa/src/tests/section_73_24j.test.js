import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAm73_24j } from '../engine/regulatory/section_73_24j.js';

// Helper: build a circular polygon of radius_km around (lat0, lon0)
// using a local-tangent km projection (sub-percent accurate at city scales).
function circlePoly(lat0, lon0, radiusKm, nVertices = 36){
  const R = 6371.0088;
  const cosL = Math.cos(lat0 * Math.PI / 180);
  const ring = [];
  for (let i = 0; i <= nVertices; i++){
    const t = (i % nVertices) * 2 * Math.PI / nVertices;
    const dLatKm = radiusKm * Math.sin(t);
    const dLonKm = radiusKm * Math.cos(t);
    const lat = lat0 + (dLatKm / R) * (180 / Math.PI);
    const lon = lon0 + (dLonKm / (R * cosL)) * (180 / Math.PI);
    ring.push([lon, lat]);
  }
  return ring;
}

// Build a peanut / dumbbell-shaped non-convex polygon — represents a
// DA-2 service contour with a deep null lobe between two main lobes.
function peanutPoly(lat0, lon0){
  // Two ~10 km radius disks centered at +/- 15 km east/west of (lat0, lon0)
  // with a deep waist near the center.
  const ring = [];
  const R = 6371.0088;
  const cosL = Math.cos(lat0 * Math.PI / 180);
  const toLat = (kmN) => lat0 + (kmN / R) * (180 / Math.PI);
  const toLon = (kmE) => lon0 + (kmE / (R * cosL)) * (180 / Math.PI);
  // East lobe (around +15 km east)
  for (let t = -Math.PI/2; t <= Math.PI/2; t += Math.PI/12){
    ring.push([toLon(15 + 10 * Math.cos(t)), toLat(10 * Math.sin(t))]);
  }
  // Top waist crossing
  ring.push([toLon(5),  toLat(2)]);
  ring.push([toLon(-5), toLat(2)]);
  // West lobe (around -15 km west)
  for (let t = -Math.PI/2; t <= Math.PI/2; t += Math.PI/12){
    ring.push([toLon(-15 - 10 * Math.cos(t)), toLat(10 * Math.sin(t))]);
  }
  // Bottom waist crossing
  ring.push([toLon(-5), toLat(-2)]);
  ring.push([toLon(5),  toLat(-2)]);
  ring.push(ring[0]);
  return ring;
}

const TEMPE_LAT = 33.4255, TEMPE_LON = -111.9400;

test('§73.24(j) — applicable only to AM service', () => {
  const r = checkAm73_24j({ exhibit: { station_inputs: { service: 'FM' } } });
  assert.equal(r.applicable, false);
});

test('§73.24(j) — NOT_RUN when community boundary missing (no FAIL)', () => {
  const exhibit = {
    station_inputs: { service: 'AM', community_of_license: 'TEMPE' },
    polygons: [{ id: 'city_5mvm', polygon_lonlat: circlePoly(TEMPE_LAT, TEMPE_LON, 20) }]
  };
  const r = checkAm73_24j({ exhibit });
  assert.equal(r.overall_pass, null, 'overall_pass must be null (NOT_RUN), never false');
  const finding = r.findings[0];
  assert.equal(finding.pass, null);
});

test('§73.24(j) — NOT_RUN when 5 mV/m polygon missing', () => {
  const exhibit = {
    station_inputs: {
      service: 'AM', community_of_license: 'TEMPE',
      community_boundary_geojson: {
        type: 'Polygon',
        coordinates: [circlePoly(TEMPE_LAT, TEMPE_LON, 5)]
      }
    },
    polygons: []
  };
  const r = checkAm73_24j({ exhibit });
  assert.equal(r.overall_pass, null);
});

test('§73.24(j) — circular 20 km service fully encompasses 5 km community → PASS', () => {
  const exhibit = {
    station_inputs: {
      service: 'AM', community_of_license: 'TEMPE',
      community_boundary_geojson: {
        type: 'Polygon',
        coordinates: [circlePoly(TEMPE_LAT, TEMPE_LON, 5)]
      }
    },
    polygons: [{ id: 'city_5mvm', polygon_lonlat: circlePoly(TEMPE_LAT, TEMPE_LON, 20) }]
  };
  const r = checkAm73_24j({ exhibit });
  assert.equal(r.overall_pass, true);
  assert.ok(r.coverage_pct >= 0.999, `coverage ${r.coverage_pct} should be >= 99.9%`);
});

test('§73.24(j) — Monte Carlo handles non-convex DA service polygon', () => {
  // The peanut polygon's waist sits over the community at the origin —
  // service polygon DOES contain the community but is non-convex.  S-H
  // would have dropped a lobe; Monte Carlo correctly counts the inside.
  const exhibit = {
    station_inputs: {
      service: 'AM', community_of_license: 'TEMPE',
      community_boundary_geojson: {
        type: 'Polygon',
        coordinates: [circlePoly(TEMPE_LAT, TEMPE_LON, 1.5)]   // small community
      }
    },
    polygons: [{ id: 'city_5mvm', polygon_lonlat: peanutPoly(TEMPE_LAT, TEMPE_LON) }]
  };
  const r = checkAm73_24j({ exhibit });
  // The 1.5 km community sits at the waist of the peanut — coverage
  // should be partial (not 100%), but the math must complete without
  // dropping lobes the way S-H would.
  assert.ok(Number.isFinite(r.coverage_pct));
  assert.match(r.computed_method, /Monte Carlo/);
});

test('§73.24(j) — deterministic replay (identical inputs produce identical coverage)', () => {
  const exhibit = {
    station_inputs: {
      service: 'AM', community_of_license: 'TEMPE',
      community_boundary_geojson: {
        type: 'Polygon',
        coordinates: [circlePoly(TEMPE_LAT, TEMPE_LON, 8, 24)]
      }
    },
    polygons: [{ id: 'city_5mvm', polygon_lonlat: circlePoly(TEMPE_LAT, TEMPE_LON, 12, 24) }]
  };
  const r1 = checkAm73_24j({ exhibit });
  const r2 = checkAm73_24j({ exhibit });
  assert.equal(r1.coverage_pct, r2.coverage_pct);
});

test('§73.24(j) — substantial-compliance band reported as FAIL with waiver guidance', () => {
  // 5 km community offset 6 km from a 7 km service polygon — much of
  // the community sits outside the contour.  Coverage will land below
  // the substantial-compliance threshold.
  const exhibit = {
    station_inputs: {
      service: 'AM', community_of_license: 'OFFSET-TEST',
      community_boundary_geojson: {
        type: 'Polygon',
        coordinates: [circlePoly(TEMPE_LAT + 0.05, TEMPE_LON + 0.05, 5)]
      }
    },
    polygons: [{ id: 'city_5mvm', polygon_lonlat: circlePoly(TEMPE_LAT, TEMPE_LON, 7) }]
  };
  const r = checkAm73_24j({ exhibit });
  assert.equal(r.overall_pass, false);
  assert.ok(r.findings[0].detail.includes('substantial') || r.findings[0].detail.includes('redesign'));
});
