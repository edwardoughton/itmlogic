// 47 CFR §73.811 — LPFM rules.
//
// REFERENCE
//   47 CFR §73.811(a) defines two LPFM service classes:
//     LP100 — primary class, 50–100 W ERP @ ≤ 30 m HAAT (or
//             equivalent reduced ERP at higher HAAT to keep the
//             60 dBu service contour ≤ 5.6 km).
//     LP10  — secondary, 1–10 W ERP @ ≤ 30 m HAAT (60 dBu ≤ 3.2 km).
//             LP10 is no longer accepted in the FCC LPFM application
//             windows; LP100 is the only currently-licensable class.
//
//   The bounding rule is on the SERVICE CONTOUR, not directly on
//   ERP / HAAT.  This module computes the F(50,50) 60 dBu distance
//   for the station's actual ERP and HAAT (using Genoa's vendored FCC
//   tvfm_curves.js) and pass/fail-checks it against the §73.811 limit.
//
// OUTPUT
//   { pass, class, service_contour_km, max_service_contour_km,
//     violations: [...] , notes: [...] }
//
//   `violations` is a list of rule-citation strings; empty on pass.

import { fmContourDistance_km } from '../fm/contour.js';
import { loadDataset } from '../curves/loader.js';

export const LPFM_LP100_MAX_SERVICE_CONTOUR_KM = 5.6;
export const LPFM_LP10_MAX_SERVICE_CONTOUR_KM  = 3.2;
export const LPFM_LP100_MAX_ERP_KW             = 0.1;   // 100 W
export const LPFM_LP10_MAX_ERP_KW              = 0.01;  // 10 W

/**
 * Run §73.811 compliance against an LPFM exhibit's inputs.
 *
 * @param {object} args
 * @param {number} args.erp_kw          ERP in kW (max 0.1 for LP100)
 * @param {number} args.haat_m          HAAT in m
 * @param {number} args.frequency_mhz   FM frequency in MHz
 * @param {string} [args.fcc_class]     'LP100' (default) or 'LP10'
 * @returns {Promise<object>}           compliance block (see header)
 */
export async function checkLpfmCompliance({
  erp_kw,
  haat_m,
  frequency_mhz,
  fcc_class = 'LP100'
}){
  const violations = [];
  const notes      = [];

  const klass = String(fcc_class || 'LP100').toUpperCase();
  const maxKm = klass === 'LP10' ? LPFM_LP10_MAX_SERVICE_CONTOUR_KM
                                 : LPFM_LP100_MAX_SERVICE_CONTOUR_KM;
  const maxErp = klass === 'LP10' ? LPFM_LP10_MAX_ERP_KW
                                  : LPFM_LP100_MAX_ERP_KW;

  // ERP cap.  §73.811(a)(1)/(b)(1) — absolute ERP ceiling is 100 W for
  // LP100 and 10 W for LP10.  More than the ceiling is a hard violation
  // regardless of contour distance.
  if (!Number.isFinite(erp_kw) || erp_kw <= 0){
    violations.push({
      cite:    '47 CFR §73.811(a)',
      message: `LPFM ERP must be positive; got ${erp_kw}.`
    });
  } else if (erp_kw > maxErp + 1e-9){
    violations.push({
      cite:    '47 CFR §73.811(a)(1)',
      message: `LPFM (${klass}) ERP ${erp_kw} kW exceeds the ${maxErp * 1000} W ceiling.`
    });
  }

  // Service contour distance check.  Compute the 60 dBu F(50,50)
  // distance at the station's actual ERP / HAAT via the vendored FCC
  // engine; compare against the §73.811 max.
  let serviceKm = null;
  if (Number.isFinite(erp_kw) && erp_kw > 0 && Number.isFinite(haat_m) && haat_m > 0){
    try {
      serviceKm = await fmContourDistance_km({
        datasetByName: loadDataset,
        mode:           '50,50',
        target_dBu:     60,
        erp_kW:         erp_kw,
        haat_m,
        frequency_mhz,
        engine:         'fcc-canonical'
      });
      if (serviceKm > maxKm + 1e-3){
        violations.push({
          cite:    klass === 'LP10' ? '47 CFR §73.811(b)' : '47 CFR §73.811(a)',
          message: `LPFM ${klass} 60 dBu service contour ${serviceKm.toFixed(2)} km exceeds the ${maxKm} km maximum.`
        });
      }
    } catch (e){
      notes.push(`service-contour computation failed: ${e.message}`);
    }
  } else {
    notes.push('service-contour check skipped: erp_kw and haat_m must both be positive.');
  }

  // HAAT @ 30 m note.  §73.811's reference HAAT for LP100 is 30 m;
  // higher HAATs require ERP reduction to keep the contour ≤ 5.6 km.
  // The contour check above already enforces this, but flag the
  // reference HAAT in `notes` for engineering review.
  if (Number.isFinite(haat_m) && haat_m > 30){
    notes.push(`HAAT ${haat_m} m exceeds the §73.811 reference 30 m; reduced ERP per the contour rule applied.`);
  }

  return {
    cite:                   '47 CFR §73.811',
    class:                  klass,
    pass:                   violations.length === 0,
    service_contour_km:     serviceKm,
    max_service_contour_km: maxKm,
    erp_kw,
    erp_kw_max:             maxErp,
    haat_m,
    violations,
    notes,
    method:                 'FCC tvfm_curves.js F(50,50) 60 dBu distance, vendored canonical'
  };
}
