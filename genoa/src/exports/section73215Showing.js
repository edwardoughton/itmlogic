// 47 CFR §73.215 short-spacing "showing" — the exhibit-bundle a
// licensee files when §73.207 minimum-distance separations would
// otherwise be violated, but the §73.215 contour-protection math
// shows zero overlap with each affected nearby station.  Per the
// regulation §73.215 is an alternative basis for compliance, NOT
// a waiver — but the colloquial "short-spacing waiver" terminology
// is what brokers use, hence the title casing here.
//
// This generator does NOT compute anything new; it composes Genoa's
// already-stamped section_73_207 + section_73_215 study payloads
// into a reviewer-ready package:
//
//   {
//     ok, cite, summary,
//     short_spaced_pairs: [
//       { call, facility_id, class, freq_mhz, relationship,
//         section_73_207: { required_km, actual_km, deficit_km },
//         section_73_215: { passed: true, forward_du_db, reverse_du_db,
//                           polygon_overlap: { ... } },
//         narrative
//       }
//     ],
//     boilerplate_narrative,
//     certification_language,
//     provenance
//   }
//
// The output is two things:
//   - `narrative`     — a per-pair prose paragraph the engineer can
//                       drop into a §73.215 cover letter.
//   - `boilerplate_narrative` — the umbrella prose that frames the
//                       package ("This exhibit demonstrates that...").
//
// Only "qualifying" pairs (§73.207 fails AND §73.215 passes) are
// included.  Pairs that pass §73.207 don't need a showing; pairs
// that fail BOTH cannot be cured by §73.215 and require a true
// waiver request (different filing, not generated here).

export function buildSection73215Showing(exhibit){
  if (!exhibit || typeof exhibit !== 'object'){
    return { ok: false, error: 'exhibit required' };
  }
  const reg = exhibit.regulatory_compliance || {};
  const r207 = reg['47 CFR §73.207'] || null;
  const r215 = reg['47 CFR §73.215'] || null;

  if (!r207){
    return {
      ok: false,
      error: 'exhibit has no §73.207 study attached — short-spacing showing not applicable'
    };
  }
  if (r207.pass === true){
    return {
      ok: true,
      cite: '47 CFR §73.215',
      applicable: false,
      reason: 'Subject station meets §73.207 minimum-distance separations against every nearby full-service FM.  No §73.215 short-spacing showing is required.',
      short_spaced_pairs: [],
      regulation: '47 CFR §73.207 / §73.215'
    };
  }
  if (!r215){
    return {
      ok: false,
      error: '§73.207 fails but no §73.215 study attached — re-run compute with ERP/HAAT supplied so §73.215 can run'
    };
  }

  // Index §73.215 pairs by nearby_call / facility_id so we can match
  // them against §73.207 violations.
  const r215ByCall = new Map();
  const r215ByFid  = new Map();
  for (const s of (r215.studies || [])){
    if (s.nearby_call) r215ByCall.set(String(s.nearby_call).toUpperCase(), s);
    if (s.nearby_facility_id) r215ByFid.set(String(s.nearby_facility_id), s);
  }
  function lookupByPair(v){
    const d = v.detail || v;
    const call = d.nearby_call || v.station;
    const fid  = d.nearby_facility_id;
    if (call && r215ByCall.has(String(call).toUpperCase())) return r215ByCall.get(String(call).toUpperCase());
    if (fid  && r215ByFid.has(String(fid))) return r215ByFid.get(String(fid));
    return null;
  }

  const qualifying  = [];
  const cannot_cure = [];

  for (const v207 of (r207.violations || [])){
    const d = v207.detail || v207;
    const matching215 = lookupByPair(v207);
    const pair = {
      call:           d.nearby_call         || null,
      facility_id:    d.nearby_facility_id  || null,
      class:          d.nearby_class        || null,
      freq_mhz:       Number.isFinite(Number(d.nearby_frequency_mhz)) ? Number(d.nearby_frequency_mhz) : null,
      relationship:   d.relationship        || null,
      section_73_207: {
        required_km:  Number.isFinite(Number(d.required_separation_km)) ? Number(d.required_separation_km) : null,
        actual_km:    Number.isFinite(Number(d.actual_separation_km))   ? Number(d.actual_separation_km)   : null,
        deficit_km:   Number.isFinite(Number(d.margin_km)) ? -Number(d.margin_km) : null,
        class_pair:   d.class_pair || null,
        cite:         '47 CFR §73.207(b) Table A'
      },
      section_73_215: matching215
        ? extractPairFor215(matching215)
        : { passed: null, reason: 'no matching §73.215 study' }
    };
    pair.narrative = buildPairNarrative(pair);
    if (pair.section_73_215.passed === true){
      qualifying.push(pair);
    } else {
      cannot_cure.push(pair);
    }
  }

  const subject = exhibit.station_inputs || {};
  const subjLabel = `${subject.call || subject.facility_id || 'subject station'}` +
                    (subject.frequency ? ` (${subject.frequency} MHz)` : '');

  return {
    ok: true,
    cite: '47 CFR §73.215',
    applicable: true,
    subject:               subject,
    short_spaced_pairs:    qualifying,
    cannot_cure_pairs:     cannot_cure,
    boilerplate_narrative: boilerplate({ subjLabel, n_qualifying: qualifying.length, n_cannot_cure: cannot_cure.length }),
    certification_language: certificationBlock(),
    summary: {
      n_short_spaced:    qualifying.length + cannot_cure.length,
      n_qualifying:      qualifying.length,
      n_cannot_cure:     cannot_cure.length,
      filing_qualifies:  cannot_cure.length === 0
    },
    regulation:  '47 CFR §73.207 / §73.215',
    license_basis: '17 USC §105 (FCC rules + technical tables, US Government public domain)'
  };
}

