// AM Regional Relocation Optimizer — screening-grade candidate ranking.
//
// PURPOSE
//   An AM licensee whose current site is becoming untenable (lease,
//   zoning, wildfire risk, environmental, etc.) needs to evaluate
//   candidate relocation sites within a regional radius BEFORE
//   committing engineering resources to a single design.  This module
//   builds a grid of candidate sites around the current location,
//   scores each one against a configurable set of optimization goals,
//   and returns a ranked list with per-candidate explainability.
//
// WHAT THIS IS NOT
//   This is a SCREENING tool.  Every candidate carries an
//   "ENGINEER REVIEW REQUIRED" label and the response is explicitly
//   tagged "SCREENING ONLY" — the output is intended to help an
//   engineer narrow the search to 3-5 promising sites that then get
//   the real full-physics treatment (skywave NIF contour, §73.182
//   nighttime, DA-N pattern design, parcel availability, environmental
//   review, treaty consultation if applicable, etc.).
//
// PURITY
//   No IO except calling fccAmDistanceKm() from the vendored FCC
//   gwave path for groundwave distance estimates.  Deterministic on
//   the same inputs.
//
// REFERENCES
//   - 47 CFR §73.24(g) blanket-interference 1% population limit
//   - 47 CFR §73.24(j) principal community 5 mV/m coverage rule
//   - 47 CFR §73.184 groundwave method (FCC gwave.js)
//   - US/Mexico AM Agreement (1986); US/Canada AM treaty

import { fccAmDistanceKm } from '../curves/fcc/index.mjs';
import { detectInternationalBorder } from '../regulatory/internationalBorderDetect.js';

// ---------- thresholds & weights ----------

// Hard non-compliance bars.  Failing any of these flags a candidate
// NON-COMPLIANT and excludes it from the PROMISING pool (§73.24 floors).
const COL_COVERAGE_HARD_FLOOR    = 0.80;   // §73.24(j) substantial-compliance threshold
const BLANKET_POP_HARD_CEIL_PCT  = 1.0;    // §73.24(g) 1% limit on persons inside 1000 mV/m
const PROMISING_TOP_QUANTILE     = 0.75;   // top 25% of score → PROMISING (and no NON-COMPLIANT)

// Treaty-zone soft bias (when minimize_int_treaty_zone is enabled).
const TREATY_ZONE_PENALTY_KM_MX  = 320;    // 1986 US/MX agreement applicability outer band
const TREATY_ZONE_PENALTY_KM_CA  = 800;    // US/CA letter of understanding outer band

// Groundwave target field for "daytime reach" estimate (mV/m).  0.5 mV/m
// is the §73.24 default secondary daytime contour — what the operator
// generally cares about for "how far does my station reach."
const DAYTIME_REACH_TARGET_MVM = 0.5;

// Conductivity target — M3-zone high end is 8 mS/m (rule §73.184).
const SIGMA_PREFERRED_MIN_MSM = 8;

// Earth radius for great-circle math (mean, km).
const R_EARTH_KM = 6371.0088;

// Goals enum — these are the keys the API exposes.  The set is fixed;
// unknown keys in the request are ignored (forward-compatibility for UI).
const KNOWN_GOALS = Object.freeze([
  'maximize_col_coverage',
  'maximize_population',
  'minimize_blanket_population',
  'avoid_wildfire_risk',
  'prefer_high_conductivity',
  'minimize_int_treaty_zone'
]);

// Goals that are placeholders for the screening-grade pipeline; if
// enabled, surface them in the candidate's limitations[] so the
// operator knows the sub-score isn't backed by real data yet.
const PLACEHOLDER_GOALS = Object.freeze({
  avoid_wildfire_risk: 'Wildfire / fuel-risk scoring not yet wired (USFS FIA / LANDFIRE integration deferred)',
});

// Status-label vocabulary.
const LABEL_SCREENING        = 'SCREENING ONLY';
const LABEL_PROMISING        = 'PROMISING';
const LABEL_NON_COMPLIANT    = 'NON-COMPLIANT';
const LABEL_REVIEW_REQUIRED  = 'REVIEW REQUIRED';
const LABEL_ENGINEER_REVIEW  = 'ENGINEER REVIEW REQUIRED';
const LABEL_NOT_EVALUATED    = 'NOT-EVALUATED';

