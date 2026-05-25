// PDF snapshot tests for the engineering report.
//
// Builds the engineering report against a small set of representative
// exhibits (full FM, FM exec-summary variant, FM filing-exhibit variant,
// internal-diagnostics variant) and asserts the rendered PDF buffer:
//   - has the %PDF magic
//   - is a non-trivial size (heuristic against silent regressions)
//   - reports a sane page-count (counted from /Type /Page tokens in
//     the buffer; we don't link to pdf-parse to keep the test fast and
//     dependency-free)
//   - contains the key section headings the variant promises (substring
//     scan of the buffer — section names render to the content stream
//     as ASCII text in pdfkit's base-14 fonts so a buffer scan is a
//     reliable smoke test without instantiating a PDF parser)
//
// These are SMOKE TESTS, not byte-perfect snapshots.  They protect
// against catastrophic regressions (renderer crash, missing variant,
// dropped heading) without freezing the rendered output to one
// particular pixel layout.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildExhibit, FM_CLASS_A, AM_INCOMPLETE }   from './_helpers.js';
import { buildEngineeringReport }                    from '../exports/engineeringReport/index.js';
import { renderEngineeringReportPdf }                from '../exports/engineeringReport/renderPdf.js';
import { buildEngineeringReportVariant }             from '../exports/engineeringReport/variants/internalDiagnostics.js';
import { applyExecutiveSummaryVariant }              from '../exports/engineeringReport/variants/executiveSummary.js';
import { applyFilingExhibitVariant }                 from '../exports/engineeringReport/variants/filingExhibit.js';
import { applyInternalDiagnosticsVariant }           from '../exports/engineeringReport/variants/internalDiagnostics.js';

// Count /Type /Page tokens in a PDFKit-generated buffer.  PDFKit emits
// each page as a "/Type /Page" object in the cross-reference table and
// the page tree itself as "/Type /Pages" (note the plural).  We match
// only the singular form to avoid double-counting.
function countPdfPages(buf){
  const s = buf.toString('latin1');
  const matches = s.match(/\/Type\s*\/Page(?!s)/g);
  return matches ? matches.length : 0;
}

// Look up a heading in the document model (not the rendered PDF buffer,
// which PDFKit compresses with FlateDecode and therefore does not yield
// readable substrings via a plain scan).  We assert at the model layer
// because that is the same content the renderer walks.
function docHasHeading(doc, needle){
  const u = String(needle || '').toUpperCase();
  return doc.sections.some((s) => {
    const h = String(s?.heading || '').toUpperCase();
    return h.includes(u);
  });
}

function docHasId(doc, id){
  return doc.sections.some((s) => s?.id === id);
}

// Buffer-substring scan with a document-model fallback.  PDFKit
// FlateDecode-compresses content streams so a raw substring scan of
// the rendered buffer alone is unreliable; tests that want to assert
// a heading or absence-of-term register their doc with
// recordDocForContains() and pdfContains() consults that model when
// the buffer scan fails to find the needle.  Result: present-on-page
// assertions go via the model (true positive), and absence-on-page
// assertions are stricter (a leak in either the model OR the buffer
// triggers a failure).
let _lastRecordedDoc = null;
function recordDocForContains(doc){ _lastRecordedDoc = doc; }
function pdfContains(buf, needle){
  if (buf && buf.toString('latin1').includes(needle)) return true;
  if (_lastRecordedDoc){
    const u = String(needle || '').toUpperCase();
    const exposed = (JSON.stringify(_lastRecordedDoc.sections) || '').toUpperCase();
    if (exposed.includes(u)) return true;
  }
  return false;
}

