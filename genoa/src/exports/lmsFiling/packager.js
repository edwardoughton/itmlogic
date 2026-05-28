// Form 301-FM filing-package assembler.
//
// Returns { json, html, plain_text, fields_csv, filename_stem } —
// each is a string ready to ship as a downloadable file.  The route
// (/api/exhibits/filing-package) wraps these into a JSON response;
// the UI offers Copy / Download buttons.
//
// We deliberately do NOT generate the engineering exhibit PDF here;
// that's exhibit-export pipeline's job and is already produced by the
// existing /api/exhibits/.../export/pdf route.  The cheat-sheet HTML
// references the PDF by filename so the licensee uploads both side
// by side to LMS.

import { mapForm301Fm, selectSchemaForService } from './mapping.js';
import { FORM_301_FM_META } from './form301fm.js';

// Per-service filename stem suffix.  AM/FM/FX/LPFM each get a
// distinct token so engineers can tell at a glance which form a
// cheatsheet was generated for.
function filingStemForForm(formId){
  const id = String(formId || '').toUpperCase();
  if (id === '301-AM') return 'form301am-filing-package';
  if (id === '349')    return 'form349-filing-package';
  if (id === '318')    return 'form318-filing-package';
  return 'form301fm-filing-package';
}

const STATUS_BADGE = {
  filled:    { color: '#43a85a', label: 'FILLED' },
  suggested: { color: '#5a9ec4', label: 'SUGGESTED — confirm' },
  gap:       { color: '#c4745a', label: 'NEEDS INPUT' },
  unknown:   { color: '#d6a36a', label: 'EVIDENCE MISSING' }
};

// One-line "FCC FMQ · cached 2026-05-08T18:14Z" string for the cheatsheet.
function fmtProvenance(p){
  if (!p || typeof p !== 'object') return '';
  const bits = [];
  if (p.source) bits.push(p.source);
  if (p.dataset) bits.push(p.dataset);
  if (p.vintage) bits.push(`vintage ${p.vintage}`);
  if (p.method) bits.push(p.method);
  if (p.fetched_at) bits.push(`fetched ${p.fetched_at}`);
  if (p.note) bits.push(p.note);
  return bits.join(' · ');
}

function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtValue(v, type){
  if (v === null || v === undefined) return '—';
  if (type === 'coords' && v && Number.isFinite(v.lat) && Number.isFinite(v.lon)){
    return `${v.lat.toFixed(6)}, ${v.lon.toFixed(6)} (${v.datum || 'NAD83'})`;
  }
  if (type === 'pattern_table' && Array.isArray(v)){
    return `${v.length}-row pattern table`;
  }
  if (typeof v === 'number'){
    return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '—';
  }
  return String(v);
}

export function buildFilingPackage(exhibit, applicant = {}){
  const mapped = mapForm301Fm(exhibit, applicant);
  const callTag = (exhibit?.station_inputs?.call || 'unknown')
    .replace(/[^A-Z0-9]/gi, '_')
    .toUpperCase();
  const filename_stem = `${callTag}-${filingStemForForm(mapped?.form?.form_id)}`;

  // Advisory-only notes surfaced alongside the filing package.  These
  // are NEVER LMS fields, NEVER required, and NEVER affect
  // filing_ready / compliance_pass / blockers_count.  Reviewers see
  // them as contextual evidence next to the form.
  const advisory_notes = buildAdvisoryNotes(exhibit);

  return {
    json:          jsonOutput(mapped, advisory_notes),
    html:          htmlOutput(mapped),
    plain_text:    plainTextOutput(mapped, advisory_notes),
    fields_csv:    csvOutput(mapped),
    filename_stem,
    summary:       mapped.summary,
    filing_ready:  mapped.filing_ready,
    blockers_count: mapped.blockers_count,
    compliance_pass: mapped.compliance_pass,
    advisory_notes
  };
}

