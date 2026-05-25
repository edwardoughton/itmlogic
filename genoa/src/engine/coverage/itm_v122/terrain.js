// JS port of NTIA's ITM v1.2.2 terrain-profile geometry helpers.
// Reference source: itwom3.0.cpp (chelstein/splat).
//
// SPLAT's "pfl" (path file profile) is a flat double[] with a header
// pair plus elevation samples:
//   pfl[0]   = number of intervals (np)              -- so np+1 samples total
//   pfl[1]   = sample spacing (xi, metres)
//   pfl[2..] = elevation samples (metres)
//
// We keep the same indexing in the JS port so reading itwom3.0.cpp
// next to this file lets you map every read line-for-line.
//
// Three primitives in this module:
//   z1sq1, z1sq2  -- least-squares linear fit over a profile sub-range,
//                    used by qlrpfl to compute terrain-irregularity
//                    statistics (delta-h) and effective antenna heights.
//                    z1sq2 is the corrected variant ITWOM uses.
//   hzns / hzns2 -- horizon geometry: walks the profile to compute
//                    horizon distances dl[0]/dl[1] and elevation angles
//                    the[0]/the[1] for both terminals.  hzns is the
//                    plain ITM 1.2.2 implementation; hzns2 adds the
//                    refined obstacle-aware logic that ITWOM uses.
//   qtile        -- in-place quickselect median (and quartile) finder.
//                    Used by qlrpfl to extract the 10/50/90 percentiles
//                    of the terrain profile that feed delta-h.

import { FORTRAN_DIM, mymin, mymax } from './primitives.js';

// ---------------------------------------------------------------------
// Least-squares fit z = z0 + slope * x over the sub-range [x1, x2] of
// the profile, where x is the sample index (0..np).  Returns z0 (fit
// at x=0) and zn (fit at x=np).  Both variants treat z[0]=np, z[1]=xi
// and z[i+2]=elev_i exactly as the C++ source.
// ---------------------------------------------------------------------

export function z1sq1(z, x1, x2){
  const xn = z[0];
  let xa = Math.trunc(FORTRAN_DIM(x1 / z[1], 0.0));
  let xb = xn - Math.trunc(FORTRAN_DIM(xn, x2 / z[1]));

  if (xb <= xa){
    xa = FORTRAN_DIM(xa, 1.0);
    xb = xn - FORTRAN_DIM(xn, xb + 1.0);
  }

  let ja = Math.trunc(xa);
  const jb = Math.trunc(xb);
  const n = jb - ja;
  xa = xb - xa;
  let x = -0.5 * xa;
  xb += x;
  let a = 0.5 * (z[ja + 2] + z[jb + 2]);
  let b = 0.5 * (z[ja + 2] - z[jb + 2]) * x;

  for (let i = 2; i <= n; i++){
    ja++;
    x += 1.0;
    a += z[ja + 2];
    b += z[ja + 2] * x;
  }

  a /= xa;
  b = b * 12.0 / ((xa * xa + 2.0) * xa);
  return { z0: a - b * xb, zn: a + b * (xn - xb) };
}

// ITWOM's corrected LSQ (subtle index/normalisation tweaks vs z1sq1).
export function z1sq2(z, x1, x2){
  const xn = z[0];
  let xa = Math.trunc(FORTRAN_DIM(x1 / z[1], 0.0));
  let xb = xn - Math.trunc(FORTRAN_DIM(xn, x2 / z[1]));

  if (xb <= xa){
    xa = FORTRAN_DIM(xa, 1.0);
    xb = xn - FORTRAN_DIM(xn, xb + 1.0);
  }

  let ja;
  const jb = Math.trunc(xb);
  xa = (2 * Math.trunc((xb - xa) / 2)) - 1;
  let x = -0.5 * (xa + 1);
  xb += x;
  ja = jb - 1 - Math.trunc(xa);
  const n = jb - ja;
  let a = z[ja + 2] + z[jb + 2];
  let b = (z[ja + 2] - z[jb + 2]) * x;
  let bn = 2 * (x * x);

  for (let i = 2; i <= n; i++){
    ja++;
    x += 1.0;
    bn += x * x;
    a += z[ja + 2];
    b += z[ja + 2] * x;
  }

  a /= (xa + 2);
  b = b / bn;
  return { z0: a - b * xb, zn: a + b * (xn - xb) };
}