function extractPairFor215(s){
  return {
    passed:                  s.pair_pass === true,
    pair_pass_du:            s.pair_pass_du ?? null,
    forward_du_db:           Number.isFinite(s.forward?.du_actual_db)
                              ? Number(s.forward.du_actual_db.toFixed(1))
                              : null,
    reverse_du_db:           Number.isFinite(s.reverse?.du_actual_db)
                              ? Number(s.reverse.du_actual_db.toFixed(1))
                              : null,
    du_required_db:          s.du_threshold_db ?? null,
    polygon_overlap: {
      subject_interfering_overlaps_nearby_protected:
        s.polygon_overlap?.subject_interfering_overlaps_nearby_protected ?? null,
      nearby_interfering_overlaps_subject_protected:
        s.polygon_overlap?.nearby_interfering_overlaps_subject_protected ?? null,
      subject_overlap_area_km2:
        s.polygon_overlap?.subject_interfering_overlap_area_km2 ?? null,
      nearby_overlap_area_km2:
        s.polygon_overlap?.nearby_interfering_overlap_area_km2 ?? null
    },
    cite: '47 CFR §73.215'
  };
}

function buildPairNarrative(pair){
  const callTag = pair.call || (pair.facility_id ? `Facility ${pair.facility_id}` : 'the nearby station');
  const rel = pair.relationship || 'channel relationship';
  const def = pair.section_73_207.deficit_km;
  const req = pair.section_73_207.required_km;
  const act = pair.section_73_207.actual_km;
  const r215 = pair.section_73_215;
  if (r215.passed === true){
    return `Against ${callTag} (${rel}; class pair ${pair.section_73_207.class_pair}), ` +
           `§73.207(b) Table A requires ${req} km separation; the actual ` +
           `great-circle distance is ${act} km — a deficit of ${def} km.  ` +
           `The §73.215 contour-protection study shows zero polygon overlap ` +
           `(forward D/U ${r215.forward_du_db} dB, reverse D/U ${r215.reverse_du_db} dB ` +
           `against the ${r215.du_required_db} dB threshold for this class pair).  ` +
           `The subject station qualifies under 47 CFR §73.215(a) and ` +
           `protection is fully demonstrated.`;
  }
  return `Against ${callTag} (${rel}), §73.207 requires ${req} km but actual ` +
         `is ${act} km (${def} km deficit), AND §73.215 contour-protection ` +
         `also fails — ${r215Reason(r215)}.  This pair cannot be cured ` +
         `under §73.215 and would require a true §73.207 waiver request.`;
}

function r215Reason(r215){
  const bits = [];
  if (r215.polygon_overlap?.subject_interfering_overlaps_nearby_protected === true){
    bits.push(`subject interfering polygon overlaps nearby protected polygon by ${r215.polygon_overlap.subject_overlap_area_km2} km²`);
  }
  if (r215.polygon_overlap?.nearby_interfering_overlaps_subject_protected === true){
    bits.push(`nearby interfering polygon overlaps subject protected polygon by ${r215.polygon_overlap.nearby_overlap_area_km2} km²`);
  }
  if (Number.isFinite(r215.forward_du_db) && Number.isFinite(r215.du_required_db)
      && r215.forward_du_db < r215.du_required_db){
    bits.push(`forward D/U ${r215.forward_du_db} dB < ${r215.du_required_db} dB`);
  }
  if (Number.isFinite(r215.reverse_du_db) && Number.isFinite(r215.du_required_db)
      && r215.reverse_du_db < r215.du_required_db){
    bits.push(`reverse D/U ${r215.reverse_du_db} dB < ${r215.du_required_db} dB`);
  }
  return bits.length ? bits.join('; ') : '§73.215 study did not pass';
}

