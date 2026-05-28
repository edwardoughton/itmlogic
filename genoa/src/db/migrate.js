// Idempotent migration runner.  Reads every file in ./migrations in
// lexicographic order and executes it as one statement.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, poolReady } from './pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function migrate(){
  if (!poolReady()){
    console.warn('[genoa] migrate: DATABASE_URL not set; skipping');
    return { applied: [], skipped: 'no DATABASE_URL' };
  }
  const dir = path.join(__dirname, 'migrations');
  const files = (await fs.readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  const applied = [];
  for (const f of files){
    const sql = await fs.readFile(path.join(dir, f), 'utf8');
    await pool().query(sql);
    applied.push(f);
  }
  return { applied };
}

if (import.meta.url === `file://${process.argv[1]}`){
  migrate().then(r => {
    console.log('[genoa] migrations applied:', r);
    process.exit(0);
  }).catch(e => {
    console.error('[genoa] migrate failed:', e && e.stack || e);
    process.exit(1);
  });
}
