// JS port of ITWOM 3.0 propagation orchestrator (lrprop2).
// Reference source: itwom3.0.cpp (chelstein/splat), function lrprop2 at
// line 1234.
//
// lrprop2 is Sid Shumate's ITWOM 3.0 replacement for v1.2.2's lrprop.
// Key differences:
//
//   * Uses adiff2 / alos2 / ascat instead of adiff / alos.  saalos
//     wires in via alos2 / adiff2 - operators get canopy attenuation
//     for free if the prop fields are populated.
//
//   * Distinguishes between AREA mode (prop.tiw == 0, original NTIA
//     behavior) and ITWOM POINT-TO-POINT mode (prop.tiw > 0, set by
//     hzns2/qlrpfl2 to the profile sample spacing).  In p2p mode the
//     orchestrator returns alos2 directly for LOS distances, picks
//     adiff2 for past-1st-horizon, and chooses between adiff2 and
//     ascat at beyond-horizon distances based on which one yields
//     LESS loss (the "minimum-of-two" diffraction-vs-troposcatter
//     blend).
//
//   * Validates a slightly different set of input ranges: the[0]
//     bound is still 200 mrad, but the[1] is allowed up to 1.22 rad
//     (~70 deg) because alos2's canopy branch handles steep grazing
//     when the rx is below the canopy.
//
//   * propa.dx defaults to 2,000,000 m (2000 km) - the area-mode
//     threshold beyond which troposcatter dominates.
//
// PER-PATH STATE in C++ comes from the static doubles `wlos`, `wscat`,
// `dmin`, `xae`.  The JS port captures these in the closure returned
// by makeLrprop2().  Each (tx, rx) path needs its own closure.

import { FORTRAN_DIM, mymin, mymax, THIRD } from './primitives.js';
import { alos2 }                            from './alos2.js';
import { makeAdiff2 }                       from './diffraction2.js';
import { makeAscat }                        from './troposcatter.js';

