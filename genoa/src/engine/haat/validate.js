// HAAT plausibility validator — Phase-1 hardening, REVISED after the
// KZLZ "NOT_RUN with garbage values" contradiction.
//
// IMPORTANT lesson from that bug: Appendix A reads its per-radial
// HAAT column from `exhibit.radial_table[i].haat_computed_m` (the
// FM contour engine's per-radial output), NOT from
// `evidence.terrain_haat_per_radial`.  When those two sources
// diverged we got a PDF that said "HAAT validation: NOT RUN.  No
// issues detected." right next to a column of -143, -141, -139 m
// HAATs.  Credibility-destroying.
//
// The validator now scans BOTH sources and treats any per-radial
// HAAT, wherever it came from, as material for plausibility checks.
//
// Severity model (req #6):
//
//   INFO     — provenance / labelling, never gates anything
//   WARNING  — suspicious but plausible; engineer should look
//   ADVISORY — missing optional evidence; doesn't gate filing
//   BLOCKER  — known-bad output; gates readiness to BLOCKED
//
// Statuses:
//
//   PASS           — all radials inside [HARD_FLOOR, HARD_CEILING],
//                    mean within ±MEAN_DELTA_LIMIT_M of operator HAAT
//   SUSPECT        — soft-floor outliers (warning)
//   FALLBACK_ONLY  — no terrain basis attached but a per-radial HAAT
//                    bundle is being emitted anyway (e.g. flat-earth
//                    fallback that the FM engine populated from
//                    haat_input_m); we suppress the column so
//                    Appendix A never shows misleading per-radial
//                    numbers without a real basis  (req #5)
//   INVALID        — hard-floor breach, mean-vs-operator divergence,
//                    or any blocker condition — Appendix A must
//                    display "UNAVAILABLE" and readiness goes to
//                    BLOCKED
//   NOT_RUN        — exhibit has no per-radial HAAT anywhere; AM
//                    by design, or terrain wasn't requested at all

export const Severity = Object.freeze({
  INFO:     'INFO',
  WARNING:  'WARNING',
  ADVISORY: 'ADVISORY',
  BLOCKER:  'BLOCKER'
});

const HARD_FLOOR_M       = -200;
const SOFT_FLOOR_M       = -50;
const HARD_CEILING_M     = 4000;
const MEAN_DELTA_LIMIT_M = 300;

// Statuses that mean "do not trust the per-radial HAAT column" —
// Appendix A consumes this list to decide whether to display values
// or "UNAVAILABLE".
export const HAAT_DISPLAY_SUPPRESSED = Object.freeze(new Set([
  'INVALID', 'FALLBACK_ONLY', 'NOT_RUN'
]));

// Statuses that block filing readiness from reaching anything above
// REVIEW (req #2).
export const HAAT_GATES_READINESS = Object.freeze(new Set([
  'INVALID', 'FALLBACK_ONLY', 'NOT_RUN'
]));

// Helper: collect every per-radial HAAT value attached to an
// exhibit, from either of the two known sources.  Returns
// { values, source } where source is 'terrain_evidence' |
// 'radial_table' | 'mixed' | 'none'.
function collectAllRadialHaats(exhibit){
  const evidenceBundle = Array.isArray(exhibit?.evidence?.terrain_haat_per_radial)
    ? exhibit.evidence.terrain_haat_per_radial
    : [];
  const radialTable = Array.isArray(exhibit?.radial_table) ? exhibit.radial_table : [];

  const fromEvidence = evidenceBundle.map(r => Number(r?.haat_m)).filter(Number.isFinite);
  const fromTable    = radialTable
    .map(r => {
      // Prefer haat_computed_m (terrain-derived) over haat_input_m
      // (operator-supplied flat) — only the former is what we need
      // to plausibility-check.  haat_input_m being -581 wouldn't
      // be a terrain bug, it'd be operator input.
      const v = Number(r?.haat_computed_m);
      return Number.isFinite(v) ? v : null;
    })
    .filter(v => v != null);

  if (fromEvidence.length > 0 && fromTable.length > 0){
    return { values: fromTable, source: 'mixed' };  // prefer table, it's what gets rendered
  }
  if (fromTable.length > 0)    return { values: fromTable,    source: 'radial_table' };
  if (fromEvidence.length > 0) return { values: fromEvidence, source: 'terrain_evidence' };
  return { values: [], source: 'none' };
}

