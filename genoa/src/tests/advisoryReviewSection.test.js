// buildAdvisoryReviewSection — pure render-shape tests (no network).

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvisoryReviewSection } from '../exports/engineeringReport/sections/advisoryReview.js';
import { buildExhibit, FM_CLASS_A } from './_helpers.js';
import { buildEngineeringReport } from '../exports/engineeringReport/index.js';
import { renderEngineeringReportText } from '../exports/engineeringReport/renderText.js';

test('returns null when no advisory_review is attached', () => {
  assert.equal(buildAdvisoryReviewSection({}, {}), null);
  assert.equal(buildAdvisoryReviewSection({}, { advisory_review: null }), null);
  assert.equal(buildAdvisoryReviewSection({}, { advisory_review: { available: false, reason: 'x' } }), null);
});

test('renders findings as advisory paragraphs with severity tags', () => {
  const sec = buildAdvisoryReviewSection({}, { advisory_review: {
    available: true, grounded: false, model: 'anthropic-claude-4.6-sonnet',
    findings: [
      { issue: 'READY but conclusion NON-COMPLIANT', severity: 'WARNING' },
      { issue: 'flat HAAT but varying per-radial distances', severity: 'INFO' }
    ]
  }});
  assert.equal(sec.type, 'paragraphs');
  assert.equal(sec.advisory, true);
  assert.match(sec.heading, /ADVISORY/);
  const blob = sec.paragraphs.join('\n');
  assert.match(blob, /does not modify/i);                 // disclaimer present
  assert.match(blob, /flagged 2 items/);
  assert.match(blob, /\[WARNING\] READY but conclusion NON-COMPLIANT/);
  assert.match(blob, /\[INFO\] flat HAAT/);
  assert.match(blob, /model: anthropic-claude-4\.6-sonnet/);
  assert.match(blob, /ungrounded/);
});

test('renders a clean-bill paragraph when findings are empty + notes grounding', () => {
  const sec = buildAdvisoryReviewSection({}, { advisory_review: {
    available: true, grounded: true, model: 'm', findings: []
  }});
  const blob = sec.paragraphs.join('\n');
  assert.match(blob, /no internal contradictions/i);
  assert.match(blob, /grounded in retrieved 47 CFR Part 73 text/);
});

test('integration: section appears in the full report only when a review is attached', async () => {
  const x = await buildExhibit(FM_CLASS_A);

  // Default render (no advisory pass) — section absent, report unchanged.
  const plain = buildEngineeringReport(x);
  assert.equal(plain.sections.find(s => s.id === 'advisory-review'), undefined);

  // With an attached review — section present, after certification.
  const withReview = buildEngineeringReport(x, { advisory_review: {
    available: true, grounded: false, model: 'anthropic-claude-4.6-sonnet',
    findings: [{ issue: 'READY but conclusion NON-COMPLIANT', severity: 'WARNING' }]
  }});
  const ids = withReview.sections.map(s => s.id);
  assert.ok(ids.includes('advisory-review'), 'advisory-review section missing');
  assert.ok(ids.indexOf('advisory-review') > ids.indexOf('certification'),
    'advisory-review must sit after the certification seal');

  const txt = renderEngineeringReportText(withReview);
  assert.match(txt, /ADVISORY — AUTOMATED EXHIBIT CONSISTENCY REVIEW/);
  assert.match(txt, /\[WARNING\] READY but conclusion NON-COMPLIANT/);
});
