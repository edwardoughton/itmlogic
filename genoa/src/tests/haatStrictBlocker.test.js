// Critical-blocker tests for the "NOT_RUN with garbage values"
// contradiction that survived Phase 1.  These pin down the new
// requirements:
//
//   #1 — impossible HAAT detection across BOTH sources
//   #2 — readiness gating cap (NOT_RUN/INVALID/FALLBACK_ONLY
//        never reach FILING_CANDIDATE for FM)
//   #3 — contradiction prevention guard
//   #4 — Appendix A structured output (covered indirectly via
//        validator status outputs)
//   #5 — terrain-limited posture flag
//   #6 — severity enum

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateHaat,
  detectHaatContradictions,
  Severity,
  HAAT_DISPLAY_SUPPRESSED,
  HAAT_GATES_READINESS
} from '../engine/haat/validate.js';
import { computeReadinessScore } from '../engine/readiness/score.js';

// ─── Req #6 — severity enum ────────────────────────────────────────

test('severity enum: INFO/WARNING/ADVISORY/BLOCKER', () => {
  assert.equal(Severity.INFO, 'INFO');
  assert.equal(Severity.WARNING, 'WARNING');
  assert.equal(Severity.ADVISORY, 'ADVISORY');
  assert.equal(Severity.BLOCKER, 'BLOCKER');
});

// ─── Req #1 — Validator catches the KZLZ-class bug across both
//             radial_table AND terrain_haat_per_radial sources ──────

test('validator sees per-radial HAAT in radial_table even when terrain_haat_per_radial is empty (KZLZ bug)', () => {
  const exhibit = {
    station_inputs: { call: 'KZLZ', service: 'FM', haat_m: 581, lat: 32, lon: -111 },
    radial_table: Array.from({ length: 36 }, (_, i) => ({
      azimuth_deg: i * 10,
      haat_computed_m: -170 + (Math.random() - 0.5) * 50,   // KZLZ pattern
      haat_input_m: 581,
      contour_distances_km: { service_60dbu: 8.85 }
    })),
    evidence: {}  // ← deliberately empty; this is the bug
  };
  const r = validateHaat(exhibit);
  assert.equal(r.status, 'INVALID',
    'must catch garbage HAAT even when terrain_haat_per_radial is empty');
  assert.ok(r.display_suppressed);
  assert.ok(r.gates_readiness);
  assert.ok(r.terrain_limited);
  assert.ok(r.issues.find(i => i.code === 'HAAT_SUPPRESSED_NO_TERRAIN_BASIS'));
});

// ─── Req #1 — Impossible HAAT emits HAAT_SUPPRESSED_NO_TERRAIN_BASIS
//             blocker when there's no terrain basis ─────────────────

test('impossible HAAT + no terrain basis → BLOCKER with display_suppressed', () => {
  const r = validateHaat({
    station_inputs: { service: 'FM', haat_m: 500 },
    radial_table: Array.from({ length: 36 }, () => ({ haat_computed_m: -300 })),
    evidence: {}
  });
  assert.equal(r.status, 'INVALID');
  assert.equal(r.display_suppressed, true);
  assert.ok(r.issues.find(i => i.severity === Severity.BLOCKER));
});

// ─── Req #5 — FALLBACK_ONLY when values present without terrain basis
//             but values look plausible ─────────────────────────────

test('FALLBACK_ONLY when per-radial values plausible but no terrain basis', () => {
  const r = validateHaat({
    station_inputs: { service: 'FM', haat_m: 100 },
    radial_table: Array.from({ length: 36 }, () => ({ haat_computed_m: 95 })),
    evidence: {}
  });
  assert.equal(r.status, 'FALLBACK_ONLY');
  assert.equal(r.display_suppressed, true);
  assert.equal(r.gates_readiness, true);
  assert.equal(r.terrain_limited, true);
});

// ─── Req #3 — Contradiction guard ──────────────────────────────────

test('contradiction guard: NOT_RUN status with per-radial HAATs present → CONTRADICTION', () => {
  // Hand-crafted: validator says NOT_RUN (because we bypass it) but
  // there are radial values in the table.
  const exhibit = {
    station_inputs: { service: 'FM', haat_m: 581 },
    radial_table: [{ haat_computed_m: -200 }, { haat_computed_m: -180 }],
    haat_validation: { status: 'NOT_RUN', basis: 'flat', issues: [], stats: {} },
    blockers: []
  };
  const out = detectHaatContradictions(exhibit);
  assert.ok(out.length > 0);
  assert.equal(out[0].code, 'HAAT_CONTRADICTION');
  assert.equal(out[0].severity, Severity.BLOCKER);
});

test('contradiction guard: PASS status but large opposite-sign values → CONTRADICTION', () => {
  const exhibit = {
    station_inputs: { service: 'FM', haat_m: 700 },     // positive operator HAAT
    radial_table: [
      { haat_computed_m: -800 },                         // wrong sign + large
      { haat_computed_m: -900 }
    ],
    haat_validation: { status: 'PASS', issues: [], stats: {} },
    blockers: []
  };
  const out = detectHaatContradictions(exhibit);
  assert.ok(out.length > 0);
  assert.equal(out[0].code, 'HAAT_CONTRADICTION');
});

