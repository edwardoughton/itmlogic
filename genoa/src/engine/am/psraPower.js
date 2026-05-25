// 47 CFR §73.99(b)(1) — Pre-Sunrise / Post-Sunset reduced-power formula.
//
// REGULATION
//   §73.99(b)(1) — A station authorized for daytime, post-sunset, or
//   limited-time operation may operate at REDUCED power during the
//   PSRA / PSSA hours.  Reduced power is the SMALLER of:
//
//     (i)   500 W (the §73.99(b)(1) ceiling); or
//     (ii)  the power that would NOT cause objectionable interference
//           to the protected nighttime service of any other station.
//
//   For each protected station N (co-channel or 1st-adjacent), the
//   §73.99(b)(1) computation is:
//
//       P_allowed_at_N (W) = P_daytime * ( E_max_allowed_at_N / E_actual_at_N )^2
//
//   where:
//     E_actual_at_N      = proposed station's 50% (PSSA) or 10% (PSRA)
//                          skywave field at N's protected contour
//                          when transmitting at P_daytime
//     E_max_allowed_at_N = the §73.182 RSS-equivalent field that the
//                          proposed station is allowed to contribute
//                          to N's nighttime protected contour
//                          (typically the §73.187 SS-1 / SS-2 limit
//                          divided down so the proposed station's
//                          share doesn't exceed the RSS budget)
//     P_daytime          = the proposed station's filed daytime ERP
//
//   The actual reduced power is:
//
//       P_reduced = min(500 W,  P_allowed_at_N over all protected N)
//
//   §73.99(b)(2) — Pre-Sunrise uses the 10% skywave (SS-2) field
//   strength; Post-Sunset uses the 50% (SS-1).  Both per §73.190.
//
// SCOPE OF THIS MODULE
//   Implements the closed-form scaling.  Skywave fields come from
//   the FCCAM (or Berry-screening) client passed in via ctx — same
//   shape as the rest of the AM-night engine chain.  No new sidecar
//   calls; consumes the field values the upstream skywave engine
//   already produces.
//
// REGULATORY
//   - 47 CFR §73.99(b)(1)  — reduced-power formula
//   - 47 CFR §73.99(b)(2)  — SS-1 vs SS-2 selection (PSSA vs PSRA)
//   - 47 CFR §73.182(k)    — RSS allocation that feeds E_max_allowed
//   - 47 CFR §73.190(c)    — skywave engine (Wang / Berry)
//   - 17 USC §105          — public-domain regulation text

const POWER_CEILING_W   = 500;
const PSRA_PERCENT_TIME = 10;
const PSSA_PERCENT_TIME = 50;

/**
 * Compute the per-protected-station allowed reduced power for the
 * proposed station.
 *
 * @param {object} args
 * @param {number} args.p_daytime_kw         proposed station's filed daytime ERP (kW)
 * @param {number} args.e_actual_uv_m        proposed's skywave field at N's contour @ p_daytime_kw
 * @param {number} args.e_max_allowed_uv_m   §73.182 allowed contribution at N's contour
 * @returns {{ p_allowed_w: number, scale_factor: number }}
 */
export function reducedPowerForOnePair({
  p_daytime_kw, e_actual_uv_m, e_max_allowed_uv_m
} = {}){
  const Pd = Number(p_daytime_kw);
  const Ea = Number(e_actual_uv_m);
  const Em = Number(e_max_allowed_uv_m);
  if (!Number.isFinite(Pd) || Pd <= 0
      || !Number.isFinite(Ea) || Ea <= 0
      || !Number.isFinite(Em) || Em < 0){
    return { p_allowed_w: NaN, scale_factor: NaN };
  }
  // Closed-form: P scales as field² → multiply by (Em/Ea)²
  const ratio = Em / Ea;
  const scale = ratio * ratio;
  const p_allowed_kw = Pd * scale;
  return {
    p_allowed_w:  Number((p_allowed_kw * 1000).toFixed(2)),
    scale_factor: Number(scale.toFixed(6))
  };
}

/**
 * Compute the §73.99 PSRA + PSSA reduced powers for a proposed
 * station against a list of protected nearby AMs.  Pure function;
 * caller supplies the per-pair skywave field values (which usually
 * come from the FCCAM sidecar or Berry fallback).
 *
 * @param {object} input
 * @param {object} input.proposed         { p_daytime_kw, call?, facility_id?, freq_khz, fcc_class }
 * @param {Array}  input.protected_pairs  per-protected-station rows
 * @returns {object}
 */
