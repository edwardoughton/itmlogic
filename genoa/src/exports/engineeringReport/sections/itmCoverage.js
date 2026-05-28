// 47 CFR §73.314 — supplementary terrain-aware coverage study.
//
// SCOPE
//   This section is OPTIONAL evidence beyond the §73.333 deterministic
//   contour.  It surfaces the per-radial terrain ITM analysis that
//   Genoa's coverage engine produces (Bullington smooth-earth + ITU-R
//   P.526 single-knife-edge diffraction over a real DEM, or — when the
//   SPLAT sidecar is reachable — a full Longley-Rice ITM run).
//
//   The §73.333 contour remains the compliance reference for §73.207 /
//   §73.215 protection studies; this section explains where the actual
//   coverage diverges from the free-space prediction (ridge shadowing,
//   knife-edge diffraction, terrain enhancement).
//
// EMITTED ONLY when exhibit.itm_polygons[0] is present (ITM ran and
// produced a closed ring).  Otherwise nothing is added — keeps the
// report short for stations where ITM wasn't reachable.

export function buildItmCoverageSection(exhibit, options){
  const itm = (exhibit?.itm_polygons || [])[0];
  const evidence = exhibit?.evidence?.itm_coverage;
  // When ITM coverage was REQUESTED but both SPLAT and the JS fallback
  // failed to produce closed-ring evidence, render a transparent
  // placeholder instead of silently dropping the section.  The operator
  // checked the "compute terrain ITM" box and deserves to see why their
  // §73.314 study didn't make it into the PDF.
  if (!itm || !itm.closed){
    const unavail = exhibit?.evidence?.itm_coverage_unavailable;
    if (unavail?.attempted){
      const splat = unavail.splat_attempt || {};
      const rows = [
        ['Method',          '47 CFR §73.314 supplementary terrain-aware coverage (attempted)'],
        ['Status',          'UNAVAILABLE — coverage not closed within compute budget'],
        ['SPLAT sidecar',   splat.available
                              ? 'reached'
                              : `unavailable${splat.error ? ' — ' + splat.error : ''}`],
        ['JS fallback',     'attempted (Bullington + ITU-R P.526)'],
        ['Filing effect',   'NONE — §73.314 ITM is supplementary; §73.333 contour distances are unaffected'],
        ['Guidance',        unavail.guidance || 'Re-run with longer SPLAT timeout or check SPLAT sidecar health.']
      ];
      return {
        id:      'itm-coverage',
        type:    'kv',
        heading: 'ITM COVERAGE — 47 CFR §73.314 (ATTEMPTED, UNAVAILABLE)',
        preface: 'Terrain-aware Longley-Rice ITM coverage was requested for this exhibit but did not complete.  This is SUPPLEMENTARY EVIDENCE under §73.314; the §73.333 deterministic contour distances reported elsewhere remain the filing-controlling reference and are unaffected by this section.',
        rows
      };
    }
    return null;
  }

  const meanT = itm.mean_radial_km;
  const meanF = itm.fcc_mean_km;
  const delta = itm.delta_mean_km;
  const deltaPct = (meanT != null && meanF != null && meanF > 0)
    ? (delta / meanF) * 100
    : null;

  const rows = [
    ['Method',            itm.method || '—'],
    ['Citation',          itm.cite || '47 CFR §73.314'],
    ['Engine',            itm.engine ? `${itm.engine}${itm.tier ? ' (' + itm.tier + ')' : ''}` : '—'],
    ['DEM source',        itm.dem_source || '—'],
    ['Service threshold', itm.field_strength?.value != null
                            ? `${itm.field_strength.value} ${itm.field_strength.unit || 'dBu'}`
                            : '—'],
    ['Radials evaluated',     `${itm.n_radials} (closed ring); ${itm.n_blocked_radials} blocked / beyond range`],
    ['Mean radial — terrain', meanT != null ? `${meanT} km` : '—'],
    ['Mean radial — §73.333', meanF != null ? `${meanF} km` : '—'],
    ['Δ (terrain − §73.333)', delta != null
                                ? `${delta >= 0 ? '+' : ''}${delta} km${deltaPct != null ? `  (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%)` : ''}`
                                : '—'],
    ['Service area (terrain)', itm.area_km2 != null ? `${Math.round(itm.area_km2).toLocaleString()} km²` : '—']
  ];

  const interp = buildInterpretation({ delta, deltaPct, n_blocked: itm.n_blocked_radials, n_radials: itm.n_radials });

  return {
    id:      'itm_coverage',
    type:    'paragraphs-with-kv',
    heading: 'TERRAIN-AWARE COVERAGE STUDY',
    paragraphs: [
      'This section presents a supplementary terrain-aware coverage analysis ' +
      'per 47 CFR §73.314.  Coverage is sampled along each radial over real ' +
      'DEM elevations and predicted via Bullington smooth-earth path loss with ' +
      'ITU-R P.526 single-knife-edge diffraction at the worst obstruction; ' +
      'where the SPLAT sidecar is reachable, the analysis uses the full ' +
      'Longley-Rice ITM solver instead.',

      'Per FCC convention the §73.333 contour remains the compliance reference ' +
      'for §73.207 / §73.215 protection.  The terrain analysis below is ' +
      'evidentiary: it characterizes how actual coverage diverges from the ' +
      'free-space prediction.  Negative deltas indicate ridge shadowing or ' +
      'knife-edge diffraction loss; positive deltas typically reflect ' +
      'multipath enhancement or favorable terrain.',

      interp
    ].filter(Boolean),
    rows
  };
}

function buildInterpretation({ delta, deltaPct, n_blocked, n_radials }){
  if (delta == null) return null;
  const sign = delta >= 0 ? 'extends' : 'falls short of';
  const absPct = Math.abs(deltaPct ?? 0).toFixed(0);
  let msg = `On average across ${n_radials} closed radials, the terrain-aware service contour ${sign} ` +
            `the §73.333 free-space prediction by ${Math.abs(delta).toFixed(2)} km (~${absPct}%).`;
  if (n_blocked > 0){
    msg += `  ${n_blocked} radial${n_blocked === 1 ? '' : 's'} did not reach the service threshold ` +
           `within the analysis arc — interpret these as terrain-blocked (no service in that direction) ` +
           `or beyond the model's max-range bound; verify with the per-radial table in the appendix.`;
  }
  if (Math.abs(deltaPct ?? 0) >= 15){
    msg += `  A delta of this magnitude is significant for filing review; the qualified engineer ` +
           `should examine the per-radial profile to confirm the dominant mechanism (single-edge ` +
           `diffraction vs. multipath enhancement) before accepting the §73.333 contour as the ` +
           `practical service area.`;
  }
  return msg;
}
