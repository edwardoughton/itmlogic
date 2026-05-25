// Finding ontology — exhaustive truth-table tests.
//
// Goal: catch every contradiction the legacy "FAIL + COMPLIANT" / "NOT_RUN
// + no warnings" wiring used to admit.  Each test exercises one invariant
// (or one row in the verdictFor() precedence ladder) and asserts the
// resulting {status, confidence, scope, narrative_fragments} tuple.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FindingStatus,
  Confidence,
  Scope,
  Verdict,
  verdictFor,
  isFindingStatus,
  capConfidence,
  legacyConclusionStatus,
  legacyValidationStatus,
  BLOCKING_STATUSES,
  SCREENING_STATUSES,
  UNRESOLVED_STATUSES,
  FINDING_STATUS_ORDER
} from '../engine/finding/ontology.js';

import {
  wordingFor,
  normalizeService,
  rewordForReport
} from '../engine/finding/serviceWording.js';

// ===========================================================================
// FindingStatus enum
// ===========================================================================

test('FindingStatus enum has all expected members and no extras', () => {
  const expected = [
    'PASS', 'INFO', 'SKIP', 'ADVISORY', 'NOT_RUN', 'INCOMPLETE',
    'SCREENING_PASS', 'SCREENING_FAIL', 'FAIL', 'BLOCKER', 'FILING_BLOCKER'
  ];
  const actual = Object.keys(FindingStatus);
  assert.deepEqual(actual.sort(), expected.sort());
});

test('FindingStatus is frozen — cannot be mutated', () => {
  assert.throws(() => { FindingStatus.NEW = 'NEW'; }, TypeError);
});

test('isFindingStatus accepts all enum members and rejects strangers', () => {
  for (const v of Object.values(FindingStatus)){
    assert.equal(isFindingStatus(v), true);
  }
  assert.equal(isFindingStatus('NOT_A_STATUS'), false);
  assert.equal(isFindingStatus(undefined), false);
  assert.equal(isFindingStatus(null), false);
});

test('FINDING_STATUS_ORDER contains every status exactly once', () => {
  assert.equal(FINDING_STATUS_ORDER.length, Object.values(FindingStatus).length);
  const set = new Set(FINDING_STATUS_ORDER);
  for (const s of Object.values(FindingStatus)){
    assert.ok(set.has(s), `order array missing ${s}`);
  }
});

test('grouping sets are subsets of the enum', () => {
  for (const s of [...BLOCKING_STATUSES, ...SCREENING_STATUSES, ...UNRESOLVED_STATUSES]){
    assert.ok(isFindingStatus(s));
  }
});

// ===========================================================================
// capConfidence
// ===========================================================================

test('capConfidence picks the lower of two confidence levels', () => {
  assert.equal(capConfidence(Confidence.HIGH, Confidence.MEDIUM), Confidence.MEDIUM);
  assert.equal(capConfidence(Confidence.MEDIUM, Confidence.HIGH), Confidence.MEDIUM);
  assert.equal(capConfidence(Confidence.HIGH, Confidence.LOW),    Confidence.LOW);
  assert.equal(capConfidence(Confidence.LOW,  Confidence.MEDIUM), Confidence.LOW);
  assert.equal(capConfidence(Confidence.HIGH, Confidence.HIGH),   Confidence.HIGH);
});

// ===========================================================================
// verdictFor — Invariant I7: all-clear
// ===========================================================================

test('I7: empty input ⇒ COMPLIANT / HIGH / FULL_FILING', () => {
  const v = verdictFor({});
  assert.equal(v.status, Verdict.COMPLIANT);
  assert.equal(v.confidence, Confidence.HIGH);
  assert.equal(v.scope, Scope.FULL_FILING);
  assert.ok(Array.isArray(v.narrative_fragments));
  assert.ok(v.narrative_fragments.length > 0);
});

