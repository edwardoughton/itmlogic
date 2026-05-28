// PDF renderer for the engineering report — pdfkit-based, Letter size,
// 0.75" margins, Times-Roman 10.5pt body, Times-Bold 12pt section
// headers.  Output target: 4–7 pages for a typical exhibit, matching
// the visual density of a Hatfield-Dawson FCC filing.
//
// LAYOUT
//   Page 1     — cover (logo, title, station info card)
//   Page 2     — table of contents (auto-generated from bufferedPages)
//   Page 3+    — sections in continuous flow.  Each section starts with
//                a subtle amber rule + heading; the body flows under it.
//                addPage() only runs when remaining vertical space drops
//                below a threshold (avoid orphan headings) — never per
//                section.
//   Every page after the cover carries a header (station call · facility
//   ID · "FCC Propagation Studio") and a footer (compliance line · page
//   number) drawn in a final pass via bufferedPageRange.

import PDFDocument from 'pdfkit';

const PT_PER_INCH   = 72;
const MARGIN        = 0.75 * PT_PER_INCH;     // 54pt
const HEADER_AREA   = 30;                     // pt reserved at top for page header
const FOOTER_AREA   = 30;                     // pt reserved at bottom for page footer
const MIN_BLOCK     = 90;                     // min remaining height before a heading (orphan guard)
const RULE_GAP      = 4;                      // gap between section rule and heading
const SECTION_GAP   = 14;                     // vertical gap between sections

const BODY_FONT     = 'Times-Roman';
const BOLD_FONT     = 'Times-Bold';
const ITALIC_FONT   = 'Times-Italic';
const MONO_FONT     = 'Courier';
const BODY_SIZE     = 10.5;
const HEADING_SIZE  = 12;
const TITLE_SIZE    = 24;
const SUBTITLE_SIZE = 13;
const FOOTER_SIZE   = 8.5;

// Brand colors (matched to the workbench palette).
const AMBER     = '#c4745a';
const AMBER_HI  = '#f3c86d';
const TEAL_DARK = '#1c2e3a';
const TEXT_DIM  = '#666666';

const FOOTER_TEXT = 'Genoa FCC Propagation Studio';

// PDFKit's built-in Times-Roman / Helvetica / Courier fonts use WinAnsi
// encoding, which does NOT include arrow / dash / quote glyphs above
// U+007E.  When upstream section builders emit "→", "↔", smart quotes,
// etc., pdfkit silently substitutes garbage glyphs (we have seen
// "→" render as "!'" in filed exhibits — unacceptable for a
// customer-facing FCC document).  This fold maps the small set of
// Unicode chars that section builders actually emit down to ASCII
// equivalents the PDF font can render.  The plain-text export keeps
// the original Unicode (UTF-8 in .txt survives fine).
const PDF_UNICODE_FOLD = {
  '→': '->',    // → right arrow
  '←': '<-',    // ← left arrow
  '↔': '<->',   // ↔ left-right arrow
  '–': '-',     // – en dash
  '—': '--',    // — em dash
  '‘': "'",     // ‘
  '’': "'",     // ’
  '“': '"',     // “
  '”': '"',     // ”
  '…': '...',   // …
  // Greek letters that the section builders sometimes emit.  PDFKit's
  // base-14 Times-Roman uses WinAnsi encoding which has NO Greek
  // glyphs above U+007E; without these mappings the rendered output
  // is garbage AND the surrounding ASCII gets mangled because the
  // missing-glyph substitution shifts the content-stream byte
  // positions.  Add new letters here as section builders adopt them.
  'Δ': 'delta', // Δ (U+0394) — "max |Δ|" in parity outputs
  'δ': 'delta', // δ (U+03B4)
  'σ': 'sigma', // σ (U+03C3) — ground conductivity (when it leaks past the AM-only inputs)
  'π': 'pi',    // π (U+03C0)
  'μ': 'u',     // μ (U+03BC) — micro, e.g. µV/m
  'Ω': 'ohm',   // Ω (U+03A9)
  'λ': 'lambda',// λ (U+03BB) — wavelength
  'θ': 'theta', // θ (U+03B8) — angle
  'φ': 'phi',   // φ (U+03C6) — phase
  'ε': 'epsilon', // ε (U+03B5) — permittivity (NEC EPR)
  'Σ': 'Sigma',   // Σ (U+03A3) — RSS sum
  'α': 'alpha',   // α (U+03B1)
  'β': 'beta',    // β (U+03B2)
  'γ': 'gamma',   // γ (U+03B3)
  'ω': 'omega',   // ω (U+03C9) — angular frequency
  // Latin subscript letters (U+1D62…U+1D6A) — used for εᵣ, σᵧ, etc.
  // PDFKit base-14 fonts have no glyph and silently shift bytes when
  // encountered; adding them here keeps the content stream aligned.
  'ᵢ': '_i', 'ᵣ': '_r', 'ᵤ': '_u', 'ᵥ': '_v',
  'ₐ': '_a', 'ₑ': '_e', 'ₒ': '_o', 'ₓ': '_x',
  // Common technical glyphs that have crept into section builders.
  '²': '^2',  '³': '^3',  '⁻¹': '^-1', '½': '1/2',
  '·': '.',   // U+00B7 middle dot (we render KV separators with dots elsewhere)
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~=', '±': '+/-',
  '⋅': '.',
  '−': '-',   // U+2212 MINUS SIGN (not the ASCII hyphen) — base-14 fonts lack it
  '°': ' deg',
  'µ': 'u',   // U+00B5 micro sign (distinct from Greek μ U+03BC)
  '∞': 'inf'
};
function pdfSafeText(s){
  if (typeof s !== 'string') return s;
  return s.replace(
    /[→←↔–—‘’“”…ΔδσπμΩλθφεΣαβγωᵢᵣᵤᵥₐₑₒₓ²³½·≤≥≠≈±−⋅°µ∞]/g,
    (ch) => PDF_UNICODE_FOLD[ch] || ch
  );
}

