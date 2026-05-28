// FCC AM groundwave engine tests.
//
// REFERENCE
//   The vendored fcc/contours-api-node controllers/gwave.js implements
//   the FCC §73.184 Sommerfeld-Norton attenuation evaluation on top of
//   data/gwave_field.json (FCC pre-tabulated field strengths: 120
//   frequencies × 8 conductivity values × 230 distances at 1 kW).
//
// PROPERTIES PINNED
//   1. Distance-vs-field is monotone decreasing.  (Larger target field
//      strength → shorter distance.)
//   2. Distance scales with √(ERP).  Doubling ERP increases the field
//      strength at any distance by √2 ≈ 1.414, so the distance to a
//      fixed field threshold expands proportionally — but NOT in a
//      simple linear way for a finite-conductivity ground.
//   3. Higher conductivity (σ) → longer distance to a given field.
//   4. Higher frequency → shorter distance to a given field (more
//      ground absorption at higher kHz).
//   5. Round-trip: amDistance() at field F, then amField() at that
//      distance, returns F.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fccAmDistanceKm,
  fccAmFieldMvmAtDistance,
  FCC_AM_PROVENANCE
} from '../engine/curves/fcc/index.mjs';
import { amRadialTable, amWarnings } from '../engine/am/groundwave.js';

test('FCC AM distance: monotone decreasing in target field strength', () => {
  // 1 kW, 1240 kHz, σ = 4 mS/m.  Increasing target dBu → shorter distance.
  const a = fccAmDistanceKm({ frequency_khz: 1240, target_mvm: 5,   conductivity_msm: 4, erp_kw: 1 }).distance_km;
  const b = fccAmDistanceKm({ frequency_khz: 1240, target_mvm: 2,   conductivity_msm: 4, erp_kw: 1 }).distance_km;
  const c = fccAmDistanceKm({ frequency_khz: 1240, target_mvm: 0.5, conductivity_msm: 4, erp_kw: 1 }).distance_km;
  assert.ok(a < b && b < c,
    `expected monotone d(5) < d(2) < d(0.5); got ${a.toFixed(2)}, ${b.toFixed(2)}, ${c.toFixed(2)}`);
});

test('FCC AM distance: higher conductivity → longer distance', () => {
  // Hold everything else fixed.  Sandy/dry σ=1 vs sea/swamp σ=8.
  const dry = fccAmDistanceKm({ frequency_khz: 1240, target_mvm: 0.5, conductivity_msm: 1, erp_kw: 1 }).distance_km;
  const wet = fccAmDistanceKm({ frequency_khz: 1240, target_mvm: 0.5, conductivity_msm: 8, erp_kw: 1 }).distance_km;
  assert.ok(wet > dry,
    `expected d(σ=8) > d(σ=1) for fixed field; got ${dry.toFixed(2)} vs ${wet.toFixed(2)}`);
});

test('FCC AM distance: higher frequency → shorter distance', () => {
  // 540 kHz vs 1700 kHz at the same target / σ / ERP.
  const lo = fccAmDistanceKm({ frequency_khz:  540, target_mvm: 0.5, conductivity_msm: 4, erp_kw: 1 }).distance_km;
  const hi = fccAmDistanceKm({ frequency_khz: 1700, target_mvm: 0.5, conductivity_msm: 4, erp_kw: 1 }).distance_km;
  assert.ok(lo > hi,
    `expected d(540) > d(1700); got ${lo.toFixed(2)} vs ${hi.toFixed(2)}`);
});

test('FCC AM distance: ERP scaling — 50 kW > 1 kW for any fixed field', () => {
  const a = fccAmDistanceKm({ frequency_khz: 1240, target_mvm: 0.5, conductivity_msm: 4, erp_kw:   1 }).distance_km;
  const b = fccAmDistanceKm({ frequency_khz: 1240, target_mvm: 0.5, conductivity_msm: 4, erp_kw:  50 }).distance_km;
  assert.ok(b > a, `50 kW must reach 0.5 mV/m farther than 1 kW; got 1kW=${a.toFixed(2)}, 50kW=${b.toFixed(2)}`);
});

test('FCC AM round-trip: distance → field → distance is consistent within 1 %', () => {
  const r = fccAmDistanceKm({ frequency_khz: 1240, target_mvm: 2, conductivity_msm: 4, erp_kw: 1 });
  const f = fccAmFieldMvmAtDistance({ frequency_khz: 1240, distance_km: r.distance_km, conductivity_msm: 4, erp_kw: 1 });
  const err = Math.abs(f - 2) / 2;
  assert.ok(err < 0.01, `round-trip field error ${(err * 100).toFixed(3)}%`);
});

/* ---------- input-range checks ---------- */

test('FCC AM: out-of-range frequency throws FCC_AM_FREQ_OUT_OF_RANGE', () => {
  assert.throws(
    () => fccAmDistanceKm({ frequency_khz: 100, target_mvm: 1, conductivity_msm: 4, erp_kw: 1 }),
    err => err.code === 'FCC_AM_FREQ_OUT_OF_RANGE'
  );
  assert.throws(
    () => fccAmDistanceKm({ frequency_khz: 2000, target_mvm: 1, conductivity_msm: 4, erp_kw: 1 }),
    err => err.code === 'FCC_AM_FREQ_OUT_OF_RANGE'
  );
});

