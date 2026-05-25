// Executive Summary — plain-English overview at the very front of the
// exhibit, written for the GM / station owner / city planning department
// who isn't an RF engineer.  Real-world reference: Hatfield & Dawson
// Bellevue Mercer Slough Report (November 2002) page 1 — 4-paragraph
// summary covering the facility, what's at risk, cost / scope context,
// and the bottom-line recommendation, all readable cover-to-cover by
// a non-engineer.
//
// This is DIFFERENT from the Engineering Conclusion (which is the
// technical disposition at the back) and from the Purpose of Study
// (which is a one-liner stating WHY the exhibit was prepared).  The
// Executive Summary is the broader narrative bridge between the cover
// page and the technical body.
//
// Structure (matches Hatfield & Dawson):
//   ¶1  What the facility is (call, freq, class, community, mode)
//   ¶2  What this exhibit evaluates (the regulatory question + headline)
//   ¶3  What was found (verdict in plain English) + filing readiness
//   ¶4  Next steps / recommendations / where to look for detail
//
// Always renders.  Pulls from station_inputs, validation, regulatory_
// compliance, am_*_compliance, and filing_readiness — no schema change.

import { classifyAmDaMode } from '../../../engine/am/daModalClassification.js';
import { resolveCommunity, resolveClass } from './_identity.js';

