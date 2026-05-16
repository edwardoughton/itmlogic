// PDF exporter — Genoa exhibit → filing-grade PDF via @pdfme/generator.
//
// PROVENANCE
//   Renderer: @pdfme/generator (chelstein/pdfme fork available at
//   github.com/chelstein/pdfme; published npm package @pdfme/generator
//   is used directly).  License: MIT.
//
// CONTRACT
//   exportPdf(exhibit) → Promise<Uint8Array>
//   The PDF carries the SAME data that lands in JSON / TXT / GeoJSON
//   exports.  No recomputation; the renderer is a presentation layer.
//
// DESIGN
//   The PDF is laid out programmatically rather than via a static
//   template, because the radial table size and number of nearby-
//   primaries / OET-65 / §73.215 / §73.187 / ITM blocks varies per
//   exhibit.  Each section emits a sequence of pdfme `text` schemas
//   onto an A4 page, with a page break inserted whenever the cursor
//   reaches the bottom margin.
//
// SECTIONS (in order)
//   1. Cover            — title, station call, service, frequency,
//                          method versions, filing readiness, date
//   2. Inputs           — facility ID, ERP, HAAT, lat/lon, σ (AM)
//   3. Method           — FCC method version + curve dataset SHA
//   4. Radial table     — one line per radial: az, contour distances,
//                          haat_source, terrain provenance
//   5. Regulatory       — §73.215 / §74.1204 / §73.187 / OET-65
//                          summaries with violations
//   6. Evidence         — population, terrain, SDR, identity, ASR
//                          provenance with sources
//   7. Validation       — curve_reference_validation lock statement,
//                          tolerance rationale
//   8. Warnings/blockers — every active warning with code, severity,
//                          phase, title, detail
//   9. Footer           — claude.ai/code session ref, generated_at

import { generate }  from '@pdfme/generator';
import { text }      from '@pdfme/schemas';
import { BLANK_PDF } from '@pdfme/common';

const PDF_PROVENANCE = Object.freeze({
  renderer:      '@pdfme/generator',
  renderer_repo: 'github.com/chelstein/pdfme (fork) — published as @pdfme/generator on npm',
  layout:        'programmatic A4 with auto-paginated sections',
  font:          'pdfme default Roboto'
});

export const PDF_CONTENT_TYPE = 'application/pdf';

const PAGE = Object.freeze({
  width_mm:  210,             // A4
  height_mm: 297,
  margin_mm: 15
});
const TYPOG = Object.freeze({
  title_pt:    18,
  h1_pt:       14,
  h2_pt:       11,
  body_pt:     9,
  mono_pt:     8,
  line_mm_body: 4.0,
  line_mm_h1:   6.0,
  line_mm_h2:   5.0,
  line_mm_mono: 3.5
});
const COL = Object.freeze({
  body_x_mm:    PAGE.margin_mm,
  body_w_mm:    PAGE.width_mm - 2 * PAGE.margin_mm
});

