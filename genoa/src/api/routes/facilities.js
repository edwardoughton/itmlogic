// Facility routes — read-only adapter into existing FCC data sources.
//
//   GET /api/facilities/search?q=KSLX
//   GET /api/facilities/:id
//
// Genoa never ingests FCC data here; it just calls the configured
// upstream (chelstein/zerotrustradio's broadcast endpoint, with optional
// n8n station/analyze fallback) and normalizes the row.  Hits are cached
// in genoa_facility_cache for 24h.
//
// If no source is reachable, a structured 503 with FACILITY_LOOKUP_UNAVAILABLE
// is returned and the warning is propagated into any compute() that
// references the facility_id.

import express from 'express';
import { sidecars } from '../services/sidecars.js';
import { getCached, putCached } from '../services/facilityCache.js';
import { asyncHandler } from '../middleware/errors.js';
import { W } from '../../types/warnings.js';

const r = express.Router();

r.get('/facilities/search', asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
  if (!q || q.length < 2){
    return res.status(400).json({ error: 'BAD_REQUEST', message: 'q must be at least 2 characters' });
  }
  if (!sidecars.facility){
    return res.status(503).json({
      error: 'FACILITY_LOOKUP_UNAVAILABLE',
      warning: W.make('FACILITY_LOOKUP_UNAVAILABLE',
        'No facility data source configured. Set ZERO_TRUST_RADIO_READONLY_URL or N8N_BASE_URL.'),
      rows: []
    });
  }
  const result = await sidecars.facility.searchByQuery(q, { limit });
  if (!result.source){
    return res.status(503).json({
      error: 'FACILITY_LOOKUP_UNAVAILABLE',
      warning: W.make('FACILITY_LOOKUP_UNAVAILABLE', result.error || 'no facility source reachable'),
      rows: []
    });
  }
  // Best-effort cache write for any rows that have a facility_id.
  for (const row of result.rows){
    if (row?.facility_id) putCached(row).catch(() => {});
  }
  res.json({ q, count: result.rows.length, source: result.source, rows: result.rows });
}));

r.get('/facilities/:id', asyncHandler(async (req, res) => {
  const id = String(req.params.id || '').trim();
  if (!id) return res.status(400).json({ error: 'BAD_REQUEST', message: 'facility_id required' });

  // 1. Cache.
  const cached = await getCached(id);
  if (cached?.facility){
    res.set('X-Genoa-Facility-Cache', 'hit');
    return res.json({ facility: cached.facility, source: cached.source, cached: true, fetched_at: cached.fetched_at });
  }

  // 2. Configured upstream.
  if (!sidecars.facility){
    return res.status(503).json({
      error: 'FACILITY_LOOKUP_UNAVAILABLE',
      warning: W.make('FACILITY_LOOKUP_UNAVAILABLE',
        'No facility data source configured. Set ZERO_TRUST_RADIO_READONLY_URL or N8N_BASE_URL.')
    });
  }
  const result = await sidecars.facility.getById(id);
  if (!result.facility){
    if (!result.source){
      return res.status(503).json({
        error: 'FACILITY_LOOKUP_UNAVAILABLE',
        warning: W.make('FACILITY_LOOKUP_UNAVAILABLE', result.error || 'no facility source reachable')
      });
    }
    return res.status(404).json({
      error: 'FACILITY_NOT_FOUND',
      facility_id: id,
      source: result.source,
      message: `facility ${id} not found in ${result.source}`
    });
  }
  await putCached(result.facility);
  res.set('X-Genoa-Facility-Cache', 'miss');
  res.json({ facility: result.facility, source: result.source, cached: false });
}));

export default r;