export function buildExecutiveSummarySection(exhibit){
  const s   = exhibit?.station_inputs        || {};
  const v   = exhibit?.validation            || {};
  const rc  = exhibit?.regulatory_compliance || {};
  const cc  = exhibit?.engineering_conclusion || {};

  const svc       = String(s.service || '').toUpperCase();
  const isAm      = svc === 'AM' || svc === 'AX';
  const call      = s.call || '— (call sign not stated)';
  const facId     = s.facility_id || '— (facility ID not stated)';
  // Identity fields share resolveCommunity / resolveClass with cover.js
  // so the two sections never disagree (KAZM regression class).
  const community = resolveCommunity(exhibit);
  const communityText = community || '— (community-of-license not stated)';
  const freq      = Number.isFinite(Number(s.frequency)) ? Number(s.frequency) : null;
  const freqUnit  = s.frequency_unit || (isAm ? 'kHz' : 'MHz');
  const fccClass  = resolveClass(exhibit) || '—';
  const tpoOrErp  = Number.isFinite(Number(s.erp_kw)) ? Number(s.erp_kw) : null;
  const tpoLabel  = isAm ? 'TPO' : 'ERP';
  const intent    = s.study_intent || '—';
  const intentText = intent === 'existing_facility_review' ? 'a review of the existing licensed facility'
                  : intent === 'major_change'              ? 'a major-change application'
                  : intent === 'new_station'               ? 'a new-station construction permit'
                  : intent === 'minor_change'              ? 'a minor-change application'
                  : 'an FCC engineering analysis';

  // Modal notation (DA-D / DA-N / DA-2 / DA-3 / NDA-U) for AM.
  let modal = '';
  if (isAm){
    const m = classifyAmDaMode({ inputs: s });
    modal = m?.full_notation ? ` (${m.full_notation})` : '';
  }

  // ¶1 — facility identity
  const para1 = `${call} (Facility ID ${facId}) operates on ${freq != null ? `${freq} ${freqUnit}` : 'an unstated frequency'} from ${communityText}, ${isAm ? 'as a' : 'as an'} ${svc || 'broadcast'} ${fccClass !== '—' ? `Class ${fccClass} ` : ''}facility${isAm ? ' under 47 CFR Part 73 Subpart A' : ''}${tpoOrErp != null ? `, ${tpoOrErp} kW ${tpoLabel}` : ''}${modal}.  This engineering exhibit was prepared by Genoa FCC Propagation Studio to support ${intentText} for this facility.`;

  // ¶2 — what was evaluated
  const checks = [];
  if (isAm){
    checks.push('the §73.184 groundwave service contours (city / primary / secondary / night-intf)');
    checks.push('§73.182(k) / §73.190 nighttime skywave protection (RSS combination per §73.185) of every Class A / B / D station within 1500 km');
    if (exhibit?.am_blanket_compliance?.applicable)      checks.push('§73.24(g) blanketing-interference compliance');
    if (exhibit?.am_city_coverage_compliance?.applicable) checks.push('§73.24(j) principal-community coverage');
    if (exhibit?.am_da_pattern_compliance?.applicable)   checks.push('§73.150 directional-antenna pattern shape');
    if (exhibit?.international_border?.inside_treaty_zone) checks.push('US/Mexico and / or US/Canada AM treaty obligations');
  } else {
    checks.push('§73.333 F(50,50) and F(50,10) service / interferer contours');
    checks.push('§73.207 minimum-distance spacing and §73.215 contour-protection alternates');
    checks.push('§73.313 HAAT and §73.316 directional-antenna pattern application');
  }
  const para2 = `The exhibit evaluates ${checks.join('; ')}.  Methodology, curve dataset SHA-256, projection (WGS-84 Karney 2013), and per-radial spherical-vs-Karney validation are documented in the appendix evidence so the exhibit is replay-deterministic — the same inputs always produce the same numbers, with the same SHA-256 hashes.`;

  // ¶3 — verdict in plain English.  The 3-category surface lives on
  // the SECTION builder output, not on exhibit.validation directly,
  // so we have to derive equivalent text from the legacy fields here
  // OR from the conclusion section.  Order of preference:
  //   1. cc.status / cc.conclusion (Engineering Conclusion ran)
  //   2. exhibit.am_blanket_compliance / am_da_pattern / am_city_coverage
  //      (compliance summary)
  //   3. v.status (legacy single-headline)
  const concRaw = cc?.status || cc?.conclusion || null;
  const conclusion = concRaw ? String(concRaw).toUpperCase() : null;
  const legacyStatus = v?.status ? String(v.status).toUpperCase() : null;
  // §73.311 limits what predicted-contour outputs may be used for; the
  // executive-summary verdict is the line most likely to be quoted
  // standalone, so it must not overstate verification.  When the live
  // geo.fcc.gov parity check fell back to tier-3 code-identity
  // verification, the VERIFIED phrasing "meets the regulatory bar" can
  // be misread as a regulatory finding.  Qualify it to make the
  // tier-3 status explicit when fallback_tier > 1.
  const tier3Fallback = (exhibit?.validation?.fcc_curve_parity?.fallback_tier ?? 1) > 1;
  // Translate the legacy single status into a plain-English phrase.
  const niceVerdict = conclusion === 'COMPLIANT'      ? 'is compliant with the FCC rules under the proposed mode'
                   :  conclusion === 'NON-COMPLIANT'  ? 'does NOT comply with one or more FCC rules — see Engineering Conclusion for the specific blocker(s)'
                   :  conclusion === 'PARTIAL'        ? 'meets some but not all of the regulatory checks — see Engineering Conclusion for details'
                   :  legacyStatus === 'VERIFIED' && tier3Fallback
                     ? 'is computationally verified against the engine reference (FCC live cross-check not exercised — see Validation Verdict)'
                   :  legacyStatus === 'VERIFIED'     ? 'is computationally verified and meets the regulatory bar'
                   :  legacyStatus === 'PARTIAL'      ? 'is computationally verified but one or more regulatory checks are partial — see Validation Verdict'
                   :  legacyStatus === 'UNVERIFIED'   ? 'has computational gaps that the engineer of record must close before filing'
                   :  'is in review (see Validation Verdict and Engineering Conclusion for details)';
  // Specific blockers, surfaced regardless of conclusion fidelity.
  const blockerHints = [];
  if (exhibit?.am_blanket_compliance?.overall_pass === false)       blockerHints.push('§73.24(g) blanket-population fail');
  if (exhibit?.am_da_pattern_compliance?.overall_pass === false)    blockerHints.push('§73.150 DA-pattern shape fail');
  if (exhibit?.am_city_coverage_compliance?.overall_pass === false) blockerHints.push('§73.24(j) community-coverage fail');
  if (exhibit?.evidence?.am_night_nif?.summary?.n_failing_azimuths > 0) blockerHints.push('§73.182 nighttime NIF fail');
  const blockerText = blockerHints.length
    ? `  Specific findings flagged in this run: ${blockerHints.join('; ')}.`
    : '';
  const concText = conclusion ? `  The Engineering Conclusion reports the regulatory disposition as ${conclusion}.` : '';
  const para3 = `Overall the proposed exhibit ${niceVerdict}.${concText}${blockerText}  This Executive Summary is INFORMATIONAL — the actual filing decision rests with the qualified broadcast engineer of record reviewing the technical body.`;
  // Surface filingStatus from conclusion / blockers so recommendations
  // section below still works without categories.
  const filingStatus = conclusion === 'COMPLIANT' && blockerHints.length === 0 ? 'READY'
                     : conclusion === 'NON-COMPLIANT' || blockerHints.length ? 'DO NOT FILE'
                     : 'REVIEW';
  const extCategory  = (exhibit?.validation?.fcc_curve_parity?.fallback_tier > 1) ? 'TIER-3' : null;

  // ¶4 — recommendations / where to look
  const recs = [];
  if (filingStatus === 'REVIEW' || extCategory === 'TIER-3'){
    recs.push('Re-run the exhibit with the live geo.fcc.gov parity check before filing if a definitive external cross-verification is required (the current run used tier-3 code-identity verification).');
  }
  if (exhibit?.am_blanket_compliance?.overall_pass === false){
    recs.push('The §73.24(g) blanketing-interference population check FAILED — a §73.318(b) remediation plan and receiver-treatment commitment must accompany the application.');
  }
  if (exhibit?.am_city_coverage_compliance?.overall_pass === false){
    const pct = Number.isFinite(exhibit.am_city_coverage_compliance.coverage_pct)
      ? (exhibit.am_city_coverage_compliance.coverage_pct * 100).toFixed(1) + '%'
      : '—';
    recs.push(`§73.24(j) principal-community coverage is ${pct} of the city-of-license boundary — a substantial-compliance waiver showing or facility redesign is required before filing.`);
  }
  if (exhibit?.international_border?.inside_treaty_zone){
    const ts = exhibit.international_border.treaties?.map((t) => t.treaty).join(' + ');
    recs.push(`Site is inside the ${ts} treaty zone — verify co-channel / first-adjacent international stations are protected per the bilateral agreement.`);
  }
  if (recs.length === 0){
    recs.push('No further engineering work is required for this exhibit.  Engineer of record may review the body and Certification page, sign, and file.');
  }
  // Service-aware appendix list — AM nighttime-allocation + PSRA/PSSA
  // appendices only render for AM exhibits, so listing them in an FM
  // summary points the reviewer at sections that don't exist.
  const perRuleAppendices = isAm
    ? 'plus per-rule appendices for AM nighttime allocation (§73.182), PSRA/PSSA reduced power (§73.99), and the 8 km site survey'
    : 'plus the environmental RF evidence and 8 km site-survey appendices';
  recs.push(`Detail for every claim above lives in the body (Methodology, Validation Verdict, Engineering Conclusion) and in the appendices (Radial Data, Validation Evidence, Provenance, Replay Determinism, ${perRuleAppendices}).`);
  const para4 = recs.join('  ');

  return {
    id:      'executive-summary',
    type:    'paragraphs',
    heading: 'EXECUTIVE SUMMARY',
    paragraphs: [para1, para2, para3, para4]
  };
}
