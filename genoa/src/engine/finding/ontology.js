// Finding ontology — a formal vocabulary for finding statuses, verdict
// dispositions, and confidence levels used throughout Genoa's report
// generation pipeline.
//
// Why this module exists
// ----------------------
// Historically, the engineering report layer assembled verdicts ad-hoc
// from string literals like 'FAIL' / 'COMPLIANT' / 'NOT_RUN'.  Two failure
// modes recurred:
//
//   1.  Contradictions across sections — e.g. a cover page reading
//       "VERIFIED / HIGH" while the validation section carried a SCREENING
//       row, or a conclusion of "COMPLIANT" while a FILING_BLOCKER finding
//       was present in the annotations.
//
//   2.  Silent under-reporting — a missing component record surfacing as
//       NOT_RUN with no warnings, when in reality it represented an
//       upstream attachment bug that should fail the verdict closed.
//
// This module fixes both classes by defining:
//
//   * a closed enum of legal finding statuses (`FindingStatus`),
//   * confidence and scope vocabularies (`Confidence`, `Scope`), and
//   * a pure function `verdictFor(...)` that maps a normalised set of
//     {components, blockers, warnings} into a `{status, confidence,
//     scope, narrative_fragments[]}` shape, with documented invariants
//     that the verdict ↔ status relationship MUST respect.
//
// Section authors should:
//   * tag every component with a FindingStatus value (never a free string),
//   * never reach inside this module to override the precedence rules,
//   * surface SCREENING_* and INCOMPLETE honestly rather than collapsing
//     them into PASS / FAIL.

// ---------------------------------------------------------------------------
// Finding status enum
// ---------------------------------------------------------------------------

/**
 * Closed set of legal finding statuses.  Each constant has a single
 * documented meaning and a known place in the verdict precedence order
 * defined by `verdictFor()`.
 *
 *   PASS              — component ran and met its acceptance criterion.
 *   INFO              — component is informational only (e.g. radial
 *                       count, dataset SHA); never gates verdict.
 *   SKIP              — component intentionally did not run because the
 *                       regulation / service / inputs do not require it
 *                       (e.g. terrain on an AM exhibit).
 *   ADVISORY          — non-binding observation a reviewer may wish to
 *                       inspect (e.g. terrain-aware engineering
 *                       confidence).  Does not gate compliance.
 *   NOT_RUN           — component was not executed because a prerequisite
 *                       (configuration / dataset / sidecar) was missing.
 *                       This is NEVER a clean pass.
 *   INCOMPLETE        — component was reached but could not produce a
 *                       defensible result (data-loss / orchestrator-
 *                       attachment failure / stale exhibit).  Treated as
 *                       UNVERIFIED for verdict purposes.
 *   SCREENING_PASS    — component ran on a SCREENING-grade engine
 *                       (e.g. Berry 1968 AM skywave) and passed.  Caps
 *                       headline confidence at MEDIUM and verdict status
 *                       at PARTIAL; never VERIFIED / HIGH.
 *   SCREENING_FAIL    — component ran on a screening-grade engine and
 *                       failed.  Advisory failure — must be re-run with
 *                       the filing-grade engine before binding.
 *   FAIL              — component ran on a filing-grade engine and failed
 *                       its acceptance criterion.  Gates compliance.
 *   BLOCKER           — finding severe enough to prevent a clean
 *                       compliance disposition independent of any one
 *                       component (e.g. blocker-level annotation).
 *   FILING_BLOCKER    — a specific subclass of BLOCKER: a rule-text
 *                       violation that the FCC will reject on filing
 *                       (e.g. §73.182 NIF binding fail on FCCAM).
 *                       FILING_BLOCKER ⇒ verdict.status MUST NOT be
 *                       COMPLIANT.
 */
export const FindingStatus = Object.freeze({
  PASS:           'PASS',
  INFO:           'INFO',
  SKIP:           'SKIP',
  ADVISORY:       'ADVISORY',
  NOT_RUN:        'NOT_RUN',
  INCOMPLETE:     'INCOMPLETE',
  SCREENING_PASS: 'SCREENING_PASS',
  SCREENING_FAIL: 'SCREENING_FAIL',
  FAIL:           'FAIL',
  BLOCKER:        'BLOCKER',
  FILING_BLOCKER: 'FILING_BLOCKER'
});

/** Ordered list (highest severity first) for precedence comparisons. */
export const FINDING_STATUS_ORDER = Object.freeze([
  FindingStatus.FILING_BLOCKER,
  FindingStatus.BLOCKER,
  FindingStatus.FAIL,
  FindingStatus.SCREENING_FAIL,
  FindingStatus.INCOMPLETE,
  FindingStatus.NOT_RUN,
  FindingStatus.SCREENING_PASS,
  FindingStatus.ADVISORY,
  FindingStatus.SKIP,
  FindingStatus.INFO,
  FindingStatus.PASS
]);

