// Contour protection — 47 CFR §73.215.

export function buildContourProtectionSection(exhibit){
  const svc = String(exhibit.station_inputs?.service || '').toUpperCase();
  if (svc !== 'FM') return null;

  const rc = exhibit.regulatory_compliance;
  if (!rc || rc.cite !== '47 CFR §73.215') return null;

  if (rc.missing_nearby_stations){
    return {
      id:      'protection',
      type:    'paragraphs',
      heading: 'CONTOUR PROTECTION — 47 CFR §73.215',
      paragraphs: [
        'Contour protection analysis was performed using F(50,50) curves for desired/protected signals and F(50,10) curves for interfering signals.',
        'No nearby full-service FM stations were attached to the exhibit at compute time, so the §73.215 study could not be performed.  The reviewer must verify §73.215 independently if §73.207 short-spacing protection is being claimed.'
      ]
    };
  }

  const studies = Array.isArray(rc.studies) ? rc.studies.filter(s => !s.skipped) : [];
  const rows = studies.map(s => {
    const polygon = s.polygon_overlap || {};
    const polygon_pass = polygon.subject_interfering_overlaps_nearby_protected === false
                      && polygon.nearby_interfering_overlaps_subject_protected === false;
    return {
      call:                  s.nearby_call || s.nearby_facility_id || '—',
      relationship:          s.relationship || '—',
      du_required:           Number.isFinite(s.du_threshold_db) ? String(s.du_threshold_db) : '—',
      du_forward:            Number.isFinite(s.forward?.du_actual_db) ? Number(s.forward.du_actual_db).toFixed(1) : '—',
      du_reverse:            Number.isFinite(s.reverse?.du_actual_db) ? Number(s.reverse.du_actual_db).toFixed(1) : '—',
      sn_overlap:            Number.isFinite(polygon.subject_interfering_overlap_area_km2)
                              ? Number(polygon.subject_interfering_overlap_area_km2).toFixed(2)
                              : '—',
      ns_overlap:            Number.isFinite(polygon.nearby_interfering_overlap_area_km2)
                              ? Number(polygon.nearby_interfering_overlap_area_km2).toFixed(2)
                              : '—',
      pass:                  s.pair_pass === true ? 'PASS' : s.pair_pass === false ? 'FAIL' : '—'
    };
  });

  const failures = rows.filter(r => r.pass === 'FAIL');
  const summary = failures.length === 0
    ? 'The subject facility qualifies under 47 CFR §73.215 for every restricted-channel-relationship pair evaluated above.'
    : 'The subject facility does not qualify under §73.215 with respect to the following facilities:\n  ' +
      failures.map(f => `  • ${f.call} (${f.relationship}) — D/U required ${f.du_required} dB; forward ${f.du_forward} dB, reverse ${f.du_reverse} dB; subject→nearby polygon overlap ${f.sn_overlap} km², nearby→subject ${f.ns_overlap} km².`).join('\n  ');

  // Note about §73.207 alternate-rule passage when applicable.
  let alternate = null;
  const sec207 = exhibit.regulatory_compliance?.section_73_207;
  if (sec207 && sec207.pass === false && rc.pass === true){
    alternate = 'The subject facility does not meet §73.207 spacing for one or more pairs but qualifies through contour protection under §73.215.  Filing is acceptable under the §73.215 alternative.';
  }

  return {
    id:      'protection',
    type:    'table-with-summary',
    heading: 'CONTOUR PROTECTION — 47 CFR §73.215',
    preface: 'Contour protection analysis was performed using F(50,50) curves for desired/protected signals and F(50,10) curves for interfering signals.  The polygon-overlap test compares each station\'s F(50,10) interfering polygon against the other station\'s F(50,50) protected polygon (Sutherland-Hodgman convex clip in a local-tangent projection; overlap area via Karney WGS-84 PolygonArea).',
    table: {
      columns: [
        { key: 'call',         label: 'Call',                   width: 0.13 },
        { key: 'relationship', label: 'Relationship',           width: 0.13 },
        { key: 'du_required',  label: 'D/U Req (dB)',           width: 0.10, align: 'right' },
        { key: 'du_forward',   label: 'D/U Fwd (dB)',           width: 0.10, align: 'right' },
        { key: 'du_reverse',   label: 'D/U Rev (dB)',           width: 0.10, align: 'right' },
        { key: 'sn_overlap',   label: 'S→N overlap (km²)',      width: 0.13, align: 'right' },
        { key: 'ns_overlap',   label: 'N→S overlap (km²)',      width: 0.13, align: 'right' },
        { key: 'pass',         label: 'Pass/Fail',              width: 0.18 }
      ],
      rows
    },
    summary,
    alternate
  };
}
