// Plain-text renderer for the engineering report document model.
//
// 80-column hard wrap.  ASCII tables.  No emojis, no fancy unicode beyond the
// few symbols used by the section builders themselves (§, →, ², etc.).

const PAGE_WIDTH = 80;

export function renderEngineeringReportText(doc){
  if (!doc || !Array.isArray(doc.sections)){
    throw new Error('renderEngineeringReportText: invalid document model');
  }
  const out = [];
  out.push(headerBlock(doc.meta));
  for (const section of doc.sections){
    out.push('');
    out.push(renderSection(section));
  }
  out.push('');
  out.push(footerBlock(doc.meta));
  return out.join('\n') + '\n';
}

// ───────────────────────────── header / footer ──────────────────────────

function headerBlock(meta){
  const m = meta || {};
  const lines = [];
  lines.push('='.repeat(PAGE_WIDTH));
  lines.push(centerText((m.title || 'ENGINEERING STATEMENT').toUpperCase(), PAGE_WIDTH));
  if (m.subtitle) lines.push(centerText(m.subtitle, PAGE_WIDTH));
  lines.push(centerText(m.generated_by || 'Genoa FCC Propagation Studio', PAGE_WIDTH));
  lines.push('='.repeat(PAGE_WIDTH));
  return lines.join('\n');
}

function footerBlock(meta){
  const m = meta || {};
  const lines = [];
  lines.push('-'.repeat(PAGE_WIDTH));
  lines.push(`Generated: ${m.generated_at || new Date().toISOString()}   Engine: ${m.engine_version || '—'}`);
  lines.push(m.footer || 'Genoa FCC Propagation Studio');
  return lines.join('\n');
}

// ───────────────────────────── per-section ─────────────────────────────

function renderSection(s){
  const buf = [];
  if (s.heading){
    const headingText = s.exhibit_number
      ? `EXHIBIT ${s.exhibit_number} — ${s.heading}`
      : s.heading;
    buf.push(headingText);
    buf.push('-'.repeat(Math.min(PAGE_WIDTH, headingText.length)));
  }
  switch (s.type){
    case 'cover':
    case 'kv':
      buf.push(renderKv(s.rows));
      break;
    case 'paragraphs':
      buf.push(renderParagraphs(s.paragraphs));
      break;
    case 'paragraphs-with-kv':
      buf.push(renderParagraphs(s.paragraphs));
      buf.push('');
      buf.push(renderKv(s.rows));
      break;
    case 'table':
      if (s.preface){ buf.push(wrap(s.preface, PAGE_WIDTH)); buf.push(''); }
      buf.push(renderTable(s.table));
      break;
    case 'table-with-summary':
      if (s.preface){ buf.push(wrap(s.preface, PAGE_WIDTH)); buf.push(''); }
      buf.push(renderTable(s.table));
      if (s.summary){ buf.push(''); buf.push(wrap(s.summary, PAGE_WIDTH)); }
      if (s.alternate){ buf.push(''); buf.push(wrap(s.alternate, PAGE_WIDTH)); }
      break;
    case 'verdict':
      buf.push(renderVerdict(s.verdict));
      break;
    case 'considerations':
      if (s.preface){ buf.push(wrap(s.preface, PAGE_WIDTH)); buf.push(''); }
      if (Array.isArray(s.kvRows) && s.kvRows.length){
        buf.push(renderKv(s.kvRows));
        buf.push('');
      }
      if (s.summary){ buf.push(wrap(s.summary, PAGE_WIDTH)); buf.push(''); }
      if (s.table) buf.push(renderTable(s.table));
      break;
    case 'conclusion':
      buf.push(`Conclusion: ${s.status}`);
      buf.push('');
      buf.push(wrap(s.narrative || '', PAGE_WIDTH));
      if (Array.isArray(s.findings) && s.findings.length){
        buf.push('');
        buf.push('Findings:');
        for (const f of s.findings){
          buf.push(wrap(`  • [${f.severity}] ${f.code}: ${f.message}`, PAGE_WIDTH));
        }
      }
      break;
    case 'certification':
      if (s.sealed === true){
        if (s.statement){ buf.push(wrap(s.statement, PAGE_WIDTH)); buf.push(''); }
        buf.push(renderKv(s.fields));
        if (s.footer){ buf.push(''); buf.push(wrap(s.footer, PAGE_WIDTH)); }
      } else {
        if (s.boilerplate){ buf.push(wrap(s.boilerplate, PAGE_WIDTH)); buf.push(''); }
        buf.push(renderKv(s.fields));
      }
      break;
    default:
      // Unknown section types render their rows / paragraphs / table best-effort.
      if (Array.isArray(s.rows)) buf.push(renderKv(s.rows));
      else if (Array.isArray(s.paragraphs)) buf.push(renderParagraphs(s.paragraphs));
      else if (s.table) buf.push(renderTable(s.table));
      break;
  }
  return buf.join('\n');
}

