// Formal interference study — H&D-grade per-station table.
//
// PURPOSE
//   §73.207, §73.215, §74.1204, §73.187 each produce per-pair
//   "studies" inside their own regulatory_compliance blocks.  But a
//   filing-grade exhibit needs ONE consolidated table that lists,
//   per nearby station, every applicable rule's:
//
//       channel relationship
//       station-to-station distance
//       required value (separation, D/U, or skywave field threshold)
//       actual value
//       margin
//       pass/fail
//       rule citation
//
//   This module produces that consolidated table and stamps it on
//   exhibit.interference_study so the JSON / TXT / PDF exports can
//   render it as a real engineering deliverable rather than a list
//   of warnings.
//
// SHAPE (exhibit.interference_study)
//   {
//     cite:               ['47 CFR §73.207', '47 CFR §73.215', …],
//     subject:            { call, facility_id, fcc_class, frequency, … },
//     rules_evaluated:    ['§73.207(b)', '§73.215', '§74.1204', '§73.187'],
//     n_stations:         12,
//     n_pass:             11,
//     n_fail:             1,
//     blocking_rule:      null | '§73.207(b) co-channel A↔B 241 km short',
//     filing_qualifies:   bool,           // any rule passes for every station
//     stations: [
//       {
//         call, facility_id, fcc_class,
//         frequency_mhz, frequency_offset_khz,
//         channel_relationship,          // 'co-channel' | …
//         distance_km,                    // station-to-station great-circle
//         rules: {
//           section_73_207: { required_separation_km, actual_separation_km,
//                             margin_km, pass, cite },
//           section_73_215: { du_required_db, du_actual_db,
//                             polygon_overlap_km2, pass, cite },
//           section_74_1204: { du_required_db, du_actual_db, pass, cite },  // FX only
//           section_73_187:  { protected_field_mvm,
//                              skywave_field_mvm, pass, cite }                 // AM only
//         },
//         pass_overall:   bool,           // station passes if ANY rule passes
//         qualified_via:  ['§73.215']     // which rule(s) cleared
//       }
//     ],
//     provenance: { regulation_citations, methodology, license_basis }
//   }

/**
 * Build the formal interference study from the engine's per-rule
 * regulatory_compliance result.  Pure function; safe to call after
 * compute() has populated regulatory_compliance.
 */
