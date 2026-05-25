// Contour protection — 47 CFR §73.215.
//
// Per-pair reasoning narratives (binding D/U margin + alternate-route
// note) come from _fmReasoning.js so the table renders the kind of
// engineering paragraph legacy tools (V-Soft, RFi) emit alongside
// every §73.215 study.

import { buildFmReasoning } from './_fmReasoning.js';
import { summarizeFortranParity } from '../../../evidence/fortranFccClient.js';

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

  // Per-pair reasoning narratives indexed by call/facility_id so each
  // row can display the binding D/U margin and §73.207 alternate-route
  // status — the kind of engineering note legacy tools render next to
  // every §73.215 study.
  const reasoning = buildFmReasoning(exhibit.interference_study);
  const reasoningByCall = new Map();
  for (const p of reasoning.pairs){
    if (p.station?.call)        reasoningByCall.set(String(p.station.call),        p);
    if (p.station?.facility_id) reasoningByCall.set(String(p.station.facility_id), p);
  }

  const rows = studies.map(s => {
    const polygon = s.polygon_overlap || {};
    const polygon_pass = polygon.subject_interfering_overlaps_nearby_protected === false
                      && polygon.nearby_interfering_overlaps_subject_protected === false;
    const key = String(s.nearby_call || s.nearby_facility_id || '');
    const r   = reasoningByCall.get(key);
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
      pass:                  s.pair_pass === true ? 'PASS' : s.pair_pass === false ? 'FAIL' : '—',
      reasoning:             r?.binding_constraint
                              ? (r.binding_constraint + (r.alternate_route_available ? ' (alternate route available)' : ''))
                              : (polygon_pass === false
                                  ? 'F(50,10) interfering polygon overlaps the protected contour — §73.215 polygon-overlap test fails'
                                  : '—')
    };
  });

  const failures = rows.filter(r => r.pass === 'FAIL');
  // FORTRAN-parity wording — honest: "verified against FCC TVFMFS_METRIC"
  // is emitted ONLY when the parity sweep actually ran AND passed.
  const parity = summarizeFortranParity(exhibit.evidence, svc);
  const summary = failures.length === 0
    ? `The subject facility qualifies under 47 CFR §73.215 for every restricted-channel-relationship pair evaluated above.  ${parity.wording}`
    : 'The subject facility does not qualify under §73.215 with respect to the following facilities:\n  ' +
      failures.map(f => `  • ${f.call} (${f.relationship}) — D/U required ${f.du_required} dB; forward ${f.du_forward} dB, reverse ${f.du_reverse} dB; subject→nearby polygon overlap ${f.sn_overlap} km², nearby→subject ${f.ns_overlap} km².`).join('\n  ')
      + `\n\n  ${parity.wording}`;

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
    preface: 'Contour protection analysis was performed using F(50,50) curves for desired/protected signals and F(50,10) curves for interfering signals.  The polygon-overlap test compares each station\'s F(50,10) interfering polygon against the other station\'s F(50,50) protected polygon (Sutherland-Hodgman convex clip in a local-tangent projection; overlap area via Karney WGS-84 PolygonArea).  The Reasoning column names the binding D/U constraint and the §73.207 alternate-route status for each pair.\n\n§73.215 interference and protection analyses in this exhibit are computed using the filed/authorized facility HAAT basis associated with the proposed facility parameters.  Contour visualization and radial summaries elsewhere in this exhibit (Contour Results, Appendix A, the contour map) may use terrain-derived per-radial HAAT for engineering reference and coverage characterization; those terrain-aware contours are advisory and do not change the filing-controlling §73.215 determination above.',
    table: {
      columns: [
        { key: 'call',         label: 'Call',                   width: 0.10 },
        { key: 'relationship', label: 'Relationship',           width: 0.10 },
        { key: 'du_required',  label: 'D/U Req (dB)',           width: 0.08, align: 'right' },
        { key: 'du_forward',   label: 'D/U Fwd (dB)',           width: 0.08, align: 'right' },
        { key: 'du_reverse',   label: 'D/U Rev (dB)',           width: 0.08, align: 'right' },
        { key: 'sn_overlap',   label: 'S→N overlap (km²)',      width: 0.11, align: 'right' },
        { key: 'ns_overlap',   label: 'N→S overlap (km²)',      width: 0.11, align: 'right' },
        { key: 'pass',         label: 'Pass/Fail',              width: 0.08 },
        { key: 'reasoning',    label: 'Binding constraint',     width: 0.26 }
      ],
      rows
    },
    summary,
    alternate
  };
}
