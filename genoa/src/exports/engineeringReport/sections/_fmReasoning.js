// FM-service reasoning helper — turns the consolidated
// exhibit.interference_study into per-pair "binding constraint"
// narratives the spacing-analysis / contour-protection sections can
// quote verbatim.
//
// WHY
//   Legacy tools (V-Soft, RF Investigator, COMSEARCH) ship engineering
//   reports that DO NOT just dump numbers — they tell the reviewer,
//   for every nearby station, WHICH §73.207 / §73.215 / §74.1204
//   constraint is the binding one, HOW MUCH margin (or shortfall)
//   exists, and WHICH alternate rule could rescue the pair if the
//   primary test fails.  Genoa needs the same narrative quality to be
//   competitive.  This helper is pure (no I/O) and operates only on
//   the already-built interference_study so it can be unit-tested
//   without spinning up the full engine.
//
// OUTPUT (per station)
//   {
//     station:                   { call, facility_id, fcc_class, freq_mhz, distance_km },
//     rule:                      '§73.207(b)' | '§73.215' | '§74.1204(a)' | '§74.1204(f)',
//     gap_or_margin_db:          number|null,   // for D/U rules; +ve = margin, -ve = shortfall
//     gap_or_margin_km:          number|null,   // for spacing; +ve = margin, -ve = short
//     binding_constraint:        string,        // human description of WHICH thing binds
//     alternate_route_available: boolean|null,  // true if another rule passes for this pair
//     narrative:                 string         // 1–2 sentence engineering paragraph
//   }
//
// INPUT
//   interference_study  — see engine/regulatory/interferenceStudy.js
//
// NOTES
//   - §74.1204(f) cite is emitted when the relationship is third-
//     adjacent; otherwise §74.1204(a) is the cite for translator
//     pairs.  See TRANSLATOR_DU_GATE_CITES in regulatory/translator.js.
//   - "alternate_route_available" tracks the FCC convention that a
//     station passing under any one applicable rule qualifies overall
//     (e.g., §73.215 contour protection rescues a §73.207 short-
//     spacing).  Helper looks across all rules ON THIS PAIR.

const RULE_CITES = Object.freeze({
  section_73_207:  '§73.207(b)',
  section_73_215:  '§73.215',
  section_74_1204: '§74.1204(a)',
  // section_73_187 is the in-engine namespace for AM nighttime skywave
  // protection, but the actual statutory basis is §73.182(k) (NIF / RSS)
  // and §73.190 (SS-1/SS-2 charts).  Current 47 CFR §73.187 governs
  // "Limitation on daytime radiation" (a different rule).  See
  // engine/regulatory/citations.js for the full cite catalog.
  section_73_187:  '§73.182(k) / §73.190'
});

/**
 * Build per-pair reasoning entries.
 *
 * @param {object} interference_study  exhibit.interference_study
 * @returns {{ pairs: Array<object>, n_pairs: number, n_blocking: number }}
 */
export function buildFmReasoning(interference_study){
  const out = { pairs: [], n_pairs: 0, n_blocking: 0 };
  if (!interference_study || !Array.isArray(interference_study.stations)){
    return out;
  }
  for (const st of interference_study.stations){
    const entry = reasonOneStation(st);
    out.pairs.push(entry);
  }
  out.n_pairs    = out.pairs.length;
  out.n_blocking = out.pairs.filter(p => p.pass === false && !p.alternate_route_available).length;
  return out;
}

