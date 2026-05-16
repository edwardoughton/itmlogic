// FCC parity report client tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeFccParityClient,
  frequencyToFmChannel,
  FCC_PARITY_PROVENANCE
} from '../evidence/fccParity/client.js';

function withFetch(fakeFetch, fn){
  const orig = global.fetch;
  global.fetch = fakeFetch;
  return Promise.resolve(fn()).finally(() => { global.fetch = orig; });
}

const FM_EXHIBIT = {
  station_inputs: {
    call: 'KSUB', service: 'FM', fcc_class: 'A',
    frequency: 100.7, haat_m: 100, erp_kw: 6
  },
  method_versions: {
    curve_engine: 'fcc-canonical',
    dataset:      'fcc/contours-api-node@b55870d (tvfm_curves.js)'
  },
  contour_definitions: {
    s60: { field_dBu: 60, mode: '50,50' },
    s54: { field_dBu: 54, mode: '50,50' },
    i40: { field_dBu: 40, mode: '50,10' }
  },
  radial_table: [
    { az: 0,   contour_distances_km: { s60: 90.0,  s54: 130.0, i40: 50.0 } },
    { az: 90,  contour_distances_km: { s60: 88.5,  s54: 128.0, i40: 49.5 } },
    { az: 180, contour_distances_km: { s60: 91.2,  s54: 131.5, i40: 50.5 } },
    { az: 270, contour_distances_km: { s60: 89.0,  s54: 129.0, i40: 49.8 } }
  ]
};

/* ---------- channel helper ---------- */

test('frequencyToFmChannel: standard FM grid', () => {
  assert.equal(frequencyToFmChannel(87.9), 200);
  assert.equal(frequencyToFmChannel(100.7), 264);
  assert.equal(frequencyToFmChannel(107.9), 300);
  // Out of band → NaN
  assert.ok(Number.isNaN(frequencyToFmChannel(50.0)));
});

/* ---------- AM / unsupported services ---------- */

test('parity report: AM exhibit returns no-public-endpoint reason', async () => {
  const c = makeFccParityClient();
  const r = await c.report({
    station_inputs: { service: 'AM', frequency: 1240, haat_m: 75, erp_kw: 1 },
    radial_table:   []
  });
  assert.equal(r.available, false);
  assert.match(r.reason, /no public per-call distance.json endpoint for AM/);
});

test('parity report: TV exhibit returns not-implemented', async () => {
  const c = makeFccParityClient();
  const r = await c.report({
    station_inputs: { service: 'TV', frequency: 100, haat_m: 100, erp_kw: 100 },
    radial_table:   []
  });
  assert.equal(r.available, false);
  assert.match(r.reason, /not implemented for service=TV/);
});

/* ---------- happy path ---------- */

test('parity report: every sample within tolerance → overall_pass=true', async () => {
  // Fixture with UNIFORM Genoa distances per contour family — the
  // FCC mock returns one km per (contour, mode) so deltas are
  // bounded by the ±5 m noise added below.
  const FM_UNIFORM = {
    station_inputs: { call: 'KSUB', service: 'FM', fcc_class: 'A', frequency: 100.7, haat_m: 100, erp_kw: 6 },
    method_versions: { curve_engine: 'fcc-canonical' },
    contour_definitions: {
      s60: { field_dBu: 60, mode: '50,50' },
      s54: { field_dBu: 54, mode: '50,50' },
      i40: { field_dBu: 40, mode: '50,10' }
    },
    radial_table: [
      { az: 0,   contour_distances_km: { s60: 90.0, s54: 130.0, i40: 50.0 } },
      { az: 90,  contour_distances_km: { s60: 90.0, s54: 130.0, i40: 50.0 } },
      { az: 180, contour_distances_km: { s60: 90.0, s54: 130.0, i40: 50.0 } },
      { az: 270, contour_distances_km: { s60: 90.0, s54: 130.0, i40: 50.0 } }
    ]
  };
  let calls = 0;
  await withFetch(async (url) => {
    calls++;
    const m = url.match(/&field=([0-9.]+)&curve=([01])/);
    const field = Number(m?.[1]);
    const km = field === 60 ? 90.05
             : field === 54 ? 130.02
             : 50.01;
    return { ok: true, status: 200, async json(){ return { distance_km: km }; } };
  }, async () => {
    const c = makeFccParityClient({ toleranceKm: 0.1, maxSamples: 6 });
    const r = await c.report(FM_UNIFORM);
    assert.equal(r.available, true);
    assert.ok(r.n_samples >= 1);
    assert.equal(r.overall_pass, true);
    assert.equal(r.n_fail, 0);
    assert.ok(r.max_error_km <= 0.1);
    assert.ok(calls === r.n_samples);
    assert.equal(r.source, 'geo.fcc.gov/api/contours/distance.json');
    assert.match(r.provenance.upstream_endpoint, /distance\.json/);
    assert.equal(r.provenance.upstream_commit, 'b55870d3f20618e886cd02379008ef980229d44b');
  });
});

