// Aggregate engineering confidence — rolls per-radial confidences into a
// single exhibit-level summary suitable for the engineering report.
//
// Inputs:
//   per_radial — array of objects produced by radialConfidence().
//
// Outputs:
//   {
//     level:                  'HIGH' | 'MODERATE' | 'LOW',
//     percent_high:           number (0..100),
//     percent_low:            number (0..100),
//     percent_medium:         number (0..100),
//     n_radials:              integer,
//     rms_residual_db:        number | null,
//     terrain_severity_score: number   (0..~2; mean roughness + 2× mean obstruction)
//     reason_counts:          { terrain_shadowing, diffraction_possible, ... },
//     flagged_radials:        per-radial subset where confidence != 'HIGH',
//     explanation:            human-readable narrative paragraph
//   }
//
// Aggregate level rules:
//   LOW       — >=20% of radials are LOW   OR rms_residual_db > 10 dB
//   MODERATE  — >=20% of radials are MEDIUM/LOW combined OR rms 6..10
//   HIGH      — otherwise (default).

const LOW_FRACTION_GATE       = 0.20;
const NONHIGH_FRACTION_GATE   = 0.20;
const RMS_LOW_GATE_DB         = 10;
const RMS_MODERATE_GATE_DB    = 6;

export function aggregateEngineeringConfidence(per_radial){
  const list = Array.isArray(per_radial) ? per_radial : [];
  const n    = list.length;

  // Counts
  let nHigh = 0, nMed = 0, nLow = 0;
  const reasons = {};
  let sumObstr = 0, nObstr = 0, sumRough = 0, nRough = 0;
  let sqSum = 0, sqN = 0;
  for (const r of list){
    if (r.confidence === 'HIGH')   nHigh++;
    else if (r.confidence === 'MEDIUM') nMed++;
    else if (r.confidence === 'LOW')    nLow++;
    for (const rc of (r.reasons || [])){
      reasons[rc] = (reasons[rc] || 0) + 1;
    }
    const obstr = r.inputs?.obstruction_index;
    const rough = r.inputs?.roughness_score;
    if (Number.isFinite(obstr)){ sumObstr += obstr; nObstr++; }
    if (Number.isFinite(rough)){ sumRough += rough; nRough++; }
    const res = r.inputs?.sdr_residual_db;
    if (Number.isFinite(res)){ sqSum += res * res; sqN++; }
  }

  const percent_high   = pct(nHigh, n);
  const percent_medium = pct(nMed,  n);
  const percent_low    = pct(nLow,  n);
  const rms_residual_db = sqN ? Number(Math.sqrt(sqSum / sqN).toFixed(2)) : null;
  const meanObstr  = nObstr ? sumObstr / nObstr : 0;
  const meanRough  = nRough ? sumRough / nRough : 0;
  const terrain_severity_score = round3(meanRough + 2 * meanObstr);

  const lowFraction    = n ? nLow / n : 0;
  const nonHighFraction = n ? (nLow + nMed) / n : 0;
  let level;
  if (lowFraction >= LOW_FRACTION_GATE
      || (rms_residual_db != null && rms_residual_db > RMS_LOW_GATE_DB)){
    level = 'LOW';
  } else if (nonHighFraction >= NONHIGH_FRACTION_GATE
             || (rms_residual_db != null && rms_residual_db > RMS_MODERATE_GATE_DB)){
    level = 'MODERATE';
  } else {
    level = 'HIGH';
  }

  const flagged_radials = list.filter(r => r.confidence !== 'HIGH').map(r => ({
    azimuth_deg:        r.azimuth_deg,
    confidence:         r.confidence,
    reasons:            r.reasons,
    obstruction_index:  r.inputs?.obstruction_index ?? null,
    roughness_score:    r.inputs?.roughness_score   ?? null,
    sdr_residual_db:    r.inputs?.sdr_residual_db   ?? null,
    itm_delta_db:       r.inputs?.itm_delta_db      ?? null
  }));

  const explanation = composeExplanation({
    level, n, percent_high, percent_low, rms_residual_db,
    terrain_severity_score, reasons
  });

  return {
    level,
    percent_high,
    percent_medium,
    percent_low,
    n_radials:               n,
    rms_residual_db,
    terrain_severity_score,
    reason_counts:           reasons,
    flagged_radials,
    explanation
  };
}

function composeExplanation({ level, n, percent_high, percent_low, rms_residual_db, terrain_severity_score, reasons }){
  if (n === 0){
    return 'No radials were available for terrain-aware confidence analysis; ' +
           'engineering confidence cannot be computed for this exhibit.';
  }
  const parts = [];
  parts.push(`Engineering confidence: ${level}.`);
  parts.push(`${percent_high}% of radials assessed HIGH, ${percent_low}% LOW.`);
  if (rms_residual_db != null){
    parts.push(`Measured-vs-predicted RMS residual ${rms_residual_db} dB.`);
  } else {
    parts.push('No SDR residual was attached; assessment is terrain-only.');
  }
  parts.push(`Terrain severity score ${terrain_severity_score}.`);
  if (reasons.terrain_shadowing){
    parts.push(`${reasons.terrain_shadowing} radial(s) flagged for likely terrain shadowing.`);
  }
  if (reasons.diffraction_possible){
    parts.push(`${reasons.diffraction_possible} radial(s) flagged for possible diffraction loss.`);
  }
  if (reasons.measurement_variance){
    parts.push(`${reasons.measurement_variance} radial(s) flagged for measurement variance.`);
  }
  if (reasons.model_limit){
    parts.push(`${reasons.model_limit} radial(s) flagged at the model-limit boundary (ITM Δ exceeds tolerance).`);
  }
  parts.push('This assessment is advisory: it does NOT modify the FCC curve outputs ' +
             'and does NOT affect §73.207 / §73.215 compliance results.');
  return parts.join('  ');
}

function pct(num, den){ return den ? Math.round(1000 * num / den) / 10 : 0; }
function round3(x){ return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : 0; }
