import test from 'node:test';
import assert from 'node:assert/strict';
import {
  augmentRankingWithCoverage,
  summarizeSplat,
  runWithConcurrency,
  COMPARABLES_COVERAGE_PROVENANCE
} from '../engine/comparablesCoverage.js';

const SUBJECT_TX = {
  lat: 40, lon: -75, frequency_mhz: 100.7, erp_kw: 6, haat_m: 100, call: 'WPRO'
};

function rankingResultWith(candidates){
  return {
    ok: true,
    subject: SUBJECT_TX,
    results: candidates,
    stats: { n_returned: candidates.length },
    regulation: '47 CFR §73.211 (test)'
  };
}

function mkComparator(i, opts = {}){
  return {
    facility_id: 1000 + i,
    call: `W${i}`,
    fcc_class: opts.fcc_class || 'A',
    lat: 40 + i * 0.1,
    lon: -75,
    frequency_mhz: 100.7,
    erp_kw: opts.erp_kw ?? 5,
    haat_m: opts.haat_m ?? 80,
    similarity_score: 0.9 - i * 0.05
  };
}

// Fake splat client.  Each call records its arrival in `inflight` so
// we can assert concurrency was bounded.  Returns a synthetic
// 36-radial coverage with mean ~30 km that scales with √erp.
function makeFakeSplat({ delayMs = 5, erpScale = 5, opts = {} } = {}){
  const calls = [];
  let inflight = 0, peakInflight = 0;
  return {
    calls,
    get peakInflight(){ return peakInflight; },
    async predictItmCoverage({ tx, ...rest }){
      inflight++;
      if (inflight > peakInflight) peakInflight = inflight;
      try {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (opts.failCalls && opts.failCalls.includes(tx.call)){
          return { available: false, error: `synthetic failure for ${tx.call}` };
        }
        const meanKm = 25 + Math.sqrt(Number(tx.erp_kw) || 1) * erpScale;
        const radials = Array.from({ length: 36 }, (_, k) => ({
          azimuth_deg: k * 10,
          distance_km: meanKm * (0.85 + 0.3 * Math.sin(k))
        }));
        calls.push({ tx, rest });
        return {
          available: true,
          source: 'splat-fake',
          engine: 'splat-itm',
          target_field_dbu: 60,
          radials
        };
      } finally {
        inflight--;
      }
    }
  };
}

/* ---------- summarizeSplat ---------- */

test('summarizeSplat: null → available:false with error', () => {
  const s = summarizeSplat(null);
  assert.equal(s.available, false);
  assert.match(s.error, /null/);
});

test('summarizeSplat: forwards available:false + sidecar_enhancement_required flag', () => {
  const s = summarizeSplat({ available: false, error: 'DEM_MISSING',
                             sidecar_enhancement_required: true });
  assert.equal(s.available, false);
  assert.equal(s.error, 'DEM_MISSING');
  assert.equal(s.sidecar_enhancement_required, true);
});

test('summarizeSplat: computes mean / min / max + service-area km² from radials', () => {
  const s = summarizeSplat({
    available: true,
    radials: [
      { azimuth_deg: 0,   distance_km: 30 },
      { azimuth_deg: 90,  distance_km: 50 },
      { azimuth_deg: 180, distance_km: 20 },
      { azimuth_deg: 270, distance_km: 40 }
    ]
  });
  assert.equal(s.available, true);
  assert.equal(s.n_radials, 4);
  assert.equal(s.n_blocked, 0);
  assert.equal(s.mean_radial_km, 35);
  assert.equal(s.min_radial_km, 20);
  assert.equal(s.max_radial_km, 50);
  // π/4 · (30² + 50² + 20² + 40²) = π/4 · 5400 = 1350π ≈ 4241.15
  assert.ok(Math.abs(s.service_area_km2 - 4241.15) < 0.05);
});

test('summarizeSplat: blocked radials counted, distance=0 excluded from stats', () => {
  const s = summarizeSplat({
    available: true,
    radials: [
      { azimuth_deg: 0, distance_km: 40 },
      { azimuth_deg: 90, blocked: true, distance_km: 0 },
      { azimuth_deg: 180, distance_km: 30 }
    ]
  });
  assert.equal(s.n_radials, 3);
  assert.equal(s.n_blocked, 1);
  assert.equal(s.mean_radial_km, 35);
});

/* ---------- runWithConcurrency ---------- */

test('runWithConcurrency: never exceeds the cap', async () => {
  let inflight = 0, peak = 0;
  const tasks = Array.from({ length: 20 }, () => async () => {
    inflight++; peak = Math.max(peak, inflight);
    await new Promise((r) => setTimeout(r, 5));
    inflight--;
  });
  await runWithConcurrency(tasks, 3);
  assert.ok(peak <= 3, `peak inflight ${peak} should not exceed 3`);
});

