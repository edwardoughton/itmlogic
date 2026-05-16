// 47 CFR §73.525 TV ch.6 / FM reserved-band protection tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkSection73525,
  section73525DuGateDb,
  frequencyToFmChannel,
  TV_CH6_GRADE_B_DBU,
  SECTION_73_525_PROVENANCE
} from '../engine/regulatory/section_73_525.js';

const RESERVED_BAND_FM = {
  call: 'KEDU-FM', facility_id: 'subject-edu',
  fcc_class: 'A', frequency_mhz: 88.5,            // ch.203 — D/U gate -45 dB
  erp_kw: 1.0, haat_m: 60,
  lat: 40.0, lon: -100.0
};

function ch6Station({ lat = 41.5, lon = -100.0, call = 'WCH6-LD',
                       facility_id = 'tv-ch6-1', fcc_class = 'LD',
                       erp_kw = 50, haat_m = 200 } = {}){
  return { call, facility_id, fcc_class, erp_kw, haat_m, lat, lon, frequency_mhz: 83.25 };
}

/* ---------- channel mapping + gates ---------- */

test('frequencyToFmChannel: 87.9 → 200, 88.1 → 201, 91.9 → 220', () => {
  assert.equal(frequencyToFmChannel(87.9), 200);
  assert.equal(frequencyToFmChannel(88.1), 201);
  assert.equal(frequencyToFmChannel(88.5), 203);
  assert.equal(frequencyToFmChannel(91.9), 220);
  assert.equal(frequencyToFmChannel(92.1), 221);   // outside reserved band but valid FM channel
});

test('section73525DuGateDb: -45 / -55 / -65 / -75 across the reserved-band sub-bands', () => {
  // FM channel grid: ch.200 = 87.9 MHz, step 0.2 MHz.
  //   ch.201 = 88.1, ch.215 = 90.9, ch.216 = 91.1, ch.220 = 91.9
  assert.equal(section73525DuGateDb(88.1), -45);   // ch.201
  assert.equal(section73525DuGateDb(88.5), -45);   // ch.203
  assert.equal(section73525DuGateDb(88.7), -55);   // ch.204
  assert.equal(section73525DuGateDb(89.3), -55);   // ch.207
  assert.equal(section73525DuGateDb(89.5), -65);   // ch.208
  assert.equal(section73525DuGateDb(90.9), -65);   // ch.215
  assert.equal(section73525DuGateDb(91.1), -75);   // ch.216
  assert.equal(section73525DuGateDb(91.9), -75);   // ch.220
});

test('section73525DuGateDb: outside reserved band returns null', () => {
  assert.equal(section73525DuGateDb(87.9),  null);    // ch.200 (below reserved subset)
  assert.equal(section73525DuGateDb(92.1),  null);    // commercial band
  assert.equal(section73525DuGateDb(100.7), null);
});

/* ---------- study guards ---------- */

test('§73.525: missing subject returns guard violation', () => {
  const r = checkSection73525({ subject: null, tvCh6Stations: [ch6Station()] });
  assert.equal(r.applicable, false);
  assert.equal(r.pass, false);
  assert.equal(r.cite, '47 CFR §73.525');
  assert.match(r.violations[0].message, /Subject FM station inputs missing/);
});

test('§73.525: FM outside reserved band → applicable=false, pass=true, study skipped', () => {
  const r = checkSection73525({
    subject: { ...RESERVED_BAND_FM, frequency_mhz: 100.7 },
    tvCh6Stations: [ch6Station()]
  });
  assert.equal(r.applicable, false);
  assert.equal(r.pass, true);
  assert.match(r.notes.join(' '), /not in the §73\.525 reserved-band/);
});

test('§73.525: empty ch.6 list pass=true with missing_ch6_stations hint', () => {
  const r = checkSection73525({ subject: RESERVED_BAND_FM, tvCh6Stations: [] });
  assert.equal(r.applicable, true);
  assert.equal(r.pass, true);
  assert.equal(r.missing_ch6_stations, true);
  assert.match(r.notes.join(' '), /No active TV channel 6 stations supplied/);
});

/* ---------- pair-wise pass / fail ---------- */

test('§73.525: well-spaced ch.6 (300 km away) passes', () => {
  const ch6 = ch6Station({ lat: 42.7, lon: -100.0 });           // ~ 300 km north
  const r = checkSection73525({ subject: RESERVED_BAND_FM, tvCh6Stations: [ch6] });
  assert.equal(r.studies.length, 1);
  assert.equal(r.studies[0].pair_pass, true);
  assert.equal(r.studies[0].du_gate_db, -45);
  assert.equal(r.studies[0].ch6_protected_field_dbu, TV_CH6_GRADE_B_DBU);
});

test('§73.525: D/U gate is more stringent for the lowest channels (88.1-88.5)', () => {
  // Same geometry but at different reserved-band frequencies — gate
  // should differ.  ch.203 (88.5 MHz) gets -45 dB; ch.220 (91.9 MHz) gets -75 dB.
  const ch6 = ch6Station({ lat: 41.5 });
  const lo = checkSection73525({
    subject: { ...RESERVED_BAND_FM, frequency_mhz: 88.5 },
    tvCh6Stations: [ch6]
  });
  const hi = checkSection73525({
    subject: { ...RESERVED_BAND_FM, frequency_mhz: 91.9 },
    tvCh6Stations: [ch6]
  });
  assert.equal(lo.du_gate_db, -45);
  assert.equal(hi.du_gate_db, -75);
});

test('§73.525: study reports fm_channel and ch6 protected field', () => {
  const r = checkSection73525({ subject: RESERVED_BAND_FM, tvCh6Stations: [ch6Station()] });
  assert.equal(r.fm_channel, 203);
  assert.equal(r.ch6_protected_field_dbu, 47);
  assert.equal(r.studies[0].ch6_protected_field_dbu, 47);
});

test('§73.525: cite + method + provenance', () => {
  const r = checkSection73525({ subject: RESERVED_BAND_FM, tvCh6Stations: [ch6Station()] });
  assert.equal(r.cite, '47 CFR §73.525');
  assert.match(r.method, /F\(50,10\) ↔ §73\.683 Grade B/);
});

test('SECTION_73_525_PROVENANCE names §73.525, §73.683, ch.6 status, license', () => {
  assert.match(SECTION_73_525_PROVENANCE.regulation, /73\.525/);
  assert.ok(SECTION_73_525_PROVENANCE.related_regulations.some(r => /73\.683/.test(r)));
  assert.equal(SECTION_73_525_PROVENANCE.ch6_protected_field_dbu, 47);
  assert.match(SECTION_73_525_PROVENANCE.post_dtv_status, /DTV transition/);
  assert.match(SECTION_73_525_PROVENANCE.license_basis, /17 U\.S\.C\. § 105/);
});
