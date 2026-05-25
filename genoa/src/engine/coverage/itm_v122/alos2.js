// JS port of NTIA / ITWOM 3.0 canopy-aware line-of-sight (alos2).
// Reference source: itwom3.0.cpp (chelstein/splat), function alos2 at
// line 911.
//
// alos2 is the ITWOM 3.0 replacement for v1.2.2's alos.  Differences:
//
// 1. The two-ray sum uses a phase derived from prop.ght / prop.ghr /
//    prop.rph (the actual antenna and reflection-point heights from
//    hzns2) when prop.mdp < 0, instead of the simple 1.908*wn*he[0]*he[1]/d
//    used by alos.  This better captures Fresnel-zone multipath in
//    irregular-terrain LOS paths.
//
// 2. When the rx antenna is below canopy height (prop.hg[1] < prop.cch)
//    AND the elevation angles to both horizons are below ~45 deg
//    (thera < 0.785, thenr < 0.785), saalos is added on top of the
//    LOS attenuation to model canopy traversal.
//
// 3. In the "far from transmitter, receiver below canopy" geometry,
//    the terrain irregularity coefficient `q` is reduced via a
//    canopy-related cd/cr ratio (per the source).
//
// 4. Output is clamped to alosv = mymin(22, alosv) - alos2 never
//    reports more than 22 dB of LOS excess attenuation.
//
// PRIMING PATTERN
// alos2 in the C++ source is NOT stateful (no `static` locals), so
// the JS port returns a plain function rather than a closure factory.
// The caller still primes the path through lrprop2, but per-distance
// alos2 calls don't carry state between them.

import { mymin, mymax, abq_alos } from './primitives.js';
import { cx }                     from './propagation.js';
import { saalos }                 from './canopy.js';

const PI        = 3.1415926535897;
const EARTH_R_M = 6378137.0;

export function alos2(d, prop, propa){
  const prop_zgnd = { re: prop.zgndreal, im: prop.zgndimag };

  let cd  = 0.0;
  let cr  = 0.0;
  const htg = prop.hg[0];
  const hrg = prop.hg[1];
  const ht  = prop.ght;
  const hr  = prop.ghr;
  const hrp = prop.rph;
  const pd  = prop.dist;

  if (d === 0.0) return 0.0;

  // Initial reflection-coefficient build (q is the irregularity term;
  // sps is the grazing-angle sine).
  let q   = prop.he[0] + prop.he[1];
  const sps = q / Math.sqrt(pd * pd + q * q);
  q       = (1.0 - 0.8 * Math.exp(-pd / 50e3)) * prop.dh;

  if (prop.mdp < 0){
    // Per-path ITWOM correction: when the rx is far from the tx and
    // sits below canopy height inside the tx horizon, scale the
    // irregularity statistic q by the canopy-distance ratio.
    const dr = pd / (1 + hrg / mymax(1e-9, htg));
    let drh;
    if (dr < 0.5 * pd){
      drh = EARTH_R_M
          - Math.sqrt(-Math.pow(0.5 * pd, 2) + EARTH_R_M * EARTH_R_M
                      + Math.pow(0.5 * pd - dr, 2));
    } else {
      drh = EARTH_R_M
          - Math.sqrt(-Math.pow(0.5 * pd, 2) + EARTH_R_M * EARTH_R_M
                      + Math.pow(dr - 0.5 * pd, 2));
    }
    void drh; // computed for parity; only used inside the canopy branch.

    if ((sps < 0.05) && (prop.cch > hrg) && (prop.dist < prop.dl[0])){
      cd = mymax(0.01, pd * (prop.cch - hrg) / mymax(1e-9, htg - hrg));
      cr = mymax(0.01, pd - dr + dr * (prop.cch - drh) / mymax(1e-9, htg));
      q  = ((1.0 - 0.8 * Math.exp(-pd / 50e3)) * prop.dh
              * mymin(-20 * Math.log10(cd / cr), 1.0));
    }
  }

  const s    = 0.78 * q * Math.exp(-Math.pow(q / 16.0, 0.25));
  const expDecay = Math.exp(-mymin(10.0, prop.wn * s * sps));

  // Reflection coefficient r = expDecay * (sps - zgnd)/(sps + zgnd).
  const num  = { re: sps - prop_zgnd.re, im: -prop_zgnd.im };
  const den  = { re: sps + prop_zgnd.re, im:  prop_zgnd.im };
  let r      = cx.div(num, den);
  r          = { re: r.re * expDecay, im: r.im * expDecay };

  let qabs   = abq_alos(r);
  qabs       = mymin(qabs, 1.0);
  if (qabs < 0.25 || qabs < sps){
    const scale = Math.sqrt(sps / mymax(1e-9, qabs));
    r = { re: r.re * scale, im: r.im * scale };
  }

  // Two-ray phase.  alos2 uses prop.ght / prop.ghr / prop.rph from
  // hzns2 when mdp < 0; otherwise the simple he[0]*he[1] form.
  q = prop.wn * prop.he[0] * prop.he[1] / (pd * PI);
  if (prop.mdp < 0){
    q = prop.wn * ((ht - hrp) * (hr - hrp)) / (pd * PI);
  }
  q -= Math.floor(q);
  if (q < 0.5) q *= PI;
  else         q  = (1 - q) * PI;

  // |exp(j*q) + r|^2.  Source comment: "no longer valid complex
  // conjugate removed by removing minus sign from in front of sin".
  const phase = { re: Math.cos(q), im: Math.sin(q) };
  const sum   = { re: phase.re + r.re, im: phase.im + r.im };
  const re2   = abq_alos(sum);
  let alosv   = -10 * Math.log10(re2);

  // Bookkeeping fields ITWOM uses elsewhere; mutate prop to match
  // C++ reference behavior.
  prop.tgh  = prop.hg[0];
  prop.tsgh = prop.rch[0] - prop.hg[0];

  // If the rx is below canopy and both horizon angles are < 45 deg,
  // add saalos for canopy traversal.
  if ((prop.hg[1] < prop.cch) && (prop.thera < 0.785) && (prop.thenr < 0.785)){
    if (sps < 0.05){
      alosv = alosv + saalos(pd, prop, propa);
    } else {
      alosv = saalos(pd, prop, propa);
    }
  }

  alosv = mymin(22.0, alosv);
  return alosv;
}
