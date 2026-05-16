// 47 CFR §73.215 — FM contour-protection short-spacing analysis.
//
// REFERENCE
//   §73.207 establishes minimum class-pair distance separations.
//   §73.215 permits SHORTER spacings than §73.207 if the proposed
//   station's interfering F(50,10) contour does not overlap any
//   nearby station's protected F(50,50) contour, AND the nearby
//   station's interfering F(50,10) contour does not overlap the
//   proposed station's protected F(50,50) contour.  The check is
//   bidirectional and pair-wise; the same D/U gates as §74.1204(c)
//   apply for the restricted offsets:
//
//     Co-channel       (Δf =       0 kHz)  : D/U ≥  20 dB
//     1st-adjacent     (Δf = ±  200 kHz)   : D/U ≥   6 dB
//     2nd-adjacent     (Δf = ±  400 kHz)   : D/U ≥ -40 dB
//     3rd-adjacent     (Δf = ±  600 kHz)   : D/U ≥ -40 dB
//     IF (10.6/10.8)   (Δf = ±10600,10800) : D/U ≥ -40 dB
//
//   Protected-contour fields per §73.211 (FM full-service):
//     Class A                                   :  60 dBu (1   mV/m)
//     Class B / B1 / C / C0 / C1 / C2 / C3      :  54 dBu (0.5 mV/m)
//
//   §73.215 additionally requires the proposed station to demonstrate
//   that any actual short-spacing relative to §73.207's table is
//   covered by contour protection — this engine emits the per-pair
//   D/U study so a reviewer can see both legs at once.
//
// METHOD
//   For each nearby full-service FM station N:
//     forward = studyContourPair(subject, N) — subject's F(50,10) at
//                                              N's protected edge
//     reverse = studyContourPair(N, subject) — N's F(50,10) at
//                                              subject's protected edge
//     pair_pass = forward.pass && reverse.pass
//
//   The whole §73.215 check passes iff every pair_pass is true.
//
// LIMITATIONS
//   This engine evaluates point-bearing contour edges (worst-case range
//   along the inter-station line) rather than full polygon overlap.
//   That matches the FCC's contour-protection short-spacing tool
//   convention and is the same simplification used in §74.1204
//   above — it is conservative when the subject's pattern is
//   omnidirectional and accurate at the worst-case bearing for any
//   pattern.  A future PR can lift this to ring-vs-ring polygon
//   intersection without changing the API.

import { studyContourPair, classifyFmOffsetKhz } from './_du_pair_study.js';
import { fccDistanceKm }       from '../curves/fcc/index.mjs';
import { buildContourPolygon, polygonOverlap } from '../geometry/polygonOverlap.js';

// §73.215 reuses the §74.1204(c) D/U gates for the restricted offsets.
export const SECTION_73_215_DU_GATES = Object.freeze({
  cochannel:        20,
  first_adjacent:    6,
  second_adjacent: -40,
  third_adjacent:  -40,
  if_offset:       -40
});

// §73.211 FM protected-contour field strengths by class.
export const FM_PROTECTED_FIELD_DBU_BY_CLASS = Object.freeze({
  A:    60,
  B:    54,
  B1:   54,
  C0:   54,
  C1:   54,
  C2:   54,
  C3:   54,
  C:    54,
  // LPFM and translators carry their own protection rules but appear
  // in nearby-stations lists; default to 60 dBu so a §73.215 study
  // accidentally including one doesn't misreport.
  LP100:60,
  LP10: 60,
  D:    60,
  FX:   60
});

function protectedFieldDbu(klass){
  if (!klass) return 60;
  const k = String(klass).toUpperCase().replace(/\s+/g, '').replace('CLASS', '');
  return FM_PROTECTED_FIELD_DBU_BY_CLASS[k] ?? 60;
}

function classifyWithGate(delta_khz){
  const c = classifyFmOffsetKhz(delta_khz);
  const gateMap = {
    cochannel:        SECTION_73_215_DU_GATES.cochannel,
    first_adjacent:   SECTION_73_215_DU_GATES.first_adjacent,
    second_adjacent:  SECTION_73_215_DU_GATES.second_adjacent,
    third_adjacent:   SECTION_73_215_DU_GATES.third_adjacent,
    if_offset:        SECTION_73_215_DU_GATES.if_offset,
    non_restricted:   null
  };
  return { ...c, du_db: gateMap[c.rel] };
}