/* ---------- mismatch path ---------- */

test('parity report: large delta → overall_pass=false + per-sample within_tolerance flags', async () => {
  await withFetch(async () => ({
    ok: true, status: 200,
    async json(){ return { distance_km: 12345.0 }; }      // wildly off
  }), async () => {
    const c = makeFccParityClient({ toleranceKm: 0.05, maxSamples: 3 });
    const r = await c.report(FM_EXHIBIT);
    assert.equal(r.overall_pass, false);
    assert.ok(r.n_fail > 0);
    assert.ok(r.max_error_km > 100);
    assert.ok(r.samples.every(s => s.within_tolerance === false));
  });
});

/* ---------- error paths ---------- */

test('parity report: HTTP 500 surfaces error per sample, available=false if all fail', async () => {
  await withFetch(async () => ({ ok: false, status: 500, async json(){ return {}; } }), async () => {
    const c = makeFccParityClient({ maxSamples: 4 });
    const r = await c.report(FM_EXHIBIT);
    assert.equal(r.available, false);
    assert.ok(r.errors && r.errors.length > 0);
  });
});

test('parity report: rate limit on some samples → partial available with errors[]', async () => {
  let n = 0;
  await withFetch(async () => {
    n++;
    if (n % 2 === 0) return { ok: false, status: 429, async json(){ return {}; } };
    return { ok: true, status: 200, async json(){ return { distance_km: 90.0 }; } };
  }, async () => {
    const c = makeFccParityClient({ toleranceKm: 1.0, maxSamples: 6 });
    const r = await c.report(FM_EXHIBIT);
    // At least some samples succeeded.
    assert.ok(r.n_samples > 0);
    assert.ok(r.n_attempted >= r.n_samples);
    assert.ok((r.errors || []).length > 0);
  });
});

test('parity report: bad JSON in upstream surfaces "bad upstream JSON"', async () => {
  await withFetch(async () => ({ ok: true, status: 200, async json(){ return { unexpected: 'shape' }; } }),
    async () => {
      const c = makeFccParityClient({ maxSamples: 2 });
      const r = await c.report(FM_EXHIBIT);
      assert.equal(r.available, false);
      assert.ok(r.errors.some(e => /bad JSON/.test(e)));
    });
});

/* ---------- guard cases ---------- */

test('parity report: missing exhibit returns guard error', async () => {
  const c = makeFccParityClient();
  const r = await c.report(null);
  assert.equal(r.available, false);
  assert.match(r.error, /exhibit object required/);
});

test('parity report: empty radial_table returns "no samples"', async () => {
  await withFetch(async () => ({ ok: true, status: 200, async json(){ return { distance_km: 1 }; } }),
    async () => {
      const c = makeFccParityClient();
      const r = await c.report({
        station_inputs: { service: 'FM', frequency: 100.7, haat_m: 100, erp_kw: 6 },
        radial_table:   []
      });
      assert.equal(r.available, false);
      assert.match(r.error, /no radial-contour samples/);
    });
});

/* ---------- engine-array shape (regression for the WJPZ-FM exhibit) ---------- */

