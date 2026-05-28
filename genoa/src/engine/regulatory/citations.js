// Canonical FCC citation catalog.
//
// Every user-facing rule reference rendered by Genoa (in exhibits, PDF
// reports, LMS filing prose, warnings, and finding narratives) must
// originate from this module.  The goal is to eliminate the kind of
// "occurrence #N" citation drift the audit-remediation cycles have
// repeatedly surfaced — most notably the long-standing misattribution
// of §73.187 ("Limitation on daytime radiation") as the basis for AM
// nighttime skywave protection.
//
// Each entry binds:
//   rule       — the bare "§X.Y(z)" citation string (no leading "47 CFR")
//   caption    — the verbatim eCFR section caption as of 2026-05 (or the
//                widely-accepted short caption for subsections)
//   subject    — one-line plain-English summary of what the rule governs
//   verified_at — date of last eCFR / Cornell LII verification
//
// When the eCFR text changes, update this file and rerun
// citationHygiene.test.js.  Bulk-replace at the call sites is NEVER the
// answer — touch this catalog and the call sites will pick up the new
// wording automatically.

export const FCC_CITES = Object.freeze({
  // ── AM / Part 73 Subpart A ─────────────────────────────────
  AM_ALLOCATION_STANDARDS: Object.freeze({
    rule: '§73.182',
    caption: 'Engineering standards of allocation',
    subject: 'AM service-class definitions (Class A/B/C/D), protected/interfering field-strength contours (daytime + nighttime), RSS treatment of multiple interferers.',
    verified_at: '2026-05-23'
  }),
  AM_NIGHTTIME_NIF: Object.freeze({
    rule: '§73.182(k)',
    caption: 'Nighttime interference-free service (NIF) and RSS combination',
    subject: 'Nighttime root-sum-square (RSS) treatment of skywave interferers; the actual statutory basis for "AM nighttime protection" (NOT §73.187, which is the daytime-radiation rule).',
    verified_at: '2026-05-23'
  }),
  AM_DAYTIME_CLASS_A: Object.freeze({
    rule: '§73.182(a)',
    caption: 'Class A clear-channel daytime protection',
    subject: 'Daytime protection envelope for Class A clear-channel AM stations.',
    verified_at: '2026-05-23'
  }),
  AM_GROUNDWAVE_SIGNALS: Object.freeze({
    rule: '§73.183',
    caption: 'Groundwave signals',
    subject: 'Groundwave propagation definitions; how groundwave field strength is determined for AM allocation work.',
    verified_at: '2026-05-23'
  }),
  AM_GROUNDWAVE_GRAPHS: Object.freeze({
    rule: '§73.184',
    caption: 'Groundwave field strength graphs',
    subject: 'Figure M3 family of groundwave curves; the canonical method for predicting AM groundwave field strength.',
    verified_at: '2026-05-23'
  }),
  AM_INTERFERING_SIGNAL: Object.freeze({
    rule: '§73.185',
    caption: 'Computation of interfering signal',
    subject: 'Methodology for computing interfering signal contribution from each nearby station; the daytime/groundwave interference math (paired with §73.190 for nighttime skywave).',
    verified_at: '2026-05-23'
  }),
  AM_DAYTIME_RADIATION_LIMIT: Object.freeze({
    rule: '§73.187',
    caption: 'Limitation on daytime radiation',
    subject: 'Restrictions on Class B and Class D daytime radiation during critical hours (2 h after sunrise / 2 h before sunset) to protect co-channel Class A stations.  NOT a nighttime rule.',
    verified_at: '2026-05-23'
  }),
  AM_SKYWAVE_CHARTS: Object.freeze({
    rule: '§73.190',
    caption: 'Engineering charts and related formulas',
    subject: 'SS-1 (50%) and SS-2 (10%) skywave field-strength charts; the formal basis for AM nighttime skywave calculations.',
    verified_at: '2026-05-23'
  }),
  AM_SKYWAVE_RSS_INTEGRATION: Object.freeze({
    rule: '§73.190(c)',
    caption: 'Skywave RSS integration',
    subject: 'Specific subsection covering RSS skywave evaluation; used in directional-antenna nighttime studies alongside §73.182(k).',
    verified_at: '2026-05-23'
  }),
  AM_BLANKET_INTERFERENCE: Object.freeze({
    rule: '§73.24(g)',
    caption: 'Blanketing interference (AM)',
    subject: 'Receiver-complaint obligation when population within the 1000 mV/m blanket contour exceeds 1% of population within the 25 mV/m service contour.',
    verified_at: '2026-05-23'
  }),
  AM_CITY_COVERAGE: Object.freeze({
    rule: '§73.24(j)',
    caption: 'Principal community coverage (AM)',
    subject: 'AM 5 mV/m city-grade principal-community coverage requirement.',
    verified_at: '2026-05-23'
  }),

  // ── FM / Part 73 Subpart B ─────────────────────────────────
  FM_TABLE_OF_ALLOTMENTS: Object.freeze({
    rule: '§73.202',
    caption: 'Table of allotments (FM)',
    subject: 'FM allotment table for the commercial FM band.',
    verified_at: '2026-05-23'
  }),
  FM_MINIMUM_SEPARATION: Object.freeze({
    rule: '§73.207',
    caption: 'Minimum distance separations between stations',
    subject: 'Minimum mileage-spacing table; the default FM allocation gate.',
    verified_at: '2026-05-23'
  }),
  FM_CONTOUR_PROTECTION: Object.freeze({
    rule: '§73.215',
    caption: 'Contour protection for short-spaced assignments',
    subject: 'F(50,10) interfering contour vs F(50,50) protected contour with D/U thresholds; alternative to §73.207 mileage gate.',
    verified_at: '2026-05-23'
  }),
  FM_CLASSES: Object.freeze({
    rule: '§73.211',
    caption: 'Power and antenna height requirements (FM classes)',
    subject: 'Class A/B1/B/C0/C3/C2/C1/C maximum ERP / HAAT envelopes.',
    verified_at: '2026-05-23'
  }),
  FM_F5050: Object.freeze({
    rule: '§73.313',
    caption: 'Prediction of coverage (FM)',
    subject: 'F(50,50) and F(50,10) curve prediction method for FM coverage and interference contours.',
    verified_at: '2026-05-23'
  }),
  FM_PRINCIPAL_COMMUNITY: Object.freeze({
    rule: '§73.315',
    caption: 'FM transmitter location (principal-community coverage)',
    subject: '70 dBµV/m (3.16 mV/m) F(50,50) principal-community contour requirement.',
    verified_at: '2026-05-23'
  }),
  FM_NCE_COMMUNITY: Object.freeze({
    rule: '§73.515',
    caption: 'NCE FM principal-community coverage',
    subject: 'NCE reserved-band (channels 200-220) principal-community contour values.',
    verified_at: '2026-05-23'
  }),
  FM_RULES_OF_GENERAL_APPLICABILITY: Object.freeze({
    rule: '§73.333',
    caption: 'Engineering charts (FM)',
    subject: 'FM F(50,50) / F(50,10) reference charts used by the prediction method.',
    verified_at: '2026-05-23'
  }),

  // ── LPFM / Part 73 Subpart G ───────────────────────────────
  LPFM_MINIMUM_DISTANCE: Object.freeze({
    rule: '§73.807',
    caption: 'Minimum distance separations (LPFM)',
    subject: 'LPFM-specific spacing requirements.',
    verified_at: '2026-05-23'
  }),
  LPFM_PROTECTION: Object.freeze({
    rule: '§73.811',
    caption: 'LPFM power and antenna height limits',
    subject: 'LP100 / LP10 LPFM power/HAAT classes.',
    verified_at: '2026-05-23'
  }),

  // ── FM translators / Part 74 Subpart L ─────────────────────
  TRANSLATOR_INTERFERENCE: Object.freeze({
    rule: '§74.1204',
    caption: 'Protection of FM broadcast, FM translator and LP-FM stations',
    subject: 'FM-translator interference-protection rule.',
    verified_at: '2026-05-23'
  }),
  TRANSLATOR_PRIMARY_RELATIONSHIP: Object.freeze({
    rule: '§74.1201(g)',
    caption: 'Fill-in area (FM translator)',
    subject: 'Defines "fill-in" — translator 60 dBµV/m service contour must be located ENTIRELY WITHIN the primary station protected contour (60 dBu for commercial FM primary; 2 mV/m for AM primary per §74.1231(i); analogous NCE protected contour for NCE primary).  A translator whose contour merely overlaps but is not entirely within is non-fill-in under §74.1232.',
    verified_at: '2026-05-23'
  }),
  TRANSLATOR_AM_PRIMARY: Object.freeze({
    rule: '§74.1231(i)',
    caption: 'AM-primary translator eligibility',
    subject: 'AM-primary FM translator: 2 mV/m AM groundwave defines the analogous "protected" contour for fill-in eligibility.',
    verified_at: '2026-05-23'
  }),
  TRANSLATOR_ELIGIBILITY: Object.freeze({
    rule: '§74.1232',
    caption: 'Eligibility and licensing requirements (FM translators)',
    subject: 'Eligibility / coordination provisions for non-fill-in translators.',
    verified_at: '2026-05-23'
  }),

  // ── Towers, RF safety, PE certification ────────────────────
  RF_EXPOSURE_RULES: Object.freeze({
    rule: '§1.1307',
    caption: 'Actions which may have a significant environmental effect',
    subject: 'Regulatory hook for RF-exposure environmental review.',
    verified_at: '2026-05-23'
  }),
  RF_EXPOSURE_LIMITS: Object.freeze({
    rule: '§1.1310',
    caption: 'Radiofrequency radiation exposure limits',
    subject: 'MPE limits for general-public / occupational RF exposure.',
    verified_at: '2026-05-23'
  }),
  TOWER_REGISTRATION: Object.freeze({
    rule: '§17.4',
    caption: 'Antenna structure registration',
    subject: 'FAA/FCC tower-registration requirements.',
    verified_at: '2026-05-23'
  }),
  ENGINEERING_DATA_FILING: Object.freeze({
    rule: '§73.1610',
    caption: 'Equipment tests',
    subject: 'FCC authority to demand additional engineering data.',
    verified_at: '2026-05-23'
  }),
  APPLICATION_FILING_REQUIREMENTS: Object.freeze({
    rule: '§73.3539',
    caption: 'Application for renewal of license',
    subject: 'FCC filing requirements (engineering data and renewal applications).',
    verified_at: '2026-05-23'
  })
});

