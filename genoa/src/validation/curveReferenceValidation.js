// curve_reference_validation — internal pinned-dataset golden suite.
//
// PURPOSE
//   Prove that the deterministic engine + the pinned curve datasets +
//   the canonical FCC interpolation produce the values they must.
//   PASS clears CURVE_VALIDATION_MISSING.  This is the ONLY system
//   that touches that blocker.
//
//   The suite covers ALL three curve families used by the engine,
//   in both forward (ERP/HAAT/field → distance) and inverse
//   (distance → field) directions:
//
//     FM F(50,50)          — 47 CFR §73.333 service contour  (mode='50,50')
//     FM F(50,10)          — 47 CFR §73.333 interfering contour (mode='50,10' — used by §74.1204)
//     AM groundwave        — 47 CFR §73.183 / §73.184 (fccAmDistanceKm)
//     FM F(50,50) inverse  — fccFieldDbuAtDistance round-trip
//     FM F(50,10) inverse  — fccFieldDbuAtDistance round-trip
//     AM groundwave inverse— fccAmFieldMvmAtDistance round-trip
//
//   LPFM and FX share the FM curve datasets (LPFM is full-service
//   F(50,50); FX is F(50,50) + F(50,10) per §74.1204(a)+(c)) so passing
//   the FM cases also locks the LPFM / FX engine paths.
//
// NOT THIS LAYER
//   External FCC geo contour cross-check is a separate evidence
//   channel (see src/evidence/curveValidation/ztrFccContourValidator.js).
//   FCC mismatch emits FCC_GEO_CROSSCHECK_{FAILED,SKIPPED}, never
//   CURVE_VALIDATION_MISSING.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { fmContourDistance_km } from '../engine/fm/contour.js';
import {
  fccAmDistanceKm,
  fccFieldDbuAtDistance,
  fccAmFieldMvmAtDistance
} from '../engine/curves/fcc/index.mjs';
import { loadDataset, loadManifest } from '../engine/curves/loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _cache = null;
let _cachedAt = 0;
const TTL_MS = 5 * 60 * 1000;

