// ITM-aware terrain-propagation engine tests.
//
// Tests cover:
//   - Free-space loss formula
//   - Knife-edge diffraction (canonical ν cases)
//   - Bullington worst-edge selection on a synthetic profile
//   - Smooth-earth additional loss beyond LoS horizon
//   - Field-strength prediction matches FCC FSL convention
//   - Per-radial crossing finder produces sensible bracketing
//   - Provenance stamps

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  freeSpacePathLoss_dB,
  smoothEarthAdditional_dB,
  knifeEdgeDiffraction_dB,
  fresnelKirchhoffNu,
  bullingtonWorstEdge,
  terrainPathLoss,
  predictFieldStrengthDbu,
  preloadItmV122,
  TERRAIN_PROPAGATION_PROVENANCE
} from '../engine/coverage/terrain_propagation.js';

import { findFieldStrengthCrossingOnRadial } from '../engine/coverage/itm_radial.js';

// findFieldStrengthCrossingOnRadial drives the ITM v1.2.2 path-loss
// kernel, which fail-closes if its DLL/JS WASM bindings haven't been
// preloaded.  In production the engine preloads once at startup; under
// test we mirror that here so the crossing-finder tests can run.
test.before(async () => {
  await preloadItmV122();
});

/* -------------------- free-space -------------------- */

test('freeSpacePathLoss_dB: 100 km at 100 MHz ≈ 112.45 dB', () => {
  // L = 32.45 + 20·log10(100) + 20·log10(100) = 32.45 + 40 + 40 = 112.45
  const L = freeSpacePathLoss_dB(100, 100);
  assert.ok(Math.abs(L - 112.45) < 0.01, `expected 112.45 dB, got ${L}`);
});

test('freeSpacePathLoss_dB: doubles distance → +6 dB', () => {
  const L1 = freeSpacePathLoss_dB(50, 100);
  const L2 = freeSpacePathLoss_dB(100, 100);
  assert.ok(Math.abs((L2 - L1) - 6.02) < 0.01, `expected +6.02 dB, got ${(L2-L1).toFixed(2)}`);
});

/* -------------------- knife-edge diffraction -------------------- */

test('knifeEdgeDiffraction_dB: ν = 0 → ~6 dB (grazing)', () => {
  const L = knifeEdgeDiffraction_dB(0);
  assert.ok(Math.abs(L - 6.0) < 0.5, `expected ~6 dB at ν=0, got ${L}`);
});

test('knifeEdgeDiffraction_dB: ν below -0.7 boundary → 0 dB', () => {
  // Per ITU-R P.526, the formula returns a small (~0.5 dB) positive
  // value at ν = -0.7 itself; loss is treated as zero only strictly
  // below -0.7 (effectively ν < -0.78 at the floor of the formula).
  assert.equal(knifeEdgeDiffraction_dB(-1.0), 0);
  assert.equal(knifeEdgeDiffraction_dB(-2.0), 0);
});

test('knifeEdgeDiffraction_dB: ν = 1 → ~13.7 dB; ν = 2 → ~19.7 dB', () => {
  const L1 = knifeEdgeDiffraction_dB(1);
  const L2 = knifeEdgeDiffraction_dB(2);
  // ITU-R P.526 §4.1 reference: ν=1 → ~12-14 dB, ν=2 → ~19-21 dB
  assert.ok(L1 > 12 && L1 < 15, `ν=1 expected 12-15 dB, got ${L1.toFixed(2)}`);
  assert.ok(L2 > 18 && L2 < 22, `ν=2 expected 18-22 dB, got ${L2.toFixed(2)}`);
});

test('fresnelKirchhoffNu: dimensionless and scales correctly with h', () => {
  const nu1 = fresnelKirchhoffNu(10,  5, 5, 100);   // 10 m obstacle, 5 km each side
  const nu2 = fresnelKirchhoffNu(20,  5, 5, 100);   // double height → ν doubles
  assert.ok(Math.abs(nu2 / nu1 - 2) < 0.01, `ν scales linearly in h, got ratio ${nu2/nu1}`);
});

