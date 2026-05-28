import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nighttimeNifStudy,
  normalizePrimary
} from '../engine/am/nightOrchestrator.js';

// Same crude FCCAM fake the per-azimuth NIF tests use.
function makeFakeFccam(){
  return {
    runBatch: async (requests) => ({
      available: true, source: 'fccam',
      n_requests: requests.length,
      n_ok:       requests.length,
      n_failed:   0,
      results:    requests.map((req) => ({
        ok: true, engine: 'fccam',
        field_uv_m: (1000 * Math.sqrt(req.erp_kw)) / Math.max(1, req.distance_km),
        input_sha256: 'a'.repeat(64),
        inputs: req
      }))
    })
  };
}

function makeFakeFacility(primaries, opts = {}){
  return {
    getNearbyPrimaries: async (_args) => ({
      available: opts.available !== false,
      source:    opts.source || 'fcc-amq',
      primaries: primaries || []
    })
  };
}

const PROPOSED_VALID = {
  lat: 40.0, lon: -75.0,
  freq_khz: 700, erp_kw: 50,
  fcc_class: 'B',
  pattern_mode: 'omni'
};

/* ---------- normalizePrimary ---------- */

test('normalizePrimary: maps LMS row → solver shape; normalizes "cochannel"', () => {
  const row = {
    facility_id: 9001, call: 'WTST', fcc_class: 'B',
    lat: 41.5, lon: -76.2,
    frequency_khz: 700, erp_kw: 25,
    channel_relationship: 'cochannel',
    distance_km: 120.5,
    source: 'fcc-amq'
  };
  const r = normalizePrimary(row);
  assert.equal(r.relation, 'co_channel');
  assert.equal(r.call, 'WTST');
  assert.equal(r.fcc_class, 'B');
  assert.equal(r.freq_khz, 700);
  assert.equal(r.erp_kw, 25);
  assert.equal(r.distance_km, 120.5);
});

test('normalizePrimary: rejects out-of-band freq', () => {
  assert.equal(normalizePrimary({
    lat: 41.5, lon: -76.2, frequency_khz: 89, erp_kw: 25
  }), null);
});

test('normalizePrimary: rejects missing geometry', () => {
  assert.equal(normalizePrimary({
    lat: null, lon: -76.2, frequency_khz: 700, erp_kw: 25
  }), null);
});

test('normalizePrimary: rejects non-positive erp', () => {
  assert.equal(normalizePrimary({
    lat: 41.5, lon: -76.2, frequency_khz: 700, erp_kw: 0
  }), null);
  assert.equal(normalizePrimary({
    lat: 41.5, lon: -76.2, frequency_khz: 700, erp_kw: -1
  }), null);
});

/* ---------- nighttimeNifStudy guards ---------- */

test('nighttimeNifStudy: refuses without FCCAM client', async () => {
  const r = await nighttimeNifStudy(
    { proposed: PROPOSED_VALID },
    { fccamClient: null, facilityClient: makeFakeFacility([]) }
  );
  assert.equal(r.available, false);
  assert.match(r.error, /FCCAM/);
});

test('nighttimeNifStudy: refuses incomplete proposed station', async () => {
  const incomplete = { lat: 40.0, lon: -75.0, freq_khz: 700, erp_kw: 50 };  // missing fcc_class
  const r = await nighttimeNifStudy(
    { proposed: incomplete },
    { fccamClient: makeFakeFccam(), facilityClient: makeFakeFacility([]) }
  );
  assert.equal(r.available, false);
  assert.match(r.error, /fcc_class/);
});

test('nighttimeNifStudy: refuses out-of-band freq on proposed', async () => {
  const r = await nighttimeNifStudy(
    { proposed: { ...PROPOSED_VALID, freq_khz: 89 } },
    { fccamClient: makeFakeFccam(), facilityClient: makeFakeFacility([]) }
  );
  assert.equal(r.available, false);
  assert.match(r.error, /AM-band|freq_khz/);
});

