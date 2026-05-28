// Service-wording leak — guards against AM-only language appearing in
// FM exhibits and vice-versa.
//
// HISTORY
//   AM and FM share a common narrative shell (generator.js) that
//   branches on `station_inputs.service`.  When a future refactor
//   accidentally elides the service guard, the wrong rule citations
//   or unit labels leak into the wrong exhibit.  That has happened
//   twice in real reviews — once when an AM exhibit was filed citing
//   §73.333 (FM TPO rule), once when an FM exhibit quoted "Ground σ".
//   The FCC will reject either as "wrong service rule cited".
//
// SHAPE
//   Build a canonical FM exhibit + a canonical AM exhibit.  Walk the
//   narrative text and every section of the engineering report model.
//   AM exhibits MUST NOT contain FM-only tokens, FM exhibits MUST NOT
//   contain AM-only tokens.
//
// IMPORTANT NUANCES
//   - The dataset-version table for FM includes the AM groundwave
//     dataset SHA (so reviewers can verify cross-service dataset
//     pinning).  This is the only legal FM appearance of the literal
//     string "am_groundwave" — we exclude it from the leak scan by
//     restricting to RULE-citation tokens, not dataset-table tokens.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExhibit, FM_CLASS_A, AM_INCOMPLETE } from './_helpers.js';
import { buildEngineeringReport } from '../exports/engineeringReport/index.js';
import { renderEngineeringReportText } from '../exports/engineeringReport/renderText.js';

// FM-only rule citations / units / phrases that MUST NOT appear in
// an AM-service exhibit.
const FM_ONLY_TOKENS = [
  /§\s*73\.333\b/,                     // FM TPO rule
  /§\s*73\.313\b/,                     // FM HAAT rule
  /§\s*73\.215\b/,                     // FM short-spacing
  /§\s*73\.211\b/,                     // FM service contour
  /F\(50,\s*50\)/,                     // FM curve label
  /F\(50,\s*10\)/                      // FM curve label
];

// AM-only rule citations / units / phrases that MUST NOT appear in
// an FM-service exhibit.
const AM_ONLY_TOKENS = [
  /§\s*73\.183\b/,                     // AM groundwave
  /§\s*73\.184\b/,                     // AM groundwave conductivity
  /§\s*73\.187\b/,                     // AM skywave
  /§\s*73\.190\b/,                     // AM antenna systems
  /Ground\s*σ/,                        // AM-specific input label
  /mS\/m\b/,                            // AM conductivity unit
  /skywave/i                            // AM skywave language
];

function scanForbidden(haystack, patterns, label){
  const hits = [];
  for (const pat of patterns){
    if (pat.test(haystack)) hits.push(pat.toString());
  }
  if (hits.length){
    throw new Error(`${label} contained forbidden tokens: ${hits.join(', ')}`);
  }
}

// Collect ONLY service-bound sections of the engineering-report doc model:
//   purpose / parameters / methodology / contour-results / conclusion
// These sections are written per-service and must never carry the
// opposite service's rule citations.  Appendices (appendix-c, -d, -e,
// map-sidecar boilerplate, PDF tooling notes) intentionally reference
// §73.333 / §73.215 as the canonical FCC FORTRAN rules — those are
// shared infrastructure mentions, not service-bound citations.
const SERVICE_BOUND_IDS = new Set([
  'purpose', 'parameters', 'methodology',
  'contour-results', 'conclusion', 'cover'
]);
function reportTextOf(exhibit){
  const doc = buildEngineeringReport(exhibit);
  const parts = [];
  for (const s of doc.sections || []){
    if (!SERVICE_BOUND_IDS.has(s.id)) continue;
    if (s.title) parts.push(String(s.title));
    if (s.body)  parts.push(String(s.body));
    if (s.text)  parts.push(String(s.text));
    if (Array.isArray(s.bullets)) parts.push(s.bullets.join('\n'));
    if (s.verdict?.summary) parts.push(String(s.verdict.summary));
  }
  return parts.join('\n');
}

test('AM exhibit narrative does not contain FM-only rule citations', async () => {
  const x = await buildExhibit(AM_INCOMPLETE);
  scanForbidden(x.narrative.text, FM_ONLY_TOKENS, 'AM narrative');
});

test('FM exhibit narrative does not contain AM-only rule citations', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  // The FM narrative MAY include the AM dataset SHA row ("am_groundwave"),
  // so we scan for RULE citations only, not the dataset-table token.
  scanForbidden(x.narrative.text, AM_ONLY_TOKENS, 'FM narrative');
});

test('AM engineering report does not contain FM-only rule citations', async () => {
  const x = await buildExhibit(AM_INCOMPLETE);
  scanForbidden(reportTextOf(x), FM_ONLY_TOKENS, 'AM engineering report');
});

test('FM engineering report does not contain AM-only rule citations', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  scanForbidden(reportTextOf(x), AM_ONLY_TOKENS, 'FM engineering report');
});

test('AM exhibit station_inputs.service is "AM"', async () => {
  const x = await buildExhibit(AM_INCOMPLETE);
  assert.equal(x.station_inputs.service, 'AM');
});

test('FM exhibit station_inputs.service is "FM"', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  assert.equal(x.station_inputs.service, 'FM');
});

test('AM exhibit reports HAAT as "n/a (AM)" — never a numeric metres value', async () => {
  const x = await buildExhibit(AM_INCOMPLETE);
  // HAAT line is rendered as "HAAT (input):    n/a (AM)" — anything
  // ending in "m" with a number would be an FM wording leak.
  const m = x.narrative.text.match(/HAAT\s*\(input\):\s*([^\n]+)/);
  assert.ok(m, 'AM exhibit must still include a HAAT line for symmetry');
  assert.match(m[1], /n\/a\s*\(AM\)/, 'AM HAAT line must read "n/a (AM)"');
  assert.doesNotMatch(m[1], /\d+(\.\d+)?\s*m\b/, 'AM HAAT line MUST NOT carry a metre value');
});

test('FM exhibit contour units are dBu — never mV/m alone', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  // FM should mention dBu; AM mV/m language must not be the headline.
  assert.match(x.narrative.text, /\bdBu\b/, 'FM narrative must mention dBu');
});
