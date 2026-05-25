// JS port of NTIA's ITM v1.2.2 variability stats (avar).
// Reference source: itwom3.0.cpp (chelstein/splat), function avar at
// line 1503.  Section 9 of NTIA TR 82-100.
//
// avar produces the time/location/situation-confidence-adjusted path
// loss given the median reference attenuation prop.aref (from lrprop).
// Three quantiles drive the answer:
//   zzt  -- time variability (fraction-of-time)
//   zzl  -- location variability (fraction-of-locations)
//   zzc  -- situation/confidence
// All are normal-deviate inputs (i.e. qerfi(p) for the desired
// percentile p in [0..1]).
//
// Climate keys (propv.klim, 1..7):
//   1 Equatorial            5 Continental Temperate
//   2 Continental Subtropical 6 Maritime Temperate Over Land
//   3 Maritime Subtropical    7 Maritime Temperate Over Sea
//   4 Desert
//
// Mode-of-variability key propv.mdvar selects which of the three
// quantiles are coupled (single-message, individual, mobile, broadcast)
// and whether station-deviate or location-deviate handling applies.
// See the C++ source comments at the top of avar() for the bit-packed
// encoding: `kdv = mdvar mod 10`, `w1 = kdv >= 10 (location)`, `ws =
// kdv >= 20 (situation)`.

import { mymax, mymin, curve } from './primitives.js';

// Per-climate constants.  Index = klim - 1.  Names match the C++
// arrays one-for-one so anyone reading itwom3.0.cpp can map them.
const BV1  = [-9.67, -0.62,  1.26, -9.21, -0.62, -0.39,    3.15];
const BV2  = [12.7,   9.19, 15.5,   9.05,  9.19,  2.86,  857.9];
const XV1  = [144.9e3, 228.9e3, 262.6e3,  84.1e3, 228.9e3, 141.7e3, 2222.0e3];
const XV2  = [190.3e3, 205.2e3, 185.2e3, 101.1e3, 205.2e3, 315.9e3,  164.8e3];
const XV3  = [133.8e3, 143.6e3,  99.8e3,  98.6e3, 143.6e3, 167.4e3,  116.3e3];
const BSM1 = [2.13, 2.66, 6.11, 1.98, 2.68, 6.86,   8.51];
const BSM2 = [159.5, 7.67, 6.65, 13.11, 7.16, 10.38, 169.8];
const XSM1 = [762.2e3, 100.4e3, 138.2e3, 139.1e3,  93.7e3, 187.8e3, 609.8e3];
const XSM2 = [123.6e3, 172.5e3, 242.2e3, 132.7e3, 186.8e3, 169.6e3, 119.9e3];
const XSM3 = [ 94.5e3, 136.4e3, 178.6e3, 193.5e3, 133.5e3, 108.9e3, 106.6e3];
const BSP1 = [2.11,  6.87, 10.08, 3.68, 4.75, 8.58, 8.43];
const BSP2 = [102.3, 15.53, 9.60, 159.3, 8.12, 13.97, 8.19];
const XSP1 = [636.9e3, 138.7e3, 165.3e3, 464.4e3,  93.2e3, 216.0e3, 136.2e3];
const XSP2 = [134.8e3, 143.7e3, 225.7e3,  93.1e3, 135.9e3, 152.0e3, 188.5e3];
const XSP3 = [ 95.6e3,  98.6e3, 129.7e3,  94.2e3, 113.4e3, 122.7e3, 122.9e3];
const BSD1 = [1.224, 0.801, 1.380, 1.000, 1.224, 1.518, 1.518];
const BZD1 = [1.282, 2.161, 1.282, 20.0,  1.282, 1.282, 1.282];
const BFM1 = [1.0,   1.0,   1.0,   1.0,   0.92,  1.0,   1.0];
const BFM2 = [0.0,   0.0,   0.0,   0.0,   0.25,  0.0,   0.0];
const BFM3 = [0.0,   0.0,   0.0,   0.0,   1.77,  0.0,   0.0];
const BFP1 = [1.0,   0.93,  1.0,   0.93,  0.93,  1.0,   1.0];
const BFP2 = [0.0,   0.31,  0.0,   0.19,  0.31,  0.0,   0.0];
const BFP3 = [0.0,   2.00,  0.0,   1.79,  2.00,  0.0,   0.0];

const THIRD = 1.0 / 3.0;