export async function exportPdf(exhibit){
  if (!exhibit || typeof exhibit !== 'object'){
    const err = new Error('exhibit object required');
    err.code = 'INVALID_EXHIBIT';
    err.http_status = 400;
    throw err;
  }

  // Builder accumulates pages, schema list per page, and inputs
  // (one inputs row, mapping schema-name → text content).
  const builder = newBuilder();

  // Section 1 — Cover
  emitTitle(builder, 'Genoa FCC Propagation Exhibit');
  const inputs    = exhibit.station_inputs || {};
  const fr        = exhibit.filing_readiness || {};
  const mv        = exhibit.method_versions || {};
  const summaryLines = [
    `Call            : ${val(inputs.call)}`,
    `Service         : ${val(inputs.service)}    Class: ${val(inputs.fcc_class)}`,
    `Frequency       : ${val(inputs.frequency)} ${val(inputs.frequency_unit)}`,
    `ERP             : ${val(inputs.erp_kw)} kW    HAAT: ${val(inputs.haat_m)} m`,
    `Coordinates     : ${val(inputs.lat)}, ${val(inputs.lon)}`,
    `Filing Readiness: ${val(fr.score)}/100  (${val(fr.status)})`,
    `Generated       : ${new Date().toISOString()}`
  ];
  emitMonoBlock(builder, summaryLines);
  emitGap(builder, 4);

  // Section 2 — Method versions / FCC parity
  emitH1(builder, 'FCC Method Versions');
  emitMonoBlock(builder, [
    `Curve engine    : ${val(mv.curve_engine)}`,
    `Interpolation   : ${val(mv.interpolation)}`,
    `Dataset         : ${val(mv.dataset)}`,
    `Dataset SHA-256 : ${val(mv.dataset_meta_sha256)}`,
    `Projection      : ${val(mv.projection)}`,
    `FCC orchestr.   : ${val(mv.fcc_orchestration?.commit)}`
  ]);
  emitGap(builder, 4);

  // Section 3 — Radial table
  if (Array.isArray(exhibit.radial_table) && exhibit.radial_table.length){
    emitH1(builder, 'Radial Contour Table');
    const header = pad('AZ', 5) + pad('HAAT_m', 9) + pad('SOURCE', 28) + 'CONTOUR_DISTANCES_KM';
    emitMono(builder, header);
    emitMonoRule(builder);
    for (const r of exhibit.radial_table){
      const cd = r.contour_distances_km
        ? Object.entries(r.contour_distances_km)
            .map(([k, v]) => `${k}=${num1(v)}`).join(' ')
        : '—';
      emitMono(builder,
        pad(String(r.az ?? '-'), 5) +
        pad(num1(r.haat_computed_m), 9) +
        pad(String(r.haat_source || '—').slice(0, 27), 28) +
        cd);
    }
    emitGap(builder, 4);
  }

  // Section 4 — Regulatory compliance
  const rc = exhibit.regulatory_compliance;
  if (rc){
    emitH1(builder, 'Regulatory Compliance');
    if (rc.cite)              emitBody(builder, `Primary cite : ${rc.cite}    Pass: ${ynNull(rc.pass)}`);
    if (rc.section_73_207)    emitBody(builder, `§73.207      : ${ynNull(rc.section_73_207.pass)}    n_studies=${rc.section_73_207.studies?.length || 0}    n_violations=${rc.section_73_207.violations?.length || 0}`);
    if (rc.section_73_525)    emitBody(builder, `§73.525      : applicable=${ynNull(rc.section_73_525.applicable)}    pass=${ynNull(rc.section_73_525.pass)}    fm_channel=${val(rc.section_73_525.fm_channel)}    du_gate_db=${val(rc.section_73_525.du_gate_db)}`);
    if (Array.isArray(rc.violations) && rc.violations.length){
      emitH2(builder, 'Violations');
      for (const v of rc.violations.slice(0, 24)){
        emitMono(builder, `  • ${v.cite || '(no cite)'} — ${truncate(v.message || '', 110)}`);
      }
    }
    emitGap(builder, 4);
  }

  // Section 5 — OET-65 RF exposure
  if (exhibit.oet65){
    emitH1(builder, 'RF Exposure (OET-65 / §1.1310)');
    const o = exhibit.oet65;
    emitMonoBlock(builder, [
      `Cite              : ${val(o.cite)}    Pass: ${ynNull(o.pass)}`,
      `Method            : ${val(o.method)}`,
      `Uncontrolled MPE  : ${val(o.compliance?.uncontrolled?.mpe_mw_cm2)} mW/cm² @ ${val(o.compliance?.uncontrolled?.distance_m)} m`,
      `Controlled   MPE  : ${val(o.compliance?.controlled?.mpe_mw_cm2)} mW/cm² @ ${val(o.compliance?.controlled?.distance_m)} m`,
      `Near-field bound. : ${val(o.near_field?.boundary_m)} m    near_field_required=${ynNull(o.near_field?.required_for_filing)}`,
      o.compliance?.boundary_check
        ? `Site-boundary chk : pass=${ynNull(o.compliance.boundary_check.pass)}    margin_db=${val(o.compliance.boundary_check.margin_db)}`
        : 'Site-boundary chk : (not supplied)'
    ]);
    emitGap(builder, 4);
  }

  // Section 6 — ITM coverage (if run)
  if (exhibit.evidence?.itm_coverage?.available){
    emitH1(builder, 'ITM-Aware Coverage (terrain path-loss)');
    const itm = exhibit.evidence.itm_coverage;
    emitMonoBlock(builder, [
      `Engine        : ${val(itm.engine)}    Tier: ${val(itm.tier)}`,
      `DEM source    : ${val(itm.dem_source)}`,
      `FCC baseline  : ${val(itm.fcc_baseline_km)} km`,
      `Method        : ${val(itm.method)}`
    ]);
    emitMono(builder, pad('AZ', 5) + pad('TERRAIN_KM', 12) + pad('FCC_KM', 10) + pad('Δ_KM', 10) + 'MODE');
    emitMonoRule(builder);
    for (const r of (itm.radials || []).slice(0, 36)){
      emitMono(builder,
        pad(String(r.az ?? '-'), 5) +
        pad(num1(r.terrain_distance_km), 12) +
        pad(num1(r.fcc_distance_km), 10) +
        pad(num1(r.delta_km), 10) +
        String(r.mode || '—').slice(0, 22));
    }
    emitGap(builder, 4);
  }

  // Section 7 — Evidence summary
  if (exhibit.evidence){
    emitH1(builder, 'Evidence');
    const ev = exhibit.evidence;
    if (ev.terrain?.available)
      emitBody(builder, `Terrain     : ${val(ev.terrain.source)}    n_radials=${val(ev.terrain.n_radials)}    DEM=${val(ev.terrain.dem?.source)}`);
    if (ev.measurements?.available)
      emitBody(builder, `SDR         : ${val(ev.measurements.source)}    n_records=${val(ev.measurements.n_records)}    calibrated=${ynNull(ev.measurements.calibrated)}    field=${val(ev.measurements.captures_field)}`);
    if (ev.identity?.available)
      emitBody(builder, `Identity    : tiers=${(ev.identity.tiers_used || []).join(', ') || '—'}    confirmations=${(ev.identity.confirmations || []).length}`);
    if (ev.population_estimate?.persons != null)
      emitBody(builder, `Population  : ${val(ev.population_estimate.persons)} persons    source=${val(ev.population_estimate.source)}    vintage=${val(ev.population_estimate.vintage)}`);
    if (ev.asr){
      const cc = ev.asr.cross_check || {};
      emitBody(builder, `ASR         : ${val(ev.asr.asr_number)}    cross_check_matches=${ynNull(cc.matches)}    n_mismatches=${val(cc.n_mismatches)}`);
    }
    if (ev.nearby_primaries_provenance){
      const np = ev.nearby_primaries_provenance;
      emitBody(builder, `Nearby      : ${val(np.source)}    radius=${val(np.radius_km)} km    n=${val(np.n_in_radius)}    enriched=${val(np.ztr_enrichment?.n_enriched)}`);
    }
    emitGap(builder, 4);
  }

  // Section 8 — Validation
  if (exhibit.validation_context){
    emitH1(builder, 'Validation');
    const cr = exhibit.validation_context.curve_reference_validation;
    if (cr){
      emitMonoBlock(builder, [
        `Curve reference : ${val(cr.result)}    ${val(cr.n_pass)}/${val(cr.n_run)} cases`,
        `Schema          : ${val(cr.schema_version)}`,
        `Max error       : ${val(cr.max_error_km)} km`,
        `Lock @ commit   : ${val(cr.lock_statement?.upstream_commit)}    locked_at=${val(cr.lock_statement?.locked_at)}`
      ]);
    }
    emitGap(builder, 4);
  }

  // Section 9 — Warnings + blockers
  const warnings = Array.isArray(exhibit.warnings) ? exhibit.warnings : [];
  if (warnings.length){
    emitH1(builder, `Warnings (${warnings.length})`);
    for (const w of warnings){
      const tag = w.severity === 'blocker' ? '[BLOCKER]'
                 : w.severity === 'warning' ? '[warn]'
                 : `[${w.severity || '?'}]`;
      emitMono(builder, `${tag} ${w.code}`);
      if (w.title) emitMono(builder, `        ${truncate(w.title, 110)}`);
      if (w.detail) emitMono(builder, `        ${truncate(w.detail, 110)}`);
      emitGap(builder, 1);
    }
  }

  // Footer (every page)
  emitFooter(builder, exhibit);

  // Render via pdfme
  const template = {
    basePdf:  blankPdf(builder.pages.length),
    schemas:  builder.pages
  };
  const inputs_arr = [builder.inputs];          // single record across all pages
  const pdf = await generate({ template, inputs: inputs_arr, plugins: { text } });
  return pdf;          // Uint8Array
}

