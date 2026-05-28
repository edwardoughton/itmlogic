// 47 CFR §1.1310 / OET Bulletin 65 RF exposure tests.
//
// Tests cover:
//   - §1.1310 MPE limit table at every band edge for both classes
//   - Power density formula sanity (1/R², sqrt(P), pattern factor)
//   - Free-space vs ground-reflection (4× factor)
//   - Compliance distance against known reference cases
//   - Near-field boundary detection for AM-band stations
//   - Site-boundary check pass / fail
//   - Whole-study cite + provenance

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  mpeLimits,
  powerDensity_mW_cm2,
  complianceDistance_m,
  nearFieldBoundary_m,
  checkOet65,
  OET65_PROVENANCE
} from '../engine/regulatory/oet65.js';

/* -------------------- §1.1310 MPE limits -------------------- */

test('mpeLimits: FM band (88.1–107.9 MHz) → uncontrolled 0.2, controlled 1.0', () => {
  for (const f of [88.1, 100.7, 107.9]){
    assert.equal(mpeLimits(f, 'uncontrolled').S_mw_cm2, 0.2, `uncontrolled @ ${f} MHz`);
    assert.equal(mpeLimits(f, 'controlled'  ).S_mw_cm2, 1.0, `controlled @ ${f} MHz`);
  }
});

test('mpeLimits: AM band 1.34–30 MHz uncontrolled = 180/f²', () => {
  // At 1.7 MHz: 180 / 2.89 ≈ 62.28
  const r = mpeLimits(1.7, 'uncontrolled');
  assert.ok(Math.abs(r.S_mw_cm2 - 62.28) < 0.5, `expected ~62.28, got ${r.S_mw_cm2}`);
  assert.match(r.basis, /180\/f²/);
});

test('mpeLimits: AM band 0.3–1.34 MHz uncontrolled = 100 mW/cm²', () => {
  // At 0.54 MHz (low end of AM): 100 mW/cm² flat
  const r = mpeLimits(0.54, 'uncontrolled');
  assert.equal(r.S_mw_cm2, 100);
  // At 1.0 MHz: still 100
  assert.equal(mpeLimits(1.0, 'uncontrolled').S_mw_cm2, 100);
});

test('mpeLimits: controlled is always more permissive than uncontrolled at the same f', () => {
  for (const f of [0.54, 1.0, 1.7, 88.1, 100.7, 200, 500, 1500, 2400, 5000]){
    const u = mpeLimits(f, 'uncontrolled').S_mw_cm2;
    const c = mpeLimits(f, 'controlled'  ).S_mw_cm2;
    if (u != null && c != null){
      assert.ok(c >= u, `controlled (${c}) should be >= uncontrolled (${u}) at ${f} MHz`);
    }
  }
});

test('mpeLimits: bands above 1500 MHz → uncontrolled 1.0, controlled 5.0', () => {
  assert.equal(mpeLimits(2400, 'uncontrolled').S_mw_cm2, 1.0);
  assert.equal(mpeLimits(2400, 'controlled'  ).S_mw_cm2, 5.0);
});

test('mpeLimits: out-of-band frequencies return null with explanation', () => {
  const lo = mpeLimits(0.1, 'uncontrolled');
  assert.equal(lo.S_mw_cm2, null);
  assert.match(lo.basis, /below/);
  const hi = mpeLimits(150_000, 'uncontrolled');
  assert.equal(hi.S_mw_cm2, null);
  assert.match(hi.basis, /above/);
});

/* -------------------- power density -------------------- */

test('powerDensity_mW_cm2: 1/R² law', () => {
  const at_10 = powerDensity_mW_cm2({ erp_kw: 100, distance_m: 10 });
  const at_20 = powerDensity_mW_cm2({ erp_kw: 100, distance_m: 20 });
  // Doubling R should quarter S.
  assert.ok(Math.abs(at_10 / at_20 - 4) < 0.01, `1/R² ratio ${at_10/at_20}`);
});

test('powerDensity_mW_cm2: linear in ERP', () => {
  const p1 = powerDensity_mW_cm2({ erp_kw: 1,   distance_m: 100 });
  const p4 = powerDensity_mW_cm2({ erp_kw: 4,   distance_m: 100 });
  assert.ok(Math.abs(p4 / p1 - 4) < 0.001, `ERP scaling ${p4/p1}`);
});

test('powerDensity_mW_cm2: ground-reflection factor is 4× free-space', () => {
  const fs = powerDensity_mW_cm2({ erp_kw: 100, distance_m: 50, ground_reflection: false });
  const gr = powerDensity_mW_cm2({ erp_kw: 100, distance_m: 50, ground_reflection: true  });
  assert.ok(Math.abs(gr / fs - 4) < 0.01, `ground-reflection ratio ${gr/fs}`);
});

test('powerDensity_mW_cm2: pattern factor F² scaling', () => {
  const f1 = powerDensity_mW_cm2({ erp_kw: 100, distance_m: 50, pattern_factor: 1.0 });
  const f5 = powerDensity_mW_cm2({ erp_kw: 100, distance_m: 50, pattern_factor: 0.5 });
  // F=0.5 → F²=0.25 → S quartered
  assert.ok(Math.abs(f1 / f5 - 4) < 0.01, `F² scaling ${f1/f5}`);
});

/* -------------------- compliance distance -------------------- */

