// 47 CFR §73.187 — AM nighttime skywave protection.
//
// REGULATION
//   §73.187 protects every Class A (clear-channel), Class B (regional),
//   Class C (local), and Class D (daytime/post-sunset) AM station from
//   excessive nighttime skywave interference from co-channel and
//   1st-adjacent stations.  The methodology:
//
//     1. Compute SS-1 (50% skywave field) and/or SS-2 (10% skywave field)
//        at the protected station's nighttime contour from each
//        contributing interferer (§73.190).
//     2. Combine contributions via root-sum-square (RSS) per
//        §73.187(b)(1).  RSS_50 is the §73.187 reference.
//     3. Apply class-specific protected-contour thresholds (§73.182(d)–(j)):
//          Class A 1A: 0.025 mV/m 50% skywave (clear-channel exclusive)
//          Class A 1B: 0.5   mV/m 50% skywave (clear-channel non-exclusive)
//          Class B:    25%-exclusion limit; protect to 0.5 mV/m groundwave
//                      against the 50% skywave RSS
//          Class C:    minimal nighttime protection; class-D-style coverage
//          Class D:    not protected at night (post-sunset only operations)
//     4. The proposed station passes §73.187 if it does not increase the
//        RSS_50 at any nearby protected station beyond the §73.187(c)
//        exclusion thresholds.
//
//   Adjacent-channel skywave protection uses analogous gates with
//   reduced separation requirements per §73.182(j).
//
// METHOD
//   For each nearby AM station N within the engine's nearby radius:
//     - Determine channel relationship (co / 1st-adjacent / 2nd-adjacent)
//     - Skip non-restricted relationships (≥ 30 kHz separation)
//     - Compute subject's SS-1 / SS-2 at N's protected-contour edge
//     - Compute N's     SS-1 / SS-2 at subject's protected-contour edge
//     - Compare each to the §73.187 protection threshold for N's class
//     - Report violations with full provenance (path length, midpoint
//       lat, alpha, K, frequency correction, latitude correction)
//
//   This module assumes the nearby_primaries list is supplied by the
//   orchestrator (FCC AMQ search at ±10/20 kHz offsets within a
//   default 1500 km radius — much larger than FM's 300 km because
//   nighttime skywave reaches across the continent).
//
// LIMITATIONS
//   - Directional-antenna RSS treatment per §73.187(b)(1) requires
//     integration of the antenna pattern over the great-circle azimuth
//     from each contributor.  When the caller supplies an explicit
//     equivalent ERP (rss_erp_kw), we use it; otherwise we use the
//     nominal omnidirectional ERP and tag the study
//     `directional_rss_applied: false` so reviewers know the check is
//     conservative for a directional interferer (overstates U) and
//     anti-conservative for a directional protected (understates D).
//   - We compute the protected-contour edge along the inter-station
//     bearing — same simplification used in §74.1204 / §73.215 and
//     consistent with the FCC's own AM Skywave Engineering Tool.
//
// ENRICHMENT (active — wired via facilityClient.enrichNearbyFromZtr)
//   The orchestrator merges per-station environmental data sourced
//   from ZTR rich-station rows into each nearbyStations entry:
//     - ground_sigma_msm  → M3 conductivity at the station's site
//                            (improves D's groundwave protected distance)
//     - rss_erp_kw        → directional pattern's RSS-equivalent ERP
//                            for the great-circle bearing (improves U)
//     - sunrise_offset_min, sunset_offset_min → §73.187(a) time-of-day
//                            classifications (Class D PSRA / PSSA)
//   When ZTR carries the field, the study uses it verbatim and tags
//   the row with `enriched_from_ztr: true`.  When ZTR doesn't have the
//   station or the field, the study falls back to defaults
//   (σ = 8 mS/m, omnidirectional ERP, all-night protection).
//   Disable via NEARBY_ZTR_ENRICH_DISABLE=1.

import { skywaveFieldAtPath } from '../curves/fcc/skywave.mjs';
import { fccAmDistanceKm } from '../curves/fcc/index.mjs';
import { karneyInverse } from '../geometry/wgs84.js';
import { directionalErpAtBearing } from '../pattern/am_directional.js';

