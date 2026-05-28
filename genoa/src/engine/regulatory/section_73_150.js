// AM directional antenna pattern compliance — 47 CFR §73.150.
//
// FCC rules constrain the shape of an authorized AM DA pattern:
//   1. SMOOTHNESS: the relative-field pattern may not change more
//      than 2 dB per 10° over the protection azimuths (Haertig in
//      Radio World, "Propagation Analysis for Profit", June 2017
//      p. 26).  A pattern that swings 4 dB across 5° is mathematically
//      possible but physically implausible and the FCC will not
//      authorize it.
//   2. MAX:MIN RATIO: the maximum-to-minimum relative-field ratio
//      may not exceed 15 dB across the protection azimuths.  Same
//      cite.  Stations with deeper nulls than that need a different
//      pattern or a different licensing path.
//   3. RMS MINIMUM: as-built RMS must be ≥ 85% of the authorized
//      pattern.  Same cite.  Genoa can only check this when both an
//      authorized pattern AND an as-built pattern are attached —
//      otherwise we report 'not measured'.
//
// All three rules are surfaced as a single regulatory-compliance
// component in the exhibit.validation chain and appear in the PDF's
// validation verdict.  Failures are ADVISORY at the engine level
// (the engine still computes contours from the filed pattern); they
// gate the filing decision via the verdict, not the math.

const SMOOTHNESS_DB_PER_10DEG_LIMIT = 2.0;
const MAX_TO_MIN_DB_LIMIT           = 15.0;
const RMS_MIN_FRACTION              = 0.85;
const FIELD_FLOOR                   = 1e-3;   // 0.001 — avoid log10(0)

/**
 * Run §73.150 pattern compliance checks against a filed AM DA pattern.
 *
 * @param {object}  args
 * @param {Array}   args.pattern_table   Array of [az_deg, relative_field] pairs
 * @param {Array}   [args.authorized_pattern_table]   Same shape; optional
 * @returns {object} compliance result with overall pass/fail + per-rule findings
 */
