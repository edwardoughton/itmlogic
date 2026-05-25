// JS port of ITWOM 3.0 d1thx2.
// Reference source: itwom3.0.cpp (chelstein/splat), function d1thx2 at
// line 2082.
//
// d1thx2 computes terrain irregularity (delta-h) the same way d1thx
// does - uniform sub-sampling, 10/90 percentile via qtile - but with
// two ITWOM corrections:
//
//   1. The sampled profile is detrended by z1sq2 before percentile
//      extraction.  Without this, a continuous ramp dominates the
//      percentile spread and inflates delta-h to a meaningless
//      value.
//   2. ka is upper-bounded by kmx = max(25, 83350/spacing) so very
//      tight sample spacings don't produce O(very-large) percentile
//      buffers.
//
// Used by qlrpfl2 to populate prop.dh.

import { mymin, mymax } from './primitives.js';
import { z1sq2, qtile } from './terrain.js';

export function d1thx2(pfl, x1, x2, _propa){
  const np = Math.trunc(pfl[0]);
  const xa = x1 / pfl[1];
  const xb = x2 / pfl[1];
  let d1thx2v = 0.0;
  if (xb - xa < 2.0) return d1thx2v;

  let ka      = Math.trunc(0.1 * (xb - xa + 8.0));
  const kmx   = mymax(25, Math.trunc(83350 / pfl[1]));
  ka          = mymin(mymax(4, ka), kmx);
  const n     = 10 * ka - 5;
  const kb    = n - ka + 1;
  const sn    = n - 1;

  // Mini profile to feed z1sq2 + qtile.  Format mirrors pfl[].
  const s = new Array(n + 2);
  s[0] = sn;
  s[1] = 1.0;
  let xb2 = (xb - xa) / sn;
  let k   = Math.trunc(xa + 1.0);
  let xc  = xa - k;

  for (let j = 0; j < n; j++){
    while (xc > 0.0 && k < np){
      xc -= 1.0;
      k++;
    }
    s[j + 2] = pfl[k + 2] + (pfl[k + 2] - pfl[k + 1]) * xc;
    xc      += xb2;
  }

  // Detrend via least-squares, in place.
  const fit = z1sq2(s, 0.0, sn);
  let xa2   = fit.z0;
  xb2       = (fit.zn - fit.z0) / sn;

  for (let j = 0; j < n; j++){
    s[j + 2] -= xa2;
    xa2 += xb2;
  }

  // Reusable buffer for qtile (it sorts in place).  qtile in this
  // codebase indexes a[] starting at 0 - we strip the [np, xi] header.
  const tail = s.slice(2);
  d1thx2v = qtile(n - 1, tail, ka - 1) - qtile(n - 1, tail, kb - 1);
  d1thx2v /= 1.0 - 0.8 * Math.exp(-(x2 - x1) / 50.0e3);
  return d1thx2v;
}
