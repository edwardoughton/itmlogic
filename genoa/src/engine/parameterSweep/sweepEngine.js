// Parameter sweep engine — "H&D killer."
//
// Sweep ERP × HAAT × pattern across ~1000 configurations of a base
// facility, score each against §73.207 / §73.215 / OET-65, return
// ranked compliant configurations.  Sample output:
//
//   { best: { combo: { erp_kw: 68, haat_m: 470 }, ... } }
//
// The sweep CALLS THE ENGINE — it does not reimplement the math.  Each
// combination overrides the corresponding fields on baseInputs and
// runs compute() with the SAME pre-resolved evidence (nearby_primaries,
// fcc_lms, etc.) so per-combo runtime is dominated by the curve table
// interpolation rather than network fetches.  The caller is responsible
// for resolving evidence ONCE before sweeping.
//
// Evidence note: the route layer (api/routes/sweep.js) strips
// evidence.terrain_haat_per_radial before handing it to this engine,
// because compute() prefers per-radial terrain data over inputs.haat_m
// — which would silently no-op the HAAT dimension of the sweep.

import { scoreSweepResult, rankSweepResults } from './scorer.js';

const DEFAULT_CONCURRENCY = 8;
const DEFAULT_MAX_COMBOS  = 1000;
const DEFAULT_TOP_N       = 10;
const HARD_MAX_COMBOS     = 5000;

/**
 * Enumerate ERP × HAAT × pattern combinations from sweep ranges.
 * If the cartesian product exceeds maxCount, downsample uniformly so
 * the caller's compute budget is bounded.
 */
export function enumerateCombinations(ranges = {}, maxCount = DEFAULT_MAX_COMBOS){
  const erp_steps  = stepRange(ranges.erp_kw, { min: 1,  max: 100, step: 1  });
  const haat_steps = stepRange(ranges.haat_m, { min: 50, max: 600, step: 10 });
  const patterns   = (Array.isArray(ranges.patterns) && ranges.patterns.length)
                       ? ranges.patterns
                       : [null];

  const combos = [];
  for (const erp of erp_steps){
    for (const haat of haat_steps){
      for (const pat of patterns){
        const c = { erp_kw: erp, haat_m: haat };
        if (pat) c.pattern_table = pat;
        combos.push(c);
      }
    }
  }

  if (combos.length <= maxCount) return combos;

  // Uniform stride downsample preserves coverage of the full grid.
  const stride = combos.length / maxCount;
  const sampled = [];
  for (let i = 0; i < combos.length && sampled.length < maxCount; i += stride){
    sampled.push(combos[Math.floor(i)]);
  }
  return sampled;
}

function stepRange(spec, defaults){
  const min  = Number(spec?.min ?? defaults.min);
  const max  = Number(spec?.max ?? defaults.max);
  const step = Number(spec?.step ?? defaults.step);
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(step) || step <= 0){
    throw new Error(`invalid range spec: min=${min} max=${max} step=${step}`);
  }
  if (max < min){
    throw new Error(`invalid range spec: max ${max} < min ${min}`);
  }
  const out = [];
  for (let v = min; v <= max + 1e-9; v += step){
    out.push(Math.round(v * 1e6) / 1e6);   // bound fp drift
  }
  return out;
}

/**
 * Summarize an exhibit for the sweep response (avoid shipping the
 * full 100× KB JSON for every combo).
 */
function summarizeExhibit(exhibit){
  const reg = exhibit?.regulatory_compliance || {};
  const polys = exhibit?.polygons || [];
  const service = polys.find(p => /service/i.test(String(p.contour_id || ''))) || polys[0] || null;
  return {
    service_contour_area_km2:        Number(service?.area_km2) || null,
    service_contour_mean_radial_km:  Number(service?.mean_radial_km) || null,
    n_blockers:                       (exhibit?.blockers || []).length,
    n_warnings:                       (exhibit?.warnings || []).filter(w => w?.severity === 'warning').length,
    population:                       exhibit?.population_estimate?.primary ?? null,
    interference_filing_qualifies:    exhibit?.interference_study?.filing_qualifies ?? null,
    regulatory_compliance: {
      cite:                           reg.cite || null,
      pass:                           reg.pass ?? null,
      section_73_207_pass:            reg.section_73_207?.pass ?? null
    },
    oet65: exhibit?.oet65 ? {
      boundary_pass:                  exhibit.oet65?.compliance?.boundary_check?.pass ?? null,
      near_field_required:            exhibit.oet65?.near_field?.required_for_filing ?? null
    } : null
  };
}

