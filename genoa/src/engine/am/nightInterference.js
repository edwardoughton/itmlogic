// §73.182(k) RSS interference aggregation.
//
// Per 47 CFR §73.182(k):
//   "The interfering signals from all stations operating on the same
//   channel are combined into an aggregate value by the procedure
//   called the 'Root Sum Square' (RSS) method.  Interfering signals
//   less than 25 percent of the highest interfering signal received
//   in any one direction are not included..."
//
// This module implements the aggregation step.  Inputs are a list of
// per-station fields at a single receiver point (already computed via
// src/engine/am/skywave.js).  Outputs are the RSS-aggregated field
// plus a breakdown of which stations contributed.
//
// CONTRACT
//   rssAggregate([{ field_uv_m, station_id, ... }, ...])
//     → { rss_uv_m, n_input, n_contributing, threshold_uv_m, contributing[], excluded[] }
//
// NUMERICAL NOTE
//   The 25% rule is applied AFTER the strongest interferer is
//   identified.  Stations below the threshold are excluded entirely
//   from the RSS — they don't make a token contribution.  This matches
//   the FCC's own AM Query nighttime calculator and v-soft AM-Pro
//   reference implementations.
//
// REGULATORY
//   - 47 CFR §73.182(k) — RSS aggregation, 25% exclusion threshold
//   - 47 CFR §73.182(s) — definition of "interfering signal"

export const RSS_EXCLUSION_FRACTION = 0.25;

/**
 * Aggregate interfering fields at a single receiver via §73.182(k) RSS.
 *
 * @param {Array<{
 *   field_uv_m: number,
 *   station_id?: string,
 *   call?: string,
 *   relation?: string,        // e.g. 'co_channel' | 'first_adjacent'
 *   distance_km?: number,
 *   bearing_deg?: number
 * }>} interferers
 * @param {object} [opts]
 * @param {number} [opts.exclusionFraction=0.25]  override the §73.182(k) 25%
 * @returns {{
 *   rss_uv_m: number,
 *   n_input: number,
 *   n_contributing: number,
 *   n_excluded: number,
 *   threshold_uv_m: number,
 *   strongest_uv_m: number,
 *   contributing: Array,
 *   excluded: Array,
 *   exclusion_fraction: number,
 *   regulation: '47 CFR §73.182(k)'
 * }}
 */
export function rssAggregate(interferers, opts = {}){
  if (!Array.isArray(interferers)){
    throw new Error('rssAggregate: interferers must be an array');
  }
  const exclusionFraction = Number.isFinite(opts.exclusionFraction)
    ? Math.max(0, Math.min(1, opts.exclusionFraction))
    : RSS_EXCLUSION_FRACTION;

  // Drop entries with non-finite or non-positive fields up front;
  // a "zero or NaN" field is "no interferer", not a contributor.
  const cleaned = interferers.filter((x) =>
    Number.isFinite(x.field_uv_m) && x.field_uv_m > 0
  );
  if (cleaned.length === 0){
    return {
      rss_uv_m:        0,
      n_input:         interferers.length,
      n_contributing:  0,
      n_excluded:      interferers.length,
      threshold_uv_m:  0,
      strongest_uv_m:  0,
      contributing:    [],
      excluded:        interferers.slice(),
      exclusion_fraction: exclusionFraction,
      regulation:      '47 CFR §73.182(k)'
    };
  }

  const sorted   = cleaned.slice().sort((a, b) => b.field_uv_m - a.field_uv_m);
  const strongest = sorted[0].field_uv_m;
  const threshold = strongest * exclusionFraction;

  const contributing = [];
  const excluded     = [];
  for (const x of sorted){
    if (x.field_uv_m >= threshold){
      contributing.push(x);
    } else {
      excluded.push({ ...x, excluded_reason: `field ${x.field_uv_m.toFixed(3)} < 25% threshold ${threshold.toFixed(3)}` });
    }
  }
  // Anything that was filtered as non-positive shows up in excluded too.
  for (const x of interferers){
    if (!Number.isFinite(x.field_uv_m) || x.field_uv_m <= 0){
      excluded.push({ ...x, excluded_reason: 'non-positive or non-finite field' });
    }
  }

  const rss_uv_m = Math.sqrt(
    contributing.reduce((acc, x) => acc + x.field_uv_m ** 2, 0)
  );

  return {
    rss_uv_m,
    n_input:         interferers.length,
    n_contributing:  contributing.length,
    n_excluded:      excluded.length,
    threshold_uv_m:  threshold,
    strongest_uv_m:  strongest,
    contributing,
    excluded,
    exclusion_fraction: exclusionFraction,
    regulation:      '47 CFR §73.182(k)'
  };
}