function reasonOneStation(st){
  const station = {
    call:         st.call         || st.facility_id || '—',
    facility_id:  st.facility_id  || null,
    fcc_class:    st.fcc_class    || '—',
    freq_mhz:     Number.isFinite(st.frequency_mhz) ? Number(st.frequency_mhz) : null,
    distance_km:  Number.isFinite(st.distance_km)   ? Number(st.distance_km)   : null,
    relationship: st.channel_relationship || null
  };
  const rules = st.rules || {};

  // Identify the binding rule: the worst failing rule, or — if no rule
  // fails — the rule whose margin is closest to zero (the "tightest").
  // Each entry below normalizes to { cite, pass, margin_db, margin_km, summary }.
  const evaluated = [];
  if (rules.section_73_207 && rules.section_73_207.pass !== null && !rules.section_73_207.skipped){
    evaluated.push(evalSec207(rules.section_73_207));
  }
  if (rules.section_73_215 && rules.section_73_215.pass !== null){
    evaluated.push(evalSec215(rules.section_73_215));
  }
  if (rules.section_74_1204 && rules.section_74_1204.pass !== null && !rules.section_74_1204.skipped){
    evaluated.push(evalSec1204(rules.section_74_1204, station.relationship));
  }
  if (rules.section_73_187 && rules.section_73_187.pass !== null && !rules.section_73_187.skipped){
    evaluated.push(evalSec187(rules.section_73_187));
  }

  if (evaluated.length === 0){
    return {
      station,
      rule:                       null,
      gap_or_margin_db:           null,
      gap_or_margin_km:           null,
      binding_constraint:         'no restricted relationship — §73.207 / §73.215 / §74.1204 do not govern this pair',
      alternate_route_available:  null,
      pass:                       null,
      narrative: `${station.call} at ${formatKm(station.distance_km)} km is not in a restricted channel relationship with the subject; no §73.207 / §73.215 / §74.1204 protection test applies.`
    };
  }

  // Pick the binding rule:
  //   1) Any failing rule beats any passing rule (most engineering
  //      reviewers want to see the WORST thing first).
  //   2) Among failing rules, pick the most-negative margin.
  //   3) Among passing rules, pick the smallest positive margin.
  const failing = evaluated.filter(e => e.pass === false);
  const passing = evaluated.filter(e => e.pass === true);
  const binding = failing.length > 0
    ? failing.reduce((a, b) => (worstMargin(a) <= worstMargin(b) ? a : b))
    : passing.reduce((a, b) => (worstMargin(a) <= worstMargin(b) ? a : b));

  const alt = failing.length > 0 && passing.length > 0;

  return {
    station,
    rule:                       binding.cite,
    gap_or_margin_db:           Number.isFinite(binding.margin_db) ? binding.margin_db : null,
    gap_or_margin_km:           Number.isFinite(binding.margin_km) ? binding.margin_km : null,
    binding_constraint:         binding.summary,
    alternate_route_available:  alt,
    pass:                       binding.pass,
    narrative:                  composeNarrative(station, binding, alt, passing, failing)
  };
}

// ── Per-rule evaluators ─────────────────────────────────────────────────────

function evalSec207(r){
  const margin_km = Number.isFinite(r.margin_km) ? r.margin_km : null;
  const summary   = r.pass
    ? `§73.207(b) minimum-distance separation satisfied with ${formatKm(margin_km)} km margin`
    : `§73.207(b) requires ${formatKm(r.required_separation_km)} km but actual separation is ${formatKm(r.actual_separation_km)} km (short by ${formatKm(margin_km != null ? Math.abs(margin_km) : null)} km)`;
  return { cite: RULE_CITES.section_73_207, pass: r.pass, margin_db: null, margin_km, summary, detail: r };
}

function evalSec215(r){
  // §73.215 effective margin: smaller of forward / reverse D/U margin.
  // polygon overlap also matters but expressed via the boolean.
  const fwd = Number.isFinite(r.du_actual_db_forward)  ? r.du_actual_db_forward  - r.du_required_db : null;
  const rev = Number.isFinite(r.du_actual_db_reverse) ? r.du_actual_db_reverse - r.du_required_db : null;
  const margin_db = (fwd != null && rev != null) ? Math.min(fwd, rev)
                  : (fwd != null) ? fwd
                  : (rev != null) ? rev
                  : null;
  const polyTxt = r.polygon_pass === false
    ? '; interfering-contour polygon overlaps the protected contour'
    : '';
  const summary = r.pass
    ? `§73.215 contour protection satisfied (D/U margin ${formatDb(margin_db)} dB)`
    : `§73.215 contour protection fails — D/U required ${r.du_required_db} dB but actual is ${formatDb(margin_db != null ? r.du_required_db + margin_db : null)} dB${polyTxt}`;
  return { cite: RULE_CITES.section_73_215, pass: r.pass, margin_db, margin_km: null, summary, detail: r };
}

