// AM Co-Location Opportunity Engine — screening-grade host-site finder.
//
// PURPOSE
//   An AM operator who must relocate often has the option of moving to
//   an existing piece of vertical infrastructure (cellular tower,
//   registered antenna structure (ASR), FM/TV transmitter site, or
//   another AM plant) instead of building a brand-new tower farm.  This
//   module screens an inventory of known infrastructure sites within a
//   user-supplied radius of the current site and ranks them on the same
//   coverage / interference rubric used by the AM Site Optimizer, with
//   additional co-location-specific advisories (diplexing risk, ASR
//   notification reminders, structural-engineering caveats, etc.).
//
// SEARCH MODES
//   - GRID            : identical to the AM Site Optimizer (no infra).
//   - INFRASTRUCTURE  : only score real infrastructure sites.
//   - HYBRID (default): grid + infrastructure scored in a single pool.
//
// STATUS CATEGORIES
//   Each candidate gets a single `status_category` from a fixed
//   vocabulary so the UI can render a colored chip per result:
//     PROMISING, REVIEW_REQUIRED, RECOVERABLE_WITH_DA,
//     RECOVERABLE_WITH_REDUCED_POWER, RECOVERABLE_WITH_COL_CHANGE,
//     TREATY_REVIEW, NON_COMPLIANT, UNKNOWN_DATA.
//   The recovery-state logic is fully explained in
//   explanation.recovery_reasoning.
//
// PURITY
//   No IO except for the manual JSON inventory load (delegated to
//   manualInfrastructureClient).  All scoring is deterministic.

import { runSiteOptimizer, __test__ as SO } from './siteOptimizer.js';
import {
  loadManualInfrastructureSites,
  filterInfrastructureSites
} from '../../evidence/manualInfrastructureClient.js';

const KNOWN_SEARCH_MODES = Object.freeze(['GRID', 'INFRASTRUCTURE', 'HYBRID']);
const KNOWN_SOURCES      = Object.freeze(['MANUAL']);
// Future: 'ASR_REGISTRY', 'FCC_FMQ', 'FCC_AM' — surfaced as warning until wired.

// Co-location-specific thresholds.
const DIPLEX_RADIUS_KM            = 10;   // same-band AM host < 10 km → diplexing required
const SAME_BAND_INTERFERENCE_KHZ  = 20;   // freq delta ≤ this → HIGH risk on AM_SITE host
const COL_COVERAGE_HARD_FLOOR     = 0.80; // mirrors siteOptimizer §73.24(j)
const BLANKET_POP_HARD_CEIL_PCT   = 1.0;  // mirrors siteOptimizer §73.24(g)
const PROMISING_TOP_QUANTILE      = 0.75;
const RECOVERY_SCORE_FLOOR        = 55;   // recoverable categories need a base of usable rf merit
const NEARBY_COMMUNITY_RADIUS_KM  = 25;   // “populated nearby community” heuristic for COL_CHANGE

const HOST_KIND_LABEL = Object.freeze({
  TOWER:   'TOWER',
  ASR:     'ASR',
  AM_SITE: 'AM_SITE',
  FM_SITE: 'FM_SITE',
  TV_SITE: 'TV_SITE'
});

// ---------- public API ----------

/**
 * Run the co-location opportunity screener.
 *
 * @param {object} body  — see route file.
 * @returns {object} ranked candidates with co-location analytics.
 */
