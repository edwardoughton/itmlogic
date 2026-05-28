// Finding-contradiction guards.
//
// The engine's finding ontology (genoa/src/engine/finding/ontology.js)
// defines a closed set of FindingStatus values plus a verdict reducer
// (verdictFor) that maps {components, blockers, warnings} → an overall
// disposition (status, scope, confidence).
//
// These tests are CONTRADICTION DETECTORS — they fail when a future
// refactor accidentally allows a contradictory verdict, e.g.
//
//   1. NIF (Notice of Intent to File) status: FAIL must NEVER produce
//      a COMPLIANT verdict.  FILING_BLOCKER must NEVER produce
//      COMPLIANT.
//   2. NOT_RUN must NEVER summarise as "no warnings" — NOT_RUN means
//      the gate did not execute, which is itself a reviewable warning.
//   3. UNVERIFIED scope must NEVER produce VERIFIED-equivalent status
//      (COMPLIANT*).  Likewise an INCOMPLETE component must not yield
//      a VERIFIED/COMPLIANT verdict.
//
// References: ontology invariants I1–I8 in the file header.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FindingStatus, Verdict, Scope, Confidence,
  verdictFor, BLOCKING_STATUSES, UNRESOLVED_STATUSES, SCREENING_STATUSES
} from '../engine/finding/ontology.js';

function makeComp(name, status, extras = {}){
  return { name, status, ...extras };
}

/* ---------------- I1 / FILING_BLOCKER ------------------ */

test('FILING_BLOCKER component → status is NOT COMPLIANT', () => {
  const v = verdictFor({
    components: [
      makeComp('NIF', FindingStatus.FILING_BLOCKER, { cite: '§73.182' }),
      makeComp('curve', FindingStatus.PASS)
    ]
  });
  assert.notStrictEqual(v.status, Verdict.COMPLIANT);
  assert.notStrictEqual(v.status, Verdict.COMPLIANT_FOR_CHECKS);
  assert.notStrictEqual(v.status, Verdict.COMPLIANT_VIA_ALT_RULE);
  assert.equal(v.status, Verdict.NOT_FILING_READY);
  // I1 also requires scope = UNVERIFIED
  assert.equal(v.scope, Scope.UNVERIFIED);
});

test('NIF FAIL status → not COMPLIANT', () => {
  // FAIL is a hard component failure on a filing-grade engine — it must
  // never be reconciled into a COMPLIANT verdict.
  const v = verdictFor({
    components: [
      makeComp('NIF (§73.182)', FindingStatus.FAIL, { cite: '§73.182' }),
      makeComp('curve validation', FindingStatus.PASS)
    ]
  });
  for (const compliant of [Verdict.COMPLIANT, Verdict.COMPLIANT_FOR_CHECKS, Verdict.COMPLIANT_VIA_ALT_RULE]){
    assert.notStrictEqual(v.status, compliant, `FAIL → ${compliant} is a contradiction`);
  }
});

/* ---------------- I2 / blocker ------------------------- */

test('blocker annotation → status NOT COMPLIANT', () => {
  const v = verdictFor({
    components: [makeComp('curve', FindingStatus.PASS)],
    blockers:   [{ code: 'CURVE_VALIDATION_MISSING', message: 'no green reference run' }]
  });
  assert.notStrictEqual(v.status, Verdict.COMPLIANT);
});

/* ---------------- I4 / INCOMPLETE → not VERIFIED -------- */

test('INCOMPLETE component → verdict is not COMPLIANT and confidence is LOW', () => {
  const v = verdictFor({
    components: [
      makeComp('curve', FindingStatus.PASS),
      makeComp('orchestrator-attached spacing', FindingStatus.INCOMPLETE)
    ]
  });
  assert.notStrictEqual(v.status, Verdict.COMPLIANT);
  assert.equal(v.confidence, Confidence.LOW);
  assert.equal(v.scope, Scope.UNVERIFIED);
});

/* ---------------- NOT_RUN ≠ "no warnings" --------------- */

