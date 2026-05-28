// Per-station golden suite for the deterministic FCC core.
//
// SCOPE
//   Run compute() against a fixed set of station inputs spanning every
//   service (AM, FM, FX, LPFM) and assert that polygon mean radials
//   match the recorded `mean_radial_km` to within ±0.1 km.  Detects
//   silent drift in the vendored FCC routines (gwave.js, tvfm_curves.js)
//   or in the orchestration around them.
//
// Fixtures live in ./__golden__/*.json.  Updating a fixture is
// load-bearing — only after engineering review.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExhibit } from './_helpers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = path.join(__dirname, '__golden__');
const TOLERANCE_KM = 0.1;

async function listFixtures(){
  const entries = await fs.readdir(GOLDEN_DIR);
  return entries
    .filter(e => e.endsWith('.json'))
    .sort()
    .map(e => path.join(GOLDEN_DIR, e));
}

const fixtures = await listFixtures();

for (const fixturePath of fixtures){
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
  const name    = path.basename(fixturePath, '.json');

  test(`golden: ${name}`, async () => {
    const exhibit = await buildExhibit(fixture.station_inputs);
    assert.ok(Array.isArray(exhibit.polygons), 'exhibit.polygons must be an array');

    const byId = new Map(exhibit.polygons.map(p => [p.contour_id, p]));
    for (const exp of fixture.expected_polygons){
      const got = byId.get(exp.contour_id);
      assert.ok(got, `missing polygon ${exp.contour_id} in produced exhibit`);
      if (exp.mean_radial_km === null){
        assert.equal(got.mean_radial_km, null,
          `contour ${exp.contour_id} expected null mean_radial_km, got ${got.mean_radial_km}`);
        continue;
      }
      assert.ok(Number.isFinite(got.mean_radial_km),
        `contour ${exp.contour_id} produced non-finite mean_radial_km ${got.mean_radial_km}`);
      const drift = Math.abs(got.mean_radial_km - exp.mean_radial_km);
      assert.ok(drift <= TOLERANCE_KM,
        `contour ${exp.contour_id} mean_radial_km drift ${drift.toFixed(4)} km > tolerance ${TOLERANCE_KM} km (expected ${exp.mean_radial_km}, got ${got.mean_radial_km})`);
    }

    // AM golden fixtures with `expected_sigma_clamp` MUST surface the
    // clamp on evidence.ground_constants AND fire SIGMA_CLAMP warning.
    if (fixture.expected_sigma_clamp){
      const gc = exhibit.evidence?.ground_constants;
      assert.ok(gc, 'evidence.ground_constants must be populated for AM service');
      assert.equal(gc.sigma_clamp, fixture.expected_sigma_clamp,
        `expected sigma_clamp=${fixture.expected_sigma_clamp}, got ${gc.sigma_clamp}`);
      const hasSigmaClampWarn = (exhibit.warnings || []).some(w => w.code === 'SIGMA_CLAMP');
      assert.ok(hasSigmaClampWarn,
        'SIGMA_CLAMP warning required when AM σ clamps to FCC M3 boundary');
    }
  });
}

// Meta-test: ensure the suite has fixtures across all four services so a
// future contributor can't accidentally delete coverage.
test('golden: covers all four broadcast services', async () => {
  const services = new Set();
  for (const fixturePath of fixtures){
    const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
    services.add(String(fixture.station_inputs.service || '').toUpperCase());
  }
  for (const required of ['AM', 'FM', 'FX', 'LPFM']){
    assert.ok(services.has(required), `golden suite missing service: ${required}`);
  }
});

// Curve-dataset SHA must be folded into build_attestation.  Same inputs,
// different curve dataset, must produce different curve_dataset_fingerprint.
test('golden: AM exhibits stamp the AM curve_dataset (gwave SHAs)', async () => {
  const amFixture = JSON.parse(await fs.readFile(
    path.join(GOLDEN_DIR, 'kazm_am_780.json'), 'utf8'));
  const ex = await buildExhibit(amFixture.station_inputs);
  const cd = ex.method_versions?.curve_dataset;
  assert.ok(cd, 'method_versions.curve_dataset required');
  assert.ok(cd.dataset_sha256, 'curve_dataset.dataset_sha256 required');
  // Must contain the gwave.js + gwave_field.json SHAs, NOT FM f5050/f5010.
  const hasGwave = Object.keys(cd.dataset_sha256).some(k => /gwave/i.test(k));
  assert.ok(hasGwave, 'AM curve_dataset.dataset_sha256 must include gwave SHAs');
  assert.ok(!('f5050' in cd.dataset_sha256),
    'AM exhibit must NOT inherit FM f5050 SHA');

  // Curve-dataset fingerprint is composed.
  const ba = ex.build_attestation;
  assert.ok(ba, 'build_attestation required');
  assert.ok(typeof ba.curve_dataset_fingerprint_sha256 === 'string',
    'build_attestation.curve_dataset_fingerprint_sha256 required');
  assert.ok(/^[0-9a-f]{64}$/.test(ba.curve_dataset_fingerprint_sha256),
    'curve_dataset_fingerprint_sha256 must be 64-char hex sha256');
  assert.ok(ba.curve_dataset_fingerprint_sha256 !== ba.fingerprint_sha256,
    'composed fingerprint must differ from base fingerprint');
});