/**
 * Compute the required minimum desired-signal field at a receiver
 * given the RSS interfering field and the §73.182 protection ratio
 * applicable to the station's class.
 *
 * D/U (Desired-to-Undesired) ratios per 47 CFR §73.182 / §73.183:
 *   - Class A clear (co-channel):  26 dB nighttime
 *   - Class B / D (co-channel):    20 dB nighttime
 *   - 1st-adjacent (10 kHz):        0 dB
 *   - 2nd-adjacent (20 kHz):      -26 dB
 *   - 3rd-adjacent (30 kHz):      -50 dB
 *
 * Required field = RSS_uV/m × 10^(D/U_dB / 20).
 *
 * @param {number} rss_uv_m       RSS interfering field at the receiver
 * @param {number} du_db          required Desired/Undesired ratio in dB
 * @returns {number}              required station field at this receiver, uV/m
 */
export function requiredDesiredField(rss_uv_m, du_db){
  if (!Number.isFinite(rss_uv_m) || rss_uv_m < 0) return NaN;
  if (!Number.isFinite(du_db)) return NaN;
  return rss_uv_m * Math.pow(10, du_db / 20);
}

/**
 * Boolean check: is the desired field strong enough to clear the
 * §73.182 RSS-plus-protection threshold at this receiver?
 *
 * @param {number} desired_uv_m   Genoa station's field at the receiver
 * @param {number} rss_uv_m       RSS-aggregated interfering field
 * @param {number} du_db          required D/U ratio in dB
 * @returns {{ pass: boolean, required_uv_m: number, margin_db: number }}
 */
export function checkProtection(desired_uv_m, rss_uv_m, du_db){
  const required = requiredDesiredField(rss_uv_m, du_db);
  const margin_db = Number.isFinite(desired_uv_m) && desired_uv_m > 0 && required > 0
    ? 20 * Math.log10(desired_uv_m / required)
    : null;
  return {
    pass:           Number.isFinite(desired_uv_m) && desired_uv_m >= required && rss_uv_m >= 0,
    required_uv_m:  required,
    margin_db
  };
}

/**
 * Standard FCC D/U ratios for AM nighttime protection.  Looked up by
 * (subject_class, relation) tuple.  Returns null when the combination
 * is not protected (e.g. Class D 3rd-adjacent — no protection
 * required so the orchestrator does not include those interferers).
 *
 * @param {'A'|'B'|'C'|'D'} subjectClass
 * @param {'co_channel'|'first_adjacent'|'second_adjacent'|'third_adjacent'} relation
 * @returns {number|null} D/U dB
 */
export function standardDuDb(subjectClass, relation){
  const cls = String(subjectClass || '').toUpperCase();
  const rel = normalizeRelation(relation);
  const matrix = {
    A: { co_channel: 26, first_adjacent: 6,  second_adjacent: -26, third_adjacent: -50 },
    B: { co_channel: 20, first_adjacent: 6,  second_adjacent: -26, third_adjacent: -50 },
    C: { co_channel: 20, first_adjacent: 6,  second_adjacent: -26, third_adjacent: -50 },
    D: { co_channel: 20, first_adjacent: 6,  second_adjacent: -26, third_adjacent: null }
  };
  const row = matrix[cls];
  if (!row) return null;
  const v = row[rel];
  return Number.isFinite(v) ? v : null;
}

/**
 * Normalize the channel-relation string Genoa sees from upstream
 * sources (facilityClient emits `cochannel`; the engine + tests use
 * `co_channel`).  Idempotent; accepts both forms + a couple of common
 * aliases.
 *
 * @param {string} relation
 * @returns {'co_channel'|'first_adjacent'|'second_adjacent'|'third_adjacent'|'if_offset'|string}
 */
export function normalizeRelation(relation){
  const r = String(relation || '').toLowerCase().replace(/[\s-]/g, '_');
  if (r === 'cochannel' || r === 'co_channel') return 'co_channel';
  if (r === '1st_adjacent' || r === 'first_adjacent') return 'first_adjacent';
  if (r === '2nd_adjacent' || r === 'second_adjacent') return 'second_adjacent';
  if (r === '3rd_adjacent' || r === 'third_adjacent') return 'third_adjacent';
  if (r === 'if_offset' || r === 'if') return 'if_offset';
  return r;
}

export const NIGHT_INTERFERENCE_PROVENANCE = Object.freeze({
  module:        'src/engine/am/nightInterference.js',
  regulation:    '47 CFR §73.182(k) (RSS aggregation); §73.182 / §73.183 (D/U tables)',
  modeled: [
    'RSS aggregation with 25% exclusion threshold per §73.182(k)',
    'Required-desired-field computation for arbitrary D/U ratios',
    'Standard D/U lookup matrix for Class A/B/C/D × co/1st/2nd/3rd adjacent'
  ],
  not_modeled: [
    'Class D daytime-only stations (no nighttime allocation required)',
    'Pre-sunrise / post-sunset authority — separate analysis pass',
    'Expanded-band 1610-1705 kHz (§73.30) inter-station protection — same RSS math, different D/U table'
  ]
});
