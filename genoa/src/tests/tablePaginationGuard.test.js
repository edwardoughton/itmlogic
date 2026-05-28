// Regression: a wide table must not spill one column-header per page when
// it starts near the page bottom.  The §73.215 contour-protection table
// (9 columns) previously rendered each header cell on its own near-blank
// page because drawTableHeader writes each cell at a fixed y and PDFKit
// auto-paginates per cell when that y is in the bottom margin band.

import test from 'node:test';
import assert from 'node:assert/strict';
import PDFDocument from 'pdfkit';
import { renderTable } from '../exports/engineeringReport/renderPdf.js';

const COLS = [
  { key: 'call', label: 'Call', width: 0.10 },
  { key: 'rel',  label: 'Relationship', width: 0.10 },
  { key: 'a', label: 'D/U Req (dB)', width: 0.08, align: 'right' },
  { key: 'b', label: 'D/U Fwd (dB)', width: 0.08, align: 'right' },
  { key: 'c', label: 'D/U Rev (dB)', width: 0.08, align: 'right' },
  { key: 'd', label: 'S→N overlap (km²)', width: 0.11, align: 'right' },
  { key: 'e', label: 'N→S overlap (km²)', width: 0.11, align: 'right' },
  { key: 'p', label: 'Pass/Fail', width: 0.08 },
  { key: 'r', label: 'Binding constraint', width: 0.26 }
];
const ROWS = [{ call: 'KWCX-FM', rel: '2nd-adjacent', a: '-40', b: '-9.0', c: '-111.7', d: '0.00', e: '29.76', p: 'FAIL', r: 'fails' }];

function pagesFromY(startY){
  const pdf = new PDFDocument({ size: 'letter', margin: 54, bufferPages: true });
  pdf.on('data', () => {});
  pdf.y = startY;
  renderTable(pdf, { columns: COLS, rows: ROWS });
  const n = pdf.bufferedPageRange().count;
  pdf.end();
  return n;
}

test('wide table near the page bottom does not spill headers across pages', () => {
  // Letter page height 792pt, bottom margin 54pt: y >= ~730 lands the
  // header in the auto-pagination danger band.  Pre-fix this produced
  // ~11 pages (one per header column); the guard collapses it to 2.
  for (const y of [745, 730, 700]){
    const pages = pagesFromY(y);
    assert.ok(pages <= 2, `startY=${y} produced ${pages} pages (header spill regressed)`);
  }
});

test('wide table with ample room still renders on a single page', () => {
  assert.equal(pagesFromY(120), 1);
});
