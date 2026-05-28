// Regulatory-context classifier + readiness override tests.
//
// Per spec, four cases:
//   A. Licensed station with §73.215 failure
//   B. Same station as modification
//   C. Proposed facility with same failure
//   D. Clean licensed facility
//
// Plus a smoke test that the engineering report includes the new
// REGULATORY CONTEXT section and a smoke test that readiness applies
// the score caps + relabels.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyRegulatoryContext,
  REGULATORY_CONTEXT_DISCLAIMER
} from '../engine/regulatory/context.js';
import { readiness }              from '../types/readiness.js';
import { buildEngineeringReport } from '../exports/engineeringReport/index.js';

// --- A. Licensed station with §73.215 failure ---
test('A: licensed station with §73.215 failure → licensed_with_legacy_conflicts, medium risk', () => {
  const r = classifyRegulatoryContext(
    { facility_id: '73148', service: 'FM' },
    { fcc_lms: { status: 'LIC' } },
    {
      warnings: [{ code: 'FM_CONTOUR_PROTECTION_VIOLATION' }],
      interference_study: { filing_qualifies: false }
    }
  );
  assert.equal(r.facilityStatus,         'licensed');
  assert.equal(r.studyIntent,            'existing_facility_review');
  assert.equal(r.currentRuleCompliance,  'fails_current_rules');
  assert.equal(r.licenseInterpretation,  'licensed_with_legacy_conflicts');
  assert.equal(r.filingRisk,             'medium');
  assert.match(r.userFacingSummary, /Existing licensed facility/);
  assert.ok(r.warningsToDowngrade.includes('FM_CONTOUR_PROTECTION_VIOLATION'));
});

// --- B. Same station as modification scenario ---
test('B: licensed station as modification → modification, high risk, readiness cap 69', () => {
  const ctx = classifyRegulatoryContext(
    { facility_id: '73148', service: 'FM', modificationScenario: true },
    { fcc_lms: { status: 'LIC' } },
    { warnings: [{ code: 'FM_CONTOUR_PROTECTION_VIOLATION' }] }
  );
  assert.equal(ctx.studyIntent,           'modification');
  assert.equal(ctx.filingRisk,            'high');
  assert.equal(ctx.licenseInterpretation, 'licensed_with_legacy_conflicts');

  // readiness override: score capped at 69, status 'modification_high_risk'.
  const exhibit = {
    calculation_method: {}, interpolation: {}, contour_definitions: [],
    radial_table: [], polygons: [], method_versions: {}, software_versions: {},
    regulatoryContext: ctx
  };
  const r = readiness({ warnings: [{ code: 'FM_CONTOUR_PROTECTION_VIOLATION' }], exhibit });
  assert.equal(r.status, 'modification_high_risk');
  assert.ok(r.score <= 69, `score ${r.score} should be capped at 69`);
  assert.match(r.recommendations[0], /Modification may require contour protection redesign/);
});

// --- C. Proposed facility with same failure ---
test('C: proposed facility with §73.215 failure → new_filing, high risk', () => {
  const r = classifyRegulatoryContext(
    { isProposal: true, service: 'FM' },
    {},
    {
      warnings: [{ code: 'FM_MINIMUM_SEPARATION_VIOLATION' }],
      interference_study: { filing_qualifies: false }
    }
  );
  assert.equal(r.facilityStatus,         'proposed');
  assert.equal(r.studyIntent,            'new_filing');
  assert.equal(r.currentRuleCompliance,  'fails_current_rules');
  assert.equal(r.licenseInterpretation,  'requires_engineering_review');
  assert.equal(r.filingRisk,             'high');
  assert.match(r.userFacingSummary, /New or proposed filing/);
});

