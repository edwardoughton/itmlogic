// JS port of NTIA / ITWOM 3.0 canopy attenuation (saalos).
// Reference source: itwom3.0.cpp (chelstein/splat), function saalos at
// line 258.  This is one of Sid Shumate's ITWOM 3.0 extensions to the
// NTIA v1.2.2 baseline; v1.2.2 didn't model vegetation canopy at all.
//
// PHYSICAL MODEL
// Radio waves entering / exiting a vegetation canopy refract at the
// canopy-air interface (refractivity discontinuity prop.ens vs
// prop.encc) and attenuate while passing through the canopy itself.
// saalos solves the entry/exit ray geometry iteratively (5 fixed
// iterations to convergence on a curved Earth) and computes:
//
//   tsp / rsp   transmission / reflection coefficients at the canopy
//               boundary (Fresnel, polarization-aware).
//   d1a         length of the ray segment INSIDE the canopy (m).
//   arte        excess attenuation (dB) above what the host alos2
//               would predict for an empty atmosphere.
//
// USAGE
// saalos is stateful in the C++ source via local-only locals (no
// `static`s) so we just expose a plain function.  Caller MUST have
// populated prop.cch (canopy height AGL), prop.encc (canopy
// refractivity, N-units), prop.tgh (tx height above local ground),
// prop.tsgh (tx site ground level AMSL), prop.rch[1] (rx canopy
// reflectance reference), and prop.ptx (polarization key: 0 H, 1 V,
// 2 circular).  The full ITWOM lrprop2 / qlrpfl2 orchestrator
// populates these from a richer terrain profile; until that lands,
// callers building these by hand can still drive saalos directly.
//
// SAFETY
// The 5-iteration loop can in principle hit numerical edges (acos
// of 1+epsilon, sqrt of negative).  Guards mirror the C++ source
// (mymax(0.0, ...) clamps, the `crpc >= dp` snap-back).
//
// CALIBRATION NOTE
// saalos's third distance band (d1a >= 225m) returns very large
// numbers - tens to hundreds of dB - when the canopy-entry geometry
// is shallow.  This is by design: the function is intended to be
// composed with alos2's `mymin(22, alosv)` final clamp, NOT used
// directly.  Calling saalos in isolation outside of alos2 is
// useful only for diagnostics.

import { mymin, mymax } from './primitives.js';

const EARTH_R_M = 6378137.0;
const PI        = 3.1415926535897;

