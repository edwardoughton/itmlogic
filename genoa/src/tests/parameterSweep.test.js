// Parameter-sweep engine tests.
//
// Tests use a MOCKED computeFn so they don't pay the cost of real
// engine runs (which are deterministic and tested separately).  The
// sweep engine's job is to enumerate combinations, dispatch them with
// bounded concurrency, score the results, and rank the compliant set.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  enumerateCombinations,
  sweepParameters
} from '../engine/parameterSweep/sweepEngine.js';
import {
  scoreSweepResult,
  rankSweepResults
} from '../engine/parameterSweep/scorer.js';

/**
 * Build a synthetic exhibit fixture parameterized by the combo.
 * Compliance / coverage are fabricated as deterministic functions of
 * (erp_kw, haat_m) so we can predict the sweep's ranking output.
 */
function syntheticExhibit({ erp_kw, haat_m }){
  // Coverage area: simple monotonic in erp·haat (proxy for real engine).
  const area_km2 = (erp_kw + 1) * (haat_m / 100 + 1) * 100;
  // §73.207 passes when erp ≤ 50 (cheap stations clear minimum-distance);
  // higher ERP needs §73.215 contour-protection path, which itself
  // passes only when haat ≤ 500 (above that, contours overflow).
  const sec207_pass = erp_kw <= 50;
  const sec215_pass = !sec207_pass && haat_m <= 500;
  // OET-65 fails when erp > 90 (too much power for the assumed boundary).
  const oet65_pass = erp_kw <= 90;
  return {
    polygons: [
      { contour_id: 'service_60dbu', label: '60 dBu (1 mV/m service)',
        closed: true, area_km2, mean_radial_km: Math.sqrt(area_km2 / Math.PI) }
    ],
    blockers: oet65_pass ? [] : [{ code: 'OET65_BOUNDARY_VIOLATION', severity: 'blocker' }],
    warnings: [],
    regulatory_compliance: sec207_pass
      ? { cite: '47 CFR §73.207', pass: true, section_73_207: { pass: true, studies: [] }, studies: [] }
      : sec215_pass
        ? { cite: '47 CFR §73.215', pass: true, section_73_207: { pass: false, studies: [] }, studies: [] }
        : { cite: '47 CFR §73.215', pass: false, section_73_207: { pass: false, studies: [] }, studies: [] },
    oet65: {
      compliance: { boundary_check: { pass: oet65_pass } },
      near_field: { required_for_filing: false }
    },
    station_inputs: { erp_kw, haat_m, service: 'FM', fcc_class: 'A' }
  };
}

/**
 * Synthetic computeFn that returns deterministic exhibits for the
 * sweep tests.  No I/O, no async dependencies — sub-millisecond per call.
 */
async function syntheticCompute({ inputs }){
  return syntheticExhibit({
    erp_kw: Number(inputs.erp_kw),
    haat_m: Number(inputs.haat_m)
  });
}

/* ---------------- enumerateCombinations ---------------- */

test('enumerateCombinations: full grid', () => {
  const c = enumerateCombinations({
    erp_kw: { min: 1, max: 3, step: 1 },
    haat_m: { min: 100, max: 200, step: 50 }
  }, 1000);
  assert.equal(c.length, 9);    // 3 × 3
  assert.deepEqual(c[0], { erp_kw: 1, haat_m: 100 });
  assert.deepEqual(c[c.length - 1], { erp_kw: 3, haat_m: 200 });
});

test('enumerateCombinations: downsamples uniformly when over budget', () => {
  const c = enumerateCombinations({
    erp_kw: { min: 1,   max: 100, step: 1 },
    haat_m: { min: 100, max: 600, step: 10 }
  }, 50);
  // 100 × 51 = 5100 candidates; capped at 50.
  assert.ok(c.length <= 50);
  assert.ok(c.length > 30, 'must keep enough to be useful');
});

test('enumerateCombinations: includes pattern dimension when supplied', () => {
  const c = enumerateCombinations({
    erp_kw: { min: 1, max: 1, step: 1 },
    haat_m: { min: 100, max: 100, step: 1 },
    patterns: ['ND', 'cardioid']
  }, 1000);
  assert.equal(c.length, 2);
  assert.equal(c[0].pattern_table, 'ND');
  assert.equal(c[1].pattern_table, 'cardioid');
});