test('FCC AM: σ outside FCC M3 (1..8) clamps to grid boundary + reports clamp direction', () => {
  // Engine policy changed: σ values outside the FCC M3 grid (1..8 mS/m
  // integer steps) now CLAMP to the nearest boundary instead of throwing.
  // This is intentional — wet/marine soils routinely exceed 8 mS/m and
  // the §73.184 boundary curve is the closest defined approximation;
  // hard-failing every AM compute over saltwater would be incorrect.
  // The clamp direction is reported on inputs.conductivity_clamp so the
  // validator can surface a recommendation.
  const lo = fccAmDistanceKm({ frequency_khz: 1240, target_mvm: 1, conductivity_msm: 0, erp_kw: 1 });
  assert.equal(lo.inputs.conductivity_clamp,   'low');
  assert.equal(lo.inputs.conductivity_msm,     1, 'low-side clamp lands on grid min (1 mS/m)');
  assert.equal(lo.inputs.conductivity_msm_raw, 0);
  assert.ok(Number.isFinite(lo.distance_km) && lo.distance_km > 0);

  const hi = fccAmDistanceKm({ frequency_khz: 1240, target_mvm: 1, conductivity_msm: 100, erp_kw: 1 });
  assert.equal(hi.inputs.conductivity_clamp,   'high');
  assert.equal(hi.inputs.conductivity_msm,     8, 'high-side clamp lands on grid max (8 mS/m)');
  assert.equal(hi.inputs.conductivity_msm_raw, 100);
  assert.ok(Number.isFinite(hi.distance_km) && hi.distance_km > 0);

  // Non-finite σ still throws — it's a structurally invalid input, not
  // an out-of-grid value the boundary curve can substitute for.
  assert.throws(
    () => fccAmDistanceKm({ frequency_khz: 1240, target_mvm: 1, conductivity_msm: NaN, erp_kw: 1 }),
    err => err.code === 'FCC_AM_SIGMA_INVALID'
  );
});

test('FCC AM: ERP <= 0 or non-numeric throws FCC_AM_ERP_INVALID', () => {
  assert.throws(
    () => fccAmDistanceKm({ frequency_khz: 1240, target_mvm: 1, conductivity_msm: 4, erp_kw: 0 }),
    err => err.code === 'FCC_AM_ERP_INVALID'
  );
  assert.throws(
    () => fccAmDistanceKm({ frequency_khz: 1240, target_mvm: 1, conductivity_msm: 4, erp_kw: -1 }),
    err => err.code === 'FCC_AM_ERP_INVALID'
  );
});

/* ---------- engine-level integration ---------- */

test('amRadialTable: 36-radial AM @ 1240 kHz / 1 kW / σ=4 / ND', () => {
  const radials_deg = Array.from({length: 36}, (_, i) => i * 10);
  const t = amRadialTable({
    erp_kW:           1,
    frequency_khz:    1240,
    conductivity_msm: 4,
    patternFactorFn:  () => 1,
    radials_deg
  });
  assert.equal(t.length, 36);
  // For ND, every radial should have the same distances.
  const ref = t[0].contour_distances_km;
  for (const r of t){
    for (const k of Object.keys(ref)){
      assert.ok(Number.isFinite(r.contour_distances_km[k]),
        'every contour distance must be a real number for in-range AM inputs');
      assert.equal(r.contour_distances_km[k], ref[k],
        'ND pattern must produce identical distances on every radial');
    }
  }
  // Reference field at 1 km = 100·sqrt(1) = 100 mV/m.
  assert.equal(t[0].reference_field_mVm_at_1km, 100);
});

test('amRadialTable: directional pattern reduces distances on attenuated azimuths', () => {
  const radials_deg = [0, 90, 180, 270];
  const factor = (az) => az === 180 ? 0.4 : 1.0;   // 60% null to the south
  const t = amRadialTable({
    erp_kW:           50,
    frequency_khz:    830,
    conductivity_msm: 8,
    patternFactorFn:  factor,
    radials_deg
  });
  const dNorth = t[0].contour_distances_km.primary_2mvm;
  const dSouth = t[2].contour_distances_km.primary_2mvm;
  assert.ok(dSouth < dNorth,
    `directional null at 180° must shorten primary contour: north ${dNorth.toFixed(2)} km, south ${dSouth.toFixed(2)} km`);
});

test('amWarnings: emits FCC_METHOD_MISSING for out-of-range inputs', () => {
  const w1 = amWarnings({ frequency_khz: 100,  conductivity_msm: 4, erp_kw: 1 });
  assert.ok(w1.some(w => w.code === 'FCC_METHOD_MISSING'));
  const w2 = amWarnings({ frequency_khz: 1240, conductivity_msm: 0, erp_kw: 1 });
  assert.ok(w2.some(w => w.code === 'FCC_METHOD_MISSING'));
  const w3 = amWarnings({ frequency_khz: 1240, conductivity_msm: 4, erp_kw: 0 });
  assert.ok(w3.some(w => w.code === 'FCC_METHOD_MISSING'));
  const w4 = amWarnings({ frequency_khz: 1240, conductivity_msm: 4, erp_kw: 1 });
  assert.equal(w4.length, 0, 'in-range inputs must produce no warnings');
});

test('FCC_AM_PROVENANCE block carries upstream attribution', () => {
  assert.equal(FCC_AM_PROVENANCE.repo, 'github.com/fcc/contours-api-node');
  assert.ok(FCC_AM_PROVENANCE.commit.length === 40);
  assert.equal(FCC_AM_PROVENANCE.files.length, 2);
  for (const f of FCC_AM_PROVENANCE.files){
    assert.ok(f.path && f.sha256 && f.sha256.length === 64);
  }
});
