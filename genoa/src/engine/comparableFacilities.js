// Comparable-facility benchmarking — given a proposed FM station,
// find the N most similar already-licensed full-service FMs and
// surface how the proposed facility stacks up.
//
// PROBLEM
//   When a broker walks into an H&D engagement asking "is this
//   facility competitive?", the consulting engineer's first move
//   is to pull the 20 most-similar licensed FMs in the same
//   regional market and compare contour distances, ERP, HAAT,
//   tower height, and class membership.  This module does that
//   automatically over the nearby_primaries we already pull from
//   LMS for §73.207 and §73.182 studies.
//
// SIMILARITY MODEL
//   We rank by a weighted-distance score in a small parameter space:
//     - class_match_bonus          0..6 dB equivalent  (same class = full bonus)
//     - |erp_kw - subj_erp| / max  0..1 dimensionless
//     - |haat_m - subj_haat| / max 0..1 dimensionless
//     - geographic distance / 50 km penalty (down-weight far stations)
//     - frequency-band proximity (commercial vs reserved)
//
//   Combined with simple weights — operators can override if they
//   want a "by class only" or "by service contour only" ranking.
//
// PROVENANCE
//   We do NOT generate filed-station data here — comparators are
//   passed in from facilityClient.getNearbyPrimaries (LMS / FMQ).
//   The benchmarker is a pure ranking + diff engine; it never
//   invents a station.
//
// REGULATORY
//   - 47 CFR §73.211 — class definitions (max ERP, max HAAT,
//     reference distances per class)
//   - 47 CFR §73.215 — protected-field thresholds (used here as
//     contour-class context for similarity, not for compliance)

import { FM_PROTECTED_FIELD_DBU_BY_CLASS } from './regulatory/section_73_215.js';
import { karneyInverse } from './geometry/wgs84.js';

// §73.211 reference values per class — used both as similarity
// anchors and as "headroom" indicators (e.g. proposed Class A at
// 2 kW has 4 kW headroom toward §73.211(a)(1) max).  Sourced
// directly from 47 CFR §73.211(a) / §73.211(b).
export const FM_CLASS_REFERENCE = Object.freeze({
  // class: { max_erp_kw, ref_haat_m, max_haat_m, service_contour_dbu }
  A:  { max_erp_kw: 6,    ref_haat_m: 100, max_haat_m: 100, service_contour_dbu: 60 },
  B1: { max_erp_kw: 25,   ref_haat_m: 100, max_haat_m: 100, service_contour_dbu: 57 },
  B:  { max_erp_kw: 50,   ref_haat_m: 150, max_haat_m: 150, service_contour_dbu: 54 },
  C3: { max_erp_kw: 25,   ref_haat_m: 100, max_haat_m: 100, service_contour_dbu: 60 },
  C2: { max_erp_kw: 50,   ref_haat_m: 150, max_haat_m: 150, service_contour_dbu: 60 },
  C1: { max_erp_kw: 100,  ref_haat_m: 299, max_haat_m: 299, service_contour_dbu: 60 },
  C0: { max_erp_kw: 100,  ref_haat_m: 450, max_haat_m: 450, service_contour_dbu: 60 },
  C:  { max_erp_kw: 100,  ref_haat_m: 600, max_haat_m: 600, service_contour_dbu: 60 }
});

const KNOWN_CLASSES = Object.keys(FM_CLASS_REFERENCE);

const DEFAULT_WEIGHTS = Object.freeze({
  class:     0.40,   // largest single contributor — class is the dominant peer-group axis
  erp:       0.20,
  haat:      0.20,
  distance:  0.15,
  band:      0.05    // commercial vs reserved
});

/**
 * Rank a list of comparator stations by similarity to subject.
 *
 * @param {object} input
 * @param {object} input.subject              { lat, lon, fcc_class, erp_kw?, haat_m?, frequency_mhz? }
 * @param {Array}  input.candidates           rows from facilityClient.getNearbyPrimaries
 * @param {object} [input.weights]            override DEFAULT_WEIGHTS per axis (sums need not be 1.0)
 * @param {number} [input.topK=20]            cap on returned rows
 * @param {number} [input.maxDistanceKm=300]  drop candidates beyond this radius
 * @returns {object}
 */
