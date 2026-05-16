// LPFM service contour wrapper.
// LPFM uses the §73.811 service contour rules + the §73.333 F(50,50)
// curves for distance lookup, but the ERP is regulated separately
// (LP100 = 100 W; LP10 historically deprecated).  Keeping LPFM in its
// own module so future rule changes don't bleed into full-service FM.

import { fmContourDistance_km, fmRadialTable, FM_DEFAULT_CONTOURS } from '../fm/contour.js';
import { W } from '../../types/warnings.js';

export const LPFM_METHOD = '47 CFR §73.811 / §73.333 F(50,50) — LPFM service contour';

export const LPFM_DEFAULT_CONTOURS = FM_DEFAULT_CONTOURS;

export function lpfmInputGuards({ erp_kW }){
  const warnings = [];
  if (erp_kW > 0.1){
    warnings.push(W.make('FCC_METHOD_MISSING',
      `LPFM ERP ${erp_kW} kW exceeds the §73.811 LP100 ceiling (0.1 kW). Engine will still compute, but the result is not a filable LPFM exhibit.`));
  }
  return warnings;
}

export async function lpfmRadialTable(args){
  return fmRadialTable(args);
}

export { fmContourDistance_km as lpfmContourDistance_km };
