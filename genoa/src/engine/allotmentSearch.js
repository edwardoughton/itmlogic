// FM allotment / channel search — V-Soft Probe5's flagship feature
// implemented over the §73.207 + §73.215 engines we already ship.
//
// PROBLEM
//   Given a proposed transmitter site (lat, lon, fcc_class, optional
//   ERP/HAAT for §73.215 contour math), enumerate every FM channel
//   200-300 and report which ones are available — passing §73.207
//   minimum-distance separation, OR §73.215 contour-protection when
//   §73.207 fails.
//
// USE
//   const result = await searchAllotments({
//     subject: { lat, lon, fcc_class: 'A', erp_kw, haat_m, frequency_mhz? },
//     nearbyStations,                  // pre-pulled from LMS/FMQ; we don't fetch here
//     channels?:   number[] | 'all',   // default = 200..300
//     reserved_band?: true|false       // include 200-220 (NCE band)? default true
//   });
//   →  {
//        n_channels_evaluated, n_available_207_only, n_available_215_only,
//        n_available_both, n_blocked,
//        results: [
//          {
//            channel:        221,
//            frequency_mhz:  92.1,
//            band:           'commercial' | 'reserved',
//            pass_73207:     true | false,
//            pass_73215:     true | false | 'not_evaluated',
//            available:      true | false,
//            binding:        {                // strictest constraint
//              cite, station, relation, distance_km, required_km, deficit_km
//            } | null,
//            margin_km:      number | null,   // smallest excess over §73.207 minimum
//            n_violations_207: number,
//            n_violations_215: number,
//            scoring_rank:    integer
//          },
//          ...
//        ],
//        regulation: '47 CFR §73.201 + §73.207 + §73.215'
//      }
//
// SCORING
//   Available channels are ranked by:
//     1. fewest §73.207 violations (a clean §73.207 pass beats a
//        §73.215 rescue)
//     2. largest minimum margin_km over Table A
//     3. lowest channel number (deterministic tiebreaker)
//   Blocked channels are reported with their binding constraint so
//   the reviewer can see HOW close each was.
//
// IMPLEMENTATION NOTE — Why we don't pull nearby ourselves
//   nearbyStations is a parameter (not pulled here) so this engine
//   is testable in isolation AND the orchestrator can reuse the
//   already-fetched §73.182 / §73.207 nearby_primaries set instead
//   of triple-fetching the same LMS rows.
//
// REGULATORY
//   - 47 CFR §73.201 — FM table of allotments / channel numbering
//   - 47 CFR §73.207 — minimum-distance separation (baseline)
//   - 47 CFR §73.215 — contour-protection (alternative)
//   - 47 CFR §73.211 — power / class definitions

import { checkSection73207 } from './regulatory/section_73_207.js';
import { checkSection73215 } from './regulatory/section_73_215.js';

const FM_CH_MIN = 200;        // 87.9 MHz
const FM_CH_MAX = 300;        // 107.9 MHz
const FM_NCE_MAX = 220;       // 91.9 MHz — reserved-band cutoff (§73.501)
const FM_STEP_MHZ = 0.2;
const FM_REF_MHZ  = 87.9;     // freq for channel 200

export function fmChannelToMhz(channel){
  const c = Number(channel);
  if (!Number.isFinite(c)) return NaN;
  return Number((FM_REF_MHZ + (c - 200) * FM_STEP_MHZ).toFixed(2));
}

export function fmMhzToChannel(frequency_mhz){
  const f = Number(frequency_mhz);
  if (!Number.isFinite(f)) return null;
  const ch = Math.round((f - FM_REF_MHZ) / FM_STEP_MHZ + 200);
  return ch >= FM_CH_MIN && ch <= FM_CH_MAX ? ch : null;
}

/**
 * Enumerate FM channels and report availability for the proposed site.
 *
 * @param {object} input
 * @param {object} input.subject              { lat, lon, fcc_class, erp_kw?, haat_m? }
 * @param {Array}  input.nearbyStations       full-service FMs from LMS
 * @param {number[]|'all'} [input.channels='all']
 * @param {boolean} [input.reserved_band=true]
 * @param {object} [input.options]            forwarded to §73.215 (e.g. tolerance)
 * @returns {object}
 */
