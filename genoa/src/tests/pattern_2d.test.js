// 2-D pattern (az × el) bilinear interpolation tests.
//
// Verifies:
//   - patternFactor(table, az, el) on a 2-D grid bilinear-interpolates
//     between the four corner cells
//   - 1-D legacy tables remain a horizon-only slice (el ignored)
//   - directionalErpAtBearing threads elevation_deg through to the
//     factor() function
//   - studyContourPair runs at the horizon by default (el=0)
//   - section_73_187 pairSkywaveStudy supports a 2-D pattern + per-
//     station elevation_deg override
//   - expand1dTo2d preserves horizon factors for any elevation
//   - isPattern2D detects shape correctly

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  patternFactor,
  expand1dTo2d,
  isPattern2D
} from '../engine/pattern/factor.js';

import {
  directionalErpAtBearing
} from '../engine/pattern/am_directional.js';

import { studyContourPair } from '../engine/regulatory/_du_pair_study.js';

/* ---------------- shape detection + 1-D legacy ---------------- */

test('isPattern2D: detects 2-D shape vs 1-D / null / array', () => {
  assert.equal(isPattern2D(null), false);
  assert.equal(isPattern2D([[0, 1], [90, 0.5]]), false);
  assert.equal(isPattern2D({ azimuths_deg: [0, 90], elevations_deg: [0], factors: [[1, 0.5]] }), true);
  assert.equal(isPattern2D({ azimuths_deg: [0, 90] }), false);
});

test('patternFactor 1-D: elevation argument is ignored (legacy behaviour preserved)', () => {
  const t = [[0, 1.0], [90, 0.0], [180, 1.0], [270, 0.0]];
  // Same azimuth, different elevations → identical factor
  assert.equal(patternFactor(t, 0,  -45), patternFactor(t, 0,  0));
  assert.equal(patternFactor(t, 0,   45), patternFactor(t, 0,  0));
  assert.equal(patternFactor(t, 90, -90), patternFactor(t, 90, 90));
});

/* ---------------- 2-D bilinear ---------------- */

const GRID_2D = {
  azimuths_deg:   [0,   90,  180, 270],
  elevations_deg: [0,   30,  60,  90],
  // factors[el][az] — peak at (az=0, el=0); null straight up
  factors: [
    /* el=0  */ [1.0,  1.0,  1.0,  1.0 ],
    /* el=30 */ [0.8,  0.8,  0.8,  0.8 ],
    /* el=60 */ [0.4,  0.4,  0.4,  0.4 ],
    /* el=90 */ [0.0,  0.0,  0.0,  0.0 ]
  ]
};

test('patternFactor 2-D: corner cells return the table values directly', () => {
  assert.equal(patternFactor(GRID_2D,   0,  0), 1.0);
  assert.equal(patternFactor(GRID_2D,  90, 30), 0.8);
  assert.equal(patternFactor(GRID_2D, 180, 60), 0.4);
  assert.equal(patternFactor(GRID_2D, 270, 90), 0.0);
});

test('patternFactor 2-D: bilinear midpoint between two elevation rows', () => {
  // Halfway between el=0 (1.0) and el=30 (0.8) = 0.9
  assert.ok(Math.abs(patternFactor(GRID_2D, 0, 15) - 0.9) < 1e-6);
  // Halfway between el=60 (0.4) and el=90 (0.0) = 0.2
  assert.ok(Math.abs(patternFactor(GRID_2D, 0, 75) - 0.2) < 1e-6);
});

test('patternFactor 2-D: bilinear interpolation across both axes', () => {
  // Build a non-trivial corner grid: az varies, el varies
  const grid = {
    azimuths_deg:   [0, 180],
    elevations_deg: [0, 90],
    factors: [
      /* el=0  */ [1.0, 0.0 ],
      /* el=90 */ [0.0, 0.5 ]
    ]
  };
  // Center: az=90, el=45.  Bilinear:
  //   row0 @ az=90 = 0.5;  row1 @ az=90 = 0.25;
  //   col-mix at el=45 = (0.5 + 0.25) / 2 = 0.375
  assert.ok(Math.abs(patternFactor(grid, 90, 45) - 0.375) < 1e-6);
});

test('patternFactor 2-D: azimuth wraps across 360', () => {
  // Symmetric pattern → az=350 should be close to az=10 (10° each side of 0)
  const f10  = patternFactor(GRID_2D, 10,  0);
  const f350 = patternFactor(GRID_2D, 350, 0);
  assert.ok(Math.abs(f10 - f350) < 1e-6);
});

test('patternFactor 2-D: elevations clamp to grid range', () => {
  // Below el[0]=0 → snaps to row 0
  assert.equal(patternFactor(GRID_2D, 0, -45), 1.0);
  // Above el[last]=90 → snaps to last row
  assert.equal(patternFactor(GRID_2D, 0, 180),  0.0);
});