test('I7: only PASS / INFO / SKIP components ⇒ COMPLIANT / HIGH / FULL_FILING', () => {
  const v = verdictFor({
    components: [
      { name: 'curve', status: FindingStatus.PASS },
      { name: 'fcc-parity', status: FindingStatus.PASS },
      { name: 'radial-parity', status: FindingStatus.INFO },
      { name: 'terrain (AM)', status: FindingStatus.SKIP }
    ]
  });
  assert.equal(v.status, Verdict.COMPLIANT);
  assert.equal(v.confidence, Confidence.HIGH);
  assert.equal(v.scope, Scope.FULL_FILING);
});

test('I7: ADVISORY accompanying all-clear preserves COMPLIANT / HIGH', () => {
  const v = verdictFor({
    components: [
      { name: 'curve', status: FindingStatus.PASS },
      { name: 'engineering confidence', status: FindingStatus.ADVISORY }
    ]
  });
  assert.equal(v.status, Verdict.COMPLIANT);
  assert.equal(v.confidence, Confidence.HIGH);
  assert.equal(v.scope, Scope.FULL_FILING);
  // Advisory-addendum fragment is appended.
  assert.ok(v.narrative_fragments.some(f => /advisory/i.test(f)));
});

// ===========================================================================
// verdictFor — Invariant I1: FILING_BLOCKER
// ===========================================================================

test('I1: FILING_BLOCKER component ⇒ NOT_FILING_READY / LOW / UNVERIFIED', () => {
  const v = verdictFor({
    components: [
      { name: 'curve', status: FindingStatus.PASS },
      { name: '§73.182 NIF', cite: '§73.182', status: FindingStatus.FILING_BLOCKER }
    ]
  });
  assert.equal(v.status, Verdict.NOT_FILING_READY);
  assert.equal(v.confidence, Confidence.LOW);
  assert.equal(v.scope, Scope.UNVERIFIED);
  // FILING_BLOCKER ⇒ NOT COMPLIANT (invariant I1).
  assert.notEqual(legacyConclusionStatus(v.status), 'COMPLIANT');
  // Narrative cites the failing rule.
  assert.ok(v.narrative_fragments.some(f => /§73\.182/.test(f)),
            'NOT_FILING_READY narrative must cite the failing rule');
});

test('I1: filing_blocker annotation also triggers NOT_FILING_READY', () => {
  const v = verdictFor({
    blockers: [{ code: 'AM_NIF_FAIL', cite: '§73.182', filing_blocker: true, message: 'NIF fail' }]
  });
  assert.equal(v.status, Verdict.NOT_FILING_READY);
  assert.equal(v.scope, Scope.UNVERIFIED);
});

test('I1: FILING_BLOCKER short-circuits any alt-rule offset', () => {
  const v = verdictFor({
    components: [
      { name: '§73.207', status: FindingStatus.FILING_BLOCKER, cite: '§73.207' },
      { name: '§73.215', status: FindingStatus.PASS, scope: 'ALT_RULE' }
    ]
  });
  // A filing-blocker cannot be papered over with an alt-rule pass.
  assert.equal(v.status, Verdict.NOT_FILING_READY);
});

// ===========================================================================
// verdictFor — Invariant I3: SCREENING_*
// ===========================================================================

test('I3: SCREENING_FAIL ⇒ SCREENING_ADVISORY / LOW / SCREENING', () => {
  const v = verdictFor({
    components: [
      { name: 'curve', status: FindingStatus.PASS },
      { name: '§73.182 NIF (Berry)', status: FindingStatus.SCREENING_FAIL }
    ]
  });
  assert.equal(v.status, Verdict.SCREENING_ADVISORY);
  assert.equal(v.scope, Scope.SCREENING);
  assert.ok(v.confidence === Confidence.LOW || v.confidence === Confidence.MEDIUM);
  // SCREENING_* ⇒ confidence ≤ MEDIUM (invariant I3).
  assert.notEqual(v.confidence, Confidence.HIGH);
  // SCREENING_FAIL legacy projection is ENGINEERING REVIEW REQUIRED.
  assert.equal(legacyConclusionStatus(v.status), 'ENGINEERING REVIEW REQUIRED');
});

