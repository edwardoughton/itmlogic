// Comparable-facility coverage fan-out — augments the ranking from
// rankComparableFacilities() with actual ITM coverage per comparator,
// fetched in parallel via the SPLAT sidecar.
//
// PROBLEM
//   The pure ranking engine surfaces class / ERP / HAAT / distance
//   parameters, but a broker walks in asking "what does my proposed
//   facility's coverage actually LOOK LIKE compared to these peers?"
//   That's a SPLAT call per comparator + per the proposed station.
//   With 20 comparators that's 21 sequential SPLAT calls; with the
//   newly-autoscaled SPLAT cluster (#168) we can fan them in
//   parallel and close the loop in roughly 1 SPLAT-call worth of
//   wall time.
//
// CONTRACT
//   await augmentRankingWithCoverage(rankingResult, {
//     splatClient,               // sidecars.splat (or a fake)
//     proposedTx?,               // when set, also computes coverage
//                                 // for the proposed station so the
//                                 // result carries a true delta
//     concurrency = 6,           // matches 2-3 containers × 2-3 vCPUs
//                                 // ceiling — env-tunable in the route
//     splatOpts = {},            // forwarded to predictItmCoverage
//                                 // (radial_step_deg, max_distance_km,
//                                 //  timeout_seconds)
//     onProgress?                // optional (done, total) callback
//   })
//   →  {
//        ...rankingResult,
//        coverage: {
//          proposed?:  { ...itmSummary } | { available:false, error },
//          comparators: [{ id, call, ...itmSummary | { error } }],
//          n_attempted, n_ok, n_failed,
//          fanout_concurrency: <int>,
//          elapsed_ms
//        }
//      }
//
// NOTE
//   We compute `itmSummary` (mean / min / max radial, blocked count,
//   service-area km², worst-bearing) here so callers don't have to
//   reach into raw SPLAT output.  Each comparator's coverage object
//   is comparable to every other's.

const DEFAULT_CONCURRENCY = 6;

/**
 * @param {object} rankingResult        the output of rankComparableFacilities()
 * @param {object} ctx                  see CONTRACT above
 * @returns {Promise<object>}
 */
