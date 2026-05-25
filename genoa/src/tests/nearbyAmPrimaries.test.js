// 47 CFR §73.187 / §73.190 nearby-AM-primaries proximity search tests.
//
// Covers the bug fixed by adding searchAmByFrequencyRangeKhz:
// searchByFrequencyRange was hardcoded to the FM band 88..108 MHz,
// so every AM lookup silently returned 0 rows and every AM exhibit's
// interference study evaluated 0 stations.  These tests pin the new
// AM path against the existing FM path.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeFccFmqClient } from '../evidence/fccFmqClient.js';
import { makeFacilityClient } from '../api/services/facilityClient.js';

// AMQ-shape row factory.  Mirror of the FM helper in
// nearbyPrimaries.test.js but with "1240  kHz" frequency, "AM" kind,
// and HAAT=null (AM doesn't carry HAAT in AMQ).
function amqRow({ call, freqKhz, klass = 'C', erpKw = 1.0,
                  lat = 37.0902, lon = -95.7129, facility_id = '99999' }){
  const toDms = (v) => {
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
  // 27-column pipe-delimited row matching parseRow's expectations.
  // Live AMQ sample for reference:
  //   |WMGJ |1240  kHz |AM |    |UNL |Unlimited |C  |C  |LIC |GADSDEN
  //     |AL |US |BL-19850905AJ |1.0    kW | … |21817 |N |34 |0 |4.4
  //     |W |86 |1 |47.9 |FLOYD L. DONALD BROADCAST
  return `|${pad(call,12)}|${pad(String(freqKhz)+'  kHz',9)} |AM |${pad('',3)} |UNL |Unlimited           |${pad(klass,3)}|${pad(klass,3)}|LIC    |${pad('TESTCITY',25)}|XX |US |BL-test             |${pad(String(erpKw.toFixed(1))+'   kW',9)} |${pad('',9)} |${pad('',8)}|${pad('-',8)}|${pad(facility_id,11)}|${ns} |${pad(String(la.d),2)} |${pad(String(la.m),2)} |${pad(la.s.toFixed(1),5)} |${ew} |${pad(String(lo.d),3)} |${pad(String(lo.m),2)} |${pad(lo.s.toFixed(1),5)} |TEST LICENSEE                                                               |   0.00 km |   0.00 mi |  0.00 deg |     |      |-         |-       |1000000 |       m|test      |aaa |bbb   |`;
}
function pad(s, w){ s = String(s); return s.length >= w ? s : s + ' '.repeat(w - s.length); }

/* -------------------- searchAmByFrequencyRangeKhz -------------------- */

test('searchAmByFrequencyRangeKhz: hits AMQ with kHz params + parses AM rows', async () => {
  let queriedUrl = null;
  const fetchFn = async (url) => {
    queriedUrl = url;
    return { ok: true, async text(){
      return [
        amqRow({ call: 'KRDM', freqKhz: 1240, klass: 'C', erpKw: 1.0,
                 lat: 44.277889, lon: -121.146694, facility_id: '129314' }),
        amqRow({ call: 'KLAV', freqKhz: 1240, klass: 'C', erpKw: 1.0,
                 lat: 36.17, lon: -115.14, facility_id: '54321' })
      ].join('\n');
    }};
  };
  const c = makeFccFmqClient({ fetchFn });
  const r = await c.searchAmByFrequencyRangeKhz(1240, 1240);
  assert.equal(r.source, 'fcc-amq');
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].service, 'AM');
  assert.equal(r.rows[0].frequency_unit, 'kHz');
  assert.equal(r.rows[0].frequency, 1240);
  assert.match(queriedUrl, /\/amq\?lower_freq=1240&upper_freq=1240&list=4/);
});

test('searchAmByFrequencyRangeKhz: no-ops outside AM band 530..1710 kHz', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return { ok: true, async text(){ return ''; } }; };
  const c = makeFccFmqClient({ fetchFn });
  const out = await c.searchAmByFrequencyRangeKhz(100, 100);
  assert.equal(called, false, 'must not hit AMQ for out-of-band kHz');
  assert.equal(out.rows.length, 0);
  assert.match(out.note, /outside AM band/);
});

