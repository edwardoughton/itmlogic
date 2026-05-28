// FCC FMQ / AMQ pipe-delim parser tests.
//
// All upstreams are stubbed — no network is touched.  The point is to
// prove the parser correctly extracts frequency, ERP, HAAT, FCC class,
// facility_id, lat/lon (DMS → decimal), and licensee from the live
// transition.fcc.gov format, AND that the search adapter dedupes
// per-facility rows.

import test from 'node:test';
import assert from 'node:assert/strict';

import { makeFccFmqClient, parseRow } from '../evidence/fccFmqClient.js';

// Real FMQ row for KDKB (Mesa, AZ Class C, facility 41299).
const KDKB_FM_LINE =
  '|KDKB        |93.3  MHz |FM |227 |ND  |H                   |C  |-  |LIC    |MESA                     |AZ |US |BLH-20101116AIX     |100.   kW |100.   kW |508.0   |508.0   |41299      |N |33 |20 |1.0   |W |112 |3  |46.9  |PHOENIX FCC LICENSE SUB, LLC                                                |   0.00 km |   0.00 mi |  0.00 deg |871.   m|871.0  m|-         |-       |1002069 |       m|201011161 |aaa |bbb   |';

// Real AMQ row for WBZ (Boston, 1030 kHz, Class A, facility 25444).
const WBZ_AM_LINE =
  '|WBZ         |1030  kHz |AM |    |UNL |Unlimited           |A  |A  |LIC    |BOSTON                   |MA |US |BL-19790525AI          |50.0   kW |Directional|H       |-       |25444      |N |42 |16 |44.4  |W |70  |52 |32.2  |IHM LICENSES, LLC                                                           |   0.00 km |   0.00 mi |  0.00 deg |10513     |aaa |bbb   |';

// Translator (FX) row for K254CR.
const K254CR_LINE =
  '|K254CR      |98.7  MHz |FX |254 |DA  |                    |D  |-  |LIC    |ST. LOUIS                |MO |US |BLFT-20160914AAX    |0.25   kW |0.25   kW |0.0     |0.0     |138424     |N |38 |36 |47.2  |W |90  |20 |9.4   |AUDACY LICENSE, LLC                                                         |   0.00 km |   0.00 mi |  0.00 deg |303.   m|303.0  m|-         |150.    |1007729 |       m|201609146 |aaa |bbb   |';

test('parseRow extracts an FM (Class C) station correctly', () => {
  const r = parseRow(KDKB_FM_LINE, false, 'https://transition.fcc.gov/fcc-bin/fmq');
  assert.ok(r);
  assert.equal(r.call,           'KDKB');
  assert.equal(r.service,        'FM');
  assert.equal(r.fcc_class,      'C');
  assert.equal(r.facility_id,    '41299');
  assert.equal(r.frequency,      93.3);
  assert.equal(r.frequency_unit, 'MHz');
  assert.equal(r.erp_kw,         100);
  assert.equal(r.haat_m,         508);
  assert.equal(r.city,           'MESA');
  assert.equal(r.state,          'AZ');
  assert.equal(r.licensee,       'PHOENIX FCC LICENSE SUB, LLC');
  // 33° 20' 1.0" N → 33.333611°
  assert.ok(Math.abs(r.lat - (33 + 20/60 + 1.0/3600)) < 1e-9);
  // 112° 3' 46.9" W → -112.062972°
  assert.ok(Math.abs(r.lon - -(112 + 3/60 + 46.9/3600)) < 1e-9);
  assert.equal(r.facility_lookup_source.upstream, 'fcc-fmq');
});

test('parseRow extracts an AM station (HAAT not applicable)', () => {
  const r = parseRow(WBZ_AM_LINE, true, 'https://transition.fcc.gov/fcc-bin/amq');
  assert.ok(r);
  assert.equal(r.call,           'WBZ');
  assert.equal(r.service,        'AM');
  assert.equal(r.fcc_class,      'A');
  assert.equal(r.facility_id,    '25444');
  assert.equal(r.frequency,      1030);
  assert.equal(r.frequency_unit, 'kHz');
  assert.equal(r.erp_kw,         50);
  assert.equal(r.haat_m,         null, 'AM groundwave does not have HAAT');
  assert.equal(r.city,           'BOSTON');
  assert.equal(r.state,          'MA');
  assert.equal(r.facility_lookup_source.upstream, 'fcc-amq');
});

