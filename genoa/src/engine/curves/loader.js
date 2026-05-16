// Loads the immutable FCC curve dataset bundle from disk.
// Every exhibit pins the curve set version + per-dataset sha256 hashes
// from manifest.json so a re-run on a different machine, with a different
// curve revision, will produce a different answer rather than a silent
// drift.  Bumping a curve = bumping CURVE_VERSION below.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

export const CURVE_VERSION = 'v0.2';
export const CURVE_DIR     = path.resolve(__dirname, '../../../data/fcc-curves', CURVE_VERSION);

let _manifest = null;
const _datasets = new Map();

export async function loadManifest(){
  if (_manifest) return _manifest;
  const raw = await fs.readFile(path.join(CURVE_DIR, 'manifest.json'), 'utf8');
  _manifest = { version: CURVE_VERSION, ...JSON.parse(raw) };
  return _manifest;
}

export async function loadDataset(name){
  if (_datasets.has(name)) return _datasets.get(name);
  const safe = String(name).replace(/[^a-z0-9_]/gi, '');
  const data = JSON.parse(await fs.readFile(path.join(CURVE_DIR, safe + '.json'), 'utf8'));
  _datasets.set(name, data);
  return data;
}

export async function curveProvenance(){
  const m = await loadManifest();
  return {
    curve_version:   m.version,
    meta_sha256:     m.meta_sha256,
    dataset_sha256:  m.datasets,
    source_dir:      path.relative(process.cwd(), CURVE_DIR)
  };
}