export async function runCurveReferenceValidation({ fixturePath = null } = {}){
  const now = Date.now();
  if (_cache && (now - _cachedAt) < TTL_MS) return _cache;

  const file = fixturePath || path.resolve(__dirname, 'fixtures', 'fm-f5050-golden.json');
  const fixture = JSON.parse(await fs.readFile(file, 'utf8'));
  const manifest = await loadManifest();

  const tolerance_km  = Number(fixture.tolerance_km)  || 0.05;
  const tolerance_dBu = Number(fixture.tolerance_rationale?.field_dBu?.value) || 0.1;
  const tolerance_mvm = Number(fixture.tolerance_rationale?.field_mvm?.value) || 0.1;
  const datasetByName = name => loadDataset(name);

  const results = [];
  let n_run  = 0;
  let n_pass = 0;
  let max_err = 0;
  let sum_err = 0;

  // Per-family counters so the result stamp can show coverage breadth.
  const byFamily = {
    'FM F(50,50)':           { n_run: 0, n_pass: 0 },
    'FM F(50,10)':           { n_run: 0, n_pass: 0 },
    'AM groundwave':         { n_run: 0, n_pass: 0 },
    'FM F(50,50) inverse':   { n_run: 0, n_pass: 0 },
    'FM F(50,10) inverse':   { n_run: 0, n_pass: 0 },
    'AM groundwave inverse': { n_run: 0, n_pass: 0 }
  };

  for (const c of fixture.cases || []){
    let computed  = null;
    let family    = null;
    let target    = null;
    let unit      = null;
    let tol       = null;

    try {
      const isInverse = c.direction === 'distance_to_field';

      if (c.service === 'FM' && !isInverse){
        const mode = c.mode || '50,50';
        family = mode === '50,10' ? 'FM F(50,10)' : 'FM F(50,50)';
        target = c.target_dBu;
        unit   = 'dBu';
        tol    = tolerance_km;
        computed = await fmContourDistance_km({
          datasetByName,
          mode,
          target_dBu:    c.target_dBu,
          erp_kW:        c.erp_kw ?? c.erp_kW,
          haat_m:        c.haat_m,
          frequency_mhz: c.frequency_mhz ?? null,
          engine:        'fcc-canonical'
        });
        unit = 'km';

      } else if (c.service === 'FM' && isInverse){
        const mode = c.mode || '50,50';
        family = mode === '50,10' ? 'FM F(50,10) inverse' : 'FM F(50,50) inverse';
        target = c.expected_field_dBu;
        tol    = c.tolerance_dBu ?? tolerance_dBu;
        unit   = 'dBu';
        const r = fccFieldDbuAtDistance({
          haat_m:        c.haat_m,
          distance_km:   c.distance_km,
          erp_kw:        c.erp_kw ?? c.erp_kW,
          mode,
          frequency_mhz: c.frequency_mhz ?? null
        });
        computed = r.field_dBu;

      } else if (c.service === 'AM' && !isInverse){
        family = 'AM groundwave';
        target = c.target_mvm;
        unit   = 'mV/m';
        tol    = tolerance_km;
        const r = fccAmDistanceKm({
          frequency_khz:    c.frequency_khz,
          target_mvm:       c.target_mvm,
          conductivity_msm: c.conductivity_msm,
          dielectric:       c.dielectric,
          erp_kw:           c.erp_kw ?? c.erp_kW
        });
        computed = r.distance_km;
        unit = 'km';

      } else if (c.service === 'AM' && isInverse){
        family = 'AM groundwave inverse';
        target = c.expected_field_mvm;
        tol    = c.tolerance_mvm ?? tolerance_mvm;
        unit   = 'mV/m';
        computed = fccAmFieldMvmAtDistance({
          frequency_khz:    c.frequency_khz,
          distance_km:      c.distance_km,
          conductivity_msm: c.conductivity_msm,
          dielectric:       c.dielectric,
          erp_kw:           c.erp_kw ?? c.erp_kW
        });

      } else {
        results.push({ id: c.id, status: 'skipped', reason: `service ${c.service} direction=${c.direction || 'forward'} not handled` });
        continue;
      }

      // Normalise expected and compute error
      const expected = isInverse
        ? (c.service === 'AM' ? c.expected_field_mvm : c.expected_field_dBu)
        : c.expected_distance_km;
      const err  = Math.abs(computed - expected);
      const pass = err <= tol;

      n_run += 1;
      if (pass) n_pass += 1;
      if (!isInverse){
        // Track max/sum error only for distance direction (km) to keep units consistent
        max_err = Math.max(max_err, err);
        sum_err += err;
      }
      if (byFamily[family]){
        byFamily[family].n_run  += 1;
        if (pass) byFamily[family].n_pass += 1;
      }

      results.push({
        id:               c.id,
        label:            c.label,
        family,
        direction:        c.direction || 'field_to_distance',
        target,
        target_unit:      unit,
        expected:         expected,
        computed:         computed,
        error:            err,
        tolerance:        tol,
        status:           pass ? 'pass' : 'fail'
      });

    } catch (e){
      n_run += 1;
      results.push({ id: c.id, status: 'error', family, error: String(e.message) });
    }
  }

  const n_distance = results.filter(r => r.direction === 'field_to_distance' && r.status !== 'skipped').length;
  const pass = n_run > 0 && n_pass === n_run;

  const out = {
    name:             fixture.name || 'genoa-curve-golden',
    description:      fixture.description || null,
    method:           fixture.method || '47 CFR §73.333 + §73.183/§73.184',
    schema_version:   fixture.$schema || null,
    curve_dataset: {
      version:     fixture.curve_dataset?.version  || manifest.version,
      meta_sha256: fixture.curve_dataset?.meta_sha256 || manifest.meta_sha256
    },
    coverage_by_family: byFamily,
    fixture_path:     path.relative(process.cwd(), file),
    ran_at:           new Date().toISOString(),
    tolerance_km,
    tolerance_rationale: fixture.tolerance_rationale || null,
    lock_statement:   fixture.lock_statement || null,
    n_run, n_pass,
    max_error_km:     n_distance ? max_err : null,
    mean_error_km:    n_distance ? (sum_err / n_distance) : null,
    results,
    result:           n_run === 0 ? 'no_cases' : (pass ? 'pass' : 'fail'),
    pass
  };
  _cache = out;
  _cachedAt = now;
  return out;
}

// Test hook: forget the cached run so a follow-up call re-reads the
// fixture from disk.  Used by tests that want fresh runs back-to-back.
export function _resetCurveReferenceValidationCache(){
  _cache = null;
  _cachedAt = 0;
}
