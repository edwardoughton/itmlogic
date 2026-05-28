// CI release-gate tests (req #8).
//
// These run a sample of exhibits end-to-end through the report
// pipeline and assert that the produced PDF / TXT never carries:
//
//   (a) a per-radial HAAT value below -250 m
//   (b) the literal phrase "No issues detected" while exhibit.blockers
//       is non-empty
//
// These checks would FAIL a release build that regresses the
// "NOT_RUN with garbage values" contradiction we're fixing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEngineeringReport } from '../exports/engineeringReport/index.js';
import { renderEngineeringReportText } from '../exports/engineeringReport/renderText.js';

const HAAT_FLOOR_M = -250;

function kzlzPreFixExhibit(){
  // The PRE-FIX KZLZ pattern: operator HAAT 581 m, radial_table
  // carries -141 to -275 m garbage, no terrain basis.  Under the
  // new code this MUST be suppressed before rendering.
  return {
    station_inputs: {
      call: 'KZLZ', service: 'FM', frequency: 105.3,
      lat: 32.25, lon: -111.12, haat_m: 581, erp_kw: 0.58, fcc_class: 'C3'
    },
    radial_table: Array.from({ length: 36 }, (_, i) => ({
      azimuth_deg: i * 10,
      relative_field: 1.0,
      haat_input_m: 581,
      haat_computed_m: -150 - (Math.random() * 130),    // [-280, -150]
      contour_distances_km: { service_60dbu: 8.85, city_54dbu: 12.42, protected_40dbu: 27.4 }
    })),
    contour_definitions: [
      { id: 'service_60dbu', label: '60 dBu (1 mV/m service)' },
      { id: 'city_54dbu',    label: '54 dBu (city grade)' },
      { id: 'protected_40dbu', label: '40 dBu (protected)' }
    ],
    interference_study: null,
    population_estimate: { primary: null, informational_only: true },
    method_versions: {},
    evidence: {},                                          // no terrain basis
    engine_signature: {},
    warnings: [], blockers: [],
    // The HAAT validator output that exhibitService.js would have
    // produced for this state (INVALID, display_suppressed=true).
    haat_validation: {
      status: 'INVALID', basis: 'flat',
      issues: [{ code: 'HAAT_SUPPRESSED_NO_TERRAIN_BASIS', severity: 'BLOCKER',
                 detail: 'No terrain basis attached' }],
      stats: { operator_m: 581, mean_m: -215, delta_mean_vs_operator_m: -796,
               n_radials: 36, n_negative: 36, n_implausible: 18 },
      display_suppressed: true,
      gates_readiness: true,
      terrain_limited: true
    },
    terrain_limited: true
  };
}

// Helper: scan rendered text for any "<number> m" pattern in HAAT
// columns and return the smallest numeric HAAT found.  Returns
// +Infinity if none found.
function smallestHaatInText(txt){
  // Match Appendix A's "haat_m" column heuristically: lines that
  // look like "   <az>   <haat>   <erp>   ...".  We're cautious
  // and only consider numeric values that follow the azimuth
  // pattern xxx.x at the start of a tabular row.
  let smallest = Infinity;
  for (const line of txt.split('\n')){
    // Tabular row: leading whitespace, az like "150.0", then a
    // HAAT cell that's a signed decimal OR the literal UNAVAILABLE.
    const m = line.match(/^\s+(\d{1,3}\.\d)\s+(-?\d+(?:\.\d+)?|UNAVAILABLE)/);
    if (!m) continue;
    if (m[2] === 'UNAVAILABLE') continue;
    const v = parseFloat(m[2]);
    if (Number.isFinite(v) && v < smallest) smallest = v;
  }
  return smallest;
}

test(`CI gate: rendered exhibit must not emit per-radial HAAT below ${HAAT_FLOOR_M} m`, () => {
  const doc = buildEngineeringReport(kzlzPreFixExhibit(), {});
  const txt = renderEngineeringReportText(doc);
  // Under the always-include-HAAT policy: when display_suppressed
  // is true, every HAAT cell should fall back to the operator value
  // (581 m for KZLZ), not the garbage -141..-275 values from the
  // failed terrain compute.  The floor check below is the gate
  // regardless of suppression mechanism — no rendered HAAT may be
  // below -250 m without an explicit override flag.
  const smallest = smallestHaatInText(txt);
  assert.ok(smallest > HAAT_FLOOR_M,
    `Rendered Appendix A contained per-radial HAAT ${smallest} m (below ${HAAT_FLOOR_M} m floor).  ` +
    `When haat_validation.display_suppressed === true, appendices.js must fall back to operator HAAT ` +
    `(haat_input_m / station_inputs.haat_m), not the garbage values in radial_table[i].haat_computed_m.`);
});

test('CI gate: rendered exhibit must not say "No issues detected" while blockers exist', () => {
  // Synthesize a state where validator emits "no issues detected"
  // language while blockers are populated.  The contradiction guard
  // in exhibitService.js promotes this to a HAAT_CONTRADICTION
  // blocker BEFORE render — but if the guard regresses, this test
  // catches the resulting text.
  const ex = kzlzPreFixExhibit();
  ex.haat_validation = {
    status: 'PASS', basis: 'terrain_derived', issues: [],   // <-- no issues
    stats: { operator_m: 581, mean_m: 580, delta_mean_vs_operator_m: -1 },
    display_suppressed: false, gates_readiness: false
  };
  ex.blockers = [
    { code: 'CURVE_VALIDATION_MISSING', severity: 'blocker', message: 'x' }
  ];
  const doc = buildEngineeringReport(ex, {});
  const txt = renderEngineeringReportText(doc);
  // Find the Appendix A footnote.  When haat_validation.issues is
  // empty AND the status is PASS, the renderer's previous text
  // would have said "No issues detected." next to a populated
  // blockers section.  We assert that text doesn't appear when
  // exhibit.blockers > 0.
  if (txt.includes('No issues detected') && ex.blockers.length > 0){
    assert.fail(
      `Rendered exhibit contained "No issues detected" while ${ex.blockers.length} blocker(s) ` +
      `are present.  Contradiction guard in exhibitService.js failed to promote this to ` +
      `HAAT_CONTRADICTION before render.`);
  }
});