// ---------- public API ----------

/**
 * Run the site optimizer.
 *
 * @param {object} body              the POST body — see route file for shape.
 * @param {string} body.callsign
 * @param {number} body.frequency_khz
 * @param {{lat:number,lon:number}} body.current_site
 * @param {number} body.search_radius_km
 * @param {number} body.grid_spacing_km
 * @param {number} body.tpo_kw       transmitter power output (kW)
 * @param {string} body.pattern_mode 'NDA' | 'DA-D' | 'DA-N' | 'DA-2' | …
 * @param {string} body.fcc_class    'A' | 'B' | 'C' | 'D'
 * @param {object} [body.community_of_license_polygon]  GeoJSON Polygon (optional)
 * @param {object} body.optimization_goals  flags — see KNOWN_GOALS
 * @param {object} [body.candidate_limit]   how many ranked results to return (default 20)
 *
 * @returns {{
 *   available:boolean,
 *   n_candidates_evaluated:number,
 *   n_candidates_returned:number,
 *   current_site_baseline:object,
 *   candidates:object[],
 *   inputs_echo:object,
 *   warnings:string[],
 *   method:string
 * }}
 */
export function runSiteOptimizer(body = {}){
  const warnings = [];

  // ---- 1. validate & echo inputs ----
  const v = validateInputs(body, warnings);
  if (!v.ok){
    return { available: false, error: v.error, inputs_echo: body };
  }
  const {
    callsign, frequency_khz, current_site, search_radius_km,
    grid_spacing_km, tpo_kw, pattern_mode, fcc_class,
    community_of_license_polygon, goals, candidate_limit
  } = v.value;

  // ---- 2. build candidate grid ----
  const gridPoints = buildGridCandidates({
    center: current_site,
    radius_km: search_radius_km,
    spacing_km: grid_spacing_km
  });

  // Always include the current site as the first candidate so the
  // operator can see how their existing location scores under the
  // same rubric (the "baseline").
  ensureCurrentSiteIncluded(gridPoints, current_site);

  // ---- 3. score every candidate ----
  const ctx = {
    callsign,
    frequency_khz,
    tpo_kw,
    pattern_mode,
    fcc_class,
    community_of_license_polygon,
    goals,
    current_site
  };
  const scored = gridPoints.map((pt) => scoreCandidate(pt, ctx, warnings));

  // ---- 4. rank, label, slice ----
  scored.sort((a, b) => b.score - a.score);

  const scoreCutoff = quantile(scored.map((c) => c.score), PROMISING_TOP_QUANTILE);
  for (const c of scored){
    finalizeLabels(c, scoreCutoff);
  }

  // Re-rank after labeling and assign rank index.
  scored.forEach((c, i) => { c.rank = i + 1; });

  // Baseline = the score row for the current site (search by coord match).
  const baseline = scored.find((c) => coordsEqual(c, current_site)) || null;

  const returned = scored.slice(0, candidate_limit);

  return {
    available: true,
    method: 'grid-search + per-goal sub-scoring (SCREENING ONLY)',
    n_candidates_evaluated: scored.length,
    n_candidates_returned:  returned.length,
    current_site_baseline:  baselineSummary(baseline),
    candidates: returned,
    inputs_echo: {
      callsign, frequency_khz, current_site, search_radius_km,
      grid_spacing_km, tpo_kw, pattern_mode, fcc_class,
      goals_enabled: Object.entries(goals).filter(([_, v]) => v).map(([k]) => k),
      community_of_license_polygon_provided: !!community_of_license_polygon,
      candidate_limit
    },
    warnings,
    limitations_global: [
      'Screening-grade output only; engineer-grade NIF / §73.182 / DA-N analysis is required for any filing.',
      'Population sub-score uses a population-density proxy (groundwave reach × density model), not a Census-block sum.',
      'Wildfire / fuel-risk scoring is a placeholder until USFS FIA / LANDFIRE integration lands.',
      'Parcel / zoning availability is not checked — engineer must verify each site is leasable / buildable.',
      'No skywave (§73.182) interference analysis is performed at this stage.'
    ]
  };
}