test('I3: SCREENING_PASS (no fail) ⇒ COMPLIANT_FOR_CHECKS / MEDIUM / SCREENING', () => {
  const v = verdictFor({
    components: [
      { name: 'curve', status: FindingStatus.PASS },
      { name: '§73.182 NIF (Berry)', status: FindingStatus.SCREENING_PASS }
    ]
  });
  assert.equal(v.status, Verdict.COMPLIANT_FOR_CHECKS);
  assert.equal(v.scope, Scope.SCREENING);
  assert.equal(v.confidence, Confidence.MEDIUM);
  // Legacy projection: COMPLIANT.
  assert.equal(legacyConclusionStatus(v.status), 'COMPLIANT');
});

// ===========================================================================
// verdictFor — Invariant I4: INCOMPLETE
// ===========================================================================

test('I4: INCOMPLETE ⇒ ENGINEERING_REVIEW / LOW / UNVERIFIED — never VERIFIED HIGH', () => {
  const v = verdictFor({
    components: [
      { name: 'curve', status: FindingStatus.PASS },
      { name: 'fcc parity', status: FindingStatus.INCOMPLETE }
    ]
  });
  assert.equal(v.confidence, Confidence.LOW);
  assert.equal(v.scope, Scope.UNVERIFIED);
  // INCOMPLETE ⇒ verdict cannot claim COMPLIANT.
  assert.notEqual(legacyConclusionStatus(v.status), 'COMPLIANT');
});

// ===========================================================================
// verdictFor — Invariant I2: BLOCKER
// ===========================================================================

test('I2: BLOCKER without alt-rule ⇒ NON_COMPLIANT / LOW / UNVERIFIED', () => {
  const v = verdictFor({
    components: [{ name: '§73.207', status: FindingStatus.BLOCKER, cite: '§73.207' }]
  });
  assert.equal(v.status, Verdict.NON_COMPLIANT);
  assert.equal(legacyConclusionStatus(v.status), 'NON-COMPLIANT');
});

test('I2: annotation-level blocker ⇒ NON_COMPLIANT', () => {
  const v = verdictFor({
    blockers: [{ code: 'X', message: 'blocker', severity: 'blocker' }]
  });
  assert.equal(v.status, Verdict.NON_COMPLIANT);
});

// ===========================================================================
// verdictFor — Invariant I8: alt-rule offset (§73.215)
// ===========================================================================

test('I8: §73.207 BLOCKER + §73.215 PASS scope=ALT_RULE ⇒ COMPLIANT_VIA_ALT_RULE', () => {
  const v = verdictFor({
    components: [
      { name: '§73.207', status: FindingStatus.BLOCKER, cite: '§73.207' },
      { name: '§73.215', status: FindingStatus.PASS, scope: 'ALT_RULE' }
    ]
  });
  assert.equal(v.status, Verdict.COMPLIANT_VIA_ALT_RULE);
  assert.equal(legacyConclusionStatus(v.status), 'COMPLIANT VIA ALTERNATE RULE');
  assert.equal(v.confidence, Confidence.HIGH);
  assert.equal(v.scope, Scope.FULL_FILING);
});

test('I8: filing-grade FAIL also offsets to COMPLIANT_VIA_ALT_RULE when alt-rule PASS present', () => {
  const v = verdictFor({
    components: [
      { name: '§73.207', status: FindingStatus.FAIL },
      { name: '§73.215', status: FindingStatus.PASS, scope: 'ALT_RULE' }
    ]
  });
  assert.equal(v.status, Verdict.COMPLIANT_VIA_ALT_RULE);
});

// ===========================================================================
// verdictFor — Invariant I5: NOT_RUN
// ===========================================================================

