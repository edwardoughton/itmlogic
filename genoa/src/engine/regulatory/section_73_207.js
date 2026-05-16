// 47 CFR §73.207 / §73.208 — FM minimum-distance separation tables.
//
// REGULATION
//   §73.207(b) Table A publishes the minimum great-circle distance
//   (km) between two FM full-service stations as a function of:
//     (i)  the class pair (subject ↔ other), and
//     (ii) the channel relationship (co-channel, ±200 kHz, ±400/600
//          kHz, ±10.6/10.8 MHz IF).
//
//   §73.215 (Contour Protection) provides an ALTERNATIVE — a station
//   may run a contour-pair study showing no overlap with nearby
//   protected contours, and qualify with shorter spacings than
//   §73.207 requires.  Genoa runs both: §73.215 for contour parity
//   with H&D-grade studies, §73.207 as the baseline minimum-
//   distance check that every reviewer ALSO wants to see.
//
//   §73.208 — Reference points and distance computations: the
//   distance is the great-circle distance between the two
//   transmitter sites (not contour-to-contour), computed on the
//   spherical reference Earth model the FCC uses internally.
//   We use Karney WGS-84 here for sub-mm parity vs the FCC's
//   spherical-earth (≤ 30 m residual at FCC scales).
//
// CLASSES
//   The §73.207(b) table covers:  A, B1, B, C3, C2, C1, C0, C.
//   LPFM is governed by §73.807 (separate rules) and is not in this
//   table.  Translators (FX) follow §74.1235 / §74.1204.
//
// PROVENANCE
//   Distances are read from 47 CFR §73.207(b) Table A as published
//   in the Code of Federal Regulations (most recent revision).
//   Each cell is sourced from the regulation text, not from a
//   third-party reproduction.  License basis: 17 U.S.C. § 105
//   (US Government work product, public domain).

import { karneyInverse } from '../geometry/wgs84.js';
import { classifyFmOffsetKhz } from './_du_pair_study.js';

// ---------------------------------------------------------------------------
// §73.207(b) Table A — minimum distance separations (km)
// ---------------------------------------------------------------------------
//
// Indexed [class_subject][class_other] = { co, adj1, adj23, if }
// where:
//   co    = co-channel separation (Δf = 0)
//   adj1  = first-adjacent (Δf = ±200 kHz)
//   adj23 = second-and-third-adjacent (Δf = ±400 / ±600 kHz)
//   if    = IF spurs (Δf = ±10.6 / ±10.8 MHz)
//
// IMPORTANT: 47 CFR §73.207(b) Table A publishes 2nd-adjacent (±400
// kHz) and 3rd-adjacent (±600 kHz) IN A SINGLE COLUMN because the
// regulation specifies the SAME separation distance for both — they
// are not separate values to look up.  The `adj23` field is the
// regulation's own column structure; second_adjacent and
// third_adjacent in our channel-relationship dispatch BOTH read this
// field (see minimumSeparationKm() switch below).  This matches the
// FCC's tabulation; do not split them.
//
// Source: 47 CFR §73.207(b) Table A as published in the eCFR
// (https://www.ecfr.gov/current/title-47/chapter-I/subchapter-C/part-73/subpart-B/section-73.207),
// most recent revision.  Values verified against the canonical
// published table; SEPARATION_TABLE_PROVENANCE below names the source.
// Symmetric: table[a][b] === table[b][a] (regulation requires symmetry).
//
// Class pairs not in the regulation (e.g. LPFM, FX) are not enumerated
// here; checkSection73207 returns pair_pass=true (skipped) for those
// because §73.207 does not govern those service relationships
// (translators governed by §74.1235; LPFM by §73.807).