test('complianceDistance_m: 100 kW FM uncontrolled free-space ≈ 80.8 m', () => {
  // Reference: R = √(13.05 × 100 / 0.2) = √6525 ≈ 80.78 m
  const r = complianceDistance_m({
    erp_kw: 100, frequency_mhz: 100.7, exposure_class: 'uncontrolled'
  });
  assert.ok(Math.abs(r.distance_m - 80.78) < 0.5, `expected ≈ 80.78 m, got ${r.distance_m}`);
  assert.equal(r.mpe_mw_cm2, 0.2);
  assert.match(r.formula, /Eq\. 6/);
});

test('complianceDistance_m: 100 kW FM uncontrolled w/ ground-reflection ≈ 161.6 m', () => {
  // R = √(52.20 × 100 / 0.2) = √26100 ≈ 161.55 m
  const r = complianceDistance_m({
    erp_kw: 100, frequency_mhz: 100.7, exposure_class: 'uncontrolled',
    ground_reflection: true
  });
  assert.ok(Math.abs(r.distance_m - 161.55) < 1.0, `expected ≈ 161.55 m, got ${r.distance_m}`);
  assert.match(r.formula, /Eq\. 8/);
});

test('complianceDistance_m: controlled is ≈ √5 times shorter than uncontrolled (FM)', () => {
  const u = complianceDistance_m({ erp_kw: 6, frequency_mhz: 100.7, exposure_class: 'uncontrolled' });
  const c = complianceDistance_m({ erp_kw: 6, frequency_mhz: 100.7, exposure_class: 'controlled'   });
  // 0.2 vs 1.0 limit → distance ratio √5 ≈ 2.236
  const ratio = u.distance_m / c.distance_m;
  assert.ok(Math.abs(ratio - Math.sqrt(5)) < 0.01, `expected ≈ √5 = 2.236, got ${ratio.toFixed(3)}`);
});

/* -------------------- near-field boundary -------------------- */

test('nearFieldBoundary_m: 1 MHz AM ≈ 47.7 m', () => {
  // λ = c/f = 299792458/1e6 = 299.79 m;  λ/(2π) ≈ 47.71 m
  const nf = nearFieldBoundary_m(1.0);
  assert.ok(Math.abs(nf - 47.71) < 0.2, `expected ≈ 47.71 m, got ${nf}`);
});

test('nearFieldBoundary_m: 100 MHz FM ≈ 0.477 m (negligible)', () => {
  const nf = nearFieldBoundary_m(100);
  assert.ok(nf < 0.5, `expected sub-metre for FM, got ${nf}`);
});

/* -------------------- whole-study -------------------- */

test('checkOet65: 100 kW FM at 100.7 MHz produces both compliance distances', () => {
  const r = checkOet65({ erp_kw: 100, frequency_mhz: 100.7, service: 'FM' });
  assert.equal(r.cite, '47 CFR §1.1310');
  assert.equal(r.pass, true);
  assert.ok(r.compliance.uncontrolled.distance_m > 0);
  assert.ok(r.compliance.controlled.distance_m   > 0);
  assert.ok(r.compliance.uncontrolled.distance_m > r.compliance.controlled.distance_m);
  assert.match(r.method, /OET-65/);
});

test('checkOet65: AM-band study flags NEAR_FIELD_REQUIRED for low ERP', () => {
  // 1 kW AM at 1 MHz: compliance distance ≈ √(13.05 × 1 / 100) = 0.36 m
  // Well inside the 47.7 m near-field boundary → NEAR_FIELD_REQUIRED.
  const r = checkOet65({ erp_kw: 1, frequency_mhz: 1.0, service: 'AM' });
  assert.equal(r.near_field.required_for_filing, true);
  assert.match(r.notes.join(' '), /near-field/i);
});

test('checkOet65: site-boundary check passes when boundary exceeds compliance distance', () => {
  // 100 kW FM, boundary at 200 m — comfortably outside the 80 m uncontrolled.
  const r = checkOet65({
    erp_kw: 100, frequency_mhz: 100.7, service: 'FM',
    site_boundary_m: 200, site_height_m: 100
  });
  assert.equal(r.compliance.boundary_check.pass, true);
  assert.ok(r.compliance.boundary_check.power_density_mw_cm2 < 0.2);
  assert.ok(r.compliance.boundary_check.margin_db > 0);
});

test('checkOet65: site-boundary check fails when boundary is inside compliance distance', () => {
  // 100 kW FM, boundary at 30 m — well inside the 80 m uncontrolled.
  const r = checkOet65({
    erp_kw: 100, frequency_mhz: 100.7, service: 'FM',
    site_boundary_m: 30, site_height_m: 0
  });
  assert.equal(r.compliance.boundary_check.pass, false);
  assert.equal(r.pass, false);
  assert.ok(r.compliance.boundary_check.power_density_mw_cm2 > 0.2);
  assert.ok(r.compliance.boundary_check.margin_db < 0);
});

test('checkOet65: missing inputs return structured guard', () => {
  const r1 = checkOet65({ erp_kw: null, frequency_mhz: 100.7 });
  assert.equal(r1.pass, false);
  assert.match(r1.notes.join(' '), /erp_kw/);
  const r2 = checkOet65({ erp_kw: 100, frequency_mhz: null });
  assert.equal(r2.pass, false);
  assert.match(r2.notes.join(' '), /frequency_mhz/);
});

test('OET65_PROVENANCE names §1.1310 + OET-65 + license basis', () => {
  assert.match(OET65_PROVENANCE.regulation, /1\.1310/);
  assert.match(OET65_PROVENANCE.reference, /OET Bulletin 65/);
  assert.match(OET65_PROVENANCE.license_basis, /17 U\.S\.C\. § 105/);
  assert.match(OET65_PROVENANCE.formulas.free_space,        /13\.05/);
  assert.match(OET65_PROVENANCE.formulas.ground_reflection, /52\.20/);
});
