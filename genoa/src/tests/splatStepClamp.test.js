// Static-source check that exhibitService.js step 3d clamps the
// SPLAT radial step to a positive bounded value before entering
// the for(az<360;az+=step) loop.  Codex caught this on PR #168 —
// SPLAT_RADIAL_STEP_DEG=-5 (or any negative override) would loop
// forever and hang the worker.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import url from 'node:url';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'api', 'services', 'exhibitService.js');

test('exhibitService SPLAT step is clamped to positive band before the radial loop', async () => {
  const text = await fs.readFile(SRC, 'utf8');
  // The clamp lives right above `for (let az = 0; az < 360; az += step)`
  // in step 3d.  We assert by source-text presence rather than by
  // running the engine because the engine path requires a full
  // exhibit fixture + sidecars stack — overkill for a one-line guard.
  assert.match(text, />=\s*0\.5\s*&&\s*[^&]+<=\s*90/,
    'SPLAT step clamp (0.5° ≤ step ≤ 90°) missing — would loop forever on negative override');
  assert.match(text, /Number\.isFinite\(_stepRequested\)/,
    'SPLAT step clamp must reject non-finite values');
});

test('clamp inline equivalence: bands ALL out-of-range values to the env default', () => {
  // Mirror the inline clamp expression so a future refactor can lift
  // it into a helper without losing the property.
  const clamp = (req, def) => (Number.isFinite(req) && req >= 0.5 && req <= 90 ? req : def);
  assert.equal(clamp(-5, 10), 10,   'negative → default');
  assert.equal(clamp(0,  10), 10,   '0 → default');
  assert.equal(clamp(0.4, 10), 10,  'below 0.5 → default');
  assert.equal(clamp(91, 10), 10,   'above 90 → default');
  assert.equal(clamp(NaN, 10), 10,  'NaN → default');
  assert.equal(clamp(Infinity, 10), 10, 'Infinity → default');
  // Real values pass through.
  assert.equal(clamp(0.5, 10), 0.5);
  assert.equal(clamp(5,   10), 5);
  assert.equal(clamp(10,  10), 10);
  assert.equal(clamp(90,  10), 90);
});