// --- D. Clean licensed facility ---
test('D: clean licensed facility → ordinary_compliant, low risk', () => {
  const r = classifyRegulatoryContext(
    { facility_id: '73148', service: 'FM' },
    { fcc_lms: { status: 'LIC' } },
    { warnings: [], interference_study: { filing_qualifies: true } }
  );
  assert.equal(r.facilityStatus,         'licensed');
  assert.equal(r.studyIntent,            'existing_facility_review');
  assert.equal(r.currentRuleCompliance,  'passes_current_rules');
  assert.equal(r.licenseInterpretation,  'ordinary_compliant');
  assert.equal(r.filingRisk,             'low');
});

// --- E. status read from license sub-object ---
test('E: licensed status read from fcc_lms.license.status', () => {
  const r = classifyRegulatoryContext(
    { facility_id: '73148' },
    { fcc_lms: { license: { status: 'LIC' } } },
    { warnings: [{ code: 'FM_CONTOUR_PROTECTION_VIOLATION' }] }
  );
  assert.equal(r.facilityStatus, 'licensed');
});

// --- F. Readiness override: licensed-legacy-review ---
test('F: licensed-with-legacy-conflicts caps readiness at 89 + status=licensed_legacy_review', () => {
  const ctx = classifyRegulatoryContext(
    { facility_id: '73148' },
    { fcc_lms: { status: 'LIC' } },
    { warnings: [{ code: 'FM_CONTOUR_PROTECTION_VIOLATION' }] }
  );
  const exhibit = {
    calculation_method: {}, interpolation: {}, contour_definitions: [],
    radial_table: [], polygons: [], method_versions: {}, software_versions: {},
    regulatoryContext: ctx
  };
  const r = readiness({ warnings: [{ code: 'FM_CONTOUR_PROTECTION_VIOLATION' }], exhibit });
  assert.ok(r.score <= 89, `score ${r.score} should be capped at 89`);
  assert.equal(r.status, 'licensed_legacy_review');
  assert.match(r.recommendations[0], /Licensed facility review/);
});

// --- G. Engineering report includes the new section ---
test('G: engineering report includes REGULATORY CONTEXT section when regulatoryContext is attached', () => {
  const exhibit = {
    station_inputs: { call: 'WJPZ', facility_id: '73148', service: 'FM' },
    method_versions: {},
    interpolation: {},
    calculation_method: {},
    contour_definitions: [],
    radial_table: [],
    polygons: [],
    software_versions: {},
    warnings: [{ code: 'FM_CONTOUR_PROTECTION_VIOLATION', severity: 'warning', phase: 'engine', title: 't', description: 'd' }],
    regulatoryContext: classifyRegulatoryContext(
      { facility_id: '73148', service: 'FM' },
      { fcc_lms: { status: 'LIC' } },
      { warnings: [{ code: 'FM_CONTOUR_PROTECTION_VIOLATION' }], interference_study: {} }
    )
  };
  const doc = buildEngineeringReport(exhibit);
  const ids = doc.sections.map(s => s.id);
  assert.ok(ids.includes('regulatory-context'), 'report should include regulatory-context section');
  // Must appear AFTER methodology and BEFORE conclusion.
  assert.ok(ids.indexOf('regulatory-context') > ids.indexOf('methodology'));
  assert.ok(ids.indexOf('regulatory-context') < ids.indexOf('conclusion'));
  // Section content carries the disclaimer.
  const reg = doc.sections.find(s => s.id === 'regulatory-context');
  assert.ok(reg.paragraphs.some(p => p.includes(REGULATORY_CONTEXT_DISCLAIMER.slice(0, 80))),
    'section should include the regulatory-context disclaimer');
});

// --- H. Engineering report omits section when classifier didn't run ---
test('H: engineering report omits REGULATORY CONTEXT section when regulatoryContext is missing', () => {
  const exhibit = {
    station_inputs: { call: 'WJPZ' },
    method_versions: {},
    interpolation: {},
    calculation_method: {},
    contour_definitions: [],
    radial_table: [],
    polygons: [],
    software_versions: {}
  };
  const doc = buildEngineeringReport(exhibit);
  const ids = doc.sections.map(s => s.id);
  assert.ok(!ids.includes('regulatory-context'),
    'report should NOT include regulatory-context section when classifier output is absent');
});
