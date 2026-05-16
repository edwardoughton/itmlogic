// 47 CFR §74.1204 nearby-primaries proximity search tests.
//
// Covers:
//   - fccFmqClient.searchByFrequencyRange — narrow-band FMQ query
//   - facilityClient.getNearbyPrimaries — channel-relationship search +
//     Vincenty distance filter, plumbed onto evidence.nearby_primaries
//
// All upstreams are stubbed.  No real geo.fcc.gov / transition.fcc.gov
// traffic is generated.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeFccFmqClient } from '../evidence/fccFmqClient.js';
import { makeFacilityClient } from '../api/services/facilityClient.js';

// One-row FMQ response factory — produces a realistic pipe-delimited
// row at the requested frequency / coordinates / class.
function fmqRow({ call, freq, klass = 'A', erp = 6.0, haat = 100, lat = 37.0902, lon = -95.7129, facility_id = '99999' }){
  // FMQ DMS encoding: split decimal degrees back into d, m, s.
  const toDms = v => {
    const a = Math.abs(v);
    const d = Math.floor(a);
    const mFloat = (a - d) * 60;
    const m = Math.floor(mFloat);
    const s = +((mFloat - m) * 60).toFixed(1);
    return { d, m, s };
  };
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  const la = toDms(lat), lo = toDms(lon);
  const haatField = haat == null ? '0.0' : String(haat.toFixed(1));
  // 27 columns + leading/trailing pipes.  Layout matches the existing
  // fccFmq.test.js fixtures exactly.
  return `|${pad(call,12)}|${pad(String(freq).padStart(5)+'  MHz',9)} |FM |${pad('227',3)} |ND  |H                   |${pad(klass,3)}|-  |LIC    |${pad('TESTCITY',25)}|XX |US |BL-test             |${pad(String(erp.toFixed(1))+'   kW',9)} |${pad(String(erp.toFixed(1))+'   kW',9)} |${pad(haatField,8)}|${pad(haatField,8)}|${pad(facility_id,11)}|${ns} |${pad(String(la.d),2)} |${pad(String(la.m),2)} |${pad(la.s.toFixed(1),5)} |${ew} |${pad(String(lo.d),3)} |${pad(String(lo.m),2)} |${pad(lo.s.toFixed(1),5)} |TEST LICENSEE                                                               |   0.00 km |   0.00 mi |  0.00 deg |${pad(haatField,5)}m|${pad(haatField,5)} m|-         |-       |1000000 |       m|test      |aaa |bbb   |`;
}
function pad(s, w){ s = String(s); return s.length >= w ? s : s + ' '.repeat(w - s.length); }

/* -------------------- searchByFrequencyRange -------------------- */

test('searchByFrequencyRange: returns rows on the requested frequency', async () => {
  let queriedUrl = null;
  const fetchFn = async (url) => {
    queriedUrl = url;
    return { ok: true, async text(){
      return [
        fmqRow({ call: 'WCO',  freq: '100.1', klass: 'A', facility_id: '111' }),
        fmqRow({ call: 'WALT', freq: '100.1', klass: 'C', facility_id: '222' })
      ].join('\n');
    }};
  };
  const c = makeFccFmqClient({ fetchFn });
  const r = await c.searchByFrequencyRange(100.1, 100.1);
  assert.equal(r.source, 'fcc-fmq');
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].frequency, 100.1);
  assert.match(queriedUrl, /lower_freq=100\.1/);
  assert.match(queriedUrl, /upper_freq=100\.1/);
  assert.match(queriedUrl, /list=4/);
});

test('searchByFrequencyRange: drops out-of-band requests without network call', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return { ok: true, async text(){ return ''; } }; };
  const c = makeFccFmqClient({ fetchFn });
  const r = await c.searchByFrequencyRange(77.5, 77.5);
  assert.equal(called, false, 'must not hit FMQ for out-of-band frequencies');
  assert.equal(r.rows.length, 0);
  assert.match(r.note, /outside FM band/);
});