// Robust terrain-basis signal.  The upstream tx_amsl_resolved.source
// stamp is fragile — it depends on ZTR returning facility_amsl_resolved
// AND the orchestrator stamping it, and a stale facility-cache entry can
// drop it between runs (observed: identical contour distances, but one
// run classified terrain_derived and the next flat).  When the per-radial
// bundle is ITSELF DEM-sourced — evidence.terrain.n_radials_dem_sourced
// > 0, or rows carry haat_source ~ 'dem'/'arc_averaged' — terrain was
// genuinely applied regardless of the stamp.  Keying basis off this fact
// stops the "flat-earth fallback (no terrain DEM)" label + 581 m-uniform
// HAAT column from appearing on an exhibit whose contour distances were
// genuinely terrain-modulated.  Contamination guards downstream
// (HAAT_IMPOSSIBLE, HAAT_MEAN_INCONSISTENT) are basis-independent, so a
// DEM-sourced-but-garbage bundle (the −857 m KZLZ symptom) still lands
// at INVALID.
function terrainWasApplied(exhibit){
  const t = exhibit?.evidence?.terrain;
  if (t && t.available === true && Number(t.n_radials_dem_sourced) > 0) return true;
  const bundle = exhibit?.evidence?.terrain_haat_per_radial;
  if (Array.isArray(bundle)){
    return bundle.some(r => typeof r?.haat_source === 'string'
      && /dem|arc[_-]?averaged/i.test(r.haat_source));
  }
  return false;
}

