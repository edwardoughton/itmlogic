// JS port of NTIA's ITM v1.2.2 propagation orchestrator (lrprop).
// Reference source: itwom3.0.cpp (chelstein/splat), function lrprop at
// line 1054.
//
// lrprop is the heart of point-to-point ITM:
//   - On the first call (prop.mdp != 0) it primes alos/adiff/ascat for
//     this path, computes propa.dlsa / dla / tha, validates inputs (sets
//     prop.kwx warning levels), and bootstraps the diffraction
//     extrapolation coefficients propa.aed / propa.emd from two probe
//     calls to adiff at d3 and d4 = d3 + 2.7574 * xae.
//   - On subsequent calls (prop.mdp == 0) it just selects the right
//     attenuation function for the requested distance d:
//       d <  dlsa             -> alos (line-of-sight, with the smooth
//                                two-ray sum + slope/intercept fit ak1,
//                                ak2, ael bridging a0/a1/a2).
//       d >= dlsa             -> ascat (troposcatter); falls back to
//                                diffraction-extrapolation aed+emd*d
//                                when ascat returns the 1001 sentinel.
//
// The C++ uses three `static` flags (wlos, wscat, dmin, xae) to memo
// per-path state.  We capture those in the closure returned by
// makeLrprop().  This means each path needs its own makeLrprop() call,
// matching the per-path semantics of the C++ source - never share a
// closure across two different (tx, rx) paths.

import { FORTRAN_DIM, mymin, mymax, THIRD } from './primitives.js';
import { makeAlos }       from './alos.js';
import { makeAdiff }      from './diffraction.js';
import { makeAscat }      from './troposcatter.js';

export function makeLrprop(){
  const alos  = makeAlos();
  const adiff = makeAdiff();
  const ascat = makeAscat();

  let wlos  = false;
  let wscat = false;
  let dmin, xae;

  return function lrprop(d, prop, propa){
    if (prop.mdp !== 0){
      // First call for this path: prime everything.
      for (let j = 0; j < 2; j++){
        propa.dls[j] = Math.sqrt(2.0 * prop.he[j] / prop.gme);
      }
      propa.dlsa = propa.dls[0] + propa.dls[1];
      propa.dla  = prop.dl[0]   + prop.dl[1];
      propa.tha  = mymax(prop.the[0] + prop.the[1], -propa.dla * prop.gme);
      wlos  = false;
      wscat = false;

      // Range validity warnings (set kwx to 1 / 3 / 4 increasingly).
      if (prop.wn < 0.838 || prop.wn > 210.0) prop.kwx = mymax(prop.kwx, 1);
      for (let j = 0; j < 2; j++){
        if (prop.hg[j] < 1.0 || prop.hg[j] > 1000.0) prop.kwx = mymax(prop.kwx, 1);
      }
      for (let j = 0; j < 2; j++){
        if (Math.abs(prop.the[j]) > 200e-3
            || prop.dl[j] < 0.1 * propa.dls[j]
            || prop.dl[j] > 3.0 * propa.dls[j]){
          prop.kwx = mymax(prop.kwx, 3);
        }
      }
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
      adiff(0.0, prop, propa);                            // prime adiff
      xae  = Math.pow(prop.wn * (prop.gme * prop.gme), -THIRD);
      const d3 = mymax(propa.dlsa, 1.3787 * xae + propa.dla);
      const d4 = d3 + 2.7574 * xae;
      const a3 = adiff(d3, prop, propa);
      const a4 = adiff(d4, prop, propa);
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

    // ---- Line-of-sight branch -------------------------------------
    if (prop.dist < propa.dlsa){
      if (!wlos){
        alos(0.0, prop, propa);                           // prime alos
        const d2 = propa.dlsa;
        const a2 = propa.aed + d2 * propa.emd;
        let d0 = 1.908 * prop.wn * prop.he[0] * prop.he[1];
        let d1;

        if (propa.aed >= 0.0){
          d0 = mymin(d0, 0.5 * propa.dla);
          d1 = d0 + 0.25 * (propa.dla - d0);
        } else {
          d1 = mymax(-propa.aed / propa.emd, 0.25 * propa.dla);
        }

        const a1 = alos(d1, prop, propa);
        let wq = false;

        if (d0 < d1){
          const a0 = alos(d0, prop, propa);
          const q  = Math.log(d2 / d0);
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
          } else {
            propa.ak2 = 0.0;
            propa.ak1 = (a2 - a1) / (d2 - d1);
            if (propa.ak1 <= 0.0) propa.ak1 = propa.emd;
          }
        } else {
          propa.ak1 = (a2 - a1) / (d2 - d1);
          propa.ak2 = 0.0;
          if (propa.ak1 <= 0.0) propa.ak1 = propa.emd;
        }

        propa.ael = a2 - propa.ak1 * d2 - propa.ak2 * Math.log(d2);
        wlos = true;
      }

      if (prop.dist > 0.0){
        prop.aref = propa.ael
                  + propa.ak1 * prop.dist
                  + propa.ak2 * Math.log(prop.dist);
      }
    }

    // ---- Beyond-horizon branch (diffraction-extrap + troposcatter) -
    if (prop.dist <= 0.0 || prop.dist >= propa.dlsa){
      if (!wscat){
        ascat(0.0, prop, propa);                          // prime ascat
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
          propa.dx  = 10.0e6;
        }
        wscat = true;
      }

      if (prop.dist > propa.dx){
        prop.aref = propa.aes + propa.ems * prop.dist;
      } else {
        prop.aref = propa.aed + propa.emd * prop.dist;
      }
    }

    prop.aref = mymax(prop.aref, 0.0);
  };
}
