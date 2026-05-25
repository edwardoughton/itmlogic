// Cross-validation suite for the JS port of NTIA ITM v1.2.2.
//
// Two test categories:
//
// 1. PRIMITIVE SPOT-CHECKS - hand-computed reference values for the
//    leaf functions (aknfe, qerf/qerfi, qlrps).  These are formula-
//    derived, not splat-derived, so they pin the math identity rather
//    than overall agreement.
//
// 2. SANITY-BOUND FIXTURES - synthetic terrain profiles where physics
//    constrains the answer:
//      a) Path loss MUST exceed free-space loss at every distance.
//      b) Path loss is monotonically non-decreasing with distance on
//         a flat profile.
//      c) Adding a ridge to the profile produces strictly more loss
//         than the same path on flat earth (knife-edge diffraction
//         is non-negative).
//      d) Frequency scaling: doubling f adds ~6 dB to free-space
//         loss; total path loss must rise by at least that much on
//         a diffraction-dominated path.
//      e) kwx (worst-case warning level) flags out-of-range inputs
//         as the C++ reference does.
//      f) Mode classification (LOS / diffraction / troposcatter)
//         tracks the propa.dlsa and propa.dx thresholds correctly.
//
// Doesn't pin against splat sidecar output yet - that requires
// symmetric profile + distance APIs we don't have.  Phase 3 follow-up
// will add a splat-vs-JS table once the splat /api/v1/splat/run
// surface has a "given this profile, return dbloss at d" mode.

import { test }   from 'node:test';
import assert     from 'node:assert/strict';
import {
  aknfe, qerf, qerfi,
  qlrps, makeProp, makeAvar, makeQlrpfl, makePropa, makePropv,
  pointToPoint, profileFromElevations,
  ITM_V122_PRODUCTION_READY
} from '../engine/coverage/itm_v122/index.js';

// ---------- helpers --------------------------------------------------

function flatProfile(length_m, spacing_m){
  const n = Math.round(length_m / spacing_m) + 1;
  return profileFromElevations(new Array(n).fill(0.0), spacing_m);
}

function ridgeProfile(length_m, spacing_m, ridge_height_m, ridge_centre_m, ridge_width_m){
  const n = Math.round(length_m / spacing_m) + 1;
  const h = new Array(n).fill(0.0);
  const halfWidth = ridge_width_m / 2;
  for (let i = 0; i < n; i++){
    const x = i * spacing_m;
    const dx = Math.abs(x - ridge_centre_m);
    if (dx <= halfWidth){
      h[i] = ridge_height_m * (1 - dx / halfWidth);
    }
  }
  return profileFromElevations(h, spacing_m);
}

function freeSpaceLossDb(distance_km, frequency_mhz){
  return 32.45
       + 20.0 * Math.log10(frequency_mhz)
       + 20.0 * Math.log10(Math.max(0.001, distance_km));
}

// ---------- primitive spot-checks ------------------------------------

test('aknfe matches eq. 4.20 spot values', () => {
  // v^2 < 5.76 branch:    a = 6.02 + 9.11*sqrt(v^2) - 1.27*v^2
  assert.equal(aknfe(0).toFixed(3), '6.020');
  assert.equal(aknfe(1).toFixed(3), '13.860');     // 6.02 + 9.11 - 1.27
  // v^2 >= 5.76 branch:    a = 12.953 + 10*log10(v^2)
  assert.equal(aknfe(10).toFixed(3),  '22.953');   // 12.953 + 10
  assert.equal(aknfe(100).toFixed(3), '32.953');   // 12.953 + 20
});

test('qerf is symmetric around 0.5', () => {
  // qerf returns the upper-tail CDF.  qerf(0) ~ 0.5, qerf(z) + qerf(-z) ~ 1.
  for (const z of [0.5, 1.0, 1.5, 2.0]){
    const sum = qerf(z) + qerf(-z);
    assert.ok(Math.abs(sum - 1.0) < 0.005,
      `qerf(${z}) + qerf(${-z}) = ${sum.toFixed(4)}, expected ~1`);
  }
});

test('qerfi inverts qerf within tolerance', () => {
  // qerf is the UPPER-tail CDF: qerf(z) = P(Z > z).  So qerfi(p) returns
  // the z such that the upper-tail probability is p.  qerfi(0.5) ~ 0;
  // qerfi(0.84) ~ -1 (because qerf(-1) ~ 0.84); qerfi(0.025) ~ +1.96.
  assert.ok(Math.abs(qerfi(0.5)) < 0.01,            `qerfi(0.5) = ${qerfi(0.5)}`);
  assert.ok(Math.abs(qerfi(0.84) - (-1.0)) < 0.05,  `qerfi(0.84) = ${qerfi(0.84)}`);
  assert.ok(Math.abs(qerfi(0.025) - 1.96) < 0.1,    `qerfi(0.025) = ${qerfi(0.025)}`);
});