// makeAvar() returns a closure with all the C++ `static double`s
// captured in scope.  The C++ uses `propv.lvar` as a re-init hint
// (4 = re-pull climate constants, 3 = re-pull frequency-dependent gm/gp,
// 2 = re-pull effective-distance dexa, 1 = re-pull de).  Lower lvar
// values cascade through higher cases via fallthrough, matching the
// switch/fallthrough pattern in the C++ verbatim.
export function makeAvar(){
  let kdv;
  let dexa, de;
  let vmd, vs0, sgl, sgtm, sgtp, sgtd, tgtd, gm, gp;
  let cv1, cv2, yv1, yv2, yv3;
  let csm1, csm2, ysm1, ysm2, ysm3;
  let csp1, csp2, ysp1, ysp2, ysp3;
  let csd1, zd, cfm1, cfm2, cfm3, cfp1, cfp2, cfp3;
  let ws, w1;

  return function avar(zzt, zzl, zzc, prop, propv){
    const rt = 7.8;
    const rl = 24.0;
    let temp_klim = propv.klim - 1;

    if (propv.lvar > 0){
      const lvar = propv.lvar;

      if (lvar >= 4 || propv.klim <= 0 || propv.klim > 7){
        if (propv.klim <= 0 || propv.klim > 7){
          propv.klim = 5;
          temp_klim   = 4;
          prop.kwx    = mymax(prop.kwx, 2);
        }
        cv1  = BV1[temp_klim];   cv2  = BV2[temp_klim];
        yv1  = XV1[temp_klim];   yv2  = XV2[temp_klim];   yv3 = XV3[temp_klim];
        csm1 = BSM1[temp_klim];  csm2 = BSM2[temp_klim];
        ysm1 = XSM1[temp_klim];  ysm2 = XSM2[temp_klim];  ysm3 = XSM3[temp_klim];
        csp1 = BSP1[temp_klim];  csp2 = BSP2[temp_klim];
        ysp1 = XSP1[temp_klim];  ysp2 = XSP2[temp_klim];  ysp3 = XSP3[temp_klim];
        csd1 = BSD1[temp_klim];  zd   = BZD1[temp_klim];
        cfm1 = BFM1[temp_klim];  cfm2 = BFM2[temp_klim];  cfm3 = BFM3[temp_klim];
        cfp1 = BFP1[temp_klim];  cfp2 = BFP2[temp_klim];  cfp3 = BFP3[temp_klim];
      }

      if (lvar >= 4){
        kdv = propv.mdvar;
        ws  = kdv >= 20;
        if (ws) kdv -= 20;
        w1  = kdv >= 10;
        if (w1) kdv -= 10;
        if (kdv < 0 || kdv > 3){
          kdv = 0;
          prop.kwx = mymax(prop.kwx, 2);
        }
      }

      if (lvar >= 3){
        const q = Math.log(0.133 * prop.wn);
        gm = cfm1 + cfm2 / ((cfm3 * q * cfm3 * q) + 1.0);
        gp = cfp1 + cfp2 / ((cfp3 * q * cfp3 * q) + 1.0);
      }

      if (lvar >= 2){
        dexa = Math.sqrt(18e6 * prop.he[0])
             + Math.sqrt(18e6 * prop.he[1])
             + Math.pow(575.7e12 / prop.wn, THIRD);
      }

      if (lvar >= 1){
        if (prop.dist < dexa) de = 130e3 * prop.dist / dexa;
        else                  de = 130e3 + prop.dist - dexa;
      }

      vmd  = curve(cv1,  cv2,  yv1,  yv2,  yv3,  de);
      sgtm = curve(csm1, csm2, ysm1, ysm2, ysm3, de) * gm;
      sgtp = curve(csp1, csp2, ysp1, ysp2, ysp3, de) * gp;
      sgtd = sgtp * csd1;
      tgtd = (sgtp - sgtd) * zd;

      if (w1) sgl = 0.0;
      else {
        const q = (1.0 - 0.8 * Math.exp(-prop.dist / 50e3)) * prop.dh * prop.wn;
        sgl = 10.0 * q / (q + 13.0);
      }

      if (ws) vs0 = 0.0;
      else {
        const t = 5.0 + 3.0 * Math.exp(-de / 100e3);
        vs0 = t * t;
      }

      propv.lvar = 0;
    }

    let zt = zzt, zl = zzl, zc = zzc;

    switch (kdv){
      case 0: zt = zc; zl = zc; break;
      case 1: zl = zc;          break;
      case 2: zl = zt;          break;
    }

    if (Math.abs(zt) > 3.1 || Math.abs(zl) > 3.1 || Math.abs(zc) > 3.1){
      prop.kwx = mymax(prop.kwx, 1);
    }

    let sgt;
    if      (zt < 0.0)   sgt = sgtm;
    else if (zt <= zd)   sgt = sgtp;
    else                 sgt = sgtd + tgtd / zt;

    const t1 = sgt * zt;
    const t2 = sgl * zl;
    const vs = vs0
             + (t1 * t1) / (rt + zc * zc)
             + (t2 * t2) / (rl + zc * zc);

    let yr;
    if (kdv === 0){
      yr = 0.0;
      propv.sgc = Math.sqrt(sgt * sgt + sgl * sgl + vs);
    } else if (kdv === 1){
      yr = sgt * zt;
      propv.sgc = Math.sqrt(sgl * sgl + vs);
    } else if (kdv === 2){
      yr = Math.sqrt(sgt * sgt + sgl * sgl) * zt;
      propv.sgc = Math.sqrt(vs);
    } else {
      yr = sgt * zt + sgl * zl;
      propv.sgc = Math.sqrt(vs);
    }

    let avarv = prop.aref - vmd - yr - propv.sgc * zc;
    if (avarv < 0.0){
      avarv = avarv * (29.0 - avarv) / (29.0 - 10.0 * avarv);
    }

    void mymin;
    return avarv;
  };
}