test('I5: NOT_RUN alone ⇒ COMPLIANT_FOR_CHECKS / MEDIUM / CHECKS_EVALUATED', () => {
  const v = verdictFor({
    components: [
      { name: 'curve', status: FindingStatus.PASS },
      { name: '§73.182 NIF', status: FindingStatus.NOT_RUN }
    ]
  });
  assert.equal(v.status, Verdict.COMPLIANT_FOR_CHECKS);
  assert.equal(v.confidence, Confidence.MEDIUM);
  assert.equal(v.scope, Scope.CHECKS_EVALUATED);
});

// ===========================================================================
// verdictFor — Invariant I6: warnings only
// ===========================================================================

test('I6: warnings without blockers ⇒ ENGINEERING_REVIEW / MEDIUM / CHECKS_EVALUATED', () => {
  const v = verdictFor({
    components: [{ name: 'curve', status: FindingStatus.PASS }],
    warnings:   [{ code: 'TERRAIN_FLAT', message: 'flat terrain assumed' }]
  });
  assert.equal(v.status, Verdict.ENGINEERING_REVIEW);
  assert.equal(v.confidence, Confidence.MEDIUM);
  assert.equal(v.scope, Scope.CHECKS_EVALUATED);
  assert.equal(legacyConclusionStatus(v.status), 'ENGINEERING REVIEW REQUIRED');
});

// ===========================================================================
// Precedence: FILING_BLOCKER > BLOCKER > FAIL > SCREENING_FAIL > INCOMPLETE
// ===========================================================================

test('precedence: FILING_BLOCKER wins over SCREENING_FAIL', () => {
  const v = verdictFor({
    components: [
      { name: 'a', status: FindingStatus.SCREENING_FAIL },
      { name: 'b', status: FindingStatus.FILING_BLOCKER, cite: '§73.182' }
    ]
  });
  assert.equal(v.status, Verdict.NOT_FILING_READY);
});

test('precedence: SCREENING_FAIL wins over BLOCKER', () => {
  // SCREENING_FAIL is checked BEFORE general BLOCKER in the reducer so
  // a screening-grade failure can't be promoted to NON_COMPLIANT.
  const v = verdictFor({
    components: [
      { name: 'a', status: FindingStatus.SCREENING_FAIL },
      { name: 'b', status: FindingStatus.BLOCKER }
    ]
  });
  assert.equal(v.status, Verdict.SCREENING_ADVISORY);
});

test('precedence: BLOCKER wins over FAIL when no alt-rule', () => {
  const v = verdictFor({
    components: [
      { name: 'a', status: FindingStatus.BLOCKER },
      { name: 'b', status: FindingStatus.FAIL }
    ]
  });
  assert.equal(v.status, Verdict.NON_COMPLIANT);
});

// ===========================================================================
// Contradiction-catching: the failure modes the old wiring admitted
// ===========================================================================

test('contradiction: FAIL + (no warnings) is NOT silently COMPLIANT', () => {
  const v = verdictFor({
    components: [{ name: 'curve', status: FindingStatus.FAIL }]
  });
  assert.notEqual(legacyConclusionStatus(v.status), 'COMPLIANT');
});

test('contradiction: NOT_RUN + (no warnings) is NOT silently COMPLIANT/HIGH', () => {
  // A NOT_RUN component without any other context must downgrade
  // confidence — never silently land on COMPLIANT / HIGH.
  const v = verdictFor({
    components: [{ name: '§73.182 NIF', status: FindingStatus.NOT_RUN }]
  });
  assert.notEqual(v.confidence, Confidence.HIGH);
  assert.notEqual(v.scope, Scope.FULL_FILING);
});

test('contradiction: SCREENING_PASS cannot be VERIFIED/HIGH at validation surface', () => {
  const v = verdictFor({
    components: [
      { name: 'a', status: FindingStatus.PASS },
      { name: 'b', status: FindingStatus.SCREENING_PASS }
    ]
  });
  const legacy = legacyValidationStatus(v);
  assert.notEqual(legacy.status, 'VERIFIED');
  assert.notEqual(legacy.confidence, Confidence.HIGH);
});