export function runColocationOpportunities(body = {}){
  const warnings = [];

  // ---- 1. validate ----
  const v = validateInputs(body, warnings);
  if (!v.ok){
    return { available: false, error: v.error, inputs_echo: body };
  }
  const {
    callsign, frequency_khz, current_site, search_radius_km,
    grid_spacing_km, tpo_kw, pattern_mode, fcc_class,
    community_of_license_polygon, goals, candidate_limit,
    search_mode, infrastructure_source, infrastructure_filters
  } = v.value;

  // ---- 2. choose path ----
  if (search_mode === 'GRID'){
    // Pure GRID: delegate to the site optimizer for an apples-to-apples
    // comparison, then re-shape candidates with source/infrastructure_ref
    // null fields and re-classify via our status taxonomy.
    const so = runSiteOptimizer({
      callsign, frequency_khz, current_site, search_radius_km,
      grid_spacing_km, tpo_kw, pattern_mode, fcc_class,
      community_of_license_polygon,
      optimization_goals: rawGoalFlags(goals),
      candidate_limit: Math.min(candidate_limit, 200)
    });
    if (so.available === false) return so;
    const candidates = so.candidates.map((c) => decorateGridCandidate(c));
    const cutoff = quantile(candidates.map((c) => c.score), PROMISING_TOP_QUANTILE);
    for (const c of candidates) assignStatusCategory(c, cutoff, { current_site });
    return composeResponse({
      method: 'GRID (delegated to siteOptimizer + co-location classifier)',
      candidates,
      n_candidates_evaluated: so.n_candidates_evaluated,
      baseline: so.current_site_baseline,
      inputs_echo: echoInputs({ callsign, frequency_khz, current_site,
        search_radius_km, grid_spacing_km, tpo_kw, pattern_mode, fcc_class,
        goals, candidate_limit, search_mode, infrastructure_source,
        infrastructure_filters, community_of_license_polygon }),
      warnings,
      so_limitations: so.limitations_global || []
    });
  }

  // INFRASTRUCTURE-only and HYBRID share the same pool builder.
  const ctx = {
    callsign, frequency_khz, tpo_kw, pattern_mode, fcc_class,
    community_of_license_polygon, goals, current_site
  };

  // ---- 3a. gather GRID candidates if applicable ----
  let gridScored = [];
  if (search_mode === 'HYBRID'){
    const gridPoints = SO.buildGridCandidates({
      center: current_site,
      radius_km: search_radius_km,
      spacing_km: grid_spacing_km
    });
    ensureCurrentSiteIncluded(gridPoints, current_site);
    gridScored = gridPoints.map((pt) => {
      const c = SO.scoreCandidate(pt, ctx, warnings);
      return decorateGridCandidate(c);
    });
  }

  // ---- 3b. gather INFRASTRUCTURE candidates ----
  let infraSites = [];
  if (infrastructure_source === 'MANUAL'){
    let raw;
    try {
      raw = loadManualInfrastructureSites();
    } catch (e) {
      warnings.push(`manual infrastructure inventory load failed: ${e.message}`);
      raw = [];
    }
    infraSites = filterInfrastructureSites(raw, {
      center: current_site,
      radius_km: search_radius_km,
      filters: infrastructure_filters
    });
  } else {
    warnings.push(`infrastructure_source ${infrastructure_source} not yet wired; returning empty infrastructure pool`);
  }

  const infraScored = infraSites.map((site) => scoreInfrastructureCandidate(site, ctx, warnings));

  // ---- 4. unify, rank, label ----
  const pool = gridScored.concat(infraScored);
  pool.sort((a, b) => b.score - a.score);

  const cutoff = quantile(pool.map((c) => c.score), PROMISING_TOP_QUANTILE);
  for (const c of pool) assignStatusCategory(c, cutoff, { current_site });

  pool.forEach((c, i) => { c.rank = i + 1; });

  // Baseline = score row for the current site, if it's in the pool.
  const baseline = pool.find((c) => coordsEqual(c, current_site));

  const returned = pool.slice(0, candidate_limit);

  return composeResponse({
    method: `${search_mode} (infrastructure source: ${infrastructure_source})`,
    candidates: returned,
    n_candidates_evaluated: pool.length,
    baseline: baseline ? baselineSummary(baseline) : null,
    inputs_echo: echoInputs({ callsign, frequency_khz, current_site,
      search_radius_km, grid_spacing_km, tpo_kw, pattern_mode, fcc_class,
      goals, candidate_limit, search_mode, infrastructure_source,
      infrastructure_filters, community_of_license_polygon }),
    warnings,
    so_limitations: []
  });
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

  // grid_spacing_km is only meaningful in GRID/HYBRID modes; default safely.
  const rawSpacing = Number(body.grid_spacing_km);
  const grid_spacing_km = Number.isFinite(rawSpacing) && rawSpacing > 0
    ? rawSpacing
    : Math.max(search_radius_km / 5, 1);  // a coarse default if unspecified

  const search_mode = String(body.search_mode || 'HYBRID').toUpperCase();
  if (!KNOWN_SEARCH_MODES.includes(search_mode)){
    return err(`search_mode must be one of ${KNOWN_SEARCH_MODES.join(', ')}`);
  }

  if (search_mode !== 'INFRASTRUCTURE'){
    if (grid_spacing_km > search_radius_km){
      warnings.push(`grid_spacing_km (${grid_spacing_km}) exceeds search_radius_km (${search_radius_km}); only the current-site point will be evaluated.`);
    }
    const est_n = Math.ceil((2 * search_radius_km / grid_spacing_km) + 1) ** 2;
    if (est_n > 10_000){
      return err(`grid would generate ~${est_n} candidates (>10,000 limit); increase grid_spacing_km or shrink search_radius_km`);
    }
  }

  const infrastructure_source = String(body.infrastructure_source || 'MANUAL').toUpperCase();
  if (!KNOWN_SOURCES.includes(infrastructure_source)){
    return err(`infrastructure_source must be one of ${KNOWN_SOURCES.join(', ')} (received ${infrastructure_source})`);
  }

  const tpo_kw = Number(body.tpo_kw);
  if (!Number.isFinite(tpo_kw) || tpo_kw <= 0) return err('tpo_kw must be > 0');

  const pattern_mode = String(body.pattern_mode || 'NDA').toUpperCase();
  const fcc_class    = String(body.fcc_class || 'D').toUpperCase();

  const goals = normalizeGoals(body.optimization_goals);

  const candidate_limit = Number.isFinite(Number(body.candidate_limit))
    ? Math.max(1, Math.min(200, Math.floor(Number(body.candidate_limit))))
    : 30;

  const infrastructure_filters = sanitizeFilters(body.infrastructure_filters);

  return {
    ok: true,
    value: {
      callsign, frequency_khz,
      current_site: { lat, lon },
      search_radius_km, grid_spacing_km, tpo_kw,
      pattern_mode, fcc_class,
      community_of_license_polygon: body.community_of_license_polygon || null,
      goals,
      candidate_limit,
      search_mode,
      infrastructure_source,
      infrastructure_filters
    }
  };
}

