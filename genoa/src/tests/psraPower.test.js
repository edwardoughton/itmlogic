import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reducedPowerForOnePair,
  computePsraPssaPower,
  PSRA_PSSA_POWER_PROVENANCE
} from '../engine/am/psraPower.js';

/* ---------- reducedPowerForOnePair (closed-form) ---------- */

test('reducedPowerForOnePair: E_max / E_actual = 1 → P = P_daytime', () => {
  const r = reducedPowerForOnePair({
    p_daytime_kw: 5, e_actual_uv_m: 100, e_max_allowed_uv_m: 100
  });
  assert.equal(r.p_allowed_w, 5000);  // 5 kW expressed in watts
  assert.equal(r.scale_factor, 1);
});

test('reducedPowerForOnePair: halving field allowance scales power by 1/4', () => {
  const r = reducedPowerForOnePair({
    p_daytime_kw: 10, e_actual_uv_m: 100, e_max_allowed_uv_m: 50
  });
  // (50/100)^2 = 0.25 → 10 kW × 0.25 = 2.5 kW = 2500 W
  assert.equal(r.p_allowed_w, 2500);
  assert.equal(r.scale_factor, 0.25);
});

test('reducedPowerForOnePair: third of actual allowed → ~1/9 power', () => {
  const r = reducedPowerForOnePair({
    p_daytime_kw: 1, e_actual_uv_m: 90, e_max_allowed_uv_m: 30
  });
  // (30/90)^2 = 0.111… → 1000 W × 0.111 ≈ 111.11 W
  assert.ok(Math.abs(r.p_allowed_w - 111.11) < 0.1);
});

test('reducedPowerForOnePair: bad inputs → NaN', () => {
  for (const bad of [
    { p_daytime_kw: NaN, e_actual_uv_m: 100, e_max_allowed_uv_m: 50 },
    { p_daytime_kw: 0,   e_actual_uv_m: 100, e_max_allowed_uv_m: 50 },
    { p_daytime_kw: 5,   e_actual_uv_m: 0,   e_max_allowed_uv_m: 50 },
    { p_daytime_kw: 5,   e_actual_uv_m: 100, e_max_allowed_uv_m: -1 }
  ]){
    const r = reducedPowerForOnePair(bad);
    assert.ok(Number.isNaN(r.p_allowed_w), `expected NaN for ${JSON.stringify(bad)}`);
  }
});

/* ---------- computePsraPssaPower guards ---------- */

test('computePsraPssaPower: rejects missing/invalid p_daytime_kw', () => {
  assert.equal(computePsraPssaPower({}).ok, false);
  assert.equal(computePsraPssaPower({ proposed: { p_daytime_kw: 0 } }).ok, false);
  assert.equal(computePsraPssaPower({ proposed: { p_daytime_kw: -1 } }).ok, false);
  assert.equal(computePsraPssaPower({ proposed: { p_daytime_kw: 'abc' } }).ok, false);
});

/* ---------- end-to-end PSRA/PSSA ---------- */

const PROPOSED = { p_daytime_kw: 5, call: 'WTST', freq_khz: 700, fcc_class: 'B' };

test('computePsraPssaPower: no protected pairs → ceiling-only verdict', () => {
  const r = computePsraPssaPower({ proposed: PROPOSED, protected_pairs: [] });
  assert.equal(r.ok, true);
  assert.equal(r.pssa.p_reduced_w, 500);
  assert.equal(r.psra.p_reduced_w, 500);
  assert.equal(r.pssa.ceiling_applied, true);
  assert.equal(r.psra.ceiling_applied, true);
  assert.equal(r.pssa.binding, null);
});

test('computePsraPssaPower: PSSA binding picks the SMALLEST allowed power', () => {
  // Two protected pairs, both PSSA only.  WLOOSE allows 2500 W
  // (over the ceiling), WTIGHT allows 50 W (under the ceiling).
  // Result: PSSA reduced power = 50 W bound by WTIGHT.
  const r = computePsraPssaPower({
    proposed: PROPOSED,
    protected_pairs: [
      { call: 'WLOOSE', relation: 'co_channel',
        pssa: { e_actual_uv_m: 100, e_max_allowed_uv_m: 50 } },   // (50/100)^2 · 5 kW = 1250 W… recompute below
      { call: 'WTIGHT', relation: 'co_channel',
        pssa: { e_actual_uv_m: 100, e_max_allowed_uv_m: 10 } }    // (10/100)^2 · 5 kW = 50 W
    ]
  });
  assert.equal(r.ok, true);
  assert.equal(r.pssa.binding.call, 'WTIGHT');
  assert.equal(r.pssa.p_reduced_w, 50);
  assert.equal(r.pssa.ceiling_applied, false);
});

test('computePsraPssaPower: PSSA clips to 500 W ceiling when all pairs are looser', () => {
  const r = computePsraPssaPower({
    proposed: PROPOSED,
    protected_pairs: [
      { call: 'WA', relation: 'co_channel',
        pssa: { e_actual_uv_m: 100, e_max_allowed_uv_m: 80 } },   // → 3200 W
      { call: 'WB', relation: 'co_channel',
        pssa: { e_actual_uv_m: 100, e_max_allowed_uv_m: 60 } }    // → 1800 W
    ]
  });
  assert.equal(r.pssa.p_reduced_w, 500);
  assert.equal(r.pssa.ceiling_applied, true);
  // Binding pair still surfaced — engineer knows the formula picked WB
  // even though 500 W ceiling is what they file.
  assert.equal(r.pssa.binding.call, 'WB');
  assert.match(r.pssa.note, /500 W ceiling/);
});