// ---------- input validation ----------

function validateInputs(body, warnings){
  const err = (msg) => ({ ok: false, error: msg });

  const callsign = String(body.callsign || '').trim().toUpperCase();
  if (!callsign) return err('callsign required');

  const frequency_khz = Number(body.frequency_khz);
  if (!Number.isFinite(frequency_khz) || frequency_khz < 530 || frequency_khz > 1700){
    return err('frequency_khz must be in 530..1700');
  }

  const current_site = body.current_site || {};
  const lat = Number(current_site.lat), lon = Number(current_site.lon);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return err('current_site.lat invalid');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) return err('current_site.lon invalid');

  const search_radius_km = Number(body.search_radius_km);
  if (!Number.isFinite(search_radius_km) || search_radius_km <= 0 || search_radius_km > 500){
    return err('search_radius_km must be in (0, 500]');
  }

  const grid_spacing_km = Number(body.grid_spacing_km);
  if (!Number.isFinite(grid_spacing_km) || grid_spacing_km <= 0){
    return err('grid_spacing_km must be > 0');
  }
  if (grid_spacing_km > search_radius_km){
    warnings.push(`grid_spacing_km (${grid_spacing_km}) exceeds search_radius_km (${search_radius_km}); only the current-site point will be evaluated.`);
  }

  // Safety cap on grid size — protects the API from a DOS-y request.
  const est_n = Math.ceil((2 * search_radius_km / grid_spacing_km) + 1) ** 2;
  if (est_n > 10_000){
    return err(`grid would generate ~${est_n} candidates (>10,000 limit); increase grid_spacing_km or shrink search_radius_km`);
  }

  const tpo_kw = Number(body.tpo_kw);
  if (!Number.isFinite(tpo_kw) || tpo_kw <= 0) return err('tpo_kw must be > 0');

  const pattern_mode = String(body.pattern_mode || 'NDA').toUpperCase();
  const fcc_class    = String(body.fcc_class || 'D').toUpperCase();

  const goals = normalizeGoals(body.optimization_goals);

  const candidate_limit = Number.isFinite(Number(body.candidate_limit))
    ? Math.max(1, Math.min(200, Math.floor(Number(body.candidate_limit))))
    : 20;

  return {
    ok: true,
    value: {
      callsign, frequency_khz,
      current_site: { lat, lon },
      search_radius_km, grid_spacing_km, tpo_kw,
      pattern_mode, fcc_class,
      community_of_license_polygon: body.community_of_license_polygon || null,
      goals,
      candidate_limit
    }
  };
}

function normalizeGoals(raw){
  const out = {};
  for (const key of KNOWN_GOALS){
    out[key] = !!(raw && raw[key]);
  }
  return out;
}

// ---------- grid generation ----------

/**
 * Build a square grid of candidate (lat, lon) pairs centered on
 * `center`, with `spacing_km` between adjacent grid lines, clipped to
 * a great-circle radius of `radius_km`.  Uses a local equirectangular
 * approximation — at AM regional scales (≤ 500 km) cross-track error
 * is well under 1% which is far below the resolution of the per-goal
 * sub-scores.
 */
function buildGridCandidates({ center, radius_km, spacing_km }){
  const cosLat = Math.cos(center.lat * Math.PI / 180);
  // Δlat / Δlon per km of grid spacing.
  const dLatPerKm = 1 / (R_EARTH_KM * Math.PI / 180);
  const dLonPerKm = 1 / (R_EARTH_KM * Math.PI / 180 * Math.max(cosLat, 1e-6));

  const n = Math.floor(radius_km / spacing_km);
  const points = [];
  for (let iy = -n; iy <= n; iy++){
    for (let ix = -n; ix <= n; ix++){
      const lat = center.lat + iy * spacing_km * dLatPerKm;
      const lon = center.lon + ix * spacing_km * dLonPerKm;
      const d = greatCircleKm(center.lat, center.lon, lat, lon);
      if (d <= radius_km + 1e-6){
        points.push({ lat, lon, distance_from_current_km: d });
      }
    }
  }
  return points;
}