export function saalos(d, prop, propa){
  void propa; // taken in C++ for symmetry; not used inside saalos.

  let q   = 0.0;
  let saalosv = 0.0;

  if (d === 0.0){
    return 0.0;
  }
  if (prop.hg[1] > prop.cch){
    // Receiver antenna sits above the canopy - nothing to attenuate.
    return 0.0;
  }

  const pd  = d;
  const pdk = pd / 1000.0;
  let tsp   = 1.0;
  let rsp   = 0.0;
  let d1a   = pd;
  // hone: effective tx-above-rx-site-ground at the rx.  The C++ source
  // resolves it as tgh + tsgh - (rch[1] - hg[1]); we copy the formula
  // verbatim.
  let hone  = prop.tgh + prop.tsgh - (prop.rch[1] - prop.hg[1]);

  let tic = 0, ctic = 0, cttc = 0, ssnps = 0, crpc = 0;
  let arte = 0;

  if (prop.tgh > prop.cch){
    // Tx antenna above canopy: ray traces down through the canopy at
    // the receive end.  Iterate 5 times to converge on the canopy-
    // entry geometry on a curved Earth (NTIA TR 82-100 sec. 6
    // approximation).
    const ensa  = 1 + prop.ens  * 1e-6;
    const encca = 1 + prop.encc * 1e-6;
    let dp = pd;

    for (let j = 0; j < 5; j++){
      const tde = dp / EARTH_R_M;
      const hc  = (prop.cch + EARTH_R_M) * (1 - Math.cos(tde));
      const dx  = (prop.cch + EARTH_R_M) * Math.sin(tde);

      const dz   = hone - prop.cch + hc;
      const ucrpc = Math.sqrt(dz * dz + dx * dx);
      const ctip = dz / ucrpc;
      const tip  = Math.acos(mymin(1, mymax(-1, ctip)));
      tic = mymax(0.0, tip + tde);
      const stic = Math.sin(tic);
      const sta  = (ensa / encca) * stic;
      const ttc  = Math.asin(mymin(1, mymax(-1, sta)));
      const sttc2 = Math.sin(ttc);
      cttc = Math.sqrt(mymax(0, 1 - sttc2 * sttc2));

      crpc = (prop.cch - prop.hg[1]) / mymax(1e-9, cttc);
      if (crpc >= dp) crpc = dp - 1 / dp;

      ssnps = (PI / 2) - tic;
      d1a   = (crpc * sttc2) / (1 - 1 / EARTH_R_M);
      dp    = pd - d1a;
    }
    ctic = Math.cos(tic);

    // If the ucrpc path touches the canopy before reaching the end
    // of the ucrpc, the entry point moves toward the transmitter,
    // extending the crpc and d1a (per source comment).
    if (ssnps <= 0.0){
      d1a  = mymin(0.1 * pd, 600.0);
      crpc = d1a;
      hone = prop.cch + 1;
      rsp  = 0.997;
      tsp  = 1 - rsp;
    } else {
      // Fresnel reflection coefficient at the canopy-air boundary.
      // Branches on polarization.  ptx: 0=H, 1=V, 2=circular.
      if (prop.ptx >= 1){
        q   = (ensa * cttc - encca * ctic) / (ensa * cttc + encca * ctic);
        rsp = q * q;
        tsp = 1 - rsp;

        if (prop.ptx === 2){
          // Circular polarization: average vertical + horizontal R^2.
          q   = (ensa * ctic - encca * cttc) / (ensa * ctic + encca * cttc);
          let rspV = (ensa * cttc - encca * ctic) / (ensa * cttc + encca * ctic);
          rspV = rspV * rspV;
          rsp  = (q * q + rspV) / 2;
          tsp  = 1 - rsp;
        }
      } else {
        // Horizontal polarization.
        q   = (ensa * ctic - encca * cttc) / (ensa * ctic + encca * cttc);
        rsp = q * q;
        tsp = 1 - rsp;
      }
    }

    // tvsr: tx ant height above rx ant height (tgh+tsgh-rch[1]).
    const tvsr = mymax(0.0, prop.tgh + prop.tsgh - prop.rch[1]);

    if (d1a < 50.0){
      arte = 0.0195 * crpc - 20 * Math.log10(mymax(1e-9, tsp));
    } else if (d1a < 225.0){
      if (tvsr > 1000.0){
        q = d1a * (0.03 * Math.exp(-0.14 * pdk));
      } else {
        q = d1a * (0.07 * Math.exp(-0.17 * pdk));
      }
      arte = q + (0.7 * pdk - mymax(0.01, Math.log10(prop.wn * 47.7) - 2))
                  * (prop.hg[1] / mymax(1e-9, hone));
    } else {
      q = 0.00055 * pdk
        + Math.log10(pdk) * (0.041 - 0.0017 * Math.sqrt(mymax(0, hone)) + 0.019);
      arte = d1a * q
           - (18 * Math.log10(mymax(1e-9, rsp))) / Math.exp(hone / 37.5);

      const zi = 1.5 * Math.sqrt(mymax(0, hone - prop.cch));
      if (pdk > zi){
        q = (pdk - zi) * 10.2
          * (Math.sqrt(mymax(0.01, Math.log10(prop.wn * 47.7) - 2.0))
             / mymax(1e-9, 100 - zi));
      } else {
        q = ((zi - pdk) / mymax(1e-9, zi))
          * (-20.0 * mymax(0.01, Math.log10(prop.wn * 47.7) - 2.0))
          / Math.sqrt(mymax(1e-9, hone));
      }
      arte += q;
    }
  } else {
    // Tx antenna at or below canopy height: a different empirical
    // model (no ray-tracing iteration; closed-form in pd, cch, tgh).
    q = (prop.cch - prop.tgh)
      * (2.06943 - 1.56184 * Math.exp(1 / mymax(1e-9, prop.cch - prop.tgh)));
    q = q + (17.98 - 0.84224 * (prop.cch - prop.tgh)) * Math.exp(-0.00000061 * pd);
    arte = q + 1.34795 * 20 * Math.log10(pd + 1.0);
    arte = arte
         - (mymax(0.01, Math.log10(prop.wn * 47.7) - 2))
           * (prop.hg[1] / mymax(1e-9, prop.tgh));
  }

  saalosv = arte;
  return saalosv;
}