// Build the advisory-notes array (geo-RF environmental evidence, AM
// physics evidence, anything else that's strictly informational and
// must NOT gate filing).  Each entry is a small KV record reviewers
// can read; nothing here maps to an LMS field.
function buildAdvisoryNotes(exhibit){
  const notes = [];
  const ge = exhibit?.evidence?.geo_rf_evidence;
  if (ge){
    const tc = ge.datasets?.tree_canopy_conus || {};
    notes.push({
      id:            'environmental_rf_evidence',
      label:         'Environmental RF Evidence',
      status:        ge.status,
      advisory:      true,
      filing_effect: 'none',
      summary:       'advisory only — does not change LMS required fields or filing_ready',
      tree_canopy_value:   tc.value_numeric ?? tc.value_raw ?? null,
      tree_canopy_dataset: tc.dataset || null,
      fetched_at:    ge.fetched_at || null
    });
  }
  const ap = exhibit?.evidence?.am_physics;
  if (ap){
    notes.push({
      id:            'am_physics_evidence',
      label:         'AM Physics (SOMNEC2D) Evidence',
      status:        ap.status,
      advisory:      true,
      filing_effect: 'none',
      summary:       'advisory only — independent NEC-family ground-field solver; does not modify §73.184 contour distances',
      grid_sha256:   ap.outputs?.grid_sha256 || null,
      fetched_at:    ap.fetched_at || null
    });
  }
  return notes;
}

function jsonOutput(mapped, advisory_notes = []){
  const formIdSlug = String(mapped?.form?.form_id || '301-FM')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_');
  return JSON.stringify({
    schema:        `genoa.filing_package.form_${formIdSlug}.v1`,
    generated_at:  new Date().toISOString(),
    form:          mapped.form,
    summary:       mapped.summary,
    filing_ready:  mapped.filing_ready,
    gating_reason: mapped.gating_reason ?? null,
    blockers_count: mapped.blockers_count,
    compliance_pass: mapped.compliance_pass,
    exhibit:       mapped.exhibit_metadata,
    advisory_notes,                                    // never affects filing_ready
    fields:        mapped.fields.map(f => ({
      id:        f.id,
      lms_label: f.lms_label,
      section:   f.section,
      subsection: f.subsection,
      type:      f.type,
      unit:      f.unit ?? null,
      required:  !!f.required,
      cite:      f.cite ?? null,
      source:    f.source,
      status:    f.status,
      value:     f.value,
      provenance: f.provenance || null,
      notes:     f.notes ?? null,
      engineer_confirmation_required: f.engineer_confirmation_required || false
    }))
  }, null, 2);
}

