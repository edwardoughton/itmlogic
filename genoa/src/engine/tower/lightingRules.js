// Tower marking + lighting rules engine.
//
// SCOPE
//   Pure deterministic compute of the marking + lighting required by
//   the FAA / FCC for an antenna structure of a given height and
//   class.  Implements the rules cascade from:
//
//     - 47 CFR §17.7  — notification threshold (200 ft AGL gate)
//     - 47 CFR §17.21 — general marking + lighting requirement
//     - 47 CFR §17.23 — marking + lighting specifications
//     - FAA AC 70/7460-1L (Obstruction Marking and Lighting,
//                         current revision: AC 70/7460-1L issued 2015,
//                         changes incorporated through Change 1 (2018))
//         Chapter 3:  Aviation Orange + White Paint marking
//         Chapter 4:  Aviation Red Obstruction Lighting (L-864 + L-810)
//         Chapter 5:  Medium-Intensity White (L-865)
//         Chapter 6:  Medium-Intensity Dual Red-White (L-864 + L-865)
//         Chapter 7:  High-Intensity White (L-856 / L-857)
//         Chapter 8:  Catenary (powerline) lighting
//         Chapter 9:  Wind turbine lighting
//
//   The output is a CITE-grade compliance recommendation.  The FAA's
//   Form 7460-2 determination letter is AUTHORITATIVE — this engine's
//   output is a preliminary engineer-of-record check that should AGREE
//   with the FAA letter; mismatches indicate either a stale ASR record,
//   a non-standard FAA letter, or an engineer's input error.
//
// LIMITATIONS
//   - Does not handle airport-proximity slope criteria (§17.7(a)(2)).
//     Operator must set near_airport=true if site triggers.
//   - Does not handle special structures: METs (§14), wind turbines
//     (§9), powerline catenaries (§8), or temporary cranes.
//   - Does not pre-empt an FAA-issued case-specific lighting letter.
//
// USAGE
//   import { requiredTowerCompliance, compareToAsr } from './engine/tower';
//
//   const compliance = requiredTowerCompliance({
//     height_agl_m: 152.4,           // 500 ft
//     structure_type: 'TOWER',
//     near_airport:   false
//   });
//   // → { applicable, notification_required, marking, lighting,
//   //    height_agl_ft, cites: [...] }
//
//   const cmp = compareToAsr({ compliance, asr });
//   // → { ...compliance, comparison: { matches, gaps: [...] } }

import { check17_7c } from './airportProximity.js';

const FT_PER_M = 1 / 0.3048;

// 47 CFR §17.7(a)(1) — notification gate.
const NOTIFICATION_THRESHOLD_FT = 200;

// FAA AC 70/7460-1L breakpoints between lighting types.  These are
// the canonical engineering thresholds used in 99% of consulting
// practice; the FAA's case-specific letter may select a different
// system within the overlap zones.
const RED_OBSTRUCTION_MAX_FT       = 350;   // single L-864 + L-810 sides typical
const MEDIUM_INTENSITY_DUAL_MIN_FT = 200;   // can be used down to 200 ft as paint substitute
const MEDIUM_INTENSITY_DUAL_MAX_FT = 700;   // typical upper bound; can extend with paint
const HIGH_INTENSITY_MIN_FT        = 700;   // FAA AC 70/7460-1L Ch 7 starts here
const ULTRA_TALL_FT                = 2000;  // case-specific letter typical

export const MARKING_STYLES = Object.freeze({
  NONE:                      'none',
  AVIATION_ORANGE_WHITE:     'aviation-orange-and-white-bands',
  LIGHTING_IN_LIEU_OF_PAINT: 'lighting-in-lieu-of-paint'
});

export const LIGHTING_STYLES = Object.freeze({
  NONE:                       'none',
  RED_OBSTRUCTION_TYPE_A:     'red-obstruction-type-a',     // L-864 + L-810, AC Ch 4
  MEDIUM_INTENSITY_DUAL:      'medium-intensity-dual-red-white', // L-864 + L-865, AC Ch 6
  HIGH_INTENSITY_WHITE:       'high-intensity-flashing-white',   // L-856, AC Ch 7
  HIGH_INTENSITY_CASE_SPECIFIC:'high-intensity-case-specific'    // > 2000 ft, FAA letter required
});