function ensureCurrentSiteIncluded(points, current){
  if (!points.some((p) => coordsEqual(p, current))){
    points.push({ lat: current.lat, lon: current.lon, distance_from_current_km: 0 });
  }
}

// ---------- per-candidate scoring ----------

/**
 * Score one candidate.  Returns an object matching the per-candidate
 * shape documented on the route.
 */
function scoreCandidate(pt, ctx, warnings){
  const { frequency_khz, tpo_kw, current_site, goals,
          community_of_license_polygon } = ctx;

  // --- raw sub-metrics (computed independent of weighting) ---

  // 1. Groundwave "daytime reach" — distance to DAYTIME_REACH_TARGET_MVM.
  //    Uses a generic ground conductivity (M3 σ for the western US is
  //    typically 4 mS/m; we assume 4 mS/m as a screening default until
  //    we have a real ground-conductivity raster wired into the grid).
  //    Both the candidate and the current site use the same sigma so
  //    relative comparisons are still valid.
  const sigma_msm = screeningGroundSigmaMsm(pt);
  let daytime_reach_km = null;
  try {
    const r = fccAmDistanceKm({
      frequency_khz,
      target_mvm: DAYTIME_REACH_TARGET_MVM,
      conductivity_msm: sigma_msm,
      erp_kw: tpo_kw
    });
    daytime_reach_km = r.distance_km;
  } catch (e){
    // M3 / range errors fall through to NOT-EVALUATED for this candidate.
    warnings.push(`fccAmDistanceKm failed at (${pt.lat.toFixed(3)}, ${pt.lon.toFixed(3)}): ${e.message}`);
  }

  // 2. Principal-community coverage (§73.24(j)).  When a polygon was
  //    supplied we compute the fraction of the COL boundary inside the
  //    5 mV/m daytime contour (modeled as a circle of radius =
  //    fccAmDistanceKm(target=5 mV/m)).  When no polygon was supplied
  //    we estimate "coverage" as the fraction of the COL polygon
  //    proxy (a 10-km disc centered on the current site, treated as a
  //    rough community) inside the 5-mV/m circle.
  let coverage_pct = null;
  let coverage_computed_from = 'none';
  try {
    const r5 = fccAmDistanceKm({
      frequency_khz,
      target_mvm: 5.0,
      conductivity_msm: sigma_msm,
      erp_kw: tpo_kw
    });
    const r5km = r5.distance_km;
    if (community_of_license_polygon){
      coverage_pct = polygonCoverageFraction({
        polygon: community_of_license_polygon,
        circle_center: pt,
        circle_radius_km: r5km
      });
      coverage_computed_from = 'polygon-overlap (Monte-Carlo)';
    } else {
      // Proxy COL = 10 km disc around the OPERATOR'S current site —
      // i.e., the community of license stays where it is even when
      // the transmitter moves.
      coverage_pct = discCoverageFraction({
        circle_center: pt,
        circle_radius_km: r5km,
        disc_center: current_site,
        disc_radius_km: 10
      });
      coverage_computed_from = 'disc-disc analytical proxy (10 km COL)';
    }
  } catch (e){
    warnings.push(`fccAmDistanceKm(5 mV/m) failed: ${e.message}`);
  }

  // 3. Blanket population — pop inside the 1000 mV/m contour as a
  //    fraction of pop inside the 25 mV/m contour.  Screening proxy:
  //    we assume uniform pop density and the ratio is (area_1000 /
  //    area_25) × density_modifier_for_candidate_vs_current.  This
  //    UNDER-estimates urban blanket populations; the engineer-grade
  //    pipeline must be used for filing.
  let blanket_population_pct = null;
  try {
    const r1000 = fccAmDistanceKm({ frequency_khz, target_mvm: 1000, conductivity_msm: sigma_msm, erp_kw: tpo_kw }).distance_km;
    const r25   = fccAmDistanceKm({ frequency_khz, target_mvm: 25,   conductivity_msm: sigma_msm, erp_kw: tpo_kw }).distance_km;
    // Density modifier: candidates closer to the current site live in
    // the same metro and inherit ~1.0 modifier; candidates farther
    // out are assumed to be progressively less populated.  This is a
    // crude monotonic surrogate — the real check is a Census-block
    // population sum which lives in the engineer-grade pipeline.
    const distRatio = Math.min(1, pt.distance_from_current_km / 50);
    const densityProxy = 1 - 0.7 * distRatio;
    const areaRatio = (Math.PI * r1000 * r1000) / Math.max(Math.PI * r25 * r25, 1e-9);
    blanket_population_pct = areaRatio * densityProxy * 100;
  } catch (_){ /* leave null */ }

  // 4. NIF status (screening grade) — pass-through for now; future
  //    versions will run a partial §73.182 NIF screening here.
  const nif_status = 'SCREENING ONLY';

  // 5. International border / treaty zone.
  let treaty_zone = null;
  let treaty_min_border_km = null;
  try {
    const b = detectInternationalBorder({ lat: pt.lat, lon: pt.lon });
    if (b.available){
      treaty_min_border_km = Math.min(b.distances.us_mx_km ?? Infinity, b.distances.us_ca_km ?? Infinity);
      if (b.inside_treaty_zone){
        treaty_zone = b.treaties.map((t) => t.treaty).join('; ');
      }
    }
  } catch (_){ /* leave null */ }

  // --- per-goal sub-scores (0..100) ---

  const sub = {
    col_coverage: coverage_pct == null ? null : Math.max(0, Math.min(100, coverage_pct * 100)),
    population:   daytime_reach_km == null ? null
      : Math.max(0, Math.min(100, (daytime_reach_km / 50) * 100)),   // 50 km reach → 100
    blanket:      blanket_population_pct == null ? null
      // Lower is better.  0% blanket pop → 100 score; 1% → 50; 2% → 0.
      : Math.max(0, Math.min(100, 100 - 50 * blanket_population_pct)),
    conductivity: Math.max(0, Math.min(100, (sigma_msm / SIGMA_PREFERRED_MIN_MSM) * 100)),
    wildfire:     null,   // placeholder
    treaty_zone:  treaty_min_border_km == null ? null
      // Farther from border = better; saturates at the treaty threshold.
      : Math.max(0, Math.min(100, (treaty_min_border_km / TREATY_ZONE_PENALTY_KM_MX) * 100))
  };

  // --- weighting & combination ---
  const enabled = goals;
  const weightPool = {
    maximize_col_coverage:        enabled.maximize_col_coverage        ? 35 : 0,
    maximize_population:          enabled.maximize_population          ? 28 : 0,
    minimize_blanket_population:  enabled.minimize_blanket_population  ? 14 : 0,
    prefer_high_conductivity:     enabled.prefer_high_conductivity     ? 10 : 0,
    avoid_wildfire_risk:          enabled.avoid_wildfire_risk          ?  4 : 0,
    minimize_int_treaty_zone:     enabled.minimize_int_treaty_zone     ?  4 : 0
  };
  // Map goal-key → sub-score key.
  const subKey = {
    maximize_col_coverage:        'col_coverage',
    maximize_population:          'population',
    minimize_blanket_population:  'blanket',
    prefer_high_conductivity:     'conductivity',
    avoid_wildfire_risk:          'wildfire',
    minimize_int_treaty_zone:     'treaty_zone'
  };

  const score_breakdown = {};
  let total = 0;
  let weightSum = 0;
  for (const [goal, w] of Object.entries(weightPool)){
    if (w === 0){
      score_breakdown[subKey[goal]] = 0;
      continue;
    }
    const s = sub[subKey[goal]];
    // null sub-score → contributes 0 but full weight still counted so
    // a NOT-EVALUATED metric doesn't artificially boost the score.
    const pts = s == null ? 0 : (s / 100) * w;
    score_breakdown[subKey[goal]] = round2(pts);
    total += pts;
    weightSum += w;
  }

  // Normalize to 0..100 even when only a subset of goals is enabled.
  const score = weightSum > 0 ? round2(total * (100 / weightSum)) : 0;

  // --- compliance & label flags ---
  const flags = [];
  if (coverage_pct != null && coverage_pct < COL_COVERAGE_HARD_FLOOR){
    flags.push(`COL coverage ${(coverage_pct * 100).toFixed(0)}% < §73.24(j) ${(COL_COVERAGE_HARD_FLOOR * 100).toFixed(0)}% floor`);
  }
  if (blanket_population_pct != null && blanket_population_pct > BLANKET_POP_HARD_CEIL_PCT){
    flags.push(`Blanket population ${blanket_population_pct.toFixed(2)}% > §73.24(g) 1% ceiling`);
  }

  // --- limitations array (placeholders + missing data) ---
  const limitations = [];
  if (goals.avoid_wildfire_risk) limitations.push(PLACEHOLDER_GOALS.avoid_wildfire_risk);
  if (!community_of_license_polygon){
    limitations.push('Principal-community coverage uses a 10-km disc proxy; supply community_of_license_polygon for filing-grade overlap.');
  }
  limitations.push('Parcel / zoning availability not checked.');
  limitations.push('NIF status is SCREENING-grade only — full §73.182 nighttime analysis required for filing.');

  // --- ranking_rationale sentence ---
  const rationale = buildRationale({
    coverage_pct, daytime_reach_km, blanket_population_pct,
    sigma_msm, distance_from_current_km: pt.distance_from_current_km,
    treaty_zone, flags
  });

  return {
    lat: round6(pt.lat),
    lon: round6(pt.lon),
    distance_from_current_km: round2(pt.distance_from_current_km),
    score,
    col_coverage_pct:        coverage_pct == null ? null : round2(coverage_pct),
    nif_status,
    daytime_reach_km:        daytime_reach_km == null ? null : round2(daytime_reach_km),
    blanket_population_pct:  blanket_population_pct == null ? null : round2(blanket_population_pct),
    ground_sigma_mS_m:       sigma_msm,
    treaty_zone,
    fuel_risk:               LABEL_NOT_EVALUATED,
    notes: buildNotes({ coverage_pct, sigma_msm, blanket_population_pct, distance_from_current_km: pt.distance_from_current_km }),
    explanation: {
      score_breakdown: roundBreakdown(score_breakdown),
      ranking_rationale: rationale,
      weights_pool: weightPool,
      coverage_computed_from
    },
    status_labels: [LABEL_SCREENING, LABEL_ENGINEER_REVIEW],  // base set; finalizeLabels() adds more
    _flags: flags,                                            // private: removed in finalizeLabels
    limitations
  };
}

