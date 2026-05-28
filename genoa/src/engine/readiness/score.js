// Filing-readiness scoring — Phase-7 hardening.
//
// Replaces the simple PASS/REVIEW/FAIL flag with a weighted score
// over the entire exhibit so the engineer of record can see exactly
// what stops the package from being filing-grade and what would
// improve it.
//
// The score never overrides the rule math.  A §73.207 / §73.215
// failure is a §73.207 / §73.215 failure regardless of score.  But
// the score lets the UI / API tell the operator the difference
// between "one missing piece of evidence and you're done" vs "five
// hard blockers, do not file."
//
//   0-39   BLOCKED                       — hard blockers present
//   40-69  REVIEW                        — gaps but no blockers
//   70-89  FILING_CANDIDATE              — ready to hand to PE
//   90-100 ENGINEER_CERTIFICATION_READY  — PE-stamped + all parity
//                                          ladders cleanly passed
//
// HARD BLOCKERS (any one drops to BLOCKED regardless of remaining score):
//   - HAAT validation INVALID
//   - any warning with severity 'blocker' in exhibit.warnings
//   - missing required facility parameters (call, freq, service, lat/lon)
//   - rule-math failure for proposed/modification filing without
//     waiver / engineering-review path
//
// The breakdown returned ({ blockers, warnings, advisory, next_actions })
// is the same shape the /api/exhibits/:id/readiness endpoint emits.

const REQUIRED_INPUTS = ['call', 'frequency', 'service', 'lat', 'lon'];

// Weighted axes that contribute to the 0-100 score.  Each axis
// scores 0-N.  Total max = 100.  Axes are tuned so the typical
// post-Phase-1 KZLZ run lands in REVIEW until HAAT + live parity
// + measured-evidence are satisfied.
const AXES = Object.freeze({
  facility_inputs:     20,   // required station_inputs present
  haat_validation:     15,   // HAAT_VALIDATION_STATUS = PASS
  curve_validation:    15,   // golden-suite cases pass
  rule_compliance:     20,   // §73.207 + §73.215 + (AM: §73.182)
  live_fcc_parity:     10,   // tier-1 live geo.fcc.gov agrees
  independent_parity:   5,   // FORTRAN sidecar agrees
  map_render:           5,   // contour map PNG embeds successfully
  provenance:           5,   // engine SHA + curve dataset SHA + replay token
  pe_certification:     5    // exhibit.pe_certification.certified === true
});