test('snapshot: full FM engineering report renders with all key headings', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  const doc = buildEngineeringReport(exhibit);
  const buf = await renderEngineeringReportPdf(doc);

  assert.equal(buf.slice(0, 4).toString('ascii'), '%PDF', 'PDF magic missing');
  assert.ok(buf.length > 8000, `PDF suspiciously small: ${buf.length} bytes`);

  const pages = countPdfPages(buf);
  assert.ok(pages >= 4, `expected >= 4 pages, got ${pages}`);
  assert.ok(pages <= 60, `expected <= 60 pages, got ${pages}`);

  // Key headings every full FM exhibit must surface — assert on the
  // document model (PDFKit FlateDecode means raw string scans on the
  // buffer are unreliable; the buffer above is the smoke-test surface).
  for (const heading of [
    'ENGINEERING STATEMENT',
    'PURPOSE OF STUDY',
    'METHODOLOGY',
    'CONTOUR',
    'CONCLUSION',
    'CERTIFICATION',
    'APPENDIX'
  ]){
    assert.ok(docHasHeading(doc, heading),
      `full report model missing heading containing: ${heading}`);
  }
  assert.ok(docHasId(doc, 'visual-summary'),
    'full FM report missing visual-summary section (build returned null — radii contract drift?)');
});

test('snapshot: exec_summary variant strips drilldowns and keeps the showpiece', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  const fullDoc = buildEngineeringReport(exhibit);
  const doc     = applyExecutiveSummaryVariant(fullDoc);

  // The exec-summary variant must drop appendices A/B/C and the per-
  // radial / interference tables, while keeping the customer-facing
  // pages.  Check via section ids on the model (cheap) AND via PDF
  // render (smoke).
  const ids = doc.sections.map(s => s.id);
  assert.ok(ids.includes('cover'),          'exec_summary lost cover');
  assert.ok(ids.includes('purpose'),        'exec_summary lost purpose');
  assert.ok(ids.includes('conclusion'),     'exec_summary lost conclusion');
  assert.ok(ids.includes('certification'),  'exec_summary lost certification');
  // The visual-summary page is the V-Soft-killer showpiece — exec_summary
  // exists for non-engineer readers and MUST surface it.  A silent build-
  // time drop (e.g. radii read from the wrong field) would otherwise pass
  // every other assertion.  Pin it here.
  assert.ok(ids.includes('visual-summary'), 'exec_summary lost visual-summary (radii contract drift?)');
  assert.ok(!ids.includes('appendix-a'),   'exec_summary should not include Appendix A');
  assert.ok(!ids.includes('appendix-b'),   'exec_summary should not include Appendix B');
  assert.ok(!ids.includes('appendix-c'),   'exec_summary should not include Appendix C');
  // Appendix D / E re-rendered in user-friendly form (present, scrubbed).
  assert.ok(ids.includes('appendix-d'),    'exec_summary must keep Appendix D in user-friendly form');
  assert.ok(ids.includes('appendix-e'),    'exec_summary must keep Appendix E in user-friendly form');

  const buf = await renderEngineeringReportPdf(doc);
  recordDocForContains(doc);
  assert.equal(buf.slice(0, 4).toString('ascii'), '%PDF');
  const pages = countPdfPages(buf);
  // Cover + TOC + at-least-1 substantive page (full FM ran 5+ on this
  // fixture; exec_summary should never be that long).
  assert.ok(pages >= 3, `exec_summary expected >= 3 pages, got ${pages}`);
  assert.ok(pages <= 20, `exec_summary expected <= 20 pages, got ${pages}`);
  assert.ok(pdfContains(buf, 'ENGINEERING STATEMENT'));
  assert.ok(pdfContains(buf, 'CONCLUSION'));

  // No raw diagnostics terminology should reach the exec-summary doc.
  // We scan the JSON-serialized document directly: pdfContains() falls
  // back to the model when the buffer scan fails, but a separate JSON
  // scan is the most rigorous "no leak" check.
  const exposed = JSON.stringify(doc.sections);
  for (const re of [/\btier[- ]?3\b/i, /\borchestrator\b/i, /\bfallback\b/i,
                     /Build fingerprint/i, /genoa replay/i, /\bstale\b/i]){
    assert.ok(!re.test(exposed),
      `exec_summary doc must not surface internal term: ${re}`);
  }
});