// ---------- finalize per-candidate labels after ranking ----------

function finalizeLabels(c, scoreCutoff){
  const labels = new Set(c.status_labels);
  labels.add(LABEL_SCREENING);
  labels.add(LABEL_ENGINEER_REVIEW);

  if (c._flags && c._flags.length){
    labels.add(LABEL_NON_COMPLIANT);
  } else if (c.score >= scoreCutoff){
    labels.add(LABEL_PROMISING);
  } else if (c.score >= scoreCutoff * 0.85){
    // Borderline — within 15% of the PROMISING cutoff.
    labels.add(LABEL_REVIEW_REQUIRED);
  }
  // Update the candidate's nif_status to PROMISING / NON-COMPLIANT
  // mirror per the API contract.
  if (labels.has(LABEL_NON_COMPLIANT))      c.nif_status = LABEL_NON_COMPLIANT;
  else if (labels.has(LABEL_PROMISING))     c.nif_status = LABEL_PROMISING;
  // else leave at 'SCREENING ONLY'

  c.status_labels = Array.from(labels);
  // Lift the flags to limitations and remove the private field.
  if (c._flags && c._flags.length){
    for (const f of c._flags){
      c.limitations.unshift(`HARD CHECK FAIL: ${f}`);
    }
  }
  delete c._flags;
}

