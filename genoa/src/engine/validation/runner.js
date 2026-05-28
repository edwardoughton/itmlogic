// Reference-case validation runner.
//
// Each reference case asserts a known FCC contour distance for a known
// (service, ERP, HAAT, target field) tuple, with a published tolerance.
// The runner executes every case against the deterministic engine and
// emits an aggregate report.  No "expected" value is fabricated; cases
// without a documented source are skipped and surfaced as
// REFERENCE_CASES_MISSING.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fmContourDistance_km } from '../fm/contour.js';
import { loadDataset, loadManifest } from '../curves/loader.js';
import { W } from '../../types/warnings.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CASES_DIR = path.join(__dirname, 'referenceCases');

async function loadCases(){
  const entries = await fs.readdir(CASES_DIR);
  const out = [];
  for (const f of entries){
    if (!f.endsWith('.json')) continue;
    const raw = await fs.readFile(path.join(CASES_DIR, f), 'utf8');
    const j = JSON.parse(raw);
    j._file = f;
    out.push(j);
  }
  return out;
}

export async function runValidationSuite(){
  const cases    = await loadCases();
  const manifest = await loadManifest();
  const datasetByName = name => loadDataset(name);

  const results  = [];
  const warnings = [];
  // Validation-scoring counters — AUTHORITATIVE CASES ONLY.
  let n_run   = 0;
  let n_pass  = 0;
  let max_err = 0;
  let sum_err = 0;
  // Regression-guard counters — non-authoritative ("smoke") cases.
  // These are reported separately and DO NOT contribute to validation
  // scoring or to the `pass` flag.
  let n_regression_run  = 0;
  let n_regression_pass = 0;

  if (!cases.length){
    return {
      ran_at: new Date().toISOString(),
      curve_version: manifest.version,
      n_cases: 0,
      n_run: 0,
      n_pass: 0,
      n_regression_run:  0,
      n_regression_pass: 0,
      max_error_km: null,
      mean_error_km: null,
      results: [],
      warnings: [
        W.make('REFERENCE_CASES_MISSING', 'No reference cases were found in src/engine/validation/referenceCases.'),
        W.make('CURVE_VALIDATION_MISSING', 'Cannot validate the active curve dataset without reference cases.')
      ],
      pass:                    false,
      authoritative_pass:      false,
      reference_cases_present: false
    };
  }

  for (const c of cases){
    if (typeof c.authoritative !== 'boolean' || !c.source_note){
      results.push({
        case: c.id || c._file,
        status: 'skipped',
        reason: 'incomplete reference data (require source_note + authoritative)'
      });
      continue;
    }
    if (c.service !== 'FM'){
      results.push({ case: c.id || c._file, status: 'skipped', reason: `service ${c.service} engine not validated yet`, authoritative: c.authoritative });
      continue;
    }
    if (!c.authoritative){
      warnings.push(W.make('REFERENCE_CASE_NOT_AUTHORITATIVE', `case ${c.id || c._file} is non-authoritative; runs as regression guard only.`));
    }

    // Build the list of (target_dBu, expected_distance_km, tolerance_km)
    // checks for this case.  Two accepted shapes:
    //   1) single-contour:  { target_dBu, expected_distance_km, tolerance_km }
    //   2) multi-contour:   { expected_contours: [ { target_dBu, expected_distance_km, tolerance_km }, ... ] }
    let checks = [];
    if (Array.isArray(c.expected_contours) && c.expected_contours.length){
      checks = c.expected_contours;
    } else if (Number.isFinite(c.expected_distance_km) && Number.isFinite(c.tolerance_km)){
      checks = [{ target_dBu: c.target_dBu, expected_distance_km: c.expected_distance_km, tolerance_km: c.tolerance_km }];
    }

    if (!checks.length){
      // No expected contours — case loaded but cannot pass/fail.  Still
      // exercise the engine so we record the actual computed distance(s)
      // for the documented frequency/ERP/HAAT (useful as future seed).
      warnings.push(W.make('REFERENCE_EXPECTED_CONTOURS_MISSING', `case ${c.id || c._file} has no expected_contours.`));
      let computed = null;
      try {
        computed = await fmContourDistance_km({
          datasetByName,
          mode:           c.mode || '50,50',
          target_dBu:     60,
          erp_kW:         c.erp_kw ?? c.erp_kW,
          haat_m:         c.haat_m,
          frequency_mhz:  c.frequency_mhz ?? null
        });
      } catch (_){}
      results.push({
        case:                   c.id || c._file,
        service:                c.service,
        erp_kw:                 c.erp_kw ?? c.erp_kW,
        haat_m:                 c.haat_m,
        authoritative:          c.authoritative,
        role:                   c.authoritative ? 'validation' : 'regression_guard',
        status:                 'no_expectation',
        computed_distance_km_at_60dBu: computed,
        source_note:            c.source_note
      });
      continue;
    }

    const checkResults = [];
    let case_pass = true;
    for (const chk of checks){
      try {
        const d = await fmContourDistance_km({
          datasetByName,
          mode:           c.mode || '50,50',
          target_dBu:     chk.target_dBu,
          erp_kW:         c.erp_kw ?? c.erp_kW,
          haat_m:         c.haat_m,
          frequency_mhz:  c.frequency_mhz ?? null
        });
        const err = Math.abs(d - chk.expected_distance_km);
        const pass = err <= chk.tolerance_km;
        if (!pass) case_pass = false;
        if (c.authoritative){
          max_err = Math.max(max_err, err);
          sum_err += err;
        }
        checkResults.push({
          target_dBu:           chk.target_dBu,
          expected_distance_km: chk.expected_distance_km,
          computed_distance_km: d,
          error_km:             err,
          tolerance_km:         chk.tolerance_km,
          status:               pass ? 'pass' : 'fail'
        });
      } catch (e){
        case_pass = false;
        checkResults.push({ status: 'error', error: String(e.message) });
      }
    }

    if (c.authoritative){
      n_run += 1;
      if (case_pass) n_pass += 1;
    } else {
      n_regression_run += 1;
      if (case_pass) n_regression_pass += 1;
    }
    results.push({
      case:                c.id || c._file,
      service:             c.service,
      erp_kw:              c.erp_kw ?? c.erp_kW,
      haat_m:              c.haat_m,
      authoritative:       c.authoritative,
      role:                c.authoritative ? 'validation' : 'regression_guard',
      status:              case_pass ? 'pass' : 'fail',
      checks:              checkResults,
      source_note:         c.source_note
    });
  }

  // Validation scoring is AUTHORITATIVE-ONLY.  Smoke / regression-guard
  // cases (authoritative: false) are reported separately and are NEVER
  // counted toward n_run / n_pass / pass / authoritative_pass.
  if (n_run === 0){
    warnings.push(W.make('REFERENCE_CASES_MISSING',
      'No authoritative reference cases (authoritative: true) were available to score validation. Regression-guard cases do not count toward validation.'));
    warnings.push(W.make('CURVE_VALIDATION_MISSING',
      'Curve dataset cannot be certified without an executable authoritative reference run.'));
  } else if (n_pass < n_run){
    warnings.push(W.make('CURVE_VALIDATION_MISSING',
      `Authoritative reference suite failed: ${n_run - n_pass} of ${n_run} cases out of tolerance.`));
  }

  const pass = n_run > 0 && n_pass === n_run;

  return {
    ran_at:                  new Date().toISOString(),
    curve_version:           manifest.version,
    n_cases:                 cases.length,
    // VALIDATION SCORING — authoritative cases only:
    n_run, n_pass,
    max_error_km:            n_run ? max_err : null,
    mean_error_km:           n_run ? (sum_err / n_run) : null,
    pass,
    authoritative_pass:      pass,
    // REGRESSION GUARDS — non-authoritative cases, NOT scored:
    n_regression_run, n_regression_pass,
    regression_pass:         n_regression_run === 0 || n_regression_pass === n_regression_run,
    // Combined result list (each row is tagged with `role`):
    results,
    warnings,
    reference_cases_present: n_run > 0
  };
}
