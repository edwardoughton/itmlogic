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
      'Where applicable, nighttime skywave protection was evaluated under 47 CFR §73.182(k) (nighttime interference-free service / RSS combination per §73.185) using the SS-1 (50%) field strength formulation of 47 CFR §73.190.',
      'Field-strength values were determined by interpolation of FCC tabulated data.'
    );
  }
  // Interpolation kernel: FM/TV uses the FCC tvfm_curves bivariate cubic
  // surface over (HAAT × distance); AM uses log-linear interpolation
  // along distance on the §73.184 pre-tabulated field grid (gwave.js)
  // at fixed integer ground-conductivity values per §73.190 Figure M3
  // (1, 2, 4, 6, 8, 15, 30 mS/m).  The two methods are different and
  // citing only "bivariate cubic" misrepresents AM.
  paragraphs.push(
    svc === 'AM'
      ? 'For §73.184 groundwave evaluation, Genoa performs log-linear interpolation along distance on the FCC §73.184 pre-tabulated field grid at the §73.190 Figure M3 reference conductivities and records the curve dataset SHA-256 for reproducibility.  Operator-supplied σ is rounded to the nearest M3 reference value; any rounding is recorded in the exhibit provenance.'
      : 'For §73.333 FM/TV evaluation, Genoa uses a bivariate cubic surface interpolation across (HAAT × distance) consistent with the FCC contours-api-node reference implementation and records the curve dataset SHA-256 for reproducibility.'
  );
  if (exhibit.engineering_confidence){
    paragraphs.push(
      'A terrain-aware engineering-confidence layer assesses each radial against the curve prediction using terrain metrics and any attached SDR or ITM residuals.  ' +
      'This assessment is advisory only; it does not modify FCC curve outputs or §73.207 / §73.215 compliance results.'
    );
  }
  // Three-variability disclosure (Beverage, Radio World "Propagation
  // Analysis for Profit", June 2017 p. 19-20).  The F(50,50) and
  // F(50,10) curve names encode TWO statistical dimensions but a real
  // RF prediction has THREE.  Reading "F(50,50)" without understanding
  // what each "50" represents is a common source of false-confidence
  // among non-RF reviewers.  We document all three here so the verdict
  // and contour numbers are interpretable.
  //
  // FM/TV uses both F(50,50) and F(50,10) explicitly.  AM under
  // §73.184 is also a statistical curve (50% time / 50% locations
  // implicit), so the same variability framework applies — surfacing
  // it on AM exhibits eliminates the misread that "the curve is
  // deterministic and the contour is a hard line."
  paragraphs.push(
    svc === 'AM'
      ? 'Statistical interpretation (per Beverage, Radio World, June 2017).  AM groundwave field-strength predictions under §73.184 are statistical, not deterministic, and rest on three independent variability dimensions: (1) Time Variability — the percentage of hours during which the actual field meets or exceeds the predicted value (the §73.184 grid is a 50%-time formulation; the night-interference 0.025 mV/m contour uses §73.190 SS-1 50%-time skywave); (2) Location Variability — the percentage of geographic locations along the radial at which the actual field meets or exceeds the predicted value, controlled by ground-conductivity uniformity across the path (M3 reference value is an idealization; actual σ varies seasonally and with soil-moisture / urbanization); and (3) Situation Variability — system-to-system differences (antenna pattern realization, atmospheric ducting that occasionally puts a 5 kW signal 300 miles away, daily noise floor) that the static curve cannot model.  The contour distances reported below are the regulatory-line median; the listenable line for any specific listener depends on all three variabilities simultaneously.'
      : 'Statistical interpretation (per Beverage, Radio World, June 2017).  FM/TV field-strength predictions under §73.333 are statistical and rest on three independent variability dimensions: (1) Time Variability — F(50,50) means 50% of the time, F(50,10) means 10% of the time (the more conservative interfering-signal curve); (2) Location Variability — F(50,50) means 50% of locations along the radial at the reference receiving height; raising either percentile (e.g. F(90,90)) reduces the predicted field and increases prediction reliability simultaneously; and (3) Situation Variability — system-to-system differences (antenna pattern realization, atmospheric ducting, urban multipath, big-rig reflections passing in real time, daily noise floor) that the static F(L,T) curve cannot model.  The contour distances reported below are the regulatory-line median; the listenable line for any specific listener depends on all three variabilities simultaneously.'
  );

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
