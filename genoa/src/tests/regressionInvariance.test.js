// Regression invariance — FCC contour outputs MUST be byte-equal
// regardless of whether optional sidecars (terrain, geo-rf, measurement)
// are configured or "requested but unavailable".  This guards against
// silent drift where an evidence flag accidentally influences the
// engine's radial table or polygons.
//
// Sidecars are evidence inputs.  The FCC contour engine is a pure
// function of (station_inputs, dataset, curves).  Toggling an evidence
// flag — even when the sidecar is unreachable and the engine falls back
// to flat HAAT — MUST NOT change:
//   - contour_definitions
//   - radial_table contour distances
//   - polygons
//   - inputs_sha256 / evidence_sha256 (when evidence is the same shape)
//
// What MAY differ between the two runs:
//   - warnings  (extra advisory codes when terrain requested+unavailable)
//   - generated_at (timestamp)
//   - exhibit_sha256 (derives from generated_at)

import test from 'node:test';
import assert from 'node:assert/strict';
import { compute } from '../engine/index.js';
import { runValidationSuite } from '../engine/validation/runner.js';
import { FM_CLASS_A } from './_helpers.js';

async function computeWith(evidence){
  const vr = await runValidationSuite();
  return compute({
    inputs: FM_CLASS_A,
    evidence,
    options: {
      operator: 'test', organization: 'test',
      validation: { runs: [vr], reference_cases_present: vr.reference_cases_present }
    }
  });
}

test('FCC radial_table is identical with/without terrain sidecar flag', async () => {
  const noSidecars   = await computeWith({});
  const withSidecars = await computeWith({ terrain_haat_requested: true });
  assert.equal(
    JSON.stringify(noSidecars.radial_table),
    JSON.stringify(withSidecars.radial_table),
    'radial_table drifted when terrain_haat_requested flag flipped'
  );
});

test('FCC polygons are identical with/without terrain sidecar flag', async () => {
  const noSidecars   = await computeWith({});
  const withSidecars = await computeWith({ terrain_haat_requested: true });
  assert.equal(
    JSON.stringify(noSidecars.polygons),
    JSON.stringify(withSidecars.polygons),
    'polygons drifted when terrain_haat_requested flag flipped'
  );
});

test('contour_definitions are identical with/without terrain sidecar flag', async () => {
  const noSidecars   = await computeWith({});
  const withSidecars = await computeWith({ terrain_haat_requested: true });
  assert.equal(
    JSON.stringify(noSidecars.contour_definitions),
    JSON.stringify(withSidecars.contour_definitions)
  );
});

test('geojson contour features identical across sidecar toggle', async () => {
  const a = await computeWith({});
  const b = await computeWith({ terrain_haat_requested: true });
  assert.equal(JSON.stringify(a.geojson), JSON.stringify(b.geojson));
});

test('toggling sidecar flag does not change inputs_sha256', async () => {
  const a = await computeWith({});
  const b = await computeWith({ terrain_haat_requested: true });
  // inputs are identical, so inputs hash must be identical
  assert.equal(a.replay_digest.inputs_sha256, b.replay_digest.inputs_sha256);
});

test('engine_signature stable across sidecar toggle', async () => {
  const a = await computeWith({});
  const b = await computeWith({ terrain_haat_requested: true });
  assert.deepEqual(a.engine_signature, b.engine_signature);
});

test('sidecar toggle DOES add expected advisory warnings (not silent)', async () => {
  // It's important that the engine *announces* when an evidence sidecar
  // was requested-but-unavailable.  Otherwise a silent fallback masks
  // a deployment misconfiguration.
  const b = await computeWith({ terrain_haat_requested: true });
  const codes = (b.warnings || []).map(w => w.code);
  assert.ok(codes.includes('TERRAIN_NOT_APPLIED'),
    'expected TERRAIN_NOT_APPLIED when terrain requested but no data; got ' + codes.join(','));
  assert.ok(codes.includes('SIDECAR_UNAVAILABLE'),
    'expected SIDECAR_UNAVAILABLE warning; got ' + codes.join(','));
});