test('parseRow extracts an FM translator (FX, Class D)', () => {
  const r = parseRow(K254CR_LINE, false, 'https://transition.fcc.gov/fcc-bin/fmq');
  assert.ok(r);
  assert.equal(r.call,           'K254CR');
  assert.equal(r.service,        'FX');
  assert.equal(r.fcc_class,      'D');
  assert.equal(r.facility_id,    '138424');
  assert.equal(r.frequency,      98.7);
  assert.equal(r.erp_kw,         0.25);
  assert.equal(r.haat_m,         0);
});

test('parseRow returns null on garbage / malformed lines', () => {
  assert.equal(parseRow('',                false, ''), null);
  assert.equal(parseRow('not a row',       false, ''), null);
  assert.equal(parseRow('| |',             false, ''), null);
  assert.equal(parseRow('|XYZ|junk|',      false, ''), null);
});

test('parseRow rejects non-active records (not LIC / CP)', () => {
  // Replace the LIC marker with CANCEL.
  const bad = KDKB_FM_LINE.replace('|LIC    |', '|CANCEL |');
  assert.equal(parseRow(bad, false, ''), null);
});

test('makeFccFmqClient: searchByCallsign hits both FMQ and AMQ in parallel and dedupes', async () => {
  const calls = [];
  const fetchFn = async (url) => {
    calls.push(url);
    if (url.includes('/fmq')){
      // FMQ returns two license actions for the same KDKB facility —
      // the dedupe key (call|service|facility_id) should collapse them.
      return {
        ok: true,
        async text(){ return KDKB_FM_LINE + '\n' + KDKB_FM_LINE.replace('LIC', 'CP '); }
      };
    }
    if (url.includes('/amq')){
      return { ok: true, async text(){ return ''; } };
    }
    throw new Error('unexpected url ' + url);
  };
  const c = makeFccFmqClient({ fetchFn });
  const r = await c.searchByCallsign('KDKB');
  assert.equal(r.source, 'fcc-fmq+amq');
  assert.equal(calls.length, 2, 'FMQ + AMQ called in parallel');
  assert.equal(r.rows.length, 1, 'duplicate license actions collapsed by facility_id');
  assert.equal(r.rows[0].call, 'KDKB');
  assert.equal(r.rows[0].facility_id, '41299');
});

test('makeFccFmqClient: both upstreams return empty -> 0 rows, source is set', async () => {
  const fetchFn = async () => ({ ok: true, async text(){ return ''; } });
  const c = makeFccFmqClient({ fetchFn });
  const r = await c.searchByCallsign('NOTHING');
  assert.equal(r.source, 'fcc-fmq+amq');
  assert.equal(r.count, 0);
  assert.deepEqual(r.rows, []);
});

test('makeFccFmqClient: short callsign rejected', async () => {
  const fetchFn = async () => { throw new Error('should not be called'); };
  const c = makeFccFmqClient({ fetchFn });
  const r = await c.searchByCallsign('K');
  assert.equal(r.source, null);
  assert.match(r.error, /at least 2 characters/);
});

test('makeFccFmqClient: FMQ HTTP error surfaces, AMQ result still flows', async () => {
  const fetchFn = async (url) => {
    if (url.includes('/fmq')) return { ok: false, status: 503, async text(){ return ''; } };
    if (url.includes('/amq')) return { ok: true,  async text(){ return WBZ_AM_LINE; } };
    throw new Error('unexpected ' + url);
  };
  const c = makeFccFmqClient({ fetchFn });
  const r = await c.searchByCallsign('WBZ');
  assert.equal(r.source, 'fcc-fmq+amq');
  assert.equal(r.count, 1);
  assert.equal(r.rows[0].call, 'WBZ');
  assert.equal(r.rows[0].service, 'AM');
});