// ---------------------------------------------------------------------
// hzns (line 1710, itwom3.0.cpp): horizon distances + elevation angles.
// Mutates prop.dl[0], prop.dl[1], prop.the[0], prop.the[1].
// ---------------------------------------------------------------------

export function hzns(pfl, prop){
  const np = Math.trunc(pfl[0]);
  const xi = pfl[1];
  const za = pfl[2] + prop.hg[0];
  const zb = pfl[np + 2] + prop.hg[1];
  const qc = 0.5 * prop.gme;
  let q = qc * prop.dist;

  prop.the[1] = (zb - za) / prop.dist;
  prop.the[0] = prop.the[1] - q;
  prop.the[1] = -prop.the[1] - q;
  prop.dl[0]  = prop.dist;
  prop.dl[1]  = prop.dist;

  if (np >= 2){
    let sa = 0.0;
    let sb = prop.dist;
    let wq = true;

    for (let i = 1; i < np; i++){
      sa += xi;
      sb -= xi;
      q = pfl[i + 2] - (qc * sa + prop.the[0]) * sa - za;

      if (q > 0.0){
        prop.the[0] += q / sa;
        prop.dl[0]   = sa;
        wq = false;
      }

      if (!wq){
        q = pfl[i + 2] - (qc * sb + prop.the[1]) * sb - zb;
        if (q > 0.0){
          prop.the[1] += q / sb;
          prop.dl[1]   = sb;
        }
      }
    }
  }
}

// ITWOM's hzns2: adds line-of-sight detection + obstacle-aware
// recomputation of elevation angles, plus reflection-point geometry
// stamped onto prop.rpl/prop.rph (used by alos2's canopy logic).
export function hzns2(pfl, prop, propa){
  const np = Math.trunc(pfl[0]);
  const xi = pfl[1];
  const za = pfl[2] + prop.hg[0];
  const zb = pfl[np + 2] + prop.hg[1];
  prop.tiw = xi;
  prop.ght = za;
  prop.ghr = zb;
  const qc = 0.5 * prop.gme;
  let q = qc * prop.dist;

  prop.the[1] = Math.atan((zb - za) / prop.dist);
  prop.the[0] = prop.the[1] - q;
  prop.the[1] = -prop.the[1] - q;
  prop.dl[0]  = prop.dist;
  prop.dl[1]  = prop.dist;
  prop.hht    = 0.0;
  prop.hhr    = 0.0;
  prop.los    = 1;

  if (np >= 2){
    let sa = 0.0;
    let sb = prop.dist;
    let wq = true;

    for (let j = 1; j < np; j++){
      sa += xi;
      q = pfl[j + 2] - (qc * sa + prop.the[0]) * sa - za;
      if (q > 0.0){
        prop.los     = 0;
        prop.the[0] += q / sa;
        prop.dl[0]   = sa;
        prop.the[0]  = mymin(prop.the[0], 1.569);
        prop.hht     = pfl[j + 2];
        wq = false;
      }
    }

    if (!wq){
      for (let i = 1; i < np; i++){
        sb -= xi;
        q = pfl[np + 2 - i]
          - (qc * (prop.dist - sb) + prop.the[1]) * (prop.dist - sb) - zb;
        if (q > 0.0){
          prop.the[1] += q / (prop.dist - sb);
          prop.the[1]  = mymin(prop.the[1], 1.57);
          prop.the[1]  = mymax(prop.the[1], -1.568);
          prop.hhr     = pfl[np + 2 - i];
          prop.dl[1]   = mymax(0.0, prop.dist - sb);
        }
      }
      prop.the[0] = Math.atan((prop.hht - za) / prop.dl[0])
                  - 0.5 * prop.gme * prop.dl[0];
      prop.the[1] = Math.atan((prop.hhr - zb) / prop.dl[1])
                  - 0.5 * prop.gme * prop.dl[1];
    }
  }

  // Reflection-point geometry (used by alos2 if/when ported).
  let dr;
  if (prop.dl[1] < prop.dist){
    const dshh = prop.dist - prop.dl[0] - prop.dl[1];
    if (Math.trunc(dshh) === 0){
      dr = prop.dl[1] / (1 + zb / prop.hht);
    } else {
      dr = prop.dl[1] / (1 + zb / prop.hhr);
    }
  } else {
    dr = prop.dist / (1 + zb / za);
  }
  const rp  = 2 + Math.trunc(Math.floor(0.5 + dr / xi));
  prop.rpl  = rp;
  prop.rph  = pfl[rp];
  void propa; // propa is taken in C++ but only mutated indirectly via prop
}

