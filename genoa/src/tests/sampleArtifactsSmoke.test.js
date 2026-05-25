// Sample-artifacts smoke — full-stack render exercise.
//
// For each reference station defined in __samples__/*.json, do the
// full QA-relevant path:
//   1. Build an exhibit through the helper (engine + validation +
//      narrative).
//   2. Build the engineering report doc model.
//   3. Render the report to PDF (pdfkit).
//   4. Assert:
//        • PDF buffer is non-empty and begins with %PDF.
//        • Required appendices are present in the doc model.
//        • Page count falls within an expected band.
//        • For AM samples: the narrative doesn't carry FM HAAT input.
//
// The baselines under __samples__/ are intentionally SHAPE invariants,
// not byte-equal golden fixtures (Agent 2 owns those).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildExhibit } from './_helpers.js';
import { buildEngineeringReport }      from '../exports/engineeringReport/index.js';
import { renderEngineeringReportPdf }  from '../exports/engineeringReport/renderPdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.join(__dirname, '__samples__');

function loadSample(filename){
  const raw = fs.readFileSync(path.join(SAMPLES_DIR, filename), 'utf8');
  return JSON.parse(raw);
}

function inputsFromSample(s){
  const { invariants, notes, ...inputs } = s;
  return inputs;
}

// Count "/Type /Page" occurrences in the PDF buffer.  pdfkit writes
// each page as a "/Type /Page" object distinct from the "/Type /Pages"
// catalog, hence the [^s] negative lookbehind in the regex.
function countPages(buf){
  const text = buf.toString('latin1');
  return (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
}

const SAMPLE_FILES = ['kazm.json', 'wfan.json', 'wbob.json', 'kdus.json', 'fm.json'];

for (const file of SAMPLE_FILES){
  test(`sample artifact: ${file} renders full PDF without throwing`, async () => {
    const sample = loadSample(file);
    const inputs = inputsFromSample(sample);
    const exhibit = await buildExhibit(inputs);
    const doc = buildEngineeringReport(exhibit);
    const buf = await renderEngineeringReportPdf(doc);
    assert.ok(Buffer.isBuffer(buf), 'PDF must be a Buffer');
    assert.ok(buf.length > 1000, `PDF too small for ${file}: ${buf.length} bytes`);
    assert.equal(buf.slice(0, 4).toString('ascii'), '%PDF',
      `PDF magic missing in ${file}`);
  });

  test(`sample artifact: ${file} engineering report contains expected appendices`, async () => {
    const sample = loadSample(file);
    const exhibit = await buildExhibit(inputsFromSample(sample));
    const doc = buildEngineeringReport(exhibit);
    const ids = new Set(doc.sections.map(s => s.id));
    for (const required of sample.invariants?.must_contain_appendices || []){
      assert.ok(ids.has(required),
        `${file} engineering report is missing required appendix "${required}"; got ${[...ids].join(',')}`);
    }
  });

  test(`sample artifact: ${file} PDF page count falls within expected band`, async () => {
    const sample = loadSample(file);
    const band = sample.invariants?.page_count_band;
    if (!band) return;
    const exhibit = await buildExhibit(inputsFromSample(sample));
    const doc = buildEngineeringReport(exhibit);
    const buf = await renderEngineeringReportPdf(doc);
    const pages = countPages(buf);
    assert.ok(pages >= band.min && pages <= band.max,
      `${file} PDF page count ${pages} outside band [${band.min}, ${band.max}]`);
  });

  test(`sample artifact: ${file} contour + radial counts match baseline`, async () => {
    const sample = loadSample(file);
    const inv = sample.invariants || {};
    const exhibit = await buildExhibit(inputsFromSample(sample));
    if (Number.isFinite(inv.contour_count)){
      assert.equal(exhibit.contour_definitions.length, inv.contour_count,
        `${file}: contour_count drift`);
    }
    if (Number.isFinite(inv.radial_count)){
      assert.equal(exhibit.radial_table.length, inv.radial_count,
        `${file}: radial_count drift`);
    }
    if (Array.isArray(inv.expected_contour_ids)){
      const got = exhibit.contour_definitions.map(c => c.id);
      assert.deepEqual(got, inv.expected_contour_ids,
        `${file}: contour ids drifted`);
    }
  });

  test(`sample artifact: ${file} narrative is well-formed`, async () => {
    const sample = loadSample(file);
    const exhibit = await buildExhibit(inputsFromSample(sample));
    assert.ok(exhibit.narrative);
    assert.equal(typeof exhibit.narrative.text, 'string');
    assert.ok(exhibit.narrative.text.length > 200,
      `${file}: narrative too short (${exhibit.narrative.text.length} chars)`);
  });
}

test('AM sample wfan.json narrative reports HAAT as n/a (AM)', async () => {
  const sample = loadSample('wfan.json');
  const exhibit = await buildExhibit(inputsFromSample(sample));
  const m = exhibit.narrative.text.match(/HAAT\s*\(input\):\s*([^\n]+)/);
  assert.ok(m, 'AM exhibit should still render a HAAT line for the standard summary');
  assert.match(m[1], /n\/a\s*\(AM\)/, 'AM HAAT line must be the AM-specific n/a label');
  assert.doesNotMatch(m[1], /\d+(\.\d+)?\s*m\b/,
    'AM HAAT line MUST NOT carry a metre value (would indicate FM HAAT semantics leaking into AM)');
});

test('AM sample kdus.json narrative reports HAAT as n/a (AM)', async () => {
  const sample = loadSample('kdus.json');
  const exhibit = await buildExhibit(inputsFromSample(sample));
  const m = exhibit.narrative.text.match(/HAAT\s*\(input\):\s*([^\n]+)/);
  assert.ok(m, 'AM exhibit should still render a HAAT line for the standard summary');
  assert.match(m[1], /n\/a\s*\(AM\)/, 'AM HAAT line must be the AM-specific n/a label');
  assert.doesNotMatch(m[1], /\d+(\.\d+)?\s*m\b/,
    'AM HAAT line MUST NOT carry a metre value (would indicate FM HAAT semantics leaking into AM)');
});