// ---------------------------------------------------------------------------
// pdfme template + builder helpers
// ---------------------------------------------------------------------------

function newBuilder(){
  return {
    pages:        [[]],            // schemas[][]; pages[i] = list of named text schemas
    inputs:       {},              // shared name → string map
    cursor_y_mm:  PAGE.margin_mm,
    page_index:   0,
    name_counter: 0
  };
}

function blankPdf(_n_pages){
  // pdfme's BLANK_PDF is a base64-encoded A4 blank document; pdfme
  // auto-emits additional pages when schemas[] has more than one
  // entry.
  return BLANK_PDF;
}

function newSchema(b, x_mm, y_mm, w_mm, h_mm, fontSize_pt){
  const name = `t${b.name_counter++}`;
  return {
    name,
    type:        'text',
    position:    { x: x_mm, y: y_mm },
    width:       w_mm,
    height:      h_mm,
    fontSize:    fontSize_pt,
    fontColor:   '#000000',
    backgroundColor: '',
    alignment:   'left',
    fontName:    'Roboto'
  };
}

function ensureSpace(b, line_mm){
  if (b.cursor_y_mm + line_mm > PAGE.height_mm - PAGE.margin_mm){
    b.pages.push([]);
    b.page_index++;
    b.cursor_y_mm = PAGE.margin_mm;
  }
}