function normalizeGoals(raw){
  const out = {};
  for (const key of SO.KNOWN_GOALS){
    out[key] = !!(raw && raw[key]);
  }
  return out;
}

function rawGoalFlags(goals){
  // Re-emit a plain dict suitable for siteOptimizer's optimization_goals.
  const o = {};
  for (const k of SO.KNOWN_GOALS) o[k] = !!goals[k];
  return o;
}

function sanitizeFilters(raw){
  if (!raw || typeof raw !== 'object') return {};
  const allowedKeys = ['include_towers', 'include_asr', 'include_am_sites',
    'include_fm_sites', 'include_tv_sites', 'min_tower_height_m',
    'max_tower_height_m', 'owner_contains'];
  const out = {};
  for (const k of allowedKeys){
    if (raw[k] !== undefined) out[k] = raw[k];
  }
  return out;
}

// ---------- candidate construction ----------

function decorateGridCandidate(c){
  // Returns the same shape as scoreCandidate but with co-location fields.
  // (Pure-grid candidates aren't hosted on any inventory record.)
  const decorated = {
    ...c,
    source: 'GRID',
    infrastructure_ref: null,
    colocation_analysis: {
      distance_to_host_m: null,
      host_kind: null,
      host_owner: null,
      host_height_m: null,
      tower_loading_advisory: 'UNKNOWN',
      same_band_interference_risk: 'LOW',
      structural_engineering_required: true,
      shared_lease_advantage: false,
      diplexing_required: false,
      regulatory_notes: ['New-build site assumed; verify zoning / parcel availability.']
    }
  };
  return decorated;
}

function scoreInfrastructureCandidate(site, ctx, warnings){
  // The infrastructure site IS the candidate point.  We score it with
  // siteOptimizer's per-candidate scorer (which handles all of the
  // FCC-curve math and the 5 mV/m COL coverage check), then layer the
  // co-location advisory block on top.
  const pt = {
    lat: site.lat,
    lon: site.lon,
    distance_from_current_km: Number.isFinite(site.distance_from_center_km)
      ? site.distance_from_center_km
      : SO.greatCircleKm(ctx.current_site.lat, ctx.current_site.lon, site.lat, site.lon)
  };
  const scored = SO.scoreCandidate(pt, ctx, warnings);

  const hostKind = HOST_KIND_LABEL[site.kind] || null;
  const sameBandAm = site.kind === 'AM_SITE'
    && Number.isFinite(site.frequency_khz)
    && Math.abs(site.frequency_khz - ctx.frequency_khz) <= SAME_BAND_INTERFERENCE_KHZ;

  const distMeters = 0;  // candidate IS the infrastructure site
  const diplex = (site.kind === 'AM_SITE')
    && SO.greatCircleKm(ctx.current_site.lat, ctx.current_site.lon, site.lat, site.lon) <= DIPLEX_RADIUS_KM;

  const interferenceRisk = sameBandAm
    ? 'HIGH'
    : (site.kind === 'AM_SITE' ? 'MODERATE' : 'LOW');

  const regulatory_notes = [];
  if (site.asr_number){
    regulatory_notes.push(`ASR ${site.asr_number} registered – co-locate notification required (47 CFR §17 / §73.1692).`);
  }
  if (sameBandAm){
    regulatory_notes.push(`Same-band AM host on ${site.frequency_khz} kHz – §73.182 nighttime / IBOC interaction study required.`);
  }
  if (site.kind === 'AM_SITE' && !sameBandAm){
    regulatory_notes.push('Cross-band AM host – diplexer or detuning study recommended.');
  }
  if (site.kind === 'FM_SITE' || site.kind === 'TV_SITE'){
    regulatory_notes.push(`${site.kind} host – evaluate RF safety (47 CFR §1.1310 / OET-65) and IM products.`);
  }

  const decorated = {
    ...scored,
    source: 'INFRASTRUCTURE',
    infrastructure_ref: {
      id:             site.id ?? null,
      kind:           site.kind ?? null,
      name:           site.name ?? null,
      owner:          site.owner ?? null,
      lat:            site.lat,
      lon:            site.lon,
      height_m:       site.height_m ?? null,
      structure_type: site.structure_type ?? null,
      asr_number:     site.asr_number ?? null,
      frequency_khz:  site.frequency_khz ?? null,
      station_call:   site.station_call ?? null
    },
    colocation_analysis: {
      distance_to_host_m: distMeters,
      host_kind: hostKind,
      host_owner: site.owner ?? null,
      host_height_m: site.height_m ?? null,
      tower_loading_advisory: site.tower_loading_advisory || 'UNKNOWN',
      same_band_interference_risk: interferenceRisk,
      structural_engineering_required: site.tower_loading_advisory !== 'OK_PER_INVENTORY',
      shared_lease_advantage: true,
      diplexing_required: !!diplex,
      regulatory_notes
    }
  };
  return decorated;
}