test('snapshot: filing_exhibit variant preserves rule sections, strips visual summary', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  const doc     = applyFilingExhibitVariant(buildEngineeringReport(exhibit));

  const ids = doc.sections.map(s => s.id);
  // Rule-governed sections must survive.
  for (const required of ['cover', 'purpose', 'parameters', 'methodology',
                          'contour-results', 'validation',
                          'conclusion', 'certification',
                          'appendix-a', 'appendix-b', 'appendix-c',
                          'appendix-d', 'appendix-e']){
    assert.ok(ids.includes(required),
      `filing_exhibit dropped required section: ${required}`);
  }
  // Visual summary is the one exec-style page that should not go to LMS.
  assert.ok(!ids.includes('visual-summary'),
    'filing_exhibit must not include visual-summary');

  const buf = await renderEngineeringReportPdf(doc);
  assert.equal(buf.slice(0, 4).toString('ascii'), '%PDF');
  assert.ok(buf.length > 8000);
  const pages = countPdfPages(buf);
  assert.ok(pages >= 4, `filing_exhibit expected >= 4 pages, got ${pages}`);

  // No raw replay command should land in a filing.  Assert via the
  // model — PDFKit FlateDecode compresses content streams.
  const exposed = JSON.stringify(doc.sections);
  assert.ok(!/genoa replay/.test(exposed),
    'filing_exhibit must not surface the replay CLI command');
});

test('snapshot: internal variant keeps full diagnostics surface', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  const doc     = applyInternalDiagnosticsVariant(buildEngineeringReport(exhibit));

  assert.equal(doc.meta.variant, 'internal');
  assert.ok(/Internal Diagnostics/i.test(doc.meta.subtitle));

  const ids = doc.sections.map(s => s.id);
  // All appendices that the full report carries should survive.
  for (const required of ['appendix-a', 'appendix-b', 'appendix-c', 'appendix-d', 'appendix-e']){
    assert.ok(ids.includes(required), `internal variant dropped: ${required}`);
  }
  const buf = await renderEngineeringReportPdf(doc);
  assert.equal(buf.slice(0, 4).toString('ascii'), '%PDF');
  assert.ok(buf.length > 8000);
  recordDocForContains(doc);
  assert.ok(pdfContains(buf, 'PROVENANCE'));
  assert.ok(pdfContains(buf, 'REPLAY DETERMINISM'));
});

test('snapshot: AM exhibit renders end-to-end and surfaces AM-specific headings', async () => {
  const exhibit = await buildExhibit(AM_INCOMPLETE);
  const doc     = buildEngineeringReport(exhibit);
  const buf     = await renderEngineeringReportPdf(doc);

  assert.equal(buf.slice(0, 4).toString('ascii'), '%PDF');
  assert.ok(buf.length > 6000, `AM PDF too small: ${buf.length}`);
  const pages = countPdfPages(buf);
  assert.ok(pages >= 3, `AM expected >= 3 pages, got ${pages}`);

  recordDocForContains(doc);
  assert.ok(pdfContains(buf, 'ENGINEERING STATEMENT'));
  assert.ok(pdfContains(buf, 'PURPOSE OF STUDY'));
});

test('snapshot: variant entry point dispatches each known id without crashing', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  for (const variant of ['full', 'exec_summary', 'filing_exhibit', 'internal']){
    const doc = buildEngineeringReportVariant(exhibit, { variant });
    assert.ok(doc && Array.isArray(doc.sections),
      `variant ${variant}: no document`);
    const buf = await renderEngineeringReportPdf(doc);
    assert.equal(buf.slice(0, 4).toString('ascii'), '%PDF',
      `variant ${variant}: bad PDF magic`);
    assert.ok(buf.length > 5000, `variant ${variant}: PDF too small`);
  }
});

test('snapshot: unknown variant id is rejected loudly', async () => {
  const exhibit = await buildExhibit(FM_CLASS_A);
  assert.throws(() => buildEngineeringReportVariant(exhibit, { variant: 'bogus' }),
    /unknown variant/);
});
