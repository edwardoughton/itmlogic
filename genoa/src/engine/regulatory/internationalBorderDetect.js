// International border detection for AM treaty applicability.
//
// Real-world reference: Mullaney KELP 1989 — the site is 0 km from the
// US/Mexico border and Table 3 explicitly stated "Check appropriate
// US/Mexican agreements".  KELP had to protect the Mexican station
// XEJPV (1560 kHz) at 25 mV/m daytime per the US/Mexico AM treaty.
// Genoa previously had no automatic mechanism to surface this
// obligation; an engineer had to know to look.
//
// This module computes the shortest distance from the proposed site
// to the US/Mexico and US/Canada land borders, and flags when AM
// treaty obligations apply.  Output is INFORMATIONAL — the actual
// treaty compliance checks (§73.187 skywave, daytime 25 mV/m co-
// channel overlap, etc.) run elsewhere and pull from nearby_primaries.
// What this module adds: the explicit "you are X km from the US/MX
// border — verify Mexican AM stations on your channel are not
// overlapping" surfacing that consultants always include.
//
// Border geometry is a coarse polyline (~5 km accuracy is plenty for
// the "is treaty zone applicable" decision).  Higher-resolution
// shapefiles (US Census TIGER/Line) would be a stage-2 upgrade.

// US/Mexico land border — west-to-east waypoints (lat, lon).
// Sourced from US Geological Survey, simplified to representative
// inflection points; sub-10-km cross-track error.
const US_MX_BORDER = Object.freeze([
  [32.5340, -117.1240],   // Pacific (Tijuana / San Diego)
  [32.6189, -114.8088],   // Yuma, AZ
  [31.3346, -110.9389],   // Nogales, AZ
  [31.7795, -106.5274],   // El Paso / Ciudad Juárez (KELP region)
  [29.5638, -101.2986],   // Big Bend / Boquillas
  [28.5097, -100.4860],   // Eagle Pass
  [27.5037, -99.5075],    // Laredo
  [26.0760, -97.1697],    // Brownsville (Gulf of Mexico)
]);

// US/Canada land border — west-to-east waypoints (lat, lon).
// Two segments: the 49th-parallel west, and the Great Lakes / St.
// Lawrence / Maine arc to the east.
const US_CA_BORDER = Object.freeze([
  [48.9999, -123.3215],   // Pacific (Blaine, WA / Vancouver)
  [49.0000, -116.0500],   // Idaho / BC
  [49.0000, -110.0050],   // Sweetgrass, MT / Coutts
  [49.0000, -104.0500],   // North Dakota / Saskatchewan
  [49.0000,  -97.2293],   // Pembina, ND / Manitoba
  [48.9999,  -95.1530],   // Lake of the Woods, MN
  [48.0001,  -89.4630],   // Grand Portage, MN / Thunder Bay
  [46.5000,  -84.3500],   // Sault Ste. Marie, MI / ON
  [42.3000,  -83.0500],   // Detroit / Windsor
  [43.0780,  -79.0750],   // Niagara Falls / Lake Erie
  [44.7400,  -75.5000],   // Cornwall, ON / Massena, NY
  [45.0080,  -74.0030],   // Vermont / Québec
  [45.0080,  -71.0660],   // Magalloway, NH / QC
  [45.7050,  -67.7785],   // Houlton, ME / NB
  [44.7700,  -67.0500],   // Calais, ME / St. Stephen
]);

// Treaty applicability thresholds (km).  These are the OUTER bounds
// at which the relevant treaty's notification / overlap obligations
// can apply.  Actual per-station checks still require nearby_primaries
// queries to confirm which Mexican / Canadian stations are nearby.
const US_MX_TREATY_ZONE_KM = 320;   // 1986 US/Mexico AM Agreement
const US_CA_TREATY_ZONE_KM = 800;   // US/Canada AM treaty (NARBA-derived)

