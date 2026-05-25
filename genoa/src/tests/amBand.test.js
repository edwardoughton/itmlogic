import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AM_BAND_KHZ_MIN, AM_BAND_KHZ_MAX, AM_GRID_KHZ,
  AM_EXPANDED_MIN, AM_EXPANDED_MAX,
  isValidAmKhz, normalizeAmKhz, describeAmKhz, wavelengthMeters
} from '../engine/am/band.js';

test('AM band constants match 47 CFR §73.21', () => {
  assert.equal(AM_BAND_KHZ_MIN,  535);
  assert.equal(AM_BAND_KHZ_MAX, 1705);
  assert.equal(AM_GRID_KHZ,      10);
  assert.equal(AM_EXPANDED_MIN, 1610);
  assert.equal(AM_EXPANDED_MAX, 1705);
});

test('isValidAmKhz: in-band on-grid valid', () => {
  for (const f of [540, 700, 1000, 1230, 1700]) assert.equal(isValidAmKhz(f), true, `${f} should be valid`);
});

test('isValidAmKhz: off-grid invalid', () => {
  for (const f of [535.1, 541, 705, 1234]) assert.equal(isValidAmKhz(f), false, `${f} should be invalid`);
});

test('isValidAmKhz: out-of-band invalid', () => {
  for (const f of [88, 89, 100, 530, 1710, 100_000, -1]) {
    assert.equal(isValidAmKhz(f), false, `${f} should be invalid`);
  }
});

test('isValidAmKhz: non-numbers invalid', () => {
  for (const v of [NaN, undefined, null, 'abc', {}]){
    assert.equal(isValidAmKhz(v), false);
  }
});

test('normalizeAmKhz: snaps near-grid input to nearest channel', () => {
  assert.equal(normalizeAmKhz(701), 700);
  assert.equal(normalizeAmKhz(706), 710);
  assert.equal(normalizeAmKhz(1199), 1200);
});

test('normalizeAmKhz: returns null for well-outside-band input', () => {
  assert.equal(normalizeAmKhz(89), null,    'LF 89 is too far below band');
  assert.equal(normalizeAmKhz(50_000), null, 'FM-grade input is too far above');
  assert.equal(normalizeAmKhz(0), null);
  assert.equal(normalizeAmKhz(-100), null);
  assert.equal(normalizeAmKhz(NaN), null);
});

test('describeAmKhz: ok / expanded_band / off_grid / out_of_band / not_a_number', () => {
  assert.deepEqual(describeAmKhz(890),  { valid: true,  kind: 'ok',           message: null });
  assert.equal(describeAmKhz(1600).kind, 'ok');
  assert.equal(describeAmKhz(1610).kind, 'expanded_band');
  assert.equal(describeAmKhz(1700).kind, 'expanded_band');
  // 1705 is the band edge but NOT on the 10-kHz channel grid — it's
  // a guard-band edge, not an assignable channel.  Spec ranks
  // off_grid before expanded_band so this surfaces as off_grid.
  assert.equal(describeAmKhz(1705).kind, 'off_grid');
  assert.equal(describeAmKhz(701).kind,  'off_grid');
  assert.equal(describeAmKhz(89).kind,   'out_of_band');
  assert.equal(describeAmKhz(NaN).kind,  'not_a_number');
  assert.match(describeAmKhz(89).message, /AM band/);
});

test('wavelengthMeters: 1000 kHz → ≈ 299.8 m, 700 kHz → ≈ 428.3 m', () => {
  assert.ok(Math.abs(wavelengthMeters(1000) - 299.8) < 0.1);
  assert.ok(Math.abs(wavelengthMeters(700)  - 428.3) < 0.1);
  assert.ok(Number.isNaN(wavelengthMeters(0)));
  assert.ok(Number.isNaN(wavelengthMeters(-1)));
});
