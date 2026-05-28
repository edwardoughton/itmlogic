// §17.7(c) airport-proximity gate.
//
// Given a tower lat/lon and a list of nearby public-use airports (from
// the genoa-faa-airports sidecar), decide whether §17.7 notification to
// the FAA is required by virtue of airport proximity (independent of
// the §17.7(a) 60.96 m / 200 ft height test).
//
// 47 CFR §17.7(c) thresholds (distance-only first cut):
//   §17.7(c)(1)  Public-use airports with at least one runway > 3,200 ft:
//                notification required for any structure that would penetrate
//                the 100:1 imaginary surface within 6 nautical miles of the
//                airport reference point.  Distance-only proxy: 6 nm.
//   §17.7(c)(2)  Public-use airports with all runways ≤ 3,200 ft:
//                4 nautical miles.
//   §17.7(c)(3)  Heliports: 5,000 ft (≈ 0.823 nm).
//
// The "imaginary surface" geometry (100:1 / 50:1 / 25:1 slope from each
// runway threshold) is the precise §17.7(c) test.  This module
// implements the conservative distance-only proxy: any tower inside the
// notification radius is flagged.  False positives are fine — the
// engineer of record runs the full surface check before filing — but
// false negatives (failing to flag a tower that does penetrate) are
// not, so we err on the side of flagging.

const NM_PER_M     = 1 / 1852;
const M_PER_NM     = 1852;
const M_PER_FOOT   = 0.3048;

// Per-airport-type radius lookup.
function thresholdNm(airport){
  if (airport.type === 'heliport') return 5000 * M_PER_FOOT * NM_PER_M;  // ≈ 0.823 nm
  const longestFt = airport.longest_runway_ft;
  if (Number.isFinite(longestFt) && longestFt > 3200) return 6;
  return 4;  // short runways or unknown length → conservative 4 nm
}

// Apply §17.7(c) to a list of airports + their pre-computed
// haversine distance from the tower.  Returns:
//   { triggered, triggering_airports[], cite }
//
// triggered=false when no airport is within its applicable threshold.
// triggered=true with the list of every airport that falls inside.
export function check17_7c({ lat, lon, airports } = {}){
  const cites = [];
  const triggering = [];
  if (!Array.isArray(airports) || airports.length === 0){
    return {
      triggered:           false,
      triggering_airports: [],
      cite:                null,
      reason:              'no airports within search radius'
    };
  }
  for (const a of airports){
    const th_nm = thresholdNm(a);
    const th_m  = th_nm * M_PER_NM;
    const dist_m = a.distance_m;
    if (!Number.isFinite(Number(dist_m))) continue;
    if (dist_m <= th_m){
      const ruleSubsection = a.type === 'heliport'    ? '§17.7(c)(3)'
                            : (Number(a.longest_runway_ft) > 3200) ? '§17.7(c)(1)'
                            : '§17.7(c)(2)';
      triggering.push({
        airport_id:        a.airport_id,
        ident:             a.ident,
        local_code:        a.local_code,
        name:              a.name,
        type:              a.type,
        municipality:      a.municipality,
        iso_region:        a.iso_region,
        longest_runway_ft: a.longest_runway_ft,
        distance_m:        Math.round(dist_m),
        distance_nm:       Number((dist_m * NM_PER_M).toFixed(3)),
        threshold_nm:      Number(th_nm.toFixed(3)),
        rule:              ruleSubsection
      });
      cites.push({
        rule: ruleSubsection,
        text: `Notification triggered: ${a.name} (${a.ident || a.local_code || a.airport_id}) at ${(dist_m * NM_PER_M).toFixed(2)} nm (within ${th_nm.toFixed(2)} nm threshold).`
      });
    }
  }
  return {
    triggered:           triggering.length > 0,
    triggering_airports: triggering,
    cite:                cites,
    reason:              triggering.length
      ? `${triggering.length} airport(s) within §17.7(c) notification radius`
      : 'no airport within §17.7(c) notification radius'
  };
}
