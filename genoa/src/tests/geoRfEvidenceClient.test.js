import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeGeoRfEvidenceClient,
  geoRfNotConfigured,
  GEO_RF_EVIDENCE_CLIENT_PROVENANCE
} from '../evidence/geoRfEvidenceClient.js';

/* ---------- construction ---------- */

test('makeGeoRfEvidenceClient: null when GEO_RF_EVIDENCE_SIDECAR_URL unset', () => {
  const orig = process.env.GEO_RF_EVIDENCE_SIDECAR_URL;
  delete process.env.GEO_RF_EVIDENCE_SIDECAR_URL;
  try {
    assert.equal(makeGeoRfEvidenceClient(), null);
  } finally {
    if (orig !== undefined) process.env.GEO_RF_EVIDENCE_SIDECAR_URL = orig;
  }
});

test('makeGeoRfEvidenceClient: hasToken reflects apiToken arg', () => {
  const c1 = makeGeoRfEvidenceClient({ baseUrl: 'http://x', apiToken: 'abc', fetchFn: async () => ({}) });
  const c2 = makeGeoRfEvidenceClient({ baseUrl: 'http://x', fetchFn: async () => ({}) });
  assert.equal(c1.hasToken, true);
  assert.equal(c2.hasToken, false);
});

/* ---------- not_configured envelope ---------- */

test('geoRfNotConfigured: returns advisory-only envelope with all dataset slots present', () => {
  const env = geoRfNotConfigured({ lat: 40, lon: -74, service: 'AM', call: 'WFAN', facility_id: '28617' });
  assert.equal(env.status, 'not_configured');
  assert.equal(env.advisory, true);
  assert.equal(env.filing_effect, 'none');
  assert.equal(env.inputs.call, 'WFAN');
  assert.ok(env.datasets.tree_canopy_conus);
  assert.ok(env.datasets.tau_rf_models);
  assert.ok(env.datasets.canada_landcover);
  assert.match(env.error, /unset/);
});

test('geoRfNotConfigured: tolerates null inputs', () => {
  const env = geoRfNotConfigured();
  assert.equal(env.status, 'not_configured');
  assert.equal(env.inputs.lat, null);
});

/* ---------- health ---------- */

const HEALTH_OK = {
  ok: true,
  service: 'genoa-geo-rf-evidence',
  datasets: { tree_canopy_conus: true, tau_rf_models: true, canada_landcover: true }
};

test('health: true on {ok:true}; false on non-ok body or network error', async () => {
  const ok    = makeGeoRfEvidenceClient({ baseUrl: 'http://x',
    fetchFn: async () => ({ ok: true, json: async () => HEALTH_OK }) });
  const notOk = makeGeoRfEvidenceClient({ baseUrl: 'http://x',
    fetchFn: async () => ({ ok: true, json: async () => ({ ok: false }) }) });
  const bad   = makeGeoRfEvidenceClient({ baseUrl: 'http://x',
    fetchFn: async () => { throw new Error('down'); } });
  assert.equal(await ok.health(),    true);
  assert.equal(await notOk.health(), false);
  assert.equal(await bad.health(),   false);
});

test('healthDetail: surfaces dataset map for the telemetry tile', async () => {
  const c = makeGeoRfEvidenceClient({ baseUrl: 'http://x',
    fetchFn: async () => ({ ok: true, json: async () => HEALTH_OK }) });
  const d = await c.healthDetail();
  assert.equal(d.ok, true);
  assert.equal(d.datasets.tree_canopy_conus, true);
});

/* ---------- sampleTreeCanopy ---------- */

test('sampleTreeCanopy: rejects non-finite lat/lon', async () => {
  const c = makeGeoRfEvidenceClient({ baseUrl: 'http://x', fetchFn: async () => ({}) });
  const r = await c.sampleTreeCanopy({ lat: NaN, lon: -74 });
  assert.equal(r.available, false);
  assert.match(r.error, /lat.*lon/);
});

