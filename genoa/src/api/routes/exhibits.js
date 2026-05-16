import express from 'express';
import { computeExhibit, getOrRunValidation } from '../services/exhibitService.js';
import { saveExhibit, listExhibits, getExhibit, PersistenceUnavailable } from '../services/persistence.js';
import { asyncHandler } from '../middleware/errors.js';

import { exportJson, JSON_CONTENT_TYPE }       from '../../exports/json/exporter.js';
import { exportTxt,  TXT_CONTENT_TYPE  }       from '../../exports/txt/exporter.js';
import { exportGeoJson, GEOJSON_CONTENT_TYPE } from '../../exports/geojson/exporter.js';
import { serializeAmNightNifGeoJson } from '../../exports/geojson/amNightNif.js';
import { exportPdf,  PDF_CONTENT_TYPE  }       from '../../exports/pdf/exporter.js';

import { buildEngineeringReport }           from '../../exports/engineeringReport/index.js';
import { renderEngineeringReportText }      from '../../exports/engineeringReport/renderText.js';
import { renderEngineeringReportPdf }       from '../../exports/engineeringReport/renderPdf.js';
import { fetchMapRender }                   from '../../sidecars/mapClient.js';

import { readiness } from '../../types/readiness.js';

const r = express.Router();

// POST /api/exhibits/compute  — pure compute, no persistence.
r.post('/exhibits/compute', asyncHandler(async (req, res) => {
  if (!req.body || typeof req.body !== 'object') return res.status(400).json({ error: 'BAD_REQUEST', message: 'JSON body required' });
  const exhibit = await computeExhibit(req.body);
  res.json(exhibit);
}));

// POST /api/exhibits/save  — compute (if not already) and persist.
// EPHEMERAL FALLBACK: when the database is not configured (or an
// upstream returns HTML), persistence is unavailable.  Rather than
// crash the frontend on a non-JSON error response, this route ALWAYS
// returns JSON: it tries to persist, falls back to acknowledging an
// ephemeral session save, and never lets a JSON-parse error reach the
// UI.  This is the safety net behind /api/exhibits's strict path.
r.post('/exhibits/save', asyncHandler(async (req, res) => {
  let exhibit = req.body?.exhibit || req.body;
  if (!exhibit || !exhibit.station_inputs){
    // Caller passed a compute-style body { inputs, options } instead
    // of a full exhibit; compute first.
    try { exhibit = await computeExhibit(req.body || {}); }
    catch (e){
      return res.status(400).json({
        error:   'BAD_REQUEST',
        message: e.message || 'exhibit body required',
        mode:    'ephemeral',
        saved:   false
      });
    }
  }
  try {
    const saved = await saveExhibit(exhibit);
    return res.json({
      status:     'ok',
      saved:      true,
      mode:       'persisted',
      id:         saved.id,
      created_at: saved.created_at
    });
  } catch (e){
    // Persistence unavailable (no DATABASE_URL, DB down, etc).  Return
    // JSON acknowledging the ephemeral session — the UI will then
    // offer a local download.  NEVER let this surface as HTML.
    return res.json({
      status:    'ok',
      saved:     false,
      mode:      'ephemeral',
      message:   e.code === 'DB_UNAVAILABLE'
        ? 'Persistence unavailable (DATABASE_URL not configured).  Exhibit was held in this request only.'
        : `Persistence unavailable (${e.code || 'unknown'}: ${e.message}).  Exhibit was held in this request only.`,
      reason:    e.code || null
    });
  }
}));

// POST /api/exhibits  — backward-compat: persist a fully-formed exhibit.
r.post('/exhibits', asyncHandler(async (req, res) => {
  const exhibit = req.body;
  if (!exhibit || !exhibit.station_inputs) return res.status(400).json({ error: 'BAD_REQUEST', message: 'exhibit body required' });
  const saved = await saveExhibit(exhibit);
  res.json({ id: saved.id, created_at: saved.created_at });
}));