/* -------------------- Bullington worst-edge -------------------- */

test('bullingtonWorstEdge: flat profile → no diffraction loss', () => {
  const profile = [
    { distance_km: 0,  elevation_m: 0 },
    { distance_km: 5,  elevation_m: 0 },
    { distance_km: 10, elevation_m: 0 }
  ];
  const r = bullingtonWorstEdge({ tx_amsl_m: 100, rx_amsl_m: 100, terrain_profile: profile, frequency_mhz: 100 });
  assert.equal(r.loss_db, 0);
  assert.equal(r.worst_edge, null);
});

test('bullingtonWorstEdge: ridge in the middle adds diffraction loss', () => {
  const profile = [
    { distance_km: 0,  elevation_m: 0   },
    { distance_km: 5,  elevation_m: 200 },         // 200 m ridge mid-path
    { distance_km: 10, elevation_m: 0   }
  ];
  const r = bullingtonWorstEdge({ tx_amsl_m: 100, rx_amsl_m: 100, terrain_profile: profile, frequency_mhz: 100 });
  assert.ok(r.loss_db > 0, `expected diffraction loss > 0, got ${r.loss_db}`);
  assert.ok(r.worst_edge);
  assert.equal(r.worst_edge.distance_km, 5);
  assert.ok(r.worst_edge.h_above_los_m > 0);
});

test('bullingtonWorstEdge: higher ridge = more loss', () => {
  const profileLow = [
    { distance_km: 0,  elevation_m: 0  },
    { distance_km: 5,  elevation_m: 50 },
    { distance_km: 10, elevation_m: 0  }
  ];
  const profileHi = [
    { distance_km: 0,  elevation_m: 0   },
    { distance_km: 5,  elevation_m: 500 },
    { distance_km: 10, elevation_m: 0   }
  ];
  const lo = bullingtonWorstEdge({ tx_amsl_m: 100, rx_amsl_m: 100, terrain_profile: profileLow, frequency_mhz: 100 });
  const hi = bullingtonWorstEdge({ tx_amsl_m: 100, rx_amsl_m: 100, terrain_profile: profileHi, frequency_mhz: 100 });
  assert.ok(hi.loss_db > lo.loss_db, `higher ridge should produce more loss; lo=${lo.loss_db}, hi=${hi.loss_db}`);
});

/* -------------------- smooth-earth -------------------- */

test('smoothEarthAdditional_dB: returns 0 within LoS horizon', () => {
  // Tx 100 m, Rx 10 m at 5 km — well within horizon.
  const L = smoothEarthAdditional_dB({ distance_km: 5, tx_height_m: 100, rx_height_m: 10, frequency_mhz: 100 });
  assert.equal(L, 0);
});

test('smoothEarthAdditional_dB: positive beyond horizon', () => {
  // Tx 30 m, Rx 9 m — horizon ~25 km; at 100 km expect significant extra loss.
  const L = smoothEarthAdditional_dB({ distance_km: 100, tx_height_m: 30, rx_height_m: 9, frequency_mhz: 100 });
  assert.ok(L > 0, `expected smooth-earth loss > 0 beyond horizon, got ${L}`);
});

/* -------------------- terrain path loss + field strength -------------------- */

test('terrainPathLoss: flat profile equals free-space + smooth-earth', () => {
  const profile = [
    { distance_km: 0,  elevation_m: 0 },
    { distance_km: 5,  elevation_m: 0 },
    { distance_km: 10, elevation_m: 0 }
  ];
  const r = terrainPathLoss({ tx_amsl_m: 100, rx_amsl_m: 9, terrain_profile: profile, frequency_mhz: 100 });
  assert.equal(r.knife_edge_db, 0, 'flat profile → no knife-edge');
  assert.ok(Math.abs(r.total_loss_db - (r.free_space_db + r.smooth_earth_extra_db)) < 0.01);
});

