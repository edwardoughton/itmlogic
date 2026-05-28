// Test helpers — build a fresh exhibit deterministically with the
// real engine + validation runner (no API, no DB).

import { compute } from '../engine/index.js';
import { runValidationSuite } from '../engine/validation/runner.js';
import { renderNarrative } from '../narrative/generator.js';

export async function buildExhibit(inputs, overrides = {}){
  const validationRun = await runValidationSuite();
  const exhibit = await compute({
    inputs,
    evidence: {},
    options: {
      operator: 'test', organization: 'test',
      validation: { runs: [validationRun], reference_cases_present: validationRun.reference_cases_present },
      ...overrides
    }
  });
  exhibit.narrative = renderNarrative(exhibit);
  return exhibit;
}

export const FM_CLASS_A = {
  call: 'WTEST-FM', facility_id: '99999',
  service: 'FM', fcc_class: 'A',
  frequency: 98.7, erp_kw: 6.0, haat_m: 100,
  lat: 37.0902, lon: -95.7129,
  radial_step_deg: 10
};

export const KSLX_NO_COORDS = {
  call: 'KSLX-FM', facility_id: '11282',
  service: 'FM', fcc_class: 'C',
  frequency: 100.7, erp_kw: 100, haat_m: 561,
  lat: null, lon: null,
  radial_step_deg: 10
};

export const AM_INCOMPLETE = {
  call: 'WAM-AM', facility_id: '8888',
  service: 'AM', frequency: 1240,
  erp_kw: 1.0,
  ground_sigma_mS_m: 8,
  lat: 37.0902, lon: -95.7129,
  radial_step_deg: 45
};