test('runWithConcurrency: one rejecting task does not abort the rest', async () => {
  let okCount = 0;
  const tasks = [
    async () => { throw new Error('boom'); },
    async () => { okCount++; },
    async () => { okCount++; },
    async () => { okCount++; }
  ];
  await runWithConcurrency(tasks, 2);
  assert.equal(okCount, 3);
});

/* ---------- augmentRankingWithCoverage guards ---------- */

test('augmentRankingWithCoverage: ranking not ok → coverage available:false', async () => {
  const r = await augmentRankingWithCoverage(
    { ok: false, error: 'subject required' },
    { splatClient: makeFakeSplat() }
  );
  assert.equal(r.coverage.available, false);
});

test('augmentRankingWithCoverage: no SPLAT client → coverage available:false', async () => {
  const r = await augmentRankingWithCoverage(
    rankingResultWith([mkComparator(0)]),
    { splatClient: null }
  );
  assert.equal(r.coverage.available, false);
  assert.match(r.coverage.error, /SPLAT/);
});

/* ---------- end-to-end fan-out ---------- */

test('augmentRankingWithCoverage: per-comparator coverage attached + proposed coverage included when supplied', async () => {
  const splat = makeFakeSplat({ delayMs: 1 });
  const candidates = [mkComparator(0), mkComparator(1, { erp_kw: 25 }), mkComparator(2)];
  const r = await augmentRankingWithCoverage(
    rankingResultWith(candidates),
    { splatClient: splat, proposedTx: SUBJECT_TX, concurrency: 3 }
  );
  assert.equal(r.coverage.proposed.available, true);
  assert.equal(r.coverage.comparators.length, 3);
  for (const c of r.coverage.comparators){
    assert.equal(c.available, true, `${c.call} should be ok`);
    assert.ok(c.mean_radial_km > 0);
    assert.ok(c.service_area_km2 > 0);
  }
  assert.equal(r.coverage.n_attempted, 4);  // 3 comparators + 1 proposed
  assert.equal(r.coverage.n_ok, 4);
  assert.equal(r.coverage.n_failed, 0);
  assert.equal(r.coverage.fanout_concurrency, 3);
  assert.ok(r.coverage.elapsed_ms >= 0);
});

test('augmentRankingWithCoverage: bounded concurrency respected (peak ≤ cap)', async () => {
  const splat = makeFakeSplat({ delayMs: 8 });
  const candidates = Array.from({ length: 12 }, (_, i) => mkComparator(i));
  const r = await augmentRankingWithCoverage(
    rankingResultWith(candidates),
    { splatClient: splat, concurrency: 3 }
  );
  assert.ok(splat.peakInflight <= 3,
    `peak inflight ${splat.peakInflight} should not exceed 3`);
  assert.equal(r.coverage.n_ok, 12);
});

test('augmentRankingWithCoverage: per-comparator failure surfaces but does not fail the rest', async () => {
  const splat = makeFakeSplat({ delayMs: 1, opts: { failCalls: ['W1'] } });
  const candidates = [mkComparator(0), mkComparator(1), mkComparator(2)];
  const r = await augmentRankingWithCoverage(
    rankingResultWith(candidates),
    { splatClient: splat, concurrency: 6 }
  );
  assert.equal(r.coverage.n_attempted, 3);
  assert.equal(r.coverage.n_ok, 2);
  assert.equal(r.coverage.n_failed, 1);
  const failed = r.coverage.comparators.find((c) => !c.available);
  assert.equal(failed.call, 'W1');
  assert.match(failed.error, /synthetic failure/);
});

test('augmentRankingWithCoverage: candidate missing geometry skipped from fan-out', async () => {
  const splat = makeFakeSplat({ delayMs: 1 });
  const candidates = [
    mkComparator(0),
    { ...mkComparator(1), haat_m: null },     // missing geometry
    mkComparator(2)
  ];
  const r = await augmentRankingWithCoverage(
    rankingResultWith(candidates),
    { splatClient: splat }
  );
  assert.equal(r.coverage.n_attempted, 2);
  assert.equal(r.coverage.comparators.length, 2);
});

test('augmentRankingWithCoverage: onProgress called with (done, total) per task', async () => {
  const splat = makeFakeSplat({ delayMs: 1 });
  const seen = [];
  await augmentRankingWithCoverage(
    rankingResultWith([mkComparator(0), mkComparator(1)]),
    { splatClient: splat, onProgress: (d, t) => seen.push([d, t]) }
  );
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[seen.length - 1], [2, 2]);
});

/* ---------- provenance ---------- */

test('COMPARABLES_COVERAGE_PROVENANCE names §73.313 + Longley-Rice + 17 USC §105', () => {
  assert.match(COMPARABLES_COVERAGE_PROVENANCE.regulation, /73\.313/);
  assert.match(COMPARABLES_COVERAGE_PROVENANCE.regulation, /Longley-Rice/);
  assert.match(COMPARABLES_COVERAGE_PROVENANCE.license_basis, /17 USC §105/);
});
