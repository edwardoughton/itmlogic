// JS port of NTIA's ITM v1.2.2 terrain-profile entry point (qlrpfl).
// Reference source: itwom3.0.cpp (chelstein/splat), function qlrpfl
// at line 2137.
//
// qlrpfl is the canonical "I have a terrain profile, give me ITM
// reference attenuation" entry.  Pipeline:
//
//   1. prop.dist   = profile_length * sample_spacing   (pfl[0] * pfl[1])
//   2. hzns(pfl)                  -> populates dl[], the[]
//   3. clip horizons by 15*hg or 0.1*dl  -> xl[0..1]
//   4. d1thx(pfl, xl[0], xl[1])   -> prop.dh (terrain irregularity)
//   5. branch on dl[0]+dl[1] vs 1.5*dist:
//        a) "rounded horizon / two obstructions" branch - z1sq1 over
//           the inner profile, refit he[], dl[], the[] using dh.
//        b) "two clear horizons" branch - z1sq1 over each end's outer
//           profile, set he[] = hg + max(0, ground - fitted slope).
//   6. prop.mdp = -1 (signal lrprop to re-prime), bump propv.lvar
//      based on whether climate or mdvar was overridden.
//   7. lrprop(0, prop, propa) - primes the propagation orchestrator.
//
// After qlrpfl returns, the caller can evaluate path loss at any
// distance d <= prop.dist by calling lrprop(d, prop, propa) again
// (which now hits the prop.mdp == 0 fast path inside lrprop).

import { mymin, mymax, FORTRAN_DIM } from './primitives.js';
import { hzns, z1sq1, d1thx }        from './terrain.js';
import { makeLrprop }                from './lrprop.js';

// Builds a stateful qlrpfl that owns its own lrprop closure.  Same
// per-path semantics as makeLrprop - never share a closure across
// two distinct paths.
export function makeQlrpfl(){
  const lrprop = makeLrprop();

  return function qlrpfl(pfl, klimx, mdvarx, prop, propa, propv){
    const np   = Math.trunc(pfl[0]);
    prop.dist  = pfl[0] * pfl[1];

    hzns(pfl, prop);

    const xl = [
      mymin(15.0 * prop.hg[0], 0.1 * prop.dl[0]),
      mymin(15.0 * prop.hg[1], 0.1 * prop.dl[1]),
    ];
    xl[1] = prop.dist - xl[1];
    prop.dh = d1thx(pfl, xl[0], xl[1]);

    if (prop.dl[0] + prop.dl[1] > 1.5 * prop.dist){
      // Rounded-horizon / two-obstruction branch.
      const fit = z1sq1(pfl, xl[0], xl[1]);
      prop.he[0] = prop.hg[0] + FORTRAN_DIM(pfl[2],      fit.z0);
      prop.he[1] = prop.hg[1] + FORTRAN_DIM(pfl[np + 2], fit.zn);

      for (let j = 0; j < 2; j++){
        prop.dl[j] = Math.sqrt(2.0 * prop.he[j] / prop.gme)
                   * Math.exp(-0.07 * Math.sqrt(prop.dh / mymax(prop.he[j], 5.0)));
      }

      let q = prop.dl[0] + prop.dl[1];
      if (q <= prop.dist){
        const t = prop.dist / q;
        q = t * t;
        for (let j = 0; j < 2; j++){
          prop.he[j] *= q;
          prop.dl[j]  = Math.sqrt(2.0 * prop.he[j] / prop.gme)
                      * Math.exp(-0.07 * Math.sqrt(prop.dh / mymax(prop.he[j], 5.0)));
        }
      }

      for (let j = 0; j < 2; j++){
        const qq = Math.sqrt(2.0 * prop.he[j] / prop.gme);
        prop.the[j] = (0.65 * prop.dh * (qq / prop.dl[j] - 1.0) - 2.0 * prop.he[j]) / qq;
      }
    } else {
      // Two-clear-horizon branch: separate LSQ fits at each end.
      const fitA = z1sq1(pfl, xl[0],                     0.9 * prop.dl[0]);
      const fitB = z1sq1(pfl, prop.dist - 0.9 * prop.dl[1], xl[1]);
      prop.he[0] = prop.hg[0] + FORTRAN_DIM(pfl[2],      fitA.z0);
      prop.he[1] = prop.hg[1] + FORTRAN_DIM(pfl[np + 2], fitB.zn);
    }

    prop.mdp     = -1;
    propv.lvar   = mymax(propv.lvar, 3);

    if (mdvarx >= 0){
      propv.mdvar = mdvarx;
      propv.lvar  = mymax(propv.lvar, 4);
    }
    if (klimx > 0){
      propv.klim = klimx;
      propv.lvar = 5;
    }

    lrprop(0.0, prop, propa);
    // Hand the lrprop closure back so the caller can keep evaluating
    // at additional distances on this same primed path.
    return lrprop;
  };
}
