// Tests for the manual infrastructure inventory loader.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadManualInfrastructureSites,
  filterInfrastructureSites,
  __test__
} from '../evidence/manualInfrastructureClient.js';

const KAZM = { lat: 34.86, lon: -111.82 };

test('loadManualInfrastructureSites: returns a non-empty array of records', () => {
  const arr = loadManualInfrastructureSites();
  assert.ok(Array.isArray(arr), 'should be an array');
  assert.ok(arr.length >= 1, 'should have at least one record');
  for (const s of arr){
    assert.ok(typeof s.id === 'string', 'each record has an id');
    assert.ok(typeof s.kind === 'string', 'each record has a kind');
    assert.ok(Number.isFinite(s.lat), 'each record has a numeric lat');
    assert.ok(Number.isFinite(s.lon), 'each record has a numeric lon');
  }
});

test('filterInfrastructureSites: 5 km radius around KAZM returns only sites within 5 km', () => {
  const all = loadManualInfrastructureSites();
  const out = filterInfrastructureSites(all, {
    center: KAZM,
    radius_km: 5,
    filters: {}
  });
  assert.ok(out.length >= 1, 'at least one seed site must be within 5 km of KAZM');
  for (const s of out){
    assert.ok(s.distance_from_center_km <= 5 + 1e-6,
      `site ${s.id} at ${s.distance_from_center_km} km should be ≤ 5 km`);
  }
  // Any record farther than 5 km must NOT appear.
  const farther = all.filter((s) => {
    const d = __test__.greatCircleKm(KAZM.lat, KAZM.lon, s.lat, s.lon);
    return d > 5;
  });
  for (const f of farther){
    assert.equal(out.find((o) => o.id === f.id), undefined,
      `site ${f.id} is > 5 km from KAZM and should not appear in filtered output`);
  }
});

test('filterInfrastructureSites: owner_contains filter restricts to matching owners', () => {
  const all = loadManualInfrastructureSites();
  const needle = 'Bonneville';
  const out = filterInfrastructureSites(all, {
    center: KAZM,
    radius_km: 500,
    filters: { owner_contains: needle }
  });
  assert.ok(out.length >= 1, 'seed data should include at least one Bonneville-owned site');
  for (const s of out){
    assert.ok(
      String(s.owner).toLowerCase().includes(needle.toLowerCase()),
      `expected owner of ${s.id} to contain "${needle}", got "${s.owner}"`
    );
  }
});

test('filterInfrastructureSites: include_am_sites=false excludes AM_SITE records', () => {
  const all = loadManualInfrastructureSites();
  const out = filterInfrastructureSites(all, {
    center: KAZM,
    radius_km: 500,
    filters: { include_am_sites: false }
  });
  for (const s of out){
    assert.notEqual(s.kind, 'AM_SITE', `${s.id} of kind AM_SITE should have been filtered out`);
  }
});

test('filterInfrastructureSites: empty / invalid center returns []', () => {
  const all = loadManualInfrastructureSites();
  assert.deepEqual(filterInfrastructureSites(all, {}), []);
  assert.deepEqual(filterInfrastructureSites(all, { center: { lat: NaN, lon: 0 }, radius_km: 100 }), []);
});
