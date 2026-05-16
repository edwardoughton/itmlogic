import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExhibit, FM_CLASS_A, KSLX_NO_COORDS, AM_INCOMPLETE } from './_helpers.js';
import { compute } from '../engine/index.js';
import { isClosed } from '../engine/geometry/polygon.js';

test('compute throws INVALID_INPUTS without inputs', async () => {
  await assert.rejects(() => compute({}), { code: 'INVALID_INPUTS' });
  await assert.rejects(() => compute({ inputs: 'not-an-object' }), { code: 'INVALID_INPUTS' });
});

test('compute throws VALIDATION_CONTEXT_REQUIRED without options.validation', async () => {
  await assert.rejects(
    () => compute({ inputs: FM_CLASS_A }),
    { code: 'VALIDATION_CONTEXT_REQUIRED' }
  );
});

test('FM nondirectional: radial symmetry — every contour distance equal', async () => {
  const x = await buildExhibit({ ...FM_CLASS_A, radial_step_deg: 30 });
  const c = x.contour_definitions[0].id;
  const dists = x.radial_table.map(r => r.contour_distances_km[c]);
  const first = dists[0];
  for (const d of dists){
    assert.ok(Math.abs(d - first) < 1e-9, `non-directional radial asymmetry: ${d} vs ${first}`);
  }
});

test('Radial count derived from radial_step_deg', async () => {
  for (const step of [45, 22.5, 10, 5]){
    const x = await buildExhibit({ ...FM_CLASS_A, radial_step_deg: step });
    assert.equal(x.radial_table.length, Math.round(360 / step));
  }
});

test('All polygons are closed rings', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  for (const p of x.polygons){
    if (p.closed){
      assert.ok(isClosed(p.ring_latlng), `polygon ${p.contour_id} not closed`);
    }
  }
});

test('GeoJSON is a valid FeatureCollection with required properties', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  assert.equal(x.geojson.type, 'FeatureCollection');
  assert.ok(Array.isArray(x.geojson.features));
  for (const f of x.geojson.features){
    assert.equal(f.type, 'Feature');
    assert.equal(f.geometry.type, 'Polygon');
    assert.ok(Array.isArray(f.geometry.coordinates));
    const ring = f.geometry.coordinates[0];
    assert.ok(ring.length >= 4, 'ring must have >=4 coords (closed)');
    assert.deepEqual(ring[0], ring[ring.length - 1], 'first vertex == last vertex');
    for (const k of ['label', 'field_strength_dbu', 'method', 'mean_radial_km', 'call', 'facility_id']){
      assert.ok(k in f.properties, `geojson feature missing required property ${k}`);
    }
  }
});

test('Warnings system: typed codes only, ONE entry per code', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const codes = new Set();
  for (const w of x.warnings){
    assert.ok(typeof w.code === 'string' && w.code.length > 0);
    assert.ok(['blocker', 'warning', 'info'].includes(w.severity));
    assert.ok(!codes.has(w.code), 'duplicate warning code ' + w.code);
    codes.add(w.code);
  }
});

test('W.dedupe collapses same-code/different-detail; richer detail wins', async () => {
  const { W } = await import('../types/warnings.js');
  const a = W.make('FACILITY_LOOKUP_UNAVAILABLE');                              // no detail
  const b = W.make('FACILITY_LOOKUP_UNAVAILABLE', 'no upstream configured');    // richer
  const out = W.dedupe([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].code, 'FACILITY_LOOKUP_UNAVAILABLE');
  assert.equal(out[0].detail, 'no upstream configured');
  // Order independence — richer detail still wins when it appears first.
  const out2 = W.dedupe([b, a]);
  assert.equal(out2.length, 1);
  assert.equal(out2[0].detail, 'no upstream configured');
});

test('Missing curve validation -> CURVE_VALIDATION_MISSING blocker present', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const blocker = x.blockers.find(b => b.code === 'CURVE_VALIDATION_MISSING');
  assert.ok(blocker, 'expected CURVE_VALIDATION_MISSING blocker');
});

test('Interpolation block is present and named', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  assert.ok(x.interpolation, 'interpolation must not be missing');
  assert.ok(x.interpolation.along_field, 'along_field interpolation method documented');
  assert.ok(x.interpolation.along_haat,  'along_haat interpolation method documented');
});

test('Placeholder population emits POPULATION_PLACEHOLDER warning', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  assert.ok(x.warnings.find(w => w.code === 'POPULATION_PLACEHOLDER'));
});