export function buildInterferenceStudy({ subject, regulatory_compliance, service }){
  const svc = String(service || '').toUpperCase();
  if (!subject || !regulatory_compliance){
    return {
      cite:            [],
      subject:         null,
      rules_evaluated: [],
      n_stations:      0, n_pass: 0, n_fail: 0,
      blocking_rule:   null,
      filing_qualifies:null,
      stations:        [],
      reason:          'no subject or regulatory_compliance supplied',
      provenance:      buildProvenance(svc)
    };
  }

  // Collect the per-rule study arrays available.
  const sec207 = regulatory_compliance.section_73_207?.studies || [];
  const sec215 = svc === 'FM' ? (regulatory_compliance.studies || []) : [];
  const sec1204 = svc === 'FX' ? (regulatory_compliance.studies || []) : [];
  const sec187  = svc === 'AM' ? (regulatory_compliance.studies || []) : [];

  // Index every station ever mentioned (by facility_id + call).
  const stationIndex = new Map();
  const keyOf = (s) => String(s.nearby_facility_id || s.primary_facility_id || s.facility_id || s.nearby_call || s.primary_call || s.call || '?');

  for (const s of sec207){
    const k = keyOf(s);
    if (!stationIndex.has(k)) stationIndex.set(k, blankStation(s, 'nearby'));
    stationIndex.get(k).rules.section_73_207 = sec207Row(s);
  }
  for (const s of sec215){
    const k = keyOf(s);
    if (!stationIndex.has(k)) stationIndex.set(k, blankStation(s, 'nearby'));
    stationIndex.get(k).rules.section_73_215 = sec215Row(s);
  }
  for (const s of sec1204){
    const k = keyOf(s);
    if (!stationIndex.has(k)) stationIndex.set(k, blankStation(s, 'primary'));
    stationIndex.get(k).rules.section_74_1204 = sec1204Row(s);
  }
  for (const s of sec187){
    const k = keyOf(s);
    if (!stationIndex.has(k)) stationIndex.set(k, blankStation(s, 'nearby'));
    stationIndex.get(k).rules.section_73_187 = sec187Row(s);
  }

  // Compute per-station overall pass + which rule qualified.
  const stations = [];
  for (const [, st] of stationIndex){
    const r = st.rules;
    const tries = [
      ['§73.207(b)', r.section_73_207?.pass],
      ['§73.215',    r.section_73_215?.pass],
      ['§74.1204',   r.section_74_1204?.pass],
      ['§73.187',    r.section_73_187?.pass]
    ].filter(([, p]) => p === true || p === false);
    const passing = tries.filter(([, p]) => p === true).map(([cite]) => cite);
    const failing = tries.filter(([, p]) => p === false).map(([cite]) => cite);
    // A station qualifies if AT LEAST ONE applicable rule passes
    // (FCC convention: a station that fails §73.207 but clears
    // §73.215 contour-protection still qualifies).  Filing fails for
    // a station only when EVERY applicable rule fails.
    const pass_overall = passing.length > 0
                      || (tries.length === 0 ? null : false);

    st.pass_overall  = pass_overall;
    st.qualified_via = passing;
    st.failed_rules  = failing;
    stations.push(st);
  }
  // Sort by distance ascending so the closest stations show first.
  stations.sort((a, b) => (a.distance_km || Infinity) - (b.distance_km || Infinity));

  // Aggregate.
  const n_pass = stations.filter(s => s.pass_overall === true).length;
  const n_fail = stations.filter(s => s.pass_overall === false).length;
  const blocking = stations.find(s => s.pass_overall === false);
  const filing_qualifies = stations.length === 0 ? null : (n_fail === 0);

  return {
    cite:            collectCites(svc, regulatory_compliance),
    subject:         subjectShape(subject),
    rules_evaluated: rulesEvaluated(svc),
    n_stations:      stations.length,
    n_pass, n_fail,
    blocking_rule:   blocking
                       ? `${blocking.failed_rules?.join('+') || 'rule'} fails against ${blocking.call || blocking.facility_id || 'station'} at ${blocking.distance_km} km (${blocking.channel_relationship})`
                       : null,
    filing_qualifies,
    stations,
    provenance:      buildProvenance(svc)
  };
}

// ---------------------------------------------------------------------------
// Per-rule row builders
// ---------------------------------------------------------------------------

function sec207Row(s){
  return {
    cite:                      '47 CFR §73.207(b) Table A',
    required_separation_km:    s.required_separation_km ?? null,
    actual_separation_km:      s.actual_separation_km   ?? null,
    margin_km:                 s.margin_km              ?? null,
    pass:                      s.pair_pass === true ? true : s.pair_pass === false ? false : null,
    skipped:                   !!s.skipped,
    skipped_reason:            s.skipped_reason         ?? null
  };
}

function sec215Row(s){
  const polygon = s.polygon_overlap || {};
  return {
    cite:                      '47 CFR §73.215',
    du_required_db:            s.du_threshold_db        ?? null,
    du_actual_db_forward:      s.forward?.du_actual_db  ?? null,
    du_actual_db_reverse:      s.reverse?.du_actual_db  ?? null,
    du_pass:                   s.pair_pass_du,
    polygon_overlap_subject_into_nearby_km2: polygon.subject_interfering_overlap_area_km2 ?? null,
    polygon_overlap_nearby_into_subject_km2: polygon.nearby_interfering_overlap_area_km2  ?? null,
    polygon_pass:              polygon.subject_interfering_overlaps_nearby_protected === false
                            && polygon.nearby_interfering_overlaps_subject_protected === false,
    pass:                      s.pair_pass === true ? true : s.pair_pass === false ? false : null
  };
}

function sec1204Row(s){
  return {
    cite:                      '47 CFR §74.1204(a)+(c)',
    du_required_db:            s.du_threshold_db                              ?? null,
    du_actual_db:              s.du_actual_db                                 ?? null,
    primary_protected_dbu:     s.primary_protected_field_dbu                  ?? null,
    primary_protected_distance_km: s.primary_protected_distance_km            ?? null,
    edge_distance_km:          s.translator_distance_to_protected_edge_km    ?? null,
    translator_field_dbu:      s.translator_field_dbu_at_edge                 ?? null,
    pass:                      s.pass === true ? true : s.pass === false ? false : null,
    skipped:                   !!s.skipped,
    skipped_reason:            s.skipped_reason                               ?? null
  };
}

