// LMS filing-package endpoints.
//
//   POST /api/exhibits/filing-package
//     body: { exhibit, applicant?: { engineer?: {...} } }
//     returns: { summary, filing_ready, fields[], json, html, plain_text, fields_csv, filename_stem }
//
//   GET  /api/exhibits/filing-package/cheatsheet?format=html|txt|csv|json
//     proxy that re-runs mapForm301Fm and emits the cheatsheet directly
//     as text/html or text/plain or text/csv or application/json.  Used
//     by the workbench "Download cheatsheet" button so the browser
//     drops a file straight into the user's downloads folder.
//
// Both routes are auth-gated by the requireAuth middleware mounted
// before any /api route in server.js.  Filing-package generation is
// pure (no DB, no network) — it just maps the supplied exhibit through
// the static FORM_301_FM_FIELDS schema.

import express from 'express';
import { buildFilingPackage } from '../../exports/lmsFiling/packager.js';
import { mapForm301Fm } from '../../exports/lmsFiling/mapping.js';
import { asyncHandler } from '../middleware/errors.js';
import { enrichTowerEvidence } from '../services/enrichTowerEvidence.js';

const r = express.Router();

// Late-binding ASR + FAA OE + tower-compliance enrichment lives in the
// shared services/enrichTowerEvidence.js helper so the engineering-
// statement PDF render path (jobRunner.js) gets the same data.

r.post('/exhibits/filing-package', asyncHandler(async (req, res) => {
  const exhibit  = req.body?.exhibit;
  const applicant = req.body?.applicant || {};
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'exhibit is required' });
  }
  await enrichTowerEvidence(exhibit, console);
  const pkg = buildFilingPackage(exhibit, applicant);
  res.json(pkg);
}));

// Direct download endpoint — Content-Disposition: attachment so
// browsers save instead of rendering inline.
r.post('/exhibits/filing-package/download', asyncHandler(async (req, res) => {
  const exhibit  = req.body?.exhibit;
  const applicant = req.body?.applicant || {};
  const format   = String(req.query?.format || req.body?.format || 'html').toLowerCase();
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'exhibit is required' });
  }
  await enrichTowerEvidence(exhibit, console);
  const pkg = buildFilingPackage(exhibit, applicant);
  const stem = pkg.filename_stem;
  const variants = {
    html: { mime: 'text/html; charset=utf-8',         body: pkg.html,        ext: 'html' },
    txt:  { mime: 'text/plain; charset=utf-8',         body: pkg.plain_text,  ext: 'txt'  },
    csv:  { mime: 'text/csv; charset=utf-8',           body: pkg.fields_csv,  ext: 'csv'  },
    json: { mime: 'application/json; charset=utf-8',   body: pkg.json,        ext: 'json' }
  };
  const v = variants[format] || variants.html;
  res.setHeader('Content-Type', v.mime);
  res.setHeader('Content-Disposition', `attachment; filename="${stem}.${v.ext}"`);
  res.send(v.body);
}));

// Lightweight summary endpoint (no body content, just counts).  Used
// by the FilingPackagePanel to render the readiness header without
// pulling 30KB of HTML on every state change.
r.post('/exhibits/filing-package/summary', asyncHandler(async (req, res) => {
  const exhibit  = req.body?.exhibit;
  const applicant = req.body?.applicant || {};
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'exhibit is required' });
  }
  await enrichTowerEvidence(exhibit, console);
  const m = mapForm301Fm(exhibit, applicant);
  res.json({
    form:           m.form,
    summary:        m.summary,
    filing_ready:   m.filing_ready,
    blockers_count: m.blockers_count,
    compliance_pass: m.compliance_pass,
    fields:         m.fields.map(({ derive, ...rest }) => rest)   // strip non-serializable derive fn
  });
}));

export default r;