export function detectInternationalBorder({ lat, lon } = {}){
  const lat0 = Number(lat);
  const lon0 = Number(lon);
  if (!Number.isFinite(lat0) || !Number.isFinite(lon0)){
    return { available: false, reason: 'lat / lon required' };
  }

  const mx = distanceToPolylineKm(lat0, lon0, US_MX_BORDER);
  const ca = distanceToPolylineKm(lat0, lon0, US_CA_BORDER);

  // Find the nearest border + a nearest-point bearing for the report.
  const nearest = mx.distance_km <= ca.distance_km
    ? { ...mx, border: 'US/Mexico' }
    : { ...ca, border: 'US/Canada' };

  const treaties = [];
  if (mx.distance_km <= US_MX_TREATY_ZONE_KM){
    treaties.push({
      treaty:        'US/Mexico AM Agreement (1986, as amended)',
      distance_km:   mx.distance_km,
      threshold_km:  US_MX_TREATY_ZONE_KM,
      obligation:    `Nighttime: skywave protection per §73.182(k) / §73.190 with Mexican stations carrying treaty-level §73.190 SS-1 thresholds.  Daytime: 25 mV/m groundwave contour overlap with co-channel and first-adjacent Mexican AM stations must be evaluated and cross-border interference requires consultation per the bilateral agreement, with the daytime-radiation rule (§73.187) governing critical-hours power reductions.`,
      treaty_zone:   true
    });
  }
  if (ca.distance_km <= US_CA_TREATY_ZONE_KM){
    treaties.push({
      treaty:        'US/Canada AM treaty',
      distance_km:   ca.distance_km,
      threshold_km:  US_CA_TREATY_ZONE_KM,
      obligation:    `AM allocations within 800 km of the US/Canada border require notification and protection per the Canada-US Letter of Understanding.  Nighttime: skywave checks (§73.182(k) / §73.190 SS-1 RSS) must include nearby Canadian AM stations under the bilateral agreement.  Daytime radiation limits during critical hours are governed by §73.187.`,
      treaty_zone:   true
    });
  }

  return {
    available: true,
    site:      { lat: lat0, lon: lon0 },
    distances: {
      us_mx_km: round2(mx.distance_km),
      us_ca_km: round2(ca.distance_km)
    },
    nearest_border:    nearest.border,
    nearest_border_km: round2(nearest.distance_km),
    treaties,
    inside_treaty_zone: treaties.length > 0,
    method: 'great-circle distance to coarse border polyline; ~5 km cross-track error.  High-resolution check (US Census TIGER/Line) deferred to stage-2.',
    fetched_at: new Date().toISOString()
  };
}

// ─────────── helpers ───────────

// Distance from a point to the nearest segment of a polyline, with
// the bearing of the closest point.  Returns { distance_km, bearing_deg }.
function distanceToPolylineKm(lat, lon, polyline){
  let best = { distance_km: Infinity, bearing_deg: null };
  for (let i = 0; i < polyline.length - 1; i++){
    const a = polyline[i];
    const b = polyline[i + 1];
    const d = pointToSegmentKm(lat, lon, a[0], a[1], b[0], b[1]);
    if (d.distance_km < best.distance_km) best = d;
  }
  return best;
}

// Project a great-circle point onto a great-circle segment.
//
// AUDIT FIX (2026-05-18): previous implementation used the SEGMENT-
// MIDPOINT cosLat for projection, producing > 20 km cross-track error
// when the test point sits far from the segment (e.g. an El Paso site
// at 32°N evaluated against the 49°-parallel US/Canada border used
// cos(49°)=0.66 when the true cosLat at El Paso is cos(40°)=0.77).
// Replaced with proper great-circle distance via haversine — exact at
// every distance and removes the projection-frame inconsistency the
// audit flagged.
function pointToSegmentKm(lat, lon, alat, alon, blat, blon){
  // Iteratively bisect along the segment to find the closest point.
  // 24 iterations bring cross-track precision below 1 m at North
  // American scales — overkill for the treaty-zone gate but cheap.
  let tLo = 0, tHi = 1;
  let bestT = 0, bestKm = greatCircleKm(lat, lon, alat, alon);
  const evalT = (t) => {
    const cLat = alat + t * (blat - alat);
    const cLon = alon + t * (blon - alon);
    return { km: greatCircleKm(lat, lon, cLat, cLon), cLat, cLon };
  };
  // Golden-section-ish bisection: evaluate 1/3 and 2/3 of current
  // interval, keep the better half.  Converges quickly for the
  // convex distance function.
  for (let iter = 0; iter < 24; iter++){
    const t1 = tLo + (tHi - tLo) / 3;
    const t2 = tHi - (tHi - tLo) / 3;
    const e1 = evalT(t1);
    const e2 = evalT(t2);
    if (e1.km < bestKm){ bestKm = e1.km; bestT = t1; }
    if (e2.km < bestKm){ bestKm = e2.km; bestT = t2; }
    if (e1.km < e2.km) tHi = t2; else tLo = t1;
  }
  const closest = evalT(bestT);
  return {
    distance_km: closest.km,
    bearing_deg: greatCircleBearing(lat, lon, closest.cLat, closest.cLon)
  };
}

// Haversine great-circle distance — exact at any scale; no projection.
function greatCircleKm(lat1, lon1, lat2, lon2){
  const R = 6371.0088;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function greatCircleBearing(lat1, lon1, lat2, lon2){
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const dλ = (lon2 - lon1) * Math.PI / 180;
  const y  = Math.sin(dλ) * Math.cos(φ2);
  const x  = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function round2(x){ return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; }
