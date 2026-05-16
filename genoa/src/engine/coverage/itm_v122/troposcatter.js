// JS port of NTIA's ITM v1.2.2 troposcatter attenuation (ascat).
// Reference source: itwom3.0.cpp (chelstein/splat), function ascat at
// line 755.  Section 6 of NTIA TR 82-100.
//
// Same priming pattern as alos / adiff: makeAscat() returns a closure
// that must be called once with d=0 to populate the per-path
// coefficients (ad, rr, etq, h0s), then evaluated along the path for
// d > 0.
//
// Returns 1001.0 (a sentinel) when the path geometry implies the
// scatter formula is invalid (very small Fresnel parameters); lrprop
// keys off this to swap to the diffraction-extrapolation branch.

import { ahd, h0f, mymin, mymax, FORTRAN_DIM } from './primitives.js';

export function makeAscat(){
  let ad, rr, etq, h0s;

  return function ascat(d, prop, propa){
    if (d === 0.0){
      ad = prop.dl[0] - prop.dl[1];
      rr = prop.he[1] / prop.rch[0];
      if (ad < 0.0){ ad = -ad; rr = 1.0 / rr; }
      etq = (5.67e-6 * prop.ens - 2.32e-3) * prop.ens + 0.031;
      h0s = -15.0;
      return 0.0;
    }

    let h0;
    if (h0s > 15.0){
      h0 = h0s;
    } else {
      const th = prop.the[0] + prop.the[1] + d * prop.gme;
      let r2 = 2.0 * prop.wn * th;
      let r1 = r2 * prop.he[0];
      r2    *= prop.he[1];

      // Fresnel parameters too small -> scatter formula invalid.
      if (r1 < 0.2 && r2 < 0.2) return 1001.0;

      let ss = (d - ad) / (d + ad);
      let q  = rr / ss;
      ss = mymax(0.1, ss);
      q  = mymin(mymax(0.1, q), 10.0);

      const z0 = (d - ad) * (d + ad) * th * 0.25 / d;
      const tmp = mymin(1.7, z0 / 8.0e3);
      const tmp6 = tmp * tmp * tmp * tmp * tmp * tmp;
      const et   = (etq * Math.exp(-tmp6) + 1.0) * z0 / 1.7556e3;

      const ett = mymax(et, 1.0);
      h0 = (h0f(r1, ett) + h0f(r2, ett)) * 0.5;
      h0 += mymin(h0, (1.38 - Math.log(ett)) * Math.log(ss) * Math.log(q) * 0.49);
      h0 = FORTRAN_DIM(h0, 0.0);

      if (et < 1.0){
        const t2 = ((1.0 + 1.4142 / r1) * (1.0 + 1.4142 / r2));
        h0 = et * h0 + (1.0 - et) * 4.343
                       * Math.log((t2 * t2) * (r1 + r2) / (r1 + r2 + 2.8284));
      }
      if (h0 > 15.0 && h0s >= 0.0) h0 = h0s;
    }

    h0s = h0;
    const th = propa.tha + d * prop.gme;
    return ahd(th * d)
         + 4.343 * Math.log(47.7 * prop.wn * (th * th * th * th))
         - 0.1 * (prop.ens - 301.0) * Math.exp(-th * d / 40e3)
         + h0;
  };
}
