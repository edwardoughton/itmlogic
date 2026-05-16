// Assumptions section.
//
// Consolidates every assumption the engine makes that a PE / FCC counsel
// would need to confirm before signing.  H&D, Cavell-Mertz, and du Treil
// exhibits all have an Assumptions block — it's where the engineer states
// "these are the conditions under which the predictions hold."  Without
// it the report reads like a bag of numbers.
//
// Pulls from exhibit metadata wherever possible so the assumptions track
// the actual compute (no hard-coded "we assumed X" if the engine ran with
// Y).  Fall-back boilerplate is conservative consulting language, not
// marketing.

export function buildAssumptionsSection(exhibit){
  const s   = exhibit?.station_inputs       || {};
  const m   = exhibit?.calculation_method   || {};
  const ip  = exhibit?.interpolation        || {};
  const t   = exhibit?.evidence?.terrain    || {};
  const pop = exhibit?.population_estimate  || {};
  const rc  = exhibit?.regulatory_compliance|| {};

  const datum = (s.datum || 'NAD83').toUpperCase();
  const propMethod = m.name || '47 CFR §73.333 F(50,50)';
  const interpField = ip.along_field || 'logarithmic';
  const interpHaat  = ip.along_haat  || 'linear';
  const radialStep  = s.radial_step_deg || 10;
  const groundCondit = (s.service === 'AM' || s.service === 'AX')
    ? `${s.ground_sigma_mS_m ?? '—'} mS/m (per §73.183 conductivity map)`
    : 'not applicable for FM/TV (sky/space-wave service)';
  const terrainAssumption = t.available
    ? `Per-radial HAAT computed from ${t.dem?.source || 'DEM'} ${t.dem?.dataset || ''} via ${t.method || 'fcc-hd-radials'}, sampled along ${(t.profiles || []).length || 8} radials.`
    : 'Constant HAAT used as filed; no per-radial DEM sampling performed (CONSTANT_HAAT_ASSUMED warning attached).  Filing engineer must confirm the filed HAAT was derived per §73.313.';
  const popAssumption = pop?.source
    ? `Population estimate sourced from ${pop.source} (${pop.dataset || 'dataset unspecified'}, vintage ${pop.vintage || '—'}); contour-weighting via ${pop.method || 'centroid-in-polygon'}.  Provided for context only — §73.x compliance is determined by distance and field-strength tests, not population.`
    : 'Population estimate not attached; if required for the filing, the licensee must request a Census-block computation prior to upload.';

  const items = [
    `Coordinate datum is ${datum} decimal degrees.  All spacing distances are great-circle per §73.208 using the Karney 2013 WGS-84 geodesic.`,
    `Field-strength predictions follow ${propMethod}.  Contours are computed by curve-table inversion (${interpField} along field, ${interpHaat} along HAAT) at ${radialStep}° radial steps.`,
    `Antenna pattern: ${Array.isArray(s.pattern) ? `directional, ${s.pattern.length}-row table as filed; pattern factor f(az) applied multiplicatively per §73.316.` : 'omnidirectional unless an azimuth-relative-field table is supplied.'}`,
    `Effective radiated power assumes the filed value (ERP-H = ${s.erp_kw ?? '—'} kW${s.erp_v_kw != null ? `, ERP-V = ${s.erp_v_kw} kW` : ''}); no allowance is made for matching network or feedline loss beyond what is reflected in the filed ERP.`,
    `Ground conductivity: ${groundCondit}`,
    terrainAssumption,
    popAssumption,
    `§73.207 minimum-distance separations were ${rc?.section_73_207?.evaluated ? 'evaluated against the supplied list of nearby co-/adjacent-channel facilities' : 'not evaluated for this report (no nearby_primaries attached)'}.${rc?.section_73_207?.pass === false && rc?.pass === true ? '  Where §73.207 short-spacings exist, the application qualifies via §73.215 contour-protection per the Spacing Analysis exhibit.' : ''}`,
    'No structural, electrical-installation, or RF-shock hazard analysis is performed; tower / FAA / Part 17 / OET-65 near-field determinations remain the responsibility of the engineer of record and tower owner.',
    'This study assumes the propagation environment is free of intervening major obstructions beyond what is reflected in the DEM.  Buildings, vegetation, and short-term meteorological effects are not modeled.'
  ];

  return {
    id:      'assumptions',
    type:    'paragraphs',
    heading: 'Assumptions',
    paragraphs: items
  };
}
