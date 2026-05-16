// JS port of NTIA's ITM v1.2.2 / ITWOM 3.0 - high-level entry.
//
// The full pipeline is now available in pure JS through TWO entry
// points:
//
//   pointToPoint        v1.2.2 baseline (qlrpfl -> lrprop ->
//                       alos / adiff / ascat -> avar)
//
//   pointToPointItwom   ITWOM 3.0 (qlrpfl2 -> lrprop2 ->
//                       alos2 / adiff2 / saalos / ascat -> avar)
//
// pointToPoint is the "match SPLAT's point_to_point_ITM exactly"
// path - matches splat's site-report numbers when SPLAT is invoked
// with the v1.2.2 entry.  pointToPointItwom routes through Sid
// Shumate's ITWOM 3.0 modifications - canopy-aware LOS, foliage
// scatter, and the diffraction-vs-troposcatter min blend at beyond-
// horizon distances.
//
// Reference: NTIA TR 82-100, ITWOM 3.0 (Sid Shumate's extensions),
// itm.cpp v1.2.2 (NTIA-ITS).  The C++ source is the canonical
// specification - every function here matches itwom3.0.cpp line-for-
// line on field names.

import { qlrps, makeProp, makePropa, makePropv } from './propagation.js';
import { makeAdiff }                              from './diffraction.js';
import { makeAdiff2 }                             from './diffraction2.js';
import { makeAlos }                               from './alos.js';
import { alos2 }                                  from './alos2.js';
import { saalos }                                 from './canopy.js';
import { makeAscat }                              from './troposcatter.js';
import { makeAvar }                               from './variability.js';
import { makeLrprop }                             from './lrprop.js';
import { makeLrprop2 }                            from './lrprop2.js';
import { makeQlrpfl }                             from './qlrpfl.js';
import { makeQlrpfl2 }                            from './qlrpfl2.js';
import { hzns, hzns2, z1sq1, z1sq2, qtile, d1thx } from './terrain.js';
import { d1thx2 }                                  from './terrain2.js';
import { qerfi }                                   from './primitives.js';

// Re-exports so tests/cross-validation can poke at primitives directly.
export { qlrps, makeProp, makePropa, makePropv };
export { makeAdiff, makeAdiff2, makeAlos, alos2, saalos };
export { makeAscat, makeAvar, makeLrprop, makeLrprop2, makeQlrpfl, makeQlrpfl2 };
export { hzns, hzns2, z1sq1, z1sq2, qtile, d1thx, d1thx2 };
export * from './primitives.js';

// True now that the full v1.2.2 pipeline (and ITWOM 3.0 extensions)
// land.  Callers gating on this can stop falling back to the splat
// sidecar for resilience-only reasons.
export const ITM_V122_PRODUCTION_READY = true;

// Convenience: assemble a prop_type populated from the parameters
// Genoa typically has on hand.  The terrain-derived fields (he, dl,
// the, dh) are filled by qlrpfl when a pfl profile is supplied.
//
//   tx_height_m, rx_height_m   antenna AGL (m)
//   frequency_mhz              MHz
//   en0                        N-units, default 301
//   ipol                       0=H, 1=V (default 1; FM convention)
//   eps_dielect                relative permittivity (default 15)
//   sgm_conduct                ground conductivity S/m (default 0.005)
export function buildProp({
  tx_height_m,
  rx_height_m,
  frequency_mhz,
  en0           = 301.0,
  ipol          = 1,
  eps_dielect   = 15.0,
  sgm_conduct   = 0.005
} = {}){
  const prop = makeProp();
  prop.hg[0] = tx_height_m;
  prop.hg[1] = rx_height_m;
  qlrps(frequency_mhz, 0, en0, ipol, eps_dielect, sgm_conduct, prop);
  return prop;
}

// Single-call point-to-point ITM v1.2.2 run.
//
//   profile:        flat Float64Array or number[] in SPLAT pfl format:
//                     [np, xi, elev_0, elev_1, ..., elev_np]
//                   where np is the number of intervals and xi the
//                   sample spacing (m).  Length = np + 3.
//   tx_height_m, rx_height_m, frequency_mhz, en0, ipol, eps_dielect,
//   sgm_conduct: same as buildProp().
//   conf:           confidence quantile in [0..1] (default 0.50).
//   rel:            reliability quantile in [0..1] (default 0.50).
//   klim:           radio climate 1..7 (default 5 = continental temperate).
//   mdvar:          mode-of-variability key (default 12 = broadcast).
//
// Returns the same envelope as pointToPointItwom; see below for
// field documentation.
export function pointToPoint({
  profile,
  tx_height_m,
  rx_height_m,
  frequency_mhz,
  en0          = 301.0,
  ipol         = 1,
  eps_dielect  = 15.0,
  sgm_conduct  = 0.005,
  conf         = 0.50,
  rel          = 0.50,
  klim         = 5,
  mdvar        = 12,
} = {}){
  const prop  = buildProp({
    tx_height_m, rx_height_m, frequency_mhz, en0, ipol, eps_dielect, sgm_conduct
  });
  const propa = makePropa();
  const propv = makePropv();
  propv.klim  = klim;
  propv.mdvar = mdvar;

  const qlrpfl = makeQlrpfl();
  const lrprop = qlrpfl(profile, klim, mdvar, prop, propa, propv);
  // Match SPLAT's point_to_point_ITM (itwom3.0.cpp line 2419):
  //   dbloss = avar(zr, 0.0, zc, prop, propv) + fs;
  const avar = makeAvar();
  const zt = qerfi(rel);
  const zl = 0.0;
  const zc = qerfi(conf);
  const dbloss = avar(zt, zl, zc, prop, propv);

  const dist_km    = prop.dist / 1000.0;
  const fsl_db     = 32.45 + 20.0 * Math.log10(frequency_mhz)
                   + 20.0 * Math.log10(Math.max(0.001, dist_km));
  const dbloss_db  = dbloss + fsl_db;
  const aref_total = prop.aref + fsl_db;

  return {
    aref_db:    aref_total,
    excess_db:  prop.aref,
    avar_db:    dbloss,
    dbloss_db,
    fsl_db,
    kwx:        prop.kwx,
    mode:       describeMode(prop, propa),
    dl:         [prop.dl[0], prop.dl[1]],
    the:        [prop.the[0], prop.the[1]],
    he:         [prop.he[0], prop.he[1]],
    dh:         prop.dh,
    dist_m:     prop.dist,
    dist_km,
    _lrprop:    lrprop,
    _avar:      avar,
    _prop:      prop,
    _propa:     propa,
    _propv:     propv
  };
}

