// Engineering interpretation — narrative summary of SDR residuals.
//
// Reads exhibit.residual_interpretation (produced by
// src/analysis/residualInterpretation/).  Renders a section that places
// the engineering narrative in front of summary statistics and a
// worst-case row.  Advisory only; does not modify FCC curve outputs.

export function buildEngineeringInterpretationSection(exhibit){
  const ri = exhibit?.residual_interpretation;
  if (!ri) return null;

  const heading = 'ENGINEERING INTERPRETATION';
  const narrative = ri.engineering_interpretation_text || '';

  if (ri.available === false || !ri.n_samples){
    return {
      id:      'engineering-interpretation',
      type:    'paragraphs',
      heading,
      paragraphs: [narrative]
    };
  }

  const rows = [
    ['Samples',                  String(ri.n_samples)],
    ['RMS residual',             ri.rms_db != null ? `${ri.rms_db} dB` : '—'],
    ['Mean residual',            ri.mean_db != null ? `${ri.mean_db} dB` : '—'],
    ['% within (<6 dB)',         pct(ri.percent_within)],
    ['% moderate (6–10 dB)',     pct(ri.percent_moderate)],
    ['% significant (>10 dB)',   pct(ri.percent_significant)],
    [
      'Worst-case radial',
      ri.worst_case
        ? `${signedDeg(ri.worst_case.azimuth_deg)}: ${signedDb(ri.worst_case.residual_db)} dB (${humanClass(ri.worst_case.classification)})`
        : '—'
    ],
    [
      'Dominant direction',
      ri.dominant_direction
        ? `${ri.dominant_direction.compass} (${ri.dominant_direction.bearing_deg.toFixed(1)}°, top ${ri.dominant_direction.n_samples} radials)`
        : '—'
    ]
  ];

  return {
    id:      'engineering-interpretation',
    type:    'paragraphs-with-kv',
    heading,
    paragraphs: [narrative],
    rows
  };
}

function pct(v){ return Number.isFinite(v) ? `${v}%` : '—'; }

function signedDeg(v){
  return Number.isFinite(v) ? `${Number(v).toFixed(1)}°` : '—';
}

function signedDb(v){
  if (!Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + Number(v).toFixed(1);
}

function humanClass(c){
  if (c === 'SIGNIFICANT_DEVIATION') return 'significant';
  if (c === 'MODERATE_DEVIATION')    return 'moderate';
  if (c === 'WITHIN_EXPECTATION')    return 'within expectation';
  return 'unknown';
}