export function computeReadinessScore(exhibit){
  const inputs   = exhibit?.station_inputs || {};
  const evidence = exhibit?.evidence || {};
  const haatV    = exhibit?.haat_validation || null;
  const blockersOut = [];
  const warningsOut = [];
  const advisoryOut = [];
  const nextActions = [];
  const breakdown   = {};

  // ── 1. Facility inputs ────────────────────────────────────────
  const missingInputs = REQUIRED_INPUTS.filter(k => {
    const v = inputs[k];
    return v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v));
  });
  breakdown.facility_inputs = missingInputs.length === 0 ? AXES.facility_inputs : 0;
  if (missingInputs.length){
    blockersOut.push({
      code:   'FACILITY_INPUTS_MISSING',
      detail: `Required station_inputs missing: ${missingInputs.join(', ')}`,
      remedy: 'Supply the missing field(s) in the operator workbench before re-running compute.'
    });
    nextActions.push(`Fill ${missingInputs.join(', ')} on the operator input panel.`);
  }

  // ── 2. HAAT validation ────────────────────────────────────────
  if (haatV?.status === 'PASS'){
    breakdown.haat_validation = AXES.haat_validation;
  } else if (haatV?.status === 'NOT_RUN'){
    breakdown.haat_validation = inputs.service === 'AM'
      ? AXES.haat_validation                    // AM doesn't use DEM-HAAT
      : Math.round(AXES.haat_validation * 0.4); // FM-without-terrain gets partial
    if (inputs.service !== 'AM'){
      warningsOut.push({
        code:   'HAAT_NOT_TERRAIN_DERIVED',
        detail: 'Per-radial HAAT was not computed from a terrain DEM (flat-earth or sidecar unavailable).  Caps readiness at REVIEW (req #2).',
        remedy: 'Run with use_terrain=true and terrain sidecar configured for the highest-confidence HAAT column.'
      });
    }
  } else if (haatV?.status === 'FALLBACK_ONLY'){
    breakdown.haat_validation = Math.round(AXES.haat_validation * 0.3);
    warningsOut.push({
      code:   'HAAT_FALLBACK_ONLY',
      detail: 'Per-radial HAAT bundle present but no terrain basis attached — column suppressed.  Caps readiness at REVIEW (req #2).',
      remedy: 'Supply inputs.overall_height_amsl_m or restore terrain DEM probe to upgrade to a real per-radial HAAT analysis.'
    });
  } else if (haatV?.status === 'SUSPECT'){
    breakdown.haat_validation = Math.round(AXES.haat_validation * 0.5);
    warningsOut.push({
      code:   'HAAT_SUSPECT',
      detail: `HAAT validation reports ${haatV.issues?.length || 0} outlier(s); engineer review recommended.`,
      remedy: 'Verify the per-radial outliers are real terrain effects (deep valleys) and not a compute bug.'
    });
  } else if (haatV?.status === 'INVALID'){
    breakdown.haat_validation = 0;
    blockersOut.push({
      code:   'HAAT_INVALID',
      detail: 'HAAT validation reports impossible per-radial values; the terrain compute is broken.',
      remedy: 'Re-run after supplying inputs.overall_height_amsl_m, or wait for the terrain DEM probe to succeed at the tx site.'
    });
    nextActions.push('Supply inputs.overall_height_amsl_m (antenna AMSL in metres) to fix HAAT compute.');
  } else {
    breakdown.haat_validation = 0;
  }

  // ── 3. Curve validation (golden suite) ────────────────────────
  const v = exhibit?.validation_context || exhibit?.validation || {};
  const cr = v.curve_reference_validation
          || (v.runs || []).find(r => r?.label?.includes?.('curve'))
          || null;
  const crPassed = cr && (cr.passed === true || cr.failed_cases === 0);
  if (crPassed){
    breakdown.curve_validation = AXES.curve_validation;
  } else if (cr){
    breakdown.curve_validation = 0;
    blockersOut.push({
      code:   'CURVE_VALIDATION_FAILED',
      detail: `Golden curve-suite reported ${cr.failed_cases ?? '?'} failed case(s).`,
      remedy: 'Inspect validation_context.curve_reference_validation; the curve engine output diverged from the reference.'
    });
  } else {
    breakdown.curve_validation = Math.round(AXES.curve_validation * 0.3);
    warningsOut.push({
      code:   'CURVE_VALIDATION_NOT_RUN',
      detail: 'Golden curve-suite did not run.',
      remedy: 'Run with validation=true (default in production).'
    });
  }

  // ── 4. Rule compliance ────────────────────────────────────────
  const compPass = exhibit?.regulatory_compliance?.compliance_pass
               || exhibit?.regulatoryContext?.current_rule_compliance;
  if (compPass === 'PASS' || compPass === 'PASS-via-73.215'){
    breakdown.rule_compliance = AXES.rule_compliance;
  } else if (compPass === 'fails_current_rules' || compPass === 'FAIL'){
    breakdown.rule_compliance = 0;
    // Existing licensed facility vs. proposed differs: existing
    // licensed stations may reflect grandfathering/waiver/historical
    // authorization, so this is REVIEW-level not BLOCKED.
    const isExisting = exhibit?.regulatoryContext?.facility_status === 'licensed'
                    || exhibit?.regulatoryContext?.study_intent === 'existing_facility_review';
    if (isExisting){
      warningsOut.push({
        code:   'CURRENT_RULE_CONFLICT_LICENSED',
        detail: 'Modeled §73.207/§73.215 conflict against current rules; licensed operation may reflect grandfathering, waiver, or historical FCC authorization.',
        remedy: 'Cross-check against the FCC record (LMS/CDBS) for the binding rule disposition; redesign only if a new CP / modification is proposed.'
      });
      nextActions.push('Confirm licensed status vs. current rules via LMS/CDBS lookup.');
    } else {
      blockersOut.push({
        code:   'RULE_FAILURE_PROPOSED',
        detail: 'Proposed/modification filing fails §73.207/§73.215 against current rules.',
        remedy: 'Redesign for rule compliance, prepare a §1.3 waiver, or request engineering review prior to filing.'
      });
      nextActions.push('Either redesign for §73.207/§73.215 compliance or prepare a waiver.');
    }
  } else {
    breakdown.rule_compliance = Math.round(AXES.rule_compliance * 0.5);
    advisoryOut.push({
      code:   'RULE_COMPLIANCE_UNKNOWN',
      detail: `Rule-compliance pass/fail is "${compPass || 'unset'}" — neither PASS nor FAIL.`,
      remedy: 'Inspect regulatory_compliance / regulatoryContext on the exhibit.'
    });
  }

  // ── 5. Live FCC parity ────────────────────────────────────────
  // We score Phase-2 today even though the live-fetch implementation
  // is a follow-up: tier-1 success awards full points; tier-2 / tier-3
  // fallback awards partial.  This makes the score honest about
  // "we have not been cross-checked against the live FCC engine."
  const par = evidence.fcc_parity_report || null;
  const parTier = par?.fallback_tier ?? par?.tier ?? null;
  if (parTier === 1 && par?.passed){
    breakdown.live_fcc_parity = AXES.live_fcc_parity;
  } else if (parTier === 1 && par?.passed === false){
    breakdown.live_fcc_parity = 0;
    blockersOut.push({
      code:   'LIVE_FCC_PARITY_FAIL',
      detail: 'Live geo.fcc.gov returned contour distances outside tolerance.',
      remedy: 'Compare evidence.fcc_parity_report.deltas; either the upstream API changed or our curve interpolation drifted.'
    });
  } else if (parTier === 2 || parTier === 3){
    breakdown.live_fcc_parity = Math.round(AXES.live_fcc_parity * 0.3);
    warningsOut.push({
      code:   'LIVE_FCC_PARITY_UNAVAILABLE',
      detail: `Live FCC parity unavailable (tier-${parTier} fallback used). Verification is code-identity only, not numerical cross-check.`,
      remedy: 'Re-run when geo.fcc.gov is reachable, or mark external parity waived in operator inputs.'
    });
    nextActions.push('Re-run with live geo.fcc.gov reachable for a true cross-check.');
  } else {
    breakdown.live_fcc_parity = 0;
    advisoryOut.push({
      code:   'LIVE_FCC_PARITY_NOT_ATTEMPTED',
      detail: 'No live-FCC parity attempt recorded on the exhibit.',
      remedy: 'Ensure the parity step ran during compute.'
    });
  }

  // ── 6. Independent engine parity (FORTRAN sidecar) ────────────
  const fortran = evidence.fortran_parity || evidence.fcc_fortran_parity || null;
  if (fortran?.available && fortran?.pass){
    breakdown.independent_parity = AXES.independent_parity;
  } else if (fortran?.available && fortran?.pass === false){
    breakdown.independent_parity = 0;
    warningsOut.push({
      code:   'INDEPENDENT_PARITY_FAIL',
      detail: 'FORTRAN sidecar returned contour distances outside tolerance vs. the JS engine.',
      remedy: 'Inspect evidence.fortran_parity for the per-radial delta table; either engine has a bug.'
    });
  } else {
    breakdown.independent_parity = 0;
    advisoryOut.push({
      code:   'INDEPENDENT_PARITY_NOT_CONFIGURED',
      detail: 'FORTRAN_FCC_SIDECAR_URL is unset; no independent-engine cross-check performed.',
      remedy: 'Configure FORTRAN_FCC_SIDECAR_URL on the deploy if a second-engine sanity check is desired.'
    });
  }

  // ── 7. Map render ─────────────────────────────────────────────
  // PDF render path attaches the map sidecar PNG to evidence (or
  // the exhibit-time pipeline does).  When the map_package section
  // builder later sees it, the PDF gets the figure; when missing,
  // the report shows a deferred-to-engineer placeholder.  Score
  // the result the renderer will see.
  if (evidence.map_render_attached === true){
    breakdown.map_render = AXES.map_render;
  } else if (evidence.map_render_attached === false){
    breakdown.map_render = 0;
    advisoryOut.push({
      code:   'MAP_RENDER_MISSING',
      detail: 'Map sidecar did not produce a contour-map PNG for this exhibit.',
      remedy: 'Set MAP_SIDECAR_URL on the deploy and confirm the sidecar is healthy.'
    });
  } else {
    // Not stamped at all — treat as advisory (most exhibits today).
    breakdown.map_render = Math.round(AXES.map_render * 0.5);
  }

  // ── 8. Provenance ─────────────────────────────────────────────
  const hasEngineSha   = !!(exhibit?.engine_signature?.hash || exhibit?.build_attestation?.sha);
  const hasCurveSha    = !!(exhibit?.method_versions?.curve_dataset_sha256
                         || exhibit?.evidence?.curve_dataset_sha256);
  const hasReplayToken = !!(exhibit?.replay_token || exhibit?.replay_digest?.exhibit_sha256);
  const provHits = [hasEngineSha, hasCurveSha, hasReplayToken].filter(Boolean).length;
  breakdown.provenance = Math.round(AXES.provenance * (provHits / 3));
  if (provHits < 3){
    advisoryOut.push({
      code:   'PROVENANCE_PARTIAL',
      detail: `Provenance bundle ${provHits}/3 complete (engine SHA, curve dataset SHA, replay token).`,
      remedy: 'Ensure exhibit.build_attestation / method_versions / replay_token are populated.'
    });
  }

  // ── 9. PE certification ───────────────────────────────────────
  if (exhibit?.pe_certification?.certified === true){
    breakdown.pe_certification = AXES.pe_certification;
  } else {
    breakdown.pe_certification = 0;
    if (blockersOut.length === 0){
      nextActions.push('Stamp the exhibit via POST /api/exhibits/certify once HAAT, parity, and rules are satisfied.');
    }
  }

  // ── Aggregate engine-level blockers from exhibit.warnings ────
  // The HAAT validator already pushes warnings into exhibit.warnings;
  // any other blocker-severity warning (CURVE_VALIDATION_MISSING,
  // FCC_METHOD_MISSING, …) should also drop readiness to BLOCKED.
  for (const w of exhibit?.blockers || []){
    // Don't double-count HAAT_IMPOSSIBLE / HAAT_MEAN_INCONSISTENT —
    // already represented above.
    if (w.code === 'HAAT_IMPOSSIBLE' || w.code === 'HAAT_MEAN_INCONSISTENT') continue;
    if (blockersOut.find(b => b.code === w.code)) continue;
    blockersOut.push({
      code:   w.code,
      detail: w.message || w.description || w.code,
      remedy: w.remedy || 'See validation_context for details.'
    });
  }

  // ── Final score + status ─────────────────────────────────────
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0);
  let status;
  if (blockersOut.length > 0){
    status = 'BLOCKED';
  } else if (score >= 90 && exhibit?.pe_certification?.certified === true){
    status = 'ENGINEER_CERTIFICATION_READY';
  } else if (score >= 70){
    status = 'FILING_CANDIDATE';
  } else {
    status = 'REVIEW';
  }

  // HAAT readiness cap (req #2): NOT_RUN / INVALID / FALLBACK_ONLY
  // never reach FILING_CANDIDATE or ENGINEER_CERTIFICATION_READY,
  // regardless of how many other axes scored.  AM exhibits are
  // exempted because §73.184 groundwave compute doesn't use a DEM
  // by design — for AM, NOT_RUN is correct, not a gap.
  const haatStatus = haatV?.status;
  const haatGates = inputs.service !== 'AM'
    && (haatStatus === 'NOT_RUN' || haatStatus === 'INVALID' || haatStatus === 'FALLBACK_ONLY');
  if (haatGates && (status === 'FILING_CANDIDATE' || status === 'ENGINEER_CERTIFICATION_READY')){
    status = 'REVIEW';
  }

  return {
    score,
    status,
    blockers:     blockersOut,
    warnings:     warningsOut,
    advisory:     advisoryOut,
    next_actions: nextActions,
    breakdown,
    axes:         AXES
  };
}
