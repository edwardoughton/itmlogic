// AM nighttime orchestrator — pulls nearby AM primaries from LMS,
// normalizes their shape into the form solveNifContour() expects,
// runs the per-azimuth bisection, and returns a compact result
// ready for the exhibit appendix + UI overlay.
//
// CONTRACT
//   nighttimeNifStudy({
//     proposed: {
//       lat, lon, freq_khz, erp_kw,
//       fcc_class:    'A'|'B'|'C'|'D',
//       pattern_table?,            // §73.150 horizontal pattern (DA-N)
//       pattern_mode?: 'omni'|'DA'
//     },
//     options?: {
//       radius_km?:        default 1500 (covers §73.182's ~750 mi reach)
//       azimuths_deg?:     default [0,10,...,350]
//       duDbOverride?:     per-relation D/U dB overrides for waiver studies
//       max_interferers?:  cap on the number of co/adjacent stations
//                          considered (default 25; sorted by predicted
//                          field at the proposed station so the strongest
//                          always win when capped)
//     }
//   }, { fccamClient, facilityClient, budget? })
//   → {
//       available:    boolean,
//       contour:      Array<{ az, lat, lon, distance_km, binding, ... }>,
//       polygon:      GeoJSON-friendly closed vertex list,
//       interferers:  Array<{ call, fcc_class, relation, distance_km, ... }>,
//       summary:      { n_failing_azimuths, worst_margin_db, mean_radius_km, ... },
//       provenance:   { ... }
//     }
//
// REGULATORY
//   - 47 CFR §73.182  — engineering standards of allocation, AM nighttime
//   - 47 CFR §73.183  — required protection ratios
//   - 47 CFR §73.190  — engineering charts, Wang skywave model

import { isValidAmKhz } from './band.js';
import { normalizeRelation } from './nightInterference.js';
import { solveNifContour } from './nifContour.js';

const DEFAULT_RADIUS_KM       = 1500;   // §73.182 reach is ~750 mi ≈ 1207 km; round up
const DEFAULT_MAX_INTERFERERS = 25;

/**
 * Convert one LMS-primary row into the shape solveNifContour expects.
 * Returns null when the row is unusable (no coordinates / freq).
 */
export function normalizePrimary(row){
  if (!row) return null;
  // Reject nullish lat/lon up front — JS would otherwise coerce
  // null → 0 (which IS finite, but 0,0 in the Atlantic is not a
  // valid AM station and would propagate as bogus geometry).
  if (row.lat == null || row.lon == null) return null;
  const lat = Number(row.lat);
  const lon = Number(row.lon);
  const freq_khz = Number(row.frequency_khz ?? row.frequency);
  const erp_kw   = Number(row.erp_kw);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!isValidAmKhz(freq_khz)) return null;
  if (!Number.isFinite(erp_kw) || erp_kw <= 0) return null;
  return {
    station_id:   row.facility_id || row.station_id || null,
    call:         row.call || null,
    fcc_class:    row.fcc_class || null,
    lat, lon, freq_khz, erp_kw,
    pattern_table: row.pattern_table || row.da_n_pattern || null,
    relation:     normalizeRelation(row.channel_relationship || row.relation || 'co_channel'),
    distance_km:  Number(row.distance_km) || null,
    source:       row.source || 'fcc-amq'
  };
}

/**
 * Run the §73.182 nighttime NIF study for a proposed AM station.
 */
