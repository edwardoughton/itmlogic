// JS port of NTIA's ITM v1.2.2 / ITWOM 3.0 small primitive functions.
// Reference source: itwom3.0.cpp (chelstein/splat).
//
// SCOPE
//   These are the leaf-level scalar helpers used throughout the
//   Longley-Rice point-to-point and area-prediction codepaths.  Each
//   one is a faithful translation of the C++ original; the math is
//   not paraphrased, only re-expressed in JS.  No JS-side abstractions
//   are layered on top (no complex-number classes, no struct wrappers
//   beyond plain objects) - staying close to the source is essential
//   for cross-validating against splat sidecar output.
//
// CONVENTIONS
//   complex<double>(a, b)  ->  { re: a, im: b }
//   pow / exp / log / sqrt ->  Math.*
//   FORTRAN_DIM(x, y)      ->  diff-or-zero (FORTRAN's positive difference)
//   `static double` state  ->  module-level let, memoized across calls.
//
// NOT YET PORTED
//   avar (variability stats), ascat (troposcatter), qlrpfl (terrain
//   orchestrator), z1sq1 / z1sq2 (least-squares fit), hzns (horizon
//   geometry).  These land in follow-up commits.

export const THIRD = 1.0 / 3.0;

export function mymin(a, b){ return a < b ? a : b; }
export function mymax(a, b){ return a > b ? a : b; }

// FORTRAN's DIM: x - y when x > y, else 0.
export function FORTRAN_DIM(x, y){
  return x > y ? x - y : 0.0;
}

// Knife-edge attenuation, eq. 4.20 in NTIA TR 82-100.
// v2 is the squared Fresnel-Kirchhoff diffraction parameter.
export function aknfe(v2){
  if (v2 < 5.76) return 6.02 + 9.11 * Math.sqrt(v2) - 1.27 * v2;
  return 12.953 + 10 * Math.log10(v2);
}

// Smooth-Earth diffraction "F" function (Vogler 1964).
// Used by adiff to evaluate the height-gain.
export function fht(x, pk){
  let w, fhtv;
  if (x < 200.0){
    w = -Math.log(pk);
    if (pk < 1.0e-5 || x * w * w * w > 5495.0){
      fhtv = -117.0;
      if (x > 1.0) fhtv = 40.0 * Math.log10(x) + fhtv;
    } else {
      fhtv = 2.5e-5 * x * x / pk - 8.686 * w - 15.0;
    }
  } else {
    fhtv = 0.05751 * x - 10.0 * Math.log10(x);
    if (x < 2000.0){
      w = 0.0134 * x * Math.exp(-0.005 * x);
      fhtv = (1.0 - w) * fhtv + w * (40.0 * Math.log10(x) - 117.0);
    }
  }
  return fhtv;
}

// Troposcatter's H_0 helper, NTIA TR 82-100 eq. 6.10.
export function h0f(r, et){
  const a = [25.0, 80.0, 177.0, 395.0, 705.0];
  const b = [24.0, 45.0,  68.0,  80.0, 105.0];
  let it = Math.trunc(et);
  let q;
  if (it <= 0){ it = 1; q = 0.0; }
  else if (it >= 5){ it = 5; q = 0.0; }
  else q = et - it;
  const temp = 1.0 / r;
  const x = temp * temp;
  let h0fv = 4.343 * Math.log((a[it - 1] * x + b[it - 1]) * x + 1.0);
  if (q !== 0.0){
    h0fv = (1.0 - q) * h0fv + q * 4.343 * Math.log((a[it] * x + b[it]) * x + 1.0);
  }
  return h0fv;
}

// Troposcatter horizon-distance attenuation, NTIA TR 82-100 sec. 6.
export function ahd(td){
  const a = [   133.4,    104.6,     71.8];
  const b = [0.332e-3, 0.212e-3, 0.157e-3];
  const c = [  -4.343,   -1.086,    2.171];
  let i;
  if (td <= 10e3) i = 0;
  else if (td <= 70e3) i = 1;
  else i = 2;
  return a[i] + b[i] * td + c[i] * Math.log(td);
}

// |r|^2 for a complex r - used by alos2 reflection coefficient.
export function abq_alos(r){
  return r.re * r.re + r.im * r.im;
}

// Standard normal CDF, NTIA TR 82-100 sec. 9.
// Used by avar (variability) - included now so qerfi can land cleanly.
export function qerf(z){
  const b1 =  0.319381530;
  const b2 = -0.356563782;
  const b3 =  1.781477937;
  const b4 = -1.821255987;
  const b5 =  1.330274429;
  const rrt2pi = 0.398942280;
  const x = z;
  const t = Math.abs(x);
  let qerfv;
  if (t >= 10.0){
    qerfv = 0.0;
  } else {
    const tt = 1.0 / (1.0 + 0.2316419 * t);
    qerfv = Math.exp(-0.5 * x * x) * rrt2pi
            * ((((b5 * tt + b4) * tt + b3) * tt + b2) * tt + b1) * tt;
  }
  if (x < 0.0) qerfv = 1.0 - qerfv;
  return qerfv;
}

// Inverse of qerf.  Beasley-Springer / Moro hybrid (Hastings 1955).
export function qerfi(q){
  const c0 = 2.515516698;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;
  const x = 0.5 - q;
  let t = mymax(0.5 - Math.abs(x), 0.000001);
  t = Math.sqrt(-2.0 * Math.log(t));
  const v = t - ((c2 * t + c1) * t + c0) / (((d3 * t + d2) * t + d1) * t + 1.0);
  return x < 0.0 ? -v : v;
}

// Linear interpolation/extrapolation between (x1, c1) and (x2, c2).
// Used by avar.
export function curve(c1, c2, x1, x2, x3, de){
  return (c1 + c2 / (1.0 + Math.pow((de - x2) / x3, 2.0))) * Math.pow(de / x1, 2.0)
       / (1.0 + Math.pow(de / x1, 2.0));
}
