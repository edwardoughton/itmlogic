// JS port of ITWOM 3.0 terrain-profile entry (qlrpfl2).
// Reference source: itwom3.0.cpp (chelstein/splat), function qlrpfl2 at
// line 2209.
//
// qlrpfl2 is Sid Shumate's ITWOM 3.0 replacement for v1.2.2's qlrpfl.
// Key differences:
//
//   * Uses hzns2 (LOS-aware horizon geometry + reflection point) and
//     d1thx2 (z1sq2-detrended delta-h) instead of hzns / d1thx.
//   * Populates prop.rch[0]/[1] (transmitter / receiver site
//     above-mean-sea-level reference heights) so saalos can compute
//     hone correctly.
//   * Branches on (np < 1) || (pfl[1] > 150) to detect "transhorizon
//     or coarse-spacing" paths and fall back to the v1.2.2-style LSQ
//     fit + effective-height refit.
//   * For ITWOM-grade fine-spacing paths: sets prop.he[0/1] directly
//     to hg + first/last sample (no LSQ detrend), computes the rx
//     approach angles prop.thera and prop.thenr from the last 500 m
//     of the profile via z1sq2, and lets lrprop2 take over.
//   * Always primes lrprop2 (not lrprop) - so alos2 / adiff2 / saalos
//     are the active propagation models.

import { mymin, mymax, FORTRAN_DIM } from './primitives.js';
import { hzns2, z1sq2 }              from './terrain.js';
import { d1thx2 }                    from './terrain2.js';
import { makeLrprop2 }               from './lrprop2.js';

export function makeQlrpfl2(){
  const lrprop2 = makeLrprop2();

  return function qlrpfl2(pfl, klimx, mdvarx, prop, propa, propv){
    const np   = Math.trunc(pfl[0]);
    prop.dist  = pfl[0] * pfl[1];

    hzns2(pfl, prop, propa);
    const dlb = prop.dl[0] + prop.dl[1];
    prop.rch[0] = prop.hg[0] + pfl[2];
    prop.rch[1] = prop.hg[1] + pfl[np + 2];

    const xl = [
      mymin(15.0 * prop.hg[0], 0.1 * prop.dl[0]),
      mymin(15.0 * prop.hg[1], 0.1 * prop.dl[1]),
    ];
    xl[1] = prop.dist - xl[1];

    prop.dh = d1thx2(pfl, xl[0], xl[1], propa);

    if ((np < 1) || (pfl[1] > 150.0)){
      // Transhorizon / coarse-spacing branch - same shape as qlrpfl.
      if (dlb < 1.5 * prop.dist){
        const fitA = z1sq2(pfl, xl[0],                     0.9 * prop.dl[0]);
        const fitB = z1sq2(pfl, prop.dist - 0.9 * prop.dl[1], xl[1]);
        prop.he[0] = prop.hg[0] + FORTRAN_DIM(pfl[2],      fitA.z0);
        prop.he[1] = prop.hg[1] + FORTRAN_DIM(pfl[np + 2], fitB.zn);
      } else {
        // LOS-style refit using z1sq2 over the inner profile.
        const fit = z1sq2(pfl, xl[0], xl[1]);
        prop.he[0] = prop.hg[0] + FORTRAN_DIM(pfl[2],      fit.z0);
        prop.he[1] = prop.hg[1] + FORTRAN_DIM(pfl[np + 2], fit.zn);

        for (let j = 0; j < 2; j++){
          prop.dl[j] = Math.sqrt(2.0 * prop.he[j] / prop.gme)
                     * Math.exp(-0.07 * Math.sqrt(prop.dh / mymax(prop.he[j], 5.0)));
        }
        let q = 1.0;
        if ((prop.dl[0] + prop.dl[1]) <= prop.dist){
          const t = prop.dist / mymax(1e-9, prop.dl[0] + prop.dl[1]);
          q = t * t;
        }
        for (let j = 0; j < 2; j++){
          prop.he[j] *= q;
          prop.dl[j]  = Math.sqrt(2.0 * prop.he[j] / prop.gme)
                      * Math.exp(-0.07 * Math.sqrt(prop.dh / mymax(prop.he[j], 5.0)));
        }
        for (let j = 0; j < 2; j++){
          const qq = Math.sqrt(2.0 * prop.he[j] / prop.gme);
          prop.the[j] = (0.65 * prop.dh * (qq / prop.dl[j] - 1.0) - 2.0 * prop.he[j]) / qq;
        }
      }
    } else {
      // ITWOM fine-spacing branch: he[0]/[1] = first/last elevation
      // sample directly, plus rx approach angles thera (over last
      // 500 m via z1sq2) and thenr (last-two-samples slope).
      prop.he[0] = prop.hg[0] + pfl[2];
      prop.he[1] = prop.hg[1] + pfl[np + 2];

      let rae1 = 0.0, rae2 = 0.0;
      if (prop.dist > 550.0){
        const fit = z1sq2(pfl, prop.dist - 500.0, prop.dist);
        rae1 = fit.z0;
        rae2 = fit.zn;
      }
      prop.thera = Math.atan(Math.abs(rae2 - rae1) / prop.dist);
      if (rae2 < rae1) prop.thera = -prop.thera;
      prop.thenr = Math.atan(mymax(0.0, pfl[np + 2] - pfl[np + 1]) / pfl[1]);
    }

    prop.mdp   = -1;
    propv.lvar = mymax(propv.lvar, 3);

    if (mdvarx >= 0){
      propv.mdvar = mdvarx;
      propv.lvar  = mymax(propv.lvar, 4);
    }
    if (klimx > 0){
      propv.klim = klimx;
      propv.lvar = 5;
    }

    lrprop2(0.0, prop, propa);
    return lrprop2;
  };
}