// ---------- status classification ----------

function assignStatusCategory(c, scoreCutoff, { current_site }){
  // Pull the hard-fail signals out of the scoreCandidate output.
  const flags = collectHardFails(c);

  const treaty = !!c.treaty_zone;
  const colFail = c.col_coverage_pct != null && c.col_coverage_pct < COL_COVERAGE_HARD_FLOOR;
  const blanketFail = c.blanket_population_pct != null && c.blanket_population_pct > BLANKET_POP_HARD_CEIL_PCT;
  const missing = (c.col_coverage_pct == null) || (c.daytime_reach_km == null);

  const reasoning = [];
  let category;

  if (missing && c.score === 0){
    category = 'UNKNOWN_DATA';
    reasoning.push('Required FCC-curve / coverage metrics returned null; cannot classify.');
  } else if (treaty){
    // Treaty review supersedes the other recoverable categories — the
    // engineer must engage State Dept / FCC IB before any other action.
    category = 'TREATY_REVIEW';
    reasoning.push(`Candidate sits inside ${c.treaty_zone}; cross-border treaty review required.`);
  } else if (colFail && !blanketFail && c.score >= RECOVERY_SCORE_FLOOR){
    // COL coverage fails but the rest of the score is healthy — a DA
    // pattern can usually pull the 5 mV/m contour toward the city.
    if (c.distance_from_current_km <= NEARBY_COMMUNITY_RADIUS_KM){
      category = 'RECOVERABLE_WITH_DA';
      reasoning.push('Principal-community 5 mV/m contour shortfall is plausibly recoverable via directional-antenna design (§73.150).');
    } else {
      category = 'RECOVERABLE_WITH_COL_CHANGE';
      reasoning.push('Candidate is too far from current city of license for DA recovery; a community-of-license change application (§73.3573) may be the cleaner path.');
    }
  } else if (blanketFail && !colFail && c.score >= RECOVERY_SCORE_FLOOR){
    category = 'RECOVERABLE_WITH_REDUCED_POWER';
    reasoning.push(`Blanket population ${c.blanket_population_pct?.toFixed(2) ?? '?'}% exceeds §73.24(g) 1% limit; reducing TPO will shrink the 1000 mV/m blanket contour.`);
  } else if (flags.length >= 2){
    category = 'NON_COMPLIANT';
    reasoning.push(`Multiple hard failures: ${flags.join('; ')}.`);
  } else if (c.score >= scoreCutoff && flags.length === 0){
    category = 'PROMISING';
    reasoning.push('Score in top quantile with no hard rule failures on the screening rubric.');
  } else if (c.score >= scoreCutoff * 0.85){
    category = 'REVIEW_REQUIRED';
    reasoning.push('Score within 15% of the PROMISING cutoff – warrants engineer-grade follow-up before ruling in or out.');
  } else if (flags.length === 1){
    category = 'NON_COMPLIANT';
    reasoning.push(`Single hard failure not in a known recovery path: ${flags[0]}.`);
  } else {
    category = 'REVIEW_REQUIRED';
    reasoning.push('Below the PROMISING cutoff but without any hard failures – manual review recommended.');
  }

  // Co-location-specific overlays — never downgrade from TREATY_REVIEW
  // or NON_COMPLIANT, but DO add to the reasoning.
  if (c.colocation_analysis && c.colocation_analysis.diplexing_required){
    reasoning.push('Same-band AM host within 10 km → diplexer or detuning skirt required.');
  }
  if (c.colocation_analysis && c.colocation_analysis.same_band_interference_risk === 'HIGH'){
    reasoning.push('Same-band AM host on identical / adjacent frequency presents HIGH interference risk.');
  }

  c.status_category = category;
  c.explanation = c.explanation || {};
  c.explanation.recovery_reasoning = reasoning.join(' ');
}

