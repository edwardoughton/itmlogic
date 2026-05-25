import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExhibit, FM_CLASS_A, AM_INCOMPLETE } from './_helpers.js';
import {
  validatePhysicsEvidence,
  notConfiguredPhysicsEvidence,
  PHYSICS_EVIDENCE_STATUSES
} from '../types/physicsEvidence.schema.js';
import {
  _groundConstantsResolver,
  DEFAULT_EPR
} from '../evidence/amPhysicsClient.js';
import {
  resolveNecGround,
  DEFAULT_EPR as NEC_DEFAULT_EPR
} from '../evidence/nec/client.js';
import { makeVoacapClient } from '../evidence/voacapClient.js';
import { buildAppendixSections } from '../exports/engineeringReport/sections/appendices.js';

// PHYSICS ADVISORY INVARIANCE — proves the two regulatory boundaries:
//
//   1.  Every observable status of an evidence.am_physics block
//       carries advisory:true + filing_effect:'none' and satisfies
//       validatePhysicsEvidence().
//
//   2.  Flipping AM_PHYSICS_SIDECAR_URL on/off does NOT alter the
//       engine-computed contour_definitions geometry (FCC §73.184
//       curve math is unaffected by the advisory physics sidecar).
//
// These invariants are the data-shape encoding of the "physics
// sidecar never touches filing math" boundary described in
// evidence/amPhysicsClient.js and Appendix H.

/* ───────── 1. filing_effect:'none' on every branch ───────── */

function brand(extra){
  // Every helper builds a candidate evidence.am_physics block; the
  // test then asserts the invariants hold no matter how it was built.
  return {
    advisory:      true,
    filing_effect: 'none',
    engine:        'somnec2d',
    ...extra
  };
}

test('schema lists exactly the four advisory statuses', () => {
  assert.deepEqual(
    [...PHYSICS_EVIDENCE_STATUSES].sort(),
    ['failed', 'not_configured', 'not_run', 'run'].sort()
  );
});

test('filing_effect:none on every branch — not_configured', () => {
  const b = brand({ status: 'not_configured' });
  const v = validatePhysicsEvidence(b);
  assert.equal(v.ok, true, v.errors?.join(';'));
  assert.equal(b.filing_effect, 'none');
  assert.equal(b.advisory, true);
});

test('filing_effect:none on every branch — not_run (missing freq)', () => {
  const b = brand({ status: 'not_run', warning: 'frequency missing' });
  assert.equal(validatePhysicsEvidence(b).ok, true);
  assert.equal(b.filing_effect, 'none');
});

test('filing_effect:none on every branch — run (successful)', () => {
  const b = brand({
    status: 'run',
    inputs:  { epr: 15, epr_source: 'default', sig_s_m: 0.008, sigma_ms_m: 8, sigma_source: 'default', frequency_mhz: 0.78 },
    outputs: { grid_file: 'SOM2D.NEC', grid_sha256: 'deadbeef'.repeat(8), grid_created: true },
    stdout_summary: { epscf: '(15.000,-184.369)', ar1_1_1: '(-3.040,-188.095)', time_seconds: 0.047 }
  });
  assert.equal(validatePhysicsEvidence(b).ok, true);
  assert.equal(b.filing_effect, 'none');
});

test('filing_effect:none on every branch — failed (sidecar HTTP error)', () => {
  const b = brand({ status: 'failed', warning: 'HTTP 503' });
  assert.equal(validatePhysicsEvidence(b).ok, true);
  assert.equal(b.filing_effect, 'none');
});

test('helper notConfiguredPhysicsEvidence() satisfies the schema', () => {
  const v = validatePhysicsEvidence(notConfiguredPhysicsEvidence());
  assert.equal(v.ok, true, v.errors?.join(';'));
});

test('schema rejects advisory:false (filing-controlling) blocks', () => {
  const bad = brand({ status: 'run', advisory: false });
  const v = validatePhysicsEvidence(bad);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /advisory/.test(e)));
});

test('schema rejects filing_effect other than none', () => {
  const bad = brand({ status: 'run', filing_effect: 'modifies_contour' });
  const v = validatePhysicsEvidence(bad);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /filing_effect/.test(e)));
});

test('schema rejects unknown status', () => {
  const bad = brand({ status: 'authoritative' });
  const v = validatePhysicsEvidence(bad);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some(e => /status/.test(e)));
});

/* ───────── 2. Appendix H surfaces filing_effect:NONE on every branch ───────── */

function appendixHRowsFor(physicsBlock){
  const sections = buildAppendixSections({
    station_inputs: { service: 'AM' },
    evidence:       { am_physics: physicsBlock },
    radial_table:   []
  });
  return sections.find(s => s.id === 'appendix-h');
}

test('Appendix H — every branch carries "Filing effect: NONE (advisory only)"', () => {
  const branches = [
    brand({ status: 'not_configured' }),
    brand({ status: 'not_run', warning: 'frequency missing' }),
    brand({ status: 'failed',  warning: 'HTTP 503' }),
    brand({
      status: 'run',
      inputs:  { epr: 15, epr_source: 'default', sig_s_m: 0.008, sigma_ms_m: 8, sigma_source: 'default', frequency_mhz: 0.78 },
      outputs: { grid_file: 'SOM2D.NEC', grid_sha256: 'abc123', grid_created: true },
      stdout_summary: { epscf: '(15,-184)', ar1_1_1: '(-3,-188)', time_seconds: 0.05 }
    })
  ];
  for (const b of branches){
    const app = appendixHRowsFor(b);
    assert.ok(app, `Appendix H must appear for branch ${b.status}`);
    const fe = app.rows.find(r => /Filing effect/i.test(r[0]));
    assert.ok(fe, `branch ${b.status} must include Filing effect row`);
    assert.match(String(fe[1]), /NONE/i);
    const schema = app.rows.find(r => r[0] === 'Schema');
    assert.ok(schema, `branch ${b.status} must include Schema row`);
    assert.match(String(schema[1]), /PASS/);
  }
});