// ITWOM 3.0 single-call point-to-point (qlrpfl2 -> lrprop2 -> avar).
//
// Same signature shape as pointToPoint, but routes through the
// ITWOM-3.0 modified pipeline (alos2 / adiff2 / saalos canopy) so
// callers with a populated canopy field set get the canopy-aware
// path loss.  When the canopy fields aren't populated (default
// empty profile, no cch/encc/etc), behaves close to v1.2.2 but
// with hzns2 + d1thx2 + the ITWOM "min(adiff2, ascat)" beyond-
// horizon blend instead of v1.2.2's straight diffraction-extrap.
//
// Extra optional fields beyond pointToPoint:
//   canopy_height_m       (default 0)    prop.cch
//   canopy_refractivity_n (default 360)  prop.encc - typical
//                                  vegetation-canopy N value;
//                                  unused when canopy_height_m=0.
//   canopy_density        (default 1.0)  prop.cd - matches C++
//                                  point_to_point() preset.
//   ptx                   (default ipol) saalos polarization key:
//                                  0 = horizontal, 1 = vertical,
//                                  2 = circular.
export function pointToPointItwom({
  profile,
  tx_height_m,
  rx_height_m,
  frequency_mhz,
  en0          = 301.0,
  ipol         = 1,
  eps_dielect  = 15.0,
  sgm_conduct  = 0.005,
  conf         = 0.50,
  rel          = 0.50,
  klim         = 5,
  mdvar        = 12,
  canopy_height_m       = 0,
  canopy_refractivity_n = 360,
  canopy_density        = 1.0,    // prop.cd; matches C++ point_to_point() preset
  ptx                   = null,
} = {}){
  const prop  = buildProp({
    tx_height_m, rx_height_m, frequency_mhz, en0, ipol, eps_dielect, sgm_conduct
  });
  prop.cch  = canopy_height_m;
  prop.encc = canopy_refractivity_n;
  prop.cd   = canopy_density;
  prop.ptx  = ptx === null ? ipol : ptx;

  const propa = makePropa();
  const propv = makePropv();
  propv.klim  = klim;
  propv.mdvar = mdvar;

  const qlrpfl2 = makeQlrpfl2();
  const lrprop2 = qlrpfl2(profile, klim, mdvar, prop, propa, propv);

  const avar = makeAvar();
  const zt   = qerfi(rel);
  const zl   = 0.0;
  const zc   = qerfi(conf);
  const dbloss = avar(zt, zl, zc, prop, propv);

  const dist_km    = prop.dist / 1000.0;
  const fsl_db     = 32.45 + 20.0 * Math.log10(frequency_mhz)
                   + 20.0 * Math.log10(Math.max(0.001, dist_km));
  const dbloss_db  = dbloss + fsl_db;
  const aref_total = prop.aref + fsl_db;

  return {
    aref_db:    aref_total,
    excess_db:  prop.aref,
    avar_db:    dbloss,
    dbloss_db,
    fsl_db,
    kwx:        prop.kwx,
    mode:       describeMode(prop, propa),
    dl:         [prop.dl[0], prop.dl[1]],
    the:        [prop.the[0], prop.the[1]],
    he:         [prop.he[0], prop.he[1]],
    dh:         prop.dh,
    los:        prop.los,
    dist_m:     prop.dist,
    dist_km,
    canopy_active: canopy_height_m > 0
                   && rx_height_m < canopy_height_m
                   && (prop.thera < 0.785) && (prop.thenr < 0.785),
    _lrprop2:   lrprop2,
    _avar:      avar,
    _prop:      prop,
    _propa:     propa,
    _propv:     propv,
  };
}

// Build a SPLAT-format profile from a uniform sequence of elevation
// samples (metres) plus the spacing (metres).  Convenience for callers
// that have a (distance, elev) array rather than the bare pfl flat
// layout.  `elev` MUST be in transmitter-to-receiver order.
export function profileFromElevations(elevations, spacing_m){
  const np  = elevations.length - 1;
  const out = new Array(elevations.length + 2);
  out[0]    = np;
  out[1]    = spacing_m;
  for (let i = 0; i < elevations.length; i++) out[i + 2] = elevations[i];
  return out;
}

// String-ification of the path mode based on dist vs propa thresholds.
// Mirrors splat's strmode output for cross-validation reporting.
function describeMode(prop, propa){
  if (prop.dist <= 0)            return 'invalid';
  if (prop.dist < propa.dlsa)    return 'line-of-sight';
  if (prop.dist > (propa.dx ?? Infinity)) return 'troposcatter';
  return 'diffraction';
}