export function rankComparableFacilities(input){
  const { subject, candidates = [],
          weights = DEFAULT_WEIGHTS,
          topK = 20,
          maxDistanceKm = 300 } = input || {};
  if (!subject || typeof subject !== 'object'){
    return { ok: false, error: 'subject required ({ lat, lon, fcc_class })' };
  }
  if (!Number.isFinite(Number(subject.lat)) || !Number.isFinite(Number(subject.lon))){
    return { ok: false, error: 'subject.lat + subject.lon required' };
  }
  if (!subject.fcc_class || !KNOWN_CLASSES.includes(normalizeClass(subject.fcc_class))){
    return { ok: false, error: `subject.fcc_class must be one of ${KNOWN_CLASSES.join(', ')}` };
  }
  if (!Array.isArray(candidates) || candidates.length === 0){
    return {
      ok: true, n_candidates: 0, n_returned: 0,
      subject: subjectShape(subject),
      reference: FM_CLASS_REFERENCE[normalizeClass(subject.fcc_class)] || null,
      results: [],
      regulation: '47 CFR §73.211 (class definitions); §73.215 (contour thresholds)'
    };
  }

  const subjClass = normalizeClass(subject.fcc_class);
  const subjErp   = Number(subject.erp_kw);
  const subjHaat  = Number(subject.haat_m);
  const subjLat   = Number(subject.lat);
  const subjLon   = Number(subject.lon);
  const subjBand  = freqIsReserved(subject.frequency_mhz) ? 'reserved' : 'commercial';

  // Normalize denominators for the per-axis penalty terms.  Use the
  // class's max ERP / max HAAT as the natural scale so a delta of
  // "half the class max" scores the same regardless of class.
  const ref = FM_CLASS_REFERENCE[subjClass];
  const erpScale  = Math.max(ref?.max_erp_kw  || 50,  Number.isFinite(subjErp)  ? subjErp  : 0);
  const haatScale = Math.max(ref?.max_haat_m || 600, Number.isFinite(subjHaat) ? subjHaat : 0);

  const scored = [];
  for (const c of candidates){
    const cLat  = Number(c.lat);
    const cLon  = Number(c.lon);
    const cClass = normalizeClass(c.fcc_class);
    const cErp   = Number(c.erp_kw);
    const cHaat  = Number(c.haat_m);
    const cFreq  = Number(c.frequency_mhz ?? c.frequency);
    if (!Number.isFinite(cLat) || !Number.isFinite(cLon)) continue;

    let distanceKm = null;
    try {
      const inv = karneyInverse(subjLat, subjLon, cLat, cLon);
      distanceKm = Number(inv.distance_km);
    } catch { continue; }
    if (!Number.isFinite(distanceKm) || distanceKm > maxDistanceKm) continue;

    const components = {
      class:    cClass === subjClass ? 1 : (sameClassFamily(subjClass, cClass) ? 0.5 : 0),
      erp:      Number.isFinite(cErp)  && Number.isFinite(subjErp)
                  ? Math.max(0, 1 - Math.abs(cErp - subjErp) / Math.max(1, erpScale))
                  : 0,
      haat:     Number.isFinite(cHaat) && Number.isFinite(subjHaat)
                  ? Math.max(0, 1 - Math.abs(cHaat - subjHaat) / Math.max(1, haatScale))
                  : 0,
      distance: Math.max(0, 1 - distanceKm / 100),
      band:     freqIsReserved(cFreq) === (subjBand === 'reserved') ? 1 : 0
    };
    const score = clamp01(weights.class)    * components.class
                + clamp01(weights.erp)      * components.erp
                + clamp01(weights.haat)     * components.haat
                + clamp01(weights.distance) * components.distance
                + clamp01(weights.band)     * components.band;

    scored.push({
      call:           c.call || null,
      facility_id:    c.facility_id || null,
      fcc_class:      cClass,
      frequency_mhz:  Number.isFinite(cFreq) ? cFreq : null,
      erp_kw:         Number.isFinite(cErp)  ? cErp  : null,
      haat_m:         Number.isFinite(cHaat) ? cHaat : null,
      lat:            cLat,
      lon:            cLon,
      distance_km:    Number(distanceKm.toFixed(2)),
      similarity_score: Number(score.toFixed(4)),
      components,
      // Headroom diagnostics — how much "growth room" the candidate
      // has before bumping the §73.211 ceiling for its class.
      class_headroom: classHeadroom(cClass, cErp, cHaat),
      service_contour_dbu: FM_PROTECTED_FIELD_DBU_BY_CLASS[cClass] ?? null
    });
  }

  scored.sort((a, b) => b.similarity_score - a.similarity_score);
  const top = scored.slice(0, Math.max(1, topK));

  // Aggregate stats useful for the UI panel headline.
  const finite = (k) => top.map((r) => r[k]).filter((x) => Number.isFinite(x));
  const sameClass = top.filter((r) => r.fcc_class === subjClass).length;
  const stats = {
    n_total:      candidates.length,
    n_in_radius:  scored.length,
    n_returned:   top.length,
    n_same_class: sameClass,
    median_erp_kw:  median(finite('erp_kw')),
    median_haat_m:  median(finite('haat_m')),
    mean_distance_km: mean(finite('distance_km'))
  };

  return {
    ok:        true,
    subject:   subjectShape(subject),
    reference: FM_CLASS_REFERENCE[subjClass] || null,
    weights,
    stats,
    results:   top,
    regulation: '47 CFR §73.211 (class definitions); §73.215 (contour thresholds)'
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function normalizeClass(klass){
  if (!klass) return null;
  const k = String(klass).toUpperCase().replace(/\s+/g, '');
  if (KNOWN_CLASSES.includes(k)) return k;
  // FCC sometimes serializes "B-1" / "C-3" with hyphens.
  if (k === 'B-1' || k === 'B_1') return 'B1';
  if (k === 'C-3' || k === 'C_3') return 'C3';
  if (k === 'C-2' || k === 'C_2') return 'C2';
  if (k === 'C-1' || k === 'C_1') return 'C1';
  if (k === 'C-0' || k === 'C_0') return 'C0';
  return null;
}

// "Same family" = same letter, different sub-tier.  A pure A is in
// its own family; B/B1 share; the C tier (C, C0, C1, C2, C3) shares.
function sameClassFamily(a, b){
  if (!a || !b) return false;
  const fa = a[0];
  const fb = b[0];
  return fa === fb;
}

function freqIsReserved(freq_mhz){
  const f = Number(freq_mhz);
  if (!Number.isFinite(f)) return false;
  return f >= 87.9 && f <= 91.9;
}

function classHeadroom(klass, erp_kw, haat_m){
  const ref = FM_CLASS_REFERENCE[klass];
  if (!ref) return null;
  return {
    erp_kw_remaining:  Number.isFinite(erp_kw)
                         ? Number((ref.max_erp_kw - erp_kw).toFixed(2))
                         : null,
    haat_m_remaining:  Number.isFinite(haat_m)
                         ? Number((ref.max_haat_m - haat_m).toFixed(1))
                         : null,
    at_class_ceiling:  Number.isFinite(erp_kw)
                         && Number.isFinite(haat_m)
                         && (erp_kw >= ref.max_erp_kw - 0.1
                             || haat_m >= ref.max_haat_m - 1)
  };
}

function subjectShape(s){
  return {
    lat:           Number(s.lat),
    lon:           Number(s.lon),
    fcc_class:     normalizeClass(s.fcc_class),
    erp_kw:        Number.isFinite(Number(s.erp_kw)) ? Number(s.erp_kw) : null,
    haat_m:        Number.isFinite(Number(s.haat_m)) ? Number(s.haat_m) : null,
    frequency_mhz: Number.isFinite(Number(s.frequency_mhz)) ? Number(s.frequency_mhz) : null
  };
}

function clamp01(x){
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function median(xs){
  if (!Array.isArray(xs) || xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(xs){
  if (!Array.isArray(xs) || xs.length === 0) return null;
  return Number((xs.reduce((a, x) => a + x, 0) / xs.length).toFixed(2));
}

export const COMPARABLE_FACILITIES_PROVENANCE = Object.freeze({
  module:       'src/engine/comparableFacilities.js',
  regulation:   '47 CFR §73.211 (class definitions); §73.215 (contour thresholds)',
  modeled: [
    'Weighted similarity over class match, ERP, HAAT, distance, band parity',
    '§73.211 class-ceiling headroom (ERP/HAAT remaining before class limit)',
    'Same-family class matching (B/B1; C/C0/C1/C2/C3)'
  ],
  not_modeled: [
    'LPFM / FX translator comparators',
    'Population-served / market reach (separate exhibit-evidence)',
    'Antenna pattern similarity (Genoa pulls patterns separately for the parent)',
    'Tower-coordination / co-location proximity'
  ],
  license_basis: '17 USC §105 (FCC class definitions, US Government public domain)'
});