// ---------- baseline summary ----------

function baselineSummary(b){
  if (!b) return null;
  return {
    lat: b.lat, lon: b.lon,
    score: b.score,
    col_coverage_pct:       b.col_coverage_pct,
    daytime_reach_km:       b.daytime_reach_km,
    blanket_population_pct: b.blanket_population_pct,
    ground_sigma_mS_m:      b.ground_sigma_mS_m,
    nif_status:             b.nif_status,
    treaty_zone:            b.treaty_zone,
    status_labels:          b.status_labels
  };
}

// ---------- explanatory text builders ----------

function buildNotes({ coverage_pct, sigma_msm, blanket_population_pct, distance_from_current_km }){
  const parts = [];
  if (coverage_pct != null) parts.push(`${(coverage_pct * 100).toFixed(0)}% city-coverage`);
  if (sigma_msm   != null) parts.push(`σ=${sigma_msm} mS/m`);
  if (blanket_population_pct != null) parts.push(`${blanket_population_pct.toFixed(1)}% blanket pop`);
  parts.push(`${distance_from_current_km.toFixed(0)} km from current`);
  return parts.join(', ') + '.';
}

function buildRationale({ coverage_pct, daytime_reach_km, blanket_population_pct, sigma_msm,
                          distance_from_current_km, treaty_zone, flags }){
  if (flags.length){
    return `Non-compliant on screening: ${flags.join('; ')}.  Engineer-grade analysis required before filing.`;
  }
  const bits = [];
  if (coverage_pct != null && coverage_pct >= 0.95){
    bits.push(`Strong COL coverage at ${(coverage_pct * 100).toFixed(0)}%`);
  } else if (coverage_pct != null){
    bits.push(`COL coverage ${(coverage_pct * 100).toFixed(0)}% (above §73.24(j) substantial-compliance floor)`);
  }
  if (daytime_reach_km != null){
    bits.push(`daytime 0.5 mV/m reach ${daytime_reach_km.toFixed(0)} km`);
  }
  if (sigma_msm >= SIGMA_PREFERRED_MIN_MSM){
    bits.push(`σ=${sigma_msm} mS/m at M3 high end`);
  }
  if (blanket_population_pct != null && blanket_population_pct < 0.5){
    bits.push(`${blanket_population_pct.toFixed(1)}% blanket population well under §73.24(g) 1% limit`);
  }
  if (treaty_zone) bits.push(`inside ${treaty_zone} treaty zone — verify cross-border §73.187 obligations`);
  bits.push(`${distance_from_current_km.toFixed(0)} km from current site`);
  return bits.join('; ') + '.';
}