test('contradiction: INCOMPLETE cannot be VERIFIED/HIGH', () => {
  const v = verdictFor({
    components: [{ name: 'parity', status: FindingStatus.INCOMPLETE }]
  });
  const legacy = legacyValidationStatus(v);
  assert.equal(legacy.status, 'UNVERIFIED');
  assert.equal(legacy.confidence, Confidence.LOW);
});

// ===========================================================================
// legacy projections — surjective onto expected strings
// ===========================================================================

test('legacyConclusionStatus covers all Verdict.* values', () => {
  const got = new Set(Object.values(Verdict).map(legacyConclusionStatus));
  for (const expected of [
    'COMPLIANT', 'COMPLIANT VIA ALTERNATE RULE',
    'ENGINEERING REVIEW REQUIRED', 'NON-COMPLIANT'
  ]){
    assert.ok(got.has(expected), `legacy projection missing ${expected}`);
  }
});

test('legacyValidationStatus enumerated cases', () => {
  assert.deepEqual(
    legacyValidationStatus({ confidence: Confidence.HIGH, scope: Scope.FULL_FILING }),
    { status: 'VERIFIED', confidence: 'HIGH' }
  );
  assert.deepEqual(
    legacyValidationStatus({ confidence: Confidence.MEDIUM, scope: Scope.CHECKS_EVALUATED }),
    { status: 'PARTIAL', confidence: 'MEDIUM' }
  );
  assert.deepEqual(
    legacyValidationStatus({ confidence: Confidence.MEDIUM, scope: Scope.SCREENING }),
    { status: 'PARTIAL', confidence: 'MEDIUM' }
  );
  assert.deepEqual(
    legacyValidationStatus({ confidence: Confidence.LOW, scope: Scope.UNVERIFIED }),
    { status: 'UNVERIFIED', confidence: 'LOW' }
  );
});

// ===========================================================================
// serviceWording.js
// ===========================================================================

test('wordingFor(AM) returns AM-specific terminology (power, groundwave, §73.184)', () => {
  const w = wordingFor('AM');
  assert.equal(w.service_label, 'AM');
  assert.equal(w.erp_term, 'power');
  assert.match(w.coverage_phrase, /groundwave/i);
  assert.match(w.coverage_term, /groundwave field strength/i);
  assert.equal(w.propagation_cite, '§73.184');
  assert.equal(w.coverage_rule_cite, '§73.184');
});

test('wordingFor(FM) returns FM-specific terminology (ERP, contour, §73.313 / §73.207)', () => {
  const w = wordingFor('FM');
  assert.equal(w.service_label, 'FM');
  assert.equal(w.erp_term, 'ERP');
  assert.equal(w.propagation_cite, '§73.313');
  assert.equal(w.allocation_rule_cite, '§73.207');
  assert.equal(w.interference_cite, '§73.215');
});

test('wordingFor(LPFM) returns LPFM terminology — §73.807 allocation, §73.333 propagation, §73.811 ERP ceiling', () => {
  // Per fcc-attorney F-006: §73.811 governs LPFM ERP / antenna-height
  // ceiling, not the propagation methodology.  The 60 dBµV/m LPFM
  // service contour derives from §73.313 (HAAT method) + §73.333 (FM
  // curves) applied with LPFM caps — so propagation_cite must be
  // §73.333, not §73.811.
  const w = wordingFor('LPFM');
  assert.equal(w.service_label, 'LPFM');
  assert.equal(w.allocation_rule_cite, '§73.807');
  assert.equal(w.propagation_cite, '§73.333');
  assert.equal(w.erp_ceiling_cite, '§73.811');
});

test('wordingFor(FX) returns FM-translator terminology (§74.1204)', () => {
  const w = wordingFor('FX');
  assert.match(w.service_label, /translator/i);
  assert.equal(w.allocation_rule_cite, '§74.1204');
});

test('wordingFor(TV) returns TV terminology (§73.616 / §73.625)', () => {
  const w = wordingFor('TV');
  assert.equal(w.service_label, 'TV');
  assert.equal(w.propagation_cite, '§73.625');
  assert.equal(w.allocation_rule_cite, '§73.616');
});

