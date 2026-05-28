// Engineering report — top-level builder.
//
// Returns a serializable document model:
//   { meta: {...}, sections: [ ... ] }
// Section objects are produced by the per-section builders under ./sections/.
// Renderers (renderText.js, renderPdf.js) walk the model.

import { buildCoverSection }              from './sections/cover.js';
import { buildPurposeSection }            from './sections/purpose.js';
import { buildFacilityParametersSection } from './sections/facilityParameters.js';
import { buildMethodologySection }        from './sections/methodology.js';
import { buildContourResultsSection }     from './sections/contourResults.js';
import { buildSpacingAnalysisSection }    from './sections/spacingAnalysis.js';
import { buildContourProtectionSection }  from './sections/contourProtection.js';
import { buildValidationVerdictSection }  from './sections/validationVerdict.js';
import { buildRfExposureSection }         from './sections/rfExposure.js';
import { buildTowerStudySection }         from './sections/towerStudy.js';
import { buildBuildAttestationSection }   from './sections/buildAttestation.js';
import { buildConclusionSection }         from './sections/conclusion.js';
import { buildCertificationSection }      from './sections/certification.js';
import { buildEngineerDeclarationSection } from './sections/engineerDeclaration.js';
import { buildExecutiveSummarySection }    from './sections/executiveSummary.js';
import { buildMwEducationalSections }      from './sections/mwEducational.js';
import { buildAppendixSections }          from './sections/appendices.js';
import { buildEngineeringConsiderationsSection } from './sections/engineeringConsiderations.js';
import { buildEngineeringInterpretationSection }  from './sections/engineeringInterpretation.js';
import { buildMeasurementsSection }                from './sections/measurements.js';
import { buildSdrObservabilitySection }            from './sections/sdrObservability.js';
import { buildRegulatoryContextSection }           from './sections/regulatoryContext.js';
import { buildItmCoverageSection }                 from './sections/itmCoverage.js';
import { buildMapPackageSection }                  from './sections/mapPackage.js';
import {
  buildNifPolarChartSection,
  buildFortranParityChartSection,
  buildDaPatternChartSection,
  buildItmCoverageOverlaySection,
  buildCanopyRosePolarSection,
  buildHaatPolarChartSection,
  buildContourPolarChartSection,
  buildNearbyStationsChartSection
}                                                  from './sections/vectorCharts.js';
import { buildVisualSummarySection }               from './sections/visualSummary.js';
import { buildAdvisoryReviewSection }              from './sections/advisoryReview.js';
import { buildRemediationSection }                from './sections/remediation.js';