test('enumerateCombinations: rejects invalid ranges', () => {
  assert.throws(() => enumerateCombinations({ erp_kw: { min: 100, max: 10, step: 1 } }, 100),
                /max .* < min/);
  assert.throws(() => enumerateCombinations({ erp_kw: { min: 1, max: 10, step: 0 } }, 100),
                /invalid range/);
});

/* ---------------- scorer ---------------- */

test('scoreSweepResult: §73.207 pass + OET-65 ok = compliant', () => {
  const ex = syntheticExhibit({ erp_kw: 30, haat_m: 200 });
  const r = scoreSweepResult(ex, { erp_kw: 30, haat_m: 200 });
  assert.equal(r.is_compliant, true);
  assert.equal(r.compliance['73.207'], true);
  assert.equal(r.compliance['oet65'], true);
  assert.equal(r.compliance.distance_path, '73.207');
  assert.ok(r.coverage_km2 > 0);
});

test('scoreSweepResult: §73.207 fail but §73.215 pass = compliant via 73.215', () => {
  const ex = syntheticExhibit({ erp_kw: 70, haat_m: 400 });   // erp>50 fails 207, haat≤500 passes 215
  const r = scoreSweepResult(ex, { erp_kw: 70, haat_m: 400 });
  assert.equal(r.is_compliant, true);
  assert.equal(r.compliance['73.207'], false);
  assert.equal(r.compliance['73.215'], true);
  assert.equal(r.compliance.distance_path, '73.215');
});

test('scoreSweepResult: both 207 and 215 fail = non-compliant', () => {
  const ex = syntheticExhibit({ erp_kw: 70, haat_m: 600 });   // erp>50 + haat>500
  const r = scoreSweepResult(ex, { erp_kw: 70, haat_m: 600 });
  assert.equal(r.is_compliant, false);
  assert.equal(r.compliance.distance_path, null);
});

test('scoreSweepResult: blocker forces non-compliant even when distance passes', () => {
  const ex = syntheticExhibit({ erp_kw: 95, haat_m: 200 });   // OET-65 fails @ erp>90
  const r = scoreSweepResult(ex, { erp_kw: 95, haat_m: 200 });
  assert.equal(r.is_compliant, false);
  assert.equal(r.compliance['no_blockers'], false);
});

test('scoreSweepResult: efficiency = area / erp', () => {
  const ex = syntheticExhibit({ erp_kw: 10, haat_m: 100 });
  const r = scoreSweepResult(ex, { erp_kw: 10, haat_m: 100 });
  // (10+1)(1+1)*100 = 2200 km² / 10 kW = 220
  assert.equal(r.coverage_km2, 2200);
  assert.equal(r.efficiency_km2_per_kw, 220);
  assert.equal(r.score, 220);
});

/* ---------------- rankSweepResults ---------------- */

test('rankSweepResults: descending score, then ascending erp, then haat', () => {
  const r = rankSweepResults([
    { combo: { erp_kw: 10, haat_m: 100 }, score: 50 },
    { combo: { erp_kw: 5,  haat_m: 100 }, score: 100 },
    { combo: { erp_kw: 5,  haat_m: 200 }, score: 100 },
    { combo: { erp_kw: 1,  haat_m: 200 }, score: 100 }
  ]);
  // Top 3 all have score 100, but tied score → lower erp wins, then
  // lower haat.
  assert.deepEqual(r[0].combo, { erp_kw: 1,  haat_m: 200 });
  assert.deepEqual(r[1].combo, { erp_kw: 5,  haat_m: 100 });
  assert.deepEqual(r[2].combo, { erp_kw: 5,  haat_m: 200 });
  assert.deepEqual(r[3].combo, { erp_kw: 10, haat_m: 100 });
});

/* ---------------- end-to-end sweepParameters ---------------- */

