// SDR Observability — advisory per-capture surface for the engineering
// statement.  This is a sibling of `measurements.js` (raw SDR captures)
// and `engineeringInterpretation.js` (calibrated residual narrative);
// THIS section bridges the two:
//
//   * If the exhibit carries a calibrated residual table
//     (exhibit.evidence?.sdr_residuals or .sdr_calibration.residual_table
//     from src/evidence/sdrCalibration.js), each row gets "observed vs
//     predicted (dB)" + residual band ("within"/"moderate"/"significant").
//     The section header switches to OBSERVED VS PREDICTED to signal
//     that calibrated comparison data is present.
//
//   * Otherwise — captures are advisory only — the section emits a
//     plain advisory line: "Captures attached but no calibrated
//     residual model applied" with the audio links so a reviewer can
//     still audit on-air evidence.
//
// IMPORTANT: this section NEVER mutates the radial_table or
// contour_definitions.  Its presence or absence is observability-only
// noise to the engineering record.  See sdrObservability.test.js for
// the invariance proof.
//
// FUTURE-SUPPORT NOTES (no wiring here — see sdrEvidence.schema.js):
//   * KiwiSDR network feed:  receiver.kind="kiwisdr"; future drive-test
//     consumer would point audio_url at the public KiwiSDR session url.
//   * OpenWebRX (& OpenWebRX+):  receiver.kind="openwebrx".
//   * Drive-test uploads:  receiver.kind="drivetest"; operator-supplied
//     WAV + (optional) calibrated dBm channel.  When the calibrated
//     channel is present, sdrCalibration.js takes over and the residual
//     fields below become populated.
// END FUTURE-SUPPORT.

import { normalizeCapture, classifyResidualBand } from '../../../types/sdrEvidence.schema.js';

const ADVISORY_NOTICE =
  'Captures attached but no calibrated residual model applied. ' +
  'Rows are advisory observability only and do not modify FCC curve outputs.';

export function buildSdrObservabilitySection(exhibit){
  const m = exhibit?.evidence?.measurements;
  const records = Array.isArray(m?.records) ? m.records : [];
  if (!records.length) return null;
  // Don't fire if the parent block is explicitly opted out.
  if (m?.available === false) return null;

  // Locate residual rows, if any: prefer evidence.sdr_residuals
  // (post-calibration); fall back to evidence.sdr_calibration.rows.
  const residualRows = pickResidualRows(exhibit);
  const residualById = indexResiduals(residualRows);
  const hasAnyResidual = residualById.size > 0;

  const rows = records.map((raw) => {
    const cid = String(raw.id ?? raw.capture_id ?? raw.ztr_capture_id ?? '');
    const residual = residualById.get(cid) || null;
    const norm = normalizeCapture(raw, residual ? { residual } : null);

    // Build the table row.  Keep keys aligned with measurements.js so
    // the renderer can fall back to the same column widths.
    const base = {
      id:           norm.capture_id ?? '—',
      captured_at:  norm.timestamp_utc ? norm.timestamp_utc.replace('T', ' ').replace(/:\d\d\.\d{3}Z$/, 'Z') : '—',
      frequency:    norm.frequency ? `${norm.frequency.value} ${norm.frequency.unit}` : '—',
      mode:         norm.mode || '—',
      purpose:      norm.purpose || '—',
      status:       norm.status || '—',
      distance_km:  Number.isFinite(norm.distance_km) ? Number(norm.distance_km).toFixed(2) : '—',
      audio_url:    norm.audio_url || '—',
      badge:        residual && residual.calibrated ? 'CERTIFIED' : 'ADVISORY'
    };
    if ('residual_db_observed_vs_predicted' in norm){
      base.observed_vs_predicted_db = signedDb(norm.residual_db_observed_vs_predicted);
      base.residual_band            = norm.residual_band;
    } else {
      base.observed_vs_predicted_db = '—';
      base.residual_band            = '—';
    }
    return base;
  });

  const heading = hasAnyResidual
    ? 'SDR OBSERVABILITY — OBSERVED VS PREDICTED'
    : 'SDR OBSERVABILITY — ADVISORY';

  const paragraphs = [];
  if (hasAnyResidual){
    paragraphs.push(
      'The captures below carry calibrated field-strength measurements; ' +
      'each row reports the observed dBu against the model-predicted dBu ' +
      'at the receiver location, with the delta classified into within ' +
      '(<6 dB), moderate (6–10 dB), and significant (>10 dB) bands. ' +
      'Captures without a calibration chain remain advisory.'
    );
  } else {
    paragraphs.push(ADVISORY_NOTICE);
  }

  const columns = [
    { key: 'id',                       label: 'Capture #',         width: 0.08 },
    { key: 'captured_at',              label: 'Captured (UTC)',    width: 0.16 },
    { key: 'frequency',                label: 'Freq',              width: 0.09, align: 'right' },
    { key: 'mode',                     label: 'Mode',              width: 0.06 },
    { key: 'purpose',                  label: 'Purpose',           width: 0.12 },
    { key: 'status',                   label: 'Status',            width: 0.08 },
    { key: 'distance_km',              label: 'Dist (km)',         width: 0.07, align: 'right' },
    { key: 'observed_vs_predicted_db', label: 'Obs−Pred (dB)',     width: 0.10, align: 'right' },
    { key: 'residual_band',            label: 'Band',              width: 0.08 },
    { key: 'badge',                    label: 'Status',            width: 0.08 },
    { key: 'audio_url',                label: 'Audio',             width: 0.08 }
  ];

  return {
    id:      'sdr-observability',
    type:    'table',
    heading,
    paragraphs,
    advisory: !hasAnyResidual,
    footnote: hasAnyResidual
      ? 'Calibrated residuals supplied by src/evidence/sdrCalibration.js (advisory unless tied to a certified field-strength measurement program; see §73.314 / §73.186 + OET-69).'
      : 'Audio captures only; no field-strength calibration chain attached. See src/evidence/sdrCalibration.js for promotion to residual evidence.',
    table: { columns, rows }
  };
}

// ─────────── helpers ───────────

function pickResidualRows(exhibit){
  if (!exhibit || typeof exhibit !== 'object') return [];
  // Several plausible locations — accept any.
  const candidates = [
    exhibit?.evidence?.sdr_residuals,
    exhibit?.evidence?.sdr_residuals?.rows,
    exhibit?.evidence?.sdr_calibration?.rows,
    exhibit?.evidence?.sdr_calibration?.residual_table,
    exhibit?.sdr_residuals,
    exhibit?.sdr_residuals?.rows
  ];
  for (const c of candidates){
    if (Array.isArray(c) && c.length) return c;
  }
  return [];
}

function indexResiduals(rows){
  const map = new Map();
  for (const r of rows){
    if (!r) continue;
    const id = String(r.capture_id ?? r.id ?? '');
    if (!id) continue;
    const delta = Number(r.delta_db ?? r.residual_db ?? r.delta_dB);
    if (!Number.isFinite(delta)) continue;
    map.set(id, {
      delta_db:    Number(delta.toFixed(2)),
      band:        classifyResidualBand(delta),
      calibrated:  !!r.calibration_applied || !!r.calibrated
    });
  }
  return map;
}

function signedDb(v){
  if (!Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + Number(v).toFixed(1);
}
