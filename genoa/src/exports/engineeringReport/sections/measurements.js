// Measurements — surface raw SDR captures attached to the exhibit.
//
// Reads exhibit.evidence.measurements.records.  Renders a per-capture
// row table with the audio-artifact URL so reviewers can play the
// off-air recording directly from the engineering statement's
// supporting evidence (filing platforms increasingly accept supporting
// audio links).
//
// This is distinct from Engineering Interpretation (sibling section,
// driven by exhibit.residual_interpretation).  The interpretation
// section only fires when the captures carry calibrated field-strength
// data so a predicted-vs-measured residual can be computed.  For audio
// captures that lack lat/lon + calibrated dBu (e.g. ZTR's
// manual_check / eas_validation flavors), the interpretation section
// emits its "no residuals attached" disclaimer — but the captures
// themselves are real evidence and belong on the exhibit.  THIS
// section gives them a home.

export function buildMeasurementsSection(exhibit){
  const m = exhibit?.evidence?.measurements;
  if (!m || m.available === false) return null;
  const records = Array.isArray(m.records) ? m.records : [];
  if (!records.length) return null;

  const rows = records.map((r) => {
    const id          = r?.id ?? r?.capture_id ?? r?.ztr_capture_id ?? null;
    const capturedAt  = r?.start_time || r?.captured_at || r?.created_at || r?.updated_at || null;
    const freqKhz     = num(r?.frequency_khz);
    const mode        = r?.mode || r?.service_type || null;
    const purpose     = r?.capture_purpose || null;
    const status      = r?.status || r?.latest_session_status || null;
    const confidence  = formatConfidence(r);
    const audio       = r?.audio_url
                     || r?.audio_proxy
                     || (id != null ? `/api/captures/${id}/audio` : null);
    return {
      id:           id != null ? String(id) : '—',
      captured_at:  capturedAt ? formatTimestamp(capturedAt) : '—',
      frequency:    Number.isFinite(freqKhz) ? `${freqKhz} kHz` : '—',
      mode:         mode ? String(mode).toUpperCase() : '—',
      purpose:      purpose || '—',
      status:       status || '—',
      confidence,
      audio_url:    audio || '—'
    };
  });

  // Provenance footnote — names the source + lookup strategy so
  // reviewers can trace where the captures came from.
  const sourceNote = [
    m.source        ? `source: ${m.source}`           : null,
    m.captures_field ? `field: ${m.captures_field}`   : null,
    m.lookup_strategy ? `strategy: ${m.lookup_strategy}` : null,
    Number.isFinite(m.n_records) ? `${m.n_records} record${m.n_records === 1 ? '' : 's'}` : null,
    m.calibrated === false ? 'uncalibrated (audio-only)' : (m.calibrated === true ? 'calibrated' : null)
  ].filter(Boolean).join('  ·  ');

  return {
    id:      'measurements',
    type:    'table',
    heading: 'MEASUREMENTS — SDR CAPTURES',
    paragraphs: [
      'Per-capture audio + signal-measurement records attached to this exhibit ' +
      'as supporting evidence.  Each row links to the audio artifact (WAV, served ' +
      'by the SDR sidecar proxy) so a reviewer can audition the off-air capture ' +
      'directly.  This section is advisory only; FCC §73.x compliance is determined ' +
      'by distance and field-strength tests reported elsewhere.'
    ],
    footnote: sourceNote || null,
    table: {
      columns: [
        { key: 'id',          label: 'Capture #',  width: 0.10 },
        { key: 'captured_at', label: 'Captured',   width: 0.18 },
        { key: 'frequency',   label: 'Freq',       width: 0.10, align: 'right' },
        { key: 'mode',        label: 'Mode',       width: 0.07 },
        { key: 'purpose',     label: 'Purpose',    width: 0.15 },
        { key: 'status',      label: 'Status',     width: 0.10 },
        { key: 'confidence',  label: 'Confidence', width: 0.10 },
        { key: 'audio_url',   label: 'Audio',      width: 0.20 }
      ],
      rows
    }
  };
}

// ─────────── helpers ───────────

function num(v){
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatTimestamp(iso){
  // Accept Date | ISO string | numeric epoch.  Keep tz aware so a UTC
  // capture doesn't drift into local-time on render.
  try {
    const d = (iso instanceof Date) ? iso : new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    // YYYY-MM-DD HH:mm Z — short, unambiguous, sortable.
    return d.toISOString().replace('T', ' ').replace(/:\d\d\.\d{3}Z$/, 'Z');
  } catch {
    return String(iso);
  }
}

function formatConfidence(r){
  const band  = r?.confidence_band || r?.verdict?.confidence_band || null;
  const score = num(r?.confidence_score ?? r?.verdict?.confidence_score);
  if (!band && score == null) return '—';
  if (band && score != null) return `${band} (${score})`;
  return String(band || score);
}