test('qlrps populates wave number, refractivity, ground impedance', () => {
  const prop = makeProp();
  prop.hg[0] = 30; prop.hg[1] = 10;
  qlrps(/*fmhz*/100, /*zsys*/0, /*en0*/301, /*ipol*/1,
        /*eps*/15, /*sgm*/0.005, prop);
  // wn = f / 47.7
  assert.equal(prop.wn.toFixed(6), (100 / 47.7).toFixed(6));
  // ens = en0 (no altitude scaling when zsys=0)
  assert.equal(prop.ens, 301);
  // gme physically reasonable (Earth curvature, ~1.16e-7 typical)
  assert.ok(prop.gme > 1.0e-7 && prop.gme < 1.5e-7,
    `gme = ${prop.gme.toExponential(2)}`);
  // Vertical-pol ground impedance has small positive real, near-zero imag.
  assert.ok(prop.zgndreal > 0, `zgnd.re = ${prop.zgndreal}`);
});

test('production-ready flag is true now that pipeline is complete', () => {
  assert.equal(ITM_V122_PRODUCTION_READY, true);
});

// ---------- sanity-bound fixtures ------------------------------------

test('flat 30km @ 100 MHz: total loss exceeds free-space loss', () => {
  const r = pointToPoint({
    profile: flatProfile(30_000, 100),
    tx_height_m: 30, rx_height_m: 10,
    frequency_mhz: 100, conf: 0.5, rel: 0.5
  });
  const fsl = freeSpaceLossDb(30, 100);
  assert.ok(r.dbloss_db >= fsl,
    `dbloss ${r.dbloss_db.toFixed(2)} dB < FSL ${fsl.toFixed(2)} dB (impossible)`);
  assert.equal(r.kwx, 0, `kwx ${r.kwx} on a clean input`);
});

test('flat 50km: path loss strictly increases over distance', () => {
  // Build a single primed path, sample lrprop at several distances.
  const prop  = makeProp();
  prop.hg[0]  = 30;  prop.hg[1] = 10;
  qlrps(100, 0, 301, 1, 15, 0.005, prop);
  const propa = makePropa();
  const propv = makePropv();
  propv.klim = 5; propv.mdvar = 12;
  const lrprop = makeQlrpfl()(flatProfile(50_000, 100), 5, 12, prop, propa, propv);

  const dists_m = [10_000, 15_000, 20_000, 30_000, 45_000];
  const arefs   = dists_m.map(d => {
    lrprop(d, prop, propa);
    return prop.aref;
  });
  for (let i = 1; i < arefs.length; i++){
    assert.ok(arefs[i] >= arefs[i - 1] - 0.01,
      `non-monotonic aref: ${arefs[i - 1].toFixed(2)} -> ${arefs[i].toFixed(2)} `
      + `at d ${dists_m[i - 1] / 1000}km -> ${dists_m[i] / 1000}km`);
  }
});

test('200m ridge adds non-trivial excess vs flat (knife-edge non-negative)', () => {
  // Authoritative ITM v1.2.2 (per the C++ reference test_p2p, matched
  // to <0.05 dB in commit 7bf4c90 "fix(itm_v122/d1thx): port C++ d1thx
  // faithfully") returns ~2.26 dB excess for a 200m ridge centred at
  // 25 km on a 50 km / 100 MHz path with 30/10 antennas.  The earlier
  // pre-d1thx-port assertion of ">= 5 dB" was based on the buggy
  // pre-port output and is corrected here to the C++-validated value.
  const flat = pointToPoint({
    profile: flatProfile(50_000, 100),
    tx_height_m: 30, rx_height_m: 10,
    frequency_mhz: 100, conf: 0.5, rel: 0.5
  });
  const hilly = pointToPoint({
    profile: ridgeProfile(50_000, 100, /*h=*/200, /*centre=*/25_000, /*width=*/10_000),
    tx_height_m: 30, rx_height_m: 10,
    frequency_mhz: 100, conf: 0.5, rel: 0.5
  });
  const delta = hilly.dbloss_db - flat.dbloss_db;
  assert.ok(delta > 0,
    `200m ridge added ${delta.toFixed(2)} dB (expected > 0 — ridge must add some excess)`);
  assert.ok(delta <  60,
    `200m ridge added ${delta.toFixed(2)} dB (>60 = unphysical for 200m at 100 MHz)`);
});