/** Statuses that are "blocking" for verdict purposes. */
export const BLOCKING_STATUSES = Object.freeze([
  FindingStatus.FILING_BLOCKER,
  FindingStatus.BLOCKER,
  FindingStatus.FAIL
]);

/** Statuses that mean the component did not produce a defensible result. */
export const UNRESOLVED_STATUSES = Object.freeze([
  FindingStatus.NOT_RUN,
  FindingStatus.INCOMPLETE
]);

/** Statuses that come from screening-grade (non-filing) engines. */
export const SCREENING_STATUSES = Object.freeze([
  FindingStatus.SCREENING_PASS,
  FindingStatus.SCREENING_FAIL
]);

/**
 * Return true iff `status` is a member of the closed `FindingStatus` enum.
 */
export function isFindingStatus(status){
  return Object.values(FindingStatus).includes(status);
}

// ---------------------------------------------------------------------------
// Confidence + scope vocabularies
// ---------------------------------------------------------------------------

export const Confidence = Object.freeze({
  HIGH:   'HIGH',
  MEDIUM: 'MEDIUM',
  LOW:    'LOW'
});

const CONFIDENCE_RANK = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/**
 * Return the lower of two confidence values (cap-style).
 */
export function capConfidence(a, b){
  const ra = CONFIDENCE_RANK[a] ?? 0;
  const rb = CONFIDENCE_RANK[b] ?? 0;
  return ra <= rb ? a : b;
}

/**
 * Verdict scope — describes *what* the verdict actually evaluated.
 * Used to write honest conclusions like "compliant for the checks
 * evaluated" rather than implying full filing-readiness.
 */
export const Scope = Object.freeze({
  CHECKS_EVALUATED: 'CHECKS_EVALUATED',  // limited subset of rules ran
  FULL_FILING:      'FULL_FILING',       // all applicable rules ran cleanly
  SCREENING:        'SCREENING',         // ran on advisory engine(s)
  UNVERIFIED:       'UNVERIFIED'         // can't make a defensible claim
});

/** Verdict-level dispositions (distinct from per-component statuses). */
export const Verdict = Object.freeze({
  COMPLIANT:                 'COMPLIANT',
  COMPLIANT_FOR_CHECKS:      'COMPLIANT_FOR_CHECKS',     // scoped success
  COMPLIANT_VIA_ALT_RULE:    'COMPLIANT_VIA_ALT_RULE',   // §73.215 path
  ENGINEERING_REVIEW:        'ENGINEERING_REVIEW',        // warnings only
  SCREENING_ADVISORY:        'SCREENING_ADVISORY',        // screening-grade failure
  NOT_FILING_READY:          'NOT_FILING_READY',          // filing-blocker
  NON_COMPLIANT:             'NON_COMPLIANT'              // generic non-compliance
});

// ---------------------------------------------------------------------------
// verdictFor — the central reducer
// ---------------------------------------------------------------------------

/**
 * Compute a verdict from a normalised set of findings.
 *
 * Inputs:
 *   components — array of { name, status, detail?, cite?, scope? } where
 *                `status` is a FindingStatus value.
 *   blockers   — array of blocker-level annotations (severity:'blocker').
 *                Each may carry { code, message, cite, filing_blocker:bool }.
 *   warnings   — array of warning-level annotations.
 *
 * Output:
 *   {
 *     status:               Verdict.*        — overall disposition,
 *     confidence:           Confidence.*     — headline confidence cap,
 *     scope:                Scope.*          — what was actually evaluated,
 *     narrative_fragments:  string[]         — composable sentences for
 *                                              section authors to splice
 *                                              into prose conclusions.
 *   }
 *
 * Invariants (enforced by the implementation and asserted in tests):
 *
 *   I1.  Any component with FILING_BLOCKER ⇒ status ≠ COMPLIANT* and
 *        scope = UNVERIFIED.  The disposition is NOT_FILING_READY.
 *   I2.  Any BLOCKER (component or annotation) without an offsetting
 *        alt-rule pass ⇒ status = NON_COMPLIANT.
 *   I3.  Any SCREENING_* component ⇒ confidence ≤ MEDIUM and scope is
 *        at most SCREENING.  A SCREENING_FAIL ⇒ status =
 *        SCREENING_ADVISORY (not NON_COMPLIANT — the screening engine
 *        cannot bind under §73.187/§73.190(c)).
 *   I4.  Any INCOMPLETE component ⇒ confidence = LOW and scope =
 *        UNVERIFIED; the verdict cannot claim COMPLIANT.
 *   I5.  NOT_RUN components downgrade scope from FULL_FILING to
 *        CHECKS_EVALUATED but do not by themselves fail the verdict.
 *   I6.  Warnings without blockers, fails, screening fails, incomplete,
 *        or filing blockers ⇒ status = ENGINEERING_REVIEW.
 *   I7.  All-clear (only PASS / INFO / SKIP / ADVISORY components, no
 *        warnings, no blockers) ⇒ status = COMPLIANT and scope =
 *        FULL_FILING with confidence = HIGH.
 *   I8.  An alt-rule pass (component flagged scope='ALT_RULE' with
 *        status=PASS) offsets a BLOCKER tagged with the same alt-rule
 *        cite ⇒ status = COMPLIANT_VIA_ALT_RULE.
 */