/* ───────── 3. Unified ground constants resolver ───────── */

test('unified resolver: SOMNEC2D and NEC sidecar see the same εᵣ default (15, not 13)', () => {
  const g = _groundConstantsResolver({});
  assert.equal(g.epr, 15);
  assert.equal(g.epr_source, 'default');
  // NEC client re-exports the same default — the historical 13/15 split is closed.
  assert.equal(NEC_DEFAULT_EPR, DEFAULT_EPR);
  assert.equal(NEC_DEFAULT_EPR, 15);
});

test('unified resolver: operator-supplied εᵣ propagates with source=input', () => {
  const g = _groundConstantsResolver({ ground_epr: 9, ground_sigma_mS_m: 4 });
  assert.equal(g.epr, 9);
  assert.equal(g.epr_source, 'input');
  assert.equal(g.sigma_ms_m, 4);
  assert.equal(g.sig_s_m, 0.004);
  assert.equal(g.sigma_source, 'input');
});

test('resolveNecGround() produces a Sommerfeld block tagged as unified', () => {
  const ng = resolveNecGround({ ground_epr: 13, ground_sigma_mS_m: 5 });
  assert.equal(ng.type, 'sommerfeld');
  assert.equal(ng.dielectric_constant, 13);
  assert.equal(ng.conductivity_s_m, 0.005);
  assert.equal(ng._source.unified, true);
  assert.equal(ng._source.resolver, 'evidence/amPhysicsClient._groundConstantsResolver');
});

/* ───────── 4. VOACAP client stub ───────── */

test('makeVoacapClient: null when VOACAP_SIDECAR_URL unset', () => {
  const orig = process.env.VOACAP_SIDECAR_URL;
  delete process.env.VOACAP_SIDECAR_URL;
  try {
    assert.equal(makeVoacapClient(), null);
  } finally {
    if (orig !== undefined) process.env.VOACAP_SIDECAR_URL = orig;
  }
});

test('makeVoacapClient stub: runPath returns advisory envelope with filing_effect=none', async () => {
  const c = makeVoacapClient({ baseUrl: 'http://voacap.test' });
  assert.ok(c);
  assert.equal(c.stub, true);
  const h = await c.health();
  assert.equal(h.stub, true);
  assert.equal(h.reachable, false);
  const r = await c.runPath({ tx: { lat: 40, lon: -73 }, rx: { lat: 50, lon: -100 } });
  assert.equal(r.advisory, true);
  assert.equal(r.filing_effect, 'none');
  assert.equal(r.engine, 'voacap');
  assert.equal(r.stub, true);
  assert.equal(r.status, 'not_run');
});

/* ───────── 5. AM_PHYSICS_SIDECAR_URL flip does NOT change contour geometry ───────── */
//
// The engine's contour_definitions are derived from FCC §73.184 / §73.333
// curve math and are independent of any advisory sidecar.  Flipping the
// env var that wires up the SOMNEC2D HTTP client must therefore leave
// contour_definitions[*] byte-identical.  We prove that on FM (where the
// engine path is fully exercised in tests) and assert structural
// equality of the full contour_definitions array.

async function contourDefsWithUrl(url){
  const orig = process.env.AM_PHYSICS_SIDECAR_URL;
  if (url == null) delete process.env.AM_PHYSICS_SIDECAR_URL;
  else process.env.AM_PHYSICS_SIDECAR_URL = url;
  try {
    const x = await buildExhibit(FM_CLASS_A);
    return x.contour_definitions;
  } finally {
    if (orig === undefined) delete process.env.AM_PHYSICS_SIDECAR_URL;
    else process.env.AM_PHYSICS_SIDECAR_URL = orig;
  }
}

test('flipping AM_PHYSICS_SIDECAR_URL on/off does NOT change contour_definitions', async () => {
  const off = await contourDefsWithUrl(null);
  const on  = await contourDefsWithUrl('http://amphys.test.invalid');
  assert.deepEqual(off, on,
    'advisory SOMNEC2D wiring must NEVER change FCC curve-derived contour geometry');
  // Defensive: also assert it's non-empty so we know the test actually exercised the engine.
  assert.ok(Array.isArray(off) && off.length > 0);
});

test('flipping AM_PHYSICS_SIDECAR_URL on/off — AM path — leaves contour_definitions identical', async () => {
  const orig = process.env.AM_PHYSICS_SIDECAR_URL;
  try {
    delete process.env.AM_PHYSICS_SIDECAR_URL;
    const off = (await buildExhibit(AM_INCOMPLETE)).contour_definitions;
    process.env.AM_PHYSICS_SIDECAR_URL = 'http://amphys.test.invalid';
    const on  = (await buildExhibit(AM_INCOMPLETE)).contour_definitions;
    assert.deepEqual(off, on);
  } finally {
    if (orig === undefined) delete process.env.AM_PHYSICS_SIDECAR_URL;
    else process.env.AM_PHYSICS_SIDECAR_URL = orig;
  }
});