// ---------------------------------------------------------------------
// qtile: in-place quickselect.  Mutates a[] so a[ir] holds the (n-ir)th
// smallest value (i.e. the (ir+1)th largest).  Returns that value.
// Same partition logic as the C++ original, written iteratively so the
// JS engine doesn't blow its call stack on long profiles.
// ---------------------------------------------------------------------

export function qtile(nn, a, ir){
  let q = 0;
  let m = 0;
  let n = nn;
  let i, j, j1 = 0, i0 = 0;
  const k = mymin(mymax(0, ir), n);
  let goto10 = true;
  let done = false;

  while (!done){
    if (goto10){
      q  = a[k];
      i0 = m;
      j1 = n;
    }

    i = i0;
    while (i <= n && a[i] >= q) i++;
    if (i > n) i = n;

    j = j1;
    while (j >= m && a[j] <= q) j--;
    if (j < m) j = m;

    if (i < j){
      const r = a[i];
      a[i] = a[j];
      a[j] = r;
      i0 = i + 1;
      j1 = j - 1;
      goto10 = false;
    } else if (i < k){
      a[k] = a[i];
      a[i] = q;
      m = i + 1;
      goto10 = true;
    } else if (j > k){
      a[k] = a[j];
      a[j] = q;
      n = j - 1;
      goto10 = true;
    } else {
      done = true;
    }
  }
  return q;
}

// d1thx: terrain-irregularity (delta-h) extraction.  Sub-samples the
// profile uniformly, detrends with z1sq1, then takes the 10/90
// percentile spread via qtile.  Used by qlrpfl to populate prop.dh.
// Mirrors the C++ d1thx (itwom3.0.cpp line 2027) line-for-line — the
// C++ aliases xa/xb across the sampling and detrend phases, so we
// keep the same flow but rename the post-detrend aliases (z0/zn/step)
// for readability.
export function d1thx(pfl, x1, x2){
  const np = Math.trunc(pfl[0]);
  let xa   = x1 / pfl[1];
  let xb   = x2 / pfl[1];
  if (xb - xa < 2.0) return 0.0;

  let ka = Math.trunc(0.1 * (xb - xa + 8.0));
  ka = mymin(mymax(4, ka), 25);
  const n  = 10 * ka - 5;
  const kb = n - ka + 1;
  const sn = n - 1;
  const sBuf = new Array(n + 2);
  sBuf[0] = sn;
  sBuf[1] = 1.0;
  xb = (xb - xa) / sn;
  let k = Math.trunc(xa + 1.0);
  xa  -= k;

  for (let j = 0; j < n; j++){
    while (xa > 0.0 && k < np){
      xa -= 1.0;
      k++;
    }
    sBuf[j + 2] = pfl[k + 2] + (pfl[k + 2] - pfl[k + 1]) * xa;
    xa += xb;
  }

  // Detrend the sampled buffer via least-squares (z1sq1 returns the
  // fit at x=0 (z0) and x=sn (zn)).
  const fit = z1sq1(sBuf, 0.0, sn);
  let trend = fit.z0;
  const step = (fit.zn - fit.z0) / sn;
  for (let j = 0; j < n; j++){
    sBuf[j + 2] -= trend;
    trend += step;
  }

  // qtile expects samples at a[0..nn]; sBuf[0..1] are the np/xi header
  // for z1sq1, so feed qtile a view that starts at sBuf[2].
  const samples = sBuf.slice(2);
  const xa3 = qtile(n - 1, samples, ka - 1);
  const xb3 = qtile(n - 1, samples, kb - 1);
  return (xa3 - xb3) / (1.0 - 0.8 * Math.exp(-(x2 - x1) / 50.0e3));
}