function emitTitle(b, text_str){
  ensureSpace(b, TYPOG.line_mm_h1 * 1.5);
  const sch = newSchema(b, COL.body_x_mm, b.cursor_y_mm, COL.body_w_mm, TYPOG.line_mm_h1 * 1.5, TYPOG.title_pt);
  b.pages[b.page_index].push(sch);
  b.inputs[sch.name] = String(text_str);
  b.cursor_y_mm += TYPOG.line_mm_h1 * 1.5;
}

function emitH1(b, text_str){
  ensureSpace(b, TYPOG.line_mm_h1);
  const sch = newSchema(b, COL.body_x_mm, b.cursor_y_mm, COL.body_w_mm, TYPOG.line_mm_h1, TYPOG.h1_pt);
  b.pages[b.page_index].push(sch);
  b.inputs[sch.name] = String(text_str);
  b.cursor_y_mm += TYPOG.line_mm_h1;
}

function emitH2(b, text_str){
  ensureSpace(b, TYPOG.line_mm_h2);
  const sch = newSchema(b, COL.body_x_mm, b.cursor_y_mm, COL.body_w_mm, TYPOG.line_mm_h2, TYPOG.h2_pt);
  b.pages[b.page_index].push(sch);
  b.inputs[sch.name] = String(text_str);
  b.cursor_y_mm += TYPOG.line_mm_h2;
}

function emitBody(b, text_str){
  ensureSpace(b, TYPOG.line_mm_body);
  const sch = newSchema(b, COL.body_x_mm, b.cursor_y_mm, COL.body_w_mm, TYPOG.line_mm_body, TYPOG.body_pt);
  b.pages[b.page_index].push(sch);
  b.inputs[sch.name] = String(text_str);
  b.cursor_y_mm += TYPOG.line_mm_body;
}

function emitMono(b, text_str){
  ensureSpace(b, TYPOG.line_mm_mono);
  const sch = newSchema(b, COL.body_x_mm, b.cursor_y_mm, COL.body_w_mm, TYPOG.line_mm_mono, TYPOG.mono_pt);
  // pdfme's text plugin doesn't support a built-in mono font without
  // bundling one; we use Roboto (default) and rely on body padding.
  b.pages[b.page_index].push(sch);
  b.inputs[sch.name] = String(text_str);
  b.cursor_y_mm += TYPOG.line_mm_mono;
}

function emitMonoBlock(b, lines){
  for (const line of lines) emitMono(b, line);
}

function emitMonoRule(b){
  emitMono(b, '─'.repeat(80));
}

function emitGap(b, mm){
  ensureSpace(b, mm);
  b.cursor_y_mm += mm;
}

function emitFooter(b, exhibit){
  // Add a footer schema to every page.
  const footer_y = PAGE.height_mm - PAGE.margin_mm + 2;
  const stamp = `Genoa ${exhibit.method_versions?.engine || 'v2'} · generated ${new Date().toISOString()} · ${exhibit.exhibit_id || ''}`;
  for (let p = 0; p < b.pages.length; p++){
    const sch = newSchema(b, COL.body_x_mm, footer_y, COL.body_w_mm, 4, 7);
    b.pages[p].push(sch);
    b.inputs[sch.name] = `${stamp}    page ${p + 1} of ${b.pages.length}`;
  }
}

// ---------------------------------------------------------------------------
// formatters
// ---------------------------------------------------------------------------

function val(v){
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function num1(v){
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(1) : '—';
}

function ynNull(v){
  if (v === true)  return 'YES';
  if (v === false) return 'NO';
  return '—';
}

function pad(s, n){
  s = String(s);
  return s.length >= n ? s.slice(0, n - 1) + ' ' : s + ' '.repeat(n - s.length);
}

function truncate(s, n){
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export { PDF_PROVENANCE };