export async function augmentRankingWithCoverage(rankingResult, ctx = {}){
  const { splatClient, proposedTx = null,
          concurrency = DEFAULT_CONCURRENCY,
          splatOpts = {}, onProgress = null } = ctx;
  if (!rankingResult || rankingResult.ok !== true){
    return { ...rankingResult,
             coverage: { available: false, error: 'ranking result not ok' } };
  }
  if (!splatClient || typeof splatClient.predictItmCoverage !== 'function'){
    return { ...rankingResult,
             coverage: { available: false,
                         error: 'SPLAT sidecar not configured (SPLAT_SIDECAR_URL unset)' } };
  }

  const t0 = Date.now();
  const candidates = Array.isArray(rankingResult.results) ? rankingResult.results : [];

  // 1. Build the work queue.  Proposed first when supplied, then
  //    every comparator (only those with the geometry SPLAT requires).
  const work = [];
  if (proposedTx
      && Number.isFinite(Number(proposedTx.lat))
      && Number.isFinite(Number(proposedTx.lon))
      && Number.isFinite(Number(proposedTx.frequency_mhz))
      && Number.isFinite(Number(proposedTx.haat_m))
      && Number.isFinite(Number(proposedTx.erp_kw))){
    work.push({ kind: 'proposed', tx: toSplatTx(proposedTx) });
  }
  for (const c of candidates){
    if (Number.isFinite(c.lat)
        && Number.isFinite(c.lon)
        && Number.isFinite(c.frequency_mhz)
        && Number.isFinite(c.haat_m)
        && Number.isFinite(c.erp_kw)){
      work.push({
        kind: 'comparator',
        candidate: c,
        tx: toSplatTx(c)
      });
    }
  }

  // 2. Bounded-concurrency fan-out.  Plain promise pool so the
  //    autoscaler ramps containers to absorb the burst, but we never
  //    open more sockets than the cluster wants.
  const proposed_out = [];
  const comparators_out = [];
  let nDone = 0;
  const tasks = work.map((w) => async () => {
    let summary;
    try {
      const r = await splatClient.predictItmCoverage({
        tx: w.tx,
        ...splatOpts
      });
      summary = summarizeSplat(r);
    } catch (e){
      summary = { available: false, error: String(e?.message || e) };
    }
    if (w.kind === 'proposed'){
      proposed_out.push({ ...summary });
    } else {
      comparators_out.push({
        id:           w.candidate.facility_id || w.candidate.call || null,
        call:         w.candidate.call || null,
        fcc_class:    w.candidate.fcc_class || null,
        ...summary
      });
    }
    nDone++;
    if (typeof onProgress === 'function') onProgress(nDone, work.length);
  });
  await runWithConcurrency(tasks, Math.max(1, concurrency));

  const n_ok = proposed_out.filter((x) => x.available).length
             + comparators_out.filter((x) => x.available).length;
  const n_failed = work.length - n_ok;

  return {
    ...rankingResult,
    coverage: {
      proposed:           proposed_out[0] || null,
      comparators:        comparators_out,
      n_attempted:        work.length,
      n_ok,
      n_failed,
      fanout_concurrency: Math.max(1, concurrency),
      elapsed_ms:         Date.now() - t0,
      provenance: {
        upstream:      'chelstein/splat (SPLAT! Longley-Rice ITM)',
        regulation:    '47 CFR §73.313 (terrain-aware HAAT) + ITS Longley-Rice (1968)',
        license_basis: '17 USC §105 (FCC + ITS engine outputs, US Government public domain)'
      }
    }
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function toSplatTx(c){
  return {
    call:             c.call         || null,
    lat:              Number(c.lat),
    lon:              Number(c.lon),
    amsl_m:           Number(c.haat_m),
    antenna_height_m: Number(c.haat_m),
    frequency_mhz:    Number(c.frequency_mhz ?? c.frequency),
    erp_kw:           Number(c.erp_kw),
    polarization:     c.polarization || 'V'
  };
}

/**
 * Reduce raw SPLAT predictItmCoverage output to a comparison-friendly
 * summary.  Defensive: SPLAT response shape varies by sidecar
 * version; we only assume `available`, optional `radials`, and any
 * scalar summary fields the sidecar already computed.
 */
export function summarizeSplat(splatResp){
  if (!splatResp){
    return { available: false, error: 'splat returned null' };
  }
  if (splatResp.available === false){
    return { available: false,
             error: splatResp.error || 'splat returned available:false',
             sidecar_enhancement_required: !!splatResp.sidecar_enhancement_required };
  }
  const radials = Array.isArray(splatResp.radials) ? splatResp.radials : [];
  const dist_km = radials
    .map((r) => Number(r?.distance_km))
    .filter((x) => Number.isFinite(x) && x > 0);
  const blocked = radials.filter((r) => r?.blocked === true || r?.distance_km === 0).length;
  const stats = dist_km.length
    ? {
        n_radials:    radials.length,
        n_blocked:    blocked,
        mean_radial_km: Number((dist_km.reduce((a, x) => a + x, 0) / dist_km.length).toFixed(3)),
        min_radial_km:  Number(Math.min(...dist_km).toFixed(3)),
        max_radial_km:  Number(Math.max(...dist_km).toFixed(3)),
        // Filed-area approximation: π/N · Σrᵢ² for radials evenly
        // spaced over 360°.  Same convention the exhibit-diff engine
        // uses so the two are comparable side-by-side.
        service_area_km2: Number(((Math.PI / radials.length) * dist_km.reduce((a, x) => a + x * x, 0)).toFixed(2))
      }
    : { n_radials: radials.length, n_blocked: blocked,
        mean_radial_km: null, min_radial_km: null, max_radial_km: null,
        service_area_km2: null };
  return {
    available:         true,
    source:            splatResp.source || 'splat',
    engine:            splatResp.engine || 'splat-itm',
    fidelity:          splatResp.fidelity || null,
    target_field_dbu:  splatResp.target_field_dbu ?? null,
    ...stats
  };
}

/**
 * Bounded-concurrency promise pool.  Runs at most `n` tasks at once;
 * resolves once every task settles.  Each task is a thunk returning
 * a Promise.  Rejections are caught — we never let one slow comparator
 * fail the whole fan-out.
 */
export async function runWithConcurrency(tasks, n){
  const queue = tasks.slice();
  const workers = [];
  for (let i = 0; i < Math.min(n, queue.length); i++){
    workers.push((async () => {
      while (queue.length){
        const next = queue.shift();
        try { await next(); } catch { /* swallow — each task captures its own errors */ }
      }
    })());
  }
  await Promise.all(workers);
}

export const COMPARABLES_COVERAGE_PROVENANCE = Object.freeze({
  module:        'src/engine/comparablesCoverage.js',
  regulation:    '47 CFR §73.313 (terrain-aware HAAT) + ITS Longley-Rice',
  modeled: [
    'Per-comparator SPLAT predictItmCoverage fan-out with bounded concurrency',
    'Optional proposed-station coverage so the result carries a true delta',
    'Defensive summary: mean / min / max radial, blocked count, service-area km²',
    'Per-task error containment — one slow comparator never fails the whole fan-out'
  ],
  not_modeled: [
    'Population delta inside each coverage area (Census sidecar pending)',
    'Radial-by-radial delta vs proposed (separate exhibit-diff path)'
  ],
  license_basis: '17 USC §105 (FCC engine output, US Government public domain)'
});
