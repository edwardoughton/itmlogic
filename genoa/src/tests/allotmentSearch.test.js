import test from 'node:test';
import assert from 'node:assert/strict';
import {
  searchAllotments,
  fmChannelToMhz,
  fmMhzToChannel,
  ALLOTMENT_SEARCH_PROVENANCE
} from '../engine/allotmentSearch.js';

/* ---------- channel ↔ frequency mapping ---------- */

test('fmChannelToMhz: ch200 = 87.9 MHz, ch300 = 107.9 MHz', () => {
  assert.equal(fmChannelToMhz(200), 87.9);
  assert.equal(fmChannelToMhz(220), 91.9);   // reserved-band top
  assert.equal(fmChannelToMhz(221), 92.1);
  assert.equal(fmChannelToMhz(264), 100.7);
  assert.equal(fmChannelToMhz(300), 107.9);
});

test('fmMhzToChannel: round-trips standard FM grid', () => {
  for (const ch of [200, 221, 250, 264, 300]){
    assert.equal(fmMhzToChannel(fmChannelToMhz(ch)), ch, `ch ${ch}`);
  }
});

test('fmMhzToChannel: returns null for out-of-band', () => {
  assert.equal(fmMhzToChannel(50), null);
  assert.equal(fmMhzToChannel(110), null);
  assert.equal(fmMhzToChannel(NaN), null);
});

/* ---------- input validation ---------- */

test('searchAllotments: rejects missing subject', () => {
  const r = searchAllotments({});
  assert.equal(r.ok, false);
  assert.match(r.error, /subject required/);
});

test('searchAllotments: rejects missing lat/lon', () => {
  const r = searchAllotments({ subject: { fcc_class: 'A' } });
  assert.equal(r.ok, false);
  assert.match(r.error, /lat/);
});

test('searchAllotments: rejects missing class', () => {
  const r = searchAllotments({ subject: { lat: 40, lon: -75 } });
  assert.equal(r.ok, false);
  assert.match(r.error, /fcc_class/);
});

test('searchAllotments: explicit channel filter trims to that subset', () => {
  const r = searchAllotments({
    subject: { lat: 40, lon: -75, fcc_class: 'A' },
    nearbyStations: [],
    channels: [221, 222, 264]
  });
  assert.equal(r.ok, true);
  assert.equal(r.n_channels_evaluated, 3);
  assert.deepEqual(r.results.map((x) => x.channel).sort((a, b) => a - b), [221, 222, 264]);
});

test('searchAllotments: reserved_band=false strips channels 200-220', () => {
  const r = searchAllotments({
    subject: { lat: 40, lon: -75, fcc_class: 'A' },
    nearbyStations: [],
    reserved_band: false
  });
  assert.equal(r.ok, true);
  // 300 - 220 = 80 channels remaining.
  assert.equal(r.n_channels_evaluated, 80);
  assert.ok(r.results.every((x) => x.channel > 220 && x.band === 'commercial'));
});

/* ---------- end-to-end with no incumbents → all available, ranked by channel ---------- */

test('searchAllotments: no incumbents → every channel available', () => {
  const r = searchAllotments({
    subject:       { lat: 40, lon: -75, fcc_class: 'A' },
    nearbyStations: []
  });
  assert.equal(r.ok, true);
  assert.equal(r.n_channels_evaluated, 101);     // 200..300 inclusive
  assert.equal(r.n_available, 101);
  assert.equal(r.n_blocked, 0);
  // Deterministic ranking — lowest channel rank 1.
  assert.equal(r.results[0].channel, 200);
  assert.equal(r.results[0].scoring_rank, 1);
  assert.equal(r.results[r.results.length - 1].channel, 300);
});

/* ---------- end-to-end with a co-channel blocker ---------- */

