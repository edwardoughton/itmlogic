// Tests for the AM Co-Location Opportunity Engine.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runColocationOpportunities,
  __test__
} from '../engine/am/colocationOpportunities.js';

// KAZM (Sedona) — matches the seed inventory cluster.
const KAZM = { lat: 34.86, lon: -111.82 };

// A canonical request with knobs to tweak per-test.
function baseBody(overrides = {}){
  return {
    callsign: 'KAZM',
    frequency_khz: 790,
    current_site: { ...KAZM },
    search_radius_km: 50,
    grid_spacing_km: 25,
    tpo_kw: 1.0,
    pattern_mode: 'NDA',
    fcc_class: 'D',
    optimization_goals: { maximize_col_coverage: true, maximize_population: true },
    search_mode: 'INFRASTRUCTURE',
    infrastructure_source: 'MANUAL',
    candidate_limit: 30,
    ...overrides
  };
}

// ---------- Test 1 — INFRASTRUCTURE mode with empty radius ----------
test('INFRASTRUCTURE-only mode: no infrastructure in radius returns empty candidates, available:true', () => {
  // Center mid-Atlantic so the Arizona-only inventory does not intersect.
  const out = runColocationOpportunities(baseBody({
    current_site: { lat: 30.0, lon: -50.0 },
    search_radius_km: 100,
    search_mode: 'INFRASTRUCTURE'
  }));
  assert.equal(out.available, true);
  assert.equal(out.n_candidates_returned, 0);
  assert.deepEqual(out.candidates, []);
});

// ---------- Test 2 — INFRASTRUCTURE mode pulls and ranks the manual seed ----------
test('INFRASTRUCTURE mode pulls manual sites and returns them ranked by score (desc)', () => {
  const out = runColocationOpportunities(baseBody({ search_mode: 'INFRASTRUCTURE' }));
  assert.equal(out.available, true);
  assert.ok(out.n_candidates_returned >= 1, 'at least one seed site within 50 km of KAZM');
  // Every returned candidate is sourced from the manual inventory.
  for (const c of out.candidates){
    assert.equal(c.source, 'INFRASTRUCTURE');
    assert.ok(c.infrastructure_ref && c.infrastructure_ref.id, 'each result references an inventory record');
    assert.ok(c.colocation_analysis, 'each result has colocation_analysis');
    assert.ok(c.colocation_analysis.shared_lease_advantage, 'infra candidates get the shared_lease_advantage flag');
  }
  // Strictly non-increasing score order.
  for (let i = 1; i < out.candidates.length; i++){
    assert.ok(out.candidates[i - 1].score >= out.candidates[i].score,
      `candidates[${i - 1}].score (${out.candidates[i - 1].score}) should be >= candidates[${i}].score (${out.candidates[i].score})`);
  }
});

// ---------- Test 3 — HYBRID mode returns both source types ----------
test('HYBRID mode returns both source=GRID and source=INFRASTRUCTURE candidates', () => {
  const out = runColocationOpportunities(baseBody({
    search_mode: 'HYBRID',
    grid_spacing_km: 20,
    search_radius_km: 40,
    candidate_limit: 200
  }));
  assert.equal(out.available, true);
  const sources = new Set(out.candidates.map((c) => c.source));
  assert.ok(sources.has('GRID'), 'expected at least one GRID candidate');
  assert.ok(sources.has('INFRASTRUCTURE'), 'expected at least one INFRASTRUCTURE candidate');
});

// ---------- Test 4 — Same-band AM host within 10 km triggers diplexing_required ----------
test('Same-band AM host within 10 km sets diplexing_required:true on that candidate', () => {
  const out = runColocationOpportunities(baseBody({ search_mode: 'INFRASTRUCTURE' }));
  const kzed = out.candidates.find((c) => c.infrastructure_ref && c.infrastructure_ref.station_call === 'KZED');
  assert.ok(kzed, 'KZED seed record should appear in candidate list');
  assert.equal(kzed.colocation_analysis.diplexing_required, true);
  assert.equal(kzed.colocation_analysis.same_band_interference_risk, 'HIGH');
  assert.equal(kzed.colocation_analysis.host_kind, 'AM_SITE');
});

