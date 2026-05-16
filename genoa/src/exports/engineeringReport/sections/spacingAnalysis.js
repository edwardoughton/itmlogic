// Spacing analysis — 47 CFR §73.207 minimum-distance separation.
//
// Reads from exhibit.regulatory_compliance.section_73_207.studies and
// the consolidated exhibit.interference_study.stations rows.

export function buildSpacingAnalysisSection(exhibit){
  const svc = String(exhibit.station_inputs?.service || '').toUpperCase();
  if (!['FM', 'LPFM'].includes(svc)) return null;

  const sec = exhibit.regulatory_compliance?.section_73_207;
  if (!sec) return null;

  const allStudies = Array.isArray(sec.studies) ? sec.studies : [];
  const studies = allStudies.filter(s => !s.skipped || s.pair_pass === false);
  // Did any nearby station produce a real (non-skipped) §73.207
  // evaluation?  Skipped entries cover non-restricted relationships and
  // class pairs not in Table A — none of which §73.207 governs.  When
  // EVERY entry is skipped, the section must say so explicitly rather
  // than rendering an empty table with a "meets requirements" summary
  // that contradicts itself.
  const anyRealEval = allStudies.some(s => !s.skipped);
  if (sec.missing_nearby_stations){
    return {
      id:      'spacing',
      type:    'paragraphs',
      heading: 'SPACING ANALYSIS — 47 CFR §73.207',
      paragraphs: [
        'The subject facility was evaluated against the minimum distance separation requirements of 47 CFR §73.207.',
        'No nearby full-service FM stations were attached to the exhibit at compute time, so the §73.207 study could not be performed.  The reviewer must verify §73.207 separation independently before filing.'
      ]
    };
  }

  const rows = studies.map(s => ({
    call:                  s.nearby_call || s.nearby_facility_id || '—',
    facility_id:           s.nearby_facility_id || '—',
    fcc_class:             s.nearby_class || '—',
    frequency_mhz:         Number.isFinite(s.nearby_frequency_mhz) ? Number(s.nearby_frequency_mhz).toFixed(1) : '—',
    relationship:          s.relationship || '—',
    distance_km:           Number.isFinite(s.actual_separation_km) ? Number(s.actual_separation_km).toFixed(2) : '—',
    required_km:           Number.isFinite(s.required_separation_km) ? String(s.required_separation_km) : '—',
    margin_km:             Number.isFinite(s.margin_km) ? Number(s.margin_km).toFixed(2) : '—',
    pass:                  s.pair_pass === true ? 'PASS'
                          : s.pair_pass === false ? 'FAIL'
                          : (s.skipped ? 'skip' : '—')
  }));

  const failures = rows.filter(r => r.pass === 'FAIL');
  // Summary text — must MATCH what the table actually shows:
  //   * no real evaluations at all     → "no restricted pairs" note
  //   * real evaluations, all passing  → "meets requirements" (table shows them)
  //   * one or more failures           → list the failures (table shows them)
  const summary = !anyRealEval
    ? 'No nearby stations were in a §73.207(b) Table A restricted channel relationship (co-channel, 1st / 2nd / 3rd-adjacent, or IF 10.6 / 10.8 MHz) with the subject facility.  The §73.207 minimum-distance test has no protected pairs to evaluate; protection is governed by §73.215 contour-protection where applicable.'
    : failures.length === 0
    ? 'The subject facility meets the applicable minimum distance separation requirements of 47 CFR §73.207(b) for every restricted-channel-relationship pair evaluated above.'
    : 'The subject facility does not meet the minimum distance separation requirements with respect to the following facilities:\n  ' +
      failures.map(f => `  • ${f.call} (${f.fcc_class}) at ${f.distance_km} km — ${f.relationship} requires ${f.required_km} km (short by ${Math.abs(Number(f.margin_km) || 0).toFixed(2)} km).`).join('\n  ');

  // When the table would be empty (no real evals), render a paragraphs-
  // only section so the PDF doesn't draw an empty bordered table.
  if (!anyRealEval){
    return {
      id:      'spacing',
      type:    'paragraphs',
      heading: 'SPACING ANALYSIS — 47 CFR §73.207',
      paragraphs: [
        'The subject facility was evaluated against the minimum distance separation requirements of 47 CFR §73.207.',
        summary
      ]
    };
  }

  return {
    id:      'spacing',
    type:    'table-with-summary',
    heading: 'SPACING ANALYSIS — 47 CFR §73.207',
    preface: 'The subject facility was evaluated against the minimum distance separation requirements of 47 CFR §73.207.  Distances are computed great-circle per 47 CFR §73.208 using the WGS-84 Karney (2013) geodesic inverse.',
    table: {
      columns: [
        { key: 'call',           label: 'Call',          width: 0.10 },
        { key: 'facility_id',    label: 'Facility ID',   width: 0.10 },
        { key: 'fcc_class',      label: 'Class',         width: 0.07 },
        { key: 'frequency_mhz',  label: 'Freq (MHz)',    width: 0.10, align: 'right' },
        { key: 'relationship',   label: 'Relationship',  width: 0.13 },
        { key: 'distance_km',    label: 'Distance (km)', width: 0.12, align: 'right' },
        { key: 'required_km',    label: 'Required (km)', width: 0.12, align: 'right' },
        { key: 'margin_km',      label: 'Margin (km)',   width: 0.10, align: 'right' },
        { key: 'pass',           label: 'Pass/Fail',     width: 0.16 }
      ],
      rows
    },
    summary
  };
}
