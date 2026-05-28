// Vector-chart sections — pure pdfkit primitives, no PNG round-trip.
// Surfaces engineering data already computed in evidence:
//   - AM-night NIF contour          → polar plot of NIF radius vs azimuth
//   - FORTRAN reference-engine parity → scatter plot of Δkm vs azimuth
//   - Directional-antenna pattern     → polar polygon of f(az)
//   - §73.314 terrain-aware coverage  → polygon overlay (ITM vs §73.333)
//
// All render only when their upstream computation actually ran AND
// produced enough points to plot.  Otherwise the builder returns
// null and the section is skipped.

export function buildNifPolarChartSection(exhibit){
  const svc = String(exhibit?.station_inputs?.service || '').toUpperCase();
  if (svc !== 'AM') return null;
  const nif = exhibit?.evidence?.am_night_nif;
  if (!nif || !nif.available) return null;
  const contour = Array.isArray(nif.contour) ? nif.contour : [];
  if (contour.length < 6) return null;

  const data = contour
    .map((p) => ({
      azimuth_deg: Number(p.azimuth_deg),
      value:       Number(p.distance_km)
    }))
    .filter((p) => Number.isFinite(p.azimuth_deg) && Number.isFinite(p.value) && p.value > 0);
  if (data.length < 6) return null;

  const s = nif.summary || {};
  const captionBits = [
    'AM nighttime interference-free (NIF) contour per 47 CFR §73.182.',
    'Each point: the radial distance (km, north up) at which the proposed station\'s 50% skywave equals the §73.182(k) RSS-aggregated interference at the §73.183 D/U for the proposed class.',
    Number.isFinite(s.mean_radius_km)
      ? `Mean radius ${s.mean_radius_km.toFixed(1)} km; min ${Number(s.min_radius_km).toFixed(1)} km; max ${Number(s.max_radius_km).toFixed(1)} km.`
      : null,
    nif.provenance?.upstream_skywave
      ? `Skywave engine: ${nif.provenance.upstream_skywave}.`
      : null
  ].filter(Boolean).join('  ');

  return {
    id:        'am-night-nif-chart',
    type:      'polar-chart',
    heading:   'Appendix F-3 — NIF contour polar plot',
    data,
    r_unit:    'km',
    r_max:     Number.isFinite(s.max_radius_km) ? s.max_radius_km * 1.1 : null,
    caption:   captionBits
  };
}

// Directional-antenna polar pattern — the V-Soft signature visual.
// Plots the filed pattern_table as a closed polar polygon.  Data
// already exists on exhibit.station_inputs.pattern as [[az, f], ...]
// where f is the relative field (0..1).  The chart shows the radiation
// pattern shape that the §73.150 / §73.316 protection studies actually
// used; matches what the H&D DA-pattern exhibit page looks like.
export function buildDaPatternChartSection(exhibit){
  const pattern = exhibit?.station_inputs?.pattern;
  if (!Array.isArray(pattern) || pattern.length < 12) return null;

  const data = pattern
    .map((row) => {
      const az = Array.isArray(row) ? Number(row[0]) : Number(row?.az ?? row?.azimuth_deg);
      const f  = Array.isArray(row) ? Number(row[1]) : Number(row?.f  ?? row?.relative_field);
      return { azimuth_deg: az, value: f };
    })
    .filter((p) => Number.isFinite(p.azimuth_deg) && Number.isFinite(p.value) && p.value >= 0);
  if (data.length < 12) return null;

  const svc = String(exhibit?.station_inputs?.service || '').toUpperCase();
  const erp = Number(exhibit?.station_inputs?.erp_kw);
  const isAmPat = svc === 'AM';
  const mode = isAmPat ? '§73.150 ground-wave' : '§73.316 horizontal';
  // Power label / scaling caption must reflect the service vocabulary.
  // AM is TPO (transmitter output power) and the §73.183 inverse-distance
  // field scales as TPO × f²; FM/TV is ERP × f² per §73.316.  Mixing the
  // two reads as FM-engine architecture leaking into an AM filing.
  const powerLabel = isAmPat ? 'TPO' : 'ERP';
  const captionBits = [
    `Filed directional-antenna horizontal radiation pattern — relative field f(az) per ${mode}.`,
    'Polygon shows the pattern shape that drove every contour distance, §73.207/§73.215 protection check, and (for AM) the §73.182 NIF + §73.99 reduced-power compute.',
    Number.isFinite(erp) ? `Maximum ${powerLabel} at f=1.0: ${erp.toFixed(2)} kW.` : null,
    isAmPat
      ? 'f(az)² scales TPO per radial; the polygon below is f, not f² (matches FCC AM filing convention).'
      : 'f(az)² scales the ERP per radial; the polygon below is f, not f² (matches FCC filing convention).'
  ].filter(Boolean).join('  ');

  return {
    id:        'da-pattern-chart',
    type:      'polar-chart',
    heading:   'Antenna pattern — horizontal radiation polygon',
    data,
    r_unit:    'f',
    r_max:     1.0,
    caption:   captionBits
  };
}

