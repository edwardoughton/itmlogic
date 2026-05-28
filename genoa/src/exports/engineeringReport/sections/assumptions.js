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

  // Service vocabulary divides everything below.  AM exhibits MUST NOT
  // mention HAAT, ERP, or §73.313 — those are FM/TV concepts under
  // §73.316 / §73.333.  AM uses TPO, RMS field at 1 km, and ground
  // conductivity σ under §73.183 / §73.184.  Leaking the FM vocabulary
  // into an AM exhibit reads as FM-engine architecture poking through.
  const svc  = String(s.service || '').toUpperCase();
  const isAm = svc === 'AM' || svc === 'AX';

  const datum = (s.datum || 'NAD83').toUpperCase();
  const propMethod = m.name || (isAm
    ? '47 CFR §73.184 groundwave field-strength curves'
    : '47 CFR §73.333 F(50,50)');
  const radialStep  = s.radial_step_deg || 10;

  // Coordinate / propagation method line — service-specific second sentence.
  const coordLine = `Coordinate datum is ${datum} decimal degrees.  All spacing distances are great-circle per §73.208 using the Karney 2013 WGS-84 geodesic.`;
  const propLine  = isAm
    ? `Field-strength predictions follow ${propMethod}.  Contour distances are computed by §73.184 grid inversion (bivariate σ × distance interpolation per Figure M3) at ${radialStep}° radial steps.`
    : (function(){
        const interpField = ip.along_field || 'logarithmic';
        const interpHaat  = ip.along_haat  || 'linear';
        return `Field-strength predictions follow ${propMethod}.  Contours are computed by curve-table inversion (${interpField} along field, ${interpHaat} along HAAT) at ${radialStep}° radial steps.`;
      })();

  // Antenna pattern line — same shape but cite the right regulation.
  const patternLine = isAm
    ? `Antenna mode: ${Array.isArray(s.pattern) ? `DA, ${s.pattern.length}-row pattern_table as filed; pattern factor f(az) applied per §73.150.` : 'NDA (non-directional) unless an azimuth-relative-field table is supplied.'}`
    : `Antenna pattern: ${Array.isArray(s.pattern) ? `directional, ${s.pattern.length}-row table as filed; pattern factor f(az) applied multiplicatively per §73.316.` : 'omnidirectional unless an azimuth-relative-field table is supplied.'}`;

  // Power line — AM is TPO + RMS field, FM/TV is ERP-H / ERP-V.
  const powerLine = isAm
    ? `Transmitter power output (TPO): ${s.erp_kw ?? '—'} kW.${Number.isFinite(Number(s.rms_field_1km)) ? `  Inverse-distance RMS field at 1 km (filed / licensed): ${Number(s.rms_field_1km)} mV/m.` : ''}  Field at 1 km derived from TPO + pattern per §73.183 unless a filed value is supplied; no allowance is made for matching network or feedline loss beyond what is reflected in the filed power.`
    : `Effective radiated power assumes the filed value (ERP-H = ${s.erp_kw ?? '—'} kW${s.erp_v_kw != null ? `, ERP-V = ${s.erp_v_kw} kW` : ''}); no allowance is made for matching network or feedline loss beyond what is reflected in the filed ERP.`;

  // Ground / terrain line — AM stops at conductivity σ; FM/TV goes to HAAT.
  const groundLine = isAm
    ? (function(){
        const gcr = exhibit?.evidence?.ground_conductivity_per_radial;
        const head = `Ground conductivity: ${s.ground_sigma_mS_m ?? '—'} mS/m (per §73.190 Figure M3 reference grid).`;
        const seg  = gcr?.available
          ? `  Per-radial M3 segmentation applied on ${gcr.radials_segmented ?? '—'} of ${gcr.radials_total ?? '—'} azimuths (${gcr.method || 'path-length weighted, stage-2'}; Millington integration pending stage-3).`
          : `  Per-radial M3 segmentation NOT applied (${gcr?.reason || 'no boundary crossings within the §73.184 range, or geodata sidecar unavailable'}); engine ran with uniform σ across all azimuths.`;
        return head + seg + '  No terrain elevation model is required for §73.184 groundwave — HAAT and §73.313 do not apply to AM.';
      })()
    : `Ground conductivity: not applicable for FM/TV (space-wave service).  ${t.available
        ? `Per-radial HAAT computed from ${t.dem?.source || 'DEM'} ${t.dem?.dataset || ''} via ${t.method || 'fcc-hd-radials'}, sampled along ${(t.profiles || []).length || 8} radials.`
        : 'Constant HAAT used as filed; no per-radial DEM sampling performed (CONSTANT_HAAT_ASSUMED warning attached).  Filing engineer must confirm the filed HAAT was derived per §73.313.'}`;

  const popAssumption = pop?.source
    ? `Population estimate sourced from ${pop.source} (${pop.dataset || 'dataset unspecified'}, vintage ${pop.vintage || '—'}); contour-weighting via ${pop.method || 'centroid-in-polygon'}.  Provided for context only — Part 73 compliance is determined by distance and field-strength tests (§73.207 / §73.215 / §73.333 for FM; §73.182 / §73.184 / §73.185 / §73.190 for AM), not population.`
    : 'Population estimate not attached; if required for the filing, the licensee must request a Census-block computation prior to upload.';

  // Spacing rule citation — §73.207 is FM-only; §73.37 is AM equivalent.
  const spacingRule = isAm ? '§73.37 / §73.182' : '§73.207';
  const spacingLine = `${spacingRule} minimum-distance separations were ${rc?.section_73_207?.evaluated ? 'evaluated against the supplied list of nearby co-/adjacent-channel facilities' : 'not evaluated for this report (no nearby facility list attached)'}.${rc?.section_73_207?.pass === false && rc?.pass === true && !isAm ? '  Where §73.207 short-spacings exist, the application qualifies via §73.215 contour-protection per the Spacing Analysis exhibit.' : ''}`;

  const items = [
    coordLine,
    propLine,
    patternLine,
    powerLine,
    groundLine,
    popAssumption,
    spacingLine,
    'No structural, electrical-installation, or RF-shock hazard analysis is performed; tower / FAA / Part 17 / OET-65 near-field determinations remain the responsibility of the engineer of record and tower owner.',
    isAm
      ? 'AM groundwave under §73.184 is conductivity-driven; intervening obstructions, vegetation, and short-term meteorological effects are not modeled and do not enter the §73.184 grid.'
      : 'This study assumes the propagation environment is free of intervening major obstructions beyond what is reflected in the DEM.  Buildings, vegetation, and short-term meteorological effects are not modeled.'
  ];

  return {
    id:      'assumptions',
    type:    'paragraphs',
    heading: 'Assumptions',
    paragraphs: items
  };
}