// Convenience helpers ----------------------------------------------

// AM nighttime skywave protection cite cluster — what most of the
// codebase historically labeled "§73.187" actually rests on.
export const AM_NIGHTTIME_BASIS = Object.freeze([
  FCC_CITES.AM_ALLOCATION_STANDARDS,    // §73.182 — classes + protected contours
  FCC_CITES.AM_NIGHTTIME_NIF,           // §73.182(k) — RSS / NIF
  FCC_CITES.AM_INTERFERING_SIGNAL,      // §73.185 — interfering signal math
  FCC_CITES.AM_SKYWAVE_CHARTS           // §73.190 — SS-1/SS-2 charts (Wang)
]);

// AM daytime allocation cite cluster — actual §73.187 lives here.
export const AM_DAYTIME_BASIS = Object.freeze([
  FCC_CITES.AM_ALLOCATION_STANDARDS,    // §73.182 — classes
  FCC_CITES.AM_GROUNDWAVE_SIGNALS,      // §73.183 — groundwave definitions
  FCC_CITES.AM_GROUNDWAVE_GRAPHS,       // §73.184 — Figure M3
  FCC_CITES.AM_INTERFERING_SIGNAL,      // §73.185 — interfering signal math
  FCC_CITES.AM_DAYTIME_RADIATION_LIMIT  // §73.187 — daytime-radiation limits
]);

// Render the rule list for an AM nighttime narrative ("§73.182(k) /
// §73.190 SS-1 study") — collapses the canonical basis into the form
// fcc-attorney + fcc-auditor accepted in PR-CITE2.
export function citeAmNighttimeShort(){
  return '§73.182(k) / §73.190';
}

// Render the rule list for an AM daytime narrative — paired with
// groundwave methodology.
export function citeAmDaytimeShort(){
  return '§73.182 / §73.184 / §73.187';
}

// AM compliance cite cluster as used by populationMethodology /
// validationVerdict / measurements / assumptions / executiveSummary
// when listing "AM compliance is field-strength-based, not population".
// Excludes §73.187 (daytime-radiation limit) which is not a base
// distance/field-strength rule, but includes the groundwave + nighttime
// methodology that actually drives the field-strength tests.
export function citeAmComplianceShortList(){
  return '§73.182 / §73.184 / §73.185 / §73.190';
}

// Convenience accessor — look up a single canonical citation by its
// rule key (e.g. citationFor('AM_NIGHTTIME_NIF') → '§73.182(k)').
export function citationFor(key){
  const entry = FCC_CITES[key];
  if (!entry) throw new Error(`unknown FCC citation key: ${key}`);
  return entry.rule;
}