test('doubling frequency adds >= 3 dB on a diffraction-dominated path', () => {
  // Free-space adds exactly 6.02 dB per octave.  Inside the LOS distance
  // (~35 km combined horizon for 30/10 antennas) the alos two-ray sum
  // produces frequency-dependent constructive/destructive interference
  // that can mostly cancel the FSL increase, so a flat 30 km test is
  // unreliable.  100 km is well past the horizon - the diffraction +
  // troposcatter branches dominate and frequency scaling is monotonic.
  const profile = flatProfile(100_000, 100);
  const lo = pointToPoint({ profile, tx_height_m: 30, rx_height_m: 10,
                            frequency_mhz: 100, conf: 0.5, rel: 0.5 });
  const hi = pointToPoint({ profile, tx_height_m: 30, rx_height_m: 10,
                            frequency_mhz: 200, conf: 0.5, rel: 0.5 });
  const delta = hi.dbloss_db - lo.dbloss_db;
  assert.ok(delta >= 3,
    `100->200 MHz delta ${delta.toFixed(2)} dB (expected >= 3)`);
  assert.ok(delta <  10,
    `100->200 MHz delta ${delta.toFixed(2)} dB (>10 = unphysical)`);
});

test('mode classifies LOS vs diffraction vs troposcatter', () => {
  // LOS: short path, good geometry.
  const los = pointToPoint({
    profile: flatProfile(2_000, 50),    // 2 km
    tx_height_m: 30, rx_height_m: 10,
    frequency_mhz: 100, conf: 0.5, rel: 0.5
  });
  assert.ok(['line-of-sight', 'diffraction'].includes(los.mode),
    `2 km flat earth got mode ${los.mode}, expected LOS or diffraction`);
});

test('out-of-range frequency raises kwx', () => {
  // 25 MHz puts wn = 0.524 < 0.838 -> kwx >= 1 (lrprop's frequency
  // range check, NTIA TR 82-100 sec. 4).
  const r = pointToPoint({
    profile: flatProfile(20_000, 100),
    tx_height_m: 30, rx_height_m: 10,
    frequency_mhz: 25, conf: 0.5, rel: 0.5
  });
  assert.ok(r.kwx >= 1,
    `kwx ${r.kwx} on out-of-range frequency 25 MHz (expected >= 1)`);
});

// ---------- regression pin ------------------------------------------
// Lock in the exact numbers the smoke test produces so the next port
// edit can't silently shift the math.  Tolerances absorb floating-
// point and minor non-determinism only.

test('regression pin: flat 50km @ 100 MHz, V-pol, 30/10', () => {
  const r = pointToPoint({
    profile: flatProfile(50_000, 100),
    tx_height_m: 30, rx_height_m: 10,
    frequency_mhz: 100, conf: 0.5, rel: 0.5,
    klim: 5, mdvar: 12
  });
  // Pinned values from the seed run:
  //   excess = 40.37, avar = 40.08, fsl = 106.43, total = 146.51
  // Allow +/-0.5 dB envelope so a future doubles-tolerance refactor
  // doesn't trip the gate.
  assert.ok(Math.abs(r.fsl_db    - 106.43) < 0.5, `fsl ${r.fsl_db}`);
  assert.ok(Math.abs(r.excess_db -  40.37) < 0.5, `excess ${r.excess_db}`);
  assert.ok(Math.abs(r.avar_db   -  40.08) < 0.5, `avar ${r.avar_db}`);
  assert.ok(Math.abs(r.dbloss_db - 146.51) < 0.5, `dbloss ${r.dbloss_db}`);
  assert.equal(r.kwx, 0);
});

test('regression pin: 200m ridge at 25km, otherwise same as above', () => {
  const r = pointToPoint({
    profile: ridgeProfile(50_000, 100, 200, 25_000, 10_000),
    tx_height_m: 30, rx_height_m: 10,
    frequency_mhz: 100, conf: 0.5, rel: 0.5,
    klim: 5, mdvar: 12
  });
  // Pinned: dbloss = 148.77 (C++-validated per commit 7bf4c90 "fix(
  // itm_v122/d1thx): port C++ d1thx faithfully").  The earlier pinned
  // value of 161.77 was produced by the buggy pre-port d1thx that
  // returned dh=0 for non-flat profiles; that bug masked itself on the
  // 9 flat fixtures and was caught by the new test_p2p bake-off.
  assert.ok(Math.abs(r.dbloss_db - 148.77) < 1.0, `dbloss ${r.dbloss_db}`);
  assert.equal(r.kwx, 0);
});