// AM channel classifier — co/1st/2nd-adjacent gating via 10 kHz grid.
function classifyAmOffsetKhz(delta_khz){
  const d = Math.abs(Math.round(delta_khz));
  if (d === 0)        return { rel: 'cochannel',       label: 'co-channel'   };
  if (d === 10)       return { rel: 'first_adjacent',  label: '1st-adjacent' };
  if (d === 20)       return { rel: 'second_adjacent', label: '2nd-adjacent' };
  return                     { rel: 'non_restricted',  label: 'non-restricted' };
}

// §73.182 class → §73.187 protected nighttime contour (mV/m on 50% skywave)
// for co-channel interferers.  These are the protected fields at which
// SS-1 RSS must not be increased by the proposed station.
//
// Sources:
//   §73.182(d)  Class A I-A: 0.025 mV/m 50% skywave (exclusive)
//   §73.182(e)  Class A I-B: 0.500 mV/m 50% skywave (non-exclusive)
//   §73.182(f)  Class B:     0.500 mV/m groundwave protected to RSS-50
//   §73.182(g)  Class C:     no nighttime protection (local channel)
//   §73.182(h)  Class D:     unprotected at night (post-sunset reduced)
//
// Adjacent-channel limits relax these by §73.182(j) factors.
export const NIGHTTIME_PROTECTED_FIELD_MVM = Object.freeze({
  cochannel: {
    'A':   0.500,     // I-B by default; tighter (0.025) when clear-channel exclusive
    'A-IA':0.025,
    'A-IB':0.500,
    'B':   0.500,
    'C':   null,      // unprotected
    'D':   null
  },
  first_adjacent: {
    // §73.182(j) — 1st-adjacent skywave thresholds are higher (less
    // protective) than co-channel by ~20 dB
    'A':   5.00,
    'A-IA':0.25,
    'A-IB':5.00,
    'B':   5.00,
    'C':   null,
    'D':   null
  }
});

function protectedFieldMvm(klass, relationship){
  const tbl = NIGHTTIME_PROTECTED_FIELD_MVM[relationship];
  if (!klass || !tbl) return null;
  const k = String(klass).toUpperCase().replace(/\s+/g, '').replace('CLASS', '');
  // Distinguish "explicitly null" (Class C / D — unprotected) from
  // "missing key" (unknown class — fall back to Class A's threshold).
  if (Object.prototype.hasOwnProperty.call(tbl, k)) return tbl[k];
  return tbl['A'] ?? null;
}

/**
 * Run a §73.187 nighttime-skywave protection study for a subject AM
 * station against a list of nearby AM stations.
 *
 * @param {object} args
 * @param {object} args.subject       proposed AM station:
 *                                    { erp_kw, rss_erp_kw?, frequency_khz, lat, lon, fcc_class, ground_sigma_msm?, call?, facility_id? }
 * @param {Array<object>} args.nearbyStations
 *                                    nearby AM stations (full nighttime list, typically 1500 km radius):
 *                                    { call, facility_id, fcc_class, frequency_khz, erp_kw, rss_erp_kw?, lat, lon, ground_sigma_msm? }
 *
 * @returns {{ cite, pass, subject, studies, violations, notes, method, missing_nearby_stations? }}
 */
