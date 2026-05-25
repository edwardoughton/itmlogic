import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rankComparableFacilities,
  FM_CLASS_REFERENCE,
  COMPARABLE_FACILITIES_PROVENANCE
} from '../engine/comparableFacilities.js';

const SUBJECT = {
  lat: 40.0, lon: -75.0,
  fcc_class: 'A',
  erp_kw: 4, haat_m: 80,
  frequency_mhz: 100.7
};

/* ---------- input guards ---------- */

test('rankComparableFacilities: rejects missing subject', () => {
  const r = rankComparableFacilities({});
  assert.equal(r.ok, false);
  assert.match(r.error, /subject required/);
});

test('rankComparableFacilities: rejects missing lat/lon', () => {
  const r = rankComparableFacilities({ subject: { fcc_class: 'A' } });
  assert.equal(r.ok, false);
  assert.match(r.error, /lat/);
});

test('rankComparableFacilities: rejects unknown class', () => {
  const r = rankComparableFacilities({
    subject: { lat: 40, lon: -75, fcc_class: 'X' }
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /fcc_class/);
});

test('rankComparableFacilities: empty candidates returns ok with stats but 0 results', () => {
  const r = rankComparableFacilities({ subject: SUBJECT, candidates: [] });
  assert.equal(r.ok, true);
  assert.equal(r.n_returned, 0);
  assert.deepEqual(r.results, []);
  assert.ok(r.reference);
  assert.equal(r.reference.max_erp_kw, 6);  // Class A reference
});

/* ---------- §73.211 reference table ---------- */

test('FM_CLASS_REFERENCE: §73.211 anchors match the published values', () => {
  assert.equal(FM_CLASS_REFERENCE.A.max_erp_kw, 6);
  assert.equal(FM_CLASS_REFERENCE.A.max_haat_m, 100);
  assert.equal(FM_CLASS_REFERENCE.B1.max_erp_kw, 25);
  assert.equal(FM_CLASS_REFERENCE.B.max_erp_kw, 50);
  assert.equal(FM_CLASS_REFERENCE.C.max_erp_kw, 100);
  assert.equal(FM_CLASS_REFERENCE.C.max_haat_m, 600);
});

/* ---------- ranking ---------- */

const NEAR_SAME_CLASS = {
  call: 'WSAME', facility_id: 1001, fcc_class: 'A',
  lat: 40.05, lon: -75.05,
  frequency_mhz: 100.5, erp_kw: 5, haat_m: 75
};
const NEAR_DIFF_FAMILY = {
  call: 'WBIGB', facility_id: 1002, fcc_class: 'B',
  lat: 40.10, lon: -75.10,
  frequency_mhz: 100.3, erp_kw: 50, haat_m: 150
};
const NEAR_SAME_FAMILY_DIFF_TIER = {
  call: 'WCEE3', facility_id: 1003, fcc_class: 'C3',
  lat: 40.10, lon: -75.10,
  frequency_mhz: 100.1, erp_kw: 25, haat_m: 100
};
const FAR_SAME_CLASS = {
  call: 'WFARA', facility_id: 1004, fcc_class: 'A',
  lat: 42.0, lon: -75.0,            // ~222 km away
  frequency_mhz: 100.7, erp_kw: 6, haat_m: 100
};

test('ranking: same-class neighbor outranks different-family neighbor', () => {
  const r = rankComparableFacilities({
    subject: { ...SUBJECT, fcc_class: 'A' },
    candidates: [NEAR_DIFF_FAMILY, NEAR_SAME_CLASS]
  });
  assert.equal(r.ok, true);
  assert.equal(r.results[0].call, 'WSAME');
  assert.equal(r.results[1].call, 'WBIGB');
  assert.ok(r.results[0].similarity_score > r.results[1].similarity_score);
});

test('ranking: same-family different-tier scores between same-class and different-family', () => {
  const r = rankComparableFacilities({
    subject:    { ...SUBJECT, fcc_class: 'C0' },
    candidates: [NEAR_SAME_CLASS, NEAR_SAME_FAMILY_DIFF_TIER, NEAR_DIFF_FAMILY]
  });
  assert.equal(r.ok, true);
  // Subject is C0; C3 shares the C-family, A is its own.
  // Per components.class: same family → 0.5, different → 0
  const c3 = r.results.find((x) => x.call === 'WCEE3');
  const a  = r.results.find((x) => x.call === 'WSAME');
  assert.ok(c3 && a, 'both candidates should be returned');
  assert.equal(c3.components.class, 0.5);
  assert.equal(a.components.class, 0);
  assert.ok(c3.similarity_score > a.similarity_score,
    `C3 (${c3.similarity_score}) should outrank A (${a.similarity_score}) for C0 subject`);
});

test('ranking: distance penalty pushes far same-class below near same-class', () => {
  const r = rankComparableFacilities({
    subject:    SUBJECT,
    candidates: [FAR_SAME_CLASS, NEAR_SAME_CLASS]
  });
  assert.equal(r.results[0].call, 'WSAME');
  assert.equal(r.results[1].call, 'WFARA');
});

test('ranking: distance > maxDistanceKm filtered out entirely', () => {
  const r = rankComparableFacilities({
    subject:    SUBJECT,
    candidates: [FAR_SAME_CLASS, NEAR_SAME_CLASS],
    maxDistanceKm: 50
  });
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].call, 'WSAME');
  assert.equal(r.stats.n_in_radius, 1);
});