test('searchAmByFrequencyRangeKhz: HTTP error surfaces structured error', async () => {
  const fetchFn = async () => ({ ok: false, status: 503 });
  const c = makeFccFmqClient({ fetchFn });
  const r = await c.searchAmByFrequencyRangeKhz(1240, 1240);
  assert.equal(r.rows.length, 0);
  assert.match(r.error, /HTTP 503 from AMQ/);
});

test('searchAmByFrequencyRangeKhz: invalid range returns structured error without fetching', async () => {
  let called = false;
  const fetchFn = async () => { called = true; return { ok: true, async text(){ return ''; } }; };
  const c = makeFccFmqClient({ fetchFn });
  const r = await c.searchAmByFrequencyRangeKhz('bad', 'numbers');
  assert.equal(called, false);
  assert.match(r.error, /invalid frequency range/);
});

/* -------------------- getNearbyPrimaries (AM path) -------------------- */

test('getNearbyPrimaries(AM): routes to AMQ kHz endpoint at ±10/20 kHz offsets', async () => {
  const seenUrls = [];
  const fetchFn = async (url) => {
    seenUrls.push(url);
    return { ok: true, async text(){
      // Return one co-channel AM at 1240 within ~100 km of KRDM
      // (Madras OR 44.28, -121.15).  Adjust station to 45.0, -120.0
      // for ~115 km separation — within the default 1500 km AM radius.
      if (/lower_freq=1240&upper_freq=1240/.test(url)){
        return amqRow({ call: 'KMTR', freqKhz: 1240, klass: 'C',
                        lat: 45.0, lon: -120.0, facility_id: '54321' });
      }
      return '';   // adjacent-channel queries return nothing
    }};
  };
  const fac = makeFacilityClient({
    ztrUrl:    'http://ztr.invalid',
    fmqClient: makeFccFmqClient({ fetchFn })
  });

  const r = await fac.getNearbyPrimaries({
    lat: 44.277889, lon: -121.146694,
    frequency_khz: 1240,
    service: 'AM',
    radius_km: 1500,
    exclude_facility_id: '129314'    // KRDM itself
  });

  assert.equal(r.available, true);
  assert.equal(r.source, 'fcc-amq');
  assert.match(r.upstream_api, /amq/);
  assert.equal(r.primaries.length, 1, 'one co-channel AM primary within radius');
  assert.equal(r.primaries[0].call, 'KMTR');
  assert.equal(r.primaries[0].frequency_khz, 1240);
  assert.equal(r.primaries[0].channel_relationship, 'cochannel');

  // Confirm the URL family: AMQ (not FMQ), kHz units, ±10/±20 kHz
  // queries for co + first/second adjacent.
  const amqHits = seenUrls.filter(u => /\/amq\?/.test(u));
  assert.ok(amqHits.length >= 1, 'must hit AMQ for AM path');
  const fmqHits = seenUrls.filter(u => /\/fmq\?/.test(u));
  assert.equal(fmqHits.length, 0, 'must NOT hit FMQ for AM path');
  // Co-channel (1240), first-adjacent (1230, 1250), second-adjacent (1220, 1260).
  for (const f of [1240, 1230, 1250, 1220, 1260]){
    assert.ok(
      seenUrls.some(u => u.includes(`lower_freq=${f}&upper_freq=${f}`)),
      `expected AMQ hit at ${f} kHz`
    );
  }
});

test('getNearbyPrimaries(AM): filters by radius_km via Karney inverse', async () => {
  const fetchFn = async (url) => ({ ok: true, async text(){
    if (/lower_freq=1240&upper_freq=1240/.test(url)){
      // Very far away — Florida.  Way beyond a 500 km radius.
      return amqRow({ call: 'WFLA', freqKhz: 1240, klass: 'C',
                      lat: 27.95, lon: -82.46, facility_id: '67890' });
    }
    return '';
  }});
  const fac = makeFacilityClient({
    ztrUrl:    'http://ztr.invalid',
    fmqClient: makeFccFmqClient({ fetchFn })
  });

  const r = await fac.getNearbyPrimaries({
    lat: 44.277889, lon: -121.146694,
    frequency_khz: 1240,
    service: 'AM',
    radius_km: 500       // tight enough to exclude Florida
  });

  assert.equal(r.primaries.length, 0, 'WFLA must be filtered out by radius');
});