/**
 * Run the sweep.
 *
 * @param {object}  args
 * @param {object}  args.baseInputs   — station inputs (call, lat, lon,
 *                                      service, fcc_class, frequency,
 *                                      …).  Each combo OVERRIDES erp_kw
 *                                      / haat_m / pattern_table on top.
 * @param {object}  args.sweepRanges  — { erp_kw: {min,max,step},
 *                                        haat_m: {min,max,step},
 *                                        patterns?: […] }.
 * @param {object}  args.evidence     — pre-resolved evidence for the
 *                                      base station (nearby_primaries
 *                                      especially, which the engine
 *                                      needs for §73.207 / §73.215).
 *                                      MUST NOT contain
 *                                      terrain_haat_per_radial — see
 *                                      file header.
 * @param {object}  args.validation   — same shape compute() expects.
 * @param {object}  args.options      — optional knobs:
 *                                        max_combinations  (≥1, ≤5000),
 *                                        top_n             (default 10),
 *                                        concurrency       (default 8),
 *                                        only_compliant    (default true,
 *                                                          filters output).
 * @param {Function} args.computeFn   — injectable for testing; defaults
 *                                      to engine compute().
 * @returns {Promise<object>} sweep result — see PR #61 description
 */
export async function sweepParameters({
  baseInputs,
  sweepRanges,
  evidence    = {},
  validation,
  options     = {},
  computeFn
} = {}){
  if (!baseInputs || typeof baseInputs !== 'object'){
    throw new Error('sweepParameters: baseInputs is required');
  }
  if (!sweepRanges || typeof sweepRanges !== 'object'){
    throw new Error('sweepParameters: sweepRanges is required');
  }
  if (!validation){
    throw new Error('sweepParameters: validation context is required (engine guard)');
  }

  // Default to the engine's compute().  Lazy-import so unit tests can
  // pass their own computeFn without paying the import cost.
  const compute = computeFn || (await import('../index.js')).compute;

  // max_combinations: numeric values must be ≥1 (negative / zero would
  // silently produce an empty downsample below).  Non-numeric /
  // undefined falls back to the default; numeric > HARD_MAX_COMBOS is
  // clamped down.
  const rawMax = options.max_combinations;
  let max_combinations;
  if (rawMax == null){
    max_combinations = DEFAULT_MAX_COMBOS;
  } else {
    const n = Number(rawMax);
    if (!Number.isFinite(n) || n < 1){
      const e = new Error(`sweepParameters: options.max_combinations must be a positive integer (got ${rawMax})`);
      e.code = 'INVALID_OPTIONS';
      throw e;
    }
    max_combinations = Math.min(Math.floor(n), HARD_MAX_COMBOS);
  }
  const top_n          = Math.max(1, Number(options.top_n) || DEFAULT_TOP_N);
  const concurrency    = Math.max(1, Number(options.concurrency) || DEFAULT_CONCURRENCY);
  const only_compliant = options.only_compliant !== false;  // default true

  const combos = enumerateCombinations(sweepRanges, max_combinations);
  const startTime = Date.now();
  const results = [];
  let i = 0;

  // Bounded concurrency pool.  Each worker drains the index until
  // exhausted.  Result push order doesn't matter — we re-rank at end.
  async function worker(){
    while (true){
      const idx = i++;
      if (idx >= combos.length) return;
      const combo = combos[idx];
      try {
        const exhibit = await compute({
          inputs:  { ...baseInputs, ...combo },
          evidence,
          options: { validation }
        });
        const score = scoreSweepResult(exhibit, combo);
        results.push({
          combo,
          summary: summarizeExhibit(exhibit),
          ...score
        });
      } catch (err){
        results.push({
          combo,
          error:        String(err?.message || err),
          is_compliant: false,
          score:        0
        });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, combos.length) }, worker)
  );

  const ranked = rankSweepResults(results);
  const compliant = ranked.filter(r => r.is_compliant);
  const top_compliant = compliant.slice(0, top_n);
  const non_compliant_count = ranked.length - compliant.length;

  return {
    total_evaluated:    ranked.length,
    total_compliant:    compliant.length,
    total_non_compliant: non_compliant_count,
    runtime_ms:         Date.now() - startTime,
    sweep_ranges:       sweepRanges,
    base_inputs:        baseInputs,
    best:               top_compliant[0] || null,
    top_compliant,
    all_results:        only_compliant ? compliant : ranked
  };
}
