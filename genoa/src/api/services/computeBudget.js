// Wall-clock budget enforcement for the compute orchestrator.
//
// PROBLEM
//   computeExhibit() fans out to many evidence sources (facility,
//   FCC contour, terrain HAAT, multi-source DEM, nearby_primaries,
//   ZTR enrichment, ASR, identity, SDR, validation) sequentially
//   and in parallel.  Each individual fetch has its own per-fetch
//   timeout (3-60s), but their SUM can exceed DigitalOcean App
//   Platform's gateway HTTP timeout (60s default), causing 504s.
//
// SOLUTION
//   Track a single deadline at the start of computeExhibit().
//   Wrap every optional evidence fetch in withDeadline(promise,
//   deadline) which races the fetch against the remaining budget.
//   When the budget is blown, the fetch resolves to null with a
//   reason — the orchestrator skips that piece of evidence and the
//   exhibit ships with a COMPUTE_TIMEOUT_PARTIAL warning naming
//   exactly which fetches were skipped.
//
//   The compute itself (engine math) is NOT subject to the budget —
//   it's deterministic and fast (single-digit-ms for radial table,
//   < 1s including polygons + GeoJSON).  Only network-bound evidence
//   fetches are budgeted.
//
// DEPLOYMENT NOTE — DigitalOcean App Platform
//   The DEFAULT 4.5-minute budget assumes the deploy's HTTP gateway
//   timeout has been extended past the default 60 s.  DO App Platform
//   accepts up to 300 s (5 min) via the per-component
//   `http_request_timeout` setting in app.yaml or via the console
//   ("Edit Component" → "Settings" → "Advanced").  Set it to 300
//   AND set COMPUTE_BUDGET_MS=270000 so the orchestrator finishes
//   ~30 s before the gateway gives up.
//
//   Without that DO config change, the gateway still 504's at 60 s
//   regardless of this budget.
//
// ENV
//   COMPUTE_BUDGET_MS   default 270_000 (4.5 min); the orchestrator
//                       will stop spawning new evidence fetches once
//                       this is exhausted and ship the exhibit with
//                       partial-evidence warnings.

export const DEFAULT_COMPUTE_BUDGET_MS = 270_000;

/**
 * Construct a per-request budget tracker.
 *
 * @param {number} [budgetMs]  total wall-clock budget in ms; defaults to
 *                              process.env.COMPUTE_BUDGET_MS or 45000.
 */
export function makeBudget(budgetMs){
  const budget = Number.isFinite(Number(budgetMs)) && Number(budgetMs) > 0
    ? Number(budgetMs)
    : Number(process.env.COMPUTE_BUDGET_MS) || DEFAULT_COMPUTE_BUDGET_MS;
  const start_ms = Date.now();
  const deadline_ms = start_ms + budget;
  const skipped = [];                  // [{ name, reason, elapsed_ms }]
  const timings = [];                  // [{ name, ms, ok, started_ms }]

  return {
    budget_ms:    budget,
    start_ms,
    deadline_ms,
    /**
     * Remaining ms.  Returns 0 when the budget is blown (never
     * negative).
     */
    remaining_ms: () => Math.max(0, deadline_ms - Date.now()),
    /**
     * Has the budget already been blown?
     */
    expired:      () => Date.now() >= deadline_ms,
    /**
     * Wrap a promise so it races against the remaining budget.
     * When the budget exhausts before the promise settles, the
     * skipped step is recorded and the helper resolves to null.
     *
     * @param {string} name     short label (e.g. 'nearby_primaries')
     * @param {Promise<T>|()=>Promise<T>} produce  async work or zero-arg fn
     * @param {object} [opts]
     * @param {number} [opts.minMs=500]  if remaining budget is below this,
     *                                    skip the work entirely without
     *                                    starting it.  Default 500ms.
     * @returns {Promise<T|null>}
     */
    async withDeadline(name, produce, opts = {}){
      const minMs = Number.isFinite(Number(opts.minMs)) ? Number(opts.minMs) : 500;
      const remaining = deadline_ms - Date.now();
      if (remaining < minMs){
        skipped.push({ name, reason: 'budget exhausted before start', elapsed_ms: Date.now() - start_ms, remaining_ms: remaining });
        timings.push({ name, ms: 0, ok: false, started_ms: Date.now() - start_ms, note: 'skipped' });
        return null;
      }
      const work = typeof produce === 'function' ? produce() : produce;
      const stage_t0 = Date.now();
      let timer = null;
      try {
        const result = await Promise.race([
          work,
          new Promise((_resolve, reject) => {
            timer = setTimeout(() => reject(new BudgetTimeoutError(name, remaining)), remaining);
          })
        ]);
        timings.push({ name, ms: Date.now() - stage_t0, ok: true, started_ms: stage_t0 - start_ms });
        return result;
      } catch (e){
        if (e instanceof BudgetTimeoutError){
          skipped.push({ name, reason: 'budget timeout', elapsed_ms: Date.now() - start_ms, deadline_ms_into_request: e.elapsed_ms });
          timings.push({ name, ms: Date.now() - stage_t0, ok: false, started_ms: stage_t0 - start_ms, note: 'timeout' });
          return null;
        }
        timings.push({ name, ms: Date.now() - stage_t0, ok: false, started_ms: stage_t0 - start_ms, note: 'error' });
        throw e;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    /**
     * Snapshot of skipped fetches for the warning payload.
     */
    skipped: () => skipped.slice(),
    /**
     * Per-stage timings (every withDeadline call) — ok and not-ok.
     * Sorted descending by ms so the slowest stage is first.
     */
    timings: () => timings.slice().sort((a, b) => b.ms - a.ms),
    /**
     * Pretty-print a one-line breakdown of all stages over a minimum
     * threshold.  Default 500 ms hides noise from fast cache-hits.
     */
    timingSummary: (minMs = 500) => {
      const top = timings
        .filter(t => t.ms >= minMs)
        .sort((a, b) => b.ms - a.ms)
        .map(t => `${t.name}=${t.ms}ms${t.note ? '/' + t.note : ''}`)
        .join(' ');
      return top || '(all stages under threshold)';
    },
    /**
     * Total elapsed wall clock at this moment.
     */
    elapsed_ms: () => Date.now() - start_ms
  };
}

class BudgetTimeoutError extends Error {
  constructor(name, elapsed_ms){
    super(`compute budget timeout for "${name}" after ${elapsed_ms} ms`);
    this.name = 'BudgetTimeoutError';
    this.elapsed_ms = elapsed_ms;
  }
}