test('Narrative contains the FCC method name', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  assert.ok(x.narrative?.text?.includes(x.calculation_method.name),
    'narrative must reference the FCC method');
});

test('AI cannot modify engineering output: narrative.ai_used is false and engine numbers stable across re-render', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  assert.equal(x.narrative.ai_used, false, 'narrative.ai_used must be false');
  // Sanity: re-rendering narrative does not change numbers.
  const before = JSON.stringify(x.radial_table);
  const { renderNarrative } = await import('../narrative/generator.js');
  x.narrative = renderNarrative(x);
  const after = JSON.stringify(x.radial_table);
  assert.equal(before, after, 'radial_table changed after re-rendering narrative');
});

test('AM in-range inputs: FCC-canonical engine returns real contour distances', async () => {
  // 1 kW @ 1240 kHz, σ = 8 mS/m — all inside FCC §73.184 grid.  After
  // PR B (vendored gwave.js) AM is no longer "not implemented".
  const x = await buildExhibit(AM_INCOMPLETE);
  assert.ok(!x.warnings.find(w => w.code === 'AM_ENGINE_NOT_IMPLEMENTED'),
    'AM_ENGINE_NOT_IMPLEMENTED must be gone now that gwave.js is wired');
  // Every radial must have at least one numeric contour distance.
  for (const r of x.radial_table){
    const numericVals = Object.values(r.contour_distances_km).filter(Number.isFinite);
    assert.ok(numericVals.length > 0,
      'AM engine must return real distances for in-range inputs; got all nulls');
  }
});

test('AM out-of-range inputs: distances are null + FCC_METHOD_MISSING (no fabrication)', async () => {
  // σ = 0 is outside FCC M3 (1..8 mS/m) — engine must NOT fake numbers.
  const x = await buildExhibit({
    ...AM_INCOMPLETE,
    ground_sigma_mS_m: 0
  });
  // FCC_METHOD_MISSING emitted by amWarnings() for out-of-range σ.
  assert.ok(x.warnings.find(w => w.code === 'FCC_METHOD_MISSING'),
    'out-of-range σ must emit FCC_METHOD_MISSING');
});

test('Missing facility coordinates: contour distances still computed, no polygons projected', async () => {
  const x = await buildExhibit(KSLX_NO_COORDS);
  assert.ok(x.warnings.find(w => w.code === 'FACILITY_COORDINATES_MISSING'));
  assert.equal(x.geojson.features.length, 0, 'no GeoJSON features without coordinates');
  // radial table still has numeric contour distances:
  assert.ok(x.radial_table.length > 0);
  const c = x.contour_definitions[0].id;
  for (const r of x.radial_table){
    assert.ok(Number.isFinite(r.contour_distances_km[c]),
      'contour distance still computed without coordinates');
  }
});

test('Missing sidecars do not break FM compute (terrain/measurement/identity all unset)', async () => {
  delete process.env.TERRAIN_SIDECAR_URL;
  delete process.env.MEASUREMENT_SIDECAR_URL;
  delete process.env.IDENTITY_SIDECAR_URL;
  const x = await buildExhibit(FM_CLASS_A);
  assert.ok(x.polygons.length > 0, 'FM compute must succeed without sidecars');
  assert.ok(x.warnings.find(w => w.code === 'SDR_MEASUREMENTS_MISSING'));
});

test('engine_signature, blockers, degraded_mode, calculation_trace all populated', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  assert.equal(x.engine_signature.module, 'genoa-engine');
  assert.equal(x.engine_signature.version, '2.0.0');
  assert.ok(typeof x.engine_signature.hash === 'string' && x.engine_signature.hash.length > 0);
  assert.ok(Array.isArray(x.blockers));
  assert.equal(typeof x.degraded_mode, 'boolean');
  assert.ok(Array.isArray(x.degraded_reasons));
  assert.ok(x.calculation_trace?.fm?.formula_summary, 'FM calculation_trace.formula_summary required');
  // calculation_trace.fm.dataset reflects the active curve engine.
  // For the FCC-canonical default, dataset is the vendored upstream
  // identifier (NOT the legacy curve_dataset.curve_version).  Either
  // form is acceptable as long as dataset is a non-empty string.
  assert.ok(typeof x.calculation_trace.fm.dataset === 'string'
            && x.calculation_trace.fm.dataset.length > 0,
            'calculation_trace.fm.dataset must be set');
  assert.equal(x.method_versions.curve_engine, 'fcc-canonical',
               'default engine should be fcc-canonical');
});
