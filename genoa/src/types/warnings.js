// Structured warning codes.  Every warning emitted by Genoa MUST come
// from this enum.  Free-text only appears in the `detail` field; the
// `code` is what readiness scoring, exports, and the UI all switch on.
//
// Severity:
//   blocker   - filing readiness will fail; engineering review required
//   warning   - reduces readiness score, does not block
//   info      - reported but does not affect readiness
//
// Phase:
//   input | engine | evidence | sidecar | export | narrative

export const WARNING_CODES = Object.freeze({
  FACILITY_ID_MISSING:           { severity: 'warning', phase: 'input',
    title: 'Facility ID missing',
    description: 'No FCC facility ID was provided. Engineering review required to confirm the station identity.' },

  CURVE_VALIDATION_MISSING:      { severity: 'blocker', phase: 'engine',
    title: 'Curve validation missing',
    description: 'No reference validation cases have been run against the active curve dataset. Filing-grade exhibits require validation.' },

  CONSTANT_HAAT_ASSUMED:         { severity: 'warning', phase: 'engine',
    title: 'Constant HAAT assumed',
    description: 'The same HAAT was applied to every radial. §73.313 calls for arc-averaged per-radial HAAT; consider enabling the terrain sidecar.' },

  TERRAIN_NOT_APPLIED:           { severity: 'warning', phase: 'evidence',
    title: 'Terrain not applied',
    description: 'Per-radial terrain HAAT was requested but no terrain profile was applied. Falling back to the user-entered HAAT.' },

  SDR_MEASUREMENTS_MISSING:      { severity: 'info',    phase: 'evidence',
    title: 'SDR measurements missing',
    description: 'No SigMF measurement records are attached to this exhibit. Field measurements are evidence, not authority.' },

  SDR_MEASUREMENTS_NOT_CALIBRATED: { severity: 'warning', phase: 'evidence',
    title: 'SDR measurements not calibrated',
    description: 'Attached SigMF captures lack calibration metadata. Measured field strengths are reported as raw indications.' },

  POPULATION_PLACEHOLDER:        { severity: 'warning', phase: 'engine',
    title: 'Population estimate is a placeholder',
    description: 'Population is computed against a uniform density placeholder. A Census/ACS dispatch is required for filing.' },

  AM_ENGINE_NOT_IMPLEMENTED:     { severity: 'blocker', phase: 'engine',
    title: 'AM engine not implemented',
    description: 'AM groundwave §73.184 sigma-aware curve grid is not yet ingested; engine refused to interpolate.' },

  INTERPOLATION_UNDOCUMENTED:    { severity: 'blocker', phase: 'engine',
    title: 'Interpolation undocumented',
    description: 'The interpolation method used to read the FCC curve is not recorded. Filing-grade exhibits require documented interpolation.' },

  FCC_METHOD_MISSING:            { severity: 'blocker', phase: 'engine',
    title: 'FCC method missing',
    description: 'No deterministic FCC method is associated with this contour. Cannot file.' },

  REFERENCE_CASES_MISSING:       { severity: 'blocker', phase: 'engine',
    title: 'Reference validation cases missing',
    description: 'The reference validation suite has zero cases for this service. Cannot certify the engine.' },

  SIDECAR_UNAVAILABLE:           { severity: 'warning', phase: 'sidecar',
    title: 'Optional sidecar unavailable',
    description: 'An optional sidecar (terrain / measurement / identity) is not configured or did not respond.' },

  FACILITY_LOOKUP_UNAVAILABLE:   { severity: 'warning', phase: 'sidecar',
    title: 'Facility lookup unavailable',
    description: 'Read-only facility database (zerotrustradio) was not reachable. Facility metadata is not validated.' },

  RADIODNS_VALIDATION_UNAVAILABLE: { severity: 'warning', phase: 'sidecar',
    title: 'RadioDNS validation unavailable',
    description: 'RadioDNS resolver did not respond. Hybrid-radio identity is not confirmed.' },

  REFERENCE_CASE_NOT_AUTHORITATIVE: { severity: 'warning', phase: 'engine',
    title: 'Reference case is non-authoritative',
    description: 'A reference case used at validation time is marked authoritative=false. It may guard against engine regressions but cannot certify the curve dataset for filing.' },

  REFERENCE_EXPECTED_CONTOURS_MISSING: { severity: 'warning', phase: 'engine',
    title: 'Reference expected contours missing',
    description: 'A reference case carries no expected contour distances; the suite cannot run a numeric pass/fail for it.' },

  FACILITY_COORDINATES_MISSING:    { severity: 'blocker', phase: 'input',
    title: 'Facility coordinates missing',
    description: 'Transmitter latitude / longitude are missing. The engine can compute contour distances along radials but cannot project polygons or generate the GeoJSON map. Filing requires verified facility coordinates.' },

  // ---- FCC geo contour cross-check (external evidence; NOT a blocker) ----
  // The FCC's published contour from geo.fcc.gov uses terrain-aware
  // ITM under the hood; Genoa's free-space §73.333 F(50,50) lookup is
  // a different method.  A mismatch is engineering-meaningful but is
  // EVIDENCE, not a curve-validation failure.  These warnings replace
  // the previous habit of emitting CURVE_VALIDATION_MISSING when the
  // FCC cross-check disagreed.

  FCC_GEO_CROSSCHECK_FAILED:       { severity: 'warning', phase: 'evidence',
    title: 'FCC geo contour cross-check failed',
    description: 'Engine output deviates from the FCC published contour beyond the cross-check tolerance.  This is external evidence — the FCC contour is computed with a terrain-aware method (ITM) that the engine does not yet replicate.  Engineering review required; CURVE_VALIDATION_MISSING is unaffected.' },

  FCC_GEO_CROSSCHECK_SKIPPED:      { severity: 'warning', phase: 'evidence',
    title: 'FCC geo contour cross-check skipped',
    description: 'No usable _fcc_contour was returned by the upstream (geo.fcc.gov / ZTR proxy).  The cross-check did not run.  This does not affect curve validation status.' },

  // ---- Regulatory compliance (47 CFR §73.811 / §74.1204) ----
  // These warnings are emitted by the regulatory compliance modules
  // (src/engine/regulatory/) when an exhibit fails — or cannot complete
  // — its rule check.

  LPFM_RULE_VIOLATION: { severity: 'blocker', phase: 'engine',
    title: 'LPFM rule violation (47 CFR §73.811)',
    description: 'The exhibit fails one or more 47 CFR §73.811 LPFM rules (ERP ceiling, service-contour distance).  The exhibit is not filable as an LPFM application.' },

  TRANSLATOR_INTERFERENCE: { severity: 'blocker', phase: 'engine',
    title: 'FM translator interference (47 CFR §74.1204)',
    description: 'The translator fails one or more §74.1204 D/U interference gates against a nearby primary station.  Filing requires that all D/U ratios be satisfied.' },

  FM_CONTOUR_PROTECTION_VIOLATION: { severity: 'warning', phase: 'engine',
    title: 'FM short-spacing contour-protection — simplified study flagged a violation (47 CFR §73.215)',
    description: 'Genoa\'s simplified §73.215 study (single-bearing contour-edge methodology, see src/engine/regulatory/section_73_215.js header) detected D/U gate violations against one or more nearby full-service FM stations.  This is CONSERVATIVE relative to the FCC\'s actual polygon-vs-polygon contour-overlap test — a point-bearing failure can over-flag stations the licensed engineer\'s full polygon study would clear.  Required next step: licensed-engineer polygon-overlap review before filing-grade go/no-go.  Genoa surfaces the §73.215 study results on regulatory_compliance.studies for that review.' },

  FM_MINIMUM_SEPARATION_VIOLATION: { severity: 'warning', phase: 'engine',
    title: 'FM §73.207(b) minimum-distance separation not met',
    description: 'The proposed FM station fails the §73.207(b) Table A minimum-distance separation against one or more nearby full-service FM stations.  When §73.215 contour protection passes, this is informational — the filing can cite §73.215 instead.  When §73.215 also fails, the station does not qualify under either rule and the filing requires an alternative (e.g., a major-change application with reduced ERP / HAAT, or a directional antenna pattern).' },

  FM_TV_CH6_PROTECTION_VIOLATION: { severity: 'warning', phase: 'engine',
    title: 'FM reserved-band TV ch.6 protection — simplified study flagged a violation (47 CFR §73.525)',
    description: 'Genoa\'s simplified §73.525 study (single-bearing F(50,10)↔Grade B contour-edge methodology, same simplification as §73.215) detected a §73.525(b) D/U gate violation against one or more active TV channel 6 stations.  This is CONSERVATIVE relative to the FCC\'s actual polygon-vs-polygon overlap.  Required next step: licensed-engineer review with full polygon overlap before filing.  Most full-power ch.6 stations were repacked in the 2009 DTV transition; LPTV / Class A "Franken FM" residuals are the active concern.' },

  ASR_MISMATCH: { severity: 'warning', phase: 'evidence',
    title: 'ASR / application data mismatch (47 CFR §17.4)',
    description: 'The Antenna Structure Registration (ASR) record disagrees with the application\'s antenna data on one or more fields (coordinates, overall height AGL/AMSL).  Filing requires consistency between Form 302 / 301 and the ASR record on file with the FCC.  A minor mismatch may be a quantization artefact; a major mismatch indicates either the application or the ASR record needs to be corrected before filing.' },

  FAA_DETERMINATION_EXPIRED: { severity: 'warning', phase: 'evidence',
    title: 'FAA OE/AAA determination expired (FAA Order JO 7400.2 §6-3-3)',
    description: 'The FAA OE/AAA Form 7460-2 Determination of No Hazard (or conditional determination) for this antenna structure has passed its expiration date.  DNHs are valid for 18 months from the determination date; past that window, the proponent must re-file Form 7460-1 and obtain a fresh determination before filing the FCC application.  Either re-study or update the application to reflect the structure as it is currently authorized.' },

  TOWER_COMPLIANCE_GAP: { severity: 'warning', phase: 'evidence',
    title: 'Tower marking / lighting gap vs ASR record (47 CFR §17.21 / §17.23)',
    description: 'Genoa\'s rules-derived marking + lighting recommendation (per §17.21, §17.23, FAA AC 70/7460-1L) does not match the ASR record\'s actual lighting_requirement / painting_requirement.  An FAA-issued case-specific lighting letter typically explains a benign mismatch; absence of a lighting requirement on a structure where the rules require one indicates either a stale ASR record or a non-compliant structure.  The engineer-of-record must confirm the FAA letter is on file before filing.' },

  COMPUTE_TIMEOUT_PARTIAL: { severity: 'warning', phase: 'evidence',
    title: 'Compute completed with partial evidence (budget exceeded)',
    description: 'One or more network-bound evidence fetches were skipped because the per-request compute budget (COMPUTE_BUDGET_MS, default 4.5 minutes) was exhausted.  The exhibit numbers are still correct — the engine math is local and runs unconditionally — but the named evidence steps did not complete and their warnings (e.g. CONSTANT_HAAT_ASSUMED, MISSING_NEARBY_STATIONS) may be elevated as a result.  Re-run the compute when upstreams are responsive, or raise COMPUTE_BUDGET_MS / DigitalOcean App Platform http_request_timeout if the underlying source is consistently slow.' },

  NEC_MODEL_UNAVAILABLE: { severity: 'warning', phase: 'sidecar',
    title: 'NEC2++ antenna model unavailable',
    description: 'The Genoa NEC sidecar (NEC2++ / PyNEC, GPL v2 isolated) was not reachable, returned an error, or the PyNEC dependency is missing on the sidecar host.  Compute proceeded without the NEC evidence section.  When the sidecar is healthy, the exhibit gains directional pattern + feedpoint impedance + near-field RF exposure for §73.62 / §73.150 / §73.45 / OET-65 reviews.  Set NEC_SIDECAR_URL or check the sidecar /health endpoint.' },

  NEC_MODEL_INVALID_GEOMETRY: { severity: 'warning', phase: 'sidecar',
    title: 'NEC antenna model rejected (invalid geometry)',
    description: 'The supplied antenna geometry failed the sidecar\'s schema or sanity checks (zero-length wire, non-numeric field, segment-vs-radius proportions, unsupported ground type, missing excitation).  See evidence.nec_model.detail for the specific failure and correct the input.' },

  NEC_GROUND_MODEL_LIMITATION: { severity: 'warning', phase: 'sidecar',
    title: 'NEC ground model is PEC (perfect conductor)',
    description: 'The model used a perfect-electrical-conductor (PEC) ground assumption.  PEC overestimates ground efficiency for AM towers over real soil; use type=sommerfeld with conductivity_s_m + dielectric_constant for filing-grade analysis.  The §73.62 / §73.150 RTA the FCC accepts uses Sommerfeld real ground.' },

  NEC_NEAR_FIELD_APPROXIMATION: { severity: 'warning', phase: 'sidecar',
    title: 'NEC near-field uses MoM current distribution',
    description: 'NEC2++ near-field is computed at sample points using the assumed wire-current distribution from the MoM solve.  Accuracy degrades within roughly λ/8 of the conductors.  For OET-65 monitor-point analysis at AM frequencies, place sample points outside that radius or supply additional measured-current data.' },

  NEC_LICENSE_BOUNDARY_EXTERNAL: { severity: 'info', phase: 'sidecar',
    title: 'NEC evidence sourced from GPL-isolated external sidecar',
    description: 'NEC2++ is GPL v2.  This evidence was produced by an isolated sidecar process that Genoa talks to over HTTP only — Genoa\'s own codebase does not link or embed any GPL\'d code.  evidence.nec_model.provenance.license_boundary is stamped "external sidecar" so reviewers can verify the boundary is preserved.' },

  AM_GROUND_SIGMA_UNRESOLVED: { severity: 'blocker', phase: 'sidecar',
    title: 'AM ground conductivity could not be resolved from any source',
    description: 'Genoa refuses to compute AM groundwave / NEC results with a synthetic σ default.  The resolution chain (operator-supplied → ZTR /api/m3/conductivity proxy, which serves the vendored FCC §73.190 M3 polygon dataset) returned no usable value at the subject lat/lon.  Supply inputs.ground_sigma_mS_m explicitly (FCC §73.190 M3 zone value for the tower site) and recompute.  evidence.ground_conductivity.tier_attempts records each upstream failure for diagnosis.' },

  LMS_DATA_UNAVAILABLE: { severity: 'warning', phase: 'evidence',
    title: 'FCC LMS / public-file data unavailable',
    description: 'Genoa could not reach the FCC FMQ/AMQ database or publicfiles.fcc.gov for this station.  Filing-grade exhibits should cross-reference the FCC\'s authoritative record (license expiration, status, last action, public-file folder presence).  Re-run the compute when the upstream is responsive, or pull the data manually from https://transition.fcc.gov/fcc-bin/fmq and https://publicfiles.fcc.gov/.' },

  LICENSE_EXPIRING_SOON: { severity: 'warning', phase: 'evidence',
    title: 'FCC license expires soon',
    description: 'The FCC license for this station expires within the lookahead window (default 180 days; configurable via LICENSE_EXPIRING_SOON_DAYS).  License renewal under §73.1020 must be filed in the renewal window or the authorization may lapse.  See evidence.fcc_lms.license.license_expiration_date.' },

  LICENSE_EXPIRED: { severity: 'blocker', phase: 'evidence',
    title: 'FCC license has expired',
    description: 'The FCC license for this station expired before the compute date.  No new exhibit can be filed against an expired authorization; renewal under §73.1020 or a new application is required.  See evidence.fcc_lms.license.license_expiration_date.' },

  LMS_DATA_MISMATCH: { severity: 'warning', phase: 'evidence',
    title: 'FCC LMS record disagrees with application data',
    description: 'The FCC FMQ/AMQ row for this station carries values (ERP, HAAT, frequency, class, lat/lon) that do not match the application inputs.  Filing requires consistency between Form 302 / 301 and the FCC\'s authoritative record.  See evidence.fcc_lms.cross_check.mismatches for the specific field-level deltas.' },

  PUBLIC_FILE_INCOMPLETE: { severity: 'warning', phase: 'evidence',
    title: 'Public inspection file appears incomplete (47 CFR §73.3526 / §73.3527)',
    description: 'Genoa\'s probe of the licensee\'s publicfiles.fcc.gov folder did not find one or more of the §73.3526 / §73.3527 required sub-folders (EEO Public File Report, Issues and Programs Lists, Political File, Authorizations, Citizen Agreements, etc.).  Reviewers may flag the application during routine inspection.  See evidence.fcc_lms.public_file.required_folders.missing.' },

  FCC_PARITY_VERIFIED: { severity: 'info', phase: 'validation',
    title: 'Genoa output verified bit-exact against FCC distance.json',
    description: 'A live comparison between Genoa\'s computed contour distances and the FCC\'s public distance.json endpoint passed at every sampled (radial × contour) point within tolerance.  evidence.fcc_parity_report carries the per-sample table; reviewers can replay the FCC API calls themselves to verify.' },

  FCC_PARITY_DELTA: { severity: 'warning', phase: 'validation',
    title: 'Genoa contour distance differs from FCC distance.json',
    description: 'One or more sampled (radial × contour) points differ from the FCC\'s public distance.json endpoint output beyond tolerance.  This is unusual — Genoa\'s vendored engine is the same code that backs the FCC endpoint.  Likely causes: upstream rate-limit returning stale data, DNS / proxy intercepting the call, or an engine-version drift.  See evidence.fcc_parity_report.samples for the per-sample deltas.' },

  SDR_CALIBRATION_MISSING: { severity: 'warning', phase: 'evidence',
    title: 'SDR captures present but receiver calibration metadata absent',
    description: 'The SDR captures attached to this exhibit do not carry the receiver-calibration metadata required by §73.314 (FM) / §73.186 (AM) for filing-grade measurement evidence: antenna gain, cable loss, LNA gain, and the calibration date.  The captures still ship as provenance, but their measured field-strength values are uncalibrated and the predicted-vs-measured residual table reflects raw deltas only.  Add the calibration block to the ZTR rich-station response or to each capture record to lift this warning.' },

  SDR_RESIDUAL_LARGE: { severity: 'warning', phase: 'evidence',
    title: 'SDR predicted-vs-measured residual exceeds 10 dB',
    description: 'The RMS residual between Genoa\'s predicted field strength (FCC §73.333 / §73.184 curves) and the calibrated SDR-measured field exceeds 10 dB across the captured locations.  This typically indicates terrain shadowing or multipath that the simplified §73.333 model does not capture (use options.use_itm = true for terrain-aware coverage), or a calibration error in the receiver chain.  See evidence.measurements.residuals for the per-row table.' },

  AM_NIGHTTIME_PROTECTION_VIOLATION: { severity: 'warning', phase: 'engine',
    title: 'AM nighttime skywave — simplified §73.190 study flagged a violation (47 CFR §73.187)',
    description: 'Genoa\'s simplified §73.187/§73.190 SS-1 study (Wang formulation with geographic-lat midpoint approximation, see src/engine/curves/fcc/skywave.mjs header) detected a nighttime-skywave protection violation against one or more nearby AM stations.  This is CONSERVATIVE relative to a full IGRF geomagnetic-lat transform with directional-pattern RSS integration over the great-circle azimuth — required for filing-grade go/no-go.  Required next step: licensed-engineer §73.187(b)(1) RSS analysis before filing.  Genoa surfaces the §73.187 study results on regulatory_compliance.studies for that review.' },

  OET65_NEAR_FIELD_REQUIRED: { severity: 'warning', phase: 'engine',
    title: 'OET-65 near-field analysis required (47 CFR §1.1310)',
    description: 'The far-field §1.1310 compliance distance falls inside the near-field boundary λ/(2π) at this frequency.  The far-field power-density formula is not accurate inside that zone; OET-65 §3.B near-field analysis using the antenna current distribution is required for filing-grade compliance.  Common at AM frequencies where λ/(2π) reaches tens of meters.' },

  OET65_BOUNDARY_VIOLATION: { severity: 'blocker', phase: 'engine',
    title: 'OET-65 / §1.1310 site-boundary MPE violation',
    description: 'The §1.1310 power density at the site boundary exceeds the uncontrolled (general-population) MPE limit at the operating frequency.  Filing requires either restricting public access out to the OET-65 compliance distance, demonstrating pattern downtilt that reduces the field at ground-level public-access points, or a §1.1310(d) waiver.' },

  MISSING_NEARBY_STATIONS: { severity: 'warning', phase: 'evidence',
    title: 'Nearby-stations list missing',
    description: 'No list of nearby primary stations was attached to the exhibit, so the §74.1204 D/U interference study could not run.  Provide evidence.nearby_primaries to complete the translator analysis.' }
});

export class W {
  static make(code, detail = null, extras = null){
    if (!WARNING_CODES[code]) throw new Error(`unknown warning code: ${code}`);
    const meta = WARNING_CODES[code];
    return Object.freeze({
      code,
      severity:    meta.severity,
      phase:       meta.phase,
      title:       meta.title,
      description: meta.description,
      detail:      detail || null,
      ...(extras ? { extras } : {})
    });
  }
  static codes(){ return Object.keys(WARNING_CODES); }
  static dedupe(warnings){
    // Collapse to one warning per code.  When the same code appears
    // multiple times (e.g. the engine emits a detail-less default and
    // the API service emits a richer one), prefer the entry with a
    // non-empty `detail` so the UI shows the most informative copy.
    const byCode = new Map();
    for (const w of warnings){
      const prev = byCode.get(w.code);
      if (!prev){ byCode.set(w.code, w); continue; }
      if (!prev.detail && w.detail) byCode.set(w.code, w);
    }
    return [...byCode.values()];
  }
}