test('nighttimeNifStudy: surfaces facilityClient error explicitly', async () => {
  const r = await nighttimeNifStudy(
    { proposed: PROPOSED_VALID },
    {
      fccamClient: makeFakeFccam(),
      facilityClient: makeFakeFacility([], { available: false })
    }
  );
  assert.equal(r.available, false);
});

/* ---------- end-to-end happy path ---------- */

test('nighttimeNifStudy: produces a closed-polygon contour + summary stats', async () => {
  const primaries = [{
    facility_id: 9001, call: 'WXYZ', fcc_class: 'B',
    lat: 40.0, lon: -82.0,
    frequency_khz: 700, erp_kw: 50,
    channel_relationship: 'cochannel',
    distance_km: 600
  }];
  const r = await nighttimeNifStudy(
    {
      proposed: PROPOSED_VALID,
      options:  { azimuths_deg: [0, 90, 180, 270] }
    },
    {
      fccamClient: makeFakeFccam(),
      facilityClient: makeFakeFacility(primaries)
    }
  );
  assert.equal(r.available, true, JSON.stringify(r));
  // 4 azimuths → 5 vertices closed polygon.
  assert.equal(r.polygon.length, 5);
  assert.equal(r.contour.length, 4);
  assert.equal(r.interferers.length, 1);
  assert.equal(r.interferers[0].call, 'WXYZ');
  assert.equal(r.summary.n_azimuths, 4);
  assert.ok(Number.isFinite(r.summary.mean_radius_km));
  assert.ok(r.summary.mean_radius_km > 0);
  assert.equal(r.summary.n_interferers_used, 1);
});

test('nighttimeNifStudy: max_interferers cap surfaces cap_applied flag', async () => {
  // 10 primaries; cap at 3.
  const primaries = Array.from({ length: 10 }, (_, i) => ({
    facility_id: 100 + i, call: `W${i}`, fcc_class: 'B',
    lat: 40.0, lon: -75.5 - i * 0.5,
    frequency_khz: 700, erp_kw: 5,
    channel_relationship: 'cochannel',
    distance_km: 50 + i * 30
  }));
  const r = await nighttimeNifStudy(
    {
      proposed: PROPOSED_VALID,
      options:  { azimuths_deg: [0, 180], max_interferers: 3 }
    },
    {
      fccamClient: makeFakeFccam(),
      facilityClient: makeFakeFacility(primaries)
    }
  );
  assert.equal(r.available, true);
  assert.equal(r.interferers.length, 3);
  assert.equal(r.summary.n_interferers_used, 3);
  assert.equal(r.summary.n_interferers_seen, 10);
  assert.equal(r.interferer_cap_applied, true);
});

test('nighttimeNifStudy: omits DA pattern_table when pattern_mode is omni', async () => {
  const proposed = { ...PROPOSED_VALID,
    pattern_mode: 'omni',
    pattern_table: { 0: 1.0, 180: 0.01 }   // ignored because mode is omni
  };
  const r = await nighttimeNifStudy(
    {
      proposed,
      options: { azimuths_deg: [0, 180] }
    },
    {
      fccamClient: makeFakeFccam(),
      facilityClient: makeFakeFacility([{
        facility_id: 9, call: 'W', fcc_class: 'B',
        lat: 40, lon: -82, frequency_khz: 700, erp_kw: 50,
        channel_relationship: 'cochannel', distance_km: 600
      }])
    }
  );
  assert.equal(r.available, true);
  // The two radii should be similar to each other since DA was ignored.
  const byAz = Object.fromEntries(r.contour.map((p) => [p.azimuth_deg, p.distance_km]));
  // Note: with the fake FCCAM, fields are isotropic — both directions
  // should give nearly identical radii (within ~rounding).
  const delta = Math.abs(byAz[0] - byAz[180]);
  assert.ok(delta < byAz[0] * 0.6,
    `DA pattern_table should have been ignored; got az0=${byAz[0]} az180=${byAz[180]}`);
});