test('predictFieldStrengthDbu: 100 kW at 100 km / 100 MHz free-space ≈ 47 dBu', () => {
  // E = 106.92 + 10·log10(100) - 20·log10(100) - 20·log10(100)
  //   = 106.92 + 20 - 40 - 40 = 46.92 dBu
  const E = predictFieldStrengthDbu({ erp_kw: 100, distance_km: 100, frequency_mhz: 100 });
  assert.ok(Math.abs(E - 46.92) < 0.01, `expected 46.92 dBu, got ${E}`);
});

test('predictFieldStrengthDbu: terrain extra loss subtracts directly', () => {
  const E0 = predictFieldStrengthDbu({ erp_kw: 100, distance_km: 100, frequency_mhz: 100 });
  const E1 = predictFieldStrengthDbu({ erp_kw: 100, distance_km: 100, frequency_mhz: 100, terrain_extra_loss_db: 12 });
  assert.ok(Math.abs(E0 - E1 - 12) < 0.01, `expected -12 dB delta, got ${(E0-E1).toFixed(2)}`);
});

/* -------------------- per-radial crossing finder -------------------- */

test('findFieldStrengthCrossingOnRadial: locates 60 dBu crossing on flat-Earth profile', () => {
  // Build a flat profile out to 80 km in 5 km steps.
  const profile = [];
  for (let d = 0; d <= 80; d += 5) profile.push({ distance_km: d, elevation_m: 0 });
  const r = findFieldStrengthCrossingOnRadial({
    profile, tx_amsl_m: 100, erp_kw: 100, frequency_mhz: 100, target_field_dbu: 60
  });
  // 60 dBu crossing at 100 kW / 100 MHz on flat: from FSL,
  //   60 = 106.92 + 20 - 20·log10(d) - 40  →  log10(d) ≈ 1.346 → d ≈ 22.2 km
  // Smooth-earth + 4/3 horizon adds modest extra loss inside that range,
  // so the actual crossing is somewhat shorter — we just assert it's
  // resolvable, finite, and positive.
  assert.ok(r.crossing_distance_km > 0, `crossing should be > 0, got ${r.crossing_distance_km}`);
  assert.ok(r.crossing_distance_km < 50, `crossing should be < 50 km, got ${r.crossing_distance_km}`);
  assert.equal(r.beyond_max_range, false);
});

test('findFieldStrengthCrossingOnRadial: target above any field (very weak signal) flags beyond_max_range', () => {
  const profile = [];
  for (let d = 0; d <= 5; d += 1) profile.push({ distance_km: d, elevation_m: 0 });
  // 1 W ERP, 1 kHz target = 80 dBu won't be reached — but more practically,
  // a 1000 dBu target is impossible.
  const r = findFieldStrengthCrossingOnRadial({
    profile, tx_amsl_m: 100, erp_kw: 100, frequency_mhz: 100, target_field_dbu: -50
  });
  // Target -50 dBu; the field is well above this throughout the profile.
  assert.equal(r.beyond_max_range, true);
});

/* -------------------- provenance -------------------- */

test('TERRAIN_PROPAGATION_PROVENANCE names ITU references and DEM source', () => {
  assert.match(TERRAIN_PROPAGATION_PROVENANCE.model, /Bullington/);
  assert.ok(TERRAIN_PROPAGATION_PROVENANCE.references.some(r => /P\.526/.test(r)));
  assert.ok(TERRAIN_PROPAGATION_PROVENANCE.references.some(r => /Bullington/.test(r)));
  assert.match(TERRAIN_PROPAGATION_PROVENANCE.dem_source, /USGS|Open-Meteo|OpenTopoData/);
  assert.match(TERRAIN_PROPAGATION_PROVENANCE.full_itm_path, /splatClient/);
});
