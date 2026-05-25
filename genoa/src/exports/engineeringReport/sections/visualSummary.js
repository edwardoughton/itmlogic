// Visual Summary — the showpiece page.
//
// Composes everything the engineer already computed into one stylized
// composition that a non-engineer can read at a glance:
//   - service contours (city / primary / secondary / night)
//   - population dot-density inside the primary contour
//   - environmental tree-canopy halo at the transmitter site
//   - big stylized population + canopy stats
//   - advisory banner verbatim
//
// All data comes from the exhibit that already exists; no extra sidecar
// calls happen at render time.  Renders only when there are real
// contours to plot AND finite tx coordinates.  Otherwise returns null
// and the page is skipped.
//
// REGULATORY POSTURE
//   Population values are INFORMATIONAL ONLY (verbatim from the
//   contour-results limitations).  Tree canopy is ADVISORY ONLY and
//   FROM the geo-RF evidence sidecar (filing_effect=none).  This page
//   does NOT modify FCC §73.184 / §73.333 contour distances or any
//   filing-controlling rule output.

export function buildVisualSummarySection(exhibit){
  const inp = exhibit?.station_inputs || {};
  const txLat = Number(inp.lat);
  const txLon = Number(inp.lon);
  if (!Number.isFinite(txLat) || !Number.isFinite(txLon)) return null;

  // Contour radii live on exhibit.polygons (engine/index.js:337) as
  //   { contour_id, label, mean_radial_km, area_km2, field_strength, ... }
  // exhibit.contour_definitions carries only { id, label, field_strength }
  // — it does NOT include radii, so we key off polygons here.  When
  // polygons is empty (coordinates missing / non-coord exhibit) the
  // section is skipped.
  const polys = Array.isArray(exhibit?.polygons) ? exhibit.polygons : [];
  if (polys.length === 0) return null;
  const defs = Array.isArray(exhibit?.contour_definitions) ? exhibit.contour_definitions : [];

  // Build a stable, ordered palette of rings — outermost first so the
  // renderer paints back-to-front (large washes underneath, tight rings
  // on top).  IDs follow the engine's contour ID convention.
  // Higher opacity so the rings actually read at print size.  Previously
  // 0.05-0.28 produced rings nearly invisible on the PDF.  Bumped to
  // 0.20-0.55 — readable from across the room, still translucent enough
  // that overlapping rings show their nesting.
  const PALETTE = {
    night_intf:      { color: '#2b4a5d', label: '0.025 mV/m night',  fill_opacity: 0.20,  dashed: true  },
    secondary_05mvm: { color: '#d6a85d', label: '0.5 mV/m secondary',fill_opacity: 0.32,  dashed: false },
    primary_2mvm:    { color: '#c8843c', label: '2 mV/m primary',    fill_opacity: 0.45,  dashed: false },
    city_5mvm:       { color: '#a8412a', label: '5 mV/m city grade', fill_opacity: 0.55,  dashed: false },
    // FM/FX/LPFM/TV dBu contours use the same warm-to-deep ramp.
    protected_40dbu: { color: '#2b4a5d', label: '40 dBu protected',  fill_opacity: 0.20,  dashed: true  },
    city_54dbu:      { color: '#d6a85d', label: '54 dBu city grade', fill_opacity: 0.40,  dashed: false },
    service_60dbu:   { color: '#a8412a', label: '60 dBu (1 mV/m)',   fill_opacity: 0.55,  dashed: false }
  };

  const labelById = new Map(defs.map(d => [String(d?.id || '').toLowerCase(), d?.label]));
  const contours = polys
    .map((p) => {
      const km = Number(p?.mean_radial_km);
      if (!Number.isFinite(km) || km <= 0) return null;
      const id = String(p?.contour_id || '').toLowerCase();
      const style = PALETTE[id] || { color: '#666666', label: p?.label || id, fill_opacity: 0.08, dashed: false };
      return {
        id,
        label:        p?.label || labelById.get(id) || style.label,
        radius_km:    km,
        area_km2:     Number(p?.area_km2),
        color:        style.color,
        fill_opacity: style.fill_opacity,
        dashed:       style.dashed,
        is_dominant:  id === 'primary_2mvm'    // primary is the "people inside" reference
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.radius_km - a.radius_km);   // outermost first

  if (contours.length === 0) return null;

  // Population — informational only.  exhibit.population_estimate is
  // attached for both AM and FM exhibits when the population sidecar /
  // FCC Census / ACS chain returned a count.
  const pe = exhibit?.population_estimate || {};
  const persons = Number.isFinite(Number(pe.persons))
    ? Math.max(0, Math.round(Number(pe.persons)))
    : null;
  // Cap dot count for huge metros so the dominant ring doesn't render as
  // a solid black disk.  The renderer enforces a hard max again (defense
  // in depth) but the model already publishes the planned count so it
  // can be inspected without instantiating pdfkit.
  const DOT_CEILING = 680;
  const plannedDots = persons != null
    ? Math.min(DOT_CEILING, Math.max(0, Math.ceil(persons / Math.max(1, Math.ceil(persons / DOT_CEILING)))))
    : 0;
  const peoplePerDot = persons != null && plannedDots > 0
    ? Math.max(1, Math.ceil(persons / plannedDots))
    : null;
  const population = persons != null
    ? {
        persons,
        source:       pe.source  || null,
        vintage:      pe.vintage || null,
        planned_dots: plannedDots,
        people_per_dot: peoplePerDot
      }
    : null;

  // Environmental RF evidence — geo-RF tree canopy at tx site.  Both
  // the canonical `tree_canopy` slot and the legacy `tree_canopy_conus`
  // slot are checked so older sidecar contracts still render.  The
  // 12-azimuth canopy rose summary (when present) carries far more
  // engineering signal than the single TX-point value alone: a TX on a
  // cleared peak surrounded by heavy forest (e.g. WNBZ at 32 % TX-point
  // but rose mean 80 %) is a different propagation environment than a
  // TX on a uniform open plain.  Surface the rose stats here so the
  // visual showpiece carries the actual environmental context.
  const ge = exhibit?.evidence?.geo_rf_evidence;
  const tc = (ge?.datasets?.tree_canopy && ge.datasets.tree_canopy.available)
               ? ge.datasets.tree_canopy
               : (ge?.datasets?.tree_canopy_conus || {});
  let canopy = null;
  if (ge?.status === 'run' && tc.available){
    canopy = {
      value_numeric:  Number.isFinite(Number(tc.value_numeric)) ? Number(tc.value_numeric) : null,
      value_raw:      tc.value_raw || null,
      dataset:        tc.dataset || null,
      interpretation: tc.interpretation || null,
      rose:           null
    };
    const rose = tc.rose && Array.isArray(tc.rose.samples) ? tc.rose : null;
    if (rose){
      const vals = rose.samples
        .map(s => Number(s.value_numeric))
        .filter(Number.isFinite);
      if (vals.length){
        canopy.rose = {
          n_azimuths:   rose.n_azimuths,
          distance_km:  rose.distance_km,
          min:          Math.min(...vals),
          max:          Math.max(...vals),
          mean:         Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1)),
          n_in_coverage: vals.length,
          n_total:      rose.samples.length
        };
      }
    }
  }

  const fmtKhz = (f) => {
    const n = Number(f);
    if (!Number.isFinite(n)) return null;
    if (String(inp.frequency_unit || '').toLowerCase() === 'khz' || (n > 500 && n < 1800)) return `${Math.round(n)} kHz`;
    if (n > 80 && n < 110) return `${n.toFixed(1)} MHz`;
    return `${n} ${inp.frequency_unit || ''}`.trim();
  };

  return {
    id:      'visual-summary',
    type:    'visual-summary',
    heading: 'COVERAGE & ENVIRONMENT — VISUAL SUMMARY',
    tx: {
      lat:           txLat,
      lon:           txLon,
      call:          inp.call         || null,
      facility_id:   inp.facility_id  || null,
      service:       String(inp.service || '').toUpperCase() || null,
      fcc_class:     inp.fcc_class    || null,
      frequency:     fmtKhz(inp.frequency),
      erp_kw:        Number(inp.erp_kw),
      community:     inp.community_of_license || inp.community || null
    },
    contours,
    population,
    canopy,
    // Typography + layout hints consumed by renderPdf.js.  These are not
    // required (the renderer falls back to sane defaults) but allow the
    // visual page to scale with metro density and locale word lengths.
    display_hints: {
      station_label_size:    24,   // call-letter headline, oversized for read-at-a-glance
      sub_label_size:        9,
      stat_label_size:       8,
      stat_value_size:       22,
      advisory_label_size:   8,
      legend_size:           8,
      max_dots:              680,
      wrap_station_subline:  true  // wrap the "Community · Frequency · Service · Class · ERP" line
                                   // instead of clipping when it exceeds the sidebar width
    },
    advisory: 'Environmental RF evidence is advisory only.  Does not modify FCC filing-controlling contour or allocation calculations.  Population values are informational only — FCC compliance is determined by distance and field-strength tests, not population.'
  };
}