// §73.314 terrain-aware coverage overlay — renders the ITM (terrain)
// coverage ring AND the §73.333 free-space ring on the same plot so
// a reviewer can SEE where terrain warped the predicted coverage.
//
// Source data:
//   - exhibit.itm_polygons[0].ring_latlng (closed ring, lat/lon pairs)
//   - exhibit.evidence.itm_coverage.radials[].fcc_distance_km
//     used to synthesize the §73.333 free-space ring
// Skipped if ITM didn't run or there are <12 radials in the ring.
export function buildItmCoverageOverlaySection(exhibit){
  const itm = (exhibit?.itm_polygons || [])[0];
  if (!itm?.closed || !Array.isArray(itm.ring_latlng) || itm.ring_latlng.length < 12) return null;

  const tx_lat = Number(exhibit?.station_inputs?.lat);
  const tx_lon = Number(exhibit?.station_inputs?.lon);
  if (!Number.isFinite(tx_lat) || !Number.isFinite(tx_lon)) return null;

  // Build the §73.333 free-space ring by projecting fcc_distance_km
  // along each ITM radial's azimuth.  Same projection convention as
  // engine/index.js#projectVertex (great-circle, NAD83/WGS84 sphere).
  const radials = exhibit?.evidence?.itm_coverage?.radials || [];
  const fccRing = [];
  for (const r of radials){
    const d  = Number(r?.fcc_distance_km);
    const az = Number(r?.az ?? r?.azimuth_deg);
    if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(az)) continue;
    fccRing.push(projectVertex(tx_lat, tx_lon, az, d));
  }
  if (fccRing.length >= 4){
    const [first] = fccRing;
    fccRing.push([first[0], first[1]]);
  }

  const polygons = [];
  if (fccRing.length >= 4){
    polygons.push({
      ring_latlng: fccRing,
      label:       '§73.333 free-space contour',
      stroke:      '#1c2e3a',
      fill:        '#1c2e3a',
      fill_opacity: 0.06,
      line_width:  0.8,
      dashed:      true
    });
  }
  polygons.push({
    ring_latlng: itm.ring_latlng,
    label:       'Terrain-aware (ITM)',
    stroke:      '#c4745a',
    fill:        '#f3c86d',
    fill_opacity: 0.18,
    line_width:  1.3
  });

  const delta = itm.delta_mean_km;
  const captionBits = [
    'Terrain-aware coverage (§73.314 supplementary) overlaid on the §73.333 free-space contour.',
    'Solid amber = ITM-modeled service area (Bullington smooth-earth + ITU-R P.526 single-knife-edge diffraction over DEM elevations, or full Longley-Rice when the SPLAT sidecar runs).',
    'Dashed teal = §73.333 free-space prediction (compliance reference).',
    Number.isFinite(delta)
      ? `Mean radial delta: ${delta >= 0 ? '+' : ''}${delta.toFixed(2)} km (terrain ${delta >= 0 ? 'extends' : 'falls short of'} free-space).`
      : null,
    itm.engine ? `Engine: ${itm.engine}${itm.tier ? ' (' + itm.tier + ')' : ''}.` : null,
    itm.dem_source ? `DEM: ${itm.dem_source}.` : null
  ].filter(Boolean).join('  ');

  return {
    id:        'itm-coverage-overlay',
    type:      'polygon-overlay',
    heading:   '§73.314 — terrain-aware coverage overlay',
    tx:        { lat: tx_lat, lon: tx_lon },
    polygons,
    caption:   captionBits
  };
}