// FAA chapter codes that appear on ASR records under
// `lighting_paint` / `lighting_requirement`.  The FAA assigns one or
// more of A0..A5, B0..B6, C0..C2, D0, E0, F1..F6, etc.  We collapse
// each prefix to one of our enumerated styles for the comparison.
//
// Ref: FAA AC 70/7460-1L Appendix 2 (Standard Catalog of Lighting Systems).
const FAA_CODE_TO_STYLE = Object.freeze({
  A:  LIGHTING_STYLES.RED_OBSTRUCTION_TYPE_A,
  B:  LIGHTING_STYLES.RED_OBSTRUCTION_TYPE_A,    // dual L-864 (Type B); same ours
  C:  LIGHTING_STYLES.MEDIUM_INTENSITY_DUAL,
  D:  LIGHTING_STYLES.MEDIUM_INTENSITY_DUAL,     // medium-int white only — same family
  E:  LIGHTING_STYLES.MEDIUM_INTENSITY_DUAL,
  F:  LIGHTING_STYLES.HIGH_INTENSITY_WHITE,
  G:  LIGHTING_STYLES.HIGH_INTENSITY_WHITE,      // high-int dual red/white
  H:  LIGHTING_STYLES.HIGH_INTENSITY_WHITE
});

/**
 * Compute the FAA / FCC marking and lighting requirement for an
 * antenna structure.
 *
 * @param {object} args
 * @param {number} args.height_agl_m         Overall height above ground level (m).  REQUIRED.
 * @param {number} [args.height_amsl_m]      Overall height above mean sea level (m).  Informational.
 * @param {string} [args.structure_type='TOWER']  'TOWER' | 'GUYED_TOWER' | 'BUILDING' | 'CATENARY' | 'WIND_TURBINE' | 'MET' | …
 * @param {boolean}[args.near_airport=false] Legacy operator boolean — superseded by airports_nearby when supplied.
 * @param {object[]}[args.airports_nearby]   List of public-use airports inside the §17.7(c) search radius
 *                                           (from the genoa-faa-airports sidecar).  When supplied, the
 *                                           §17.7(c) test runs against this list and the legacy
 *                                           near_airport boolean is ignored.  Each row carries
 *                                           { airport_id, ident, name, type, distance_m,
 *                                             longest_runway_ft, … }.
 * @returns {object} compliance recommendation
 */
