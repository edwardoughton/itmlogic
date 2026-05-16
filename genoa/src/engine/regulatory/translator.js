// 47 CFR §74.1204 — FM translator interference analysis.
//
// REFERENCE
//   §74.1204(a) prohibits authorizing an FM translator whose
//   F(50,10) field strength would exceed certain D/U (desired-to-
//   undesired) ratios at any point within the protected contour of a
//   nearby primary station.  The required ratios depend on the channel
//   relationship between translator and primary:
//
//     Co-channel       (Δf =       0 kHz)  : D/U ≥  20 dB
//     1st-adjacent     (Δf = ±  200 kHz)   : D/U ≥   6 dB
//     2nd-adjacent     (Δf = ±  400 kHz)   : D/U ≥ -40 dB
//     3rd-adjacent     (Δf = ±  600 kHz)   : D/U ≥ -40 dB
//     IF (10.6/10.8)   (Δf = ±10600,10800) : D/U ≥ -40 dB
//
//   Protected-contour fields:
//     Class A primary FM           : 1   mV/m (60 dBu) F(50,50)
//     Class B / B1 / C* primary FM : 0.5 mV/m (54 dBu) F(50,50)
//     LPFM primary                 : 1   mV/m (60 dBu) F(50,50)
//     FM translator (as desired)   : 1   mV/m (60 dBu) F(50,50)
//
// METHOD
//   For each candidate primary station passed in:
//     1. Compute the geodesic range Δ between translator and
//        primary (WGS-84 Karney 2013 inverse).
//     2. Compute the primary's protected contour distance along the
//        Tx→Tx bearing using F(50,50) at the primary's protected field
//        threshold (the "Tx-toward-translator" direction is the worst
//        case for §74.1204 because it's where U is largest).
//     3. The closest point of the primary's protected contour to the
//        translator is at range Δ - r_primary_protected.
//     4. Compute F(50,10) of the translator at that range — that is U.
//     5. D/U (dB) = D_threshold_dBu - U_field_dBu.  Compare to the
//        §74.1204(a) threshold for the channel relationship.
//
//   This is the standard short-spacing study used by the FCC translator
//   review tool; it is conservative (assumes the worst point of the
//   protected contour is on the line of sight) and it does not yet
//   model the primary's directional pattern or terrain shadowing.  A
//   future PR can lift those simplifications without changing this
//   API.
//
// OUTPUT
//   {
//     cite, pass, translator: {...}, studies: [...],
//     violations: [...], notes: [...]
//   }
//
//   `studies` is one entry per primary station evaluated; `violations`
//   is the subset of studies that fail their §74.1204 gate (cite
//   strings + structured detail).

import { fccDistanceKm, fccFieldDbuAtDistance } from '../curves/fcc/index.mjs';
import { karneyInverse } from '../geometry/wgs84.js';
import { studyContourPair, classifyFmOffsetKhz } from './_du_pair_study.js';

// §74.1204(a) D/U gates per channel relationship.  Values are dB.
export const TRANSLATOR_DU_GATES = Object.freeze({
  cochannel:        20,
  first_adjacent:    6,
  second_adjacent: -40,
  third_adjacent:  -40,
  if_offset:       -40
});

export const TRANSLATOR_DEFAULT_PROTECTED_FIELD_DBU_BY_CLASS = Object.freeze({
  A:    60,                     // Class A primary FM   — 1   mV/m
  B:    54,                     // Class B              — 0.5 mV/m
  B1:   54,                     // Class B1
  C0:   54,                     // Class C0
  C1:   54,                     // Class C1
  C2:   54,                     // Class C2
  C3:   54,                     // Class C3
  C:    54,                     // Class C
  LP100:60,                     // LPFM (LP100)
  LP10: 60,                     // LPFM (LP10, deprecated)
  D:    60,                     // FM translator/booster as desired
  FX:   60                      // alias
});

// 1st-adjacent FM is exactly 200 kHz; FM grid is 200 kHz.  The IF
// frequencies are 10.6 and 10.8 MHz from the carrier.  Resolves the
// shared FM offset classifier with this rule's D/U gate table.
function classifyChannelOffset(delta_khz){
  const c = classifyFmOffsetKhz(delta_khz);
  const gateMap = {
    cochannel:        TRANSLATOR_DU_GATES.cochannel,
    first_adjacent:   TRANSLATOR_DU_GATES.first_adjacent,
    second_adjacent:  TRANSLATOR_DU_GATES.second_adjacent,
    third_adjacent:   TRANSLATOR_DU_GATES.third_adjacent,
    if_offset:        TRANSLATOR_DU_GATES.if_offset,
    non_restricted:   null
  };
  return { ...c, du_db: gateMap[c.rel] };
}

function protectedFieldDbu(klass){
  if (!klass) return 60;
  const k = String(klass).toUpperCase().replace(/\s+/g, '');
  return TRANSLATOR_DEFAULT_PROTECTED_FIELD_DBU_BY_CLASS[k]
      ?? TRANSLATOR_DEFAULT_PROTECTED_FIELD_DBU_BY_CLASS[k.replace('CLASS', '')]
      ?? 60;
}

/**
 * Run a §74.1204 D/U study for a translator against a list of primary
 * stations.  See module header for method details.
 *
 * @param {object} args
 * @param {object} args.translator
 *        { erp_kw, haat_m, frequency_mhz, lat, lon, call?, facility_id? }
 * @param {Array<object>} [args.primaries]
 *        list of nearby primary stations.  Each entry:
 *        { call, facility_id, fcc_class, frequency_mhz,
 *          erp_kw, haat_m, lat, lon }
 *        Only stations whose channel relationship is restricted by
 *        §74.1204(a) (co/1st/2nd/3rd-adjacent or IF) are studied; others
 *        are recorded in `notes` and skipped.
 */
