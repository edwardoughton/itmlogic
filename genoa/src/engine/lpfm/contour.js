// LPFM service contour wrapper.
// LPFM uses the §73.811 service contour rules + the §73.333 F(50,50)
// curves for distance lookup, but the ERP is regulated separately
// (LP100 = 100 W; LP10 historically deprecated).  Keeping LPFM in its
// own module so future rule changes don't bleed into full-service FM.
//
// SERVICE CONTOUR — 47 CFR §73.811
//   LPFM has exactly ONE protected service contour: the 60 dBu (1 mV/m)
//   F(50,50) field strength locus.  Unlike full-service FM, the city-
//   grade (54 dBu) and distant (40 dBu) contours of §73.315/§73.317 do
//   NOT apply to LPFM stations — §73.811(a) defines the service
//   contour at 60 dBu and §73.807 protection requirements key off that
//   single contour.  Emitting city/protected contours on an LPFM
//   exhibit would mislead reviewers into thinking a non-existent class
//   of contour applies.  See FCC LPFM Order DA 12-1462 (2012) ¶ 24.

import { fmContourDistance_km, fmRadialTable } from '../fm/contour.js';
import { W } from '../../types/warnings.js';

export const LPFM_METHOD = '47 CFR §73.811 / §73.333 F(50,50) — LPFM service contour';

// LPFM emits only the 60 dBu F(50,50) service contour per §73.811(a).
// Full-service FM's city-grade (54 dBu) and protected (40 dBu) contours
// are not LPFM concepts and must not be emitted on LPFM exhibits.
export const LPFM_DEFAULT_CONTOURS = Object.freeze([
  { id: 'service_60dbu',
    label:     '60 dBu F(50,50) — LPFM service contour (§73.811(a))',
    field_dBu: 60,
    mode:      '50,50',
    cite:      '47 CFR §73.811(a)',
    role:      'service' }
]);

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