export function validateHaat(exhibit){
  const inputs       = exhibit?.station_inputs || {};
  const evidence     = exhibit?.evidence || {};
  // Operator HAAT fallback chain.  station_inputs.haat_m is the
  // primary, but the engineering report renderer also accepts
  // station_inputs.haat_m_input and evidence.terrain.haat_m as
  // sources, and we should match — otherwise the Appendix A header
  // reports "(operator -- m, delta -- m)" even when the cover page
  // clearly shows the operator value.
  const operatorHaat = (() => {
    const candidates = [
      inputs.haat_m,
      inputs.haat_m_input,
      evidence.terrain?.haat_m,
      evidence.terrain_haat?.operator_haat_m,
    ];
    for (const c of candidates){
      const n = Number(c);
      if (Number.isFinite(n)) return n;
    }
    return NaN;
  })();
  const haatResolved = evidence.tx_amsl_resolved || null;
  const collected    = collectAllRadialHaats(exhibit);
  const haats        = collected.values;
  const issues       = [];

  // Basis: how was the antenna AMSL determined?  This is the
  // "terrain basis" question — without a resolved AMSL we have no
  // real basis for per-radial terrain HAAT.
  const demApplied = terrainWasApplied(exhibit);
  let basis = 'unknown';
  if (haatResolved){
    if (haatResolved.source === 'operator_supplied') basis = 'operator_supplied';
    else if (haatResolved.source === 'derived')      basis = 'terrain_derived';
    // Resolved stamp present but not a recognized terrain source — defer
    // to the DEM-applied signal rather than blindly calling it flat.
    else basis = demApplied ? 'terrain_derived' : 'flat';
  } else if (collected.source === 'none'){
    basis = inputs.service === 'AM' ? 'not_applicable_am' : 'flat';
  } else {
    // Per-radial values present but no resolved-AMSL stamp.  If the
    // bundle is DEM-sourced, terrain WAS applied — classify it as such
    // so the column isn't suppressed to the flat operator value.
    basis = demApplied ? 'terrain_derived' : 'flat';
  }

  // ── No per-radial HAAT anywhere → NOT_RUN ────────────────────
  if (haats.length === 0){
    return {
      status: 'NOT_RUN',
      basis,
      issues,
      stats: emptyStats(operatorHaat),
      tx_amsl_resolved: haatResolved,
      display_suppressed: true,
      gates_readiness:    inputs.service !== 'AM'   // AM legitimately has no DEM-HAAT
    };
  }

  const n     = haats.length;
  const mean  = haats.reduce((a, b) => a + b, 0) / n;
  const min   = Math.min(...haats);
  const max   = Math.max(...haats);
  const nNeg  = haats.filter(h => h < 0).length;
  const nImpl = haats.filter(h => h < HARD_FLOOR_M || h > HARD_CEILING_M).length;

  // ── Critical: per-radial HAATs present but NO terrain basis ──
  // The KZLZ pattern: flat-earth fallback (no real AMSL, no real
  // DEM), but the FM engine populated radial_table[i].haat_computed_m
  // anyway, and those values are deeply negative because the upstream
  // pipeline was passing haat_m as tx_amsl_m.  Emit a BLOCKER and
  // mark the display as suppressed (req #1).
  if (basis === 'flat' && Number.isFinite(operatorHaat) && operatorHaat > 0){
    const inconsistent = Math.abs(mean - operatorHaat) > MEAN_DELTA_LIMIT_M;
    if (nImpl > 0 || nNeg === n || inconsistent){
      issues.push({
        code:     'HAAT_SUPPRESSED_NO_TERRAIN_BASIS',
        severity: Severity.BLOCKER,
        detail:   `Per-radial HAAT values present (range [${min.toFixed(1)}, ${max.toFixed(1)}] m, mean ${mean.toFixed(1)} m) but no terrain basis attached — neither inputs.overall_height_amsl_m nor a successful tx-site DEM probe. Operator HAAT is ${operatorHaat} m; computed values would be misleading.  Per-radial HAAT suppressed; contour distances still authoritative under the FCC §73.333 curves using operator HAAT.`
      });
      return {
        status: 'INVALID',
        basis,
        issues,
        stats: {
          n_radials: n, n_finite: n, n_negative: nNeg, n_implausible: nImpl,
          mean_m: round1(mean), min_m: round1(min), max_m: round1(max),
          operator_m: operatorHaat, delta_mean_vs_operator_m: round1(mean - operatorHaat)
        },
        tx_amsl_resolved: haatResolved,
        display_suppressed: true,
        gates_readiness:    true,
        terrain_limited:    true
      };
    }
    // Flat basis, values look reasonable — still suppress because
    // they have no proper terrain basis (status FALLBACK_ONLY).
    issues.push({
      code:     'HAAT_FALLBACK_ONLY',
      severity: Severity.WARNING,
      detail:   `Per-radial HAAT bundle present but no terrain basis attached. Values displayed in Appendix A would imply terrain analysis was performed when it was not. Column suppressed; operator HAAT (${operatorHaat} m) is used for contour interpolation.`
    });
    return {
      status: 'FALLBACK_ONLY',
      basis,
      issues,
      stats: {
        n_radials: n, n_finite: n, n_negative: nNeg, n_implausible: nImpl,
        mean_m: round1(mean), min_m: round1(min), max_m: round1(max),
        operator_m: operatorHaat, delta_mean_vs_operator_m: round1(mean - operatorHaat)
      },
      tx_amsl_resolved: haatResolved,
      display_suppressed: true,
      gates_readiness:    true,
      terrain_limited:    true
    };
  }

  // ── Hard-floor / hard-ceiling implausibility ─────────────────
  if (nImpl > 0){
    const worst = haats.reduce((acc, h) => {
      if (h < HARD_FLOOR_M || h > HARD_CEILING_M){
        if (acc == null || Math.abs(h) > Math.abs(acc)) return h;
      }
      return acc;
    }, null);
    issues.push({
      code:     'HAAT_IMPOSSIBLE',
      severity: Severity.BLOCKER,
      detail:   `${nImpl}/${n} per-radial HAAT values fall outside [${HARD_FLOOR_M}, ${HARD_CEILING_M}] m (worst observed ${worst?.toFixed?.(1)} m).  Almost certainly an upstream tx_amsl_m / haat_m confusion.`
    });
  }

  // ── Mean-vs-operator delta check ─────────────────────────────
  if (Number.isFinite(operatorHaat) && Number.isFinite(mean)){
    const delta = mean - operatorHaat;
    if (Math.abs(delta) > MEAN_DELTA_LIMIT_M){
      issues.push({
        code:     'HAAT_MEAN_INCONSISTENT',
        severity: Severity.BLOCKER,
        detail:   `Mean per-radial HAAT (${mean.toFixed(1)} m) differs from operator-supplied HAAT (${operatorHaat.toFixed(1)} m) by ${delta.toFixed(1)} m — well beyond the ±${MEAN_DELTA_LIMIT_M} m tolerance.`
      });
    }
  }

  // ── Soft-floor outliers (warning only) ───────────────────────
  const nSoftOutliers = haats.filter(h => h < SOFT_FLOOR_M && h >= HARD_FLOOR_M).length;
  if (nSoftOutliers > 0 && nImpl === 0){
    issues.push({
      code:     'HAAT_SUSPECT_OUTLIERS',
      severity: Severity.WARNING,
      detail:   `${nSoftOutliers}/${n} per-radial HAAT values fall below ${SOFT_FLOOR_M} m (range [${min.toFixed(1)}, ${max.toFixed(1)}] m).  Physically possible (deep valley) but uncommon; engineer of record should confirm.`
    });
  }

  let status = 'PASS';
  if (issues.some(i => i.severity === Severity.BLOCKER)) status = 'INVALID';
  else if (issues.some(i => i.severity === Severity.WARNING)) status = 'SUSPECT';

  return {
    status,
    basis,
    issues,
    stats: {
      n_radials: n, n_finite: n, n_negative: nNeg, n_implausible: nImpl,
      mean_m: round1(mean), min_m: round1(min), max_m: round1(max),
      operator_m: Number.isFinite(operatorHaat) ? operatorHaat : null,
      delta_mean_vs_operator_m: Number.isFinite(operatorHaat)
        ? round1(mean - operatorHaat)
        : null
    },
    tx_amsl_resolved: haatResolved,
    display_suppressed: status === 'INVALID',
    gates_readiness:    status === 'INVALID'
  };
}

