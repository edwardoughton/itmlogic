// JS port of ITWOM 3.0 diffraction (adiff2).
// Reference source: itwom3.0.cpp (chelstein/splat), function adiff2 at
// line 478.
//
// adiff2 is Sid Shumate's ITWOM replacement for v1.2.2's adiff. The
// big differences:
//
// 1. Explicit single-obstacle vs two-obstacle branches based on
//    int(d - propa.dla) sign and int(prop.dl[1]) > 0.
// 2. Per-branch knife-edge Fresnel integrals (aknfe) vs combined
//    knife-edge + smooth-Earth weighted blend that v1.2.2's adiff
//    used.
// 3. Foliage scatter accounted for via the empirical sf2 = 1.0
//    "average hilltop foliage scatter factor for 2 obstructions"
//    when prop.hht / prop.hhr < 3400 m.
// 4. Direct integration of saalos for canopy clutter loss past the
//    last obstruction, clamped at mymin(22, closs).
// 5. A single-obstacle "scatter + knife-edge phase" model when the
//    grazing angle the[1] < 0.2 rad - uses the actual three path
//    lengths (dto, dro, dtr) plus the canopy-equivalents (dtof,
//    drof) to derive a scatter-vs-knife-edge phase difference and
//    coherently sum two complex phasors.
//
// PRIMING: same d=0/d>0 split as adiff. makeAdiff2() returns a
// closure that must be primed once with d=0 to populate per-path
// coefficients (wd1, xd1, qk, aht, xht), then evaluated along the
// path for d > 0.

import { aknfe, fht, mymin, mymax, FORTRAN_DIM, abq_alos, THIRD } from './primitives.js';
import { cx }                                                     from './propagation.js';
import { saalos }                                                 from './canopy.js';

const TWO_PI = 6.283185307;
const PI     = 3.141592654;