export function buildEngineeringReport(exhibit, options){
  const opt = options || {};
  if (!exhibit || typeof exhibit !== 'object'){
    throw new Error('buildEngineeringReport: exhibit is required');
  }

  const sections = [];
  const push = (s) => { if (s) sections.push(s); };

  push(buildCoverSection(exhibit, opt));
  // Engineer Declaration (Mullaney KELP 1989-style sworn preamble).
  // Renders only when an engineer_of_record is attached; silently
  // omitted on un-attributed exhibits so the unsealed format stays clean.
  push(buildEngineerDeclarationSection(exhibit, opt));
  // Executive Summary (Hatfield & Dawson Mercer Slough 2002 style) —
  // plain-English overview that reads cover-to-cover for the GM /
  // station owner / city planner before the technical body.
  push(buildExecutiveSummarySection(exhibit, opt));
  push(buildPurposeSection(exhibit, opt));
  push(buildFacilityParametersSection(exhibit, opt));
  push(buildMethodologySection(exhibit, opt));
  // Plain-English educational sub-sections for AM exhibits — Mercer
  // Slough-style background reading for non-engineer consumers (city
  // planning, station owner, GM).  Returns [] for non-AM exhibits.
  // Sections: MW Radio Propagation, FCC 1939 Conductivity Table,
  // Blanketing Contours, Ground System, plus Maintenance Recommendations
  // when study_intent === 'existing_facility_review'.
  for (const sec of buildMwEducationalSections(exhibit, opt)) push(sec);
  // Regulatory-context section is conditional — only present when the
  // classifier ran (exhibit.regulatoryContext is populated).  Sits
  // between methodology and the engineering-considerations block so a
  // reader sees the licensing / current-rule disposition before the
  // technical interpretation.
  push(buildRegulatoryContextSection(exhibit, opt));
  push(buildEngineeringConsiderationsSection(exhibit, opt));
  push(buildEngineeringInterpretationSection(exhibit, opt));
  push(buildMeasurementsSection(exhibit, opt));
  // SDR observability — advisory per-capture surface that adds
  // observed-vs-predicted columns when a calibrated residual table is
  // attached, or an advisory notice when only audio captures exist.
  // Strictly observational; never modifies radial_table /
  // contour_definitions.  Sits right after Measurements so a reviewer
  // sees the raw audio record then the engineering comparison.
  push(buildSdrObservabilitySection(exhibit, opt));
  push(buildContourResultsSection(exhibit, opt));
  // Printable contour map — embedded PNG composed by the map sidecar
  // (genoa/src/sidecars/map/, headless Chromium + Leaflet).  The HTTP
  // entry points (api/routes/exhibits.js for stateless PDF,
  // api/services/jobRunner.js for async-job PDF) fetch the render
  // BEFORE calling buildEngineeringReport and pass it through
  // options.contour_map_png.  When no render is attached
  // (sidecar unconfigured / unreachable / timed out) the section
  // emits a deferred-to-engineer placeholder rather than silently
  // dropping — so the operator knows the page is missing AND why.
  // This sits right after the §73.333 contour-results table so the
  // map appears next to the numerical contours it visualizes.
  push(buildMapPackageSection(exhibit, opt));
  // Visual Summary — the showpiece page.  Composes contours +
  // population dot-density + tree-canopy halo + advisory banner into
  // one stylized vector composition that reads at a glance.  Sits
  // right after the H&D contour-map deliverable so a reviewer sees
  // the regulatory map first, then the synthesized visual that
  // overlays population and environmental context.  Skipped when
  // there are no contours or no tx coords.  Advisory only — no
  // filing-controlling math.
  push(buildVisualSummarySection(exhibit, opt));
  // Terrain-aware ITM coverage (47 CFR §73.314) — conditional, only
  // present when exhibit.itm_polygons[0] is a closed ring (the engine
  // ran ITM under options.use_itm=true).  Sits AFTER the §73.333
  // contour results and BEFORE the §73.207 / §73.215 protection
  // studies so the reader sees the free-space contour first, then the
  // evidentiary terrain analysis, then the regulatory compliance work.
  push(buildItmCoverageSection(exhibit, opt));
  push(buildSpacingAnalysisSection(exhibit, opt));
  push(buildContourProtectionSection(exhibit, opt));
  push(buildValidationVerdictSection(exhibit, opt));
  // RF Exposure (47 CFR §1.1307 / §1.1310 / OET Bulletin 65) — the
  // categorical-evaluation exhibit FCC requires for transmitters above
  // 1 kW ERP.  Self-deferring when exhibit.oet65 is absent (renders a
  // "deferred to engineer of record" note instead of silently dropping
  // the section).  Slotted after the regulatory verdict and before the
  // engineering conclusion so a reviewer sees the §73 contour analysis
  // followed by the §1.1310 exposure check, then the disposition.
  push(buildRfExposureSection(exhibit, opt));
  // Tower Study (47 CFR §17.4 + FAA OE/AAA + §17.21/§17.23) — the H&D-
  // style structural exhibit consolidating ASR registration, FAA
  // 7460-2 determination, and rules-derived marking/lighting
  // recommendation.  Self-deferring when upstream evidence is absent.
  push(buildTowerStudySection(exhibit, opt));
  push(buildConclusionSection(exhibit, opt));
  // Build attestation — engine SHA + fingerprint + HMAC signature so a
  // tampered build cannot pass through unnoticed and a PE-reviewed
  // exhibit is reproducible from the inputs + the SHA at attestation
  // time.  Renders only when exhibit.build_attestation is populated;
  // null otherwise.  Slotted immediately before the certification page
  // per the section's own header doc.
  push(buildBuildAttestationSection(exhibit, opt));
  push(buildCertificationSection(exhibit, opt));
  // Advisory "path to compliance" remediation — rendered only when an
  // export attached opt.remediation (the bounded ERP/HAAT sweep result),
  // which happens for NON-COMPLIANT spacing/contour exhibits.  Advisory;
  // omitted entirely otherwise.
  push(buildRemediationSection(exhibit, opt));
  // Advisory AI consistency review — rendered only when an export entry
  // point ran the advisory pass (src/analysis/exhibitReview.js) and
  // attached opt.advisory_review.  Sits AFTER the certification seal and
  // is explicitly marked ADVISORY so it is never read as part of the
  // certified determination.  Omitted entirely when no review is
  // attached (no MODEL_ACCESS_KEY), so default/offline renders are
  // unchanged.
  push(buildAdvisoryReviewSection(exhibit, opt));
  for (const ap of buildAppendixSections(exhibit, opt)) push(ap);
  // Vector charts — rendered pdfkit-native (no PNG, no sidecar) from
  // the same evidence already in exhibit.evidence.  Each chart is a
  // full-page deliverable and lands AFTER the textual appendices so
  // a reviewer reads "what we computed" before "here's the picture
  // of it."  Both builders return null when their upstream data
  // isn't present, so the chart pages only appear on exhibits that
  // actually ran the relevant computation.
  push(buildDaPatternChartSection(exhibit));       // AM/FM DA: filed pattern polygon
  push(buildItmCoverageOverlaySection(exhibit));   // §73.314: ITM coverage overlay
  push(buildFortranParityChartSection(exhibit));   // FM/LPFM/FX: FORTRAN parity scatter
  push(buildNifPolarChartSection(exhibit));        // AM: nighttime NIF polar contour
  push(buildContourPolarChartSection(exhibit));    // ALL: primary contour polar (real footprint shape)
  push(buildHaatPolarChartSection(exhibit));       // FM/FX/LPFM/TV: per-radial HAAT polar (terrain advantage)
  push(buildCanopyRosePolarSection(exhibit));      // ALL: 12-az tree canopy rose (env clutter, advisory)
  push(buildNearbyStationsChartSection(exhibit));  // ALL: protected stations bearing × distance scatter

  // Sequential figure numbering across all figure-eligible sections.
  // Figure-eligible types are the ones renderPdf.js renders with a
  // chart/image header that supports the `FIGURE N — ` prefix:
  // polar-chart, scatter-chart, polygon-overlay, image, visual-summary.
  // Stamping here (after the section list is composed) avoids each
  // section-builder needing to know its position in the final document,
  // which was the root cause of EVR-001 — only mapPackage.js carried
  // a hard-coded figure_number=1 and every other figure rendered
  // without a number.
  const FIGURE_TYPES = new Set([
    'polar-chart', 'scatter-chart', 'polygon-overlay', 'image', 'visual-summary'
  ]);
  let figureCounter = 0;
  for (const sec of sections){
    if (sec && FIGURE_TYPES.has(sec.type) && sec.figure_number == null){
      figureCounter += 1;
      sec.figure_number = figureCounter;
    }
  }

  const s   = exhibit.station_inputs || {};
  const mv  = exhibit.method_versions || {};
  const meta = {
    title:           'ENGINEERING STATEMENT',
    subtitle:        'FCC Propagation Study',
    station:         s.call || s.facility_id || 'Subject Facility',
    facility_id:     s.facility_id || null,
    service:         String(s.service || '').toUpperCase() || null,
    community:       s.community || s.city || null,
    generated_by:    'Genoa FCC Propagation Studio',
    engine_version:  mv.engine_version || mv.curve_engine || 'genoa',
    generated_at:    new Date().toISOString(),
    footer:          'Genoa FCC Propagation Studio'
  };

  return { meta, sections };
}
