// AM-band constants + helpers shared between the engine, the
// FCCAM client validator, and the UI carrier-input control.
//
// The US AM band per 47 CFR §73.21 is 535-1705 kHz on a 10-kHz
// channel grid.  Frequencies outside this band are not allocated
// AM broadcast service and FCCAM does not tabulate skywave for
// them; the DA designer + the §73.182 orchestrator both validate
// here before any downstream call.
//
// The "expanded band" 1610-1705 kHz has additional allocation
// rules (§73.30) but uses the same 10-kHz grid — that subset is
// flagged here but not separately gated.

export const AM_BAND_KHZ_MIN  = 535;
export const AM_BAND_KHZ_MAX  = 1705;
export const AM_GRID_KHZ      = 10;
export const AM_EXPANDED_MIN  = 1610;
export const AM_EXPANDED_MAX  = 1705;

/**
 * Is `khz` a valid US AM carrier (535-1705 kHz, 10-kHz grid)?
 * @param {number} khz
 * @returns {boolean}
 */
export function isValidAmKhz(khz){
  const n = Number(khz);
  if (!Number.isFinite(n)) return false;
  if (n < AM_BAND_KHZ_MIN || n > AM_BAND_KHZ_MAX) return false;
  if (n % AM_GRID_KHZ !== 0) return false;
  return true;
}

/**
 * Snap `khz` to the nearest US AM grid value within the band, or
 * return null if `khz` is too far outside the band to make sense
 * to snap.  Used by the DA designer to forgive small typos
 * (e.g. 705 → 710) without silently accepting wholly wrong input
 * (e.g. 89 → does NOT become 540).
 *
 * @param {number} khz
 * @returns {number|null}
 */
export function normalizeAmKhz(khz){
  const n = Number(khz);
  if (!Number.isFinite(n)) return null;
  if (n < AM_BAND_KHZ_MIN - AM_GRID_KHZ || n > AM_BAND_KHZ_MAX + AM_GRID_KHZ) return null;
  const snapped = Math.round(n / AM_GRID_KHZ) * AM_GRID_KHZ;
  if (snapped < AM_BAND_KHZ_MIN || snapped > AM_BAND_KHZ_MAX) return null;
  return snapped;
}

/**
 * Returns a human-readable validation result for the UI to render.
 * @param {number} khz
 * @returns {{ valid: boolean, kind: 'ok'|'expanded_band'|'off_grid'|'out_of_band'|'not_a_number', message: string|null }}
 */
export function describeAmKhz(khz){
  const n = Number(khz);
  if (!Number.isFinite(n)){
    return { valid: false, kind: 'not_a_number', message: 'Carrier must be a number.' };
  }
  if (n < AM_BAND_KHZ_MIN || n > AM_BAND_KHZ_MAX){
    return {
      valid: false, kind: 'out_of_band',
      message: `Carrier ${n} kHz is outside the US AM band (${AM_BAND_KHZ_MIN}-${AM_BAND_KHZ_MAX} kHz).`
    };
  }
  if (n % AM_GRID_KHZ !== 0){
    return {
      valid: false, kind: 'off_grid',
      message: `Carrier ${n} kHz is not on the US 10-kHz AM grid.`
    };
  }
  if (n >= AM_EXPANDED_MIN && n <= AM_EXPANDED_MAX){
    return {
      valid: true, kind: 'expanded_band',
      message: `Carrier ${n} kHz is in the expanded band (${AM_EXPANDED_MIN}-${AM_EXPANDED_MAX} kHz, §73.30).`
    };
  }
  return { valid: true, kind: 'ok', message: null };
}

/**
 * The carrier wavelength in meters, c / f.  Used by §73.150 ground
 * wave synthesis to express tower spacing in wavelengths.
 * @param {number} khz
 * @returns {number}
 */
export function wavelengthMeters(khz){
  const n = Number(khz);
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return 299_792.458 / n;
}