/**
 * Run a §73.215 contour-protection study for a subject FM station
 * against a list of nearby full-service FM stations.
 *
 * @param {object} args
 * @param {object} args.subject     subject (proposed/under-review) FM station:
 *                                  { erp_kw, haat_m, frequency_mhz, lat, lon, fcc_class, call?, facility_id? }
 * @param {Array<object>} args.nearbyStations
 *                                  list of nearby full-service FM stations:
 *                                  { call, facility_id, fcc_class, frequency_mhz, erp_kw, haat_m, lat, lon }
 *                                  Translators / LPFM should be filtered out by the caller; §73.215 only
 *                                  governs full-service ↔ full-service relationships.
 * @returns {{
 *   cite, pass, subject, studies, violations, notes, method, missing_nearby_stations?
 * }}
 */
export function checkSection73215({ subject, nearbyStations = [] } = {}){
  const violations = [];
  const notes      = [];
  const studies    = [];

  if (!subject || typeof subject !== 'object'){
    return {
      cite:        '47 CFR §73.215',
      pass:        false,
      subject:     null,
      studies,
      violations:  [{
        cite:    '47 CFR §73.215(a)',
        message: 'Subject FM station inputs missing — contour-protection study cannot be run.'
      }],
      notes:       ['subject required: { erp_kw, haat_m, frequency_mhz, lat, lon, fcc_class }'],
      method:      'FCC tvfm_curves.js bidirectional F(50,10) ↔ F(50,50) contour-pair study (vendored canonical)'
    };
  }

  const have_subject_geometry =
    Number.isFinite(Number(subject.lat))           && Number.isFinite(Number(subject.lon)) &&
    Number.isFinite(Number(subject.haat_m))        && Number(subject.haat_m) > 0 &&
    Number.isFinite(Number(subject.erp_kw))        && Number(subject.erp_kw) > 0 &&
    Number.isFinite(Number(subject.frequency_mhz)) && Number(subject.frequency_mhz) > 0;

  if (!have_subject_geometry){
    notes.push('subject must provide finite erp_kw, haat_m, frequency_mhz, lat, lon to run §73.215 study.');
  }

  if (!Array.isArray(nearbyStations) || nearbyStations.length === 0){
    notes.push('No nearby full-service FM stations provided.  §73.215 study cannot run; reviewer must verify §73.207 minimum-distance separation independently.');
    return {
      cite:        '47 CFR §73.215',
      pass:        have_subject_geometry,
      subject:     subjectShape(subject),
      studies,
      violations,
      notes,
      method:      'FCC tvfm_curves.js bidirectional F(50,10) ↔ F(50,50) contour-pair study (vendored canonical)',
      missing_nearby_stations: true
    };
  }

  if (!have_subject_geometry){
    return {
      cite:        '47 CFR §73.215',
      pass:        false,
      subject:     subjectShape(subject),
      studies,
      violations,
      notes,
      method:      'FCC tvfm_curves.js bidirectional F(50,10) ↔ F(50,50) contour-pair study (vendored canonical)'
    };
  }

  const subjectFieldDbu = protectedFieldDbu(subject.fcc_class);

  for (const N of nearbyStations){
    const fS = Number(subject.frequency_mhz);
    const fN = Number(N.frequency_mhz);
    const delta_khz = Number.isFinite(fS) && Number.isFinite(fN)
      ? Math.round((fS - fN) * 1000)
      : null;
    const cls = delta_khz != null ? classifyWithGate(delta_khz) : { rel: null, label: null, du_db: null };
    if (cls.rel === 'non_restricted'){
      studies.push({
        nearby_call:    N.call         || null,
        nearby_facility_id: N.facility_id || null,
        nearby_class:   N.fcc_class    || null,
        nearby_frequency_mhz: fN,
        delta_khz,
        relationship:   cls.label,
        skipped:        true,
        skipped_reason: `channel offset ${delta_khz} kHz is not restricted by §73.215.`,
        pair_pass:      true
      });
      continue;
    }

    const N_field_dbu = protectedFieldDbu(N.fcc_class);

    const forward = studyContourPair(subject, N, {
      relationship:        cls.label,
      du_threshold_db:     cls.du_db,
      protected_field_dbu: N_field_dbu
    });
    const reverse = studyContourPair(N, subject, {
      relationship:        cls.label,
      du_threshold_db:     cls.du_db,
      protected_field_dbu: subjectFieldDbu
    });

    const pair_pass_du = (forward.pass !== false) && (reverse.pass !== false);

    // ---- Polygon-overlap check (FCC-canonical) ----
    // Build the F(50,50) PROTECTED contours and the F(50,10)
    // INTERFERING contours for both stations, then test for any
    // intersection.  This is what FCC's actual §73.215 evaluation
    // requires (vs. our single-bearing D/U which is the conservative
    // worst-case).  When the polygons overlap, the station fails
    // §73.215 regardless of the D/U bearing.
    const polygon_overlap = computePolygonOverlap(subject, N, subjectFieldDbu, N_field_dbu);

    // Pair fails if EITHER the D/U bearing check OR the polygon
    // overlap test fails.  Polygon overlap is the regulation-text
    // truth; D/U bearing is a fast pre-filter / explanation aid.
    const pair_pass = pair_pass_du
                   && polygon_overlap.subject_interfering_overlaps_nearby_protected !== true
                   && polygon_overlap.nearby_interfering_overlaps_subject_protected !== true;

    const study = {
      nearby_call:                    N.call         || null,
      nearby_facility_id:             N.facility_id  || null,
      nearby_class:                   N.fcc_class    || null,
      nearby_frequency_mhz:           fN,
      delta_khz,
      relationship:                   cls.label,
      du_threshold_db:                cls.du_db,
      subject_protected_field_dbu:    subjectFieldDbu,
      nearby_protected_field_dbu:     N_field_dbu,
      separation_km:                  forward.separation_km ?? reverse.separation_km ?? null,
      forward,                          // subject → nearby (subject's F(50,10) at nearby's protected edge)
      reverse,                          // nearby  → subject
      polygon_overlap,                  // F(50,50) protected vs F(50,10) interfering pair-wise
      pair_pass_du,
      pair_pass
    };
    studies.push(study);

    if (pair_pass === false){
      const fail_legs = [];
      if (forward.pass === false){
        fail_legs.push(`subject→${N.call || N.facility_id || 'nearby'} D/U ${forward.du_actual_db?.toFixed?.(1)} dB < ${cls.du_db} dB`);
      }
      if (reverse.pass === false){
        fail_legs.push(`${N.call || N.facility_id || 'nearby'}→subject D/U ${reverse.du_actual_db?.toFixed?.(1)} dB < ${cls.du_db} dB`);
      }
      if (polygon_overlap.subject_interfering_overlaps_nearby_protected === true){
        fail_legs.push(`subject F(50,10) interfering polygon overlaps nearby F(50,50) protected polygon by ${polygon_overlap.subject_interfering_overlap_area_km2} km²`);
      }
      if (polygon_overlap.nearby_interfering_overlaps_subject_protected === true){
        fail_legs.push(`nearby F(50,10) interfering polygon overlaps subject F(50,50) protected polygon by ${polygon_overlap.nearby_interfering_overlap_area_km2} km²`);
      }
      violations.push({
        cite:    '47 CFR §73.215(a)',
        message: `Contour-protection failure (${cls.label}): ${fail_legs.join('; ')}.`,
        detail:  study
      });
    }
  }

  return {
    cite:       '47 CFR §73.215',
    pass:       violations.length === 0,
    subject:    subjectShape(subject),
    studies,
    violations,
    notes,
    method:     'FCC tvfm_curves.js bidirectional F(50,10) ↔ F(50,50) contour-pair study (vendored canonical)',
    du_gates:   SECTION_73_215_DU_GATES,
    protected_field_thresholds_dbu: FM_PROTECTED_FIELD_DBU_BY_CLASS
  };
}

