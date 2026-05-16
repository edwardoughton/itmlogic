// Engineering considerations — terrain-aware confidence narrative.
//
// Renders the per-exhibit aggregate engineering-confidence assessment
// produced by src/analysis/terrainConfidence/.  This is an ADVISORY
// section; it does not affect compliance disposition or the FCC curve
// math.  It exists so reviewers can see where curve predictions are
// likely to deviate from reality (terrain shadowing, diffraction, model
// limit) and where measured/predicted residuals are out of tolerance.

const PREFACE =
  'While FCC propagation curves provide the regulatory basis for contour determination, ' +
  'certain terrain conditions may result in deviations from predicted field strength.  ' +
  'The following per-radial assessment combines elevation-profile metrics with any attached ' +
  'SDR or ITM cross-check residuals.  This section is advisory and does not modify the ' +
  'FCC contour distances, §73.207 spacing, or §73.215 contour-protection results presented elsewhere.';

export function buildEngineeringConsiderationsSection(exhibit){
  const ec = exhibit?.engineering_confidence;
  if (!ec || typeof ec !== 'object') return null;

  const flagged = Array.isArray(ec.flagged_radials) ? ec.flagged_radials : [];
  const rows = flagged.map(r => ({
    azimuth_deg:        Number.isFinite(r.azimuth_deg) ? Number(r.azimuth_deg).toFixed(1) : '—',
    confidence:         r.confidence || '—',
    reasons:            Array.isArray(r.reasons) && r.reasons.length ? r.reasons.join(', ') : '—',
    obstruction_index:  Number.isFinite(r.obstruction_index) ? Number(r.obstruction_index).toFixed(2) : '—',
    roughness_score:    Number.isFinite(r.roughness_score)   ? Number(r.roughness_score).toFixed(2)   : '—',
    sdr_residual_db:    Number.isFinite(r.sdr_residual_db)   ? Number(r.sdr_residual_db).toFixed(1)   : '—',
    itm_delta_db:       Number.isFinite(r.itm_delta_db)      ? Number(r.itm_delta_db).toFixed(1)      : '—'
  }));

  // Summary key/value rows for context.
  const kvRows = [
    ['Engineering confidence',     ec.level || '—'],
    ['% radials HIGH',             pct(ec.percent_high)],
    ['% radials MEDIUM',           pct(ec.percent_medium)],
    ['% radials LOW',              pct(ec.percent_low)],
    ['RMS measured residual',      ec.rms_residual_db != null ? `${ec.rms_residual_db} dB` : 'n/a (no SDR residuals attached)'],
    ['Terrain severity score',     Number.isFinite(ec.terrain_severity_score) ? Number(ec.terrain_severity_score).toFixed(3) : '—']
  ];

  if (!rows.length){
    return {
      id:      'engineering-considerations',
      type:    'paragraphs-with-kv',
      heading: 'ENGINEERING CONSIDERATIONS',
      paragraphs: [
        PREFACE,
        ec.explanation || 'No radials were flagged for terrain-aware engineering review.'
      ],
      rows: kvRows
    };
  }

  return {
    id:      'engineering-considerations',
    type:    'considerations',
    heading: 'ENGINEERING CONSIDERATIONS',
    preface: PREFACE,
    summary: ec.explanation || '',
    kvRows,
    table: {
      columns: [
        { key: 'azimuth_deg',       label: 'Az (°)',       width: 0.08, align: 'right' },
        { key: 'confidence',        label: 'Confidence',   width: 0.12 },
        { key: 'reasons',           label: 'Reason codes', width: 0.30 },
        { key: 'obstruction_index', label: 'Obstr.',       width: 0.10, align: 'right' },
        { key: 'roughness_score',   label: 'Roughness',    width: 0.10, align: 'right' },
        { key: 'sdr_residual_db',   label: 'SDR Δ (dB)',   width: 0.10, align: 'right' },
        { key: 'itm_delta_db',      label: 'ITM Δ (dB)',   width: 0.10, align: 'right' }
      ],
      rows
    }
  };
}

function pct(v){
  return Number.isFinite(v) ? `${v}%` : '—';
}