test('wordingFor() is case-insensitive and accepts aliases', () => {
  assert.equal(wordingFor('am').service_label, 'AM');
  assert.equal(wordingFor('Fm').service_label, 'FM');
  assert.equal(wordingFor('translator').service_label, wordingFor('FX').service_label);
  assert.equal(wordingFor('DTV').service_label, 'TV');
});

test('wordingFor() returns a stable, frozen vocabulary object', () => {
  const w = wordingFor('AM');
  assert.throws(() => { w.erp_term = 'other'; }, TypeError);
});

test('wordingFor(unknown) falls back to FM', () => {
  assert.equal(wordingFor('NOT_A_SERVICE').service_label, 'FM');
  assert.equal(wordingFor(undefined).service_label, 'FM');
});

test('normalizeService canonicalises aliases', () => {
  assert.equal(normalizeService('translator'), 'FX');
  assert.equal(normalizeService('dtv'), 'TV');
  assert.equal(normalizeService('am'), 'AM');
});

// ===========================================================================
// rewordForReport — project-wide rewordings
// ===========================================================================

test('rewordForReport replaces "tier-3 fallback" → "engineering reference fallback"', () => {
  assert.equal(
    rewordForReport('using tier-3 fallback for the curve'),
    'using engineering reference fallback for the curve'
  );
  assert.equal(
    rewordForReport('TIER 3 FALLBACK'),
    'engineering reference fallback'
  );
});

test('rewordForReport replaces "engine-self" → "computational pipeline"', () => {
  assert.equal(
    rewordForReport('compares engine-self to ZTR'),
    'compares computational pipeline to ZTR'
  );
});

test('rewordForReport replaces "orchestrator" → "computational pipeline"', () => {
  assert.equal(
    rewordForReport('the orchestrator attaches the report'),
    'the computational pipeline attaches the report'
  );
});

test('rewordForReport replaces "stale exhibit" → "previously cached"', () => {
  assert.equal(
    rewordForReport('looks like a stale exhibit'),
    'looks like a previously cached'
  );
});

test('rewordForReport replaces "screening-grade" → "advisory screening engine"', () => {
  assert.equal(
    rewordForReport('screening-grade Berry 1968 engine'),
    'advisory screening engine Berry 1968 engine'
  );
});

test('rewordForReport is idempotent', () => {
  const once = rewordForReport('the orchestrator + stale exhibit + tier-3 fallback');
  const twice = rewordForReport(once);
  assert.equal(once, twice);
});

test('rewordForReport handles empty / non-string input safely', () => {
  assert.equal(rewordForReport(''), '');
  assert.equal(rewordForReport(undefined), undefined);
  assert.equal(rewordForReport(null), null);
});

// ===========================================================================
// Integration: conclusion + validation sections agree with the ontology
// ===========================================================================

import { buildConclusionSection } from '../exports/engineeringReport/sections/conclusion.js';
import { buildValidationVerdictSection } from '../exports/engineeringReport/sections/validationVerdict.js';

test('buildConclusionSection exposes ontology fields (verdict, confidence, scope, narrative_fragments)', () => {
  const c = buildConclusionSection({
    station_inputs: { service: 'FM' },
    annotations: [],
    evidence: {}
  });
  assert.ok('verdict' in c);
  assert.ok('confidence' in c);
  assert.ok('scope' in c);
  assert.ok(Array.isArray(c.narrative_fragments));
});

test('AM NIF FCCAM-sourced fail ⇒ conclusion legacy status = NON-COMPLIANT (filing blocker)', () => {
  const c = buildConclusionSection({
    station_inputs: { service: 'AM', fcc_class: 'B' },
    annotations: [],
    evidence: {
      am_night_nif: {
        available: true,
        provenance: { upstream_skywave: 'FCCAM' },
        summary: { n_failing_azimuths: 4, azimuths_evaluated: 36, worst_margin_db: -2.5 }
      }
    }
  });
  assert.equal(c.status, 'NON-COMPLIANT');
  assert.equal(c.verdict, Verdict.NOT_FILING_READY);
  assert.equal(c.scope, Scope.UNVERIFIED);
});

