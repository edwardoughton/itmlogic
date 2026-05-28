// Phase-7 filing-readiness scoring tests.
//
// Each test asserts ONE axis of the scoring model so a regression
// is pinpointable.  Covers:
//
//   - hard blockers drop status to BLOCKED regardless of score
//   - HAAT INVALID → BLOCKED, with next_action pointing at AMSL fix
//   - LIVE_FCC_PARITY tier-3 → warning, not blocker
//   - missing facility inputs → BLOCKED
//   - rule failure on existing licensed → REVIEW (with grandfathering
//     language), not BLOCKED
//   - rule failure on proposed → BLOCKED
//   - PE-certified exhibit + all axes green → ENGINEER_CERTIFICATION_READY
//   - clean exhibit without PE cert → FILING_CANDIDATE
//   - score sums to ≤ 100

import test from 'node:test';
import assert from 'node:assert/strict';
import { computeReadinessScore } from '../engine/readiness/score.js';

// Minimum-viable exhibit fixture.  Each test starts from this and
// overrides only the relevant axis to make failure modes precise.
function baseExhibit(overrides = {}){
  const e = {
    station_inputs: {
      call: 'KZLZ', service: 'FM', frequency: 105.3,
      lat: 32.25, lon: -111.12, haat_m: 581, erp_kw: 0.58, fcc_class: 'C3'
    },
    evidence: {
      terrain_haat_per_radial: Array.from({ length: 36 }, (_, i) => ({ az: i*10, haat_m: 580 })),
      tx_amsl_resolved: { value_m: 1881, source: 'derived' },
      fcc_parity_report: { fallback_tier: 3, passed: true },
      curve_dataset_sha256: 'e277dce5...'
    },
    haat_validation: { status: 'PASS', basis: 'terrain_derived', issues: [], stats: {} },
    validation_context: { curve_reference_validation: { passed: true, failed_cases: 0 }},
    regulatory_compliance: { compliance_pass: 'PASS' },
    regulatoryContext:    { facility_status: 'licensed', current_rule_compliance: 'PASS' },
    method_versions:      { curve_dataset_sha256: 'e277dce5...' },
    engine_signature:     { hash: 'fee4f7f3dfab' },
    build_attestation:    { sha: 'fee4f7f3dfab' },
    replay_token:         'genoa-replay-token-xxx',
    warnings: [], blockers: []
  };
  return { ...e, ...overrides };
}

test('clean exhibit reaches FILING_CANDIDATE without PE cert', () => {
  const r = computeReadinessScore(baseExhibit());
  assert.equal(r.blockers.length, 0);
  assert.ok(['FILING_CANDIDATE', 'REVIEW'].includes(r.status),
    `expected FILING_CANDIDATE-tier, got ${r.status} (score ${r.score})`);
  assert.ok(r.score <= 100, `score ${r.score} cannot exceed 100`);
});

test('PE-certified exhibit + all axes green → ENGINEER_CERTIFICATION_READY', () => {
  const e = baseExhibit({
    pe_certification: { certified: true, signed_at: '2026-05-19', engineer: { name: 'PE' }},
    evidence: {
      ...baseExhibit().evidence,
      fcc_parity_report:    { fallback_tier: 1, passed: true },
      fortran_parity:       { available: true, pass: true },
      map_render_attached:  true
    }
  });
  const r = computeReadinessScore(e);
  assert.equal(r.status, 'ENGINEER_CERTIFICATION_READY',
    `expected ENGINEER_CERTIFICATION_READY, got ${r.status} (score ${r.score})`);
  assert.ok(r.score >= 90);
});

test('HAAT INVALID → BLOCKED with AMSL next_action', () => {
  const e = baseExhibit({
    haat_validation: {
      status: 'INVALID', basis: 'flat',
      issues: [{ code: 'HAAT_MEAN_INCONSISTENT', severity: 'blocker', detail: 'bad' }],
      stats: {}
    }
  });
  const r = computeReadinessScore(e);
  assert.equal(r.status, 'BLOCKED');
  assert.ok(r.blockers.find(b => b.code === 'HAAT_INVALID'));
  assert.ok(r.next_actions.find(a => a.includes('overall_height_amsl_m')),
    'next_actions should explicitly tell engineer how to fix HAAT');
});

test('HAAT SUSPECT → warning only, not blocker', () => {
  const e = baseExhibit({
    haat_validation: {
      status: 'SUSPECT', basis: 'terrain_derived',
      issues: [{ code: 'HAAT_SUSPECT_OUTLIERS', severity: 'warning', detail: 'outliers' }],
      stats: {}
    }
  });
  const r = computeReadinessScore(e);
  assert.notEqual(r.status, 'BLOCKED');
  assert.ok(r.warnings.find(w => w.code === 'HAAT_SUSPECT'));
});

