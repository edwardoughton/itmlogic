// Comparable-facility benchmarking route.
//
//   POST /api/comparables/fm
//     body: {
//       subject:        { lat, lon, fcc_class, erp_kw?, haat_m?, frequency_mhz? },
//       radius_km?:     300,
//       topK?:          20,
//       weights?:       { class, erp, haat, distance, band }
//     }
//     → 200 { ok, subject, reference, results: [...], stats, regulation }
//
// Pulls full-service FMs within radius_km from the existing
// facilityClient.getNearbyPrimaries (LMS/FMQ) and ranks them via
// the engine module.  Same fail-soft envelope as
// /api/allotment/search — 503 if the facility client isn't
// configured, 502 if the LMS fetch fails.

import express from 'express';
import { rankComparableFacilities } from '../../engine/comparableFacilities.js';
import { augmentRankingWithCoverage } from '../../engine/comparablesCoverage.js';
import { sidecars } from '../services/sidecars.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

const DEFAULT_RADIUS_KM = 300;

r.post('/comparables/fm', asyncHandler(async (req, res) => {
  const { subject = null,
          radius_km = DEFAULT_RADIUS_KM,
          topK = 20,
          weights } = req.body || {};
  if (!subject || typeof subject !== 'object'){
    return res.status(400).json({ ok: false,
      error: 'body.subject required ({ lat, lon, fcc_class, erp_kw?, haat_m? })' });
  }
  if (!sidecars.facility?.getNearbyPrimaries){
    return res.status(503).json({ ok: false,
      error: 'facility client (LMS/FMQ) not configured — comparable-facility benchmarking needs nearby FMs' });
  }
  // Anchor the query at 100.7 MHz; getNearbyPrimaries returns all
  // FMs within radius regardless of channel relationship when we
  // pass all_channels=true (mirrors /api/allotment/search).
  const nb = await sidecars.facility.getNearbyPrimaries({
    lat: Number(subject.lat),
    lon: Number(subject.lon),
    frequency_mhz: 100.7,
    service: 'FM',
    radius_km: Number(radius_km) || DEFAULT_RADIUS_KM,
    exclude_facility_id: subject.facility_id || null,
    all_channels: true
  }).catch((e) => ({ available: false, error: String(e?.message || e) }));

  if (!nb?.available){
    return res.status(502).json({ ok: false,
      error: `nearby FMs unavailable: ${nb?.error || 'unknown'}` });
  }

  const ranked = rankComparableFacilities({
    subject,
    candidates:    nb.primaries || [],
    weights,
    topK:          Number(topK) || 20,
    maxDistanceKm: Number(radius_km) || DEFAULT_RADIUS_KM
  });
  ranked.upstream = { source: nb.source || 'fcc-fmq',
                      n_nearby: (nb.primaries || []).length,
                      radius_km };
  res.json(ranked);
}));

// POST /api/comparables/fm/with-coverage
//   Same as /comparables/fm but ALSO fans actual SPLAT ITM coverage
//   for the proposed station + every comparator in parallel (bounded
//   by SPLAT_FANOUT_CONCURRENCY env, default 6).  The augmented
//   payload carries .coverage = { proposed, comparators[], stats } so
//   the engineer sees mean / min / max radial + service-area km² per
//   peer and can answer "how does my proposed coverage compare to
//   these 20 licensed peers' actual ITM rings?".
//
//   503 when SPLAT is unconfigured.  Each per-comparator failure is
//   contained — one slow station never fails the whole fan-out.
r.post('/comparables/fm/with-coverage', asyncHandler(async (req, res) => {
  const { subject = null,
          radius_km = DEFAULT_RADIUS_KM,
          topK = 20,
          weights,
          splat_options = {},
          concurrency } = req.body || {};
  if (!subject || typeof subject !== 'object'){
    return res.status(400).json({ ok: false,
      error: 'body.subject required ({ lat, lon, fcc_class, erp_kw, haat_m, frequency_mhz })' });
  }
  if (!sidecars.facility?.getNearbyPrimaries){
    return res.status(503).json({ ok: false,
      error: 'facility client (LMS/FMQ) not configured' });
  }
  if (!sidecars.splat?.predictItmCoverage){
    return res.status(503).json({ ok: false,
      error: 'SPLAT sidecar not configured (SPLAT_SIDECAR_URL unset)' });
  }
  const nb = await sidecars.facility.getNearbyPrimaries({
    lat: Number(subject.lat),
    lon: Number(subject.lon),
    frequency_mhz: 100.7,
    service: 'FM',
    radius_km: Number(radius_km) || DEFAULT_RADIUS_KM,
    exclude_facility_id: subject.facility_id || null,
    all_channels: true
  }).catch((e) => ({ available: false, error: String(e?.message || e) }));
  if (!nb?.available){
    return res.status(502).json({ ok: false,
      error: `nearby FMs unavailable: ${nb?.error || 'unknown'}` });
  }
  const ranked = rankComparableFacilities({
    subject,
    candidates:    nb.primaries || [],
    weights,
    topK:          Number(topK) || 20,
    maxDistanceKm: Number(radius_km) || DEFAULT_RADIUS_KM
  });
  const fanCap = Number(concurrency)
              || Number(process.env.SPLAT_FANOUT_CONCURRENCY)
              || 6;
  const augmented = await augmentRankingWithCoverage(ranked, {
    splatClient: sidecars.splat,
    proposedTx:  subject,
    concurrency: fanCap,
    splatOpts:   splat_options
  });
  augmented.upstream = { source: nb.source || 'fcc-fmq',
                         n_nearby: (nb.primaries || []).length,
                         radius_km };
  res.json(augmented);
}));

export default r;