function renderKv(rows){
  const items = (rows || []).filter(Boolean).map(r => Array.isArray(r) ? r : [r.label || r.key || '', r.value || '']);
  if (!items.length) return '';
  const labelWidth = Math.min(32, Math.max(...items.map(r => String(r[0]).length)) + 1);
  return items.map(([k, v]) => {
    const key = String(k).padEnd(labelWidth, ' ');
    const val = String(v == null ? '' : v);
    return wrapKv(key, val, PAGE_WIDTH);
  }).join('\n');
}

function renderParagraphs(paragraphs){
  return (paragraphs || []).map(p => wrap(p, PAGE_WIDTH)).join('\n\n');
}

function renderTable(table){
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return '';
  const cols = table.columns;
  const rows = table.rows;
  const widths = computeColumnWidths(cols, rows, PAGE_WIDTH);
  const sep    = widths.map(w => '-'.repeat(w)).join('  ');
  const header = cols.map((c, i) => padCell(c.label || c.key, widths[i], c.align)).join('  ');
  const lines  = [header, sep];
  for (const r of rows){
    lines.push(cols.map((c, i) => padCell(formatCell(r[c.key]), widths[i], c.align)).join('  '));
  }
  return lines.join('\n');
}

function renderVerdict(v){
  if (!v) return '';
  const buf = [];
  buf.push(`Status: ${v.status || '—'}    Confidence: ${v.confidence || '—'}`);
  buf.push('');
  if (Array.isArray(v.components)){
    for (const c of v.components){
      buf.push(`  • ${c.name}: ${c.status}`);
      if (c.detail) buf.push(wrap(`      ${c.detail}`, PAGE_WIDTH));
    }
  }
  if (v.interpretation){
    buf.push('');
    buf.push(wrap(v.interpretation, PAGE_WIDTH));
  }
  if (Array.isArray(v.limitations) && v.limitations.length){
    buf.push('');
    buf.push('Limitations:');
    for (const l of v.limitations) buf.push(wrap(`  • ${l}`, PAGE_WIDTH));
  }
  return buf.join('\n');
}

// ───────────────────────────── helpers ─────────────────────────────────

function computeColumnWidths(cols, rows, total){
  const inter = (cols.length - 1) * 2;
  const usable = Math.max(20, total - inter);
  const fromHints = cols.map(c => Math.max(3, Math.floor(usable * (Number(c.width) || (1 / cols.length)))));
  // Expand if any header/cell needs more.
  for (let i = 0; i < cols.length; i++){
    const headerLen = (cols[i].label || cols[i].key || '').length;
    const maxCell   = rows.reduce((m, r) => Math.max(m, formatCell(r[cols[i].key]).length), 0);
    fromHints[i] = Math.min(40, Math.max(fromHints[i], headerLen, maxCell));
  }
  return fromHints;
}

function formatCell(v){
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return String(v);
}

function padCell(s, w, align){
  const str = (s || '').slice(0, w);
  if (align === 'right') return str.padStart(w, ' ');
  return str.padEnd(w, ' ');
}

function centerText(s, width){
  const str = String(s || '');
  if (str.length >= width) return str;
  const pad = Math.floor((width - str.length) / 2);
  return ' '.repeat(pad) + str;
}

function wrap(text, width){
  const words = String(text || '').split(/(\s+)/);
  const lines = [];
  let line = '';
  for (const w of words){
    if (w === '\n'){ lines.push(line); line = ''; continue; }
    if ((line + w).length > width){
      if (line) lines.push(line.replace(/\s+$/, ''));
      line = w.replace(/^\s+/, '');
    } else {
      line += w;
    }
  }
  if (line) lines.push(line.replace(/\s+$/, ''));
  return lines.join('\n');
}

function wrapKv(keyPad, value, width){
  const indent = ' '.repeat(keyPad.length);
  const valWidth = Math.max(20, width - keyPad.length);
  const wrapped = wrap(value, valWidth).split('\n');
  return wrapped.map((ln, i) => (i === 0 ? keyPad + ln : indent + ln)).join('\n');
}