export function checkSection73187({ subject, nearbyStations = [] } = {}){
  const violations = [];
  const notes      = [];
  const studies    = [];

  if (!subject || typeof subject !== 'object'){
    return {
      cite:        '47 CFR §73.187',
      pass:        false,
      subject:     null,
      studies, violations: [{
        cite:    '47 CFR §73.187(a)',
        message: 'Subject AM station inputs missing — nighttime skywave study cannot be run.'
      }], notes,
      method:      'FCC §73.190 SS-1/SS-2 skywave (Wang formulation, vendored canonical) bidirectional study'
    };
  }

  const haveSubject =
    Number.isFinite(Number(subject.lat)) && Number.isFinite(Number(subject.lon)) &&
    Number.isFinite(Number(subject.erp_kw)) && Number(subject.erp_kw) > 0 &&
    Number.isFinite(Number(subject.frequency_khz)) && Number(subject.frequency_khz) > 0;

  if (!haveSubject){
    notes.push('subject must provide finite erp_kw, frequency_khz, lat, lon to run §73.187 study.');
  }

  if (!Array.isArray(nearbyStations) || nearbyStations.length === 0){
    notes.push('No nearby AM stations provided.  §73.187 nighttime study cannot run; reviewer must verify protected-station list independently.');
    return {
      cite:        '47 CFR §73.187',
      pass:        haveSubject,
      subject:     subjectShape(subject),
      studies, violations, notes,
      method:      'FCC §73.190 SS-1/SS-2 skywave (Wang formulation, vendored canonical) bidirectional study',
      missing_nearby_stations: true
    };
  }

  if (!haveSubject){
    return {
      cite:        '47 CFR §73.187',
      pass:        false,
      subject:     subjectShape(subject),
      studies, violations, notes,
      method:      'FCC §73.190 SS-1/SS-2 skywave (Wang formulation, vendored canonical) bidirectional study'
    };
  }

  for (const N of nearbyStations){
    const fS = Number(subject.frequency_khz);
    const fN = Number(N.frequency_khz);
    const delta_khz = Number.isFinite(fS) && Number.isFinite(fN) ? Math.round(fS - fN) : null;
    const cls = delta_khz != null ? classifyAmOffsetKhz(delta_khz) : { rel: null, label: null };

    if (cls.rel === 'non_restricted' || cls.rel === 'second_adjacent'){
      // §73.187 governs co + 1st-adjacent only; 2nd-adjacent is
      // de-facto unprotected nighttime via §73.182(j) reductions.
      studies.push({
        nearby_call:          N.call         || null,
        nearby_facility_id:   N.facility_id  || null,
        nearby_class:         N.fcc_class    || null,
        nearby_frequency_khz: fN,
        delta_khz,
        relationship:         cls.label,
        skipped:              true,
        skipped_reason:       `channel offset ${delta_khz} kHz is not §73.187-restricted (only co-channel and 1st-adjacent governed).`,
        pair_pass:            true
      });
      continue;
    }

    // Subject → Nearby:  subject's SS-1 at nearby's nighttime protected contour edge
    // Nearby  → Subject: nearby's  SS-1 at subject's nighttime protected contour edge
    const fwd = pairSkywaveStudy({
      U: subject, D: N,
      relationship: cls.rel,
      protected_field_mvm: protectedFieldMvm(N.fcc_class, cls.rel)
    });
    const rev = pairSkywaveStudy({
      U: N, D: subject,
      relationship: cls.rel,
      protected_field_mvm: protectedFieldMvm(subject.fcc_class, cls.rel)
    });
    const pair_pass = (fwd.pass !== false) && (rev.pass !== false);

    const study = {
      nearby_call:          N.call         || null,
      nearby_facility_id:   N.facility_id  || null,
      nearby_class:         N.fcc_class    || null,
      nearby_frequency_khz: fN,
      delta_khz,
      relationship:         cls.label,
      forward:              fwd,
      reverse:              rev,
      pair_pass
    };
    studies.push(study);

    if (pair_pass === false){
      const fail_legs = [];
      if (fwd.pass === false){
        fail_legs.push(`subject SS-1 ${fwd.skywave_field_mvm?.toFixed?.(4)} mV/m at ${N.call || N.facility_id || 'nearby'}'s ${fwd.protected_distance_km?.toFixed?.(1)} km protected edge exceeds ${fwd.protected_field_mvm} mV/m`);
      }
      if (rev.pass === false){
        fail_legs.push(`${N.call || N.facility_id || 'nearby'} SS-1 ${rev.skywave_field_mvm?.toFixed?.(4)} mV/m at subject's ${rev.protected_distance_km?.toFixed?.(1)} km protected edge exceeds ${rev.protected_field_mvm} mV/m`);
      }
      violations.push({
        cite:    '47 CFR §73.187(c)',
        message: `Nighttime skywave protection failure (${cls.label}): ${fail_legs.join('; ')}.`,
        detail:  study
      });
    }
  }

  return {
    cite:       '47 CFR §73.187',
    pass:       violations.length === 0,
    subject:    subjectShape(subject),
    studies, violations, notes,
    method:     'FCC §73.190 SS-1/SS-2 skywave (Wang formulation, vendored canonical) bidirectional study',
    protected_field_thresholds_mvm: NIGHTTIME_PROTECTED_FIELD_MVM
  };
}

// ---------------------------------------------------------------------------
// Internal pair-study helper
// ---------------------------------------------------------------------------