test('ranking: topK caps the output', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({
    call: `W${i}`, facility_id: 2000 + i, fcc_class: 'A',
    lat: 40 + i * 0.05, lon: -75,
    frequency_mhz: 100.7, erp_kw: 4, haat_m: 80
  }));
  const r = rankComparableFacilities({
    subject:    SUBJECT,
    candidates: many,
    topK:       3
  });
  assert.equal(r.results.length, 3);
  assert.equal(r.stats.n_returned, 3);
  assert.equal(r.stats.n_in_radius, 10);
});

/* ---------- headroom diagnostics ---------- */

test('classHeadroom: ERP/HAAT remaining below class ceiling', () => {
  const r = rankComparableFacilities({
    subject:    SUBJECT,
    candidates: [{
      call: 'WHEAD', facility_id: 3000, fcc_class: 'B',
      lat: 40.05, lon: -75.05,
      frequency_mhz: 100.5, erp_kw: 25, haat_m: 100
    }]
  });
  const head = r.results[0].class_headroom;
  assert.equal(head.erp_kw_remaining, 25);   // B max=50, used 25
  assert.equal(head.haat_m_remaining, 50);   // B max=150, used 100
  assert.equal(head.at_class_ceiling, false);
});

test('classHeadroom: at-ceiling flag fires for max-power station', () => {
  const r = rankComparableFacilities({
    subject:    SUBJECT,
    candidates: [{
      call: 'WMAX', facility_id: 3001, fcc_class: 'A',
      lat: 40.05, lon: -75.05,
      frequency_mhz: 100.5, erp_kw: 6, haat_m: 100
    }]
  });
  const head = r.results[0].class_headroom;
  assert.equal(head.erp_kw_remaining, 0);
  assert.equal(head.at_class_ceiling, true);
});

/* ---------- class-string normalization ---------- */

test('class normalization: hyphenated forms (B-1, C-3) map correctly', () => {
  const r = rankComparableFacilities({
    subject: { ...SUBJECT, fcc_class: 'B-1' },     // operator typed B-1
    candidates: [NEAR_SAME_CLASS]
  });
  assert.equal(r.ok, true);
  assert.equal(r.subject.fcc_class, 'B1');
  assert.equal(r.reference.max_erp_kw, 25);        // B1 reference picked up
});

/* ---------- stats ---------- */

test('stats: n_same_class counts only matching-class top-K', () => {
  const r = rankComparableFacilities({
    subject:    SUBJECT,
    candidates: [NEAR_SAME_CLASS, NEAR_DIFF_FAMILY, NEAR_SAME_FAMILY_DIFF_TIER]
  });
  assert.equal(r.stats.n_same_class, 1);  // only WSAME is class A
  assert.equal(r.stats.n_returned, 3);
  assert.ok(Number.isFinite(r.stats.median_erp_kw));
});

/* ---------- provenance ---------- */

test('COMPARABLE_FACILITIES_PROVENANCE names §73.211 + §73.215', () => {
  assert.match(COMPARABLE_FACILITIES_PROVENANCE.regulation, /73\.211/);
  assert.match(COMPARABLE_FACILITIES_PROVENANCE.regulation, /73\.215/);
  assert.match(COMPARABLE_FACILITIES_PROVENANCE.license_basis, /17 USC §105/);
});
