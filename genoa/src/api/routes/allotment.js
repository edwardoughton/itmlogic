// FM allotment / channel-search route.
//
//   POST /api/allotment/search
//     body: {
//       subject: { lat, lon, fcc_class, erp_kw?, haat_m? },
//       channels?:      number[] | 'all',
//       reserved_band?: boolean,
//       radius_km?:     200          // how far to scan for incumbent FMs
//     }
//     → 200 { ok, results: [...], n_available, n_blocked, ... }
//
// PIPELINE
//   1. Pull every full-service FM within `radius_km` of subject (LMS/FMQ).
//   2. Hand the proposed station + nearbyStations to searchAllotments(),
//      which iterates channels 200-300 and runs §73.207 / §73.215.
//   3. Return ranked results.
//
// We do NOT compute ground-conductivity / terrain for the candidate
// channels — the search engine assumes the operator's filed ERP/HAAT
// for §73.215 contour math, which is what V-Soft Probe5 also does.
// A subsequent exhibit-compute is the operator's path to a fileable
// design once they pick a channel.

import express from 'express';
import { searchAllotments } from '../../engine/allotmentSearch.js';
import { sidecars } from '../services/sidecars.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

const DEFAULT_SCAN_RADIUS_KM = 300;

r.post('/allotment/search', asyncHandler(async (req, res) => {
  const { subject = null, channels = 'all', reserved_band = true,
          radius_km = DEFAULT_SCAN_RADIUS_KM,
          options   = {} } = req.body || {};
  if (!subject || typeof subject !== 'object'){
    return res.status(400).json({ ok: false,
      error: 'body.subject required ({ lat, lon, fcc_class, erp_kw?, haat_m? })' });
  }
  if (!sidecars.facility?.getNearbyPrimaries){
    return res.status(503).json({ ok: false,
      error: 'facility client (LMS/FMQ) not configured — allotment search needs nearbyStations' });
  }
  // We scan channels 200-300, so the LMS query is service=FM agnostic
  // of which channel the subject will end up on.  Use 100.7 MHz as a
  // band-center anchor; getNearbyPrimaries returns all FMs within
  // radius regardless of channel (it returns the channel field too).
  const nb = await sidecars.facility.getNearbyPrimaries({
    lat: Number(subject.lat),
    lon: Number(subject.lon),
    frequency_mhz: 100.7,
    service: 'FM',
    radius_km: Number(radius_km) || DEFAULT_SCAN_RADIUS_KM,
    exclude_facility_id: subject.facility_id || null,
    // Request all relationships, not just the {co, ±1st, ±2nd, ±3rd, IF}
    // around a single anchor — allotment search needs everything.
    all_channels: true
  }).catch((e) => ({ available: false, error: String(e?.message || e) }));

  if (!nb?.available){
    return res.status(502).json({ ok: false,
      error: `nearby FMs unavailable: ${nb?.error || 'unknown'}` });
  }

  const search = searchAllotments({
    subject:       subject,
    nearbyStations: nb.primaries || [],
    channels, reserved_band, options
  });
  // Forward the upstream-source for provenance.
  search.upstream = { source: nb.source || 'fcc-fmq', n_nearby: (nb.primaries || []).length, radius_km };
  res.json(search);
}));

export default r;
