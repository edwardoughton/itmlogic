// Server-side defaults for exhibit compute options.
//
// PURPOSE
//   Centralise the "should this option default ON if the caller didn't
//   set it?" decisions that the orchestrator would otherwise sprinkle
//   in `options.foo !== false` checks across exhibitService.js.
//
// CURRENT DEFAULTS
//   use_terrain
//     Default: ON for non-AM services with lat/lon (real per-radial
//     §73.313 HAAT — Hatfield-Dawson grade).  Skipped automatically
//     for AM (groundwave doesn't use HAAT) by gates inside the
//     orchestrator itself.  Adds ~10-30 s on cold cache; the existing
//     compute budget caps the wait.
//     Opt out per request:    options.use_terrain = false
//     Opt out per deployment: TERRAIN_DEFAULT_ON=false (env var)
//
// SCOPE
//   This helper runs at the orchestrator boundary, BEFORE
//   computeExhibit({ inputs, options }) sees the request.  It does NOT
//   change semantics inside exhibitService.js — that file still reads
//   options.use_terrain (truthy/false), and the existing AM / lat-lon
//   gates inside the orchestrator still apply.

export function applyComputeOptionDefaults(req){
  const options = { ...(req.options || {}) };

  // Terrain HAAT — default ON unless explicitly disabled per request
  // or per deployment.  AM is gated separately inside the orchestrator
  // (groundwave doesn't use HAAT) so we can default true for everyone.
  if (options.use_terrain === undefined
      && String(process.env.TERRAIN_DEFAULT_ON || 'true').toLowerCase() !== 'false'){
    options.use_terrain = true;
  }

  return { ...req, options };
}