test('searchByFrequencyRange: filters to allowed Genoa services', async () => {
  // FMQ row for an AM station won't appear in an FM-band parse, but
  // the service-allowlist still must be honored for FM/FX/LPFM mixes.
  const fetchFn = async () => ({ ok: true, async text(){
    return fmqRow({ call: 'WFM', freq: '100.1', facility_id: '111' });
  }});
  const c = makeFccFmqClient({ fetchFn });
  const r = await c.searchByFrequencyRange(100.1, 100.1, { services: 'FX' });
  assert.equal(r.rows.length, 0, 'FM rows must drop when only FX is allowed');
});

test('searchByFrequencyRange: HTTP error surfaces structured error', async () => {
  const fetchFn = async () => ({ ok: false, status: 503 });
  const c = makeFccFmqClient({ fetchFn });
  const r = await c.searchByFrequencyRange(100.1, 100.1);
  assert.equal(r.rows.length, 0);
  assert.match(r.error, /HTTP 503/);
});

/* -------------------- getNearbyPrimaries -------------------- */

test('getNearbyPrimaries: finds a co-channel station within radius', async () => {
  // Translator at 100.1 in Kansas (37.0902, -95.7129).
  // Primary at 100.1 about ~30 km north.
  const fetchFn = async (url) => ({ ok: true, async text(){
    if (/lower_freq=100\.1&upper_freq=100\.1/.test(url)){
      return fmqRow({ call: 'WCO', freq: '100.1', klass: 'A', erp: 6.0, haat: 100,
                      lat: 37.36, lon: -95.7129, facility_id: '111' });
    }
    return '';
  }});
  const f = makeFacilityClient({
    ztrUrl: null, n8nBaseUrl: null,
    fmqClient: makeFccFmqClient({ fetchFn })
  });
  const r = await f.getNearbyPrimaries({
    lat: 37.0902, lon: -95.7129, frequency_mhz: 100.1, radius_km: 100
  });
  assert.equal(r.available, true);
  assert.equal(r.source, 'fcc-fmq');
  assert.equal(r.n_in_radius, 1);
  assert.equal(r.primaries[0].call, 'WCO');
  assert.equal(r.primaries[0].channel_relationship, 'cochannel');
  assert.ok(r.primaries[0].distance_km < 100);
  assert.ok(r.primaries[0].distance_km > 25);
});

test('getNearbyPrimaries: drops stations outside the radius', async () => {
  const fetchFn = async () => ({ ok: true, async text(){
    // Same channel but ~1500 km away.
    return fmqRow({ call: 'WFAR', freq: '100.1', lat: 50.0, lon: -110.0, facility_id: '222' });
  }});
  const f = makeFacilityClient({
    ztrUrl: null, n8nBaseUrl: null,
    fmqClient: makeFccFmqClient({ fetchFn })
  });
  const r = await f.getNearbyPrimaries({
    lat: 37.0902, lon: -95.7129, frequency_mhz: 100.1, radius_km: 300
  });
  assert.equal(r.n_in_radius, 0);
});

test('getNearbyPrimaries: classifies channel relationships across all §74.1204 offsets', async () => {
  // One row at every restricted offset.  All within radius.
  const fetchFn = async (url) => {
    const m = url.match(/lower_freq=([\d.]+)/);
    if (!m) return { ok: true, async text(){ return ''; } };
    const f = parseFloat(m[1]);
    return { ok: true, async text(){
      return fmqRow({
        call:        `W${String(f).replace('.','')}`,
        freq:        f.toFixed(1),
        lat:         37.10, lon: -95.72,
        facility_id: String(Math.round(f * 10))
      });
    }};
  };
  const f = makeFacilityClient({
    ztrUrl: null, n8nBaseUrl: null,
    fmqClient: makeFccFmqClient({ fetchFn })
  });
  const r = await f.getNearbyPrimaries({
    lat: 37.0902, lon: -95.7129, frequency_mhz: 100.1, radius_km: 100
  });
  const rels = new Set(r.primaries.map(p => p.channel_relationship));
  assert.ok(rels.has('cochannel'));
  assert.ok(rels.has('first_adjacent'));
  assert.ok(rels.has('second_adjacent'));
  assert.ok(rels.has('third_adjacent'));
  assert.ok(rels.has('if_offset'));
});

