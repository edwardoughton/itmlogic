#!/usr/bin/env node
// scripts/sample-exhibit.js
//
// Standalone smoke test: builds one complete genoa.exhibit.v2 exhibit
// using only the deterministic engine, runs the validation suite,
// renders the narrative, and writes JSON + TXT + GeoJSON to /tmp.
// No API, no DB, no sidecars, no UI, no AI.
//
// Usage:
//   node scripts/sample-exhibit.js                  # synthetic FM Class A
//   node scripts/sample-exhibit.js --station kslx   # KSLX-FM demo preset
//
// Exit code 0 on success.

import fs   from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compute }                    from '../src/engine/index.js';
import { runValidationSuite }         from '../src/engine/validation/runner.js';
import { runCurveReferenceValidation } from '../src/validation/curveReferenceValidation.js';
import { renderNarrative }            from '../src/narrative/generator.js';
import { exportJson }         from '../src/exports/json/exporter.js';
import { exportTxt }          from '../src/exports/txt/exporter.js';
import { exportGeoJson }      from '../src/exports/geojson/exporter.js';
import { validateExhibit, REQUIRED_BLOCKS } from '../src/types/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR   = process.env.GENOA_SAMPLE_OUT || '/tmp/genoa-sample';

async function loadDemoStation(name){
  const file = path.resolve(__dirname, '..', 'src/engine/validation/demoStations', `${name}_fm.json`);
  const raw  = await fs.readFile(file, 'utf8');
  return JSON.parse(raw);
}

async function buildSyntheticInputs(){
  return {
    inputs: {
      call:            'WBOB-FM',
      facility_id:     '12345',
      service:         'FM',
      fcc_class:       'A',
      frequency:       98.7,
      erp_kw:          6.0,
      haat_m:          100,
      lat:             37.0902,
      lon:            -95.7129,
      radial_step_deg: 10
    },
    label: 'synthetic FM Class A'
  };
}

async function buildKslxInputs(){
  const preset = await loadDemoStation('kslx');
  return {
    inputs: { ...preset.inputs },
    label:  preset.label,
    preset
  };
}

async function main(){
  const args = process.argv.slice(2);
  const stationIdx = args.indexOf('--station');
  const station = (stationIdx >= 0 && args[stationIdx + 1]) ? args[stationIdx + 1].toLowerCase() : null;

  await fs.mkdir(OUT_DIR, { recursive: true });

  // Run BOTH validation systems independently:
  //   curve_reference_validation (golden fixtures) — clears
  //                                                  CURVE_VALIDATION_MISSING
  //   legacy regression suite                      — engine drift detector
  const curveRefRun   = await runCurveReferenceValidation();
  const validationRun = await runValidationSuite();

  const built = station === 'kslx' ? await buildKslxInputs() : await buildSyntheticInputs();

  const exhibit = await compute({
    inputs: built.inputs,
    evidence: {},
    options: {
      operator:     'genoa-sample-script',
      organization: 'genoa-cli',
      validation:   {
        runs: [curveRefRun, validationRun],
        reference_cases_present: curveRefRun.pass || validationRun.reference_cases_present
      }
    }
  });

  exhibit.narrative = renderNarrative(exhibit);

  // Schema check.
  const v = validateExhibit(exhibit);
  if (!v.ok){ console.error('[sample] EXHIBIT FAILS SCHEMA:', v.missing); process.exit(2); }
  for (const k of REQUIRED_BLOCKS){
    if (exhibit[k] === undefined){ console.error('[sample] MISSING REQUIRED BLOCK:', k); process.exit(3); }
  }

  // Render exporters.
  exhibit.exports.json         = 'rendered';
  exhibit.exports.txt          = 'rendered';
  exhibit.exports.geojson      = 'rendered';
  exhibit.exports.generated_at = new Date().toISOString();

  const json    = exportJson(exhibit, { pretty: true });
  const txt     = exportTxt(exhibit);
  const geojson = exportGeoJson(exhibit, { pretty: true });

  const stem = (exhibit.station_inputs.call || 'sample').replace(/[^A-Z0-9]/gi, '_');
  await Promise.all([
    fs.writeFile(path.join(OUT_DIR, stem + '.exhibit.json'), json),
    fs.writeFile(path.join(OUT_DIR, stem + '.exhibit.txt'),  txt),
    fs.writeFile(path.join(OUT_DIR, stem + '.contours.geojson'), geojson)
  ]);

  const fr = exhibit.filing_readiness;
  console.log('=== GENOA SAMPLE EXHIBIT (' + built.label + ') ===');
  console.log('Station       :', exhibit.station_inputs.call, '(facility', exhibit.station_inputs.facility_id, ')');
  console.log('Service       :', exhibit.station_inputs.service, exhibit.station_inputs.fcc_class || '');
  console.log('Method        :', exhibit.calculation_method.name);
  console.log('Engine sig    :', exhibit.engine_signature.module, exhibit.engine_signature.version, exhibit.engine_signature.hash);
  console.log('Curve dataset :', exhibit.method_versions.curve_dataset.curve_version,
              'meta', (exhibit.method_versions.curve_dataset.meta_sha256 || '').slice(0, 12) + '…');
  console.log('Radials       :', exhibit.radial_table.length);
  console.log('Polygons      :', exhibit.polygons.length, '(GeoJSON features:', exhibit.geojson.features.length, ')');
  if (exhibit.geojson.features.length === 0){
    console.log('              : map/polygon unavailable — facility coordinates missing');
  }
  console.log('Validation    :', validationRun.n_run, 'auth_run /', validationRun.n_pass, 'auth_pass · regression', validationRun.n_regression_run + '/' + validationRun.n_regression_pass);
  console.log('Warnings      :', exhibit.warnings.length, '· blockers', exhibit.blockers.length);
  for (const w of exhibit.warnings){
    console.log('   -', w.severity.toUpperCase().padEnd(7), w.code);
  }
  console.log('Filing ready  :', fr.score + '/100  (' + fr.status + ')');
  console.log('Wrote         :', path.join(OUT_DIR, stem + '.exhibit.json'));
  console.log('              :', path.join(OUT_DIR, stem + '.exhibit.txt'));
  console.log('              :', path.join(OUT_DIR, stem + '.contours.geojson'));
}

main().catch(err => {
  console.error('[sample] failed:', err && err.stack || err);
  process.exit(1);
});