// Great-circle vertex projection — same math as engine/index.js
// uses for ring closure.  az: 0° = N, clockwise; d in km.
function projectVertex(lat0, lon0, az_deg, d_km){
  const R = 6371.0088;
  const az = az_deg * Math.PI / 180;
  const dr = d_km / R;
  const lat1 = lat0 * Math.PI / 180;
  const lon1 = lon0 * Math.PI / 180;
  const sinLat2 = Math.sin(lat1) * Math.cos(dr) + Math.cos(lat1) * Math.sin(dr) * Math.cos(az);
  const lat2 = Math.asin(sinLat2);
  const y = Math.sin(az) * Math.sin(dr) * Math.cos(lat1);
  const x = Math.cos(dr) - Math.sin(lat1) * sinLat2;
  const lon2 = lon1 + Math.atan2(y, x);
  return [lat2 * 180 / Math.PI, ((lon2 * 180 / Math.PI) + 540) % 360 - 180];
}

export function buildFortranParityChartSection(exhibit){
  const ev = exhibit?.evidence?.fcc_curve_parity;
  if (!ev || !ev.available) return null;
  const pairs = Array.isArray(ev.pairs) ? ev.pairs : [];
  if (pairs.length < 4) return null;

  // Plot Δkm (engine − FORTRAN) vs azimuth; one point per (radial × contour).
  const data = pairs
    .map((p) => ({
      x:  Number(p.azimuth_deg),
      y:  Number(p.delta_km),
      ok: Number.isFinite(Number(p.abs_delta_km))
            ? Number(p.abs_delta_km) <= Number(ev.tolerance_km || 0.05)
            : true
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (data.length < 4) return null;

  const captionBits = [
    `Per-(radial × contour) parity vs FCC TVFMFS reference engine (${ev.source || 'fcc-tvfmfs-fortran'}).`,
    `${ev.n_ok}/${ev.n_requests} pairs within tolerance ${Number(ev.tolerance_km).toFixed(3)} km.`,
    Number.isFinite(ev.max_abs_delta_km) ? `Max |Δ| ${Number(ev.max_abs_delta_km).toFixed(3)} km.` : null,
    Number.isFinite(ev.rms_delta_km)     ? `RMS Δ ${Number(ev.rms_delta_km).toFixed(4)} km.`      : null,
    ev.pass ? 'PASS.' : 'FAIL — see Appendix C for detail.'
  ].filter(Boolean).join('  ');

  return {
    id:          'fcc-fortran-parity-chart',
    type:        'scatter-chart',
    heading:     'Appendix C-1 — FCC FORTRAN parity scatter',
    data,
    x_label:     'Azimuth (°)',
    y_label:     'Δ km  (engine − FCC FORTRAN)',
    x_min:       0,
    x_max:       360,
    y_symmetric: true,
    tolerance:   Number(ev.tolerance_km) || 0.05,
    caption:     captionBits
  };
}

// ---------------------------------------------------------------------------
// Nearby Stations Distribution — every protected station drawn at its
// (bearing, distance) from the subject TX, color-coded by §73.215 pass/fail.
// Lets an engineer eyeball the regulatory neighborhood — "all the fails are
// to the northwest at < 80 km" — instead of paging through the table in
// Appendix B.  V-Soft tabulates this data; nobody else plots it.
// ---------------------------------------------------------------------------
export function buildNearbyStationsChartSection(exhibit){
  const isr = exhibit?.interference_study;
  if (!isr || !Array.isArray(isr.stations) || isr.stations.length === 0) return null;
  const txLat = Number(exhibit?.station_inputs?.lat);
  const txLon = Number(exhibit?.station_inputs?.lon);
  if (!Number.isFinite(txLat) || !Number.isFinite(txLon)) return null;
  const nearby = Array.isArray(exhibit.evidence?.nearby_primaries)
    ? exhibit.evidence.nearby_primaries : [];
  const byCall = new Map();
  const byFid  = new Map();
  for (const n of nearby){
    if (n?.call)        byCall.set(String(n.call).toUpperCase(), n);
    if (n?.facility_id) byFid.set(String(n.facility_id), n);
  }
  const lookupLatLon = (s) => {
    const hit = (s?.call && byCall.get(String(s.call).toUpperCase()))
             || (s?.facility_id && byFid.get(String(s.facility_id)));
    if (!hit) return null;
    const lat = Number(hit.lat ?? hit.latitude);
    const lon = Number(hit.lon ?? hit.longitude);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  };
  // Great-circle initial bearing from (lat1, lon1) to (lat2, lon2), 0..360.
  const bearingDeg = (lat1, lon1, lat2, lon2) => {
    const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  };
  const data = [];
  let n_pass = 0, n_fail = 0;
  for (const st of isr.stations){
    const dKm = Number(st.distance_km);
    if (!Number.isFinite(dKm) || dKm <= 0) continue;
    const ll  = lookupLatLon(st);
    if (!ll) continue;
    const bear = bearingDeg(txLat, txLon, ll.lat, ll.lon);
    const ok   = st.pass_overall !== false;
    if (ok) n_pass++; else n_fail++;
    data.push({ x: bear, y: dKm, ok });
  }
  if (data.length < 3) return null;
  return {
    id:        'nearby-stations-chart',
    type:      'scatter-chart',
    heading:   'Nearby protected stations — bearing × distance',
    data,
    x_label:     'Bearing from subject TX (deg, 0 = north)',
    y_label:     'Distance (km)',
    x_min:       0,
    x_max:       360,
    caption:     `${data.length} protected station(s) plotted at their great-circle ` +
                 `(bearing, distance) from the subject TX.  Amber points pass under ` +
                 `§73.207 / §73.215; red points fail.  ` +
                 `${n_pass} pass / ${n_fail} fail.  ` +
                 `Use this plot to spot directional clustering of conflicts — ` +
                 `e.g. all failures concentrated on one heading often indicates a ` +
                 `single co-channel cluster, while scattered failures suggest a ` +
                 `wide-area allocation problem.  Subject TX is at (0, 0) by construction.`
  };
}
// around the tx so an engineer can see the environmental clutter pattern
// at a glance.  Pulls from evidence.geo_rf_evidence.datasets.tree_canopy.rose
// which the Geo-RF Evidence sidecar populates as part of every compute.
// ADVISORY — does not modify FCC contour distances.
// ---------------------------------------------------------------------------
export function buildCanopyRosePolarSection(exhibit){
  const ge = exhibit?.evidence?.geo_rf_evidence;
  if (!ge || ge.status !== 'run') return null;
  const tc = (ge.datasets?.tree_canopy && ge.datasets.tree_canopy.available)
               ? ge.datasets.tree_canopy
               : (ge.datasets?.tree_canopy_conus || {});
  const rose = tc.rose;
  if (!rose || !Array.isArray(rose.samples) || rose.samples.length < 6) return null;
  const data = rose.samples
    .map(s => ({
      // Sidecar emits the per-sample azimuth as `az_deg` (see
      // geoRfEvidenceClient.sampleCanopyRose); the older internal
      // shape used `azimuth_deg`.  Accept both so we keep working
      // across contract drifts.
      azimuth_deg: Number(s.az_deg ?? s.azimuth_deg),
      value:       Number(s.value_numeric)
    }))
    .filter(p => Number.isFinite(p.azimuth_deg) && Number.isFinite(p.value));
  if (data.length < 6) return null;
  const vals = data.map(p => p.value);
  const min  = Math.min(...vals);
  const max  = Math.max(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    id:        'canopy-rose-chart',
    type:      'polar-chart',
    heading:   'Tree-canopy rose — environmental clutter around tx',
    data,
    r_unit:    '%',
    r_max:     Math.max(20, Math.ceil(max * 1.15)),
    caption:   `Per-azimuth canopy density at ${rose.distance_km} km radius from the transmitter, ` +
               `from the USFS Tree Canopy CONUS 2022 (${tc.dataset || 'science_tcc_CONUS_2022_v2023-5'}) advisory raster.  ` +
               `${rose.n_azimuths} azimuths · min ${min}% · max ${max}% · mean ${mean.toFixed(1)}%.  ` +
               `Larger spread between min and max indicates directional environmental heterogeneity ` +
               `(e.g. transmitter on a cleared peak surrounded by forest on one heading).  ` +
               `ADVISORY ONLY: does not modify FCC §73.333 contour distances or any filing-controlling rule output.`
  };
}

// ---------------------------------------------------------------------------
// Per-radial HAAT polar plot — shows tower elevation advantage by azimuth.
// Useful: a station with high HAAT to the south + low HAAT to the north
// produces an asymmetric service contour even on a non-directional antenna.
// Pulls from exhibit.radial_table which is populated for FM / FX / LPFM /
// TV exhibits with terrain HAAT (either ZTR or multi-source DEM path).
// ---------------------------------------------------------------------------
export function buildHaatPolarChartSection(exhibit){
  const svc = String(exhibit?.station_inputs?.service || '').toUpperCase();
  if (svc === 'AM') return null;     // §73.184 grid is sigma/distance, not HAAT
  const rows = Array.isArray(exhibit?.radial_table) ? exhibit.radial_table : [];
  if (rows.length < 6) return null;
  const data = rows
    .map(r => ({
      azimuth_deg: Number(r.azimuth_deg ?? r.az_deg),
      value:       Number(r.haat_m)
    }))
    .filter(p => Number.isFinite(p.azimuth_deg) && Number.isFinite(p.value) && p.value > 0);
  if (data.length < 6) return null;
  const vals = data.map(p => p.value);
  const min  = Math.min(...vals);
  const max  = Math.max(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const spread = max - min;
  // Only emit when there's enough variation to be visually informative;
  // a constant-HAAT exhibit (e.g. CONSTANT_HAAT_ASSUMED) renders as a
  // flat circle and adds no signal.
  if (spread < 5) return null;
  return {
    id:        'haat-polar-chart',
    type:      'polar-chart',
    heading:   'Per-radial HAAT polar — terrain elevation advantage by azimuth',
    data,
    r_unit:    'm',
    r_max:     Math.ceil(max * 1.08),
    caption:   `Height Above Average Terrain (HAAT) per 47 CFR §73.313 evaluated on each ${
                 rows.length >= 36 ? Math.round(360 / rows.length) : 'recorded'} ` +
               `degree azimuth.  Range ${min.toFixed(0)}–${max.toFixed(0)} m, mean ${mean.toFixed(0)} m, spread ${spread.toFixed(0)} m.  ` +
               `Higher HAAT on a given heading yields longer §73.333 service contours on that same heading; ` +
               `this plot makes terrain-driven coverage asymmetry visible at a glance even on non-directional antennas.`
  };
}

// ---------------------------------------------------------------------------
// Service-contour polar plot — the primary (60 dBu / 0.5 mV/m) contour
// distance per azimuth, drawn as a closed polar polygon.  Renders the
// actual shape of the protected service area.  For non-directional + flat
// terrain this is a circle; with directional antennas or terrain variation
// it shows the real footprint shape that V-Soft tabulates as a number list.
// ---------------------------------------------------------------------------
export function buildContourPolarChartSection(exhibit){
  const svc = String(exhibit?.station_inputs?.service || '').toUpperCase();
  const rows = Array.isArray(exhibit?.radial_table) ? exhibit.radial_table : [];
  if (rows.length < 6) return null;
  // Pick the "primary" contour id per service.
  const primaryId = svc === 'AM' ? 'primary_5mvm'
                  : svc === 'LPFM' ? 'service_60dbu'
                  : 'service_60dbu';
  const data = rows
    .map(r => {
      const dKm = r.contour_distances_km?.[primaryId];
      return {
        azimuth_deg: Number(r.azimuth_deg ?? r.az_deg),
        value:       Number(dKm)
      };
    })
    .filter(p => Number.isFinite(p.azimuth_deg) && Number.isFinite(p.value) && p.value > 0);
  if (data.length < 6) return null;
  const vals = data.map(p => p.value);
  const min  = Math.min(...vals);
  const max  = Math.max(...vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return {
    id:        'service-contour-polar',
    type:      'polar-chart',
    heading:   svc === 'AM'
                 ? 'Primary service contour polar — 5 mV/m per 47 CFR §73.184'
                 : 'Service contour polar — 60 dBu (1 mV/m) per 47 CFR §73.333',
    data,
    r_unit:    'km',
    r_max:     Math.ceil(max * 1.08),
    caption:   `Per-azimuth service-contour distance from the transmitter.  ` +
               `Range ${min.toFixed(1)}–${max.toFixed(1)} km, mean ${mean.toFixed(1)} km.  ` +
               `Drawn from the same per-radial values that populate Appendix A — visualizes the actual ` +
               `shape of the protected service footprint, including directional-antenna shaping and ` +
               `terrain-driven asymmetry.`
  };
}