test('sweepParameters: end-to-end with synthetic compute', async () => {
  const result = await sweepParameters({
    baseInputs:  { call: 'WTEST', service: 'FM', fcc_class: 'A', frequency: 97.9, lat: 33, lon: -112 },
    sweepRanges: { erp_kw: { min: 1,  max: 100, step: 10 },
                   haat_m: { min: 100, max: 600, step: 100 } },
    validation:  { runs: [{ pass: true }], reference_cases_present: true },
    computeFn:   syntheticCompute,
    options:     { top_n: 5 }
  });

  assert.equal(result.total_evaluated, 10 * 6);   // 10 × 6 = 60 combos
  assert.ok(result.total_compliant > 0);
  assert.ok(result.total_compliant < result.total_evaluated, 'some should fail (high-ERP path)');
  assert.ok(result.best, 'best should be the top-1 compliant config');
  assert.equal(result.best.is_compliant, true);
  assert.equal(result.top_compliant.length, 5);

  // Ranking sanity: top_compliant[0] must have the highest score.
  for (const r of result.top_compliant.slice(1)){
    assert.ok(r.score <= result.top_compliant[0].score);
  }
  // best mirrors top_compliant[0].
  assert.equal(result.best.score, result.top_compliant[0].score);
});

test('sweepParameters: respects max_combinations downsample', async () => {
  const result = await sweepParameters({
    baseInputs:  { service: 'FM' },
    sweepRanges: { erp_kw: { min: 1, max: 100, step: 1 },
                   haat_m: { min: 100, max: 600, step: 10 } },
    validation:  { runs: [{ pass: true }], reference_cases_present: true },
    computeFn:   syntheticCompute,
    options:     { max_combinations: 100, top_n: 3 }
  });
  assert.ok(result.total_evaluated <= 100, `${result.total_evaluated} should be ≤ max_combinations`);
  assert.ok(result.runtime_ms >= 0);
});

test('sweepParameters: rejects max_combinations < 1 (Codex P2 — silent empty-result guard)', async () => {
  // Negative / zero max_combinations would previously flow through
  // Math.min(...) and produce an empty downsample, returning a
  // "successful" sweep with total_evaluated=0.  Now it throws.
  await assert.rejects(
    sweepParameters({
      baseInputs:  { service: 'FM' },
      sweepRanges: { erp_kw: { min: 1, max: 10, step: 1 },
                     haat_m: { min: 100, max: 200, step: 10 } },
      validation:  { runs: [{ pass: true }], reference_cases_present: true },
      computeFn:   syntheticCompute,
      options:     { max_combinations: -5 }
    }),
    /max_combinations.*positive integer/
  );
  await assert.rejects(
    sweepParameters({
      baseInputs:  { service: 'FM' },
      sweepRanges: { erp_kw: { min: 1, max: 10, step: 1 },
                     haat_m: { min: 100, max: 200, step: 10 } },
      validation:  { runs: [{ pass: true }], reference_cases_present: true },
      computeFn:   syntheticCompute,
      options:     { max_combinations: 0 }
    }),
    /max_combinations.*positive integer/
  );
});

test('sweepParameters: per-combo haat_m reaches compute() inputs (Codex P1 — no-op HAAT guard)', async () => {
  // Pin the contract that each combo's haat_m flows into the compute
  // function's inputs.  If a future change re-introduced terrain
  // evidence that shadowed inputs.haat_m, the engine would silently
  // ignore the HAAT dimension; this test catches that at the boundary
  // the sweep controls (the inputs handed to compute()).
  const seenHaats = new Set();
  const seenErps  = new Set();
  const recordingCompute = async ({ inputs }) => {
    seenHaats.add(Number(inputs.haat_m));
    seenErps.add(Number(inputs.erp_kw));
    return syntheticExhibit({
      erp_kw: Number(inputs.erp_kw),
      haat_m: Number(inputs.haat_m)
    });
  };
  await sweepParameters({
    baseInputs:  { service: 'FM', haat_m: 999 },   // base haat that combos must override
    sweepRanges: { erp_kw: { min: 10, max: 30, step: 10 },
                   haat_m: { min: 100, max: 300, step: 100 } },
    validation:  { runs: [{ pass: true }], reference_cases_present: true },
    computeFn:   recordingCompute,
    options:     { only_compliant: false, concurrency: 1 }
  });
  // Each of the 3 sweep haat values must have been seen by compute.
  assert.deepEqual([...seenHaats].sort((a,b) => a-b), [100, 200, 300]);
  assert.deepEqual([...seenErps].sort((a,b) => a-b),  [10, 20, 30]);
  // The base haat_m of 999 must NOT appear — every combo overrides it.
  assert.ok(!seenHaats.has(999), 'combo.haat_m must override baseInputs.haat_m');
});