export function checkAmDaPatternCompliance({ pattern_table, authorized_pattern_table = null } = {}){
  const regulation = '47 CFR §73.150';
  if (!Array.isArray(pattern_table) || pattern_table.length < 2){
    return {
      applicable: false,
      regulation,
      reason: 'no pattern_table attached — §73.150 checks require a filed DA pattern',
      findings: [],
      overall_pass: null
    };
  }

  // Normalize and sort by azimuth.
  const pts = pattern_table
    .map(([az, f]) => [((Number(az) % 360) + 360) % 360, Number(f)])
    .filter(([az, f]) => Number.isFinite(az) && Number.isFinite(f) && f >= 0)
    .sort((a, b) => a[0] - b[0]);

  if (pts.length < 2){
    return {
      applicable: false,
      regulation,
      reason: 'pattern_table contains fewer than 2 valid azimuth / field pairs',
      findings: [],
      overall_pass: null
    };
  }

  const findings = [];

  // ---- Rule 1: SMOOTHNESS (2 dB per 10°) ---------------------------
  // Walk adjacent azimuth pairs; for each compute the absolute Δfield
  // in dB normalized to a 10° azimuth span.  Pairs spanning the
  // 0/360 wrap also evaluated.
  let worstSmoothness = { from_az: null, to_az: null, delta_db_per_10deg: 0 };
  const checkAdjacent = (i, j) => {
    const a = pts[i]; const b = pts[j];
    const azSpan = wrappedAzSpan(a[0], b[0]);
    if (azSpan <= 0) return;
    const dB = Math.abs(20 * Math.log10(Math.max(b[1], FIELD_FLOOR) / Math.max(a[1], FIELD_FLOOR)));
    const per10 = dB * (10 / azSpan);
    if (per10 > worstSmoothness.delta_db_per_10deg){
      worstSmoothness = { from_az: a[0], to_az: b[0], delta_db_per_10deg: round2(per10) };
    }
  };
  for (let i = 0; i < pts.length - 1; i++) checkAdjacent(i, i + 1);
  checkAdjacent(pts.length - 1, 0);  // wrap

  const smoothnessPass = worstSmoothness.delta_db_per_10deg <= SMOOTHNESS_DB_PER_10DEG_LIMIT;
  findings.push({
    rule:      'smoothness',
    citation:  '§73.150 — relative field may not change more than 2 dB per 10° over protection azimuths',
    limit:     `${SMOOTHNESS_DB_PER_10DEG_LIMIT} dB per 10°`,
    observed:  `${worstSmoothness.delta_db_per_10deg} dB per 10° between az ${fmtAz(worstSmoothness.from_az)} and ${fmtAz(worstSmoothness.to_az)}`,
    pass:      smoothnessPass,
    detail:    smoothnessPass
      ? 'Pattern transitions are within §73.150 smoothness tolerance.'
      : 'Pattern transitions exceed §73.150 smoothness tolerance — FCC will not authorize a pattern this jagged; verify the filed pattern_table azimuth spacing matches the authorized pattern document.'
  });

  // ---- Rule 2: MAX:MIN ratio (15 dB) -------------------------------
  let maxField = 0;
  let minField = Infinity;
  for (const [, f] of pts){
    if (f > maxField) maxField = f;
    if (f < minField) minField = f;
  }
  const maxToMinDb = 20 * Math.log10(Math.max(maxField, FIELD_FLOOR) / Math.max(minField, FIELD_FLOOR));
  const maxToMinPass = maxToMinDb <= MAX_TO_MIN_DB_LIMIT;
  findings.push({
    rule:      'max_to_min_ratio',
    citation:  '§73.150 — maximum-to-minimum relative-field ratio may not exceed 15 dB',
    limit:     `${MAX_TO_MIN_DB_LIMIT} dB`,
    observed:  `${round2(maxToMinDb)} dB (max f=${round3(maxField)}, min f=${round3(minField)})`,
    pass:      maxToMinPass,
    detail:    maxToMinPass
      ? 'Max:min ratio is within §73.150 limit.'
      : 'Max:min ratio exceeds §73.150 limit — pattern has nulls deeper than the rule allows; redesign with shallower nulls or pursue a different licensing path.'
  });

  // ---- Rule 3: RMS minimum (85% of authorized) ---------------------
  const asBuiltRms = rms(pts.map(([, f]) => f));
  if (Array.isArray(authorized_pattern_table) && authorized_pattern_table.length >= 2){
    const authPts = authorized_pattern_table
      .map(([az, f]) => [((Number(az) % 360) + 360) % 360, Number(f)])
      .filter(([az, f]) => Number.isFinite(az) && Number.isFinite(f) && f >= 0);
    const authRms = rms(authPts.map(([, f]) => f));
    const fraction = authRms > 0 ? asBuiltRms / authRms : null;
    const rmsPass = fraction != null && fraction >= RMS_MIN_FRACTION;
    findings.push({
      rule:      'rms_minimum',
      citation:  '§73.150 — as-built RMS must be ≥ 85% of authorized RMS',
      limit:     `${(RMS_MIN_FRACTION * 100).toFixed(0)}% of authorized`,
      observed:  fraction != null
                  ? `${round2(fraction * 100)}% (as-built RMS=${round3(asBuiltRms)}, authorized RMS=${round3(authRms)})`
                  : 'cannot compute (authorized RMS is zero)',
      pass:      rmsPass,
      detail:    rmsPass
        ? 'As-built RMS meets the §73.150 85% minimum.'
        : 'As-built RMS falls below 85% of authorized — antenna is not radiating the licensed pattern strength; re-tune or re-file.'
    });
  } else {
    findings.push({
      rule:      'rms_minimum',
      citation:  '§73.150 — as-built RMS must be ≥ 85% of authorized RMS',
      limit:     `${(RMS_MIN_FRACTION * 100).toFixed(0)}% of authorized`,
      observed:  `as-built RMS=${round3(asBuiltRms)} (no authorized_pattern_table attached for comparison)`,
      pass:      null,
      detail:    'Not measured — supply an authorized_pattern_table alongside the filed pattern_table to enable the 85% RMS check.'
    });
  }

  // Overall pass: every rule with a non-null pass must be true.
  const decisive = findings.filter((f) => f.pass !== null);
  const overall_pass = decisive.length > 0 && decisive.every((f) => f.pass === true);

  return {
    applicable: true,
    regulation,
    findings,
    overall_pass,
    summary: overall_pass
      ? 'All §73.150 pattern-shape checks pass.'
      : 'One or more §73.150 pattern-shape checks failed or are unverifiable — see findings.'
  };
}

// ─────────── helpers ───────────
function wrappedAzSpan(a, b){
  // Smallest azimuth distance (degrees) from a to b along the
  // forward (a → b) direction; if a > b it wraps through 360.
  const raw = (b - a + 360) % 360;
  // For adjacent pairs in a sorted array the wrap-pair (last→first)
  // will naturally evaluate as 360 - last + first, which is correct.
  return raw === 0 ? 360 : raw;
}
function rms(arr){
  if (!Array.isArray(arr) || arr.length === 0) return 0;
  const sumSq = arr.reduce((s, v) => s + (Number(v) || 0) ** 2, 0);
  return Math.sqrt(sumSq / arr.length);
}
function fmtAz(az){
  return Number.isFinite(az) ? `${Number(az).toFixed(0)}°` : '—';
}
function round2(x){ return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; }
function round3(x){ return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null; }
