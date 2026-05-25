// Regulatory-context classifier.
//
// The deterministic engine produces correct per-rule §73.207 / §73.215
// outputs for any input.  But "fails current rule" can mean very
// different things depending on whether the facility is:
//
//   - a brand-new proposed filing  → treat as blocking; must redesign
//                                    or develop a waiver basis
//   - an existing licensed station → treat as a legacy /
//                                    grandfather / waiver risk flag;
//                                    the FCC has already authorized
//                                    operation
//   - a modification scenario      → treat as a high-risk filing;
//                                    modification may require
//                                    contour-protection redesign or
//                                    waiver showing
//
// This module classifies the regulatory context so downstream UI /
// report code can present per-rule failures in the right interpretive
// frame.
//
// IMPORTANT: this module DOES NOT WEAKEN ENGINEERING MATH.  The
// §73.207 / §73.215 outputs and associated warnings are unchanged.
// This is purely an interpretive layer.
//
// Genoa never determines legal authorization status.  This module's
// output is decision-support context for the licensed engineer of
// record.

const LICENSED_STATUS_TOKENS = new Set([
  'LIC',
  'LICENSED'
]);

const PROTECTION_WARNING_CODES = new Set([
  'FM_CONTOUR_PROTECTION_VIOLATION',
  'FM_MINIMUM_SEPARATION_VIOLATION',
  'AM_NIGHTTIME_PROTECTION_VIOLATION'
]);

function normalizeStatus(value){
  if (value == null) return null;
  return String(value).trim().toUpperCase();
}

function hasFacilityId(input){
  return !!(input && (input.facility_id || input.facilityId));
}

/**
 * Classify the regulatory context of an exhibit.
 *
 * @param {object} input       — exhibit station_inputs (or compute()
 *                                input bag).  Optional flags consumed:
 *                                  isProposal:           bool
 *                                  modificationScenario: bool
 *                                  studyIntent:          string
 *                                  status:               string (LIC etc.)
 * @param {object} evidence    — exhibit.evidence; we read
 *                                fcc_lms.status / fcc_lms.license.status
 *                                as the authoritative "is licensed"
 *                                signal.
 * @param {object} studyResult — the exhibit body OR
 *                                { warnings, interference_study }.
 * @returns {object} regulatoryContext shape:
 *   {
 *     facilityStatus:        "licensed" | "proposed" | "unknown",
 *     studyIntent:           "existing_facility_review" |
 *                            "new_filing" | "modification" | "unknown",
 *     currentRuleCompliance: "passes_current_rules" |
 *                            "fails_current_rules" | "not_evaluated",
 *     licenseInterpretation: "ordinary_compliant" |
 *                            "licensed_with_legacy_conflicts" |
 *                            "possible_grandfathered_or_waiver" |
 *                            "requires_engineering_review",
 *     filingRisk:            "low" | "medium" | "high",
 *     userFacingSummary:     string,
 *     notes:                 string[],
 *     warningsToDowngrade:   string[]
 *   }
 */
export function classifyRegulatoryContext(input = {}, evidence = {}, studyResult = {}){
  // ----- facilityStatus -----
  const lmsStatus  = normalizeStatus(
       evidence?.fcc_lms?.status
    || evidence?.fcc_lms?.license?.status
    || input?.status
  );
  const isLicensed = lmsStatus !== null && LICENSED_STATUS_TOKENS.has(lmsStatus);

  let facilityStatus;
  if (isLicensed){
    facilityStatus = 'licensed';
  } else if (input?.isProposal === true || !hasFacilityId(input)){
    facilityStatus = 'proposed';
  } else {
    facilityStatus = 'unknown';
  }

  // ----- studyIntent -----
  let studyIntent;
  if (input?.modificationScenario === true || input?.studyIntent === 'modification'){
    studyIntent = 'modification';
  } else if (facilityStatus === 'licensed'){
    studyIntent = 'existing_facility_review';
  } else if (facilityStatus === 'proposed'){
    studyIntent = 'new_filing';
  } else {
    studyIntent = 'unknown';
  }

  // ----- currentRuleCompliance -----
  const warnings = Array.isArray(studyResult?.warnings) ? studyResult.warnings : [];
  const hasProtectionWarning = warnings.some(w => w && PROTECTION_WARNING_CODES.has(w.code));
  const hasInterferenceStudy = !!studyResult?.interference_study;

  let currentRuleCompliance;
  if (hasProtectionWarning){
    currentRuleCompliance = 'fails_current_rules';
  } else if (hasInterferenceStudy){
    currentRuleCompliance = 'passes_current_rules';
  } else {
    currentRuleCompliance = 'not_evaluated';
  }

  // ----- licenseInterpretation + filingRisk + userFacingSummary -----
  let licenseInterpretation;
  let filingRisk;
  let userFacingSummary;
  const notes = [];
  const warningsToDowngrade = [];

  if (facilityStatus === 'licensed' && currentRuleCompliance === 'fails_current_rules'){
    licenseInterpretation = 'licensed_with_legacy_conflicts';
    filingRisk = (studyIntent === 'modification') ? 'high' : 'medium';
    userFacingSummary =
      'Existing licensed facility.  Current-rule §73.207/§73.215 analysis ' +
      'reports spacing or contour conflicts, but this does not by itself ' +
      'mean the facility is unauthorized.  Treat as a legacy/grandfathering/' +
      'waiver-risk condition.  Any modification should receive licensed ' +
      'engineering review.';
    notes.push('Modeled current-rule conflicts may reflect grandfathered, waived, or otherwise authorized historical operating conditions.');
    warningsToDowngrade.push('FM_CONTOUR_PROTECTION_VIOLATION', 'FM_MINIMUM_SEPARATION_VIOLATION');
  } else if (currentRuleCompliance === 'fails_current_rules'){
    licenseInterpretation = 'requires_engineering_review';
    filingRisk = 'high';
    userFacingSummary =
      'New or proposed filing does not clear current §73.207/§73.215 ' +
      'protections.  Filing cannot be treated as qualified until a ' +
      'compliant configuration, waiver basis, or engineering showing is ' +
      'developed.';
  } else if (currentRuleCompliance === 'passes_current_rules'){
    licenseInterpretation = 'ordinary_compliant';
    filingRisk = 'low';
    userFacingSummary =
      'Current-rule spacing and contour checks did not identify a ' +
      'filing-blocking FM protection issue.';
  } else {
    licenseInterpretation = 'requires_engineering_review';
    filingRisk = 'medium';
    userFacingSummary =
      'Interference study has not been evaluated for this exhibit.  ' +
      'Engineering review required before any current-rule compliance ' +
      'determination can be made.';
  }

  return {
    facilityStatus,
    studyIntent,
    currentRuleCompliance,
    licenseInterpretation,
    filingRisk,
    userFacingSummary,
    notes,
    warningsToDowngrade
  };
}

