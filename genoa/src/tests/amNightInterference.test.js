import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rssAggregate,
  requiredDesiredField,
  checkProtection,
  standardDuDb,
  RSS_EXCLUSION_FRACTION,
  NIGHT_INTERFERENCE_PROVENANCE
} from '../engine/am/nightInterference.js';

test('RSS_EXCLUSION_FRACTION = 0.25 per §73.182(k)', () => {
  assert.equal(RSS_EXCLUSION_FRACTION, 0.25);
});

/* ---------- RSS math + 25% rule ---------- */

test('rssAggregate: single station passes through as itself', () => {
  const r = rssAggregate([{ field_uv_m: 50, station_id: 'A' }]);
  assert.equal(r.rss_uv_m, 50);
  assert.equal(r.n_contributing, 1);
});

test('rssAggregate: equal interferers — Pythagorean RSS', () => {
  // Two equal stations at 30 uV/m → RSS = sqrt(30^2 + 30^2) = 30*sqrt(2) ≈ 42.43
  const r = rssAggregate([
    { field_uv_m: 30, station_id: 'A' },
    { field_uv_m: 30, station_id: 'B' }
  ]);
  assert.ok(Math.abs(r.rss_uv_m - 30 * Math.sqrt(2)) < 1e-9);
  assert.equal(r.n_contributing, 2);
});

test('rssAggregate: drops interferers below 25% of the strongest', () => {
  // Strongest 100, threshold 25.  20 should be dropped.
  const r = rssAggregate([
    { field_uv_m: 100, station_id: 'A' },
    { field_uv_m:  30, station_id: 'B' },
    { field_uv_m:  20, station_id: 'C' }
  ]);
  assert.equal(r.n_contributing, 2, 'A + B contribute');
  assert.equal(r.contributing.map((x) => x.station_id).sort().join(','), 'A,B');
  assert.ok(r.excluded.some((x) => x.station_id === 'C'));
  assert.ok(Math.abs(r.threshold_uv_m - 25) < 1e-9);
  // RSS of 100 and 30 = sqrt(10000 + 900) ≈ 104.40
  assert.ok(Math.abs(r.rss_uv_m - Math.sqrt(10900)) < 1e-9);
});

test('rssAggregate: includes interferer at exactly 25% threshold', () => {
  // 100 strongest, 25 is exactly 25% → contributes.
  const r = rssAggregate([
    { field_uv_m: 100, station_id: 'A' },
    { field_uv_m:  25, station_id: 'B' }
  ]);
  assert.equal(r.n_contributing, 2);
});

test('rssAggregate: zero / NaN / negative fields excluded gracefully', () => {
  const r = rssAggregate([
    { field_uv_m: 50,     station_id: 'A' },
    { field_uv_m: 0,      station_id: 'B' },
    { field_uv_m: NaN,    station_id: 'C' },
    { field_uv_m: -10,    station_id: 'D' }
  ]);
  assert.equal(r.n_contributing, 1);
  assert.equal(r.rss_uv_m, 50);
  assert.equal(r.n_excluded, 3);
});

test('rssAggregate: empty array → rss=0, n_contributing=0', () => {
  const r = rssAggregate([]);
  assert.equal(r.rss_uv_m, 0);
  assert.equal(r.n_contributing, 0);
});

test('rssAggregate: custom exclusion fraction respected', () => {
  // Custom 0.5 — drops anything below 50% of strongest.
  const r = rssAggregate([
    { field_uv_m: 100 },
    { field_uv_m:  60 },
    { field_uv_m:  40 }
  ], { exclusionFraction: 0.5 });
  assert.equal(r.n_contributing, 2);
  assert.equal(r.threshold_uv_m, 50);
});

test('rssAggregate: throws on non-array input', () => {
  assert.throws(() => rssAggregate(null), /must be an array/);
  assert.throws(() => rssAggregate({}),   /must be an array/);
});

/* ---------- D/U + protection check ---------- */

test('requiredDesiredField: D/U 0 dB → required equals RSS', () => {
  assert.equal(requiredDesiredField(50, 0), 50);
});

test('requiredDesiredField: D/U 20 dB → required is 10× RSS', () => {
  const v = requiredDesiredField(50, 20);
  assert.ok(Math.abs(v - 500) < 1e-9);
});

test('requiredDesiredField: D/U 26 dB (Class A clear) ≈ 19.95× RSS', () => {
  const v = requiredDesiredField(10, 26);
  assert.ok(Math.abs(v - 10 * Math.pow(10, 26/20)) < 1e-9);
});

test('checkProtection: passes when desired exceeds required', () => {
  const r = checkProtection(600, 50, 20);
  assert.equal(r.pass, true);
  assert.ok(Math.abs(r.required_uv_m - 500) < 1e-9);
  assert.ok(r.margin_db > 1.5 && r.margin_db < 2);  // 20*log10(600/500) ≈ 1.58 dB
});

test('checkProtection: fails when desired below required', () => {
  const r = checkProtection(400, 50, 20);
  assert.equal(r.pass, false);
  assert.ok(r.margin_db < 0);
});

test('checkProtection: NaN margin when desired or required is invalid', () => {
  const r = checkProtection(null, 50, 20);
  assert.equal(r.pass, false);
  assert.equal(r.margin_db, null);
});

/* ---------- standard D/U lookup ---------- */

test('standardDuDb: Class A co-channel = 26 dB', () => {
  assert.equal(standardDuDb('A', 'co_channel'), 26);
});

test('standardDuDb: Class B co-channel = 20 dB', () => {
  assert.equal(standardDuDb('B', 'co_channel'), 20);
});

test('standardDuDb: 2nd-adjacent everywhere = -26 dB (weaker interferer needed)', () => {
  for (const cls of ['A', 'B', 'C', 'D']){
    assert.equal(standardDuDb(cls, 'second_adjacent'), -26, `${cls} 2nd-adj`);
  }
});

test('standardDuDb: Class D 3rd-adjacent returns null (not protected)', () => {
  assert.equal(standardDuDb('D', 'third_adjacent'), null);
});

test('standardDuDb: unknown class returns null', () => {
  assert.equal(standardDuDb('Z', 'co_channel'), null);
  assert.equal(standardDuDb(null, 'co_channel'), null);
});

/* ---------- provenance ---------- */

test('NIGHT_INTERFERENCE_PROVENANCE names §73.182(k) + §73.183', () => {
  assert.match(NIGHT_INTERFERENCE_PROVENANCE.regulation, /73\.182\(k\)/);
  assert.match(NIGHT_INTERFERENCE_PROVENANCE.regulation, /73\.183/);
});