export function makeLrprop2(){
  const adiff2 = makeAdiff2();
  const ascat  = makeAscat();

  let wlos  = false;
  let wscat = false;
  let dmin, xae;

  return function lrprop2(d, prop, propa){
    const iw  = prop.tiw;
    const pd1 = prop.dist;
    propa.dx  = 2000000.0;

    if (prop.mdp !== 0){
      // Initial priming: derived path geometry + input-range checks.
      for (let j = 0; j < 2; j++){
        propa.dls[j] = Math.sqrt(2.0 * prop.he[j] / prop.gme);
      }
      propa.dlsa = mymin(propa.dls[0] + propa.dls[1], 1000000.0);
      propa.dla  = prop.dl[0] + prop.dl[1];
      propa.tha  = mymax(prop.the[0] + prop.the[1], -propa.dla * prop.gme);
      wlos  = false;
      wscat = false;

      if (prop.wn < 0.838 || prop.wn > 210.0) prop.kwx = mymax(prop.kwx, 1);
      for (let j = 0; j < 2; j++){
        if (prop.hg[j] < 1.0 || prop.hg[j] > 1000.0) prop.kwx = mymax(prop.kwx, 1);
      }
      if (Math.abs(prop.the[0]) > 200e-3) prop.kwx = mymax(prop.kwx, 3);
      if (Math.abs(prop.the[1]) > 1.220)  prop.kwx = mymax(prop.kwx, 3);

      const zgnd_re = prop.zgndreal;
      const zgnd_im = prop.zgndimag;
      if (prop.ens < 250.0 || prop.ens > 400.0
          || prop.gme < 75e-9 || prop.gme > 250e-9
          || zgnd_re <= Math.abs(zgnd_im)
          || prop.wn < 0.419 || prop.wn > 420.0){
        prop.kwx = 4;
      }
      for (let j = 0; j < 2; j++){
        if (prop.hg[j] < 0.5 || prop.hg[j] > 3000.0) prop.kwx = 4;
      }

      dmin = Math.abs(prop.he[0] - prop.he[1]) / 200e-3;
      adiff2(0.0, prop, propa);                                // prime
      xae = Math.pow(prop.wn * (prop.gme * prop.gme), -THIRD);
      const d3 = mymax(propa.dlsa, 1.3787 * xae + propa.dla);
      const d4 = d3 + 2.7574 * xae;
      const a3 = adiff2(d3, prop, propa);
      const a4 = adiff2(d4, prop, propa);
      propa.emd = (a4 - a3) / (d4 - d3);
      propa.aed = a3 - propa.emd * d3;
    }

    if (prop.mdp >= 0){
      prop.mdp  = 0;
      prop.dist = d;
    }

    if (prop.dist > 0.0){
      if (prop.dist > 1000e3) prop.kwx = mymax(prop.kwx, 1);
      if (prop.dist < dmin)   prop.kwx = mymax(prop.kwx, 3);
      if (prop.dist < 1e3 || prop.dist > 2000e3) prop.kwx = 4;
    }

    // ---- LOS branch ------------------------------------------------
    if (prop.dist < propa.dlsa){
      if (iw <= 0.0){
        // AREA mode (iw=0).
        if (!wlos){
          alos2(0.0, prop, propa);
          const d2 = propa.dlsa;
          let   a2 = propa.aed + d2 * propa.emd;
          let   d0 = 1.908 * prop.wn * prop.he[0] * prop.he[1];

          if (propa.aed > 0.0){
            prop.aref = propa.aed + propa.emd * prop.dist;
          } else {
            let d1;
            if (propa.aed === 0.0){
              d0 = mymin(d0, 0.5 * propa.dla);
              d1 = d0 + 0.25 * (propa.dla - d0);
            } else {
              d1 = mymax(-propa.aed / propa.emd, 0.25 * propa.dla);
            }
            const a1 = alos2(d1, prop, propa);
            let wq = false;

            if (d0 < d1){
              const a0 = alos2(d0, prop, propa);
              a2 = mymin(a2, alos2(d2, prop, propa));
              const q = Math.log(d2 / d0);
              propa.ak2 = mymax(0.0,
                ((d2 - d0) * (a1 - a0) - (d1 - d0) * (a2 - a0))
                / ((d2 - d0) * Math.log(d1 / d0) - (d1 - d0) * q));
              wq = propa.aed >= 0.0 || propa.ak2 > 0.0;

              if (wq){
                propa.ak1 = (a2 - a0 - propa.ak2 * q) / (d2 - d0);
                if (propa.ak1 < 0.0){
                  propa.ak1 = 0.0;
                  propa.ak2 = FORTRAN_DIM(a2, a0) / q;
                  if (propa.ak2 === 0.0) propa.ak1 = propa.emd;
                }
              }
            }
            if (!wq){
              propa.ak1 = FORTRAN_DIM(a2, a1) / (d2 - d1);
              propa.ak2 = 0.0;
              if (propa.ak1 === 0.0) propa.ak1 = propa.emd;
            }
            propa.ael = a2 - propa.ak1 * d2 - propa.ak2 * Math.log(d2);
            wlos = true;
          }
        }
      } else {
        // ITWOM point-to-point mode (iw > 0).
        if (!wlos){
          alos2(0.0, prop, propa);  // coefficient setup
          wlos = true;
        }

        if (prop.los === 1){
          prop.aref = alos2(pd1, prop, propa);
        } else {
          if (Math.trunc(prop.dist - prop.dl[0]) === 0){
            prop.aref = 5.8 + alos2(pd1, prop, propa);
          } else if (Math.trunc(prop.dist - prop.dl[0]) > 0){
            adiff2(0.0, prop, propa);
            prop.aref = adiff2(pd1, prop, propa);
          } else {
            prop.aref = 1.0;
          }
        }
      }
    }

    // ---- Beyond-horizon branch (diffraction-extrap or troposcatter)
    if (prop.dist <= 0.0 || prop.dist >= propa.dlsa){
      if (iw === 0.0){
        // AREA mode: same shape as v1.2.2's lrprop tail.
        if (!wscat){
          ascat(0.0, prop, propa);
          const d5 = propa.dla + 200e3;
          const d6 = d5 + 200e3;
          const a6 = ascat(d6, prop, propa);
          const a5 = ascat(d5, prop, propa);

          if (a5 < 1000.0){
            propa.ems = (a6 - a5) / 200e3;
            propa.dx  = mymax(propa.dlsa,
                         mymax(propa.dla + 0.3 * xae * Math.log(47.7 * prop.wn),
                               (a5 - propa.aed - propa.ems * d5)
                               / (propa.emd - propa.ems)));
            propa.aes = (propa.emd - propa.ems) * propa.dx + propa.aed;
          } else {
            propa.ems = propa.emd;
            propa.aes = propa.aed;
            propa.dx  = 10000000;
          }
          wscat = true;
        }

        if (prop.dist > propa.dx){
          prop.aref = propa.aes + propa.ems * prop.dist;
        } else {
          prop.aref = propa.aed + propa.emd * prop.dist;
        }
      } else {
        // ITWOM mode: pick min(adiff2, ascat) at this distance.
        if (!wscat){
          ascat(0.0,  prop, propa);
          const a6 = ascat(pd1, prop, propa);
          adiff2(0.0, prop, propa);
          const a5 = adiff2(pd1, prop, propa);
          if (a5 <= a6){
            propa.dx  = 10000000;
            prop.aref = a5;
          } else {
            propa.dx  = propa.dlsa;
            prop.aref = a6;
          }
          wscat = true;
        }
      }
    }
    prop.aref = mymax(prop.aref, 0.0);
  };
}
