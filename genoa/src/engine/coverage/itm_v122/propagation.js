// JS port of NTIA's ITM v1.2.2 propagation parameter setup.
// Reference source: itwom3.0.cpp (chelstein/splat).
//
// This module owns:
//   - The prop_type / propa_type / propv_type "structs" (just plain
//     JS objects with the same field names as the C++ originals so
//     anyone reading itwom3.0.cpp can map them line-by-line).
//   - qlrps:  builds prop from frequency, refractivity, polarization,
//             dielectric / conductivity inputs.  Sets prop.wn (wave
//             number), prop.ens (surface refractivity), prop.gme
//             (effective Earth curvature), and the complex ground
//             impedance prop.zgndreal / prop.zgndimag.
//
// Calling convention: the C++ source mutates the prop struct via
// reference; we mirror that with mutable JS objects.  Callers
// typically construct an empty struct, pass it through qlrps, then
// hand it to alos / adiff / etc.

import { mymax } from './primitives.js';

// Construct a prop_type with all fields zero-initialized.  Mirrors the
// implicit constructor in itwom3.0.cpp.  Field names match C++ source.
export function makeProp(){
  return {
    aref:     0,    // path attenuation (output)
    dist:     0,    // path distance (m)
    hg:       [0, 0],
    rch:      [0, 0],
    wn:       0,    // wave number = f_MHz / 47.7
    dh:       0,    // terrain irregularity (delta-h)
    dhd:      0,
    ens:      0,    // surface refractivity
    encc:     0,
    cch:      0,
    cd:       0,
    gme:      0,    // effective Earth curvature (1/m)
    zgndreal: 0,
    zgndimag: 0,
    he:       [0, 0],
    dl:       [0, 0],
    the:      [0, 0],
    tiw:      0,
    ght:      0,
    ghr:      0,
    rph:      0,
    hht:      0,
    hhr:      0,
    tgh:      0,
    tsgh:     0,
    thera:    0,
    thenr:    0,
    rpl:      0,
    kwx:      0,    // worst-case warning
    mdp:      0,    // mode of propagation flag
    ptx:      0,
    los:      0
  };
}

export function makePropa(){
  return {
    dlsa:  0,
    dx:    0,
    ael:   0,
    ak1:   0,
    ak2:   0,
    aed:   0,
    emd:   0,
    aes:   0,
    ems:   0,
    dls:   [0, 0],
    dla:   0,
    tha:   0
  };
}

export function makePropv(){
  return {
    sgc:    0,
    lvar:   0,
    mdvar:  0,
    klim:   0
  };
}

// Port of qlrps (line 849, itwom3.0.cpp).  Sets up prop.wn, prop.ens,
// prop.gme, prop.zgndreal, prop.zgndimag from physical inputs.
//
//   fmhz   frequency in MHz
//   zsys   average system elevation above sea level (m); when 0,
//          no scaling of refractivity by altitude is applied
//   en0    surface refractivity reduced to sea level (N-units)
//   ipol   polarization: 0 = horizontal, 1 = vertical
//   eps    relative permittivity of the ground
//   sgm    ground conductivity (S/m)
export function qlrps(fmhz, zsys, en0, ipol, eps, sgm, prop){
  const gma = 157e-9;

  prop.wn  = fmhz / 47.7;
  prop.ens = en0;
  if (zsys !== 0.0) prop.ens *= Math.exp(-zsys / 9460.0);

  prop.gme = gma * (1.0 - 0.04665 * Math.exp(prop.ens / 179.3));

  // Complex ground impedance.  zq = eps + j * 376.62 * sgm / wn,
  // then prop_zgnd = sqrt(zq - 1).  When polarization is vertical
  // (ipol != 0), prop_zgnd = prop_zgnd / zq.
  const zq = { re: eps, im: 376.62 * sgm / prop.wn };
  let zgnd = csqrt({ re: zq.re - 1.0, im: zq.im });
  if (ipol !== 0) zgnd = cdiv(zgnd, zq);

  prop.zgndreal = zgnd.re;
  prop.zgndimag = zgnd.im;
}

// ---------- complex helpers (kept private to this module) ----------

// Square root of a complex number.  Standard textbook formula.
function csqrt(z){
  const r = Math.sqrt(z.re * z.re + z.im * z.im);
  const sgn = z.im >= 0 ? 1 : -1;
  return {
    re: Math.sqrt(mymax(0, (r + z.re) / 2)),
    im: sgn * Math.sqrt(mymax(0, (r - z.re) / 2))
  };
}

// Complex division.
function cdiv(a, b){
  const denom = b.re * b.re + b.im * b.im;
  return {
    re: (a.re * b.re + a.im * b.im) / denom,
    im: (a.im * b.re - a.re * b.im) / denom
  };
}

// Exposed so other modules can build complex values (e.g. in adiff).
export const cx = {
  add:   (a, b) => ({ re: a.re + b.re, im: a.im + b.im }),
  sub:   (a, b) => ({ re: a.re - b.re, im: a.im - b.im }),
  mul:   (a, b) => ({ re: a.re * b.re - a.im * b.im,
                      im: a.re * b.im + a.im * b.re }),
  div:   cdiv,
  sqrt:  csqrt,
  abs:   (z)    => Math.sqrt(z.re * z.re + z.im * z.im),
  fromReal: (x) => ({ re: x, im: 0 }),
  // Multiply complex by exponential of a pure-imaginary value.
  // exp(j*theta) = cos(theta) + j sin(theta).  Used in alos for the reflection sum.
  mulPhase: (z, theta) => ({
    re: z.re * Math.cos(theta) - z.im * Math.sin(theta),
    im: z.re * Math.sin(theta) + z.im * Math.cos(theta)
  })
};
