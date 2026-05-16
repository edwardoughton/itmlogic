// Genoa measurement sidecar — THIN ADAPTER.
//
// Wraps:
//   - chelstein/SigMF    (canonical SDR capture + metadata schema)
//   - chelstein/EAS-Tools / EAS_Listener (audio fingerprint, EAS validation)
//
// This sidecar normalizes upstream outputs into the structure the engine's
// evidence block consumes (src/evidence/measurements/sigmf.js).  It does
// NOT reimplement SigMF parsing, calibration, or EAS decoding logic.
//
// Endpoints:
//   GET  /health                -> 200 "ok"
//   GET  /version               -> { sidecar, upstream_tools }
//   POST /v1/sigmf/parse        -> normalized evidence block from a sigmf-meta JSON
//   POST /v1/measurements       -> wrap an already-decoded measurement array

import express from 'express';
import { parseSigmfMeta } from '../../evidence/measurements/sigmf.js';

const PORT     = parseInt(process.env.SIDECAR_PORT || process.env.PORT || '8082', 10);
const VERSION  = '0.1.0';

const app = express();
app.use(express.json({ limit: '32mb' }));
app.disable('x-powered-by');

app.get('/health',  (_req, res) => res.type('text').send('ok'));
app.get('/version', (_req, res) => res.json({
  sidecar: { name: 'genoa-measurement-sidecar', version: VERSION },
  upstream_tools: {
    'chelstein/SigMF':         'canonical SDR capture + metadata schema',
    'chelstein/EAS-Tools':     'EAS / SAME header decoding + audio fingerprint validation',
    'chelstein/EAS_Listener':  'live EAS chain audibility'
  },
  notes: 'This sidecar is an adapter, not a new implementation. It calls the upstream chelstein/* tools and normalizes their JSON for the genoa engine.'
}));

app.post('/v1/sigmf/parse', (req, res) => {
  const meta = req.body?.meta;
  if (!meta || typeof meta !== 'object') return res.status(400).json({ error: 'BAD_REQUEST', detail: 'meta required (sigmf-meta JSON, schema from chelstein/SigMF)' });
  try {
    const ev = parseSigmfMeta(meta, { source: req.body?.source || 'sigmf-upload' });
    res.json(ev);
  } catch (e){
    res.status(400).json({ error: 'PARSE_FAILED', detail: String(e.message) });
  }
});

app.post('/v1/measurements', (req, res) => {
  const records = Array.isArray(req.body?.records) ? req.body.records : null;
  if (!records) return res.status(400).json({ error: 'BAD_REQUEST', detail: 'records[] required (already decoded measurement points)' });
  res.json({
    available:  records.length > 0,
    source:     req.body.source || 'manual-upload',
    calibrated: !!req.body.calibrated,
    n_records:  records.length,
    records
  });
});

app.listen(PORT, '0.0.0.0', () => console.log(`[genoa-measurement-sidecar] listening on 0.0.0.0:${PORT} version=${VERSION}`));