const CANOPY_WFAN = {
  ok: true,
  dataset: 'science_tcc_CONUS_2022_v2023-5',
  lat: 40.859833, lon: -73.785417,
  value_raw: '35',
  stderr: '',
  advisory: true
};

const CANOPY_KAZM = {
  ok: true,
  dataset: 'science_tcc_CONUS_2022_v2023-5',
  lat: 34.860833, lon: -111.820278,
  value_raw: '14',
  stderr: '',
  advisory: true
};

test('sampleTreeCanopy: WFAN value_raw "35" → numeric 35, moderate canopy interpretation', async () => {
  const c = makeGeoRfEvidenceClient({ baseUrl: 'http://x',
    fetchFn: async () => ({ ok: true, json: async () => CANOPY_WFAN }) });
  const r = await c.sampleTreeCanopy({ lat: 40.859833, lon: -73.785417 });
  assert.equal(r.available, true);
  assert.equal(r.value_raw, '35');
  assert.equal(r.value_numeric, 35);
  assert.equal(r.dataset, 'science_tcc_CONUS_2022_v2023-5');
  assert.equal(r.advisory, true);
  assert.equal(r.interpretation, 'moderate canopy / vegetation context');
});

test('sampleTreeCanopy: empty value_raw "" → numeric null with "no coverage" interpretation (out-of-CONUS station)', async () => {
  // Canada / Mexico / HI / AK / PR stations are outside USFS TCC CONUS
  // coverage.  gdallocationinfo returns empty stdout in that case; we
  // MUST NOT coerce "" to numeric 0 — that would render as "0 (low
  // canopy / open ground)" which is wrong for an out-of-coverage point.
  const CANOPY_OUT_OF_CONUS = {
    ok: true,
    dataset: 'science_tcc_CONUS_2022_v2023-5',
    lat: 19.0, lon: -99.0,           // Mexico City
    value_raw: '',
    stderr: '',
    advisory: true
  };
  const c = makeGeoRfEvidenceClient({ baseUrl: 'http://x',
    fetchFn: async () => ({ ok: true, json: async () => CANOPY_OUT_OF_CONUS }) });
  const r = await c.sampleTreeCanopy({ lat: 19.0, lon: -99.0 });
  assert.equal(r.available, true);
  assert.equal(r.value_raw, '');
  assert.equal(r.value_numeric, null,
    'empty raster sample must NOT be coerced to numeric 0');
  assert.match(r.interpretation, /no coverage/i);
});

test('sampleTreeCanopy: KAZM value_raw "14" → numeric 14, sparse canopy', async () => {
  const c = makeGeoRfEvidenceClient({ baseUrl: 'http://x',
    fetchFn: async () => ({ ok: true, json: async () => CANOPY_KAZM }) });
  const r = await c.sampleTreeCanopy({ lat: 34.860833, lon: -111.820278 });
  assert.equal(r.value_numeric, 14);
  assert.equal(r.interpretation, 'sparse canopy');
});

test('sampleTreeCanopy: HTTP error surfaces with status, never throws', async () => {
  const c = makeGeoRfEvidenceClient({ baseUrl: 'http://x',
    fetchFn: async () => ({ ok: false, status: 503 }) });
  const r = await c.sampleTreeCanopy({ lat: 40, lon: -74 });
  assert.equal(r.available, false);
  assert.match(r.error, /HTTP 503/);
});

test('sampleTreeCanopy: network error surfaced inline', async () => {
  const c = makeGeoRfEvidenceClient({ baseUrl: 'http://x',
    fetchFn: async () => { throw new Error('econnrefused'); } });
  const r = await c.sampleTreeCanopy({ lat: 40, lon: -74 });
  assert.equal(r.available, false);
  assert.match(r.error, /econnrefused/);
});