// ---------- screening-grade ground sigma helper ----------

// Without a real ground-conductivity raster we use a coarse latitude
// band heuristic that matches the FCC M3 map's gross structure: the
// US Southwest / interior is ~4 mS/m, the Gulf coast and Florida are
// ~8-15 mS/m, the northern Plains and Great Lakes ~6 mS/m, the
// Pacific Northwest ~4 mS/m, and ocean ~30 mS/m.  This is purely a
// screening surrogate — every candidate carries a "σ assumed from
// regional bin" note via the engineer-review label.
function screeningGroundSigmaMsm(pt){
  const lat = pt.lat, lon = pt.lon;
  // Florida + Gulf coast band (high sigma, moist soils).
  if (lat >= 25 && lat <= 31 && lon >= -98 && lon <= -80) return 8;
  // Great Lakes + northeast.
  if (lat >= 41 && lat <= 47 && lon >= -90 && lon <= -70) return 6;
  // Pacific Northwest coast.
  if (lat >= 42 && lat <= 49 && lon <= -120)              return 4;
  // Southwest interior (KAZM / Sedona is in this band).
  if (lat >= 30 && lat <= 42 && lon >= -120 && lon <= -100) return 4;
  // Northern Plains / Upper Midwest.
  if (lat >= 41 && lat <= 49 && lon >= -105 && lon <= -90) return 6;
  // Default — generic "average soil" M3 default.
  return 4;
}

// ---------- geometric helpers ----------

