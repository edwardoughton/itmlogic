// JS port of NTIA's ITM v1.2.2 extended-range diffraction (adiff).
// Reference source: itwom3.0.cpp (chelstein/splat), function adiff
// at line 421.
//
// Two-mode usage, faithful to the C++ source:
//   makeAdiff()  -> returns a stateful function adiff(d, prop, propa).
//   First call MUST pass d=0 - that branch initialises the per-path
//   coefficients (wd1, xd1, afo, qk, aht, xht) which are then reused
//   on every subsequent d>0 call.  Mirrors the C++ `static double`s
//   inside adiff().
//
// The stateful pattern is necessary because the v1.2.2 reference
// computes those coefficients only once per p2p path, then evaluates
// the diffraction loss at many distances along it.

import { aknfe, fht, mymin, FORTRAN_DIM, THIRD } from './primitives.js';
import { cx } from './propagation.js';

export function makeAdiff(){
  // Per-path memoised state.  Initialised on the d=0 call.
  let wd1, xd1, afo, qk, aht, xht;

  return function adiff(d, prop, propa){
    const prop_zgnd = { re: prop.zgndreal, im: prop.zgndimag };

    if (d === 0){
      let q  = prop.hg[0] * prop.hg[1];
      qk     = prop.he[0] * prop.he[1] - q;

      if (prop.mdp < 0.0) q += 10.0;

      wd1 = Math.sqrt(1.0 + qk / q);
      xd1 = propa.dla + propa.tha / prop.gme;

      q   = (1.0 - 0.8 * Math.exp(-propa.dlsa / 50e3)) * prop.dh;
      q  *= 0.78 * Math.exp(-Math.pow(q / 16.0, 0.25));

      afo = mymin(15.0, 2.171 * Math.log(1.0
              + 4.77e-4 * prop.hg[0] * prop.hg[1] * prop.wn * q));
      qk  = 1.0 / cx.abs(prop_zgnd);
      aht = 20.0;
      xht = 0.0;

      for (let j = 0; j < 2; j++){
        const a  = 0.5 * (prop.dl[j] * prop.dl[j]) / prop.he[j];
        const wa = Math.pow(a * prop.wn, THIRD);
        const pk = qk / wa;
        const qq = (1.607 - pk) * 151.0 * wa * prop.dl[j] / a;
        xht += qq;
        aht += fht(qq, pk);
      }
      return 0.0;
    }

    // d > 0 path.
    const th  = propa.tha + d * prop.gme;
    const ds  = d - propa.dla;
    let q     = 0.0795775 * prop.wn * ds * th * th;

    let adiffv = aknfe(q * prop.dl[0] / (ds + prop.dl[0]))
               + aknfe(q * prop.dl[1] / (ds + prop.dl[1]));

    const a   = ds / th;
    const wa  = Math.pow(a * prop.wn, THIRD);
    const pk  = qk / wa;
    q         = (1.607 - pk) * 151.0 * wa * th + xht;

    const ar  = 0.05751 * q - 4.343 * Math.log(q) - aht;

    q         = (wd1 + xd1 / d)
              * mymin(((1.0 - 0.8 * Math.exp(-d / 50e3)) * prop.dh * prop.wn), 6283.2);
    const wd  = 25.1 / (25.1 + Math.sqrt(q));

    adiffv    = ar * wd + (1.0 - wd) * adiffv + afo;
    // FORTRAN_DIM is imported for symmetry with the C++ source,
    // but adiff doesn't actually use it on the hot path.
    void FORTRAN_DIM;

    return adiffv;
  };
}