test('sampleTreeCanopy: sidecar ok:false envelope is treated as failure', async () => {
  const c = makeGeoRfEvidenceClient({ baseUrl: 'http://x',
    fetchFn: async () => ({ ok: true, json: async () => ({ ok: false, error: 'raster missing' }) }) });
  const r = await c.sampleTreeCanopy({ lat: 40, lon: -74 });
  assert.equal(r.available, false);
  assert.match(r.error, /raster missing/);
});

/* ---------- sampleGeoRfEvidenceForFacility (composite) ---------- */

test('sampleGeoRfEvidenceForFacility: returns "run" envelope when canopy + health both succeed', async () => {
  // Multiple URLs hit: /healthz and /sample/tree-canopy.  Switch on URL.
  const fetchFn = async (url) => {
    if (String(url).includes('/healthz')){
      return { ok: true, json: async () => HEALTH_OK };
    }
    if (String(url).includes('/sample/tree-canopy')){
      return { ok: true, json: async () => CANOPY_WFAN };
    }
    return { ok: false, status: 404 };
  };
  const c = makeGeoRfEvidenceClient({ baseUrl: 'http://x', fetchFn });
  const e = await c.sampleGeoRfEvidenceForFacility({
    lat: 40.859833, lon: -73.785417, service: 'AM', call: 'WFAN', facility_id: '28617'
  });
  assert.equal(e.status, 'run');
  assert.equal(e.advisory, true);
  assert.equal(e.filing_effect, 'none');
  assert.equal(e.inputs.call, 'WFAN');
  assert.equal(e.datasets.tree_canopy_conus.available, true);
  assert.equal(e.datasets.tree_canopy_conus.value_numeric, 35);
  assert.equal(e.datasets.tau_rf_models.available, true);
  assert.equal(e.datasets.canada_landcover.available, true);
});

test('sampleGeoRfEvidenceForFacility: returns "failed" with coordinates_missing for null lat/lon', async () => {
  const c = makeGeoRfEvidenceClient({ baseUrl: 'http://x', fetchFn: async () => ({}) });
  const e = await c.sampleGeoRfEvidenceForFacility({ lat: null, lon: null, service: 'AM', call: 'WFAN' });
  assert.equal(e.status, 'failed');
  assert.equal(e.error,  'coordinates_missing');
  assert.equal(e.advisory, true);
  assert.equal(e.filing_effect, 'none');
});

test('sampleGeoRfEvidenceForFacility: returns "offline" when health probe fails AND canopy fails', async () => {
  const fetchFn = async () => { throw new Error('boom'); };
  const c = makeGeoRfEvidenceClient({ baseUrl: 'http://x', fetchFn });
  const e = await c.sampleGeoRfEvidenceForFacility({ lat: 40, lon: -74, service: 'AM' });
  assert.equal(e.status, 'offline');
  assert.equal(e.advisory, true);
  assert.equal(e.filing_effect, 'none');
});

/* ---------- contract invariants ---------- */

test('contract: evidence envelope never contains filing-controlling keys', () => {
  const env = geoRfNotConfigured({ lat: 40, lon: -74 });
  const forbidden = [
    'contour_distance_km',
    'protected_contour_uv_m',
    'allocation_result',
    'permitted_erp_kw',
    'filing_decision',
    'compliance_pass',
    'filing_ready'
  ];
  for (const k of forbidden){
    assert.equal(env[k], undefined, `envelope must not contain filing-controlling key "${k}"`);
  }
  assert.equal(env.filing_effect, 'none');
});

test('GEO_RF_EVIDENCE_CLIENT_PROVENANCE locks the advisory posture in code', () => {
  assert.match(GEO_RF_EVIDENCE_CLIENT_PROVENANCE.posture, /ADVISORY/);
  assert.match(GEO_RF_EVIDENCE_CLIENT_PROVENANCE.posture, /73\.184/);
  assert.match(GEO_RF_EVIDENCE_CLIENT_PROVENANCE.posture, /73\.182/);
});