function emptyStats(operatorHaat){
  return {
    n_radials: 0, n_finite: 0, n_negative: 0, n_implausible: 0,
    mean_m: null, min_m: null, max_m: null,
    operator_m: Number.isFinite(operatorHaat) ? operatorHaat : null,
    delta_mean_vs_operator_m: null
  };
}

function round1(n){ return Number.isFinite(n) ? Math.round(n * 10) / 10 : null; }

// Consistency guard (req #3).  Run at end of computeExhibit.
// Detects the "PDF says X but engineering output says Y" failure
// mode by checking three contradictions:
//
//   1. haat_validation.status === PASS but any rendered HAAT value
//      has |abs| > 500 m AND is the wrong sign relative to operator.
//      (Magnitude alone isn't a bug — Mt. Wilson HAATs are ~1700 m.)
//   2. haat_validation says "no issues detected" but exhibit.blockers
//      has entries.
//   3. Per-radial HAATs visible in radial_table but validator said
//      NOT_RUN — i.e. validator missed a source.
//
// Returns array of detected contradictions.  Caller (exhibitService)
// promotes any non-empty result to a HAAT_CONTRADICTION blocker.
export function detectHaatContradictions(exhibit){
  const out = [];
  const v   = exhibit?.haat_validation;
  if (!v) return out;

  const allHaats = collectAllRadialHaats(exhibit).values;
  const operator = Number(exhibit?.station_inputs?.haat_m);

  // 1. PASS but rendered values implausibly large with wrong sign
  if (v.status === 'PASS' && Number.isFinite(operator)){
    const wrongSignLarge = allHaats.filter(h =>
      Math.abs(h) > 500 && Math.sign(h) !== Math.sign(operator)
    );
    if (wrongSignLarge.length > 0){
      out.push({
        code:     'HAAT_CONTRADICTION',
        severity: Severity.BLOCKER,
        detail:   `Validator status PASS but ${wrongSignLarge.length} per-radial HAAT values have magnitude >500 m and opposite sign of operator HAAT (${operator} m).  Validator did not see this source — release blocked.`
      });
    }
  }

  // 2. "No issues detected" while exhibit.blockers is populated
  const otherBlockers = (exhibit?.blockers || []).filter(b =>
    b.code !== 'HAAT_CONTRADICTION'
  );
  if ((v.issues || []).length === 0 && otherBlockers.length > 0){
    out.push({
      code:     'HAAT_CONTRADICTION',
      severity: Severity.BLOCKER,
      detail:   `HAAT validation reports no issues, but exhibit carries ${otherBlockers.length} engineering blocker(s).  Report must not say "No issues detected" in this state.`
    });
  }

  // 3. NOT_RUN but per-radial HAATs visible in any source
  if (v.status === 'NOT_RUN' && allHaats.length > 0){
    out.push({
      code:     'HAAT_CONTRADICTION',
      severity: Severity.BLOCKER,
      detail:   `HAAT validation status NOT_RUN but ${allHaats.length} per-radial HAAT values present in the exhibit.  Validator missed a source — release blocked to prevent misleading Appendix A.`
    });
  }

  return out;
}