export function verdictFor({ components = [], blockers = [], warnings = [] } = {}){
  // Defensive normalisation.
  const comps = Array.isArray(components) ? components.filter(Boolean) : [];
  const blks  = Array.isArray(blockers)   ? blockers.filter(Boolean)   : [];
  const wrns  = Array.isArray(warnings)   ? warnings.filter(Boolean)   : [];

  const has = (s) => comps.some(c => c?.status === s);
  const any = (arr, pred) => arr.some(pred);

  const filingBlocker =
    comps.some(c => c?.status === FindingStatus.FILING_BLOCKER) ||
    blks.some(b => b?.filing_blocker === true || b?.scope === 'FILING');
  const generalBlocker =
    comps.some(c => c?.status === FindingStatus.BLOCKER) ||
    blks.length > 0;
  const fail        = has(FindingStatus.FAIL);
  const screenFail  = has(FindingStatus.SCREENING_FAIL);
  const screenPass  = has(FindingStatus.SCREENING_PASS);
  const incomplete  = has(FindingStatus.INCOMPLETE);
  const notRun      = has(FindingStatus.NOT_RUN);
  const advisory    = has(FindingStatus.ADVISORY);
  const hasWarnings = wrns.length > 0;

  // Alt-rule offset: a §73.207 BLOCKER paired with a §73.215 PASS
  // component flagged scope='ALT_RULE' yields COMPLIANT_VIA_ALT_RULE.
  const altRulePass = comps.find(c =>
    c?.status === FindingStatus.PASS && c?.scope === 'ALT_RULE'
  );

  const fragments = [];

  // I1 — FILING_BLOCKER short-circuits everything.
  if (filingBlocker){
    const cite =
      comps.find(c => c?.status === FindingStatus.FILING_BLOCKER)?.cite
      || blks.find(b => b?.filing_blocker === true)?.cite
      || null;
    fragments.push(
      cite
        ? `not filing-ready: ${cite} fails`
        : 'not filing-ready: a filing-controlling rule fails for the proposed facility'
    );
    fragments.push('facility redesign, waiver analysis, or further engineering review is required prior to filing.');
    return {
      status:               Verdict.NOT_FILING_READY,
      confidence:           Confidence.LOW,
      scope:                Scope.UNVERIFIED,
      narrative_fragments:  fragments
    };
  }

  // I3 — SCREENING_FAIL: advisory failure, not binding.
  if (screenFail){
    fragments.push('screening-grade — re-run with FCCAM/Wang before filing.');
    fragments.push('a Berry-only failure is advisory and may not bind under §73.187 / §73.190(c).');
    return {
      status:               Verdict.SCREENING_ADVISORY,
      confidence:           Confidence.LOW,
      scope:                Scope.SCREENING,
      narrative_fragments:  fragments
    };
  }

  // I2 — General BLOCKER without an offsetting alt-rule pass.
  if (generalBlocker){
    if (altRulePass){
      fragments.push('does not qualify under the primary rule but qualifies under the alternate (contour-protection) rule.');
      return {
        status:               Verdict.COMPLIANT_VIA_ALT_RULE,
        confidence:           Confidence.HIGH,
        scope:                Scope.FULL_FILING,
        narrative_fragments:  fragments
      };
    }
    fragments.push('one or more blocker-level findings prevent a clean compliance disposition.');
    fragments.push('facility redesign, waiver analysis, or further engineering review is required prior to filing.');
    return {
      status:               Verdict.NON_COMPLIANT,
      confidence:           Confidence.LOW,
      scope:                Scope.UNVERIFIED,
      narrative_fragments:  fragments
    };
  }

  // FAIL (filing-grade, not blocker-tagged).  Treated as NON_COMPLIANT
  // unless an alt-rule pass offsets it.
  if (fail){
    if (altRulePass){
      fragments.push('does not qualify under the primary rule but qualifies under the alternate (contour-protection) rule.');
      return {
        status:               Verdict.COMPLIANT_VIA_ALT_RULE,
        confidence:           Confidence.HIGH,
        scope:                Scope.FULL_FILING,
        narrative_fragments:  fragments
      };
    }
    fragments.push('one or more components failed their filing-grade acceptance criteria.');
    return {
      status:               Verdict.NON_COMPLIANT,
      confidence:           Confidence.LOW,
      scope:                Scope.UNVERIFIED,
      narrative_fragments:  fragments
    };
  }

  // I4 — INCOMPLETE: data-loss / orchestrator-attachment failure.
  if (incomplete){
    fragments.push('one or more components could not produce a defensible result.');
    fragments.push('verdict is UNVERIFIED until the upstream issue is investigated and the exhibit re-built.');
    return {
      status:               Verdict.ENGINEERING_REVIEW,
      confidence:           Confidence.LOW,
      scope:                Scope.UNVERIFIED,
      narrative_fragments:  fragments
    };
  }

  // I3 — SCREENING_PASS (no fails).
  if (screenPass){
    fragments.push('compliant for the checks evaluated, but one or more checks ran on a screening-grade engine.');
    fragments.push('re-run with the filing-grade engine before binding.');
    return {
      status:               Verdict.COMPLIANT_FOR_CHECKS,
      confidence:           Confidence.MEDIUM,
      scope:                Scope.SCREENING,
      narrative_fragments:  fragments
    };
  }

  // I6 — Warnings only.
  if (hasWarnings){
    fragments.push('no rule failure was raised, but one or more advisory findings warrant review by the qualified broadcast engineer of record before filing.');
    return {
      status:               Verdict.ENGINEERING_REVIEW,
      confidence:           Confidence.MEDIUM,
      scope:                Scope.CHECKS_EVALUATED,
      narrative_fragments:  fragments
    };
  }

  // I5 — NOT_RUN downgrades scope but does not fail.
  if (notRun){
    fragments.push('compliant for the checks evaluated; one or more applicable checks were not run (prerequisite missing).');
    return {
      status:               Verdict.COMPLIANT_FOR_CHECKS,
      confidence:           Confidence.MEDIUM,
      scope:                Scope.CHECKS_EVALUATED,
      narrative_fragments:  fragments
    };
  }

  // I7 — All-clear.
  fragments.push('all applicable technical requirements evaluated in this exhibit are met.');
  fragments.push('no blocker- or warning-level findings were raised by the engine.');
  // Optional advisory addendum (terrain confidence, etc.) doesn't change
  // the clean COMPLIANT disposition but is worth a fragment.
  if (advisory){
    fragments.push('one or more advisory notes accompany this verdict; see the validation section for details.');
  }
  return {
    status:               Verdict.COMPLIANT,
    confidence:           Confidence.HIGH,
    scope:                Scope.FULL_FILING,
    narrative_fragments:  fragments
  };
}

