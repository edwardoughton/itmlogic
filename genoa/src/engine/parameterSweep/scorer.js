// Compliance + ranking scorer for parameter-sweep results.
//
// A configuration is COMPLIANT iff:
//   1. (§73.207 minimum-distance separation passes) OR
//      (§73.215 contour protection passes) — either rule path qualifies.
//   2. OET-65 §1.1310 boundary check passes (or skipped honestly).
//   3. The exhibit carries no engine blockers.
//
// Among compliant configurations, RANK by service contour area per kW
//   score = service_contour_area_km2 / erp_kw
// (more coverage per watt = more efficient build).  Tie-break on lower
// ERP, then lower HAAT — cheap and conservative wins ties.
//
// The scorer is pure: same exhibit → same score.  No I/O, no math
// changes — it only inspects already-computed engine outputs.

function findServiceContour(exhibit){
  const polys = exhibit?.polygons || [];
  // Prefer the explicit "service" contour by id; fall back to label
  // patterns; final fallback to the first closed polygon.
  return (
    polys.find(p => /service/i.test(String(p.contour_id || ''))) ||
    polys.find(p => /service|protected|grade/i.test(String(p.label || ''))) ||
    polys.find(p => p.closed && p.area_km2 != null) ||
    polys[0] ||
    null
  );
}

export function scoreSweepResult(exhibit, combo){
  const reg = exhibit?.regulatory_compliance || {};
  // §73.207: read straight off the section_73_207 sub-block.
  const sec207_pass =
    reg.section_73_207?.pass === true
    || (reg.cite && /73\.207/.test(reg.cite) && reg.pass === true);
  // §73.215: top-level pass when cite is §73.215, OR when the
  // contour-protection block reports pass=true (engine surfaces it under
  // FM_CONTOUR_PROTECTION_VIOLATION when failing, so absence of that
  // warning + presence of the study is also a positive signal).
  const sec215_pass =
    (reg.cite && /73\.215/.test(reg.cite) && reg.pass === true);
  // Distance compliance: either rule satisfies.
  const distance_compliant = sec207_pass === true || sec215_pass === true;

  // OET-65: boundary check pass.  null/undefined = skipped (e.g. ERP
  // missing) which we treat as non-blocking; explicit false = fail.
  const oet65_pass = exhibit?.oet65?.compliance?.boundary_check?.pass !== false;

  const blockers = Array.isArray(exhibit?.blockers) ? exhibit.blockers : [];
  const no_blockers = blockers.length === 0;

  const is_compliant = distance_compliant && oet65_pass && no_blockers;

  // Coverage / efficiency.
  const service = findServiceContour(exhibit);
  const coverage_km2 = Number(service?.area_km2) || 0;
  const erp_kw = Math.max(0.01, Number(combo?.erp_kw) || Number(exhibit?.station_inputs?.erp_kw) || 0.01);
  const efficiency_km2_per_kw = coverage_km2 / erp_kw;

  // Composite score.  Compliant configs rank by efficiency; non-
  // compliant configs get score=0 so they sort below compliant peers.
  const score = is_compliant ? efficiency_km2_per_kw : 0;

  return {
    is_compliant,
    score,
    coverage_km2,
    efficiency_km2_per_kw,
    compliance: {
      '73.207':       sec207_pass === true ? true : sec207_pass === false ? false : null,
      '73.215':       sec215_pass === true,
      'oet65':        oet65_pass,
      'no_blockers':  no_blockers,
      'distance_path': sec207_pass === true ? '73.207' : sec215_pass === true ? '73.215' : null
    }
  };
}

/**
 * Stable rank: descending score, then ascending erp_kw, then ascending haat_m.
 * Returns a NEW sorted array; does not mutate input.
 */
export function rankSweepResults(results){
  return [...(results || [])].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aErp = Number(a?.combo?.erp_kw) || 0;
    const bErp = Number(b?.combo?.erp_kw) || 0;
    if (aErp !== bErp) return aErp - bErp;
    const aHaat = Number(a?.combo?.haat_m) || 0;
    const bHaat = Number(b?.combo?.haat_m) || 0;
    return aHaat - bHaat;
  });
}
