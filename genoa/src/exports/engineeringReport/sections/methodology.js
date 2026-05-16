// Methodology — traditional consulting wording + Genoa's reproducibility advantage.

export function buildMethodologySection(exhibit){
  const svc = String(exhibit.station_inputs?.service || '').toUpperCase();
  const mv  = exhibit.method_versions || {};
  const ev  = exhibit.evidence || {};
  const ip  = exhibit.interpolation || {};

  const paragraphs = [];
  if (svc === 'FM' || svc === 'LPFM' || svc === 'FX'){
    paragraphs.push(
      'Propagation curves for FM broadcast stations were determined using the F(50,50) and F(50,10) curves specified in 47 CFR §73.333.',
      'Height Above Average Terrain was evaluated in accordance with 47 CFR §73.313.',
      'Contour distances were determined by interpolation of FCC tabulated data.'
    );
  } else if (svc === 'AM'){
    paragraphs.push(
      'AM groundwave field strengths were determined using the curves specified in 47 CFR §73.184 and the engineering standards of allocation in 47 CFR §73.183.',
      'Where applicable, nighttime skywave protection was evaluated under 47 CFR §73.187 using the SS-1 (50%) field strength formulation of 47 CFR §73.190.',
      'Field-strength values were determined by interpolation of FCC tabulated data.'
    );
  }
  paragraphs.push(
    'Genoa uses a bivariate cubic surface interpolation consistent with the FCC contours implementation and records the curve dataset hash for reproducibility.'
  );
  if (exhibit.engineering_confidence){
    paragraphs.push(
      'A terrain-aware engineering-confidence layer assesses each radial against the curve prediction using terrain metrics and any attached SDR or ITM residuals.  ' +
      'This assessment is advisory only; it does not modify FCC curve outputs or §73.207 / §73.215 compliance results.'
    );
  }

  const cd = mv.curve_dataset || {};
  const isAm = svc === 'AM';
  const datasetLabel = mv.dataset
    || cd.label
    || cd.name
    || (isAm ? `FCC §73.184 groundwave (vendored gwave.js v${cd.curve_version || '?'})`
             : `FCC tvfm_curves.js (vendored, fcc/contours-api-node v${cd.curve_version || '?'})`);
  const engineLabel = mv.curve_engine
    || (isAm ? 'gwave.js (vendored FCC §73.184 grid)' : '—');
  // For AM exhibits, HAAT-along interpolation isn't applicable (the
  // engine reads §73.184 Figure M3 curves keyed on σ × distance), and
  // there's no terrain elevation model in the pipeline either.  Show
  // band-appropriate rows instead of "n/a" / "—" sprawl.
  const baseRows = [
    ['Curve dataset',          datasetLabel],
    ['Curve dataset SHA-256',  cd.meta_sha256 || mv.dataset_meta_sha256 || '—'],
    ['Curve engine',           engineLabel]
  ];
  // AM groundwave doesn't use a field-strength interpolation grid in
  // the FM sense — the engine sets along_field='n/a'.  Showing "n/a"
  // on the methodology page is just noise.
  if (!isAm){
    baseRows.push(['Interpolation — field', ip.along_field || mv.interpolation || '—']);
  }
  const heightRows = isAm
    ? [['Interpolation — σ',       'bivariate over (σ × distance) per §73.184 Figure M3']]
    : [['Interpolation — HAAT',    ip.along_haat || '—']];
  const terrainRows = isAm
    ? []        // AM doesn't use a DEM; skip the rows entirely
    : [
        ['Terrain source',         ev.terrain?.source   || 'flat HAAT'],
        ['DEM dataset',            ev.terrain?.dem?.dataset || ev.terrain?.dem?.source || '—']
      ];
  return {
    id:      'methodology',
    type:    'paragraphs-with-kv',
    heading: 'METHODOLOGY',
    paragraphs,
    rows: [
      ...baseRows,
      ...heightRows,
      ['Projection',             mv.projection        || '—'],
      ['Distance method',        '47 CFR §73.208 — great-circle (WGS-84 Karney 2013 inverse)'],
      ...terrainRows,
      ['Radial step',            (exhibit.station_inputs?.radial_step_deg || 10) + '°'],
      ['FCC orchestration commit', mv.fcc_orchestration?.commit || '—']
    ]
  };
}
