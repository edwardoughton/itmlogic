// 47 CFR §17.21 / §17.23 + FAA AC 70/7460-1L tower marking + lighting
// rules engine tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  requiredTowerCompliance,
  compareToAsr,
  MARKING_STYLES,
  LIGHTING_STYLES,
  TOWER_COMPLIANCE_PROVENANCE
} from '../engine/tower/index.js';

/* ---------- input validation ---------- */

test('requiredTowerCompliance: rejects missing height', () => {
  const r = requiredTowerCompliance({});
  assert.equal(r.applicable, false);
  assert.match(r.reason, /height_agl_m/);
});

test('requiredTowerCompliance: rejects negative height', () => {
  const r = requiredTowerCompliance({ height_agl_m: -1 });
  assert.equal(r.applicable, false);
});

/* ---------- §17.7 notification threshold ---------- */

test('< 200 ft AGL: no FAA notification, no marking, no lighting', () => {
  // 100 ft ≈ 30.48 m
  const r = requiredTowerCompliance({ height_agl_m: 30.48 });
  assert.equal(r.applicable, true);
  assert.equal(r.notification_required, false);
  assert.equal(r.marking.required, false);
  assert.equal(r.lighting.required, false);
  assert.equal(r.marking.style,  MARKING_STYLES.NONE);
  assert.equal(r.lighting.style, LIGHTING_STYLES.NONE);
});

test('< 200 ft AGL but near_airport: notification triggered, lighting kicks in', () => {
  const r = requiredTowerCompliance({ height_agl_m: 30.48, near_airport: true });
  assert.equal(r.notification_required, true);
  assert.equal(r.lighting.required, true);
  assert.equal(r.lighting.style, LIGHTING_STYLES.RED_OBSTRUCTION_TYPE_A);
});

/* ---------- height → lighting style decision ---------- */

test('200-350 ft AGL: Red Obstruction Type A (L-864 + L-810)', () => {
  // 250 ft ≈ 76.2 m
  const r = requiredTowerCompliance({ height_agl_m: 76.2 });
  assert.equal(r.notification_required, true);
  assert.equal(r.lighting.style, LIGHTING_STYLES.RED_OBSTRUCTION_TYPE_A);
  // Marking required because lighting type doesn't substitute.
  assert.equal(r.marking.required, true);
  assert.equal(r.marking.style, MARKING_STYLES.AVIATION_ORANGE_WHITE);
});

test('350-700 ft AGL: Medium-Intensity Dual + lighting in lieu of paint', () => {
  // 500 ft ≈ 152.4 m
  const r = requiredTowerCompliance({ height_agl_m: 152.4 });
  assert.equal(r.lighting.style, LIGHTING_STYLES.MEDIUM_INTENSITY_DUAL);
  // §17.23(c): dual L-864/L-865 substitutes for paint.
  assert.equal(r.marking.required, false);
  assert.equal(r.marking.style, MARKING_STYLES.LIGHTING_IN_LIEU_OF_PAINT);
});

test('700-2000 ft AGL: High-Intensity White (L-856), no paint', () => {
  // 1000 ft ≈ 304.8 m
  const r = requiredTowerCompliance({ height_agl_m: 304.8 });
  assert.equal(r.lighting.style, LIGHTING_STYLES.HIGH_INTENSITY_WHITE);
  assert.equal(r.marking.required, false);
});

test('> 2000 ft AGL: case-specific FAA letter required', () => {
  // 2500 ft ≈ 762 m
  const r = requiredTowerCompliance({ height_agl_m: 762 });
  assert.equal(r.lighting.style, LIGHTING_STYLES.HIGH_INTENSITY_CASE_SPECIFIC);
  assert.equal(r.marking.required, false);
});

/* ---------- citation completeness ---------- */

