import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  computeFortranSourceRollup,
  FORTRAN_SOURCE_FILES
} from '../evidence/fortranSourceRollup.js';

// The three real SHAs from the live FORTRAN sidecar /version
// response, as embedded in the 2026-05-15 WJPZ-FM exhibit
// (Appendix D).  Pinning these means the rollup is the same
// hex string the public exhibit can be checked against by hand.
const REAL_FOR_SHAS = Object.freeze({
  'tvfmfs.for': '22d75277edfe63e0d6d9b16165ee1e6949cd4570c6d0dc132be0cf47c0ea69a1',
  'itplbv.for': 'bcab0989ffb5540d4d52ae76942eb2af4a17b0d7938cc49ae34ea1d91ddd0968',
  'driver.for': 'c2bfe9ab4269b714d9ad978299f5c0ab7efdc31c6d4c97b14cac9df21604ec01'
});

test('FORTRAN_SOURCE_FILES lists the three FCC TVFMFS_METRIC sources', () => {
  assert.deepEqual([...FORTRAN_SOURCE_FILES].sort(),
                   ['driver.for', 'itplbv.for', 'tvfmfs.for']);
});

test('computeFortranSourceRollup: deterministic, alphabetical-by-name, trailing newline', () => {
  const a = computeFortranSourceRollup(REAL_FOR_SHAS);
  const b = computeFortranSourceRollup({
    'tvfmfs.for': REAL_FOR_SHAS['tvfmfs.for'],
    'driver.for': REAL_FOR_SHAS['driver.for'],
    'itplbv.for': REAL_FOR_SHAS['itplbv.for']
  });
  assert.equal(a, b, 'argument order must not affect the rollup');
  // Verify the published formula against a hand-computed expected
  // value so reviewers can reproduce it independently.
  const expected = crypto.createHash('sha256').update(
      `${REAL_FOR_SHAS['driver.for']}  driver.for\n`
    + `${REAL_FOR_SHAS['itplbv.for']}  itplbv.for\n`
    + `${REAL_FOR_SHAS['tvfmfs.for']}  tvfmfs.for\n`
  ).digest('hex');
  assert.equal(a, expected);
});

test('computeFortranSourceRollup: any missing sha returns null (no partial rollup)', () => {
  assert.equal(
    computeFortranSourceRollup({ ...REAL_FOR_SHAS, 'tvfmfs.for': null }),
    null
  );
  assert.equal(
    computeFortranSourceRollup({ 'driver.for': REAL_FOR_SHAS['driver.for'] }),
    null
  );
  assert.equal(computeFortranSourceRollup(null), null);
  assert.equal(computeFortranSourceRollup(undefined), null);
});

test('computeFortranSourceRollup: rejects non-hex / truncated shas', () => {
  assert.equal(
    computeFortranSourceRollup({ ...REAL_FOR_SHAS, 'tvfmfs.for': 'not-a-sha' }),
    null
  );
  assert.equal(
    // 63 chars (too short)
    computeFortranSourceRollup({ ...REAL_FOR_SHAS, 'tvfmfs.for': 'a'.repeat(63) }),
    null
  );
});

test('computeFortranSourceRollup: lowercases hex so case differences do not change the rollup', () => {
  const upper = Object.fromEntries(
    Object.entries(REAL_FOR_SHAS).map(([k, v]) => [k, v.toUpperCase()])
  );
  assert.equal(
    computeFortranSourceRollup(upper),
    computeFortranSourceRollup(REAL_FOR_SHAS)
  );
});