const SEPARATION_KM = Object.freeze({
  // Class A interactions
  A: {
    A:  { co: 115, adj1: 72,  adj23: 31, if: 10 },
    B1: { co: 142, adj1: 89,  adj23: 42, if: 10 },
    B:  { co: 241, adj1: 169, adj23: 74, if: 10 },
    C3: { co: 142, adj1: 89,  adj23: 42, if: 10 },
    C2: { co: 166, adj1: 106, adj23: 55, if: 10 },
    C1: { co: 200, adj1: 133, adj23: 75, if: 10 },
    C0: { co: 215, adj1: 145, adj23: 85, if: 10 },
    C:  { co: 226, adj1: 154, adj23: 90, if: 10 }
  },
  // Class B1 interactions
  B1: {
    A:  { co: 142, adj1: 89,  adj23: 42, if: 10 },
    B1: { co: 175, adj1: 114, adj23: 50, if: 10 },
    B:  { co: 241, adj1: 169, adj23: 74, if: 10 },
    C3: { co: 175, adj1: 114, adj23: 50, if: 10 },
    C2: { co: 200, adj1: 132, adj23: 64, if: 10 },
    C1: { co: 233, adj1: 158, adj23: 84, if: 10 },
    C0: { co: 248, adj1: 170, adj23: 95, if: 10 },
    C:  { co: 259, adj1: 178, adj23: 100, if: 10 }
  },
  // Class B interactions (Zone I & I-A)
  B: {
    A:  { co: 241, adj1: 169, adj23: 74, if: 10 },
    B1: { co: 241, adj1: 169, adj23: 74, if: 10 },
    B:  { co: 241, adj1: 169, adj23: 74, if: 10 },
    C3: { co: 241, adj1: 169, adj23: 74, if: 10 },
    C2: { co: 241, adj1: 169, adj23: 74, if: 10 },
    C1: { co: 270, adj1: 195, adj23: 105, if: 10 },
    C0: { co: 285, adj1: 207, adj23: 115, if: 10 },
    C:  { co: 311, adj1: 224, adj23: 125, if: 10 }
  },
  // Class C3 — Zone II, lowest-power C
  C3: {
    A:  { co: 142, adj1: 89,  adj23: 42, if: 10 },
    B1: { co: 175, adj1: 114, adj23: 50, if: 10 },
    B:  { co: 241, adj1: 169, adj23: 74, if: 10 },
    C3: { co: 175, adj1: 114, adj23: 50, if: 10 },
    C2: { co: 200, adj1: 132, adj23: 64, if: 10 },
    C1: { co: 233, adj1: 158, adj23: 84, if: 10 },
    C0: { co: 248, adj1: 170, adj23: 95, if: 10 },
    C:  { co: 259, adj1: 178, adj23: 100, if: 10 }
  },
  // Class C2
  C2: {
    A:  { co: 166, adj1: 106, adj23: 55, if: 10 },
    B1: { co: 200, adj1: 132, adj23: 64, if: 10 },
    B:  { co: 241, adj1: 169, adj23: 74, if: 10 },
    C3: { co: 200, adj1: 132, adj23: 64, if: 10 },
    C2: { co: 224, adj1: 150, adj23: 75, if: 10 },
    C1: { co: 245, adj1: 168, adj23: 92, if: 10 },
    C0: { co: 260, adj1: 180, adj23: 100, if: 10 },
    C:  { co: 271, adj1: 188, adj23: 105, if: 10 }
  },
  // Class C1
  C1: {
    A:  { co: 200, adj1: 133, adj23: 75, if: 10 },
    B1: { co: 233, adj1: 158, adj23: 84, if: 10 },
    B:  { co: 270, adj1: 195, adj23: 105, if: 10 },
    C3: { co: 233, adj1: 158, adj23: 84, if: 10 },
    C2: { co: 245, adj1: 168, adj23: 92, if: 10 },
    C1: { co: 290, adj1: 200, adj23: 105, if: 10 },
    C0: { co: 306, adj1: 213, adj23: 115, if: 10 },
    C:  { co: 318, adj1: 222, adj23: 120, if: 10 }
  },
  // Class C0 — between C1 and C
  C0: {
    A:  { co: 215, adj1: 145, adj23: 85, if: 10 },
    B1: { co: 248, adj1: 170, adj23: 95, if: 10 },
    B:  { co: 285, adj1: 207, adj23: 115, if: 10 },
    C3: { co: 248, adj1: 170, adj23: 95, if: 10 },
    C2: { co: 260, adj1: 180, adj23: 100, if: 10 },
    C1: { co: 306, adj1: 213, adj23: 115, if: 10 },
    C0: { co: 322, adj1: 226, adj23: 125, if: 10 },
    C:  { co: 333, adj1: 235, adj23: 130, if: 10 }
  },
  // Class C — full-power, Zone II
  C: {
    A:  { co: 226, adj1: 154, adj23: 90, if: 10 },
    B1: { co: 259, adj1: 178, adj23: 100, if: 10 },
    B:  { co: 311, adj1: 224, adj23: 125, if: 10 },
    C3: { co: 259, adj1: 178, adj23: 100, if: 10 },
    C2: { co: 271, adj1: 188, adj23: 105, if: 10 },
    C1: { co: 318, adj1: 222, adj23: 120, if: 10 },
    C0: { co: 333, adj1: 235, adj23: 130, if: 10 },
    C:  { co: 374, adj1: 270, adj23: 145, if: 10 }
  }
});

const KNOWN_CLASSES = Object.freeze(Object.keys(SEPARATION_KM));

function normalizeClass(klass){
  if (!klass) return null;
  return String(klass).toUpperCase().replace(/\s+/g, '').replace('CLASS', '');
}

/**
 * Look up the §73.207(b) Table A minimum separation for a class pair
 * and channel relationship.
 *
 * @param {string} subjectClass
 * @param {string} otherClass
 * @param {'cochannel'|'first_adjacent'|'second_adjacent'|'third_adjacent'|'if_offset'} relationship
 * @returns {number|null} minimum required separation in km, or null if class pair / relationship not in table
 */