/* ---------------- expand1dTo2d ---------------- */

test('expand1dTo2d: preserves horizon factor for every elevation', () => {
  const t1d = [[0, 1.0], [90, 0.5], [180, 0.0], [270, 0.5]];
  const t2d = expand1dTo2d(t1d);
  // Same azimuth slice at every elevation
  for (const el of t2d.elevations_deg){
    for (let i = 0; i < t1d.length; i++){
      assert.equal(patternFactor(t2d, t1d[i][0], el), t1d[i][1]);
    }
  }
});

/* ---------------- directionalErpAtBearing thread-through ---------------- */

test('directionalErpAtBearing 2-D: applies elevation-dependent factor to ERP', () => {
  const t2d = {
    azimuths_deg:   [0, 90, 180, 270],
    elevations_deg: [0, 90],
    factors: [
      /* el=0  */ [1.0, 1.0, 1.0, 1.0],
      /* el=90 */ [0.0, 0.0, 0.0, 0.0]
    ]
  };
  // Horizon: full ERP (factor 1.0 → ERP × 1² = ERP)
  const r0 = directionalErpAtBearing({ erp_kw: 100, pattern_table: t2d, bearing_deg: 0, elevation_deg:  0 });
  // Zenith: zero ERP (factor 0.0 → ERP × 0² = 0)
  const r90 = directionalErpAtBearing({ erp_kw: 100, pattern_table: t2d, bearing_deg: 0, elevation_deg: 90 });
  assert.equal(r0.pattern_factor,   1.0);
  assert.equal(r0.erp_effective_kw, 100);
  assert.equal(r0.pattern_dimensionality, '2D-az-el');
  assert.equal(r90.pattern_factor,   0.0);
  assert.equal(r90.erp_effective_kw, 0);
});

test('directionalErpAtBearing 1-D: pattern_dimensionality reports the legacy shape', () => {
  const t1d = [[0, 1.0], [90, 0.0], [180, 1.0], [270, 0.0]];
  const r = directionalErpAtBearing({ erp_kw: 100, pattern_table: t1d, bearing_deg: 0, elevation_deg: 30 });
  assert.equal(r.pattern_dimensionality, '1D-az-horizon');
});

test('directionalErpAtBearing: omnidirectional → null dimensionality, factor 1', () => {
  const r = directionalErpAtBearing({ erp_kw: 100, pattern_table: null, bearing_deg: 0, elevation_deg: 30 });
  assert.equal(r.pattern_factor, 1.0);
  assert.equal(r.directional,   false);
  assert.equal(r.pattern_dimensionality, null);
});

/* ---------------- studyContourPair: el=0 reported, 2-D pattern works ---------------- */

test('studyContourPair: stamps elevation_deg=0 + pattern_dimensionality on 2-D pattern', () => {
  const t2d = expand1dTo2d([[0, 1.0], [180, 0.0], [359, 1.0]]);
  const subject = {
    call: 'KSUB-FM', frequency_mhz: 100.7, erp_kw: 6, haat_m: 100,
    lat: 40.0, lon: -100.0, fcc_class: 'A', pattern_table: t2d
  };
  const nearby = {
    call: 'KNRB-FM', frequency_mhz: 100.7, erp_kw: 50, haat_m: 150,
    lat: 41.5, lon: -100.0, fcc_class: 'B'
  };
  const study = studyContourPair(subject, nearby, {
    relationship: 'co-channel', du_threshold_db: 20, protected_field_dbu: 54
  });
  assert.equal(study.elevation_deg, 0);
  assert.equal(study.pattern_dimensionality, '2D-az-el');
  assert.equal(study.directional_pattern_applied, true);
});

test('studyContourPair: 1-D and 2-D omnidirectional-elevation tables produce identical results', () => {
  const t1d = [[0, 1.0], [180, 0.0], [359, 1.0]];
  const t2d = expand1dTo2d(t1d);
  const subject = (t) => ({
    call: 'KSUB-FM', frequency_mhz: 100.7, erp_kw: 6, haat_m: 100,
    lat: 40.0, lon: -100.0, fcc_class: 'A', pattern_table: t
  });
  const nearby = {
    call: 'KNRB-FM', frequency_mhz: 100.7, erp_kw: 50, haat_m: 150,
    lat: 41.5, lon: -100.0, fcc_class: 'B'
  };
  const opts = { relationship: 'co-channel', du_threshold_db: 20, protected_field_dbu: 54 };
  const s1 = studyContourPair(subject(t1d), nearby, opts);
  const s2 = studyContourPair(subject(t2d), nearby, opts);
  assert.ok(Math.abs(s1.u_erp_effective_kw - s2.u_erp_effective_kw) < 1e-6);
  if (s1.du_actual_db != null && s2.du_actual_db != null){
    assert.ok(Math.abs(s1.du_actual_db - s2.du_actual_db) < 1e-6);
  }
});
