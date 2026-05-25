// Read-only curve dataset endpoint.  Pure provenance — no engine math.

import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CURVE_DIR, CURVE_VERSION, loadManifest } from '../../engine/curves/loader.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

r.get('/curves', asyncHandler(async (_req, res) => {
  const m = await loadManifest();
  res.set('Cache-Control', process.env.NODE_ENV === 'production' ? 'public, max-age=86400, immutable' : 'no-cache');
  res.json(m);
}));

r.get('/curves/:name', asyncHandler(async (req, res) => {
  const safe = String(req.params.name).replace(/[^a-z0-9_]/gi, '');
  const file = path.join(CURVE_DIR, safe + '.json');
  try {
    const buf = await fs.readFile(file);
    res.set('Cache-Control', process.env.NODE_ENV === 'production' ? 'public, max-age=86400, immutable' : 'no-cache');
    res.type('application/json').send(buf);
  } catch {
    res.status(404).json({ error: 'CURVE_NOT_FOUND', name: safe, version: CURVE_VERSION });
  }
}));

export default r;
