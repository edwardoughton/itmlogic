// FM full-service rule guards.  Returns structured warnings (typed
// codes) — never throws.  The engine consumes the same warning type
// system as the rest of Genoa (see src/types/warnings.js).

import { W } from '../../types/warnings.js';

export function fmInputGuards({ erp_kW, haat_m, frequency_mhz }){
  const warnings = [];
  if (!Number.isFinite(haat_m) || haat_m <= 0){
    warnings.push(W.make('CONSTANT_HAAT_ASSUMED', 'HAAT missing or non-positive; engine refused to interpolate.'));
  } else if (haat_m < 30 || haat_m > 1200){
    warnings.push(W.make('CONSTANT_HAAT_ASSUMED',
      `HAAT ${haat_m} m is outside the published §73.333 envelope (30–1200 m); contour distance may be extrapolated.`));
  }
  if (!Number.isFinite(erp_kW) || erp_kW <= 0){
    warnings.push(W.make('FCC_METHOD_MISSING', 'ERP missing or non-positive; FM contour cannot be computed.'));
  }
  if (!Number.isFinite(frequency_mhz) || frequency_mhz < 88 || frequency_mhz > 108){
    warnings.push(W.make('FCC_METHOD_MISSING',
      `Frequency ${frequency_mhz} MHz is outside the FM band (88–108 MHz); §73.333 curves do not apply.`));
  }
  return warnings;
}