test('AM NIF Berry-sourced fail ⇒ conclusion legacy status = ENGINEERING REVIEW REQUIRED', () => {
  const c = buildConclusionSection({
    station_inputs: { service: 'AM', fcc_class: 'B' },
    annotations: [],
    evidence: {
      am_night_nif: {
        available: true,
        provenance: { upstream_skywave: 'berry-1968' },
        summary: { n_failing_azimuths: 3, azimuths_evaluated: 36, worst_margin_db: -1.0 }
      }
    }
  });
  assert.equal(c.status, 'ENGINEERING REVIEW REQUIRED');
  assert.equal(c.verdict, Verdict.SCREENING_ADVISORY);
  assert.equal(c.scope, Scope.SCREENING);
  // Narrative uses the rewording: never "screening-grade".
  assert.ok(!/screening-grade/i.test(c.narrative),
            'narrative must use "advisory screening engine" wording');
});

test('blocker annotation ⇒ conclusion legacy status = NON-COMPLIANT', () => {
  const c = buildConclusionSection({
    station_inputs: { service: 'FM' },
    annotations: [{ severity: 'blocker', code: 'X', message: 'blocker' }],
    evidence: {}
  });
  assert.equal(c.status, 'NON-COMPLIANT');
});

test('warnings-only ⇒ conclusion legacy status = ENGINEERING REVIEW REQUIRED', () => {
  const c = buildConclusionSection({
    station_inputs: { service: 'FM' },
    annotations: [{ severity: 'warning', code: 'W', message: 'warn' }],
    evidence: {}
  });
  assert.equal(c.status, 'ENGINEERING REVIEW REQUIRED');
});

test('clean exhibit ⇒ conclusion legacy status = COMPLIANT', () => {
  const c = buildConclusionSection({
    station_inputs: { service: 'FM' },
    annotations: [],
    evidence: {}
  });
  assert.equal(c.status, 'COMPLIANT');
});

test('§73.207 fail + §73.215 pass ⇒ conclusion legacy status = COMPLIANT VIA ALTERNATE RULE', () => {
  const c = buildConclusionSection({
    station_inputs: { service: 'FM' },
    annotations: [],
    evidence: {},
    regulatory_compliance: {
      cite: '47 CFR §73.215',
      pass: true,
      section_73_207: { pass: false }
    }
  });
  assert.equal(c.status, 'COMPLIANT VIA ALTERNATE RULE');
});

test('validation verdict carries an ontology block', () => {
  const v = buildValidationVerdictSection({
    station_inputs: { service: 'FM' },
    validation_context: {
      curve_reference_validation: {
        pass: true, result: 'pass', n_pass: 36, n_run: 36, max_error_km: 0.01,
        lock_statement: { upstream_commit: 'abcdef0123456789' }
      },
      fcc_cross_check: { result: 'pass', n_pass: 36, n_run: 36 }
    },
    evidence: {
      fcc_parity_report: { available: true, overall_pass: true, n_pass: 12, n_samples: 12, tolerance_km: 0.5, max_error_km: 0.05 }
    }
  });
  assert.ok(v.verdict.ontology, 'validation verdict must expose ontology surface');
  assert.ok('verdict' in v.verdict.ontology);
  assert.ok('confidence' in v.verdict.ontology);
  assert.ok('scope' in v.verdict.ontology);
  assert.ok(Array.isArray(v.verdict.ontology.narrative_fragments));
});

test('validation verdict: absent curve record (INCOMPLETE) forces UNVERIFIED/LOW', () => {
  const v = buildValidationVerdictSection({
    station_inputs: { service: 'FM' },
    validation_context: {},
    evidence: {}
  });
  assert.equal(v.verdict.status, 'UNVERIFIED');
  assert.equal(v.verdict.confidence, 'LOW');
});