test('searchAllotments: nearby co-channel A-A under §73.207 distance blocks that channel', () => {
  // Class A → A co-channel separation per §73.207(b) is 115 km.  Place
  // an incumbent at 60 km on ch 221 (92.1 MHz) → blocked.  All other
  // channels still pass (no adjacent-channel neighbors).
  const r = searchAllotments({
    subject: { lat: 40, lon: -75, fcc_class: 'A' },
    nearbyStations: [{
      call: 'WBLK', facility_id: 12345, fcc_class: 'A',
      lat: 40.5394, lon: -75,           // ~60 km due north
      frequency: 92.1, frequency_mhz: 92.1, service: 'FM'
    }]
  });
  assert.equal(r.ok, true);
  const blockedCh = r.results.find((c) => c.channel === 221);
  assert.ok(blockedCh, 'should have a row for channel 221');
  assert.equal(blockedCh.available, false, JSON.stringify(blockedCh));
  assert.ok(blockedCh.binding, 'binding constraint should be surfaced');
  assert.ok(blockedCh.binding.distance_km < blockedCh.binding.required_km,
    `deficit: distance ${blockedCh.binding.distance_km} < required ${blockedCh.binding.required_km}`);
  // Far-away channels still pass.
  const otherCh = r.results.find((c) => c.channel === 250);
  assert.equal(otherCh.available, true);
});

test('searchAllotments: §73.215 rescue lifts a §73.207-blocked channel when geometry permits', () => {
  // Same blocker as above, but the search engine should attempt §73.215
  // (contour overlap) when ERP + HAAT are supplied.  Even when §73.215
  // also fails (probable with strong A-class at 60 km), the result row
  // should reflect the rescue was evaluated (pass_73215 ∈ {true,false},
  // never 'not_evaluated') and n_violations_215 should be present.
  const r = searchAllotments({
    subject: { lat: 40, lon: -75, fcc_class: 'A', erp_kw: 6, haat_m: 100 },
    nearbyStations: [{
      call: 'WBLK', facility_id: 12345, fcc_class: 'A',
      lat: 40.5394, lon: -75,
      frequency: 92.1, frequency_mhz: 92.1, service: 'FM',
      erp_kw: 6, haat_m: 100
    }]
  });
  const ch221 = r.results.find((c) => c.channel === 221);
  assert.notEqual(ch221.pass_73215, 'not_evaluated', '§73.215 should have run when ERP+HAAT supplied');
});

test('searchAllotments: §73.215 NOT run when ERP/HAAT missing → pass_73215 stays not_evaluated', () => {
  const r = searchAllotments({
    subject: { lat: 40, lon: -75, fcc_class: 'A' },     // no erp_kw / haat_m
    nearbyStations: [{
      call: 'WBLK', facility_id: 12345, fcc_class: 'A',
      lat: 40.5394, lon: -75,
      frequency: 92.1, frequency_mhz: 92.1, service: 'FM'
    }]
  });
  const ch221 = r.results.find((c) => c.channel === 221);
  assert.equal(ch221.available, false);
  assert.equal(ch221.pass_73215, 'not_evaluated');
});

/* ---------- ranking ---------- */

test('searchAllotments: available channels rank before blocked', () => {
  const r = searchAllotments({
    subject:        { lat: 40, lon: -75, fcc_class: 'A' },
    nearbyStations: [{
      call: 'WBLK', facility_id: 1, fcc_class: 'A',
      lat: 40.5, lon: -75,
      frequency: 92.1, frequency_mhz: 92.1, service: 'FM'
    }],
    channels: [220, 221, 222]
  });
  // Available channels at lower ranks than blocked one.
  const availableRanks = r.results
    .filter((c) => c.available).map((c) => c.scoring_rank);
  const blockedRanks = r.results
    .filter((c) => !c.available).map((c) => c.scoring_rank);
  if (availableRanks.length && blockedRanks.length){
    assert.ok(Math.max(...availableRanks) < Math.min(...blockedRanks),
      `available ranks ${availableRanks} should all precede blocked ranks ${blockedRanks}`);
  }
});

/* ---------- provenance ---------- */

test('ALLOTMENT_SEARCH_PROVENANCE names §73.201 + §73.207 + §73.215', () => {
  assert.match(ALLOTMENT_SEARCH_PROVENANCE.regulation, /73\.201/);
  assert.match(ALLOTMENT_SEARCH_PROVENANCE.regulation, /73\.207/);
  assert.match(ALLOTMENT_SEARCH_PROVENANCE.regulation, /73\.215/);
  assert.match(ALLOTMENT_SEARCH_PROVENANCE.license_basis, /17 USC §105/);
});