export async function renderEngineeringReportPdf(doc){
  if (!doc || !Array.isArray(doc.sections)){
    throw new Error('renderEngineeringReportPdf: invalid document model');
  }
  const meta = doc.meta || {};
  const pdf = new PDFDocument({
    size:        'LETTER',
    margins:     { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: {
      Title:    meta.title || 'Engineering Statement',
      Author:   meta.generated_by || FOOTER_TEXT,
      Subject:  meta.station ? pdfSafeText(`FCC propagation study — ${meta.station}`) : 'FCC propagation study',
      Keywords: 'FCC, propagation, broadcast engineering, Genoa'
    }
  });
  // Route every text write through the Unicode-to-WinAnsi fold so the
  // base-14 PDF fonts never receive glyphs they cannot render.
  const _origText = pdf.text.bind(pdf);
  pdf.text = function patchedText(text, ...rest){
    return _origText(pdfSafeText(text), ...rest);
  };
  const chunks = [];
  pdf.on('data', c => chunks.push(c));
  const done = new Promise((resolve, reject) => {
    pdf.on('end',   () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });

  const tocEntries = [];
  const sections = doc.sections;

  if (sections[0]?.type === 'cover'){
    renderCover(pdf, sections[0], meta);
  }
  pdf.addPage();
  const tocPageIdx = pdf.bufferedPageRange().count - 1;
  pdf.addPage();

  for (let i = 0; i < sections.length; i++){
    const s = sections[i];
    if (s.type === 'cover') continue;
    if (i > 1) maybeBreak(pdf);
    if (s.heading){
      tocEntries.push({
        heading:        s.heading,
        exhibit_number: s.exhibit_number || null,
        sub:            isTocSub(s),
        pageIdx:        pdf.bufferedPageRange().count - 1
      });
    }
    renderSectionInFlow(pdf, s, meta);
  }

  pdf.switchToPage(tocPageIdx);
  renderToc(pdf, tocEntries);

  const range = pdf.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++){
    pdf.switchToPage(p);
    if (p > 0){
      drawPageHeader(pdf, meta);
    }
    drawPageFooter(pdf, meta, p, range.count);
  }

  pdf.end();
  return done;
}

function renderCover(pdf, s, meta){
  const w = pdf.page.width;
  const h = pdf.page.height;
  const cx = w / 2;

  const markY = MARGIN + 60;
  drawSailMark(pdf, cx, markY, 56);

  pdf.font(BOLD_FONT).fontSize(TITLE_SIZE).fillColor('black')
     .text((s.heading || 'ENGINEERING STATEMENT').toUpperCase(), MARGIN, markY + 90, {
        width: w - 2 * MARGIN, align: 'center'
     });
  pdf.moveDown(0.2);
  pdf.font(ITALIC_FONT).fontSize(SUBTITLE_SIZE).fillColor(TEXT_DIM)
     .text(meta?.subtitle || 'FCC Propagation Study', { align: 'center' });

  let y = pdf.y + 20;
  pdf.strokeColor(AMBER).lineWidth(1.5).moveTo(MARGIN + 100, y).lineTo(w - MARGIN - 100, y).stroke();
  y += 3;
  pdf.strokeColor(AMBER_HI).lineWidth(0.5).moveTo(MARGIN + 140, y).lineTo(w - MARGIN - 140, y).stroke();

  pdf.fillColor('black');
  const cardTop = h * 0.42;
  pdf.font(BOLD_FONT).fontSize(20).fillColor(TEAL_DARK)
     .text(meta?.station || '', MARGIN, cardTop, { width: w - 2 * MARGIN, align: 'center' });

  if (meta?.community){
    pdf.font(BODY_FONT).fontSize(11).fillColor(TEXT_DIM)
       .text(meta.community, { align: 'center' });
  }

  pdf.moveDown(1.2);
  pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor('black');
  renderKv(pdf, s.rows, { center: true, labelMin: 180, narrow: true });

  pdf.font(ITALIC_FONT).fontSize(10).fillColor(TEXT_DIM)
     .text(meta?.generated_by || FOOTER_TEXT, MARGIN, h - MARGIN - 40,
           { width: w - 2 * MARGIN, align: 'center' });
  pdf.font(BODY_FONT).fontSize(9)
     .text(`Generated ${meta?.generated_at || new Date().toISOString()}`,
           { align: 'center' });
}

function drawSailMark(pdf, cx, cy, size){
  const r = size / 2;
  pdf.save();
  pdf.circle(cx, cy, r).fillAndStroke(TEAL_DARK, AMBER);
  pdf.lineWidth(1.6).strokeColor('#f4eee0')
     .moveTo(cx - r * 0.32, cy - r * 0.83).lineTo(cx - r * 0.32, cy + r * 0.83).stroke();
  pdf.lineWidth(1.2).strokeColor('#6fd3ff')
     .moveTo(cx - r * 0.32, cy - r * 0.83).lineTo(cx - r * 0.32, cy - r * 0.55).stroke();
  pdf.lineWidth(1.1).strokeColor(TEAL_DARK)
     .moveTo(cx - r * 0.32, cy - r * 0.78)
     .bezierCurveTo(cx + r * 0.40, cy - r * 0.45,
                    cx + r * 0.78, cy + r * 0.13,
                    cx + r * 0.56, cy + r * 0.69)
     .lineTo(cx - r * 0.32, cy + r * 0.69)
     .closePath()
     .fillAndStroke(AMBER_HI, TEAL_DARK);
  pdf.restore();
  pdf.fillColor('black').strokeColor('black').lineWidth(1);
}

// Classify TOC entries that are visualizations or sub-parts of a parent
// section, so they render as indented sub-items instead of cluttering
// the contents with same-page top-level rows.  Charts/images, the AM
// "BACKGROUND --" educational blocks, the contour map, and mixed-case
// "Appendix X-n -- ..." sub-parts (top-level appendices are UPPERCASE)
// all fold under their parent.
function isTocSub(s){
  const t = s.type;
  if (t === 'polar-chart' || t === 'scatter-chart' || t === 'polygon-overlay'
      || t === 'visual-summary' || t === 'image') return true;
  const h = String(s.heading || '');
  if (!h) return false;
  if (/^background\b/i.test(h)) return true;
  if (h === 'Contour Map') return true;
  // Top-level appendices are emitted as "APPENDIX X -- ..." (uppercase
  // word); sub-parts as mixed-case "Appendix X-n -- ...".  Key on the
  // first word's case so titles with stray lowercase (e.g. "...8 km")
  // don't misclassify.
  if (/^Appendix\s/.test(h)) return true;
  return false;
}

function renderToc(pdf, entries){
  const w = pdf.page.width;
  pdf.fillColor('black');
  pdf.font(BOLD_FONT).fontSize(16)
     .text('CONTENTS', MARGIN, MARGIN + HEADER_AREA, { width: w - 2 * MARGIN });
  let y = pdf.y + 4;
  pdf.strokeColor(AMBER).lineWidth(0.8).moveTo(MARGIN, y).lineTo(w - MARGIN, y).stroke();
  pdf.y = y + 10;

  pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor('black');
  // Several short sections legitimately share a page, so print each page
  // number once — on the first entry that lands on it — instead of
  // repeating the same number down consecutive rows (which reads as a
  // duplication bug).  Entries are in render order, so pageIdx only
  // ever increases.
  let lastPage = null;
  for (const e of entries){
    const startY = pdf.y;
    const label = e.exhibit_number
      ? `Exhibit ${e.exhibit_number}.  ${e.heading}`
      : e.heading;
    const indent = e.sub ? 22 : 4;
    pdf.font(e.exhibit_number ? BOLD_FONT : BODY_FONT)
       .fillColor(e.sub ? '#555555' : 'black')
       .text(label, MARGIN + indent, startY, {
         width: w - 2 * MARGIN - 60 - indent, continued: false, lineBreak: false
       });
    pdf.fillColor('black');
    const pageNum = e.pageIdx + 1;
    if (pageNum !== lastPage){
      pdf.font(BOLD_FONT).text(String(pageNum), MARGIN, startY, {
        width: w - 2 * MARGIN - 4, align: 'right', lineBreak: false
      });
      lastPage = pageNum;
    }
    pdf.y = startY + 16;
  }
}

function maybeBreak(pdf){
  pdf.y = Math.max(pdf.y, MARGIN);
  const remaining = pdf.page.height - MARGIN - FOOTER_AREA - pdf.y;
  if (remaining < MIN_BLOCK){
    pdf.addPage();
  } else {
    pdf.y += SECTION_GAP;
  }
}

function renderSectionInFlow(pdf, s, meta){
  const w = pdf.page.width;
  // Chart types (polar-chart, scatter-chart, polygon-overlay,
  // visual-summary, image) call renderChartHeader() inside their own
  // pdf.addPage() context — meaning if we also draw the heading here,
  // it lands at the bottom of the prior page, addPage() bumps to a
  // fresh page, and the chart's own header re-renders, wasting the
  // intermediate page entirely (observed on WFMR page 23: just a
  // heading and nothing else).  Skip the in-flow heading for these
  // section types; their own header function is the single source.
  const CHART_TYPES = new Set(['polar-chart', 'scatter-chart',
                               'polygon-overlay', 'image', 'visual-summary']);
  const isChart = CHART_TYPES.has(s.type);
  if (s.heading && !isChart){
    const ruleY = pdf.y;
    pdf.strokeColor(AMBER).lineWidth(0.6)
       .moveTo(MARGIN, ruleY).lineTo(w - MARGIN, ruleY).stroke();
    pdf.y = ruleY + RULE_GAP;
    const headingText = s.exhibit_number
      ? `EXHIBIT ${s.exhibit_number} — ${s.heading.toUpperCase()}`
      : s.heading.toUpperCase();
    pdf.font(BOLD_FONT).fontSize(HEADING_SIZE).fillColor(TEAL_DARK)
       .text(headingText, MARGIN, pdf.y, {
         width: w - 2 * MARGIN, characterSpacing: 0.4
       });
    pdf.fillColor('black').moveDown(0.4);
  }
  switch (s.type){
    case 'kv':
      renderKv(pdf, s.rows);
      break;
    case 'paragraphs':
      renderParagraphs(pdf, s.paragraphs);
      break;
    case 'paragraphs-with-kv':
      renderParagraphs(pdf, s.paragraphs);
      pdf.moveDown(0.5);
      renderKv(pdf, s.rows);
      break;
    case 'table':
      if (s.preface){ renderParagraphs(pdf, [s.preface]); pdf.moveDown(0.5); }
      renderTable(pdf, s.table);
      break;
    case 'table-with-summary':
      if (s.preface){ renderParagraphs(pdf, [s.preface]); pdf.moveDown(0.5); }
      renderTable(pdf, s.table);
      if (s.summary){ pdf.moveDown(0.5); renderParagraphs(pdf, [s.summary]); }
      if (s.alternate){ pdf.moveDown(0.5); renderParagraphs(pdf, [s.alternate]); }
      break;
    case 'verdict':
      renderVerdict(pdf, s.verdict);
      break;
    case 'considerations':
      if (s.preface){ renderParagraphs(pdf, [s.preface]); pdf.moveDown(0.5); }
      if (Array.isArray(s.kvRows) && s.kvRows.length){
        renderKv(pdf, s.kvRows);
        pdf.moveDown(0.5);
      }
      if (s.summary){ renderParagraphs(pdf, [s.summary]); pdf.moveDown(0.5); }
      if (s.table) renderTable(pdf, s.table);
      break;
    case 'conclusion':
      renderConclusion(pdf, s);
      break;
    case 'certification':
      renderCertification(pdf, s);
      break;
    case 'image':
      renderImage(pdf, s);
      break;
    case 'polar-chart':
      renderPolarChart(pdf, s);
      break;
    case 'scatter-chart':
      renderScatterChart(pdf, s);
      break;
    case 'polygon-overlay':
      renderPolygonOverlay(pdf, s);
      break;
    case 'visual-summary':
      renderVisualSummary(pdf, s);
      break;
    default:
      if (Array.isArray(s.rows)) renderKv(pdf, s.rows);
      else if (Array.isArray(s.paragraphs)) renderParagraphs(pdf, s.paragraphs);
      else if (s.table) renderTable(pdf, s.table);
      break;
  }
}

function drawPageHeader(pdf, meta){
  const w = pdf.page.width;
  const y = MARGIN - 20;
  const m = pdf.page.margins;
  const saved = { top: m.top, bottom: m.bottom };
  m.top = 0; m.bottom = 0;
  pdf.save();
  pdf.font(BODY_FONT).fontSize(FOOTER_SIZE).fillColor(TEXT_DIM);
  const left  = `${meta?.station || ''}${meta?.facility_id ? '  ·  Facility ' + meta.facility_id : ''}`;
  const right = meta?.subtitle || 'FCC Propagation Study';
  pdf.text(left,  MARGIN, y, { width: (w - 2 * MARGIN) / 2, align: 'left',  lineBreak: false });
  pdf.text(right, MARGIN, y, { width:  w - 2 * MARGIN,      align: 'right', lineBreak: false });
  pdf.strokeColor(AMBER).lineWidth(0.4)
     .moveTo(MARGIN, y + 12).lineTo(w - MARGIN, y + 12).stroke();
  pdf.fillColor('black').strokeColor('black').lineWidth(1);
  pdf.restore();
  m.top = saved.top; m.bottom = saved.bottom;
}

function drawPageFooter(pdf, meta, pageNum, totalPages){
  const w = pdf.page.width;
  const h = pdf.page.height;
  const y = h - MARGIN + 14;
  const m = pdf.page.margins;
  const saved = { top: m.top, bottom: m.bottom };
  m.top = 0; m.bottom = 0;
  pdf.save();
  pdf.font(BODY_FONT).fontSize(FOOTER_SIZE).fillColor(TEXT_DIM);
  pdf.text(meta?.footer || FOOTER_TEXT, MARGIN, y,
           { width: w - 2 * MARGIN, align: 'left', lineBreak: false });
  pdf.text(`Page ${pageNum + 1} of ${totalPages}`, MARGIN, y,
           { width: w - 2 * MARGIN, align: 'right', lineBreak: false });
  pdf.fillColor('black').strokeColor('black');
  pdf.restore();
  m.top = saved.top; m.bottom = saved.bottom;
}

function renderKv(pdf, rows, opts = {}){
  if (!Array.isArray(rows)) return;
  const items = rows.filter(Boolean).map(r => Array.isArray(r) ? r : [r.label || r.key || '', r.value || '']);
  if (!items.length) return;
  const w   = pdf.page.width - 2 * MARGIN;
  const lw  = Math.min(opts.narrow ? 200 : 240,
                       Math.max(opts.labelMin || 60,
                                Math.max(...items.map(([k]) => textWidth(pdf, String(k), BOLD_FONT, BODY_SIZE))) + 12));
  pdf.fontSize(BODY_SIZE);
  for (const [k, v] of items){
    if (pageBottomReached(pdf)) pdf.addPage();
    const startY = pdf.y;
    pdf.font(BOLD_FONT).fillColor('black')
       .text(String(k), MARGIN, startY, { width: lw, continued: false });
    const keyEndY = pdf.y;
    pdf.font(BODY_FONT)
       .text(String(v == null ? '' : v), MARGIN + lw, startY, { width: w - lw });
    pdf.y = Math.max(keyEndY, pdf.y) + 1;
  }
}

function renderParagraphs(pdf, paragraphs){
  pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor('black');
  const w = pdf.page.width - 2 * MARGIN;
  for (const p of (paragraphs || [])){
    if (pageBottomReached(pdf)) pdf.addPage();
    pdf.text(String(p), MARGIN, pdf.y, { width: w, align: 'left' });
    pdf.moveDown(0.5);
  }
}

export function renderTable(pdf, table){
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return;
  const w = pdf.page.width - 2 * MARGIN;
  const cols = table.columns;
  const widths = cols.map(c => Math.max(40, Math.floor(w * (Number(c.width) || (1 / cols.length)))));

  // Ensure the header band + at least one row fit on the current page
  // before drawing.  drawTableHeader writes each column cell with its own
  // pdf.text() at a fixed y; when that y is near the page bottom PDFKit
  // auto-paginates per cell while x keeps accumulating, spilling one
  // column header per near-blank page (the §73.215 wide-table symptom).
  // Page-break up front so the whole header lands on one page instead.
  const HEADER_BLOCK = 84;
  if (pdf.y > pdf.page.height - MARGIN - FOOTER_AREA - HEADER_BLOCK){
    pdf.addPage();
  }

  drawTableHeader(pdf, cols, widths);
  pdf.font(BODY_FONT).fontSize(BODY_SIZE - 0.5);
  for (const r of table.rows){
    if (pdf.y > pdf.page.height - MARGIN - FOOTER_AREA - 30){
      pdf.addPage();
      drawTableHeader(pdf, cols, widths);
      pdf.font(BODY_FONT).fontSize(BODY_SIZE - 0.5);
    }
    let rx = MARGIN;
    const ry = pdf.y;
    let maxBottom = ry;
    for (let i = 0; i < cols.length; i++){
      pdf.text(formatCell(r[cols[i].key]), rx + 2, ry, {
        width: widths[i] - 4, align: cols[i].align || 'left'
      });
      maxBottom = Math.max(maxBottom, pdf.y);
      pdf.y = ry;
      rx += widths[i];
    }
    pdf.y = maxBottom + 1.5;
  }
  pdf.fontSize(BODY_SIZE);
}

function drawTableHeader(pdf, cols, widths){
  pdf.font(BOLD_FONT).fontSize(BODY_SIZE - 1).fillColor(TEAL_DARK);
  let x = MARGIN;
  const y = pdf.y;
  // Track the bottom of the tallest (multi-line-wrapped) header cell so
  // the underline rule and first data row clear ALL header lines.  Each
  // column write resets pdf.y back to the top of the header band, so a
  // wrapped-to-2-lines label like "D/U Req (dB)" would otherwise be
  // followed by data overlapping the second header line.  Mirrors the
  // maxBottom pattern in the row loop below.
  let maxBottom = y;
  for (let i = 0; i < cols.length; i++){
    pdf.text(cols[i].label || cols[i].key, x + 2, y, {
      width: widths[i] - 4, align: cols[i].align || 'left'
    });
    maxBottom = Math.max(maxBottom, pdf.y);
    pdf.y = y;
    x += widths[i];
  }
  const ruleY = maxBottom + 2;
  pdf.moveTo(MARGIN, ruleY).lineTo(MARGIN + widths.reduce((a, b) => a + b, 0), ruleY)
     .strokeColor(AMBER).lineWidth(0.5).stroke();
  pdf.strokeColor('black').fillColor('black');
  pdf.y = ruleY + 3;
}

function renderVerdict(pdf, v){
  if (!v) return;
  // Three-category headline replaces the single "Status / Confidence"
  // line, which produced contradictions like "UNVERIFIED / LOW"
  // immediately above "Curve validation (golden suite): PASS  36/36".
  // The three categories report orthogonal concerns: internal math,
  // external cross-check, filing decision.  When the verdict producer
  // didn't emit `categories` (older code path), fall back to the
  // legacy single line.
  const cats = v.categories;
  if (cats && cats.computational && cats.external && cats.filing){
    const rows = [
      ['COMPUTATIONAL VALIDATION',     cats.computational.status, cats.computational.detail],
      ['EXTERNAL PARITY VERIFICATION', cats.external.status,      cats.external.detail],
      ['FILING READINESS',             cats.filing.status,        cats.filing.detail]
    ];
    pdf.font(BOLD_FONT).fontSize(BODY_SIZE + 1).fillColor('black');
    for (const [label, status, detail] of rows){
      if (pageBottomReached(pdf)) pdf.addPage();
      pdf.font(BOLD_FONT).fontSize(BODY_SIZE + 1).fillColor('black')
         .text(`${label}: ${status}`);
      if (detail){
        pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor(TEXT_DIM)
           .text(detail, { indent: 14 });
        pdf.fillColor('black');
      }
      pdf.moveDown(0.15);
    }
    pdf.moveDown(0.4);
  } else {
    pdf.font(BOLD_FONT).fontSize(BODY_SIZE + 1).fillColor('black')
       .text(`Status: ${v.status || '—'}    Confidence: ${v.confidence || '—'}`);
    pdf.moveDown(0.4);
  }
  pdf.font(BODY_FONT).fontSize(BODY_SIZE);
  for (const c of (v.components || [])){
    if (pageBottomReached(pdf)) pdf.addPage();
    pdf.font(BOLD_FONT).text(`• ${c.name}: ${c.status}`, { continued: false });
    if (c.detail){
      pdf.font(BODY_FONT).text(c.detail, { indent: 14 });
    }
  }
  if (v.interpretation){
    pdf.moveDown(0.4);
    pdf.font(BODY_FONT).text(v.interpretation, { align: 'left' });
  }
  if (Array.isArray(v.limitations) && v.limitations.length){
    pdf.moveDown(0.4);
    pdf.font(BOLD_FONT).text('Limitations:');
    pdf.font(BODY_FONT);
    for (const l of v.limitations) pdf.text(`• ${l}`, { indent: 14 });
  }
}

function renderConclusion(pdf, s){
  pdf.font(BOLD_FONT).fontSize(BODY_SIZE + 1).fillColor(TEAL_DARK)
     .text(`Conclusion: ${(s.status || '').toString().toUpperCase()}`);
  pdf.fillColor('black').moveDown(0.4);
  pdf.font(BODY_FONT).fontSize(BODY_SIZE).text(s.narrative || '', { align: 'left' });
  if (Array.isArray(s.findings) && s.findings.length){
    pdf.moveDown(0.4);
    pdf.font(BOLD_FONT).text('Findings:');
    pdf.font(BODY_FONT);
    for (const f of s.findings){
      pdf.text(`• [${f.severity}] ${f.code}: ${f.message}`, { indent: 14 });
    }
  }
}

function renderCertification(pdf, s){
  if (s.sealed === true){
    if (s.statement){
      pdf.font(ITALIC_FONT).fontSize(BODY_SIZE).fillColor('black')
         .text(s.statement, { align: 'left' });
      pdf.moveDown(0.7);
    }
    renderKv(pdf, s.fields);
    if (s.footer){
      pdf.moveDown(0.7);
      pdf.font(BODY_FONT).fontSize(BODY_SIZE - 1).fillColor(TEXT_DIM)
         .text(s.footer, { align: 'left' });
      pdf.fillColor('black');
    }
  } else {
    if (s.boilerplate){
      pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor('black')
         .text(s.boilerplate, { align: 'left' });
      pdf.moveDown(0.8);
    }
    renderSignatureBlock(pdf, s.fields);
  }
}

// Professional engineer-of-record signature block.  Renders each field
// as a label + a ruled fill-in line (with any prefilled value sitting on
// the line), the way a consulting-engineer certification page reads —
// instead of a bare key/value list with empty values.  Pure layout; the
// field set + values come from sections/certification.js.
function renderSignatureBlock(pdf, fields){
  if (!Array.isArray(fields) || !fields.length) return;
  const pageW   = pdf.page.width;
  const leftX   = MARGIN;
  const rightEnd = pageW - MARGIN;
  const labelW  = 150;       // fixed gutter so every rule starts at the same x
  const rowGap  = 26;        // vertical space per signature row
  const lineDy  = 11;        // baseline offset of the rule below the label top

  for (const [label, value] of fields){
    if (pageBottomReached(pdf)) pdf.addPage();
    const rowY = pdf.y;
    // Label
    pdf.font(BOLD_FONT).fontSize(BODY_SIZE).fillColor(TEAL_DARK)
       .text(`${label}`, leftX, rowY, { width: labelW - 8, lineBreak: false });
    // Ruled fill-in line
    const lineX0 = leftX + labelW;
    const lineY  = rowY + lineDy;
    pdf.strokeColor('#999999').lineWidth(0.5)
       .moveTo(lineX0, lineY).lineTo(rightEnd, lineY).stroke();
    // Prefilled value (if any) sits just above the rule
    if (value != null && String(value).trim() !== ''){
      pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor('black')
         .text(String(value), lineX0 + 2, rowY + 1,
               { width: rightEnd - lineX0 - 4, lineBreak: false });
    }
    pdf.fillColor('black').strokeColor('black');
    pdf.y = rowY + rowGap;
  }
}

function pageBottomReached(pdf){
  return pdf.y > pdf.page.height - MARGIN - FOOTER_AREA - 12;
}

// Read PNG width × height from the IHDR chunk (bytes 16..23, big-endian).
// Returns null for any non-PNG / truncated input.  Used by renderImage()
// to size the figure frame to the actual image aspect ratio instead of
// trusting pdfkit's `fit:` option to set pdf.y for us (it doesn't —
// `fit:` preserves aspect but the surrounding layout has no idea what
// the resulting box height is, so the caption used to float ~250pt
// below a landscape contour map embedded on a portrait page).
function readPngSize(buf){
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) return null;
  const width  = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

// Render an image section.  `image_buffer` is a Node Buffer; pdfkit
// accepts it directly via pdf.image().  The contour map gets its own
// printable page with a thin survey-frame around the image and the
// caption anchored immediately below (no floating whitespace).
function renderImage(pdf, s){
  const buf = s.image_buffer;
  if (!buf || !Buffer.isBuffer(buf)){
    pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor(TEXT_DIM)
       .text('(image buffer missing)', { align: 'left' });
    return;
  }
  pdf.addPage();
  const pageW = pdf.page.width;
  if (s.heading){
    const ruleY = pdf.y;
    pdf.strokeColor(AMBER).lineWidth(0.6)
       .moveTo(MARGIN, ruleY).lineTo(pageW - MARGIN, ruleY).stroke();
    pdf.y = ruleY + RULE_GAP;
    const figurePrefix = s.figure_number ? `FIGURE ${s.figure_number} — ` : '';
    const headingText = s.exhibit_number
      ? `EXHIBIT ${s.exhibit_number} — ${s.heading.toUpperCase()}`
      : `${figurePrefix}${s.heading.toUpperCase()}`;
    pdf.font(BOLD_FONT).fontSize(HEADING_SIZE).fillColor(TEAL_DARK)
       .text(headingText, MARGIN, pdf.y, { width: pageW - 2 * MARGIN, characterSpacing: 0.4 });
    pdf.fillColor('black').moveDown(0.4);
  }
  const boxW   = pageW - 2 * MARGIN;
  const availH = pdf.page.height - pdf.y - MARGIN - FOOTER_AREA - 10;
  const dims   = readPngSize(buf);

  // Compute the actual draw box.  When we know the PNG's intrinsic
  // dimensions, scale to fit while preserving aspect ratio.  When we
  // don't (non-PNG or truncated header), fall back to the legacy fit
  // box so we never refuse to draw a valid image.
  let drawW, drawH;
  if (dims){
    const aspect = dims.width / dims.height;
    drawW = boxW;
    drawH = drawW / aspect;
    if (drawH > availH){
      drawH = availH;
      drawW = drawH * aspect;
    }
  } else {
    drawW = boxW;
    drawH = Math.max(220, availH);
  }
  const drawX = MARGIN + (boxW - drawW) / 2;
  const drawY = pdf.y;

  pdf.image(buf, drawX, drawY, { width: drawW, height: drawH });

  // Thin survey-style frame outlining the figure — ties the image
  // tightly to the page so it reads as an engineered figure rather
  // than a floating screenshot.
  pdf.save()
     .strokeColor(TEAL_DARK).lineWidth(0.75)
     .rect(drawX, drawY, drawW, drawH).stroke()
     .restore();

  pdf.y = drawY + drawH + 8;
  if (s.caption){
    pdf.font(ITALIC_FONT).fontSize(BODY_SIZE - 1).fillColor(TEXT_DIM)
       .text(s.caption, MARGIN, pdf.y, { width: boxW, align: 'left' });
    pdf.fillColor('black');
  }
  // Reserve the rest of the page for this figure so the next section
  // (typically visual-summary or another full-bleed block) starts on
  // a fresh page.  Without this, the visual-summary's compass-wheel
  // composition collided into the contour-map figure's
  // legend/provenance band, producing a visible overlap.  The
  // section loop's maybeBreak() reads pdf.y against the page bottom;
  // pushing pdf.y to the bottom guarantees a clean page break before
  // the next section renders.
  pdf.y = pdf.page.height - MARGIN - FOOTER_AREA;
}

// ────────────────────────────────────────────────────────────────────
// Vector charts — pure pdfkit primitives, no PNG round-trip, no
// external sidecar.  Data lives in exhibit.evidence and is shaped
// by the section builders.
// ────────────────────────────────────────────────────────────────────

function renderChartHeader(pdf, s){
  // Only add a fresh page when there isn't enough room left on the
  // current page for the chart itself.  The section loop's maybeBreak()
  // already does the "out of room" page-break before chart sections,
  // so calling addPage() unconditionally here produces a blank page
  // immediately after the section-loop-added one — visible in the WKNV
  // PDF as a blank page 19 between the NIF polar (18) and the canopy
  // rose (20).  Threshold ≈ 320 pt is enough for any chart + caption.
  const MIN_CHART_HEIGHT = 320;
  const remaining = pdf.page.height - MARGIN - FOOTER_AREA - pdf.y;
  if (remaining < MIN_CHART_HEIGHT) pdf.addPage();
  if (s.heading){
    const w = pdf.page.width;
    const ruleY = pdf.y;
    pdf.strokeColor(AMBER).lineWidth(0.6)
       .moveTo(MARGIN, ruleY).lineTo(w - MARGIN, ruleY).stroke();
    pdf.y = ruleY + RULE_GAP;
    const figurePrefix = s.figure_number ? `FIGURE ${s.figure_number} — ` : '';
    pdf.font(BOLD_FONT).fontSize(HEADING_SIZE).fillColor(TEAL_DARK)
       .text(`${figurePrefix}${s.heading.toUpperCase()}`, MARGIN, pdf.y, { width: w - 2 * MARGIN, characterSpacing: 0.4 });
    pdf.fillColor('black').moveDown(0.4);
  }
}

function renderChartCaption(pdf, s, captionY){
  if (!s.caption) return;
  const w = pdf.page.width - 2 * MARGIN;
  pdf.font(ITALIC_FONT).fontSize(BODY_SIZE - 1).fillColor(TEXT_DIM)
     .text(s.caption, MARGIN, captionY, { width: w, align: 'left' });
  pdf.fillColor('black');
}

// Polar chart — concentric range rings + radial spokes + the data
// polygon.  Used for AM-night NIF contour where data is an array of
// { azimuth_deg, distance_km } points spanning 0-360°.  Closes the
// polygon by repeating the first point at the end.
function renderPolarChart(pdf, s){
  renderChartHeader(pdf, s);
  const pts = Array.isArray(s.data) ? s.data : [];
  if (pts.length < 3){
    pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor(TEXT_DIM)
       .text('(insufficient data to render polar chart)', { align: 'left' });
    return;
  }
  const w = pdf.page.width  - 2 * MARGIN;
  const captionH = s.caption ? 48 : 8;
  const availH = pdf.page.height - pdf.y - MARGIN - FOOTER_AREA - captionH;
  const size   = Math.min(w, Math.max(260, availH));
  const cx     = MARGIN + w / 2;
  const cy     = pdf.y + size / 2;
  const radius = (size / 2) - 28;

  // Auto-scale to data max.
  let rMax = 0;
  for (const p of pts){
    const v = Number(p.value);
    if (Number.isFinite(v) && v > rMax) rMax = v;
  }
  if (s.r_max && s.r_max > rMax) rMax = s.r_max;
  if (rMax <= 0) rMax = 1;

  // Range rings — 4 concentric circles at 0.25 / 0.5 / 0.75 / 1.0 R.
  pdf.save();
  pdf.strokeColor('#888').lineWidth(0.3);
  for (let i = 1; i <= 4; i++){
    const r = radius * (i / 4);
    pdf.circle(cx, cy, r).stroke();
  }
  // Range ring labels — placed just INSIDE each ring along the east
  // axis so they never collide with the "E" cardinal label and never
  // get clipped by the page edge on the outermost ring.  Background-
  // tint padding box (1pt off-white) keeps them readable when they
  // sit on top of a filled polygon (e.g. the NIF or service-contour
  // polar plot).  Was: `cx + r + 2, cy - 4` outside the ring, which
  // pushed the outermost label past the chart frame (visible on WFMR
  // / WKNV PDFs as "B2.0 km" / "B50 km" with the leading digit cut).
  pdf.font(MONO_FONT).fontSize(7).fillColor(TEXT_DIM);
  for (let i = 1; i <= 4; i++){
    const r  = radius * (i / 4);
    const rv = rMax  * (i / 4);
    const txt = `${rv.toFixed(rv >= 100 ? 0 : 1)} ${s.r_unit || 'km'}`;
    const tw  = pdf.widthOfString(txt);
    pdf.text(txt, cx + r - tw - 4, cy + 4, { lineBreak: false });
  }

  // Compass spokes every 30°.
  pdf.strokeColor('#888').lineWidth(0.25);
  for (let az = 0; az < 360; az += 30){
    const rad = (az - 90) * Math.PI / 180;  // 0° = north (up)
    const x2 = cx + radius * Math.cos(rad);
    const y2 = cy + radius * Math.sin(rad);
    pdf.moveTo(cx, cy).lineTo(x2, y2).stroke();
  }
  // Cardinal labels.
  pdf.font(BOLD_FONT).fontSize(8).fillColor(TEAL_DARK);
  const labels = [['N',  0, -radius - 12], ['E',  radius + 6, -4],
                  ['S',  0,  radius + 4],  ['W', -radius - 14, -4]];
  for (const [lab, dx, dy] of labels){
    pdf.text(lab, cx + dx - 3, cy + dy, { lineBreak: false });
  }

  // Data polygon — close it.
  pdf.strokeColor(AMBER).lineWidth(1.2);
  pdf.fillColor(AMBER_HI).opacity(0.18);
  const fillPath = [];
  for (let i = 0; i < pts.length; i++){
    const az = Number(pts[i].azimuth_deg);
    const v  = Number(pts[i].value);
    if (!Number.isFinite(az) || !Number.isFinite(v) || v <= 0) continue;
    const r  = radius * (Math.min(v, rMax) / rMax);
    const rad = (az - 90) * Math.PI / 180;
    const x = cx + r * Math.cos(rad);
    const y = cy + r * Math.sin(rad);
    fillPath.push([x, y]);
  }
  if (fillPath.length){
    pdf.moveTo(fillPath[0][0], fillPath[0][1]);
    for (let i = 1; i < fillPath.length; i++){
      pdf.lineTo(fillPath[i][0], fillPath[i][1]);
    }
    pdf.closePath().fillAndStroke(AMBER_HI, AMBER);
  }
  pdf.opacity(1).fillColor('black').strokeColor('black');
  pdf.restore();

  pdf.y = cy + size / 2 + 6;
  renderChartCaption(pdf, s, pdf.y);
}

// Scatter chart — axes + grid + plotted points + optional tolerance
// band.  Used for FORTRAN parity (Δkm vs azimuth°).  data items:
// { x: number, y: number, ok?: boolean }.
function renderScatterChart(pdf, s){
  renderChartHeader(pdf, s);
  const pts = Array.isArray(s.data) ? s.data : [];
  if (pts.length === 0){
    pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor(TEXT_DIM)
       .text('(no data points to render)', { align: 'left' });
    return;
  }
  const w = pdf.page.width  - 2 * MARGIN;
  const captionH = s.caption ? 48 : 8;
  const availH = pdf.page.height - pdf.y - MARGIN - FOOTER_AREA - captionH;
  const plotW = w - 60;
  const plotH = Math.min(availH - 40, 360);
  const x0 = MARGIN + 50;
  const y0 = pdf.y + 8;

  // Compute scales.
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of pts){
    const x = Number(p.x), y = Number(p.y);
    if (Number.isFinite(x)){ if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
    if (Number.isFinite(y)){ if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
  }
  if (!Number.isFinite(xMin)){ xMin = 0; xMax = 1; }
  if (!Number.isFinite(yMin)){ yMin = -1; yMax = 1; }
  if (Number.isFinite(s.x_min)) xMin = s.x_min;
  if (Number.isFinite(s.x_max)) xMax = s.x_max;
  // Symmetric y-axis when caller passes y_symmetric (e.g. Δkm).
  if (s.y_symmetric){
    const m = Math.max(Math.abs(yMin), Math.abs(yMax), Number(s.tolerance) || 0);
    yMin = -m * 1.1; yMax = m * 1.1;
  }
  if (yMin === yMax){ yMin -= 1; yMax += 1; }
  const sx = (x) => x0 + plotW * (x - xMin) / Math.max(1e-9, xMax - xMin);
  const sy = (y) => y0 + plotH * (1 - (y - yMin) / Math.max(1e-9, yMax - yMin));

  pdf.save();
  // Plot frame.
  pdf.strokeColor('#888').lineWidth(0.4);
  pdf.rect(x0, y0, plotW, plotH).stroke();

  // Grid lines (5 horizontal, 6 vertical) + axis tick labels.
  pdf.strokeColor('#bbb').lineWidth(0.2);
  pdf.font(MONO_FONT).fontSize(7).fillColor(TEXT_DIM);
  for (let i = 1; i < 5; i++){
    const y = y0 + plotH * (i / 5);
    pdf.moveTo(x0, y).lineTo(x0 + plotW, y).stroke();
    const yv = yMin + (yMax - yMin) * (1 - i / 5);
    pdf.text(yv.toFixed(2), x0 - 36, y - 3, { width: 32, align: 'right', lineBreak: false });
  }
  for (let i = 1; i < 6; i++){
    const x = x0 + plotW * (i / 6);
    pdf.moveTo(x, y0).lineTo(x, y0 + plotH).stroke();
    const xv = xMin + (xMax - xMin) * (i / 6);
    pdf.text(xv.toFixed(0), x - 12, y0 + plotH + 4, { width: 24, align: 'center', lineBreak: false });
  }
  // Min/max tick labels.
  pdf.text(yMin.toFixed(2), x0 - 36, y0 + plotH - 3, { width: 32, align: 'right', lineBreak: false });
  pdf.text(yMax.toFixed(2), x0 - 36, y0 - 3,         { width: 32, align: 'right', lineBreak: false });
  pdf.text(xMin.toFixed(0), x0 - 12, y0 + plotH + 4, { width: 24, align: 'center', lineBreak: false });
  pdf.text(xMax.toFixed(0), x0 + plotW - 12, y0 + plotH + 4, { width: 24, align: 'center', lineBreak: false });

  // Tolerance band (when supplied).
  if (Number.isFinite(s.tolerance) && s.tolerance > 0){
    pdf.fillColor(AMBER_HI).opacity(0.12);
    const yTop = sy(s.tolerance);
    const yBot = sy(-s.tolerance);
    pdf.rect(x0, yTop, plotW, yBot - yTop).fill();
    pdf.opacity(1);
    pdf.strokeColor(AMBER).lineWidth(0.3).dash(3, { space: 2 });
    pdf.moveTo(x0, yTop).lineTo(x0 + plotW, yTop).stroke();
    pdf.moveTo(x0, yBot).lineTo(x0 + plotW, yBot).stroke();
    pdf.undash();
  }

  // Zero line.
  if (yMin < 0 && yMax > 0){
    pdf.strokeColor('#555').lineWidth(0.5);
    const yz = sy(0);
    pdf.moveTo(x0, yz).lineTo(x0 + plotW, yz).stroke();
  }

  // Axis labels.
  pdf.font(BODY_FONT).fontSize(8).fillColor(TEAL_DARK);
  if (s.x_label){
    pdf.text(s.x_label, x0, y0 + plotH + 18, { width: plotW, align: 'center', lineBreak: false });
  }
  if (s.y_label){
    pdf.save();
    pdf.rotate(-90, { origin: [x0 - 40, y0 + plotH / 2] });
    pdf.text(s.y_label, x0 - 40 - plotH / 2, y0 + plotH / 2 - 4,
             { width: plotH, align: 'center', lineBreak: false });
    pdf.restore();
  }

  // Plot points.
  for (const p of pts){
    const x = Number(p.x), y = Number(p.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const px = sx(x), py = sy(y);
    const ok = p.ok !== false;
    pdf.fillColor(ok ? AMBER : '#c0392b');
    pdf.circle(px, py, 1.6).fill();
  }
  pdf.fillColor('black').strokeColor('black');
  pdf.restore();

  pdf.y = y0 + plotH + (s.x_label ? 32 : 14);
  renderChartCaption(pdf, s, pdf.y);
}

// Polygon overlay — multiple lat/lon rings + tx marker + scale bar +
// north arrow.  Used for §73.314 terrain-aware coverage where we
// have both the §73.333 free-space contour ring AND the ITM terrain-
// adjusted ring and want to show how terrain warped the coverage.
//
// Section shape:
//   s.tx = { lat, lon }
//   s.polygons = [
//     { ring_latlng: [[lat, lon], ...], label, stroke, fill, fill_opacity, dashed }
//   ]
// Equirectangular projection centered on tx (good for <500 km exhibits;
// preserves direction-from-tx which is what matters for an FCC
// coverage map).  North is up; scale bar bottom-right; legend top-right.
function renderPolygonOverlay(pdf, s){
  renderChartHeader(pdf, s);
  const polys = Array.isArray(s.polygons) ? s.polygons.filter(p => Array.isArray(p?.ring_latlng) && p.ring_latlng.length >= 4) : [];
  const tx    = s.tx;
  if (polys.length === 0 || !tx || !Number.isFinite(Number(tx.lat)) || !Number.isFinite(Number(tx.lon))){
    pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor(TEXT_DIM)
       .text('(no polygons to render — tx coords or rings missing)', { align: 'left' });
    return;
  }
  const txLat = Number(tx.lat), txLon = Number(tx.lon);

  // Equirectangular: x = (lon - txLon) * cos(txLat) * km_per_deg_lon
  //                  y = (lat - txLat) * km_per_deg_lat
  const KM_PER_DEG_LAT = 111.32;
  const cosLat = Math.cos(txLat * Math.PI / 180);
  const KM_PER_DEG_LON = KM_PER_DEG_LAT * cosLat;
  const toKm = ([lat, lon]) => [
    (Number(lon) - txLon) * KM_PER_DEG_LON,
    (Number(lat) - txLat) * KM_PER_DEG_LAT
  ];

  // Find the bounding box in km space.
  let xMin = 0, xMax = 0, yMin = 0, yMax = 0;
  for (const p of polys){
    for (const v of p.ring_latlng){
      const [x, y] = toKm(v);
      if (Number.isFinite(x)){ if (x < xMin) xMin = x; if (x > xMax) xMax = x; }
      if (Number.isFinite(y)){ if (y < yMin) yMin = y; if (y > yMax) yMax = y; }
    }
  }
  // Add 10% padding + force square.
  const rangeX = Math.max(1, xMax - xMin);
  const rangeY = Math.max(1, yMax - yMin);
  const half   = Math.max(rangeX, rangeY) * 0.55;  // includes padding
  const cxKm = (xMin + xMax) / 2;
  const cyKm = (yMin + yMax) / 2;
  xMin = cxKm - half; xMax = cxKm + half;
  yMin = cyKm - half; yMax = cyKm + half;

  // Plot bounds in PDF space.
  const w = pdf.page.width - 2 * MARGIN;
  const captionH = s.caption ? 56 : 12;
  const availH = pdf.page.height - pdf.y - MARGIN - FOOTER_AREA - captionH;
  const plotSize = Math.min(w, Math.max(280, availH - 8));
  const x0 = MARGIN + (w - plotSize) / 2;
  const y0 = pdf.y + 4;
  const xScale = plotSize / (xMax - xMin);
  // y is FLIPPED in PDF space (y grows downward), so y up = larger lat
  const project = ([lat, lon]) => {
    const [xk, yk] = toKm([lat, lon]);
    return [
      x0 + (xk - xMin) * xScale,
      y0 + plotSize - (yk - yMin) * xScale
    ];
  };
  const txPt = project([txLat, txLon]);

  pdf.save();
  // Plot frame.
  pdf.strokeColor('#888').lineWidth(0.4);
  pdf.rect(x0, y0, plotSize, plotSize).stroke();
  // Bounding-box ticks (km).
  pdf.font(MONO_FONT).fontSize(7).fillColor(TEXT_DIM);
  for (let i = 1; i < 4; i++){
    const x = x0 + plotSize * (i / 4);
    const y = y0 + plotSize * (i / 4);
    pdf.strokeColor('#bbb').lineWidth(0.2);
    pdf.moveTo(x, y0).lineTo(x, y0 + plotSize).stroke();
    pdf.moveTo(x0, y).lineTo(x0 + plotSize, y).stroke();
  }
  // Crosshair at tx.
  pdf.strokeColor('#666').lineWidth(0.3).dash(2, { space: 2 });
  pdf.moveTo(txPt[0], y0).lineTo(txPt[0], y0 + plotSize).stroke();
  pdf.moveTo(x0, txPt[1]).lineTo(x0 + plotSize, txPt[1]).stroke();
  pdf.undash();

  // Polygons (back-to-front so first listed renders bottom-most).
  for (const p of polys){
    const path = p.ring_latlng.map(project);
    if (path.length < 3) continue;
    pdf.save();
    if (p.fill){
      pdf.fillColor(p.fill).opacity(Number.isFinite(p.fill_opacity) ? p.fill_opacity : 0.12);
      pdf.moveTo(path[0][0], path[0][1]);
      for (let i = 1; i < path.length; i++) pdf.lineTo(path[i][0], path[i][1]);
      pdf.closePath().fill();
      pdf.opacity(1);
    }
    pdf.strokeColor(p.stroke || AMBER).lineWidth(p.line_width || 1.0);
    if (p.dashed) pdf.dash(3, { space: 2 });
    pdf.moveTo(path[0][0], path[0][1]);
    for (let i = 1; i < path.length; i++) pdf.lineTo(path[i][0], path[i][1]);
    pdf.closePath().stroke();
    pdf.undash();
    pdf.restore();
  }

  // Tx marker.
  pdf.fillColor(TEAL_DARK).circle(txPt[0], txPt[1], 2.4).fill();
  pdf.fillColor('white').strokeColor(TEAL_DARK).lineWidth(0.4)
     .circle(txPt[0], txPt[1], 1.0).fillAndStroke();

  // North arrow (top-left of plot).
  const naX = x0 + 14;
  const naY = y0 + 14;
  pdf.strokeColor(TEAL_DARK).lineWidth(0.8).fillColor(TEAL_DARK);
  pdf.moveTo(naX, naY + 12).lineTo(naX, naY - 6).stroke();
  pdf.moveTo(naX - 4, naY - 2).lineTo(naX, naY - 6).lineTo(naX + 4, naY - 2).closePath().fill();
  pdf.font(BOLD_FONT).fontSize(8).text('N', naX - 3, naY + 14, { lineBreak: false });

  // Scale bar (bottom-right).  Choose a "round" km value ~25% of plot width.
  const targetKm = (xMax - xMin) * 0.25;
  const roundKm = roundScaleStep(targetKm);
  const barLenPdf = roundKm * xScale;
  const sbX = x0 + plotSize - 14 - barLenPdf;
  const sbY = y0 + plotSize - 14;
  pdf.strokeColor(TEAL_DARK).lineWidth(1.0);
  pdf.moveTo(sbX, sbY).lineTo(sbX + barLenPdf, sbY).stroke();
  pdf.moveTo(sbX, sbY - 3).lineTo(sbX, sbY + 3).stroke();
  pdf.moveTo(sbX + barLenPdf, sbY - 3).lineTo(sbX + barLenPdf, sbY + 3).stroke();
  pdf.font(MONO_FONT).fontSize(7).fillColor(TEXT_DIM)
     .text(`${roundKm} km`, sbX, sbY + 4, { width: barLenPdf, align: 'center', lineBreak: false });

  // Legend (top-right).
  const legendW = 130;
  const legX = x0 + plotSize - legendW - 10;
  const legY = y0 + 10;
  pdf.fillColor('white').opacity(0.85)
     .rect(legX - 4, legY - 4, legendW, 12 + polys.length * 12).fill();
  pdf.opacity(1);
  pdf.font(BODY_FONT).fontSize(7.5).fillColor(TEAL_DARK);
  let ly = legY;
  for (const p of polys){
    pdf.strokeColor(p.stroke || AMBER).lineWidth(1.2);
    if (p.dashed) pdf.dash(3, { space: 2 });
    pdf.moveTo(legX, ly + 3).lineTo(legX + 16, ly + 3).stroke();
    pdf.undash();
    pdf.fillColor(TEAL_DARK).text(p.label || '—', legX + 20, ly, { width: legendW - 22, lineBreak: false });
    ly += 12;
  }
  pdf.restore();
  pdf.fillColor('black').strokeColor('black');

  pdf.y = y0 + plotSize + 6;
  renderChartCaption(pdf, s, pdf.y);
}

// Choose a "round" scale-bar step (1, 2, 5, 10, 20, 50, …).
function roundScaleStep(km){
  if (!Number.isFinite(km) || km <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(km)));
  const n = km / pow;
  let mult;
  if (n < 1.5) mult = 1;
  else if (n < 3) mult = 2;
  else if (n < 7) mult = 5;
  else mult = 10;
  return mult * pow;
}

function formatCell(v){
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return String(v);
}

function textWidth(pdf, str, font, size){
  pdf.save();
  pdf.font(font).fontSize(size);
  const w = pdf.widthOfString(String(str));
  pdf.restore();
  return w;
}

// ────────────────────────────────────────────────────────────────────
// Visual Summary — the showpiece page.
//
// Composes the engineer's computed result into a single stylized
// vector composition: stacked service contours, population dot-
// density inside the primary contour, environmental tree-canopy
// halo at the transmitter site, oversized headline stats, advisory
// banner verbatim.  All pdfkit primitives; no PNG round-trip, no
// sidecar call at render time, fully deterministic across runs of
// the same exhibit (seeded PRNG for the dot scatter).
//
// Section data shape produced by sections/visualSummary.js.
// ────────────────────────────────────────────────────────────────────

function renderVisualSummary(pdf, s){
  if (!s || !Array.isArray(s.contours) || s.contours.length === 0) return;
  if (!s.tx || !Number.isFinite(s.tx.lat) || !Number.isFinite(s.tx.lon)) return;

  // Render the standard chart heading (heading text + "FIGURE N — "
  // prefix) so the TOC entry that references this page points at a
  // visibly-labeled surface.  Without this the visual-summary page
  // opens with the compass wheel only — an auditable-surface defect
  // (EVR-003): the FCC reviewer cannot navigate the exhibit because
  // the TOC entry "COVERAGE & ENVIRONMENT — VISUAL SUMMARY" maps to a
  // page whose body has no matching heading string.
  renderChartHeader(pdf, s);

  const w        = pdf.page.width - 2 * MARGIN;
  const startY   = pdf.y;
  // Reserve room for stats sidebar (right) + advisory banner (bottom).
  const STATS_W  = 168;
  const BANNER_H = 56;
  const FOOTER_H = 60;   // caption / provenance under everything
  const availH   = pdf.page.height - startY - MARGIN - FOOTER_AREA - BANNER_H - FOOTER_H;
  const plotW    = Math.max(280, w - STATS_W - 14);
  const plotH    = Math.min(availH, plotW);     // square
  const x0       = MARGIN;
  const y0       = startY + 4;

  // Establish a km projection centered on the transmitter.  Outermost
  // contour drives the bounds; pad 8% so labels don't kiss the frame.
  const outermost = s.contours[0].radius_km;
  const halfKm    = outermost * 1.08;
  const xMin = -halfKm, xMax = halfKm;
  const yMin = -halfKm, yMax = halfKm;
  const xScale = plotW / (xMax - xMin);
  const yScale = plotH / (yMax - yMin);
  // x grows east, y grows north (PDF y grows south so flip).
  const txCx   = x0 + plotW / 2;
  const txCy   = y0 + plotH / 2;
  const kmToPx = (km) => km * xScale;             // square; xScale==yScale

  pdf.save();

  // ── Background plate (warm cream rectangle so the rings pop) ────────
  pdf.fillColor('#fbf6e8').rect(x0, y0, plotW, plotH).fill();
  // Subtle compass grid (every 25% of the half-width).
  pdf.strokeColor('#e9dcb8').lineWidth(0.3);
  for (let i = 1; i <= 4; i++){
    const r = (halfKm * i) / 4;
    pdf.circle(txCx, txCy, kmToPx(r)).stroke();
  }
  // North-south + east-west cross.
  pdf.strokeColor('#e0d2a5').lineWidth(0.3);
  pdf.moveTo(txCx, y0).lineTo(txCx, y0 + plotH).stroke();
  pdf.moveTo(x0, txCy).lineTo(x0 + plotW, txCy).stroke();

  // ── Concentric service contours (back-to-front so city paints last) ─
  for (const c of s.contours){
    const px = kmToPx(c.radius_km);
    if (!(px > 0)) continue;
    pdf.save();
    pdf.fillColor(c.color).opacity(c.fill_opacity);
    pdf.circle(txCx, txCy, px).fill();
    pdf.opacity(1);
    pdf.strokeColor(c.color).lineWidth(c.is_dominant ? 1.4 : 0.9);
    if (c.dashed) pdf.dash(3, { space: 2 });
    pdf.circle(txCx, txCy, px).stroke();
    pdf.undash();
    pdf.restore();
  }

  // ── Population dot density inside the dominant (primary) contour ────
  // Deterministic seed: facility_id + tx call, so the same exhibit
  // re-rendered places dots identically (replay-stable visual).
  const dominant = s.contours.find(c => c.is_dominant)
                 || s.contours[s.contours.length - 1];
  if (s.population?.persons && dominant){
    const persons      = s.population.persons;
    // Honor the section builder's cap (visualSummary.js publishes
    // display_hints.max_dots).  This is a defense-in-depth re-check:
    // never let a huge-metro exhibit render the dominant ring as a
    // solid black disk regardless of upstream model state.
    const MAX_DOTS     = Math.max(60, Math.min(1200,
                          Number(s.display_hints?.max_dots) || 680));
    const peoplePerDot = Math.max(1, Math.ceil(persons / MAX_DOTS));
    const nDots        = Math.min(MAX_DOTS, Math.ceil(persons / peoplePerDot));
    const rPx          = kmToPx(dominant.radius_km);
    const seed         = `${s.tx.facility_id || s.tx.call || 'x'}|${persons}|${dominant.id}`;
    const rng          = mulberry32(hashStr(seed));
    pdf.save();
    pdf.fillColor('#1c2e3a').opacity(0.78);
    for (let i = 0; i < nDots; i++){
      // Uniform disk: r = R·√u, theta = 2π·v
      const r = rPx * Math.sqrt(rng());
      const t = 2 * Math.PI * rng();
      const dx = r * Math.cos(t);
      const dy = r * Math.sin(t);
      pdf.circle(txCx + dx, txCy + dy, 0.85).fill();
    }
    pdf.opacity(1);
    pdf.restore();
    // Stash for the legend (so the dot-ratio is documented).
    s.__people_per_dot = peoplePerDot;
    s.__n_dots         = nDots;
  }

  // ── Environmental tree canopy halo at the transmitter ───────────────
  // Halo is a thick ring around the tx, color graded by canopy density
  // (USFS TCC 0-100 %).  Green-scale from washed-out (low canopy) to
  // forest-deep (very dense).  Renders even when canopy is null — then
  // a neutral gray ring with "no coverage" label.
  if (s.canopy){
    const v = Number.isFinite(s.canopy.value_numeric) ? s.canopy.value_numeric : null;
    const ringColor = canopyColor(v);
    pdf.save();
    pdf.strokeColor(ringColor).lineWidth(2.6).opacity(0.85);
    pdf.circle(txCx, txCy, 9).stroke();
    pdf.opacity(1);
    pdf.restore();
  }

  // ── Transmitter marker (Genoa teal-dark with white center pip) ──────
  pdf.save();
  pdf.fillColor(TEAL_DARK).circle(txCx, txCy, 4.0).fill();
  pdf.fillColor('white').circle(txCx, txCy, 1.6).fill();
  pdf.restore();

  // ── North arrow (top-left) ──────────────────────────────────────────
  pdf.save();
  const naX = x0 + 14, naY = y0 + 18;
  pdf.strokeColor(TEAL_DARK).lineWidth(0.9).fillColor(TEAL_DARK);
  pdf.moveTo(naX, naY + 12).lineTo(naX, naY - 8).stroke();
  pdf.moveTo(naX - 4, naY - 3).lineTo(naX, naY - 8).lineTo(naX + 4, naY - 3).closePath().fill();
  pdf.font(BOLD_FONT).fontSize(8).fillColor(TEAL_DARK)
     .text('N', naX - 3, naY + 14, { lineBreak: false });
  pdf.restore();

  // ── Scale bar (bottom-left of plot) ─────────────────────────────────
  pdf.save();
  const targetKm = halfKm * 0.5;   // ~half the radius
  const roundKm = roundScaleStep(targetKm);
  const barLenPdf = kmToPx(roundKm);
  const sbX = x0 + 14;
  const sbY = y0 + plotH - 18;
  pdf.strokeColor(TEAL_DARK).lineWidth(1.0);
  pdf.moveTo(sbX, sbY).lineTo(sbX + barLenPdf, sbY).stroke();
  pdf.moveTo(sbX, sbY - 3).lineTo(sbX, sbY + 3).stroke();
  pdf.moveTo(sbX + barLenPdf, sbY - 3).lineTo(sbX + barLenPdf, sbY + 3).stroke();
  pdf.font(MONO_FONT).fontSize(7).fillColor(TEAL_DARK)
     .text(`${roundKm} km`, sbX, sbY + 4, { width: barLenPdf, align: 'center', lineBreak: false });
  pdf.restore();

  // ── Right sidebar: oversized headline stats + contour legend ────────
  const sbX0 = x0 + plotW + 14;
  let   sbY0 = y0;

  // STATION HEADER
  // Typography sizes come from section.display_hints (visualSummary.js)
  // so the section can re-tune the headline without a renderer change.
  const hints = s.display_hints || {};
  const callSize    = Number.isFinite(hints.station_label_size) ? hints.station_label_size : 20;
  const subSize     = Number.isFinite(hints.sub_label_size)     ? hints.sub_label_size     : 9;
  const statLblSize = Number.isFinite(hints.stat_label_size)    ? hints.stat_label_size    : 8;
  const statValSize = Number.isFinite(hints.stat_value_size)    ? hints.stat_value_size    : 22;
  const legendSize  = Number.isFinite(hints.legend_size)        ? hints.legend_size        : 8;
  pdf.save();
  pdf.font(BOLD_FONT).fontSize(callSize).fillColor(TEAL_DARK)
     .text(s.tx.call || '—', sbX0, sbY0, { width: STATS_W, lineBreak: false, ellipsis: true });
  sbY0 += callSize + 4;
  const subParts = [
    s.tx.community,
    s.tx.frequency,
    s.tx.service,
    s.tx.fcc_class ? `Class ${s.tx.fcc_class}` : null,
    Number.isFinite(s.tx.erp_kw) ? `${s.tx.erp_kw} kW` : null
  ].filter(Boolean);
  // Allow the subline to wrap (long community-of-license names overflow
  // the 168pt sidebar with lineBreak: false and were getting clipped).
  pdf.font(BODY_FONT).fontSize(subSize).fillColor(TEXT_DIM)
     .text(subParts.join(' · '), sbX0, sbY0, {
        width: STATS_W,
        lineBreak: hints.wrap_station_subline !== false,
        ellipsis: hints.wrap_station_subline === false
     });
  sbY0 = pdf.y + 10;
  pdf.restore();

  // ── PEOPLE stat tile ─────────────────────────────────────────────────
  if (s.population?.persons){
    pdf.save();
    pdf.fillColor('#1c2e3a').rect(sbX0, sbY0, STATS_W, 60).fill();
    pdf.font(BODY_FONT).fontSize(statLblSize).fillColor('#f3c86d')
       .text('PEOPLE INSIDE PRIMARY CONTOUR', sbX0 + 8, sbY0 + 6,
             { width: STATS_W - 16, characterSpacing: 0.6, lineBreak: false, ellipsis: true });
    pdf.font(BOLD_FONT).fontSize(statValSize).fillColor('white')
       .text(`~ ${fmtPersons(s.population.persons)}`, sbX0 + 8, sbY0 + 18,
             { width: STATS_W - 16, lineBreak: false, ellipsis: true });
    const srcLabel = [s.population.source, s.population.vintage].filter(Boolean).join(' · ');
    if (srcLabel){
      pdf.font(BODY_FONT).fontSize(7).fillColor('#a8b4be')
         .text(srcLabel, sbX0 + 8, sbY0 + 44, { width: STATS_W - 16, lineBreak: false, ellipsis: true });
    }
    pdf.restore();
    sbY0 += 70;
  }

  // ── ENVIRONMENT (canopy) stat tile ──────────────────────────────────
  // Shows the TX-point canopy value AND, when sampled, the rose summary
  // (min / max / mean at the rose distance).  The spread between point
  // and rose is the engineering signal — a TX on a clearing surrounded
  // by forest reads very differently from a uniformly open site.
  if (s.canopy){
    const v = s.canopy.value_numeric;
    const rose = s.canopy.rose;
    const tileH = rose ? 78 : 60;
    pdf.save();
    pdf.fillColor('#2c4a2d').rect(sbX0, sbY0, STATS_W, tileH).fill();
    pdf.font(BODY_FONT).fontSize(statLblSize).fillColor('#cfe9b6')
       .text('TREE CANOPY AT TRANSMITTER', sbX0 + 8, sbY0 + 6,
             { width: STATS_W - 16, characterSpacing: 0.6, lineBreak: false, ellipsis: true });
    pdf.font(BOLD_FONT).fontSize(statValSize).fillColor('white')
       .text(v == null ? '—' : `${v}%`, sbX0 + 8, sbY0 + 18,
             { width: STATS_W - 16, lineBreak: false, ellipsis: true });
    pdf.font(ITALIC_FONT).fontSize(7).fillColor('#cfe9b6')
       .text(s.canopy.interpretation || '', sbX0 + 8, sbY0 + 44,
             { width: STATS_W - 16, lineBreak: true, height: 14, ellipsis: true });
    if (rose){
      pdf.font(MONO_FONT).fontSize(6.5).fillColor('#cfe9b6')
         .text(`rose @ ${rose.distance_km} km  ·  min ${rose.min}  max ${rose.max}  mean ${rose.mean}`,
               sbX0 + 8, sbY0 + tileH - 14,
               { width: STATS_W - 16, lineBreak: false, ellipsis: true });
    }
    pdf.restore();
    sbY0 += tileH + 10;
  }

  // ── COVERAGE area stat tile ──────────────────────────────────────────
  const dominantArea = (s.contours.find(c => c.is_dominant) || s.contours[s.contours.length - 1])?.area_km2;
  if (Number.isFinite(dominantArea)){
    pdf.save();
    pdf.fillColor('#fbf6e8').rect(sbX0, sbY0, STATS_W, 50).fill();
    pdf.strokeColor('#c8843c').lineWidth(0.6).rect(sbX0, sbY0, STATS_W, 50).stroke();
    pdf.font(BODY_FONT).fontSize(8).fillColor('#8a4a1a')
       .text('PRIMARY CONTOUR AREA', sbX0 + 8, sbY0 + 6, { width: STATS_W - 16, characterSpacing: 0.6 });
    pdf.font(BOLD_FONT).fontSize(16).fillColor('#8a2a14')
       .text(`${fmtArea(dominantArea)} km²`, sbX0 + 8, sbY0 + 18, { width: STATS_W - 16, lineBreak: false });
    pdf.restore();
    sbY0 += 58;
  }

  // ── Contour legend ───────────────────────────────────────────────────
  pdf.save();
  pdf.font(BODY_FONT).fontSize(legendSize).fillColor(TEXT_DIM)
     .text('CONTOURS', sbX0, sbY0, { width: STATS_W, characterSpacing: 0.4 });
  sbY0 = pdf.y + 4;
  for (const c of s.contours.slice().reverse()){     // city first (warmest)
    pdf.save();
    pdf.strokeColor(c.color).lineWidth(c.is_dominant ? 1.4 : 0.9);
    if (c.dashed) pdf.dash(2.5, { space: 1.5 });
    pdf.moveTo(sbX0, sbY0 + 4).lineTo(sbX0 + 18, sbY0 + 4).stroke();
    pdf.undash();
    pdf.restore();
    // Strip parentheticals from the label so "60 dBu (1 mV/m service)"
    // becomes "60 dBu service".  The full string overflowed the
    // 144pt sidebar and pdfkit's lineBreak:false didn't suppress
    // wrapping when the text width physically exceeded the bounds —
    // result on WFMR PDF page 6 was a chopped legend with the
    // distance falling onto its own line and the next contour's
    // label crashing into it.
    const shortLabel = String(c.label || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
    const txt = `${shortLabel}  ·  ${c.radius_km.toFixed(1)} km`;
    pdf.font(MONO_FONT).fontSize(legendSize).fillColor('#2a3a48')
       .text(txt, sbX0 + 24, sbY0, { width: STATS_W - 24, lineBreak: false, ellipsis: true });
    sbY0 += 11;
  }
  pdf.restore();

  // People-per-dot legend (if dots were rendered)
  if (s.__n_dots){
    pdf.save();
    sbY0 += 4;
    pdf.font(BODY_FONT).fontSize(7).fillColor(TEXT_DIM)
       .text(`Each dot ≈ ${fmtPersons(s.__people_per_dot)} ${s.__people_per_dot === 1 ? 'person' : 'people'} · ${s.__n_dots} dots shown`,
             sbX0, sbY0, { width: STATS_W });
    pdf.restore();
  }

  pdf.restore();   // close the outer save() from the start of the function

  // ── Advisory banner (bottom, full width, verbatim posture) ──────────
  const bannerY = y0 + plotH + 10;
  pdf.save();
  pdf.fillColor('#1c2e3a').rect(x0, bannerY, w, BANNER_H).fill();
  pdf.fillColor('#f3c86d').rect(x0, bannerY, 4, BANNER_H).fill();      // amber accent stripe
  pdf.font(BOLD_FONT).fontSize(8).fillColor('#f3c86d')
     .text('ADVISORY · FILING EFFECT: NONE', x0 + 14, bannerY + 6,
           { width: w - 28, characterSpacing: 0.7 });
  pdf.font(BODY_FONT).fontSize(9).fillColor('#e8eef2')
     .text(s.advisory || 'Advisory only.  Does not modify FCC rule outputs.',
           x0 + 14, bannerY + 18, { width: w - 28 });
  pdf.restore();

  // ── Provenance footer (small print under the banner) ───────────────
  const footerY = bannerY + BANNER_H + 8;
  const provBits = [
    `tx ${Number(s.tx.lat).toFixed(4)}, ${Number(s.tx.lon).toFixed(4)}`,
    s.canopy?.dataset ? `canopy ${s.canopy.dataset}` : null,
    s.population?.source ? `population ${s.population.source}${s.population.vintage ? ' (' + s.population.vintage + ')' : ''}` : null,
    `contours per 47 CFR §73.184 / §73.333 (vendored gwave.js / tvfm_curves.js)`
  ].filter(Boolean);
  pdf.save();
  pdf.font(BODY_FONT).fontSize(7).fillColor(TEXT_DIM)
     .text(provBits.join(' · '), x0, footerY, { width: w, align: 'left' });
  pdf.restore();

  pdf.y = footerY + 18;
}

// ───── helpers for the visual summary ─────────────────────────────────

function fmtPersons(n){
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  if (x >= 1_000_000) return `${(x / 1_000_000).toFixed(x >= 10_000_000 ? 0 : 1)} M`;
  if (x >= 10_000)    return `${Math.round(x / 1000)} k`;
  if (x >= 1000)      return `${(x / 1000).toFixed(1)} k`;
  return x.toLocaleString('en-US');
}

function fmtArea(n){
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  if (x >= 100_000) return Math.round(x).toLocaleString('en-US');
  if (x >= 1000)    return Math.round(x).toLocaleString('en-US');
  return x.toFixed(1);
}

// USFS TCC canopy 0..100 → green-scale; null → neutral gray ring.
function canopyColor(v){
  if (v == null || !Number.isFinite(v)) return '#9aa4ac';
  // Anchor stops: 0=#d8e8c8 (pale), 20=#a7d39b, 40=#76c893, 60=#3aa05a, 80+=#1a6b34
  if (v <= 10) return '#d8e8c8';
  if (v <= 30) return '#a7d39b';
  if (v <= 50) return '#76c893';
  if (v <= 70) return '#3aa05a';
  return '#1a6b34';
}

// Deterministic 32-bit PRNG (mulberry32) seeded from a string hash so
// the same exhibit always paints dots in the same places (replay-stable).
function hashStr(s){
  let h = 2166136261 >>> 0;
  const str = String(s);
  for (let i = 0; i < str.length; i++){
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}
function mulberry32(a){
  return function(){
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t ^= (t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
