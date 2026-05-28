// Replay determinism — same inputs in, byte-equal compute outputs out.
//
// The Genoa engine ships a replay token; the inputs_sha256 +
// evidence_sha256 hashes commit to canonical representations of the
// request.  Replay determinism is the load-bearing claim of the entire
// product: any reviewer should be able to re-run a filed exhibit and
// land on the same engineering content.
//
// What "byte-equal" means here:
//   STABLE   (must match across two runs)
//     - station_inputs
//     - radial_table
//     - polygons
//     - geojson
//     - contour_definitions
//     - regulatory_compliance
//     - replay_digest.inputs_sha256
//     - replay_digest.evidence_sha256
//     - engine_signature
//   VARYING  (excluded by design)
//     - generated_at                   (timestamp)
//     - replay_digest.exhibit_sha256  (derives from generated_at)
//     - build_attestation.signed_at    (timestamp)

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExhibit, FM_CLASS_A, AM_INCOMPLETE } from './_helpers.js';

function stableSlice(exhibit){
  return {
    station_inputs:         exhibit.station_inputs,
    radial_table:           exhibit.radial_table,
    polygons:               exhibit.polygons,
    geojson:                exhibit.geojson,
    contour_definitions:    exhibit.contour_definitions,
    regulatory_compliance:  exhibit.regulatory_compliance,
    inputs_sha256:          exhibit.replay_digest?.inputs_sha256,
    evidence_sha256:        exhibit.replay_digest?.evidence_sha256,
    engine_signature:       exhibit.engine_signature
  };
}

test('replay determinism: FM canonical reference is byte-equal across two runs', async () => {
  const a = await buildExhibit(FM_CLASS_A);
  const b = await buildExhibit(FM_CLASS_A);
  const ja = JSON.stringify(stableSlice(a));
  const jb = JSON.stringify(stableSlice(b));
  assert.equal(ja, jb, 'FM stable slice diverged across runs');
});

test('replay determinism: AM canonical reference is byte-equal across two runs', async () => {
  const a = await buildExhibit(AM_INCOMPLETE);
  const b = await buildExhibit(AM_INCOMPLETE);
  const ja = JSON.stringify(stableSlice(a));
  const jb = JSON.stringify(stableSlice(b));
  assert.equal(ja, jb, 'AM stable slice diverged across runs');
});

test('replay determinism: inputs_sha256 is stable when inputs are byte-equal', async () => {
  const a = await buildExhibit(FM_CLASS_A);
  const b = await buildExhibit(FM_CLASS_A);
  assert.equal(a.replay_digest.inputs_sha256, b.replay_digest.inputs_sha256);
});

test('replay determinism: evidence_sha256 is stable when evidence is byte-equal', async () => {
  const a = await buildExhibit(FM_CLASS_A);
  const b = await buildExhibit(FM_CLASS_A);
  assert.equal(a.replay_digest.evidence_sha256, b.replay_digest.evidence_sha256);
});

test('replay determinism: radial_table is exactly byte-equal across runs', async () => {
  const a = await buildExhibit(FM_CLASS_A);
  const b = await buildExhibit(FM_CLASS_A);
  assert.equal(JSON.stringify(a.radial_table), JSON.stringify(b.radial_table));
});

test('replay determinism: polygons are exactly byte-equal across runs', async () => {
  const a = await buildExhibit(FM_CLASS_A);
  const b = await buildExhibit(FM_CLASS_A);
  assert.equal(JSON.stringify(a.polygons), JSON.stringify(b.polygons));
});

test('replay determinism: geojson is exactly byte-equal across runs', async () => {
  const a = await buildExhibit(FM_CLASS_A);
  const b = await buildExhibit(FM_CLASS_A);
  assert.equal(JSON.stringify(a.geojson), JSON.stringify(b.geojson));
});

test('replay determinism: different inputs → different inputs_sha256', async () => {
  const a = await buildExhibit(FM_CLASS_A);
  const variant = { ...FM_CLASS_A, erp_kw: 25 };   // distinguishable input change
  const b = await buildExhibit(variant);
  assert.notStrictEqual(a.replay_digest.inputs_sha256, b.replay_digest.inputs_sha256,
    'inputs_sha256 collision across different ERP values');
});

test('replay determinism: generated_at is the ONLY field permitted to vary across runs', async () => {
  // Trust-but-verify: enumerate every top-level key that differs and
  // assert it's on a known allow-list.
  const a = await buildExhibit(FM_CLASS_A);
  const b = await buildExhibit(FM_CLASS_A);
  const allowed = new Set([
    'generated_at', 'replay_digest', 'replay_token',
    'build_attestation', 'narrative', 'validation'
  ]);
  // build_attestation carries a signed_at; replay_token packs the
  // generated_at; narrative.text embeds the Generated: ISO stamp;
  // validation.runs carry per-run start/end stamps.
  const drifted = [];
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])){
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])){
      if (!allowed.has(k)) drifted.push(k);
    }
  }
  assert.deepEqual(drifted, [],
    'unexpected fields drifted across replay: ' + drifted.join(','));
});