test('Live FCC parity tier-3 → LIVE_FCC_PARITY_UNAVAILABLE warning, not blocker', () => {
  const r = computeReadinessScore(baseExhibit());
  assert.ok(r.warnings.find(w => w.code === 'LIVE_FCC_PARITY_UNAVAILABLE'),
    `expected LIVE_FCC_PARITY_UNAVAILABLE in warnings, got ${JSON.stringify(r.warnings)}`);
  assert.ok(!r.blockers.find(b => b.code.startsWith('LIVE_FCC')));
  assert.ok(r.next_actions.find(a => a.toLowerCase().includes('geo.fcc.gov')),
    'next_actions should tell engineer to re-run with live FCC parity');
});

test('Live FCC parity tier-1 PASS → full points, no warning', () => {
  const e = baseExhibit();
  e.evidence.fcc_parity_report = { fallback_tier: 1, passed: true };
  const r = computeReadinessScore(e);
  assert.equal(r.breakdown.live_fcc_parity, r.axes.live_fcc_parity);
  assert.ok(!r.warnings.find(w => w.code === 'LIVE_FCC_PARITY_UNAVAILABLE'));
});

test('Live FCC parity tier-1 FAIL → BLOCKED', () => {
  const e = baseExhibit();
  e.evidence.fcc_parity_report = { fallback_tier: 1, passed: false };
  const r = computeReadinessScore(e);
  assert.equal(r.status, 'BLOCKED');
  assert.ok(r.blockers.find(b => b.code === 'LIVE_FCC_PARITY_FAIL'));
});

test('Missing facility inputs → BLOCKED', () => {
  const e = baseExhibit();
  e.station_inputs = { service: 'FM', haat_m: 100 }; // no call/freq/lat/lon
  const r = computeReadinessScore(e);
  assert.equal(r.status, 'BLOCKED');
  assert.ok(r.blockers.find(b => b.code === 'FACILITY_INPUTS_MISSING'));
});

test('Rule failure on EXISTING LICENSED → REVIEW (not BLOCKED), with grandfathering language', () => {
  const e = baseExhibit({
    regulatoryContext: { facility_status: 'licensed', current_rule_compliance: 'fails_current_rules' },
    regulatory_compliance: { compliance_pass: 'fails_current_rules' }
  });
  const r = computeReadinessScore(e);
  assert.notEqual(r.status, 'BLOCKED', 'existing licensed conflicts must not block — grandfathering possible');
  const w = r.warnings.find(x => x.code === 'CURRENT_RULE_CONFLICT_LICENSED');
  assert.ok(w);
  assert.ok(w.detail.toLowerCase().includes('grandfathering') || w.detail.toLowerCase().includes('waiver'),
    'warning language must mention grandfathering/waiver/authorization options');
});

test('Rule failure on PROPOSED filing → BLOCKED', () => {
  const e = baseExhibit({
    regulatoryContext: { facility_status: 'proposed', study_intent: 'new_cp' },
    regulatory_compliance: { compliance_pass: 'fails_current_rules' }
  });
  const r = computeReadinessScore(e);
  assert.equal(r.status, 'BLOCKED');
  assert.ok(r.blockers.find(b => b.code === 'RULE_FAILURE_PROPOSED'));
  assert.ok(r.next_actions.find(a => /redesign|waiver/i.test(a)));
});

test('FORTRAN sidecar not configured → advisory, not blocker', () => {
  const r = computeReadinessScore(baseExhibit());
  const a = r.advisory.find(x => x.code === 'INDEPENDENT_PARITY_NOT_CONFIGURED');
  assert.ok(a, 'should surface FORTRAN-sidecar-missing as advisory');
  assert.ok(!r.blockers.find(b => b.code.includes('FORTRAN')));
});

test('engine blockers from exhibit.warnings flow through to readiness blockers', () => {
  const e = baseExhibit({
    blockers: [
      { code: 'CURVE_VALIDATION_MISSING', message: 'no golden suite', severity: 'blocker' }
    ]
  });
  const r = computeReadinessScore(e);
  assert.equal(r.status, 'BLOCKED');
  assert.ok(r.blockers.find(b => b.code === 'CURVE_VALIDATION_MISSING'),
    'engine-level blockers must propagate into readiness output');
});

test('score breakdown sums equal final score', () => {
  const r = computeReadinessScore(baseExhibit());
  const sum = Object.values(r.breakdown).reduce((a, b) => a + b, 0);
  assert.equal(sum, r.score);
});

test('axis maxima sum to 100', () => {
  const r = computeReadinessScore(baseExhibit());
  const max = Object.values(r.axes).reduce((a, b) => a + b, 0);
  assert.equal(max, 100, 'AXES weights must sum to 100');
});