test('every notification-required compliance carries §17.21 + AC 70/7460-1L cite', () => {
  const r = requiredTowerCompliance({ height_agl_m: 100 });   // 328 ft
  const cite_text = r.cites.map(c => c.rule).join(' | ');
  assert.match(cite_text, /17\.7/);
  assert.match(cite_text, /17\.21/);
  // Lighting cite identifies the AC 70/7460-1L chapter.
  const light_cite = r.lighting.cites.map(c => c.rule).join(' | ');
  assert.match(light_cite, /AC 70\/7460-1L/);
});

test('returned object is frozen (treat as engine output, not a writable view)', () => {
  const r = requiredTowerCompliance({ height_agl_m: 100 });
  assert.equal(Object.isFrozen(r), true);
});

/* ---------- compareToAsr ---------- */

const ASR_500FT_DUAL = {
  available: true,
  source: 'fcc-opendata-socrata',
  asr_number:           '1234567',
  overall_height_m:      152.4,
  overall_height_amsl_m: 800,
  lighting_requirement:  'C0',     // Medium-Intensity Dual
  painting_requirement:  null      // dual lights → no paint
};

test('compareToAsr: dual-light ASR matches rules-derived 500 ft compliance', () => {
  const compliance = requiredTowerCompliance({ height_agl_m: 152.4 });
  const cmp = compareToAsr({ compliance, asr: ASR_500FT_DUAL });
  assert.equal(cmp.comparison.applicable, true);
  assert.equal(cmp.comparison.matches, true);
  assert.equal(cmp.comparison.n_gaps, 0);
  assert.equal(cmp.comparison.asr_family, LIGHTING_STYLES.MEDIUM_INTENSITY_DUAL);
});

test('compareToAsr: ASR height mismatch flagged', () => {
  const compliance = requiredTowerCompliance({ height_agl_m: 100 });
  const asr = { ...ASR_500FT_DUAL, overall_height_m: 152.4 };  // ASR says 152, rules used 100
  const cmp = compareToAsr({ compliance, asr });
  assert.equal(cmp.comparison.matches, false);
  assert.ok(cmp.comparison.gaps.some(g => g.field === 'height_agl_m'));
});

test('compareToAsr: rules recommend dual but ASR says red-obstruction → warn', () => {
  // 500 ft compliance recommends MEDIUM_INTENSITY_DUAL, ASR says A2
  // (red obstruction type A).  Should flag warn — operator should
  // verify FAA letter.
  const compliance = requiredTowerCompliance({ height_agl_m: 152.4 });
  const asr = { ...ASR_500FT_DUAL, lighting_requirement: 'A2' };
  const cmp = compareToAsr({ compliance, asr });
  const lightGap = cmp.comparison.gaps.find(g => g.field === 'lighting_style');
  assert.ok(lightGap);
  assert.equal(lightGap.severity, 'warn');
});

test('compareToAsr: rules recommend lighting but ASR carries none → major', () => {
  const compliance = requiredTowerCompliance({ height_agl_m: 152.4 });
  const asr = { ...ASR_500FT_DUAL, lighting_requirement: null };
  const cmp = compareToAsr({ compliance, asr });
  const gap = cmp.comparison.gaps.find(g => g.field === 'lighting_requirement');
  assert.ok(gap);
  assert.equal(gap.severity, 'major');
});

test('compareToAsr: ASR not available → not-applicable comparison', () => {
  const compliance = requiredTowerCompliance({ height_agl_m: 152.4 });
  const cmp = compareToAsr({ compliance, asr: { available: false } });
  assert.equal(cmp.comparison.applicable, false);
});

/* ---------- provenance ---------- */

test('TOWER_COMPLIANCE_PROVENANCE cites §17.x rules + AC 70/7460-1L', () => {
  assert.ok(TOWER_COMPLIANCE_PROVENANCE.regulations.includes('47 CFR §17.21'));
  assert.ok(TOWER_COMPLIANCE_PROVENANCE.regulations.includes('47 CFR §17.23'));
  assert.match(TOWER_COMPLIANCE_PROVENANCE.faa_reference, /AC 70\/7460-1L/);
  // Engine output is preliminary; FAA letter is authoritative.
  assert.match(TOWER_COMPLIANCE_PROVENANCE.authoritative, /FAA-issued/);
});
