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
  'φ': 'phi'    // φ (U+03C6) — phase
};
function pdfSafeText(s){
  if (typeof s !== 'string') return s;
  return s.replace(/[→←↔–—‘’“”…ΔδσπμΩλθφ]/g,
                   ch => PDF_UNICODE_FOLD[ch] || ch);
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

function renderToc(pdf, entries){
  const w = pdf.page.width;
  pdf.fillColor('black');
  pdf.font(BOLD_FONT).fontSize(16)
     .text('CONTENTS', MARGIN, MARGIN + HEADER_AREA, { width: w - 2 * MARGIN });
  let y = pdf.y + 4;
  pdf.strokeColor(AMBER).lineWidth(0.8).moveTo(MARGIN, y).lineTo(w - MARGIN, y).stroke();
  pdf.y = y + 10;

  pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor('black');
  for (const e of entries){
    const startY = pdf.y;
    const label = e.exhibit_number
      ? `Exhibit ${e.exhibit_number}.  ${e.heading}`
      : e.heading;
    pdf.font(e.exhibit_number ? BOLD_FONT : BODY_FONT)
       .text(label, MARGIN + 4, startY, {
         width: w - 2 * MARGIN - 60, continued: false, lineBreak: false
       });
    pdf.font(BOLD_FONT).text(String(e.pageIdx + 1), MARGIN, startY, {
      width: w - 2 * MARGIN - 4, align: 'right', lineBreak: false
    });
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
  if (s.heading){
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

function renderTable(pdf, table){
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return;
  const w = pdf.page.width - 2 * MARGIN;
  const cols = table.columns;
  const widths = cols.map(c => Math.max(40, Math.floor(w * (Number(c.width) || (1 / cols.length)))));

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
  pdf.font(BOLD_FONT).fontSize(BODY_SIZE + 1).fillColor('black')
     .text(`Status: ${v.status || '—'}    Confidence: ${v.confidence || '—'}`);
  pdf.moveDown(0.4);
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
      pdf.moveDown(0.7);
    }
    renderKv(pdf, s.fields);
  }
}

function pageBottomReached(pdf){
  return pdf.y > pdf.page.height - MARGIN - FOOTER_AREA - 12;
}

// Render an image section.  `image_buffer` is a Node Buffer; pdfkit
// accepts it directly via pdf.image().  We force the image onto its
// own page so the contour map gets a clean print frame, and reserve
// ~80pt at the bottom for the caption + footer.
function renderImage(pdf, s){
  const buf = s.image_buffer;
  if (!buf || !Buffer.isBuffer(buf)){
    pdf.font(BODY_FONT).fontSize(BODY_SIZE).fillColor(TEXT_DIM)
       .text('(image buffer missing)', { align: 'left' });
    return;
  }
  pdf.addPage();
  if (s.heading){
    const w = pdf.page.width;
    const ruleY = pdf.y;
    pdf.strokeColor(AMBER).lineWidth(0.6)
       .moveTo(MARGIN, ruleY).lineTo(w - MARGIN, ruleY).stroke();
    pdf.y = ruleY + RULE_GAP;
    const headingText = s.exhibit_number
      ? `EXHIBIT ${s.exhibit_number} — ${s.heading.toUpperCase()}`
      : s.heading.toUpperCase();
    pdf.font(BOLD_FONT).fontSize(HEADING_SIZE).fillColor(TEAL_DARK)
       .text(headingText, MARGIN, pdf.y, { width: w - 2 * MARGIN, characterSpacing: 0.4 });
    pdf.fillColor('black').moveDown(0.4);
  }
  const w = pdf.page.width  - 2 * MARGIN;
  const captionH = s.caption ? 56 : 12;
  const availH = pdf.page.height - pdf.y - MARGIN - FOOTER_AREA - captionH;
  pdf.image(buf, MARGIN, pdf.y, { fit: [w, Math.max(220, availH)], align: 'center' });
  pdf.y = pdf.y + Math.max(220, availH) + 6;
  if (s.caption){
    pdf.font(ITALIC_FONT).fontSize(BODY_SIZE - 1).fillColor(TEXT_DIM)
       .text(s.caption, MARGIN, pdf.y, { width: w, align: 'left' });
    pdf.fillColor('black');
  }
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