// GET /api/exhibits  — list.
r.get('/exhibits', asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 100;
  const rows = await listExhibits({ limit });
  res.json(rows);
}));

// GET /api/exhibits/:id
r.get('/exhibits/:id', asyncHandler(async (req, res) => {
  const row = await getExhibit(req.params.id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(row);
}));

// GET /api/exhibits/:id/readiness  — re-derive readiness from stored payload.
r.get('/exhibits/:id/readiness', asyncHandler(async (req, res) => {
  const row = await getExhibit(req.params.id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
  const exhibit = row.payload;
  const fr = readiness({ warnings: exhibit.warnings || [], exhibit });
  res.json({ exhibit_id: row.id, ...fr });
}));

// GET /api/exhibits/:id/export/json
r.get('/exhibits/:id/export/json', asyncHandler(async (req, res) => {
  const row = await getExhibit(req.params.id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
  const exhibit = row.payload;
  exhibit.exports = { ...(exhibit.exports || {}), json: 'rendered', generated_at: new Date().toISOString() };
  const body = exportJson(exhibit, { pretty: true });
  res.type(JSON_CONTENT_TYPE);
  res.set('X-Genoa-Exports-Generated-At', exhibit.exports.generated_at);
  res.set('Content-Disposition', `attachment; filename="${stem(row)}.exhibit.json"`);
  res.send(body);
}));

// GET /api/exhibits/:id/export/txt
r.get('/exhibits/:id/export/txt', asyncHandler(async (req, res) => {
  const row = await getExhibit(req.params.id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
  const exhibit = row.payload;
  exhibit.exports = { ...(exhibit.exports || {}), txt: 'rendered', generated_at: new Date().toISOString() };
  const body = exportTxt(exhibit);
  res.type(TXT_CONTENT_TYPE);
  res.set('X-Genoa-Exports-Generated-At', exhibit.exports.generated_at);
  res.set('Content-Disposition', `attachment; filename="${stem(row)}.exhibit.txt"`);
  res.send(body);
}));

// GET /api/exhibits/:id/export/geojson
r.get('/exhibits/:id/export/geojson', asyncHandler(async (req, res) => {
  const row = await getExhibit(req.params.id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
  const exhibit = row.payload;
  exhibit.exports = { ...(exhibit.exports || {}), geojson: 'rendered', generated_at: new Date().toISOString() };
  const body = exportGeoJson(exhibit, { pretty: true });
  res.type(GEOJSON_CONTENT_TYPE);
  res.set('X-Genoa-Exports-Generated-At', exhibit.exports.generated_at);
  res.set('Content-Disposition', `attachment; filename="${stem(row)}.contours.geojson"`);
  res.send(body);
}));

// GET /api/exhibits/:id/export/am-night-nif.geojson — AM nighttime
// NIF contour as a self-describing FeatureCollection.  Empty body
// with 404 when the exhibit doesn't carry am_night_nif evidence.
r.get('/exhibits/:id/export/am-night-nif.geojson', asyncHandler(async (req, res) => {
  const row = await getExhibit(req.params.id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
  const out = serializeAmNightNifGeoJson(row.payload, { pretty: true });
  if (!out.ok){
    return res.status(404).json({ error: 'NO_AM_NIGHT_NIF', detail: out.error });
  }
  res.type(out.content_type);
  res.set('Content-Disposition', `attachment; filename="${stem(row)}.am-night-nif.geojson"`);
  res.send(out.body);
}));

// GET /api/exhibits/:id/export/pdf  — filing-grade PDF via @pdfme/generator.
r.get('/exhibits/:id/export/pdf', asyncHandler(async (req, res) => {
  const row = await getExhibit(req.params.id);
  if (!row) return res.status(404).json({ error: 'NOT_FOUND' });
  const body = await exportPdf(row.payload);
  res.type(PDF_CONTENT_TYPE);
  res.set('Content-Disposition', `attachment; filename="${stem(row)}.exhibit.pdf"`);
  res.send(Buffer.from(body));
}));

// POST /api/exhibits/export/pdf  — stateless PDF render.
// Accepts the exhibit JSON in the request body; returns the PDF.
// Used by the UI in stateless mode (no DATABASE_URL, or user hasn't
// clicked Save).  Same renderer as the GET path above; just no
// persistence step.  Body shape:
//   { "exhibit": <full genoa.exhibit.v2 object> }
r.post('/exhibits/export/pdf', asyncHandler(async (req, res) => {
  const exhibit = req.body?.exhibit || req.body;
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({
      error:   'BAD_REQUEST',
      message: 'POST body must be an exhibit object (or { exhibit: <object> })'
    });
  }
  const body = await exportPdf(exhibit);
  res.type(PDF_CONTENT_TYPE);
  const call = (exhibit.station_inputs?.call || 'exhibit')
                 .toString().replace(/[^A-Za-z0-9]/g, '_');
  res.set('Content-Disposition', `attachment; filename="${call}.exhibit.pdf"`);
  res.send(Buffer.from(body));
}));

// POST /api/exhibits/export/engineering-report.txt  — consulting-grade TXT.
// Accepts an exhibit object (or { exhibit: <object> }) and returns the
// "Engineering Statement" plain-text rendering.  Stateless; never mutates
// the exhibit.
r.post('/exhibits/export/engineering-report.txt', asyncHandler(async (req, res) => {
  const exhibit = req.body?.exhibit || req.body;
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({
      error:   'BAD_REQUEST',
      message: 'POST body must be an exhibit object (or { exhibit: <object> })'
    });
  }
  const options = req.body?.options || {};
  const doc  = buildEngineeringReport(exhibit, options);
  const body = renderEngineeringReportText(doc);
  res.type(TXT_CONTENT_TYPE);
  res.set('Content-Disposition', `attachment; filename="${reportFilename(exhibit, 'txt')}"`);
  res.send(body);
}));

// POST /api/exhibits/export/engineering-report.pdf  — consulting-grade PDF.
r.post('/exhibits/export/engineering-report.pdf', asyncHandler(async (req, res) => {
  const exhibit = req.body?.exhibit || req.body;
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({
      error:   'BAD_REQUEST',
      message: 'POST body must be an exhibit object (or { exhibit: <object> })'
    });
  }
  const options = { ...(req.body?.options || {}) };
  // Fetch the contour-map render from the map sidecar before building
  // the report.  Fail-soft: when the sidecar is unset / unreachable /
  // times out, the map section emits a placeholder note.
  const png = await fetchMapRender(exhibit).catch(() => null);
  if (png) options.contour_map_png = png;
  const doc  = buildEngineeringReport(exhibit, options);
  const body = await renderEngineeringReportPdf(doc);
  res.type(PDF_CONTENT_TYPE);
  res.set('Content-Disposition', `attachment; filename="${reportFilename(exhibit, 'pdf')}"`);
  res.send(body);
}));

function reportFilename(exhibit, ext){
  const call = (exhibit?.station_inputs?.call || 'exhibit')
                 .toString().replace(/[^A-Za-z0-9]/g, '_');
  const ts   = new Date().toISOString().slice(0, 10);
  return `genoa-engineering-statement-${call}-${ts}.${ext}`;
}

// GET /api/validation  — current validation suite snapshot.
r.get('/validation', asyncHandler(async (_req, res) => {
  const v = await getOrRunValidation();
  res.json(v);
}));

function stem(row){
  return (row.call_sign || ('exhibit_' + row.id)).replace(/[^A-Z0-9]/gi, '_');
}

// Translate persistence-unavailable into a clean 503.
r.use((err, _req, res, next) => {
  if (err instanceof PersistenceUnavailable){
    return res.status(503).json({ error: err.code, message: err.message });
  }
  next(err);
});

export default r;