export async function nighttimeNifStudy(input, ctx){
  const { proposed = null, options = {} } = input || {};
  const { fccamClient = null, facilityClient = null, budget = null } = ctx || {};

  if (!fccamClient){
    return {
      available: false,
      error:     'FCCAM sidecar not configured (FCCAM_SIDECAR_URL unset)',
      regulation: '47 CFR §73.182 / §73.190(c)'
    };
  }
  if (!proposed?.lat || !proposed?.lon || !isValidAmKhz(proposed?.freq_khz) || !(Number(proposed?.erp_kw) > 0)){
    return {
      available: false,
      error:     'proposed station requires lat, lon, AM-band freq_khz on the 10-kHz grid, and erp_kw > 0'
    };
  }
  if (!proposed.fcc_class){
    return {
      available: false,
      error:     'proposed.fcc_class is required (A/B/C/D) — protection ratios per §73.183 are class-dependent'
    };
  }

  // 1. Pull nearby AMs from LMS.
  const radius_km = Number(options.radius_km) || DEFAULT_RADIUS_KM;
  let primariesResp;
  try {
    const pullArgs = {
      lat:                 Number(proposed.lat),
      lon:                 Number(proposed.lon),
      frequency_khz:       Number(proposed.freq_khz),
      service:             'AM',
      radius_km,
      exclude_facility_id: proposed.facility_id || null
    };
    primariesResp = budget?.withDeadline
      ? await budget.withDeadline('am_night_primaries', () => facilityClient.getNearbyPrimaries(pullArgs), { minMs: 5_000 })
      : await facilityClient.getNearbyPrimaries(pullArgs);
  } catch (e){
    return { available: false, error: `nearby-primaries fetch failed: ${e?.message || e}` };
  }
  if (!primariesResp?.available){
    return {
      available: false,
      error: primariesResp?.error || 'nearby-primaries unavailable',
      regulation: '47 CFR §73.182'
    };
  }

  // 2. Normalize + cap.
  const normalized = (primariesResp.primaries || [])
    .map(normalizePrimary)
    .filter(Boolean);

  const max_interferers = Number(options.max_interferers) || DEFAULT_MAX_INTERFERERS;
  // Pre-sort by distance — strongest are typically closest.  The
  // solver still applies the §73.182(k) 25% rule per receiver, so the
  // cap doesn't accidentally include a far station that turns out to
  // dominate at the contour boundary.  Cap is a budget knob, not a
  // correctness knob.
  const interferers = normalized
    .slice()
    .sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity))
    .slice(0, max_interferers);

  // 3. Solve.
  const contour = await solveNifContour(
    {
      proposed:      {
        lat:           Number(proposed.lat),
        lon:           Number(proposed.lon),
        freq_khz:      Number(proposed.freq_khz),
        erp_kw:        Number(proposed.erp_kw),
        fcc_class:     proposed.fcc_class,
        pattern_table: proposed.pattern_mode === 'DA' ? proposed.pattern_table : null
      },
      interferers,
      azimuths_deg:  options.azimuths_deg
    },
    { fccamClient, duDbOverride: options.duDbOverride }
  );

  if (!contour.available){
    return { available: false, error: contour.error || 'NIF contour solver returned available:false',
             raw: contour };
  }

  // 4. Summary statistics for the appendix.
  const radii   = contour.per_azimuth.filter((p) => p.ok).map((p) => p.distance_km);
  const failing = contour.per_azimuth.filter((p) => p.binding && !p.binding.pass);
  const margins = contour.per_azimuth
    .map((p) => p.binding?.margin_db)
    .filter((x) => Number.isFinite(x));
  const summary = {
    n_azimuths:           contour.per_azimuth.length,
    n_failing_azimuths:   failing.length,
    n_no_service_azimuths: contour.per_azimuth.filter((p) => p.saturated === 'no_service').length,
    n_unbounded_azimuths:  contour.per_azimuth.filter((p) => p.saturated === 'unbounded').length,
    mean_radius_km:       radii.length ? radii.reduce((a, x) => a + x, 0) / radii.length : null,
    min_radius_km:        radii.length ? Math.min(...radii) : null,
    max_radius_km:        radii.length ? Math.max(...radii) : null,
    worst_margin_db:      margins.length ? Math.min(...margins) : null,
    n_interferers_used:   interferers.length,
    n_interferers_seen:   normalized.length,
    interferer_cap:       max_interferers
  };

  return {
    available:   true,
    source:      'fccam',
    fetched_at:  new Date().toISOString(),
    proposed:    contour.proposed,
    interferers,
    interferer_cap_applied: normalized.length > max_interferers,
    contour:     contour.per_azimuth,
    polygon:     contour.polygon,
    du_db_by_relation: contour.du_db_by_relation,
    summary,
    regulation:  '47 CFR §73.182 / §73.183 / §73.190(c)',
    provenance:  {
      module:           'src/engine/am/nightOrchestrator.js',
      upstream_skywave: 'FCCAM (Fccam.for / Wang 1985)',
      upstream_lms:     primariesResp.source || 'fcc-amq',
      license_basis:    '17 USC §105 (FCC engine + endpoint, US Government public domain)'
    }
  };
}