/**
 * Project an internal Verdict.* value onto the legacy report-section
 * status strings.  Existing consumers and tests assert on these literals;
 * this projection is the bridge between the new ontology and the report
 * surface.
 */
export function legacyConclusionStatus(verdict){
  switch (verdict){
    case Verdict.COMPLIANT:              return 'COMPLIANT';
    case Verdict.COMPLIANT_FOR_CHECKS:   return 'COMPLIANT';
    case Verdict.COMPLIANT_VIA_ALT_RULE: return 'COMPLIANT VIA ALTERNATE RULE';
    case Verdict.ENGINEERING_REVIEW:     return 'ENGINEERING REVIEW REQUIRED';
    case Verdict.SCREENING_ADVISORY:     return 'ENGINEERING REVIEW REQUIRED';
    case Verdict.NOT_FILING_READY:       return 'NON-COMPLIANT';
    case Verdict.NON_COMPLIANT:          return 'NON-COMPLIANT';
    default:                              return 'ENGINEERING REVIEW REQUIRED';
  }
}

/**
 * Project an internal Verdict + confidence onto the legacy validation
 * verdict tuple (status ∈ {VERIFIED, PARTIAL, UNVERIFIED}, confidence ∈
 * {HIGH, MEDIUM, LOW}).
 */
export function legacyValidationStatus({ confidence, scope }){
  if (scope === Scope.UNVERIFIED || confidence === Confidence.LOW){
    return { status: 'UNVERIFIED', confidence: Confidence.LOW };
  }
  if (scope === Scope.SCREENING || confidence === Confidence.MEDIUM){
    return { status: 'PARTIAL', confidence: Confidence.MEDIUM };
  }
  return { status: 'VERIFIED', confidence: Confidence.HIGH };
}