// ---------- Test 5 — RECOVERABLE_WITH_DA when COL fails but score is otherwise good ----------
test('Status RECOVERABLE_WITH_DA assigned when COL coverage fails but score otherwise good', () => {
  // Synthesize a candidate that fails COL coverage but otherwise looks
  // healthy, and run it through the classifier directly.
  const c = {
    lat: 34.87, lon: -111.83,
    distance_from_current_km: 15,    // within NEARBY_COMMUNITY_RADIUS_KM
    score: 80,                       // well above RECOVERY_SCORE_FLOOR (55)
    col_coverage_pct: 0.40,          // below §73.24(j) 0.80 floor
    blanket_population_pct: 0.20,    // well under §73.24(g) 1% ceiling
    daytime_reach_km: 60,
    ground_sigma_mS_m: 4,
    treaty_zone: null,
    source: 'INFRASTRUCTURE',
    colocation_analysis: {
      distance_to_host_m: 0,
      host_kind: 'TOWER',
      diplexing_required: false,
      same_band_interference_risk: 'LOW'
    }
  };
  __test__.assignStatusCategory(c, /*scoreCutoff=*/90, { current_site: KAZM });
  assert.equal(c.status_category, 'RECOVERABLE_WITH_DA');
  assert.ok(c.explanation.recovery_reasoning.includes('directional-antenna'),
    `expected reasoning to mention DA; got: ${c.explanation.recovery_reasoning}`);
});

// ---------- Test 6 — Invalid search_mode is rejected ----------
test('Invalid search_mode produces a 400-equivalent error response', () => {
  const out = runColocationOpportunities(baseBody({ search_mode: 'WHATEVER' }));
  assert.equal(out.available, false);
  assert.ok(/search_mode/i.test(out.error), `expected error to mention search_mode; got: ${out.error}`);
});

// ---------- Test 7 (bonus) — ASR candidate gets regulatory note ----------
test('ASR-kind candidate carries an ASR registration regulatory note', () => {
  const out = runColocationOpportunities(baseBody({ search_mode: 'INFRASTRUCTURE' }));
  const asr = out.candidates.find((c) => c.infrastructure_ref && c.infrastructure_ref.kind === 'ASR');
  assert.ok(asr, 'expected at least one ASR-kind seed candidate within radius');
  const hasAsrNote = asr.colocation_analysis.regulatory_notes
    .some((n) => /ASR/i.test(n) && /notification/i.test(n));
  assert.ok(hasAsrNote,
    `expected ASR registration note; got: ${JSON.stringify(asr.colocation_analysis.regulatory_notes)}`);
});

// ---------- Test 8 — Treaty review supersedes other categories ----------
test('Treaty zone triggers TREATY_REVIEW status', () => {
  const c = {
    lat: 32.0, lon: -106.0,
    distance_from_current_km: 200,
    score: 90,
    col_coverage_pct: 0.95,
    blanket_population_pct: 0.10,
    daytime_reach_km: 50,
    treaty_zone: 'US/MX 1986 AM Agreement',
    source: 'GRID',
    colocation_analysis: null
  };
  __test__.assignStatusCategory(c, 80, { current_site: KAZM });
  assert.equal(c.status_category, 'TREATY_REVIEW');
});

// ---------- Test 9 — RECOVERABLE_WITH_REDUCED_POWER on blanket fail ----------
test('Status RECOVERABLE_WITH_REDUCED_POWER when blanket pop fails but COL OK', () => {
  const c = {
    lat: 34.87, lon: -111.83,
    distance_from_current_km: 5,
    score: 72,
    col_coverage_pct: 0.92,
    blanket_population_pct: 1.4,     // > 1% §73.24(g) ceiling
    daytime_reach_km: 60,
    treaty_zone: null,
    source: 'INFRASTRUCTURE',
    colocation_analysis: { diplexing_required: false, same_band_interference_risk: 'LOW' }
  };
  __test__.assignStatusCategory(c, 80, { current_site: KAZM });
  assert.equal(c.status_category, 'RECOVERABLE_WITH_REDUCED_POWER');
});