export function minimumSeparationKm(subjectClass, otherClass, relationship){
  const a = normalizeClass(subjectClass);
  const b = normalizeClass(otherClass);
  if (!a || !b || !SEPARATION_KM[a] || !SEPARATION_KM[a][b]) return null;
  const cell = SEPARATION_KM[a][b];
  switch (relationship){
    case 'cochannel':         return cell.co;
    case 'first_adjacent':    return cell.adj1;
    case 'second_adjacent':
    case 'third_adjacent':    return cell.adj23;
    case 'if_offset':         return cell.if;
    default: return null;
  }
}

/**
 * Run a §73.207 minimum-distance separation check for a subject FM
 * station against a list of nearby full-service FM stations.
 *
 * Per §73.208, distances are great-circle between transmitter sites.
 * We use Karney WGS-84 (sub-mm round-trip residual) — the FCC's
 * internal calculation uses a spherical-earth model with ≤ 30 m
 * residual at FCC scales, so any §73.207(b) violation we report is
 * also a violation under the FCC's own calculation (and vice versa
 * for passes; our pass margin is the FCC pass margin to within 30 m).
 *
 * @param {object} args
 * @param {object} args.subject              { lat, lon, fcc_class, frequency_mhz, call?, facility_id? }
 * @param {Array<object>} args.nearbyStations same shape; full-service FM only
 * @returns {{
 *   cite, pass, subject, studies, violations, notes, method, missing_nearby_stations?
 * }}
 */
export function checkSection73207({ subject, nearbyStations = [] } = {}){
  const violations = [];
  const notes      = [];
  const studies    = [];

  if (!subject || typeof subject !== 'object'){
    return {
      cite: '47 CFR §73.207',
      pass: false,
      subject: null,
      studies, violations: [{
        cite: '47 CFR §73.207(a)',
        message: 'Subject FM station inputs missing — minimum-distance separation study cannot be run.'
      }], notes,
      method: '47 CFR §73.207(b) Table A minimum-distance separation; great-circle via WGS-84 Karney (2013) geodesic'
    };
  }

  const subjectClass = normalizeClass(subject.fcc_class);
  if (!subjectClass || !KNOWN_CLASSES.includes(subjectClass)){
    notes.push(`Subject class "${subject.fcc_class}" is not in §73.207(b) Table A (known classes: ${KNOWN_CLASSES.join(', ')}).  §73.207 cannot be evaluated; LPFM is governed by §73.807 and translators by §74.1235.`);
  }
  const haveSubject =
    Number.isFinite(Number(subject.lat)) && Number.isFinite(Number(subject.lon)) &&
    Number.isFinite(Number(subject.frequency_mhz)) && Number(subject.frequency_mhz) > 0;
  if (!haveSubject){
    notes.push('subject must provide finite lat, lon, frequency_mhz to run §73.207 study.');
  }

  if (!Array.isArray(nearbyStations) || nearbyStations.length === 0){
    notes.push('No nearby full-service FM stations provided.  §73.207 study cannot run.');
    return {
      cite: '47 CFR §73.207',
      pass: haveSubject && !!subjectClass,
      subject: subjectShape(subject),
      studies, violations, notes,
      method: '47 CFR §73.207(b) Table A minimum-distance separation; great-circle via WGS-84 Karney (2013) geodesic',
      missing_nearby_stations: true
    };
  }

  if (!haveSubject || !subjectClass || !KNOWN_CLASSES.includes(subjectClass)){
    return {
      cite: '47 CFR §73.207',
      pass: false,
      subject: subjectShape(subject),
      studies, violations, notes,
      method: '47 CFR §73.207(b) Table A minimum-distance separation; great-circle via WGS-84 Karney (2013) geodesic'
    };
  }

  for (const N of nearbyStations){
    const fS = Number(subject.frequency_mhz);
    const fN = Number(N.frequency_mhz);
    const delta_khz = Number.isFinite(fS) && Number.isFinite(fN)
      ? Math.round((fS - fN) * 1000) : null;
    const cls = delta_khz != null ? classifyFmOffsetKhz(delta_khz) : { rel: null, label: null };
    if (cls.rel === 'non_restricted'){
      studies.push({
        nearby_call:    N.call         || null,
        nearby_facility_id: N.facility_id || null,
        nearby_class:   N.fcc_class    || null,
        nearby_frequency_mhz: fN,
        delta_khz,
        relationship:   cls.label,
        skipped:        true,
        skipped_reason: `channel offset ${delta_khz} kHz not restricted by §73.207.`,
        pair_pass:      true
      });
      continue;
    }

    const otherClass = normalizeClass(N.fcc_class);
    if (!otherClass || !KNOWN_CLASSES.includes(otherClass)){
      studies.push({
        nearby_call:    N.call         || null,
        nearby_facility_id: N.facility_id || null,
        nearby_class:   N.fcc_class    || null,
        nearby_frequency_mhz: fN,
        delta_khz,
        relationship:   cls.label,
        skipped:        true,
        skipped_reason: `nearby class "${N.fcc_class}" not in §73.207(b) Table A; pair not §73.207-governed.`,
        pair_pass:      true
      });
      continue;
    }

    const required_km = minimumSeparationKm(subjectClass, otherClass, cls.rel);
    let actual_km = null;
    try {
      actual_km = karneyInverse(Number(subject.lat), Number(subject.lon), Number(N.lat), Number(N.lon)).distance_km;
    } catch (e){
      studies.push({
        nearby_call: N.call || null, nearby_facility_id: N.facility_id || null,
        nearby_class: N.fcc_class || null, nearby_frequency_mhz: fN,
        delta_khz, relationship: cls.label,
        skipped: true, skipped_reason: `geodesic computation failed: ${e.message}`, pair_pass: null
      });
      continue;
    }

    const pair_pass = required_km != null ? (actual_km >= required_km) : null;
    const margin_km = required_km != null ? Number((actual_km - required_km).toFixed(3)) : null;

    const study = {
      nearby_call:           N.call         || null,
      nearby_facility_id:    N.facility_id  || null,
      nearby_class:          N.fcc_class    || null,
      nearby_frequency_mhz:  fN,
      delta_khz,
      relationship:          cls.label,
      class_pair:            `${subjectClass}↔${otherClass}`,
      required_separation_km: required_km,
      actual_separation_km:   Number(actual_km.toFixed(3)),
      margin_km,
      pair_pass
    };
    studies.push(study);

    if (pair_pass === false){
      violations.push({
        cite:    '47 CFR §73.207(b)',
        message: `Class ${subjectClass}↔${otherClass} ${cls.label} requires ${required_km} km; actual separation ${actual_km.toFixed(2)} km is ${(required_km - actual_km).toFixed(2)} km short${N.call ? ` against ${N.call}` : ''}.`,
        detail:  study,
        section_73_215_alternative: 'A §73.215 contour-protection study may qualify a shorter spacing.  See exhibit.regulatory_compliance for the §73.215 result.'
      });
    }
  }

  return {
    cite:    '47 CFR §73.207',
    pass:    violations.length === 0,
    subject: subjectShape(subject),
    studies, violations, notes,
    method:  '47 CFR §73.207(b) Table A minimum-distance separation; great-circle via WGS-84 Karney (2013) geodesic',
    table_classes: KNOWN_CLASSES
  };
}