function collectHardFails(c){
  // The siteOptimizer route exposes hard-fail strings via labels and
  // limitations after finalizeLabels(); since we call scoreCandidate
  // directly (without finalizeLabels), reconstruct from the raw fields.
  const flags = [];
  if (c.col_coverage_pct != null && c.col_coverage_pct < COL_COVERAGE_HARD_FLOOR){
    flags.push(`COL coverage ${(c.col_coverage_pct * 100).toFixed(0)}% < §73.24(j) floor`);
  }
  if (c.blanket_population_pct != null && c.blanket_population_pct > BLANKET_POP_HARD_CEIL_PCT){
    flags.push(`Blanket population ${c.blanket_population_pct.toFixed(2)}% > §73.24(g) 1% limit`);
  }
  return flags;
}

// ---------- response composition ----------

function composeResponse({ method, candidates, n_candidates_evaluated,
                            baseline, inputs_echo, warnings, so_limitations }){
  return {
    available: true,
    method,
    n_candidates_evaluated,
    n_candidates_returned: candidates.length,
    current_site_baseline: baseline,
    candidates,
    inputs_echo,
    warnings,
    limitations_global: [
      'Screening-grade output only; engineer-grade NIF / §73.182 / DA-N analysis is required for any filing.',
      'Co-location host inventory is the MANUAL seed file; not authoritative – verify with the host owner.',
      'No structural / TIA-222 loading study is performed – every infrastructure candidate carries structural_engineering_required:true unless the inventory explicitly marks otherwise.',
      'Diplexing flags are distance-based heuristics only; the actual study requires antenna currents and feedline analysis.',
      ...so_limitations
    ]
  };
}

function baselineSummary(b){
  return {
    lat: b.lat, lon: b.lon,
    score: b.score,
    col_coverage_pct:       b.col_coverage_pct,
    daytime_reach_km:       b.daytime_reach_km,
    blanket_population_pct: b.blanket_population_pct,
    ground_sigma_mS_m:      b.ground_sigma_mS_m,
    nif_status:             b.nif_status,
    treaty_zone:            b.treaty_zone,
    status_category:        b.status_category,
    status_labels:          b.status_labels,
    source:                 b.source
  };
}

function echoInputs(o){
  return {
    callsign: o.callsign,
    frequency_khz: o.frequency_khz,
    current_site: o.current_site,
    search_radius_km: o.search_radius_km,
    grid_spacing_km: o.grid_spacing_km,
    tpo_kw: o.tpo_kw,
    pattern_mode: o.pattern_mode,
    fcc_class: o.fcc_class,
    goals_enabled: Object.entries(o.goals).filter(([_, v]) => v).map(([k]) => k),
    community_of_license_polygon_provided: !!o.community_of_license_polygon,
    candidate_limit: o.candidate_limit,
    search_mode: o.search_mode,
    infrastructure_source: o.infrastructure_source,
    infrastructure_filters: o.infrastructure_filters || {}
  };
}

// ---------- small helpers ----------

function ensureCurrentSiteIncluded(points, current){
  if (!points.some((p) => coordsEqual(p, current))){
    points.push({ lat: current.lat, lon: current.lon, distance_from_current_km: 0 });
  }
}

function coordsEqual(a, b, tol_deg = 1e-9){
  return Math.abs(a.lat - b.lat) < tol_deg && Math.abs(a.lon - b.lon) < tol_deg;
}

function quantile(arr, q){
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

// ---------- test-only export ----------

export const __test__ = {
  validateInputs,
  scoreInfrastructureCandidate,
  decorateGridCandidate,
  assignStatusCategory,
  collectHardFails,
  KNOWN_SEARCH_MODES,
  KNOWN_SOURCES,
  DIPLEX_RADIUS_KM,
  SAME_BAND_INTERFERENCE_KHZ
};