export function requiredTowerCompliance({
  height_agl_m,
  height_amsl_m = null,
  structure_type = 'TOWER',
  near_airport = false,
  airports_nearby = null
} = {}){
  const cites = [];

  if (!Number.isFinite(Number(height_agl_m)) || Number(height_agl_m) <= 0){
    return {
      applicable: false,
      reason:    'height_agl_m is required and must be > 0',
      cites:    [{ rule: '47 CFR §17.7', text: 'FAA notification triggered by structure height + proximity' }]
    };
  }

  const height_agl_ft = Number(height_agl_m) * FT_PER_M;

  // §17.7(a)(1): notification required for structures > 200 ft AGL.
  // §17.7(c):    notification required within FAA-published airport
  //              proximity radii (4 nm short / 6 nm long / 5,000 ft
  //              heliport).  When `airports_nearby` is supplied (from
  //              the genoa-faa-airports sidecar), we run the real
  //              distance check; otherwise we honor the legacy
  //              near_airport boolean for backwards compatibility.
  let airport_check = null;
  if (Array.isArray(airports_nearby)){
    airport_check = check17_7c({ airports: airports_nearby });
  }
  const height_triggers   = height_agl_ft > NOTIFICATION_THRESHOLD_FT;
  const proximity_triggers = airport_check
    ? airport_check.triggered
    : !!near_airport;
  const notification_required = height_triggers || proximity_triggers;

  cites.push({
    rule: '47 CFR §17.7(a)',
    text: 'FAA notification required: structures > 200 ft AGL.',
    triggered: height_triggers
  });
  if (airport_check){
    cites.push({
      rule: '47 CFR §17.7(c)',
      text: airport_check.reason,
      triggered: airport_check.triggered,
      triggering_airports: airport_check.triggering_airports
    });
  } else if (near_airport){
    cites.push({
      rule: '47 CFR §17.7(c)',
      text: 'FAA notification required: within airport notification proximity (operator-attested; auto-check not available).',
      triggered: true
    });
  }

  // Below threshold and not near an airport — no FAA marking / lighting.
  if (!notification_required){
    return Object.freeze({
      applicable:           true,
      notification_required: false,
      structure_type,
      height_agl_m:         Number(height_agl_m),
      height_agl_ft:        Number(height_agl_ft.toFixed(1)),
      height_amsl_m:        Number.isFinite(Number(height_amsl_m)) ? Number(height_amsl_m) : null,
      marking: {
        required: false,
        style:    MARKING_STYLES.NONE,
        cites:   []
      },
      lighting: {
        required: false,
        style:    LIGHTING_STYLES.NONE,
        cites:   []
      },
      cites
    });
  }

  // Notification triggered — apply §17.21 / §17.23 marking + lighting.
  cites.push({
    rule: '47 CFR §17.21',
    text: 'Antenna structures requiring notification must be marked and/or lighted in accordance with the FAA-issued letter and the painting / lighting specifications in §17.23 and FAA AC 70/7460-1L.'
  });

  // -------- Lighting selection by height --------
  let lighting_style;
  let lighting_cite;
  if (height_agl_ft <= RED_OBSTRUCTION_MAX_FT){
    lighting_style = LIGHTING_STYLES.RED_OBSTRUCTION_TYPE_A;
    lighting_cite = {
      rule: 'FAA AC 70/7460-1L Chapter 4 (Type A)',
      text: 'Aviation Red Obstruction Lighting: single L-864 red beacon at top + L-810 steady-burning red side markers at intermediate levels.  Sunset to sunrise operation.'
    };
  } else if (height_agl_ft <= MEDIUM_INTENSITY_DUAL_MAX_FT){
    lighting_style = LIGHTING_STYLES.MEDIUM_INTENSITY_DUAL;
    lighting_cite = {
      rule: 'FAA AC 70/7460-1L Chapter 6 (Dual Red-White)',
      text: 'Medium-Intensity Dual Lighting: L-864 red flashing at night + L-865 white flashing at day/twilight.  Permits "lighting in lieu of paint" per §17.23(c).  20,000 cd day / 2,000 cd twilight / 2,000 cd night red.'
    };
  } else if (height_agl_ft < ULTRA_TALL_FT){
    lighting_style = LIGHTING_STYLES.HIGH_INTENSITY_WHITE;
    lighting_cite = {
      rule: 'FAA AC 70/7460-1L Chapter 7 (High-Intensity)',
      text: 'High-Intensity Flashing White (L-856): 270,000 cd day / 20,000 cd twilight / 2,000 cd night.  Eliminates the requirement for marking when installed at all required levels.'
    };
  } else {
    lighting_style = LIGHTING_STYLES.HIGH_INTENSITY_CASE_SPECIFIC;
    lighting_cite = {
      rule: 'FAA AC 70/7460-1L Chapter 7 + case-specific letter',
      text: 'Structures > 2,000 ft AGL: high-intensity flashing white per Chapter 7, plus FAA-issued case-specific lighting letter required (multiple beacons, intermediate side markers, daytime flashing operation).'
    };
  }

  // -------- Marking selection --------
  // §17.23(c): medium-intensity dual lighting at all required levels
  // permits "lighting in lieu of paint".  High-intensity also excuses
  // marking (Ch 7).  Otherwise paint is required per §17.23 + AC Ch 3.
  let marking_required;
  let marking_style;
  let marking_cite;
  if (lighting_style === LIGHTING_STYLES.MEDIUM_INTENSITY_DUAL ||
      lighting_style === LIGHTING_STYLES.HIGH_INTENSITY_WHITE  ||
      lighting_style === LIGHTING_STYLES.HIGH_INTENSITY_CASE_SPECIFIC){
    marking_required = false;
    marking_style    = MARKING_STYLES.LIGHTING_IN_LIEU_OF_PAINT;
    marking_cite = {
      rule: '47 CFR §17.23(c)',
      text: 'Marking may be omitted when medium-intensity dual or high-intensity white lighting is installed and operated at all required levels per AC 70/7460-1L.'
    };
  } else {
    marking_required = true;
    marking_style    = MARKING_STYLES.AVIATION_ORANGE_WHITE;
    marking_cite = {
      rule: 'FAA AC 70/7460-1L Chapter 3',
      text: 'Aviation Orange + Aviation White alternating bands.  Structure divided into seven equal segments; top + bottom bands Aviation Orange; minimum three bands; band depth ≥ 1/7 of overall height (max ~100 ft per band).'
    };
  }

  return Object.freeze({
    applicable:           true,
    notification_required: true,
    structure_type,
    height_agl_m:         Number(height_agl_m),
    height_agl_ft:        Number(height_agl_ft.toFixed(1)),
    height_amsl_m:        Number.isFinite(Number(height_amsl_m)) ? Number(height_amsl_m) : null,
    marking: {
      required: marking_required,
      style:    marking_style,
      cites:    [marking_cite]
    },
    lighting: {
      required: true,
      style:    lighting_style,
      cites:    [lighting_cite]
    },
    cites
  });
}

/**
 * Compare a rules-derived compliance recommendation against the
 * actual ASR record for the structure.  Flags gaps so the engineer-
 * of-record can investigate before filing.
 *
 * The ASR record's `lighting_requirement` field is the FAA's chapter
 * code (e.g., "A1", "C0", "F1").  We collapse each prefix letter to
 * our enumerated style and compare; an exact-style match is "OK", a
 * prefix-family mismatch is "warn", and a totally different family is
 * "major".
 *
 * @param {object} args
 * @param {object} args.compliance  output of requiredTowerCompliance()
 * @param {object} args.asr         ASR record (asrClient output)
 */