function subjectShape(s){
  return {
    call:           s.call || null,
    facility_id:    s.facility_id || null,
    fcc_class:      s.fcc_class || null,
    frequency_mhz:  Number(s.frequency_mhz),
    erp_kw:         Number(s.erp_kw),
    haat_m:         Number(s.haat_m),
    lat:            Number(s.lat),
    lon:            Number(s.lon)
  };
}

// ---------------------------------------------------------------------------
// Polygon-overlap helper for §73.215
// ---------------------------------------------------------------------------

const POLYGON_RADIAL_STEP_DEG = 10;          // 36-vertex contour ring

/**
 * Compute the F(50,50) protected and F(50,10) interfering contour
 * polygons for both stations and return the pair-wise overlap status.
 * The check is bidirectional:
 *   - subject's F(50,10) interfering polygon vs nearby's F(50,50)
 *     protected polygon → did the subject's interference reach inside
 *     the nearby's protected contour?
 *   - nearby's F(50,10) interfering polygon vs subject's F(50,50)
 *     protected polygon → vice versa.
 *
 * Either positive overlap is a §73.215 failure.  When neither contour
 * can be built (missing erp/haat), returns inconclusive=true and the
 * boolean overlap flags are null.
 */
function computePolygonOverlap(subject, nearby, subjectFieldDbu, nearbyFieldDbu){
  // Build the four contour polygons.  When fccDistanceKm throws (rare
  // — happens for extreme out-of-range inputs), the polygon is empty
  // and the corresponding overlap is reported as inconclusive.
  const subject_F50_50 = buildContourFromCurve(subject, subjectFieldDbu, '50,50');
  const subject_F50_10 = buildContourFromCurve(subject, subjectFieldDbu, '50,10');
  const nearby_F50_50  = buildContourFromCurve(nearby,  nearbyFieldDbu,  '50,50');
  const nearby_F50_10  = buildContourFromCurve(nearby,  nearbyFieldDbu,  '50,10');

  if (!subject_F50_50.length || !subject_F50_10.length
   || !nearby_F50_50.length  || !nearby_F50_10.length){
    return {
      method:        'sutherland-hodgman convex clip in local-tangent projection',
      inconclusive:  true,
      reason:        'one or more contour polygons could not be built (check erp_kw / haat_m)',
      subject_interfering_overlaps_nearby_protected: null,
      nearby_interfering_overlaps_subject_protected: null
    };
  }

  // subject's F(50,10) interfering vs nearby's F(50,50) protected.
  const fwd = polygonOverlap(subject_F50_10, nearby_F50_50);
  // nearby's F(50,10) interfering vs subject's F(50,50) protected.
  const rev = polygonOverlap(nearby_F50_10, subject_F50_50);

  return {
    method:                                        'F(50,50) protected vs F(50,10) interfering polygon overlap (Sutherland-Hodgman, local-tangent projection, area via Karney WGS-84)',
    n_radials:                                     360 / POLYGON_RADIAL_STEP_DEG,
    subject_interfering_overlaps_nearby_protected: fwd.overlap,
    subject_interfering_overlap_area_km2:          fwd.overlap_area_km2,
    nearby_interfering_overlaps_subject_protected: rev.overlap,
    nearby_interfering_overlap_area_km2:           rev.overlap_area_km2,
    overlap_polygons: {
      subject_interfering_into_nearby_protected: fwd.overlap_polygon_latlng,
      nearby_interfering_into_subject_protected: rev.overlap_polygon_latlng
    }
  };
}

function buildContourFromCurve(station, field_dbu, mode){
  const erp = Number(station.erp_kw);
  const haat = Number(station.haat_m);
  const freq = Number(station.frequency_mhz);
  if (!Number.isFinite(erp) || !Number.isFinite(haat) || !Number.isFinite(freq)) return [];

  const radials = [];
  for (let az = 0; az < 360; az += POLYGON_RADIAL_STEP_DEG){
    try {
      const r = fccDistanceKm({
        haat_m:        haat,
        target_dBu:    field_dbu,
        erp_kw:        erp,
        mode,
        frequency_mhz: freq
      });
      const d = Number(r.distance_km);
      if (Number.isFinite(d) && d > 0){
        radials.push({ az, distance_km: d });
      }
    } catch { /* skip; distance_km is undefined for this radial */ }
  }
  if (radials.length < 3) return [];
  return buildContourPolygon({
    lat: Number(station.lat), lon: Number(station.lon), radials
  });
}