function greatCircleKm(lat1, lon1, lat2, lon2){
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const dφ = (lat2 - lat1) * Math.PI / 180;
  const dλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R_EARTH_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function coordsEqual(a, b, tol_deg = 1e-9){
  return Math.abs(a.lat - b.lat) < tol_deg && Math.abs(a.lon - b.lon) < tol_deg;
}

// Analytical fraction of disc B (radius rB at center cB) covered by
// disc A (radius rA at center cA).  Used as a no-polygon COL coverage
// proxy.  Returns a value in [0, 1].
function discCoverageFraction({ circle_center, circle_radius_km, disc_center, disc_radius_km }){
  const d = greatCircleKm(circle_center.lat, circle_center.lon, disc_center.lat, disc_center.lon);
  const rA = circle_radius_km, rB = disc_radius_km;
  if (d + rB <= rA) return 1;       // disc B is entirely inside disc A
  if (d >= rA + rB) return 0;       // no overlap
  // Otherwise compute the lens area / disc-B area.
  const aA = rA * rA;
  const aB = rB * rB;
  const t1 = Math.acos(Math.min(1, Math.max(-1, (d * d + aB - aA) / (2 * d * rB))));
  const t2 = Math.acos(Math.min(1, Math.max(-1, (d * d + aA - aB) / (2 * d * rA))));
  const lens = aB * t1 + aA * t2 - 0.5 * Math.sqrt(
    Math.max(0, (-d + rA + rB) * (d + rA - rB) * (d - rA + rB) * (d + rA + rB))
  );
  const areaB = Math.PI * aB;
  return Math.max(0, Math.min(1, lens / areaB));
}

// Monte-Carlo fraction of a GeoJSON Polygon covered by the disc
// (circle_center, circle_radius_km).  Polygon is assumed to be in
// [lon, lat] order per the GeoJSON spec.  Uses the polygon's bounding
// box × 1024 samples — deterministic via a seeded RNG so results are
// stable across calls.
function polygonCoverageFraction({ polygon, circle_center, circle_radius_km, n_samples = 1024 }){
  try {
    const ring = polygon.coordinates && polygon.coordinates[0];
    if (!Array.isArray(ring) || ring.length < 3) return null;
    let minLat =  Infinity, maxLat = -Infinity, minLon =  Infinity, maxLon = -Infinity;
    for (const [lon, lat] of ring){
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
    if (!Number.isFinite(minLat)) return null;

    // Deterministic LCG seeded from the polygon bbox + circle center
    // so two calls with the same inputs produce identical fractions.
    let s = Math.floor((minLat + maxLat + minLon + maxLon
                        + circle_center.lat + circle_center.lon) * 1e6) >>> 0;
    const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };

    let inPoly = 0, inBoth = 0;
    for (let i = 0; i < n_samples; i++){
      const lat = minLat + (maxLat - minLat) * rand();
      const lon = minLon + (maxLon - minLon) * rand();
      if (pointInPolygon(lat, lon, ring)){
        inPoly++;
        if (greatCircleKm(lat, lon, circle_center.lat, circle_center.lon) <= circle_radius_km){
          inBoth++;
        }
      }
    }
    return inPoly === 0 ? 0 : inBoth / inPoly;
  } catch (_) {
    return null;
  }
}

function pointInPolygon(lat, lon, ring){
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++){
    const [xi, yi] = ring[i];   // [lon, lat]
    const [xj, yj] = ring[j];
    const intersect = ((yi > lat) !== (yj > lat))
      && (lon < (xj - xi) * (lat - yi) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ---------- misc ----------

function quantile(arr, q){
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

function round2(x){ return Number.isFinite(x) ? Math.round(x * 100) / 100 : x; }
function round6(x){ return Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : x; }
function roundBreakdown(b){
  const o = {};
  for (const [k, v] of Object.entries(b)) o[k] = round2(v);
  return o;
}

// ---------- public test-only export ----------
// Exposed for unit tests.  Not part of the public API contract.
export const __test__ = {
  buildGridCandidates,
  scoreCandidate,
  validateInputs,
  greatCircleKm,
  discCoverageFraction,
  polygonCoverageFraction,
  screeningGroundSigmaMsm,
  KNOWN_GOALS
};