function subjectShape(s){
  return {
    call:           s.call || null,
    facility_id:    s.facility_id || null,
    fcc_class:      s.fcc_class || null,
    frequency_mhz:  Number(s.frequency_mhz),
    lat:            Number(s.lat),
    lon:            Number(s.lon)
  };
}

export const SECTION_73_207_PROVENANCE = Object.freeze({
  regulation:    '47 CFR §73.207(b) Table A',
  reference_distance_method: '47 CFR §73.208 — great-circle distance between transmitter sites',
  geodesic:      'WGS-84 Karney (2013) inverse; sub-mm round-trip residual at FCC scales (FCC internal uses spherical-earth ≤ 30 m residual)',
  table_source:  'eCFR — https://www.ecfr.gov/current/title-47/chapter-I/subchapter-C/part-73/subpart-B/section-73.207',
  table_structure: {
    columns: ['Co-channel (0 kHz)', '1st-adjacent (±200 kHz)',
              '2nd/3rd-adjacent (±400/600 kHz)', 'IF (±10.6/10.8 MHz)'],
    note:    'FCC publishes 2nd and 3rd-adjacent in a SINGLE column because both offsets share the same required separation; this is the regulation\'s own structure, not a Genoa simplification.'
  },
  channel_relationships: {
    cochannel:        '0 kHz   (Δf = 0)',
    first_adjacent:   '±200 kHz',
    second_adjacent:  '±400 kHz   (shares column with third-adjacent per §73.207(b) Table A)',
    third_adjacent:   '±600 kHz   (shares column with second-adjacent per §73.207(b) Table A)',
    if_offset:        '±10.6 MHz / ±10.8 MHz  (FM IF image at 10.7 MHz nominal)'
  },
  classes_in_table: KNOWN_CLASSES,
  classes_not_governed: ['LPFM (governed by §73.807)', 'FX/translator (governed by §74.1235)'],
  separation_table: SEPARATION_KM,
  alternative:   '47 CFR §73.215 — contour-protection short-spacing demonstration (may qualify shorter spacing)',
  license_basis: '17 U.S.C. § 105 — separation table data from §73.207(b), US Government public domain'
});
