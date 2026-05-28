import test from 'node:test';
import assert from 'node:assert/strict';
import { pathWeightedSigma } from '../engine/am/groundwave.js';

test('pathWeightedSigma — single-segment radial returns the segment σ', () => {
  const σ = pathWeightedSigma([{ from_km: 0, to_km: 50, sigma_mS_m: 8 }]);
  assert.equal(σ, 8);
});

test('pathWeightedSigma — equal-length segments average linearly', () => {
  const σ = pathWeightedSigma([
    { from_km: 0,  to_km: 25, sigma_mS_m: 4 },
    { from_km: 25, to_km: 50, sigma_mS_m: 8 }
  ]);
  // (4 * 25 + 8 * 25) / 50 = 6
  assert.equal(σ, 6);
});

test('pathWeightedSigma — long segment dominates the weighted mean', () => {
  const σ = pathWeightedSigma([
    { from_km: 0,   to_km: 5,   sigma_mS_m: 30 },   // short high-σ near tx
    { from_km: 5,   to_km: 100, sigma_mS_m: 2  }    // long low-σ tail
  ]);
  // (30*5 + 2*95) / 100 = (150 + 190) / 100 = 3.4
  assert.ok(Math.abs(σ - 3.4) < 1e-9);
});

test('pathWeightedSigma — null / empty returns null', () => {
  assert.equal(pathWeightedSigma(null), null);
  assert.equal(pathWeightedSigma([]), null);
});

test('pathWeightedSigma — invalid segments are skipped, not error', () => {
  const σ = pathWeightedSigma([
    { from_km: 0, to_km: 10, sigma_mS_m: 8 },
    { from_km: 10, to_km: 5, sigma_mS_m: 4 },         // negative length skipped
    { from_km: 10, to_km: 20, sigma_mS_m: 'bad' },    // non-finite σ skipped
    { from_km: 20, to_km: 30, sigma_mS_m: 4 }
  ]);
  // Only (8 from 0-10) and (4 from 20-30) used; weighted = (8 + 4) / 2 = 6
  assert.equal(σ, 6);
});

test('pathWeightedSigma — KELP-style 3-segment radial (8 → 4 → 15)', () => {
  // Cf. Mullaney KELP 1989 Table 1 azimuth 0.0°:
  //   8 mS/m from 0   to 13.3 km
  //   4 mS/m from 13.3 to 209.8 km
  //  15 mS/m from 209.8 to 463.7 km
  const σ = pathWeightedSigma([
    { from_km: 0,     to_km: 13.3,  sigma_mS_m: 8  },
    { from_km: 13.3,  to_km: 209.8, sigma_mS_m: 4  },
    { from_km: 209.8, to_km: 463.7, sigma_mS_m: 15 }
  ]);
  // (8*13.3 + 4*196.5 + 15*253.9) / 463.7
  //   = (106.4 + 786 + 3808.5) / 463.7
  //   = 4700.9 / 463.7 ≈ 10.14
  assert.ok(Math.abs(σ - 10.14) < 0.05, `weighted σ ${σ} should be near 10.14`);
});