export function computePsraPssaPower(input){
  const { proposed, protected_pairs: rawPairs } = input || {};
  if (!proposed || !Number.isFinite(Number(proposed.p_daytime_kw)) || Number(proposed.p_daytime_kw) <= 0){
    return { ok: false, error: 'proposed.p_daytime_kw must be a positive number (kW)' };
  }
  // protected_pairs may arrive as null/undefined from JSON/db layers
  // (Codex P2 on #181) — normalize to [] before iterating instead of
  // throwing a TypeError.  Non-arrays (object/scalar) are rejected
  // explicitly so misshapen inputs surface as a validation error,
  // not silent zero-pairs.
  if (rawPairs != null && !Array.isArray(rawPairs)){
    return { ok: false, error: 'protected_pairs must be an array (or null/undefined)' };
  }
  const protected_pairs = Array.isArray(rawPairs) ? rawPairs : [];

  const pssaPairs = [];
  const psraPairs = [];

  for (const N of protected_pairs){
    if (N?.pssa){
      const r = reducedPowerForOnePair({
        p_daytime_kw:       proposed.p_daytime_kw,
        e_actual_uv_m:      N.pssa.e_actual_uv_m,
        e_max_allowed_uv_m: N.pssa.e_max_allowed_uv_m
      });
      pssaPairs.push({
        call:        N.call || null,
        facility_id: N.facility_id || null,
        fcc_class:   N.fcc_class || null,
        relation:    N.relation || 'co_channel',
        p_allowed_w: r.p_allowed_w,
        scale_factor: r.scale_factor,
        e_actual_uv_m:      N.pssa.e_actual_uv_m,
        e_max_allowed_uv_m: N.pssa.e_max_allowed_uv_m,
        percent_time: PSSA_PERCENT_TIME
      });
    }
    if (N?.psra){
      const r = reducedPowerForOnePair({
        p_daytime_kw:       proposed.p_daytime_kw,
        e_actual_uv_m:      N.psra.e_actual_uv_m,
        e_max_allowed_uv_m: N.psra.e_max_allowed_uv_m
      });
      psraPairs.push({
        call:        N.call || null,
        facility_id: N.facility_id || null,
        fcc_class:   N.fcc_class || null,
        relation:    N.relation || 'co_channel',
        p_allowed_w: r.p_allowed_w,
        scale_factor: r.scale_factor,
        e_actual_uv_m:      N.psra.e_actual_uv_m,
        e_max_allowed_uv_m: N.psra.e_max_allowed_uv_m,
        percent_time: PSRA_PERCENT_TIME
      });
    }
  }

  const windowFor = (pairs, percent_time) => {
    const valid = pairs.filter((p) => Number.isFinite(p.p_allowed_w));
    // Two distinct "no valid pair" cases — distinguish so the
    // appendix doesn't fail-open on malformed upstream data
    // (Codex P1 on #181).
    //
    //   - Genuine zero pairs (pairs.length === 0) → there are no
    //     protected stations in this pool; the §73.99(b)(1) ceiling
    //     IS the right answer.  Surfaced as available with note.
    //
    //   - Pairs were supplied but every one produced NaN — upstream
    //     skywave data is malformed (e_actual_uv_m ≤ 0, missing
    //     fields, etc.).  This is NOT a permissive 500 W result;
    //     surface as available:false so the appendix shows the
    //     diagnostic instead of a falsely-permissive filing power.
    if (valid.length === 0 && pairs.length > 0){
      return {
        available:       false,
        p_reduced_w:     null,
        binding:         null,
        per_pair:        pairs,
        percent_time,
        ceiling_applied: false,
        error:           `All ${pairs.length} protected pair(s) produced NaN power — upstream skywave fields are missing or non-positive.  §73.99(b)(1) ceiling NOT applied; reviewer must investigate.`
      };
    }
    if (valid.length === 0){
      return {
        available:       true,
        p_reduced_w:     POWER_CEILING_W,
        binding:         null,
        per_pair:        pairs,
        percent_time,
        ceiling_applied: true,
        note:            'No protected pairs evaluable — only the §73.99(b)(1) 500 W ceiling applies.'
      };
    }
    const sorted = valid.slice().sort((a, b) => a.p_allowed_w - b.p_allowed_w);
    const binding = sorted[0];
    const p_from_pairs = binding.p_allowed_w;
    const p_reduced = Math.min(POWER_CEILING_W, p_from_pairs);
    return {
      available:       true,
      p_reduced_w:     Number(p_reduced.toFixed(2)),
      binding,
      per_pair:        pairs,
      percent_time,
      ceiling_applied: p_from_pairs >= POWER_CEILING_W,
      note:            p_from_pairs >= POWER_CEILING_W
                         ? `Binding pair allows ${p_from_pairs.toFixed(0)} W; clipped to the §73.99(b)(1) 500 W ceiling.`
                         : `Binding pair (${binding.call || binding.facility_id || 'unknown'}, ${binding.relation}) limits power to ${p_reduced.toFixed(0)} W.`
    };
  };

  return {
    ok:        true,
    proposed:  proposed,
    pssa:      windowFor(pssaPairs, PSSA_PERCENT_TIME),
    psra:      windowFor(psraPairs, PSRA_PERCENT_TIME),
    ceiling_w: POWER_CEILING_W,
    regulation:'47 CFR §73.99(b)(1) / §73.99(b)(2)',
    notes: [
      'Reduced powers are the SMALLER of 500 W (§73.99(b)(1) ceiling) and the per-pair allowed power.',
      'PSSA uses 50% skywave (SS-1, §73.190).  PSRA uses 10% skywave (SS-2, §73.190).',
      'Operator-supplied e_max_allowed_uv_m embeds the §73.182(k) RSS budget split — engine does not allocate the RSS share itself.'
    ]
  };
}

export const PSRA_PSSA_POWER_PROVENANCE = Object.freeze({
  module:        'src/engine/am/psraPower.js',
  regulation:    '47 CFR §73.99(b)(1) / §73.99(b)(2) (PSRA/PSSA reduced-power formula)',
  modeled: [
    'Closed-form P_allowed = P_daytime · (E_max_allowed / E_actual)² per protected pair',
    'Binding-pair selection (smallest allowed)',
    '§73.99(b)(1) 500 W ceiling enforcement with ceiling_applied flag',
    'Separate SS-1 (50%) PSSA and SS-2 (10%) PSRA evaluation pools'
  ],
  not_modeled: [
    '§73.182(k) RSS allocation that produces E_max_allowed (caller supplies)',
    'Skywave field calculation (FCCAM / Berry — caller calls those for E_actual)',
    'Class D / limited-time licensing categories (§73.1730) — separate filing path'
  ],
  license_basis: '17 USC §105 (FCC rules, US Government public domain)'
});