test('contradiction guard: "no issues" but blockers present → CONTRADICTION', () => {
  const exhibit = {
    station_inputs: { service: 'FM', haat_m: 200 },
    radial_table: [],
    haat_validation: { status: 'PASS', issues: [], stats: {} },
    blockers: [
      { code: 'CURVE_VALIDATION_MISSING', severity: 'blocker', message: 'no suite' }
    ]
  };
  const out = detectHaatContradictions(exhibit);
  assert.ok(out.length > 0);
  assert.equal(out[0].code, 'HAAT_CONTRADICTION');
});

test('contradiction guard: clean exhibit returns no contradictions', () => {
  const exhibit = {
    station_inputs: { service: 'FM', haat_m: 200 },
    radial_table: [{ haat_computed_m: 195 }, { haat_computed_m: 210 }],
    haat_validation: {
      status: 'PASS', issues: [], stats: { operator_m: 200, mean_m: 202 }
    },
    blockers: []
  };
  const out = detectHaatContradictions(exhibit);
  assert.equal(out.length, 0);
});

// ─── Req #2 — Readiness cap ────────────────────────────────────────

function baseExhibitForScore(overrides = {}){
  return {
    station_inputs: {
      call: 'KZLZ', service: 'FM', frequency: 105.3,
      lat: 32.25, lon: -111.12, haat_m: 581, erp_kw: 0.58
    },
    evidence: {
      fcc_parity_report: { fallback_tier: 1, passed: true },
      fortran_parity:    { available: true, pass: true },
      map_render_attached: true
    },
    validation_context: { curve_reference_validation: { passed: true, failed_cases: 0 }},
    regulatory_compliance: { compliance_pass: 'PASS' },
    regulatoryContext:    { facility_status: 'licensed' },
    method_versions:      { curve_dataset_sha256: 'abc' },
    engine_signature:     { hash: 'def' },
    replay_token:         'tok',
    pe_certification:     { certified: true, signed_at: 'x', engineer: { name: 'PE' }},
    warnings: [], blockers: [],
    ...overrides
  };
}

test('req #2: HAAT NOT_RUN caps FM readiness at REVIEW even with everything else green', () => {
  const e = baseExhibitForScore({
    haat_validation: { status: 'NOT_RUN', basis: 'flat', issues: [], stats: {} }
  });
  const r = computeReadinessScore(e);
  assert.equal(r.status, 'REVIEW',
    `NOT_RUN with all other axes green: expected REVIEW cap, got ${r.status} (score ${r.score})`);
});

test('req #2: HAAT FALLBACK_ONLY caps FM readiness at REVIEW', () => {
  const e = baseExhibitForScore({
    haat_validation: {
      status: 'FALLBACK_ONLY', basis: 'flat',
      issues: [{ code: 'HAAT_FALLBACK_ONLY', severity: Severity.WARNING, detail: 'x' }],
      stats: {}
    }
  });
  const r = computeReadinessScore(e);
  assert.equal(r.status, 'REVIEW');
});

test('req #2: HAAT INVALID stays BLOCKED (not capped at REVIEW)', () => {
  const e = baseExhibitForScore({
    haat_validation: {
      status: 'INVALID', basis: 'flat',
      issues: [{ code: 'HAAT_SUPPRESSED_NO_TERRAIN_BASIS', severity: Severity.BLOCKER, detail: 'x' }],
      stats: {}
    }
  });
  const r = computeReadinessScore(e);
  assert.equal(r.status, 'BLOCKED');  // blocker beats cap
});

test('req #2: AM exhibits are NOT capped by HAAT NOT_RUN (no DEM by design)', () => {
  const e = baseExhibitForScore({
    station_inputs: { ...baseExhibitForScore().station_inputs, service: 'AM', frequency_khz: 780 },
    haat_validation: { status: 'NOT_RUN', basis: 'not_applicable_am', issues: [], stats: {} }
  });
  const r = computeReadinessScore(e);
  assert.ok(['FILING_CANDIDATE', 'ENGINEER_CERTIFICATION_READY'].includes(r.status),
    `AM NOT_RUN should not cap; got ${r.status}`);
});

test('req #2: HAAT PASS does not get capped', () => {
  const e = baseExhibitForScore({
    haat_validation: { status: 'PASS', basis: 'terrain_derived', issues: [], stats: {} }
  });
  const r = computeReadinessScore(e);
  assert.ok(['FILING_CANDIDATE', 'ENGINEER_CERTIFICATION_READY'].includes(r.status));
});

// ─── Exported sets for downstream consumers ────────────────────────

test('HAAT_DISPLAY_SUPPRESSED set covers INVALID/FALLBACK_ONLY/NOT_RUN', () => {
  assert.ok(HAAT_DISPLAY_SUPPRESSED.has('INVALID'));
  assert.ok(HAAT_DISPLAY_SUPPRESSED.has('FALLBACK_ONLY'));
  assert.ok(HAAT_DISPLAY_SUPPRESSED.has('NOT_RUN'));
  assert.ok(!HAAT_DISPLAY_SUPPRESSED.has('PASS'));
  assert.ok(!HAAT_DISPLAY_SUPPRESSED.has('SUSPECT'));
});

test('HAAT_GATES_READINESS set covers INVALID/FALLBACK_ONLY/NOT_RUN', () => {
  assert.ok(HAAT_GATES_READINESS.has('INVALID'));
  assert.ok(HAAT_GATES_READINESS.has('FALLBACK_ONLY'));
  assert.ok(HAAT_GATES_READINESS.has('NOT_RUN'));
});