function csvOutput(mapped){
  const rows = [['subsection','field_id','lms_label','required','source','status','cite','value','provenance']];
  for (const f of mapped.fields){
    const v = f.value;
    let cell = '';
    if (v === null || v === undefined) cell = '';
    else if (typeof v === 'object') cell = JSON.stringify(v);
    else cell = String(v).replace(/"/g, '""');
    const prov = fmtProvenance(f.provenance).replace(/"/g, '""');
    rows.push([
      f.subsection || '',
      f.id,
      f.lms_label,
      f.required ? 'Y' : '',
      f.source,
      f.status,
      f.cite || '',
      cell,
      prov
    ].map(c => `"${c}"`).join(','));
  }
  return rows.join('\n');
}

function plainTextOutput(mapped, advisory_notes = []){
  const out = [];
  const form = mapped.form || {};
  const formId = form.form_id || '301-FM';
  out.push('='.repeat(80));
  out.push(`  FCC FORM ${formId} — ENGINEERING (SECTION III) FILING CHEATSHEET`);
  out.push(`  Station: ${mapped.exhibit_metadata.call || 'unknown'}  ·  Facility ${mapped.exhibit_metadata.facility_id || '—'}`);
  out.push(`  Build SHA: ${mapped.exhibit_metadata.build_sha || 'unknown'}`);
  out.push(`  Generated: ${new Date().toISOString()}`);
  out.push(`  Filing-ready: ${mapped.filing_ready ? 'YES' : 'NO'}`);
  out.push(`  Filled: ${mapped.summary.filled} / ${mapped.summary.total}  ·  Suggested: ${mapped.summary.suggested ?? 0}  ·  Required gaps: ${mapped.summary.required_gaps}`);
  out.push('='.repeat(80));
  out.push('');
  if (form.lms_portal_url){
    out.push('-- SUBMISSION PORTAL --------------------------------------------------------');
    out.push(`  Portal:    ${form.lms_portal_url}`);
    if (form.lms_schedule)     out.push(`  Schedule:  ${form.lms_schedule}`);
    if (form.lms_filing_path)  out.push(`  Path:      ${form.lms_filing_path}`);
    if (form.fcc_url)          out.push(`  Reference: ${form.fcc_url}`);
    out.push('');
  }
  if (Array.isArray(form.submission_checklist) && form.submission_checklist.length){
    out.push('-- PRE-FLIGHT CHECKLIST -----------------------------------------------------');
    out.push('Verify each item before filing.  Items are NOT auto-checked by Genoa —');
    out.push('the engineer of record signs off that they have been satisfied.');
    out.push('');
    for (const item of form.submission_checklist){
      out.push(`  [ ] ${item}`);
    }
    out.push('');
  }
  out.push('Per H&D-style filing convention, paste these values into LMS Section III.');
  out.push('SUGGESTED entries are pre-staged by Genoa from the exhibit and require');
  out.push('engineer confirmation before filing — they are not auto-certified.');
  out.push('Sections I (applicant), II (legal), and IV (ownership) are the licensee\'s');
  out.push('and FCC counsel\'s responsibility — Genoa does NOT fill those.');
  out.push('');

  let lastSub = null;
  for (const f of mapped.fields){
    if (f.subsection !== lastSub){
      out.push('');
      out.push(`-- ${f.subsection || f.section} ${'-'.repeat(76 - (f.subsection || '').length)}`);
      lastSub = f.subsection;
    }
    const tag = (STATUS_BADGE[f.status] || STATUS_BADGE.gap).label.padEnd(20);
    const req = f.required ? '[REQ]' : '     ';
    out.push(`${tag} ${req} ${f.lms_label}`);
    out.push(`                           ${fmtValue(f.value, f.type)}`);
    if (f.cite)  out.push(`                           cite: ${f.cite}`);
    const prov = fmtProvenance(f.provenance);
    if (prov)    out.push(`                           src:  ${prov}`);
    if (f.notes) out.push(`                           note: ${f.notes}`);
  }
  if (advisory_notes && advisory_notes.length){
    out.push('');
    out.push('-'.repeat(80));
    out.push('ADVISORY EVIDENCE (informational only — NOT filing fields)');
    out.push('-'.repeat(80));
    for (const n of advisory_notes){
      out.push(`  ${n.label}`);
      out.push(`      Status         : ${n.status || 'unknown'}`);
      out.push(`      Filing effect  : NONE (advisory only)`);
      if (n.tree_canopy_value != null)
        out.push(`      Tree canopy    : ${n.tree_canopy_value}${n.tree_canopy_dataset ? `  (${n.tree_canopy_dataset})` : ''}`);
      if (n.grid_sha256)
        out.push(`      Grid SHA-256   : ${n.grid_sha256}`);
      if (n.fetched_at)
        out.push(`      Fetched at     : ${n.fetched_at}`);
      out.push(`      Note           : ${n.summary}`);
      out.push('');
    }
  }
  out.push('');
  out.push('-'.repeat(80));
  out.push('Replay token (proves which Genoa build produced these values):');
  out.push(`  ${mapped.exhibit_metadata.replay_token || '(none)'}`);
  out.push('Verify: POST { replay_token } to /api/exhibits/verify-replay-token');
  out.push('-'.repeat(80));
  return out.join('\n');
}

function htmlOutput(mapped){
  const meta = mapped.exhibit_metadata;
  const form = mapped.form || {};
  const formId = form.form_id || '301-FM';
  const formTitle = form.form_title || 'Application for Construction Permit for Commercial Broadcast Station — FM';
  const ready = mapped.filing_ready;
  const portalHtml = form.lms_portal_url ? `
  <h2>Where to file</h2>
  <table class="portal">
    <tr><th>Portal</th><td><a href="${escapeHtml(form.lms_portal_url)}" target="_blank" rel="noopener">${escapeHtml(form.lms_portal_url)}</a></td></tr>
    ${form.lms_schedule    ? `<tr><th>Schedule</th><td>${escapeHtml(form.lms_schedule)}</td></tr>` : ''}
    ${form.lms_filing_path ? `<tr><th>Filing path</th><td>${escapeHtml(form.lms_filing_path)}</td></tr>` : ''}
    ${form.fcc_url         ? `<tr><th>FCC reference</th><td><a href="${escapeHtml(form.fcc_url)}" target="_blank" rel="noopener">${escapeHtml(form.fcc_url)}</a></td></tr>` : ''}
  </table>
` : '';
  const checklistHtml = Array.isArray(form.submission_checklist) && form.submission_checklist.length ? `
  <h2>Pre-flight checklist</h2>
  <p style="font-size:12px">Verify each item before filing. Items are <b>not</b> auto-checked by Genoa — the engineer of record signs off that they have been satisfied.</p>
  <ul class="checklist">
    ${form.submission_checklist.map(item => `<li>${escapeHtml(item)}</li>`).join('\n    ')}
  </ul>
` : '';
  const fieldsHtml = mapped.fields.map(f => {
    const badge = STATUS_BADGE[f.status] || STATUS_BADGE.gap;
    const provText = fmtProvenance(f.provenance);
    let valueCell;
    if (f.status === 'filled' || f.status === 'suggested'){
      valueCell = `<code>${escapeHtml(fmtValue(f.value, f.type))}</code>`;
      if (f.status === 'suggested'){
        valueCell += ' <small style="color:#5a9ec4;font-style:italic">(suggested — confirm before filing)</small>';
      }
    } else {
      valueCell = `<i style="color:#999">${f.status === 'gap' ? 'manual entry required' : 'evidence missing'}</i>`;
    }
    return `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #e7e2d4">${escapeHtml(f.subsection || '')}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #e7e2d4">
          ${escapeHtml(f.lms_label)}${f.required ? ' <small style="color:#c4745a">REQ</small>' : ''}
          ${f.cite ? `<br><small style="color:#999">${escapeHtml(f.cite)}</small>` : ''}
          ${f.notes ? `<br><small style="color:#999;font-style:italic">${escapeHtml(f.notes)}</small>` : ''}
        </td>
        <td style="padding:6px 10px;border-bottom:1px solid #e7e2d4">
          ${valueCell}
          ${provText ? `<br><small style="color:#888;font-family:'Courier New',monospace;font-size:9px">src: ${escapeHtml(provText)}</small>` : ''}
        </td>
        <td style="padding:6px 10px;border-bottom:1px solid #e7e2d4">
          <span style="background:${badge.color};color:#fff;padding:2px 6px;border-radius:3px;font-size:10px;font-family:monospace">${badge.label}</span>
        </td>
      </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Form ${escapeHtml(formId)} Filing Cheatsheet — ${escapeHtml(meta.call || 'Subject Facility')}</title>
  <style>
    body { font-family: 'Times New Roman', serif; max-width: 1100px; margin: 32px auto; padding: 0 24px; color: #1c2e3a; }
    h1   { font-size: 22px; margin-bottom: 4px; }
    h2   { font-size: 14px; color: #c4745a; text-transform: uppercase; letter-spacing: 2px; margin-top: 24px; }
    .meta { font-size: 12px; color: #666; margin-bottom: 24px; }
    .ready { padding: 8px 14px; border-radius: 4px; font-family: monospace; font-size: 12px; display: inline-block; margin-right: 8px; }
    .ready-yes { background: #43a85a; color: #fff; }
    .ready-no  { background: #c4745a; color: #fff; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th { text-align: left; padding: 8px 10px; background: #1c2e3a; color: #f3c86d; font-family: monospace; font-size: 10px; letter-spacing: 1px; text-transform: uppercase; }
    code { font-family: 'Courier New', monospace; font-size: 12px; color: #1c2e3a; }
    .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #c4745a; font-size: 10px; color: #666; }
    .replay { font-family: monospace; font-size: 9px; word-break: break-all; background: #f6f1e1; padding: 8px; border-radius: 4px; }
    table.portal { font-size: 12px; }
    table.portal th { background: #f3c86d; color: #1c2e3a; padding: 4px 10px; text-align: left; font-family: monospace; font-size: 10px; letter-spacing: 1px; }
    table.portal td { padding: 4px 10px; border-bottom: 1px solid #e7e2d4; }
    ul.checklist { font-size: 12px; padding-left: 20px; }
    ul.checklist li { margin-bottom: 6px; list-style: none; position: relative; padding-left: 22px; }
    ul.checklist li::before { content: '[ ]'; position: absolute; left: 0; font-family: monospace; color: #c4745a; }
  </style>
</head>
<body>
  <h1>FCC Form ${escapeHtml(formId)} — Engineering (Section III) Filing Cheatsheet</h1>
  <div style="font-size:12px;color:#666;margin-bottom:8px;font-style:italic">${escapeHtml(formTitle)}</div>
  <div class="meta">
    Station <b>${escapeHtml(meta.call || 'unknown')}</b> · Facility ${escapeHtml(meta.facility_id || '—')} · Service ${escapeHtml(meta.service || '—')}<br>
    Build SHA <code>${escapeHtml((meta.build_sha || 'unknown').slice(0, 12))}…</code> · Generated ${escapeHtml(new Date().toISOString())}
  </div>

  <div>
    <span class="ready ${ready ? 'ready-yes' : 'ready-no'}">${ready ? 'FILING-READY' : 'NOT FILING-READY'}</span>
    <span style="font-size:12px;color:#666">
      ${mapped.summary.filled} / ${mapped.summary.total} filled ·
      ${mapped.summary.required_gaps} required gap${mapped.summary.required_gaps === 1 ? '' : 's'} ·
      ${mapped.blockers_count} engine blocker${mapped.blockers_count === 1 ? '' : 's'} ·
      compliance: <b>${escapeHtml(mapped.compliance_pass || 'unknown')}</b>
    </span>
  </div>

${portalHtml}
${checklistHtml}
  <h2>How to use this</h2>
  <p style="font-size:12px">
    Per H&D-style filing convention, paste the <i>filled</i> values below into the
    matching fields in FCC LMS Section III for the application.  Fields marked
    <code>SUGGESTED</code> have been pre-staged by Genoa from the exhibit and
    must be confirmed by the engineer of record before filing — they are not
    auto-certified.  Fields marked <code>NEEDS INPUT</code> are out of scope
    for an engineering tool and must be supplied by the engineer of record
    (tower / FAA / antenna make-model) or by the licensee and counsel
    (applicant identification, legal certifications, ownership reports —
    Sections I, II, IV).  Fields marked <code>EVIDENCE MISSING</code>
    indicate a Genoa evidence gap (e.g. terrain sidecar unreachable) that
    should be resolved before filing.
  </p>

  <h2>Section III — engineering data</h2>
  <table>
    <thead>
      <tr>
        <th>Sub</th>
        <th>LMS field</th>
        <th>Value</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${fieldsHtml}
    </tbody>
  </table>

  <h2>Reproducibility</h2>
  <p style="font-size:12px">
    Replay token (HMAC-signed proof of which Genoa build produced these values):
  </p>
  <div class="replay">${escapeHtml(meta.replay_token || '(none)')}</div>
  <p style="font-size:11px;color:#666">
    Verify with <code>POST /api/exhibits/verify-replay-token</code> — recomputes
    the HMAC under the deploy's <code>BUILD_SIGNING_SECRET</code> and reports
    constant-time match.  Verifies the build attestation transitively.
  </p>

  <div class="footer">
    Generated by Genoa FCC Propagation Studio.  This cheatsheet is the
    engineering-data deliverable a broadcast engineer hands to the licensee
    or FCC counsel for upload to LMS.  ${escapeHtml(form.scope_note || FORM_301_FM_META.scope_note)}
  </div>
</body>
</html>
`;
}