export function searchAllotments(input){
  const { subject, nearbyStations = [],
          channels = 'all', reserved_band = true,
          options = {} } = input || {};
  if (!subject || typeof subject !== 'object'){
    return {
      ok: false,
      error: 'subject required ({ lat, lon, fcc_class[, erp_kw, haat_m] })',
      regulation: '47 CFR §73.201 + §73.207 + §73.215'
    };
  }
  if (!Number.isFinite(Number(subject.lat)) || !Number.isFinite(Number(subject.lon))){
    return { ok: false, error: 'subject.lat + subject.lon required' };
  }
  if (!subject.fcc_class){
    return { ok: false, error: 'subject.fcc_class required for §73.207 lookup' };
  }

  // Resolve the channel list.
  let chList;
  if (channels === 'all'){
    chList = [];
    for (let c = FM_CH_MIN; c <= FM_CH_MAX; c++){
      if (!reserved_band && c <= FM_NCE_MAX) continue;
      chList.push(c);
    }
  } else if (Array.isArray(channels)){
    chList = channels.map(Number).filter((c) =>
      Number.isFinite(c) && c >= FM_CH_MIN && c <= FM_CH_MAX
    );
  } else {
    return { ok: false, error: 'channels must be "all" or a number[]' };
  }
  if (chList.length === 0){
    return { ok: false, error: 'no channels to evaluate (filter removed all)' };
  }

  const results = [];
  for (const channel of chList){
    const frequency_mhz = fmChannelToMhz(channel);
    const subj = { ...subject, frequency_mhz, channel };
    results.push(evaluateChannel({ subject: subj, nearbyStations, options }));
  }

  // Score available channels.  Available channels first
  // (sorted by least-deficit), then blocked channels.
  results.sort(compareResults);
  // Assign deterministic ranks AFTER sort.
  results.forEach((r, i) => { r.scoring_rank = i + 1; });

  const n_207_only = results.filter((r) => r.available && r.pass_73207 && !r.pass_73215).length;
  const n_215_only = results.filter((r) => r.available && !r.pass_73207 && r.pass_73215).length;
  const n_both     = results.filter((r) => r.available && r.pass_73207 && r.pass_73215).length;
  const n_avail    = results.filter((r) => r.available).length;
  const n_blocked  = results.filter((r) => !r.available).length;

  return {
    ok:                    true,
    regulation:            '47 CFR §73.201 + §73.207 + §73.215',
    n_channels_evaluated:  results.length,
    n_available:           n_avail,
    n_available_207_only:  n_207_only,
    n_available_215_only:  n_215_only,
    n_available_both:      n_both,
    n_blocked:             n_blocked,
    subject:               { lat: Number(subject.lat), lon: Number(subject.lon),
                             fcc_class: subject.fcc_class,
                             erp_kw: Number.isFinite(Number(subject.erp_kw)) ? Number(subject.erp_kw) : null,
                             haat_m: Number.isFinite(Number(subject.haat_m)) ? Number(subject.haat_m) : null },
    results
  };
}

// ---------------------------------------------------------------------------
// per-channel evaluation
// ---------------------------------------------------------------------------

function evaluateChannel({ subject, nearbyStations, options }){
  const channel        = subject.channel;
  const frequency_mhz  = subject.frequency_mhz;
  const band           = channel <= FM_NCE_MAX ? 'reserved' : 'commercial';

  // §73.207 — minimum-distance Table A.
  let r207 = null;
  try {
    r207 = checkSection73207({ subject, nearbyStations });
  } catch (e){
    return errorRow(channel, frequency_mhz, band, `§73.207 evaluation failed: ${e?.message || e}`);
  }
  const pass_207         = r207?.pass === true;
  const n_violations_207 = Array.isArray(r207?.violations) ? r207.violations.length : 0;
  const margin_207       = smallestMarginKm(r207?.studies);
  const binding_207      = bindingFromStudies(r207?.studies, r207?.violations);

  // §73.215 — contour-protection (only run when §73.207 has failures
  // AND we have enough geometry to compute contours).
  let r215 = null;
  let pass_215 = 'not_evaluated';
  let n_violations_215 = 0;
  let binding_215 = null;
  const canRun215 = Number.isFinite(Number(subject.erp_kw))
                 && Number.isFinite(Number(subject.haat_m));
  if (!pass_207 && canRun215){
    try {
      r215 = checkSection73215({ subject, nearbyStations, ...options });
      pass_215 = r215?.pass === true;
      n_violations_215 = Array.isArray(r215?.violations) ? r215.violations.length : 0;
      binding_215 = bindingFromStudies(r215?.studies, r215?.violations);
    } catch (e){
      // §73.215 is a "best effort" rescue; surface but don't fail
      // the search if the engine can't run for this pair.
      pass_215 = 'error';
      binding_215 = { error: String(e?.message || e) };
    }
  }

  // Available when either rule passes (and §73.215 only counts when
  // genuinely evaluated, not 'not_evaluated' or 'error').
  const available = pass_207 || pass_215 === true;
  const binding = pass_207 ? null
                : pass_215 === true ? null
                : (binding_207 || binding_215);

  return {
    channel, frequency_mhz, band,
    pass_73207:       pass_207,
    pass_73215:       pass_215,
    available,
    binding,
    margin_km:        Number.isFinite(margin_207) ? Number(margin_207.toFixed(3)) : null,
    n_violations_207, n_violations_215,
    scoring_rank:     null    // assigned by caller after sort
  };
}

function errorRow(channel, frequency_mhz, band, error){
  return {
    channel, frequency_mhz, band,
    pass_73207: false, pass_73215: 'error',
    available: false,
    binding: { error },
    margin_km: null,
    n_violations_207: 0,
    n_violations_215: 0,
    scoring_rank: null
  };
}