export function makeAdiff2(){
  // Per-path memoised state.  Initialised on the d=0 call.
  let wd1, xd1, qk, aht, xht;

  return function adiff2(d, prop, propa){
    const prop_zgnd = { re: prop.zgndreal, im: prop.zgndimag };
    const sf2 = 1.0;  // average empirical hilltop foliage scatter factor

    if (d === 0){
      let q  = prop.hg[0] * prop.hg[1];
      qk     = prop.he[0] * prop.he[1] - q;
      if (prop.mdp < 0.0) q += 10.0;

      wd1 = Math.sqrt(1.0 + qk / q);
      xd1 = propa.dla + propa.tha / prop.gme;
      q   = (1.0 - 0.8 * Math.exp(-propa.dlsa / 50e3)) * prop.dh;
      q  *= 0.78 * Math.exp(-Math.pow(q / 16.0, 0.25));
      qk  = 1.0 / cx.abs(prop_zgnd);
      aht = 20.0;
      xht = 0.0;

      // Tx-side rounded-Earth contribution.
      let a  = 0.5 * (prop.dl[0] * prop.dl[0]) / prop.he[0];
      let wa = Math.pow(a * prop.wn, THIRD);
      let pk = qk / wa;
      q      = (1.607 - pk) * 151.0 * wa * prop.dl[0] / a;
      xht    = q;
      aht   += fht(q, pk);

      // Rx-side: reuse tx contribution if rx horizon is degenerate.
      if ((Math.trunc(prop.dl[1]) === 0) || (prop.the[1] > 0.2)){
        xht += xht;
        aht += (aht - 20.0);
      } else {
        a  = 0.5 * (prop.dl[1] * prop.dl[1]) / prop.he[1];
        wa = Math.pow(a * prop.wn, THIRD);
        pk = qk / wa;
        q  = (1.607 - pk) * 151.0 * wa * prop.dl[1] / a;
        xht += q;
        aht += fht(q, pk);
      }
      return 0.0;
    }

    // d > 0 path.
    const th  = propa.tha + d * prop.gme;
    const dsl = mymax(d - propa.dla, 0.0);
    const ds  = d - propa.dla;
    let a     = ds / th;
    let wa    = Math.pow(a * prop.wn, THIRD);
    let pk    = qk / wa;

    // Geometry: distances between transmitter, both horizons, the
    // receiver, and a synthetic intermediate "roho" reflection point.
    // The (rch[1]-rch[0])/dist slope is the average path tilt.
    const slope_tr = (prop.rch[1] - prop.rch[0]) / prop.dist;
    const toh  = prop.hht - (prop.rch[0] - prop.dl[0] * slope_tr);
    const roh  = prop.hhr - (prop.rch[0] - (prop.dist - prop.dl[1]) * slope_tr);
    const slope_th_to_rch = (prop.hhr - prop.rch[0]) / mymax(1e-9, prop.dist - prop.dl[1]);
    const toho = prop.hht - (prop.rch[0] - (prop.dl[0] + dsl) * slope_th_to_rch);
    const roho = prop.hhr - (prop.hht - dsl * ((prop.rch[1] - prop.hht) / mymax(1e-9, dsl)));

    const dto  = Math.sqrt(prop.dl[0] * prop.dl[0] + toh  * toh)  + prop.gme * prop.dl[0];
    const dto1 = Math.sqrt(prop.dl[0] * prop.dl[0] + toho * toho) + prop.gme * prop.dl[0];
    const dtro = Math.sqrt((prop.dl[0] + dsl) * (prop.dl[0] + dsl) + prop.hhr * prop.hhr)
               + prop.gme * (prop.dl[0] + dsl);
    const drto = Math.sqrt((prop.dl[1] + dsl) * (prop.dl[1] + dsl) + prop.hht * prop.hht)
               + prop.gme * (prop.dl[1] + dsl);
    const dro  = Math.sqrt(prop.dl[1] * prop.dl[1] + roh  * roh)  + prop.gme * prop.dl[1];
    const dro2 = Math.sqrt(prop.dl[1] * prop.dl[1] + roho * roho) + prop.gme * prop.dl[1];
    const dtr  = Math.sqrt(prop.dist * prop.dist + (prop.rch[0] - prop.rch[1]) ** 2)
               + prop.gme * prop.dist;
    const dhh1 = Math.sqrt((prop.dist - propa.dla) ** 2 + toho * toho)
               + prop.gme * (prop.dist - propa.dla);
    const dhh2 = Math.sqrt((prop.dist - propa.dla) ** 2 + roho * roho)
               + prop.gme * (prop.dist - propa.dla);

    // Canopy-equivalent paths (for the foliage scatter integral).
    const dtof  = Math.sqrt(prop.dl[0] ** 2 + (toh  - prop.cch) ** 2) + prop.gme * prop.dl[0];
    const drof  = Math.sqrt(prop.dl[1] ** 2 + (roh  - prop.cch) ** 2) + prop.gme * prop.dl[1];
    void dtof; void drof; // recorded for the scatter-phase block below.

    // saalos coefficients preset for post-obstacle receive path.
    prop.tgh  = prop.cch + 1.0;
    prop.tsgh = prop.hhr;
    let rd    = prop.dl[1];

    let q   = 0.6365 * prop.wn;
    let vv  = 0.0;
    let adiffv2 = 0.0;
    let closs;

    if (Math.trunc(ds) > 0){
      // Two-obstacle branch.
      if (Math.trunc(prop.dl[1]) > 0){
        // Receive site past 2nd peak.
        if (prop.the[1] < 0.2){
          // Receive grazing angle below 0.2 rad.
          if (prop.hht < 3400){
            vv = q * Math.abs(dto1 + dhh1 - dtro);
            adiffv2 = -18.0 + sf2 * aknfe(vv);
          } else {
            vv = q * Math.abs(dto1 + dhh1 - dtro);
            adiffv2 = aknfe(vv);
          }
          if (prop.hhr < 3400){
            vv = q * Math.abs(dro2 + dhh2 - drto);
            adiffv2 += (-18.0 + sf2 * aknfe(vv));
          } else {
            vv = q * Math.abs(dro2 + dhh2 - drto);
            adiffv2 += aknfe(vv);
          }
          closs   = saalos(rd, prop, propa);
          adiffv2 += mymin(22.0, closs);
        } else {
          // Rcvr too close to 2nd obs.
          if (prop.hht < 3400){
            vv = q * Math.abs(dto1 + dhh1 - dtro);
            adiffv2 = -18.0 + sf2 * aknfe(vv);
          } else {
            vv = q * Math.abs(dto1 + dhh1 - dtro);
            adiffv2 = aknfe(vv);
          }

          if (prop.the[1] < 1.22){
            rd = prop.dl[1];
            if (prop.the[1] > 0.6){
              prop.tgh = prop.cch;
            } else {
              vv = 0.6365 * prop.wn * Math.abs(dro2 + dhh2 - drto);
            }
            adiffv2 += aknfe(vv);
            closs   = saalos(rd, prop, propa);
            adiffv2 += mymin(closs, 22.0);
          } else {
            adiffv2 = 5.8 + 25.0;
          }
        }
      } else {
        // Receive site is atop the 2nd peak.
        vv = 0.6365 * prop.wn * Math.abs(dto + dro - dtr);
        adiffv2 = 5.8 + aknfe(vv);
      }
    } else {
      // Single-obstacle branch.
      if (Math.trunc(prop.dl[1]) > 0){
        if (prop.the[1] < 0.2){
          // Receive grazing angle less than 0.2 rad: scatter+knife-edge
          // coherent two-phasor sum (the most distinctive ITWOM3
          // contribution in this code path).
          vv = 0.6365 * prop.wn * Math.abs(dto + dro - dtr);
          if (prop.hht < 3400){
            const sdl = Math.pow(10, -18.0 / 20);
            const kedr = 0.159155 * prop.wn * Math.abs(dto + dro - dtr);
            const arp  = Math.abs(kedr - Math.trunc(kedr));
            const kemA = aknfe(vv);
            const kem  = Math.pow(10, -kemA / 20);
            const sdr  = 0.5 + 0.159155 * prop.wn * Math.abs(dtof + drof - dtr);
            const srp  = Math.abs(sdr - Math.trunc(sdr));
            let pd     = TWO_PI * Math.abs(srp - arp);

            let csd;
            if (pd >= PI){
              pd  = TWO_PI - pd;
              csd = abq_alos({
                re: sdl + kem * -Math.cos(pd),
                im:        kem * -Math.sin(pd)
              });
            } else {
              csd = abq_alos({
                re: sdl + kem *  Math.cos(pd),
                im:        kem *  Math.sin(pd)
              });
            }
            adiffv2 = -3.71 - 10 * Math.log10(csd);
          } else {
            adiffv2 = aknfe(vv);
          }
          closs    = saalos(rd, prop, propa);
          adiffv2 += mymin(closs, 22.0);
        } else {
          // Receive grazing angle too high.
          if (prop.the[1] < 1.22){
            rd = prop.dl[1];
            if (prop.the[1] > 0.6){
              prop.tgh = prop.cch;
            } else {
              vv = 0.6365 * prop.wn * Math.abs(dto + dro - dtr);
              adiffv2 = aknfe(vv);
            }
            closs   = saalos(rd, prop, propa);
            adiffv2 += mymin(22.0, closs);
          } else {
            adiffv2 = 5.8 + 25.0;
          }
        }
      } else {
        // Receive site atop first peak.
        adiffv2 = 5.8;
      }
    }

    // Suppress unused-warning lints on identifiers we keep for parity
    // with the C++ source even when this branch doesn't read them.
    void wd1; void xd1; void a; void wa; void pk; void FORTRAN_DIM; void mymax;
    return adiffv2;
  };
}