function sec187Row(s){
  return {
    cite:                      '47 CFR §73.187 + §73.190 (Wang skywave)',
    relationship:              s.relationship                                  ?? null,
    forward_skywave_mvm:       s.forward?.skywave_field_mvm                    ?? null,
    forward_protected_mvm:     s.forward?.protected_field_mvm                  ?? null,
    reverse_skywave_mvm:       s.reverse?.skywave_field_mvm                    ?? null,
    reverse_protected_mvm:     s.reverse?.protected_field_mvm                  ?? null,
    pass:                      s.pair_pass === true ? true : s.pair_pass === false ? false : null,
    skipped:                   !!s.skipped,
    skipped_reason:            s.skipped_reason                                ?? null
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function blankStation(s, kind){
  return {
    call:                  s.nearby_call         || s.primary_call         || s.call         || null,
    facility_id:           s.nearby_facility_id  || s.primary_facility_id  || s.facility_id  || null,
    fcc_class:             s.nearby_class        || s.primary_class        || s.fcc_class    || null,
    frequency_mhz:         s.nearby_frequency_mhz ?? s.primary_frequency_mhz ?? s.frequency_mhz ?? null,
    // AM §73.187 / §73.190 studies emit kHz, not MHz.  Carry both so
    // the PDF appendix can render the band-appropriate unit instead
    // of printing kHz values under a "Freq (MHz)" header.
    frequency_khz:         s.nearby_frequency_khz ?? s.primary_frequency_khz ?? s.frequency_khz ?? null,
    frequency_offset_khz:  s.delta_khz           ?? null,
    channel_relationship:  s.relationship        ?? null,
    distance_km:           s.actual_separation_km ?? s.separation_km       ?? null,
    role:                  kind,
    rules:                 {}
  };
}

function subjectShape(s){
  return {
    call:           s.call          ?? null,
    facility_id:    s.facility_id   ?? null,
    fcc_class:      s.fcc_class     ?? null,
    frequency_mhz:  Number(s.frequency_mhz),
    frequency_khz:  Number(s.frequency_khz) || null,
    erp_kw:         Number(s.erp_kw),
    haat_m:         Number(s.haat_m),
    lat:            Number(s.lat),
    lon:            Number(s.lon)
  };
}

function rulesEvaluated(svc){
  if (svc === 'FM')   return ['§73.207(b) Table A', '§73.215'];
  if (svc === 'FX')   return ['§74.1204(a)+(c)'];
  if (svc === 'AM')   return ['§73.187', '§73.190 (Wang skywave)'];
  if (svc === 'LPFM') return ['§73.807', '§73.811'];
  return [];
}

function collectCites(svc, rc){
  const out = new Set();
  if (rc.cite) out.add(rc.cite);
  if (rc.section_73_207?.cite) out.add(rc.section_73_207.cite);
  if (rc.section_73_525?.cite) out.add(rc.section_73_525.cite);
  for (const r of rulesEvaluated(svc)) out.add('47 CFR ' + r);
  return [...out];
}

function buildProvenance(svc){
  return {
    methodology: {
      distance:           '§73.208 great-circle, computed via WGS-84 Karney (2013) inverse',
      protected_contour:  '§73.211 / §73.182 — class-specific F(50,50) thresholds (FM) or §73.182 mV/m (AM)',
      interfering_contour:'§74.1204(c) D/U gates: co +20, 1st-adj +6, 2nd/3rd/IF -40 dB',
      polygon_overlap:    'Sutherland-Hodgman convex clip in local-tangent projection; area via Karney WGS-84 PolygonArea',
      skywave:            svc === 'AM' ? 'Wang formulation per §73.190 SS-1 (50%) / SS-2 (10%)' : null
    },
    rule_qualification:   'A station qualifies if AT LEAST ONE applicable rule passes (e.g., §73.215 contour protection clears a station that fails §73.207 minimum-distance separation).  Filing requires every nearby station to qualify under at least one rule.',
    citations: {
      regulations: rulesEvaluated(svc).map(r => '47 CFR ' + r),
      tools:       ['Genoa vendored fcc/contours-api-node@b55870d (tvfm_curves.js + gwave.js)']
    },
    license_basis: '17 USC §105 — regulatory citations are US Government public-domain works'
  };
}
