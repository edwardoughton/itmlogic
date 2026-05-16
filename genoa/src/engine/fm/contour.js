// FM F(50,50) and F(50,10) contour distance, deterministic.
// TWO IMPLEMENTATIONS, choose via the `engine` argument:
//
//   'fcc-canonical' (DEFAULT)
//     Vendored FCC source from github.com/fcc/contours-api-node
//     (controllers/tvfm_curves.js).  Bivariate cubic surface fit over
//     the FCC's full-resolution F(50,50) / F(50,10) tabulation
//     (13 HAAT × 25 distance, 13 HAAT × 31 distance).  Identical
//     output to geo.fcc.gov/api/contours/distance.json.
//
//     The bivariate fit is undefined past the table edges.  At very
//     high ERP × HAAT the 40 dBu protected contour exceeds the 300 km
//     F(50,50) tabulation boundary and tvfmfs_metric returns NaN
//     (FCC_NO_RESULT).  We catch that one specific failure and
//     transparently fall through to the v0.2-legacy path so the radial
//     table still reports a finite contour distance.  The fallback is
//     logged once per call so an operator can see when it fired.
//
//   'v0.2-legacy'
//     Genoa's earlier coarse linear-log10 interpolation over a 9 × 20
//     grid.  Kept as a fallback / regression reference.  Produces
//     systematically larger distances than the FCC canonical path on
//     mountaintop sites — see PR #30 for the divergence numbers.
//
// Interpolation source is stamped on every exhibit's
// method_versions.interp.source so the engine output is reproducible.

import { lerp1, INTERP_METHODS } from '../curves/interp.js';
import { fccDistanceKm, FCC_PROVENANCE } from '../curves/fcc/index.mjs';

const MODE_DATASET = {
  '50,50': 'f5050',
  '50,10': 'f5010'
};

export const FM_CONTOUR_METHODS = Object.freeze({
  F50_50: '47 CFR §73.333 F(50,50)',
  F50_10: '47 CFR §73.333 F(50,10)'
});

export const FM_DEFAULT_CONTOURS = Object.freeze([
  { id: 'service_60dbu',  label: '60 dBu (1 mV/m service)', field_dBu: 60 },
  { id: 'city_54dbu',     label: '54 dBu (city grade)',     field_dBu: 54 },
  { id: 'protected_40dbu',label: '40 dBu (protected)',      field_dBu: 40 }
]);

export const FM_ENGINE_DEFAULT = 'fcc-canonical';

export async function fmContourDistance_km({
  datasetByName,
  mode = '50,50',
  target_dBu,
  erp_kW,
  haat_m,
  frequency_mhz = null,
  engine = FM_ENGINE_DEFAULT
}){
  if (engine === 'fcc-canonical'){
    try {
      const r = fccDistanceKm({ haat_m, target_dBu, erp_kw: erp_kW, mode, frequency_mhz });
      return r.distance_km;
    } catch (fccErr){
      // FCC_NO_RESULT means the bivariate cubic fit walked past the
      // table edge (typically the 40 dBu protected contour for
      // high-ERP / high-HAAT FM stations: F(50,50) tabulation tops
      // out at 300 km and the fit is undefined beyond).  Fall through
      // to the legacy linear-log10 interpolator so the radial table
      // still reports a finite distance.  Re-throw any other FCC
      // error (channel range, fs_or_dist) — those are real input
      // errors that the caller needs to see.
      if (fccErr && fccErr.code === 'FCC_NO_RESULT' && datasetByName){
        console.warn(
          `[fm/contour] fcc-canonical NaN at target_dBu=${target_dBu} erp_kW=${erp_kW} haat_m=${haat_m} mode=${mode}; falling back to v0.2-legacy`
        );
        // fall through to legacy block
      } else {
        throw fccErr;
      }
    }
  }

  // ---- legacy v0.2 path (kept for regression reference) ----
  const tbl = await datasetByName(MODE_DATASET[mode]);
  if (!tbl) throw new Error(`fm dataset unavailable for mode ${mode}`);
  const haats     = tbl.haat_grid_m;
  const fields    = tbl.field_grid_dBu;
  const grid      = tbl.distance_km;

  const effective_dBu = target_dBu - 10 * Math.log10(Math.max(1e-3, erp_kW));

  const fieldsAsc = fields.slice().reverse();
  const distsAtH = haats.map((_, hi) => {
    const rowAsc = grid[hi].slice().reverse();
    const logRow = rowAsc.map(d => Math.log10(d));
    const logd   = lerp1(fieldsAsc, logRow, effective_dBu);
    return Math.pow(10, logd);
  });

  const h = Math.max(haats[0], Math.min(haats[haats.length - 1], haat_m));
  return lerp1(haats, distsAtH, h);
}

// Build a full radial table at constant erp / pattern / haat-per-radial.
// haatPerRadial is the array produced by src/engine/haat/{flat,radial}.js
// (same length as radials_deg, same indexing).
export async function fmRadialTable({
  datasetByName,
  mode = '50,50',
  contours = FM_DEFAULT_CONTOURS,
  erp_kW,
  patternFactorFn,
  haatPerRadial,
  frequency_mhz = null,
  engine = FM_ENGINE_DEFAULT
}){
  const out = [];
  for (const r of haatPerRadial){
    const f = patternFactorFn(r.az);
    const erp_az = erp_kW * f * f;
    const haat = r.haat_computed_m ?? r.haat_input_m;
    const distances = {};
    for (const c of contours){
      distances[c.id] = await fmContourDistance_km({
        datasetByName,
        mode:       c.mode || mode,
        target_dBu: c.field_dBu,
        erp_kW:     erp_az,
        haat_m:     haat,
        frequency_mhz,
        engine
      });
    }
    out.push({
      azimuth_deg:            r.az,
      relative_field:         f,
      haat_input_m:           r.haat_input_m,
      haat_computed_m:        r.haat_computed_m,
      haat_source:            r.haat_source,
      terrain_profile_source: r.terrain_profile_source,
      contour_distances_km:   distances
    });
  }
  return out;
}

export const FM_INTERP = Object.freeze({
  along_field: INTERP_METHODS.LINEAR_LOG10,
  along_haat:  INTERP_METHODS.LINEAR_LINEAR,
  source:      '47 CFR §73.333 tabulated F(50,50) / F(50,10) curves'
});

// Provenance block stamped on every exhibit's method_versions when the
// FCC-canonical engine is in use.
export const FM_INTERP_FCC = Object.freeze({
  along_field: 'FCC bivariate cubic surface fit (ITPLBV)',
  along_haat:  'FCC bivariate cubic surface fit (ITPLBV)',
  source:      'github.com/fcc/contours-api-node controllers/tvfm_curves.js — vendored verbatim',
  upstream: {
    repo:        'github.com/fcc/contours-api-node',
    commit:      'b55870d3f20618e886cd02379008ef980229d44b',
    file:        'controllers/tvfm_curves.js',
    sha256:      '58a0cd0eed98353509f39ea56e6f3a1e9ec94e6882a412be4c97bdf79cb6c28a',
    license:     '17 U.S.C. § 105 — US Government work product, public domain in the United States'
  }
});