test('getNearbyPrimaries: excludes self by facility_id', async () => {
  const fetchFn = async () => ({ ok: true, async text(){
    return fmqRow({ call: 'WSELF', freq: '100.1', lat: 37.10, lon: -95.72, facility_id: '99999' });
  }});
  const f = makeFacilityClient({
    ztrUrl: null, n8nBaseUrl: null,
    fmqClient: makeFccFmqClient({ fetchFn })
  });
  const r = await f.getNearbyPrimaries({
    lat: 37.0902, lon: -95.7129, frequency_mhz: 100.1, radius_km: 100,
    exclude_facility_id: '99999'
  });
  assert.equal(r.n_in_radius, 0, 'self must be excluded from nearby_primaries');
});

test('getNearbyPrimaries: missing inputs return structured failure (no fabrication)', async () => {
  const f = makeFacilityClient({
    ztrUrl: null, n8nBaseUrl: null,
    fmqClient: makeFccFmqClient({ fetchFn: async () => ({ ok: true, async text(){ return ''; } }) })
  });
  const r = await f.getNearbyPrimaries({ lat: null, lon: null, frequency_mhz: 100.1 });
  assert.equal(r.available, false);
  assert.match(r.error, /lat, lon, and frequency_mhz required/);
});

test('getNearbyPrimaries: FMQ disabled returns structured unavailable', async () => {
  const f = makeFacilityClient({ ztrUrl: null, n8nBaseUrl: null, fmqClient: null });
  // Even though fmqClient is null, makeFacilityClient returns null when
  // every source is missing.  Construct one with a stub ZTR url so the
  // adapter exists but FMQ is off.
  const f2 = makeFacilityClient({ ztrUrl: 'http://stub', n8nBaseUrl: null, fmqClient: null });
  const r = await f2.getNearbyPrimaries({
    lat: 37.0902, lon: -95.7129, frequency_mhz: 100.1
  });
  assert.equal(r.available, false);
  assert.match(r.error, /FCC FMQ client unavailable/);
});

/* -------------------- end-to-end: FX exhibit gets a real D/U study -------------------- */

test('FX exhibit: nearby_primaries plumbs into engine and runs §74.1204 D/U study', async () => {
  const { compute } = await import('../engine/index.js');
  const { runValidationSuite } = await import('../engine/validation/runner.js');
  const validationRun = await runValidationSuite();

  // Co-channel Class A primary 80 km away — translator should pass at this distance.
  const x = await compute({
    inputs: {
      call: 'W250FX', facility_id: '60002',
      service: 'FX', fcc_class: 'D',
      frequency: 100.1, erp_kw: 0.25, haat_m: 30,
      lat: 37.0902, lon: -95.7129,
      radial_step_deg: 30
    },
    evidence: {
      nearby_primaries: [{
        call:           'WDISTANT', facility_id: '99',
        fcc_class:      'A',
        frequency_mhz:  100.1,
        erp_kw:         6.0, haat_m: 100,
        lat:            37.79, lon: -95.7129     // ~78 km north
      }]
    },
    options: {
      validation: { runs: [validationRun], reference_cases_present: validationRun.reference_cases_present }
    }
  });
  assert.equal(x.regulatory_compliance.cite, '47 CFR §74.1204');
  assert.equal(x.regulatory_compliance.studies.length, 1);
  // Either pass or fail — but must NOT be MISSING_NEARBY_STATIONS.
  assert.ok(!x.regulatory_compliance.missing_nearby_stations,
    'with nearby_primaries supplied, study must run end-to-end');
  assert.ok(!x.warnings.find(w => w.code === 'MISSING_NEARBY_STATIONS'),
    'MISSING_NEARBY_STATIONS must not fire when primaries are attached');
});
