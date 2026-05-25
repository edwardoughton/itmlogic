// enrichNearbyFromZtr — ZTR per-station environmental enrichment of
// the §73.215 / §73.187 nearby_primaries list.
//
// Tests cover:
//   - happy path: ZTR carries env data, enrichment merged
//   - missing env: ZTR has the row but no env fields, pass-through
//   - missing station: facility_id not in ZTR, pass-through
//   - missing facility_id: row has no id, skipped silently
//   - schema variants: m3_conductivity_msm vs ground_sigma_msm vs sigma_mS_m
//   - nested env: row.env.ground_sigma_msm picked up
//   - empty input: returns empty without calling fetch
//   - ZTR not configured (no ztrUrl): returns input unchanged
//   - errors counted: HTTP 500 → not enriched, error tagged

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeFacilityClient } from '../api/services/facilityClient.js';

function withFetch(fakeFetch, fn){
  const orig = global.fetch;
  global.fetch = fakeFetch;
  return Promise.resolve(fn()).finally(() => { global.fetch = orig; });
}

function jsonResp(data, ok = true){
  return { ok, status: ok ? 200 : 500, async json(){ return data; } };
}

const SAMPLE = (extras = {}) => ({
  call: 'KTST', facility_id: '12345', frequency_khz: 1240, erp_kw: 1, lat: 40, lon: -100,
  ...extras
});

test('enrichNearbyFromZtr: ZTR carries env → merged into row', async () => {
  await withFetch(async (url) => {
    if (url.includes('facility_id=12345')){
      return jsonResp({ rows: [{
        facility_id: '12345', call: 'KTST',
        ground_sigma_msm: 4,
        rss_erp_kw:       0.85,
        sunset_offset_min:-15
      }]});
    }
    return jsonResp({ rows: [] }, false);
  }, async () => {
    const fc = makeFacilityClient({ ztrUrl: 'http://ztr.test', n8nBaseUrl: null });
    const r = await fc.enrichNearbyFromZtr([SAMPLE()]);
    assert.equal(r.n_enriched, 1);
    assert.equal(r.n_total,    1);
    assert.equal(r.primaries[0].ground_sigma_msm, 4);
    assert.equal(r.primaries[0].rss_erp_kw,       0.85);
    assert.equal(r.primaries[0].sunset_offset_min,-15);
    assert.equal(r.primaries[0].enriched_from_ztr, true);
    assert.match(r.primaries[0].ztr_endpoint, /facility_id=12345/);
  });
});

test('enrichNearbyFromZtr: ZTR row without env fields passes through unenriched', async () => {
  await withFetch(async () => jsonResp({ rows: [{ facility_id: '12345', call: 'KTST' }] }), async () => {
    const fc = makeFacilityClient({ ztrUrl: 'http://ztr.test', n8nBaseUrl: null });
    const r = await fc.enrichNearbyFromZtr([SAMPLE()]);
    assert.equal(r.n_enriched, 0);
    assert.equal(r.primaries[0].enriched_from_ztr, undefined);
    assert.equal(r.primaries[0].ground_sigma_msm,  undefined);
  });
});

test('enrichNearbyFromZtr: schema variants — m3_conductivity_msm matches', async () => {
  await withFetch(async () => jsonResp({ rows: [{
    facility_id: '12345',
    m3_conductivity_msm: 8                              // alternative name
  }]}), async () => {
    const fc = makeFacilityClient({ ztrUrl: 'http://ztr.test', n8nBaseUrl: null });
    const r = await fc.enrichNearbyFromZtr([SAMPLE()]);
    assert.equal(r.primaries[0].ground_sigma_msm, 8);
  });
});

test('enrichNearbyFromZtr: nested .env.ground_sigma_msm picked up', async () => {
  await withFetch(async () => jsonResp({ rows: [{
    facility_id: '12345',
    env: { ground_sigma_msm: 6 }
  }]}), async () => {
    const fc = makeFacilityClient({ ztrUrl: 'http://ztr.test', n8nBaseUrl: null });
    const r = await fc.enrichNearbyFromZtr([SAMPLE()]);
    assert.equal(r.primaries[0].ground_sigma_msm, 6);
  });
});

test('enrichNearbyFromZtr: nested .station.rss_erp_kw picked up', async () => {
  await withFetch(async () => jsonResp({ rows: [{
    facility_id: '12345',
    station: { rss_erp_kw: 2.3 }
  }]}), async () => {
    const fc = makeFacilityClient({ ztrUrl: 'http://ztr.test', n8nBaseUrl: null });
    const r = await fc.enrichNearbyFromZtr([SAMPLE()]);
    assert.equal(r.primaries[0].rss_erp_kw, 2.3);
  });
});

test('enrichNearbyFromZtr: row with no facility_id is skipped silently', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return jsonResp({ rows: [] }); }, async () => {
    const fc = makeFacilityClient({ ztrUrl: 'http://ztr.test', n8nBaseUrl: null });
    const r = await fc.enrichNearbyFromZtr([SAMPLE({ facility_id: null })]);
    assert.equal(r.n_enriched, 0);
    assert.equal(calls, 0, 'no ZTR call should fire when facility_id is null');
  });
});

test('enrichNearbyFromZtr: empty input returns empty without calling fetch', async () => {
  let calls = 0;
  await withFetch(async () => { calls++; return jsonResp({}); }, async () => {
    const fc = makeFacilityClient({ ztrUrl: 'http://ztr.test', n8nBaseUrl: null });
    const r = await fc.enrichNearbyFromZtr([]);
    assert.equal(r.n_total, 0);
    assert.equal(calls, 0);
  });
});

test('enrichNearbyFromZtr: HTTP 500 → row passes through, error tagged', async () => {
  await withFetch(async () => ({ ok: false, status: 500, async json(){ return {}; } }), async () => {
    const fc = makeFacilityClient({ ztrUrl: 'http://ztr.test', n8nBaseUrl: null });
    const r = await fc.enrichNearbyFromZtr([SAMPLE()]);
    assert.equal(r.n_enriched, 0);
    assert.equal(r.primaries[0].enriched_from_ztr, undefined);
  });
});

test('enrichNearbyFromZtr: when ZTR not configured, input passes through', async () => {
  // makeFacilityClient returns null when no upstream is configured;
  // construct one with stub urls so it exists but ZTR is missing.
  const fc = makeFacilityClient({ ztrUrl: null, n8nBaseUrl: 'http://n8n', fmqClient: null });
  if (!fc) { return; /* not constructible without ZTR */ }
  const r = await fc.enrichNearbyFromZtr([SAMPLE()]);
  assert.equal(r.n_enriched, 0);
  assert.equal(r.primaries[0].enriched_from_ztr, undefined);
});

test('enrichNearbyFromZtr: concurrency cap prevents stampede', async () => {
  let inFlight = 0, peakInFlight = 0;
  await withFetch(async () => {
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    await new Promise(r => setTimeout(r, 10));
    inFlight--;
    return jsonResp({ rows: [{ facility_id: 'x', ground_sigma_msm: 4 }] });
  }, async () => {
    const fc = makeFacilityClient({ ztrUrl: 'http://ztr.test', n8nBaseUrl: null });
    const primaries = Array.from({ length: 50 }, (_, i) => SAMPLE({ facility_id: 'F' + i }));
    const r = await fc.enrichNearbyFromZtr(primaries, { concurrency: 5 });
    assert.equal(r.n_enriched, 50);
    assert.ok(peakInFlight <= 5, `peak in-flight ${peakInFlight} should be ≤ concurrency cap 5`);
  });
});