test('computePsraPssaPower: PSRA vs PSSA evaluated independently (10% vs 50% skywave)', () => {
  // Same proposed station; PSRA fields are smaller (10% skywave is
  // weaker), so PSRA can allow more power.  Provide separate
  // pssa/psra blocks to model that.
  const r = computePsraPssaPower({
    proposed: PROPOSED,
    protected_pairs: [{
      call: 'WLAW', relation: 'co_channel',
      pssa: { e_actual_uv_m: 100, e_max_allowed_uv_m: 25 },   // tight → 312.5 W
      psra: { e_actual_uv_m: 70,  e_max_allowed_uv_m: 25 }    // looser → 638 W → clips to 500 W
    }]
  });
  assert.equal(r.pssa.p_reduced_w, 312.5);
  assert.equal(r.pssa.ceiling_applied, false);
  assert.equal(r.psra.ceiling_applied, true);
  assert.equal(r.psra.p_reduced_w, 500);
  // Pools tagged with the right %time
  assert.equal(r.pssa.percent_time, 50);
  assert.equal(r.psra.percent_time, 10);
});

test('computePsraPssaPower: pair with only PSSA block surfaces only in PSSA pool', () => {
  const r = computePsraPssaPower({
    proposed: PROPOSED,
    protected_pairs: [{
      call: 'WPSSAONLY', relation: 'first_adjacent',
      pssa: { e_actual_uv_m: 100, e_max_allowed_uv_m: 30 }
      // psra omitted — no PSRA protection (e.g. station that doesn't operate PSRA)
    }]
  });
  assert.equal(r.pssa.per_pair.length, 1);
  assert.equal(r.psra.per_pair.length, 0);
  assert.equal(r.psra.p_reduced_w, 500);   // ceiling-only when pool is empty
});

test('computePsraPssaPower: regulation + ceiling stamped on response', () => {
  const r = computePsraPssaPower({ proposed: PROPOSED });
  assert.match(r.regulation, /73\.99\(b\)\(1\)/);
  assert.match(r.regulation, /73\.99\(b\)\(2\)/);
  assert.equal(r.ceiling_w, 500);
  assert.ok(Array.isArray(r.notes) && r.notes.length >= 2);
});

/* ---------- Codex P2: null protected_pairs ---------- */

test('computePsraPssaPower: protected_pairs=null does not throw — treats as empty', () => {
  const r = computePsraPssaPower({ proposed: PROPOSED, protected_pairs: null });
  assert.equal(r.ok, true);
  assert.equal(r.pssa.p_reduced_w, 500);   // ceiling-only path
  assert.equal(r.psra.p_reduced_w, 500);
});

test('computePsraPssaPower: protected_pairs=undefined treats as empty', () => {
  const r = computePsraPssaPower({ proposed: PROPOSED });
  assert.equal(r.ok, true);
  assert.equal(r.pssa.p_reduced_w, 500);
});

test('computePsraPssaPower: protected_pairs as non-array rejected', () => {
  for (const bad of [{ pssa: {} }, 'wat', 42]){
    const r = computePsraPssaPower({ proposed: PROPOSED, protected_pairs: bad });
    assert.equal(r.ok, false);
    assert.match(r.error, /protected_pairs/);
  }
});

/* ---------- Codex P1: all-NaN pool fails closed, not open ---------- */

test('computePsraPssaPower: pool of all-NaN pairs → available:false (NOT 500 W fail-open)', () => {
  // Bad upstream data: e_actual_uv_m === 0 → NaN p_allowed_w.
  // If the engine fell open to 500 W, an engineer would file a
  // filing-grade power that wasn't actually computed.  Surface
  // as available:false instead.
  const r = computePsraPssaPower({
    proposed: PROPOSED,
    protected_pairs: [
      { call: 'WBAD', pssa: { e_actual_uv_m: 0,   e_max_allowed_uv_m: 10 } },
      { call: 'WWAR', pssa: { e_actual_uv_m: NaN, e_max_allowed_uv_m: 10 } }
    ]
  });
  assert.equal(r.ok, true);
  assert.equal(r.pssa.available, false);
  assert.equal(r.pssa.p_reduced_w, null);
  assert.equal(r.pssa.ceiling_applied, false);
  assert.match(r.pssa.error, /NaN/);
});

test('computePsraPssaPower: mixed valid + NaN pool still computes from the valid ones', () => {
  const r = computePsraPssaPower({
    proposed: PROPOSED,
    protected_pairs: [
      { call: 'WBAD',   pssa: { e_actual_uv_m: 0,   e_max_allowed_uv_m: 10 } },
      { call: 'WGOOD',  pssa: { e_actual_uv_m: 100, e_max_allowed_uv_m: 10 } }
    ]
  });
  assert.equal(r.pssa.available, true);
  assert.equal(r.pssa.binding.call, 'WGOOD');
  assert.equal(r.pssa.p_reduced_w, 50);   // (10/100)^2 · 5kW = 50 W
});

test('computePsraPssaPower: genuine zero protected pairs still uses ceiling (NOT the NaN-error path)', () => {
  const r = computePsraPssaPower({ proposed: PROPOSED, protected_pairs: [] });
  assert.equal(r.pssa.available, true);
  assert.equal(r.pssa.p_reduced_w, 500);
  assert.equal(r.pssa.ceiling_applied, true);
});

/* ---------- provenance ---------- */

test('PSRA_PSSA_POWER_PROVENANCE names §73.99(b)(1)/(2) + 17 USC §105', () => {
  assert.match(PSRA_PSSA_POWER_PROVENANCE.regulation, /73\.99\(b\)\(1\)/);
  assert.match(PSRA_PSSA_POWER_PROVENANCE.regulation, /73\.99\(b\)\(2\)/);
  assert.match(PSRA_PSSA_POWER_PROVENANCE.license_basis, /17 USC §105/);
});