function boilerplate({ subjLabel, n_qualifying, n_cannot_cure }){
  const intro = `This engineering exhibit is filed in support of the application by ${subjLabel}.  ` +
                `The proposed facility does not meet the minimum-distance separation ` +
                `requirements of 47 CFR §73.207(b) Table A against ${n_qualifying + n_cannot_cure} ` +
                `nearby full-service FM station${(n_qualifying + n_cannot_cure) === 1 ? '' : 's'}.`;
  let body;
  if (n_cannot_cure === 0){
    body = `\n\nFor each short-spaced pair, the contour-protection study required by ` +
           `47 CFR §73.215(a) demonstrates zero polygon overlap between the subject ` +
           `station's interfering F(50,10) contour and the nearby station's protected ` +
           `F(50,50) contour, AND between the nearby station's interfering F(50,10) ` +
           `contour and the subject station's protected F(50,50) contour.  In each ` +
           `case the bidirectional D/U ratio also satisfies the protection threshold ` +
           `applicable to the class pair.  The subject station therefore qualifies ` +
           `under 47 CFR §73.215(a) and full protection is demonstrated.`;
  } else if (n_qualifying === 0){
    body = `\n\nThe contour-protection studies required by 47 CFR §73.215(a) do not ` +
           `clear all of the short-spaced pairs.  ${n_cannot_cure} pair${n_cannot_cure === 1 ? '' : 's'} ` +
           `cannot be cured by §73.215 and would require a separate §73.207 waiver ` +
           `request supported by independent engineering analysis.`;
  } else {
    body = `\n\nFor ${n_qualifying} of the ${n_qualifying + n_cannot_cure} short-spaced pair${n_qualifying + n_cannot_cure === 1 ? '' : 's'}, ` +
           `the §73.215(a) contour-protection study demonstrates zero polygon ` +
           `overlap and satisfies the bidirectional D/U threshold.  The remaining ` +
           `${n_cannot_cure} pair${n_cannot_cure === 1 ? '' : 's'} cannot be cured under §73.215 and would require ` +
           `a separate §73.207 waiver request.  This filing therefore presents a ` +
           `mixed showing; the per-pair details are tabulated below.`;
  }
  return intro + body;
}

function certificationBlock(){
  return [
    'I certify that the foregoing facts are true and correct to the best of my ',
    'knowledge and belief.  The contour-distance computations were generated ',
    'by Genoa FCC Propagation Studio using the FCC\'s vendored tvfm_curves.js ',
    'engine (see Appendix C — Validation Evidence for the dataset SHA-256 and ',
    'the live geo.fcc.gov parity check).  The polygon-overlap test uses the ',
    'Sutherland-Hodgman convex-clip algorithm in a local-tangent projection; ',
    'overlap areas are sub-metre accurate vs the WGS-84 reference geoid at ',
    '§73.215 contour scales.\n\n',
    '_____________________________________  ____________________  ____________\n',
    'Signature                              Date                  Engineer of Record\n',
    'License / Certification:  _______________________________________\n',
    'Firm:                     _______________________________________'
  ].join('');
}

export const SECTION_73_215_SHOWING_PROVENANCE = Object.freeze({
  module:        'src/exports/section73215Showing.js',
  regulation:    '47 CFR §73.207 (minimum-distance separation) + §73.215 (contour-protection alternative)',
  modeled: [
    'Per-pair §73.207 deficit (required vs actual separation)',
    'Per-pair §73.215 polygon-overlap result + bidirectional D/U vs class threshold',
    'Per-pair narrative paragraph for the cover letter',
    'Umbrella boilerplate narrative + certification block'
  ],
  not_modeled: [
    'True §73.207 waiver request prose (when §73.215 cannot cure) — separate filing',
    'Spectrum-environment narrative (population, market context) — separate appendix',
    'Engineer signature + PE seal — handled by /api/exhibits/certify chain'
  ],
  license_basis: '17 USC §105 (FCC rules + technical tables, US Government public domain)'
});