function evalSec1204(r, relationship){
  // §74.1204(f) is the third-adjacent cite; everything else is (a).
  const isThirdAdj = relationship && /3rd|third/i.test(String(relationship));
  const cite = isThirdAdj ? '§74.1204(f)' : RULE_CITES.section_74_1204;
  const margin_db = (Number.isFinite(r.du_actual_db) && Number.isFinite(r.du_required_db))
    ? r.du_actual_db - r.du_required_db
    : null;
  const summary = r.pass
    ? `${cite} D/U gate satisfied (margin ${formatDb(margin_db)} dB)`
    : `${cite} D/U gate fails — actual ${formatDb(r.du_actual_db)} dB vs required ${formatDb(r.du_required_db)} dB (short by ${formatDb(margin_db != null ? Math.abs(margin_db) : null)} dB)`;
  return { cite, pass: r.pass, margin_db, margin_km: null, summary, detail: r };
}

function evalSec187(r){
  // AM skywave — express in mV/m forward only for the binding test.
  const margin = (Number.isFinite(r.forward_protected_mvm) && Number.isFinite(r.forward_skywave_mvm))
    ? r.forward_protected_mvm - r.forward_skywave_mvm
    : null;
  const summary = r.pass
    ? `${RULE_CITES.section_73_187} skywave protection satisfied (margin ${formatMvm(margin)} mV/m)`
    : `${RULE_CITES.section_73_187} skywave protection fails — skywave field ${formatMvm(r.forward_skywave_mvm)} mV/m exceeds protected ${formatMvm(r.forward_protected_mvm)} mV/m`;
  return { cite: RULE_CITES.section_73_187, pass: r.pass, margin_db: null, margin_km: null, summary, detail: r };
}

// ── Narrative composer ──────────────────────────────────────────────────────

function composeNarrative(station, binding, alt, passing /*, failing */){
  const lead = `${station.call}${station.fcc_class && station.fcc_class !== '—' ? ' (Class ' + station.fcc_class + ')' : ''} at ${formatKm(station.distance_km)} km on ${formatMhz(station.freq_mhz)} MHz (${station.relationship || 'unknown relationship'}):`;
  let body = ' ' + binding.summary + '.';
  if (binding.pass === false && alt){
    const alts = passing.map(p => p.cite).join(' + ');
    body += ` Pair qualifies under the alternate route(s): ${alts}.`;
  } else if (binding.pass === false && !alt){
    body += ' No alternate qualifying rule available for this pair — filing is blocked unless the facility is modified.';
  }
  return lead + body;
}

// ── Formatters ──────────────────────────────────────────────────────────────

function worstMargin(e){
  // Negative = bigger problem.  Combine dB and km into a single sortable
  // scalar: dB gets used when present; otherwise km.  Failing rules
  // already have negative margins, so this gives "most-negative wins".
  if (e.pass === false){
    if (Number.isFinite(e.margin_db)) return e.margin_db;
    if (Number.isFinite(e.margin_km)) return e.margin_km;
    return -Infinity;
  }
  if (Number.isFinite(e.margin_db)) return e.margin_db;
  if (Number.isFinite(e.margin_km)) return e.margin_km;
  return Infinity;
}

function formatKm(v){
  return Number.isFinite(v) ? Number(v).toFixed(2) : '—';
}
function formatDb(v){
  return Number.isFinite(v) ? Number(v).toFixed(1) : '—';
}
function formatMhz(v){
  return Number.isFinite(v) ? Number(v).toFixed(1) : '—';
}
function formatMvm(v){
  return Number.isFinite(v) ? Number(v).toFixed(3) : '—';
}