export const REGULATORY_CONTEXT_DISCLAIMER =
  'This exhibit is an engineering decision-support document.  For ' +
  'existing licensed facilities, modeled current-rule spacing or contour ' +
  'conflicts may reflect grandfathered, waived, historically authorized, ' +
  'or otherwise licensed operating conditions.  Genoa does not determine ' +
  'legal authorization status; this assessment is interpretive only.';

// 47 CFR §73.311 explicitly limits what predicted field-strength contours
// are FOR — and it does NOT include real-world listenable coverage.  We
// surface the rule text verbatim so a reviewer can never confuse the
// regulatory-compliance contour with the actual signal an audience hears.
// This matches consulting-industry practice (cf. Beverage, Radio World
// "Propagation Analysis for Profit", June 2017 p. 16): "the FCC itself,
// in FCC Rule 73.311, says that field strength contours are to be used
// 'for the following purposes only…' Those purposes include in an
// application for construction permit, to assist in selecting a
// transmitter site and city of license coverage determination, and in
// the protection of other stations based on contour clearance."
export const CFR_73_311_CONTOUR_USE =
  'Per 47 CFR §73.311, predicted field-strength contours are authorized ' +
  'for use ONLY in (a) construction-permit applications, (b) transmitter-' +
  'site selection and city-of-license coverage determination, and (c) ' +
  'protection of other stations via contour clearance.  They are NOT a ' +
  'real-world listenable-coverage prediction — real coverage requires ' +
  'drive-test measurement, terrain-aware (Longley-Rice / ITM) modeling, ' +
  'and consideration of local noise, multipath, and seasonal effects ' +
  'that the §73.184 / §73.333 contour math does not capture.';

// AM-specific caveat — the FCC §73.190 Figure M3 conductivity map is the
// regulatory reference but is well-known among AM consultants to
// over-state coverage in many regions.  Source: Beverage, Radio World
// "Propagation Analysis for Profit", June 2017 p. 16-17 — "AM coverage
// maps are often created using the FCC M3 conductivity map. In many
// areas of the country, this significantly over-states the size of the
// contour."  Surfacing this on every AM exhibit keeps the prediction
// honest about what M3 actually represents.
export const AM_M3_OVERSTATEMENT_CAVEAT =
  'AM groundwave contours computed from the §73.190 Figure M3 ' +
  'conductivity map are a regulatory reference, not a measured-coverage ' +
  'prediction.  Industry consulting practice (cf. Beverage, "Propagation ' +
  'Analysis for Profit", Radio World, June 2017) documents that M3 ' +
  'frequently over-states actual coverage in many regions — particularly ' +
  'in urban/suburban areas where manmade noise raises the listenable ' +
  'threshold above the 2 mV/m primary contour, and in regions where ' +
  'summer-vs-winter soil-moisture changes can shift effective σ by an ' +
  'order of magnitude (a station that is solidly listenable in January ' +
  'may be intermittent in May and unlistenable in August in the same ' +
  'reception area).  Drive-test measurement remains the only real ' +
  'coverage check.';