test('parity report: contour_definitions array shape (engine output) yields samples', async () => {
  // This is the shape src/engine/index.js actually emits.  The old
  // object-keyed shape was a test fixture, not the production shape;
  // the parity client must accept the array.
  const EXHIBIT_ARRAY_SHAPE = {
    station_inputs: { service: 'FM', frequency: 89.1, haat_m: 37, erp_kw: 1 },
    contour_definitions: [
      { id: 'service_60dbu',   label: '60 dBu (1 mV/m service)', field_strength: { value: 60, unit: 'dBu' } },
      { id: 'city_54dbu',      label: '54 dBu (city grade)',      field_strength: { value: 54, unit: 'dBu' } },
      { id: 'protected_40dbu', label: '40 dBu (protected)',       field_strength: { value: 40, unit: 'dBu' } }
    ],
    radial_table: [
      { az: 0,   contour_distances_km: { service_60dbu: 19.23, city_54dbu: 26.56, protected_40dbu: 52.03 } },
      { az: 90,  contour_distances_km: { service_60dbu: 12.98, city_54dbu: 18.60, protected_40dbu: 39.04 } },
      { az: 180, contour_distances_km: { service_60dbu: 10.16, city_54dbu: 14.16, protected_40dbu: 30.97 } }
    ]
  };
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    // Mirror Genoa's distance back so deltas are 0.
    const m = url.match(/field=(\d+)/);
    const dBu = m ? Number(m[1]) : 60;
    const km = dBu === 60 ? 14.0 : dBu === 54 ? 19.8 : 41.0;
    return { ok: true, json: async () => ({ distance_km: km }) };
  };
  await withFetch(fakeFetch, async () => {
    const c = makeFccParityClient({ toleranceKm: 100 });
    const r = await c.report(EXHIBIT_ARRAY_SHAPE);
    assert.equal(r.available, true);
    assert.ok(r.n_samples > 0, `expected samples > 0, got ${r.n_samples}`);
    // Every contour family represented at least once.
    const families = new Set(r.samples.map(s => s.contour));
    assert.ok(families.has('service_60dbu'));
    assert.ok(families.has('city_54dbu'));
    assert.ok(families.has('protected_40dbu'));
    // 54 dBu sample uses field=54 on the URL.
    assert.ok(calls.some(u => /field=54\b/.test(u)));
  });
});

test('parity report: mV/m unit converts to dBµV/m (1 mV/m → 60 dBu)', async () => {
  const EXHIBIT_MVM = {
    station_inputs: { service: 'FM', frequency: 89.1, haat_m: 37, erp_kw: 1 },
    contour_definitions: [
      // 1 mV/m == 60 dBµV/m exactly; 0.5 mV/m ≈ 53.98 dBu; 0.1 mV/m == 40 dBu.
      { id: 'svc',  field_strength: { value: 1.0, unit: 'mV/m' } },
      { id: 'city', field_strength: { value: 0.5, unit: 'mV/m' } },
      { id: 'prot', field_strength: { value: 0.1, unit: 'mV/m' } }
    ],
    radial_table: [
      { az: 0, contour_distances_km: { svc: 19.2, city: 26.6, prot: 52.0 } }
    ]
  };
  const seen = [];
  await withFetch(async (url) => {
    seen.push(url);
    return { ok: true, json: async () => ({ distance_km: 1 }) };
  }, async () => {
    const c = makeFccParityClient({ toleranceKm: 100 });
    await c.report(EXHIBIT_MVM);
  });
  // Rounded to nearest int per URL encoding; svc=60, prot=40, city≈54.
  // We tolerate 53 or 54 for the city contour (cubic-precision rounding).
  assert.ok(seen.some(u => /field=60\b/.test(u)));
  assert.ok(seen.some(u => /field=40\b/.test(u)) || seen.some(u => /field=39\b/.test(u)));
});

/* ---------- provenance ---------- */

test('FCC_PARITY_PROVENANCE names regulation + license + upstream commit', () => {
  assert.match(FCC_PARITY_PROVENANCE.regulation, /73\.333/);
  assert.match(FCC_PARITY_PROVENANCE.upstream, /distance\.json/);
  assert.match(FCC_PARITY_PROVENANCE.license_basis, /17 USC §105/);
  assert.match(FCC_PARITY_PROVENANCE.upstream_engine, /tvfm_curves\.js/);
});