// §73.207 emits studies with keys
//   { actual_separation_km, required_separation_km, margin_km,
//     nearby_call, relationship, ... }
// §73.215 emits study rows with similar but contour-overlap-shaped
// keys.  Both accessors here are permissive — try the §73.207 keys
// first, then fall back to generic names a §73.215 study may use.
function readDistanceKm(row){
  return Number(
    row?.actual_separation_km ?? row?.distance_km ?? row?.separation_km
  );
}
function readRequiredKm(row){
  return Number(
    row?.required_separation_km ?? row?.required_km ?? row?.minimum_km
  );
}
function readStation(row){
  return row?.nearby_call ?? row?.station ?? row?.call
      ?? row?.other_call  ?? row?.other_station ?? null;
}
function readRelation(row){
  return row?.relationship ?? row?.relation ?? row?.channel_relationship ?? null;
}

function smallestMarginKm(studies){
  if (!Array.isArray(studies)) return null;
  let smallest = Infinity;
  for (const s of studies){
    const dKm = readDistanceKm(s);
    const reqKm = readRequiredKm(s);
    if (Number.isFinite(dKm) && Number.isFinite(reqKm)){
      const m = dKm - reqKm;
      if (m < smallest) smallest = m;
    }
  }
  return Number.isFinite(smallest) ? smallest : null;
}

function bindingFromStudies(studies, violations){
  // §73.207 stamps its per-pair detail under violations[i].detail —
  // unwrap that first since it has the actual numbers.  Fall back to
  // the top-level violation fields (older shape), then the worst-row
  // in studies.
  if (Array.isArray(violations) && violations.length > 0){
    const v = violations[0];
    const d = v.detail || v;
    const distance_km = readDistanceKm(d);
    const required_km = readRequiredKm(d);
    const deficit_km =
      Number.isFinite(d.margin_km) ? -Number(d.margin_km)
      : (Number.isFinite(d.deficit_km) ? Number(d.deficit_km)
        : (Number.isFinite(distance_km) && Number.isFinite(required_km)
            ? Number((required_km - distance_km).toFixed(3))
            : null));
    return {
      cite:        v.cite || null,
      station:     readStation(d),
      relation:    readRelation(d),
      distance_km: Number.isFinite(distance_km) ? Number(distance_km) : null,
      required_km: Number.isFinite(required_km) ? Number(required_km) : null,
      deficit_km
    };
  }
  if (Array.isArray(studies)){
    let worst = null;
    for (const s of studies){
      const dKm = readDistanceKm(s);
      const reqKm = readRequiredKm(s);
      if (!Number.isFinite(dKm) || !Number.isFinite(reqKm)) continue;
      const deficit = reqKm - dKm;
      if (!worst || deficit > worst.deficit_km){
        worst = {
          cite: s.cite || null,
          station:     readStation(s),
          relation:    readRelation(s),
          distance_km: dKm, required_km: reqKm,
          deficit_km:  Number(deficit.toFixed(3))
        };
      }
    }
    return worst;
  }
  return null;
}

function compareResults(a, b){
  // 1. available before blocked
  if (a.available !== b.available) return a.available ? -1 : 1;
  if (a.available){
    // 2. fewest §73.207 violations (clean spacing pass > §73.215 rescue)
    const av = a.n_violations_207;
    const bv = b.n_violations_207;
    if (av !== bv) return av - bv;
    // 3. largest margin_km
    const am = a.margin_km ?? -Infinity;
    const bm = b.margin_km ?? -Infinity;
    if (am !== bm) return bm - am;
  } else {
    // Among blocked: smallest deficit first (easiest to fix).
    const ad = a.binding?.deficit_km ?? Infinity;
    const bd = b.binding?.deficit_km ?? Infinity;
    if (ad !== bd) return ad - bd;
  }
  // 4. lowest channel as tiebreaker
  return a.channel - b.channel;
}

export const ALLOTMENT_SEARCH_PROVENANCE = Object.freeze({
  module:      'src/engine/allotmentSearch.js',
  regulation:  '47 CFR §73.201 (FM table of allotments) + §73.207 (Table A) + §73.215 (contour-protection)',
  modeled: [
    'FM channels 200-300 (87.9-107.9 MHz, 0.2 MHz grid)',
    'Reserved-band 200-220 (NCE, §73.501) flagged in the band field',
    '§73.207 minimum-distance separation as the primary qualifier',
    '§73.215 contour-protection as a rescue when §73.207 fails (only run when ERP+HAAT supplied)',
    'Deterministic ranking: 207-clean → margin-km → channel'
  ],
  not_modeled: [
    'LPFM (§73.807 — separate distance table)',
    'FM translators / FX (§74.1235)',
    'Mexican / Canadian treaty restrictions (§73.504 / line-A bilateral protections)',
    'TV channel 6 (§73.525 — separate engine already in the codebase)',
    'Daytime-only / class-D FM (does not exist for FM service)'
  ],
  license_basis: '17 USC §105 (FCC rules + technical tables, US Government public domain)'
});
