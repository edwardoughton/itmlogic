import test from 'node:test';
import assert from 'node:assert/strict';
import { detectInternationalBorder } from '../engine/regulatory/internationalBorderDetect.js';

test('international border — KELP El Paso TX is essentially on the US/MX border', () => {
  const r = detectInternationalBorder({ lat: 31.7439, lon: -106.3958 });
  assert.equal(r.available, true);
  assert.equal(r.nearest_border, 'US/Mexico');
  assert.ok(r.distances.us_mx_km < 5, `us_mx_km ${r.distances.us_mx_km} should be < 5 km`);
  assert.equal(r.inside_treaty_zone, true);
});

test('international border — KDUS Tempe AZ inside US/MX 320 km treaty zone', () => {
  const r = detectInternationalBorder({ lat: 33.3620, lon: -111.9682 });
  assert.ok(r.distances.us_mx_km < 320);
  assert.ok(r.inside_treaty_zone);
  const mxTreaty = r.treaties.find((t) => t.treaty.includes('US/Mexico'));
  assert.ok(mxTreaty);
});

test('international border — WBZ Boston inside US/CA 800 km treaty zone', () => {
  const r = detectInternationalBorder({ lat: 42.2167, lon: -71.5000 });
  assert.ok(r.distances.us_ca_km < 800);
  assert.ok(r.inside_treaty_zone);
  const caTreaty = r.treaties.find((t) => t.treaty.includes('US/Canada'));
  assert.ok(caTreaty);
});

test('international border — Kansas City is interior, no treaty obligations', () => {
  const r = detectInternationalBorder({ lat: 39.0997, lon: -94.5786 });
  assert.equal(r.inside_treaty_zone, false);
  assert.equal(r.treaties.length, 0);
});

test('international border — bisection-projection accuracy across long border segments', () => {
  // El Paso evaluated for distance to the 49°-parallel US/CA border.
  // Prior segment-midpoint-cosLat projection produced > 20 km error
  // here; the haversine-bisection rewrite should give near-exact
  // great-circle distance.  El Paso (32°N) to nearest point on the
  // 49° parallel is ~17° latitude difference ≈ 1900 km.  No projection
  // error larger than a few km should remain.
  const r = detectInternationalBorder({ lat: 31.7439, lon: -106.3958 });
  // Distance to 49°N at the same lon is 6371 * 17.26° * π/180 ≈ 1919 km.
  // Allow ±25 km because polyline waypoints aren't exactly at lon = -106.4.
  assert.ok(r.distances.us_ca_km > 1850 && r.distances.us_ca_km < 1960,
    `us_ca_km ${r.distances.us_ca_km} expected near 1919 km`);
});

test('international border — invalid lat/lon returns unavailable', () => {
  const r = detectInternationalBorder({ lat: 'not-a-number', lon: -100 });
  assert.equal(r.available, false);
});