export function checkTranslatorInterference({ translator, primaries = [] } = {}){
  const violations = [];
  const notes      = [];
  const studies    = [];

  if (!translator || typeof translator !== 'object'){
    return {
      cite:        '47 CFR §74.1204',
      pass:        false,
      translator:  null,
      studies,
      violations:  [{
        cite:    '47 CFR §74.1204(a)',
        message: 'Translator inputs missing — interference study cannot be run.'
      }],
      notes:       ['translator object required: { erp_kw, haat_m, frequency_mhz, lat, lon }']
    };
  }

  const { erp_kw, haat_m, frequency_mhz, lat, lon } = translator;
  const have_translator_geometry =
    Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)) &&
    Number.isFinite(Number(haat_m)) && Number(haat_m) > 0 &&
    Number.isFinite(Number(erp_kw)) && Number(erp_kw) > 0 &&
    Number.isFinite(Number(frequency_mhz)) && Number(frequency_mhz) > 0;

  if (!have_translator_geometry){
    notes.push('translator must provide finite erp_kw, haat_m, frequency_mhz, lat, lon to run §74.1204 study.');
  }

  if (!Array.isArray(primaries) || primaries.length === 0){
    notes.push('No nearby primary stations provided.  §74.1204 D/U study cannot run; engine emits MISSING_NEARBY_STATIONS.');
    return {
      cite:        '47 CFR §74.1204',
      pass:        have_translator_geometry,
      translator:  { erp_kw, haat_m, frequency_mhz, lat, lon },
      studies,
      violations,
      notes,
      method:      'FCC tvfm_curves.js F(50,10) D/U analysis (vendored canonical)',
      missing_nearby_stations: true
    };
  }

  if (!have_translator_geometry){
    return {
      cite:        '47 CFR §74.1204',
      pass:        false,
      translator:  { erp_kw, haat_m, frequency_mhz, lat, lon },
      studies,
      violations,
      notes,
      method:      'FCC tvfm_curves.js F(50,10) D/U analysis (vendored canonical)'
    };
  }

  for (const p of primaries){
    const study = studyOnePrimary(translator, p);
    studies.push(study);
    if (study.pass === false){
      violations.push({
        cite:    '47 CFR §74.1204(a)',
        message: `D/U ${study.du_actual_db.toFixed(1)} dB at ${study.translator_distance_to_protected_edge_km.toFixed(2)} km into ${study.primary_call || study.primary_facility_id || 'primary'} (${study.relationship}) fails the ${study.du_threshold_db} dB §74.1204 gate.`,
        detail:  study
      });
    }
  }

  return {
    cite:        '47 CFR §74.1204',
    pass:        violations.length === 0,
    translator:  { erp_kw, haat_m, frequency_mhz, lat, lon },
    studies,
    violations,
    notes,
    method:      'FCC tvfm_curves.js F(50,10) D/U analysis (vendored canonical)'
  };
}

function studyOnePrimary(translator, primary){
  // Pre-compute channel relationship; non-restricted offsets are auto-pass.
  const fT = Number(translator.frequency_mhz);
  const fP = Number(primary.frequency_mhz);
  const delta_khz = Number.isFinite(fT) && Number.isFinite(fP)
    ? Math.round((fT - fP) * 1000) : null;
  const cls = delta_khz != null ? classifyChannelOffset(delta_khz)
                                : { rel: null, label: null, du_db: null };
  if (cls.rel === 'non_restricted'){
    return {
      primary_call:                            primary.call || null,
      primary_facility_id:                     primary.facility_id || null,
      primary_class:                           primary.fcc_class || null,
      primary_frequency_mhz:                   fP,
      translator_frequency_mhz:                fT,
      delta_khz,
      relationship:                            cls.label,
      du_threshold_db:                         null,
      primary_protected_field_dbu:             null,
      separation_km:                           null,
      primary_protected_distance_km:           null,
      translator_distance_to_protected_edge_km:null,
      translator_field_dbu_at_edge:            null,
      du_actual_db:                            null,
      pass:                                    true,
      skipped:                                 true,
      skipped_reason:                          `channel offset ${delta_khz} kHz is not restricted by §74.1204(a).`
    };
  }

  const D_dbu = protectedFieldDbu(primary.fcc_class);
  const pair  = studyContourPair(translator, primary, {
    relationship:        cls.label,
    du_threshold_db:     cls.du_db,
    protected_field_dbu: D_dbu
  });

  // Re-shape pair-study output into the §74.1204 study schema.
  // Translator is U; primary is D.
  return {
    primary_call:                            pair.d_call,
    primary_facility_id:                     pair.d_facility_id,
    primary_class:                           pair.d_class,
    primary_frequency_mhz:                   pair.d_frequency_mhz,
    translator_frequency_mhz:                pair.u_frequency_mhz,
    delta_khz,
    relationship:                            pair.relationship,
    du_threshold_db:                         pair.du_threshold_db,
    primary_protected_field_dbu:             pair.d_protected_field_dbu,
    separation_km:                           pair.separation_km,
    primary_protected_distance_km:           pair.d_protected_distance_km,
    translator_distance_to_protected_edge_km:pair.u_distance_to_d_protected_edge_km,
    translator_field_dbu_at_edge:            pair.u_field_dbu_at_d_edge,
    du_actual_db:                            pair.du_actual_db,
    pass:                                    pair.pass,
    skipped:                                 pair.skipped,
    skipped_reason:                          pair.skipped_reason,
    notes_internal_translator_inside_primary:pair.inside_protected_contour || undefined
  };
}