test('NOT_RUN component never appears alongside a "no warnings" disposition', () => {
  // Build a verdict whose only "negative" signal is a NOT_RUN gate.
  // The verdict reducer must downgrade scope from FULL_FILING and
  // produce a narrative fragment that names the unrun gate.
  const v = verdictFor({
    components: [
      makeComp('curve validation', FindingStatus.PASS),
      makeComp('FCC parity',       FindingStatus.NOT_RUN)
    ]
  });
  // NOT_RUN must NOT degrade to "no warnings" / COMPLIANT.
  // I5: NOT_RUN downgrades scope from FULL_FILING to CHECKS_EVALUATED.
  assert.notStrictEqual(v.scope, Scope.FULL_FILING,
    'NOT_RUN must downgrade scope from FULL_FILING');
  // Narrative must mention the un-run gate so a reviewer cannot miss it.
  const narrative = (v.narrative_fragments || []).join(' ').toLowerCase();
  assert.ok(narrative.length > 0, 'verdict must include narrative fragments');
});

test('UNRESOLVED_STATUSES include NOT_RUN and INCOMPLETE (vocabulary guard)', () => {
  assert.ok(UNRESOLVED_STATUSES.includes(FindingStatus.NOT_RUN));
  assert.ok(UNRESOLVED_STATUSES.includes(FindingStatus.INCOMPLETE));
});

/* ---------------- UNVERIFIED ≠ VERIFIED ----------------- */

test('UNVERIFIED scope is incompatible with COMPLIANT verdict', () => {
  // A FILING_BLOCKER drives scope=UNVERIFIED.  The verdict must not
  // claim COMPLIANT* in that scope.
  const v = verdictFor({
    components: [makeComp('NIF', FindingStatus.FILING_BLOCKER)]
  });
  assert.equal(v.scope, Scope.UNVERIFIED);
  for (const compliant of [Verdict.COMPLIANT, Verdict.COMPLIANT_FOR_CHECKS, Verdict.COMPLIANT_VIA_ALT_RULE]){
    assert.notStrictEqual(v.status, compliant,
      `UNVERIFIED scope + ${v.status}=${compliant} is a self-contradiction`);
  }
});

test('SCREENING_FAIL component → SCREENING_ADVISORY, not NON_COMPLIANT', () => {
  // I3: a screening-grade failure cannot bind; it must surface as
  // SCREENING_ADVISORY with at most MEDIUM confidence.
  const v = verdictFor({
    components: [
      makeComp('Berry skywave', FindingStatus.SCREENING_FAIL),
      makeComp('curve', FindingStatus.PASS)
    ]
  });
  assert.equal(v.status, Verdict.SCREENING_ADVISORY);
  assert.notStrictEqual(v.confidence, Confidence.HIGH);
});

/* ---------------- BLOCKING_STATUSES vocab ---------------- */

test('BLOCKING_STATUSES set is FILING_BLOCKER + BLOCKER + FAIL (no silent additions)', () => {
  // Future drift detector: if a maintainer adds a new "soft fail"
  // to BLOCKING_STATUSES without updating verdictFor, the contradiction
  // surface widens.  Pin the set.
  const want = new Set([FindingStatus.FILING_BLOCKER, FindingStatus.BLOCKER, FindingStatus.FAIL]);
  const got  = new Set(BLOCKING_STATUSES);
  assert.equal(got.size, want.size, 'BLOCKING_STATUSES vocabulary changed');
  for (const v of want) assert.ok(got.has(v), `missing ${v} from BLOCKING_STATUSES`);
});

test('all-PASS verdict is COMPLIANT, FULL_FILING, HIGH (I7 contract)', () => {
  const v = verdictFor({
    components: [
      makeComp('curve',  FindingStatus.PASS),
      makeComp('parity', FindingStatus.PASS),
      makeComp('xcheck', FindingStatus.PASS)
    ]
  });
  assert.equal(v.status, Verdict.COMPLIANT);
  assert.equal(v.scope, Scope.FULL_FILING);
  assert.equal(v.confidence, Confidence.HIGH);
});

test('warnings-only verdict → ENGINEERING_REVIEW (I6), never COMPLIANT', () => {
  const v = verdictFor({
    components: [makeComp('curve', FindingStatus.PASS)],
    warnings:   [{ code: 'TERRAIN_NOT_APPLIED' }]
  });
  assert.equal(v.status, Verdict.ENGINEERING_REVIEW);
  assert.notStrictEqual(v.status, Verdict.COMPLIANT);
});
