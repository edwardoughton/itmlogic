// LMS filing readiness model — shared across per-service mappers.
//
// 5-state field status enum.  Used by every per-service mapper
// (form301am, form301fm, form349, form318) so the packager / UI /
// tests never have to special-case form_id when deciding what a
// field's status means.
//
//   FILLED            Genoa has a verified value with provenance.
//   SUGGESTED         Genoa has a pre-staged candidate — engineer
//                     of record must confirm before filing.  Counts
//                     as a filing gap for gating purposes.
//   NEEDS_INPUT       Field is required on the form, no value yet;
//                     operator must enter manually.  Counts as a
//                     filing gap.
//   EVIDENCE_MISSING  Genoa SHOULD know this from an evidence
//                     sidecar but the sidecar didn't run or failed.
//                     Counts as a filing gap for required fields.
//   NOT_APPLICABLE    Rule-derived: this field doesn't apply to the
//                     subject station (e.g. ERP-V on an AM filing;
//                     §73.215 study when filing under §73.207).  Never
//                     a gap.
//
// `FieldStatus` is the source of truth.  Per-service mappers may
// use the lowercase legacy strings ('filled', 'suggested', 'gap',
// 'unknown') for backwards compatibility with the FM packager —
// `normalizeStatus()` collapses both representations.

export const FieldStatus = Object.freeze({
  FILLED:           'FILLED',
  SUGGESTED:        'SUGGESTED',
  NEEDS_INPUT:      'NEEDS_INPUT',
  EVIDENCE_MISSING: 'EVIDENCE_MISSING',
  NOT_APPLICABLE:   'NOT_APPLICABLE'
});

// Map between legacy lowercase ('filled', 'suggested', 'gap',
// 'unknown') and the new 5-state enum.  Existing form301fm mapper
// still emits the legacy strings; the readiness gate accepts either.
const LEGACY_TO_ENUM = {
  filled:    FieldStatus.FILLED,
  suggested: FieldStatus.SUGGESTED,
  gap:       FieldStatus.NEEDS_INPUT,
  unknown:   FieldStatus.EVIDENCE_MISSING,
  na:        FieldStatus.NOT_APPLICABLE
};

export function normalizeStatus(s){
  if (!s) return FieldStatus.NEEDS_INPUT;
  if (Object.values(FieldStatus).includes(s)) return s;
  const lc = String(s).toLowerCase();
  if (LEGACY_TO_ENUM[lc]) return LEGACY_TO_ENUM[lc];
  return FieldStatus.NEEDS_INPUT;
}

// True iff this status counts as an unmet requirement when the
// field is `required: true` on the schema.  NOT_APPLICABLE never
// counts; FILLED never counts; everything else does.
export function isFilingGap(status){
  const s = normalizeStatus(status);
  return s !== FieldStatus.FILLED && s !== FieldStatus.NOT_APPLICABLE;
}

// Decide whether a per-service filing package is ready to ship.
//
//   fields         array of mapped fields, each carrying
//                  { required, status } at minimum
//   blockers       count of engine-level blockers (NOT advisory
//                  evidence — geo_rf_evidence / am_physics MUST NOT
//                  be passed here)
//   am_night_nif   optional { available, summary: { n_failing_azimuths,
//                  worst_margin_db } } — when present AND any azimuth
//                  fails OR worst margin is negative, the filing is
//                  blocked (AM §73.182 night allocation).  Only
//                  meaningful on AM; FM/FX/LPFM should pass null.
//   compliance_pass optional pass/fail string from regulatory_compliance;
//                  when present, must be 'PASS' or 'PASS-via-73.215'.
//
// Returns { ready: bool, gating_reason: string|null }.
export function gateFilingReady({ fields = [], blockers = 0, am_night_nif = null, compliance_pass = null } = {}){
  // Count required gaps using the 5-state model.
  const required_gaps = fields.filter(f => f.required && isFilingGap(f.status)).length;
  if (required_gaps > 0){
    return { ready: false, gating_reason: `${required_gaps} required field${required_gaps === 1 ? '' : 's'} not filled` };
  }
  if (blockers > 0){
    return { ready: false, gating_reason: `${blockers} engine blocker${blockers === 1 ? '' : 's'} present` };
  }
  if (am_night_nif && am_night_nif.available){
    const nFail = Number(am_night_nif.summary?.n_failing_azimuths) || 0;
    const worst = Number(am_night_nif.summary?.worst_margin_db);
    if (nFail > 0 || (Number.isFinite(worst) && worst < 0)){
      return { ready: false, gating_reason: 'AM §73.182 nighttime NIF allocation fails' };
    }
  }
  if (compliance_pass != null){
    if (compliance_pass !== 'PASS' && compliance_pass !== 'PASS-via-73.215'){
      return { ready: false, gating_reason: `regulatory compliance: ${compliance_pass}` };
    }
  }
  return { ready: true, gating_reason: null };
}

// IDs of evidence blocks that are ADVISORY ONLY and MUST NOT affect
// gateFilingReady().  Exported so callers (packager, route, UI) can
// audit / lint against this list.
export const ADVISORY_EVIDENCE_KEYS = Object.freeze([
  'am_physics',
  'geo_rf_evidence',
  'sdr_captures'
]);