export function compareToAsr({ compliance, asr } = {}){
  if (!compliance?.applicable){
    return { ...compliance, comparison: { applicable: false, reason: 'rules-derived compliance not applicable' } };
  }
  if (!asr || asr.available !== true){
    return { ...compliance, comparison: { applicable: false, reason: 'ASR record not available' } };
  }
  const gaps = [];

  // Height cross-check (rules engine vs ASR record).
  if (Number.isFinite(asr.overall_height_m) && Number.isFinite(compliance.height_agl_m)){
    const dh = Math.abs(asr.overall_height_m - compliance.height_agl_m);
    if (dh > 1.0){
      gaps.push({
        field: 'height_agl_m',
        rules_value:   compliance.height_agl_m,
        asr_value:     asr.overall_height_m,
        delta_m:       Number(dh.toFixed(2)),
        tolerance:     '1 m',
        severity:      dh > 5 ? 'major' : 'minor',
        cite:          '47 CFR §17.4(c) — application data must agree with ASR record'
      });
    }
  }

  // Lighting style cross-check.  ASR carries an FAA chapter code; we
  // map the prefix letter to our enumerated style.
  const asrCode  = String(asr.lighting_requirement || '').trim().toUpperCase();
  const asrFirst = asrCode ? asrCode[0] : null;
  const asrStyle = asrFirst ? FAA_CODE_TO_STYLE[asrFirst] : null;
  const ruleStyle = compliance.lighting.style;
  if (asrStyle && ruleStyle !== LIGHTING_STYLES.NONE){
    if (asrStyle !== ruleStyle){
      gaps.push({
        field:        'lighting_style',
        rules_value:  ruleStyle,
        asr_value:    asrCode,
        asr_family:   asrStyle,
        severity:     'warn',
        note:         'Rules-derived style differs from FAA chapter code on the ASR record.  An FAA-issued lighting letter typically explains the difference; verify the letter is on file before filing.',
        cite:         'FAA AC 70/7460-1L Appendix 2'
      });
    }
  } else if (!asrCode && ruleStyle !== LIGHTING_STYLES.NONE){
    gaps.push({
      field:        'lighting_requirement',
      rules_value:  ruleStyle,
      asr_value:    null,
      severity:     'major',
      note:         'Rules engine recommends lighting; ASR record carries no lighting_requirement.  Either the ASR is stale (the FAA has issued a letter not yet reflected in the registration) or the structure is non-compliant.',
      cite:         '47 CFR §17.21 + §17.4(b)'
    });
  }

  // Marking style cross-check.
  const asrPaint = String(asr.painting_requirement || '').trim().toUpperCase();
  if (compliance.marking.required && !asrPaint){
    gaps.push({
      field:        'painting_requirement',
      rules_value:  compliance.marking.style,
      asr_value:    null,
      severity:     'minor',
      note:         'Rules engine recommends Aviation Orange / White paint; ASR record carries no painting_requirement.  Verify with the FAA letter.',
      cite:         '47 CFR §17.23(a) + AC 70/7460-1L Chapter 3'
    });
  }

  return {
    ...compliance,
    comparison: {
      applicable:    true,
      asr_lighting:  asrCode || null,
      asr_painting:  asrPaint || null,
      asr_family:    asrStyle || null,
      matches:       gaps.length === 0,
      n_gaps:        gaps.length,
      gaps,
      tolerances: {
        height_m: '1 m',
        lighting_style: 'FAA chapter prefix family',
        painting:       'presence/absence'
      }
    }
  };
}

export const TOWER_COMPLIANCE_PROVENANCE = Object.freeze({
  module:        'src/engine/tower/lightingRules.js',
  regulations:   ['47 CFR §17.4', '47 CFR §17.7', '47 CFR §17.21', '47 CFR §17.23'],
  faa_reference: 'FAA Advisory Circular AC 70/7460-1L (Obstruction Marking and Lighting), Change 1 (2018)',
  authoritative: 'FAA-issued case-specific lighting letter (Form 7460-2 determination) supersedes this engine.  Output is a preliminary engineer-of-record check.',
  thresholds: {
    notification_threshold_ft: NOTIFICATION_THRESHOLD_FT,
    red_obstruction_max_ft:    RED_OBSTRUCTION_MAX_FT,
    medium_intensity_max_ft:   MEDIUM_INTENSITY_DUAL_MAX_FT,
    high_intensity_min_ft:     HIGH_INTENSITY_MIN_FT,
    ultra_tall_ft:             ULTRA_TALL_FT
  },
  license_basis: '17 U.S.C. § 105 — methodology from §17.x and AC 70/7460-1L is US Government public domain'
});