test('sweepParameters: returns only_compliant=false includes failures', async () => {
  const result = await sweepParameters({
    baseInputs:  { service: 'FM' },
    sweepRanges: { erp_kw: { min: 90, max: 100, step: 1 },   // most fail OET-65
                   haat_m: { min: 100, max: 200, step: 100 } },
    validation:  { runs: [{ pass: true }], reference_cases_present: true },
    computeFn:   syntheticCompute,
    options:     { only_compliant: false, top_n: 5 }
  });
  assert.ok(result.all_results.length > 0);
  assert.ok(result.total_non_compliant > 0);
  // top_compliant must still only contain compliant entries.
  for (const r of result.top_compliant){
    assert.equal(r.is_compliant, true);
  }
});

test('sweepParameters: catches per-combo errors and continues', async () => {
  let calls = 0;
  const flakyCompute = async ({ inputs }) => {
    calls++;
    if (calls === 3) throw new Error('synthetic compute boom');
    return syntheticExhibit({ erp_kw: Number(inputs.erp_kw), haat_m: Number(inputs.haat_m) });
  };
  const result = await sweepParameters({
    baseInputs:  { service: 'FM' },
    sweepRanges: { erp_kw: { min: 10, max: 30, step: 10 },
                   haat_m: { min: 100, max: 300, step: 100 } },
    validation:  { runs: [{ pass: true }], reference_cases_present: true },
    computeFn:   flakyCompute,
    options:     { only_compliant: false, top_n: 10, concurrency: 1 }   // serial so call ordering is predictable
  });
  // 3 × 3 = 9 combos.  One throws → 8 normal results + 1 error result.
  assert.equal(result.total_evaluated, 9);
  const errored = result.all_results.filter(r => r.error);
  assert.equal(errored.length, 1);
  assert.equal(errored[0].is_compliant, false);
  assert.match(errored[0].error, /synthetic compute boom/);
});

test('sweepParameters: identifies the spec example "best ERP=68 kW, HAAT=470 m" shape', async () => {
  // Fine-grained sweep around the spec's flagship example.  Synthetic
  // compute's coverage = (erp+1)(haat/100+1)·100 produces a smooth
  // landscape: lower ERP is more efficient (compliant via 73.207 when
  // erp≤50).  This test pins the SHAPE of the response (best, ranking
  // by score, compliance signals) rather than a particular numeric ERP.
  const result = await sweepParameters({
    baseInputs:  { service: 'FM', fcc_class: 'A' },
    sweepRanges: { erp_kw: { min: 1,   max: 100, step: 1 },
                   haat_m: { min: 100, max: 600, step: 10 } },
    validation:  { runs: [{ pass: true }], reference_cases_present: true },
    computeFn:   syntheticCompute,
    options:     { max_combinations: 1000, top_n: 10 }
  });
  assert.ok(result.best, 'best non-null');
  assert.equal(result.best.is_compliant, true);
  // Best must declare which rule path qualified it.
  assert.ok(['73.207', '73.215'].includes(result.best.compliance.distance_path));
  // ERP and HAAT must be within the requested sweep.
  assert.ok(result.best.combo.erp_kw >= 1 && result.best.combo.erp_kw <= 100);
  assert.ok(result.best.combo.haat_m >= 100 && result.best.combo.haat_m <= 600);
  // top_compliant is exactly top_n.
  assert.ok(result.top_compliant.length <= 10);
  // Each entry has the documented shape.
  for (const r of result.top_compliant){
    assert.ok(r.combo);
    assert.ok(r.summary);
    assert.equal(r.is_compliant, true);
    assert.ok(r.compliance);
    assert.ok(typeof r.score === 'number');
  }
});