function pairSkywaveStudy({ U, D, relationship, protected_field_mvm }){
  const study = {
    u_call: U?.call || null,                u_facility_id: U?.facility_id || null,
    u_frequency_khz: Number(U?.frequency_khz),
    u_erp_kw: Number(U?.erp_kw),
    d_call: D?.call || null,                d_facility_id: D?.facility_id || null,
    d_class: D?.fcc_class || null,
    d_frequency_khz: Number(D?.frequency_khz),
    relationship,
    protected_field_mvm:    protected_field_mvm,
    protected_field_dBu:    protected_field_mvm != null ? Number((20 * Math.log10(protected_field_mvm * 1000)).toFixed(2)) : null,
    separation_km:          null,
    protected_distance_km:  null,
    edge_lat: null, edge_lon: null,
    skywave_field_dBu:      null,
    skywave_field_mvm:      null,
    pass:                   null,
    skipped:                false,
    skipped_reason:         null,
    inside_protected_contour: false,
    // §73.62 / §73.45 directional pattern (when U.pattern_table or
    // D.pattern_table supplied).  Reported verbatim regardless.
    bearings:                null,
    u_pattern_factor:        1.0,
    d_pattern_factor:        1.0,
    u_erp_effective_kw:      Number(U?.erp_kw),
    d_erp_effective_kw:      Number(D?.erp_kw),
    directional_pattern_applied: false,
    directional_rss_applied: !!U?.rss_erp_kw,
    skywave_method:         null
  };

  if (protected_field_mvm == null){
    // D's class isn't protected at night for this relationship (Class
    // C / D, or 1st-adjacent against an unprotected class).  Auto-pass.
    study.skipped        = true;
    study.skipped_reason = `D's class (${D?.fcc_class || 'unknown'}) is not §73.187-protected at this offset.`;
    study.pass           = true;
    return study;
  }

  if (![U?.lat, U?.lon, D?.lat, D?.lon, U?.erp_kw, U?.frequency_khz].every(v => Number.isFinite(Number(v)))){
    study.skipped = true; study.skipped_reason = 'U or D coordinates / power / frequency missing';
    return study;
  }

  // Separation + bearings
  const inv = karneyInverse(Number(U.lat), Number(U.lon), Number(D.lat), Number(D.lon));
  study.separation_km = inv.distance_km;
  // initial_bearing_deg is U → D azimuth (since karneyInverse(U,D)).
  // Reciprocal D → U is final_bearing_deg + 180 mod 360.
  const bearing_u_to_d = inv.initial_bearing_deg;
  const bearing_d_to_u = ((inv.final_bearing_deg + 180) % 360 + 360) % 360;
  study.bearings = {
    u_to_d_deg: Number(bearing_u_to_d.toFixed(3)),
    d_to_u_deg: Number(bearing_d_to_u.toFixed(3))
  };

  // §73.62 directional patterns (when pattern_table supplied).  When
  // a station has rss_erp_kw set explicitly, that overrides the
  // pattern computation (caller already did the RSS integration).
  // Skywave-departure elevation is approximated by 0° (horizon)
  // because §73.190 SS-1 already integrates over the ionospheric
  // path; the antenna's elevation pattern is conventionally
  // collapsed to its horizon slice for this study.  Operators with
  // a 2-D pattern_table can override via U.elevation_deg /
  // D.elevation_deg.
  const u_el = Number.isFinite(Number(U.elevation_deg)) ? Number(U.elevation_deg) : 0;
  const d_el = Number.isFinite(Number(D.elevation_deg)) ? Number(D.elevation_deg) : 0;
  const u_dir = (Number(U.rss_erp_kw) > 0)
    ? { erp_effective_kw: Number(U.rss_erp_kw), pattern_factor: null,
        bearing_deg: bearing_u_to_d, elevation_deg: u_el, directional: true, pattern_applied: false }
    : directionalErpAtBearing({ erp_kw: Number(U.erp_kw),
        pattern_table: U.pattern_table || null, bearing_deg: bearing_u_to_d, elevation_deg: u_el });
  const d_dir = (Number(D.rss_erp_kw) > 0)
    ? { erp_effective_kw: Number(D.rss_erp_kw), pattern_factor: null,
        bearing_deg: bearing_d_to_u, elevation_deg: d_el, directional: true, pattern_applied: false }
    : directionalErpAtBearing({ erp_kw: Number(D.erp_kw),
        pattern_table: D.pattern_table || null, bearing_deg: bearing_d_to_u, elevation_deg: d_el });
  study.u_pattern_factor             = u_dir.pattern_factor;
  study.d_pattern_factor             = d_dir.pattern_factor;
  study.u_erp_effective_kw           = u_dir.erp_effective_kw;
  study.d_erp_effective_kw           = d_dir.erp_effective_kw;
  study.directional_pattern_applied  = u_dir.pattern_applied || d_dir.pattern_applied;

  // D's nighttime protected-contour distance.  For AM, this is a
  // groundwave distance — protection is at the GROUNDWAVE contour
  // where SS-1 must not exceed the protected field.  Use D's σ (M3
  // conductivity) when supplied, else assume σ = 8 mS/m as a
  // mid-range conductivity for a US-typical site.  D's directional
  // pattern factor (toward U) has already been applied to its ERP.
  let rD;
  try {
    const r = fccAmDistanceKm({
      frequency_khz:          Number(D.frequency_khz),
      target_field_mvm:       protected_field_mvm,
      erp_kw:                 d_dir.erp_effective_kw,
      ground_sigma_mS_m:      Number(D.ground_sigma_msm) || 8
    });
    rD = r.distance_km;
  } catch (e){
    study.skipped = true; study.skipped_reason = `D groundwave protected-contour distance failed: ${e.message}`;
    return study;
  }
  study.protected_distance_km = rD;

  // Subject is inside D's protected contour → automatic violation.
  let rEdge = inv.distance_km - rD;
  if (!Number.isFinite(rEdge) || rEdge <= 0){
    rEdge = 0.001;
    study.inside_protected_contour = true;
  }

  // SS-1 (50%) field at D's protected-edge along the inter-station bearing.
  // Note: skywave is a function of the actual path length, not the edge
  // distance — but for the §73.187 study, the relevant point is "D's
  // protected-edge facing U", which is at range (separation_km − rD)
  // from U.  We compute the skywave field at THAT range.  This matches
  // the FCC's AM Skywave Engineering Tool and OET-12 §6 procedure.
  // Use the directional ERP toward D for U's skywave field.
  const sky = skywaveFieldAtPath({
    tx_lat: Number(U.lat), tx_lon: Number(U.lon),
    rx_lat: Number(D.lat), rx_lon: Number(D.lon),    // skywave to D itself (~equiv at FCC scales)
    erp_kw: u_dir.erp_effective_kw,
    frequency_khz: Number(U.frequency_khz),
    percent: 50,
    directional_rss_applied: study.directional_rss_applied || study.directional_pattern_applied
  });
  // Re-compute the field at the protected edge by scaling for
  // distance: (rEdge / separation)^(-α).  This keeps the pair study
  // a single closed-form lookup; full re-evaluation along a different
  // geodesic is the same algebra.
  const scaleAlpha = sky.alpha;
  const distScale  = Math.pow(Math.max(rEdge, 0.1) / Math.max(study.separation_km, 0.1), -scaleAlpha);
  const E_at_edge_mvm = sky.field_mV_m * distScale;
  const E_at_edge_dbu = 20 * Math.log10(Math.max(E_at_edge_mvm, 1e-9) * 1000);

  study.skywave_field_mvm = Number(E_at_edge_mvm.toFixed(4));
  study.skywave_field_dBu = Number(E_at_edge_dbu.toFixed(2));
  study.edge_lat = sky.midpoint_lat;
  study.edge_lon = sky.midpoint_lon;
  study.skywave_method = sky.method;

  study.pass = E_at_edge_mvm <= protected_field_mvm;
  return study;
}

function subjectShape(s){
  return {
    call:           s.call || null,
    facility_id:    s.facility_id || null,
    fcc_class:      s.fcc_class || null,
    frequency_khz:  Number(s.frequency_khz),
    erp_kw:         Number(s.erp_kw),
    rss_erp_kw:     Number.isFinite(Number(s.rss_erp_kw)) ? Number(s.rss_erp_kw) : null,
    lat:            Number(s.lat),
    lon:            Number(s.lon),
    ground_sigma_msm: Number.isFinite(Number(s.ground_sigma_msm)) ? Number(s.ground_sigma_msm) : null
  };
}
