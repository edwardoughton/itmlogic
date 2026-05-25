// JS port of NTIA's ITM v1.2.2 line-of-sight attenuation (alos).
// Reference source: itwom3.0.cpp (chelstein/splat), function alos at
// line 872.
//
// Same stateful pattern as adiff: makeAlos() returns a function that
// must be called once with d=0 to initialise wls (the LOS-coefficient
// memo), then with d>0 for each evaluation along the path.
//
// alos2 (the alternate canopy-aware variant) is NOT ported here yet -
// it depends on prop.cch / prop.ght / prop.ghr fields that aren't
// populated by qlrps.  Adding alos2 means extending the prop_type
// initialiser; deferred to follow-up.

import { mymin, mymax, abq_alos } from './primitives.js';
import { cx } from './propagation.js';

export function makeAlos(){
  let wls;

  return function alos(d, prop, propa){
    const prop_zgnd = { re: prop.zgndreal, im: prop.zgndimag };

    if (d === 0.0){
      wls = 0.021 / (0.021 + prop.wn * prop.dh / mymax(10e3, propa.dlsa));
      return 0.0;
    }

    let q   = (1.0 - 0.8 * Math.exp(-d / 50e3)) * prop.dh;
    const s = 0.78 * q * Math.exp(-Math.pow(q / 16.0, 0.25));

    q       = prop.he[0] + prop.he[1];
    const sps = q / Math.sqrt(d * d + q * q);

    // Reflection coefficient r = (sps - zgnd)/(sps + zgnd) * exp(-min(10, wn*s*sps)).
    const num = { re: sps - prop_zgnd.re, im: -prop_zgnd.im };
    const den = { re: sps + prop_zgnd.re, im:  prop_zgnd.im };
    let r     = cx.div(num, den);
    const expDecay = Math.exp(-mymin(10.0, prop.wn * s * sps));
    r         = { re: r.re * expDecay, im: r.im * expDecay };

    const qabs = abq_alos(r);
    if (qabs < 0.25 || qabs < sps){
      const scale = Math.sqrt(sps / qabs);
      r = { re: r.re * scale, im: r.im * scale };
    }

    let alosv = propa.emd * d + propa.aed;

    q = prop.wn * prop.he[0] * prop.he[1] * 2.0 / d;
    if (q > 1.57) q = 3.14 - 2.4649 / q;

    // Final two-ray sum:
    //   alosv = (-4.343 * log( |exp(-jq) + r|^2 ) - alosv) * wls + alosv
    // where exp(-jq) = cos(q) - j sin(q).
    const phase = { re: Math.cos(q), im: -Math.sin(q) };
    const sum   = { re: phase.re + r.re, im: phase.im + r.im };
    const a2    = abq_alos(sum);
    alosv       = (-4.343 * Math.log(a2) - alosv) * wls + alosv;

    return alosv;
  };
}
