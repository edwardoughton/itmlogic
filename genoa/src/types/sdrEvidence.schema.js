// SDR observability evidence — schema + normalizer.
//
// This schema describes a SINGLE SDR capture row that may be attached to
// an exhibit as advisory observability evidence.  It is intentionally
// distinct from the calibrated residual-table machinery in
// src/evidence/sdrCalibration.js (which promotes captures into
// filing-grade residual analysis when a full calibration chain + a
// curve-engine prediction are both available).
//
// SCOPE
//   Captures arrive from a variety of sources: ZerotrustRadio (ZTR)
//   off-air recordings tied to a callsign, manual SDR uploads, EAS-
//   validation grabs, etc.  Most of these are AUDIO-ONLY: they prove
//   the station was on-air and what the off-air signal sounded like at
//   the receiver, but they lack the calibration chain needed to make
//   a regulator-grade field-strength claim.  Those captures still
//   belong on the exhibit as supporting evidence — they are real,
//   timestamped, geo-tagged observations — and this schema gives them
//   a stable advisory shape.
//
// FIELDS
//   capture_id                   stable identifier (provider's id, ZTR
//                                capture id, or any unique key)
//   receiver                     { name, host?, lat?, lon?, kind? }
//                                where kind in {"kiwisdr","openwebrx",
//                                "drivetest","ztr","unknown"}
//   timestamp_utc                ISO-8601 UTC string
//   frequency                    { value: number, unit: "kHz"|"MHz" }
//   mode                         "AM" | "FM" | "FX" | "LPFM" | ...
//                                (uppercased canonical form)
//   purpose                      free-form ("manual_check",
//                                "eas_validation", "drive_test", ...)
//   status                       provider's status string
//                                ("succeeded", "failed", ...)
//   audio_available              bool — true if an audio artifact exists
//   audio_url                    canonical URL to the audio artifact
//                                (defaults to /api/captures/<id>/audio)
//   confidence                   { band?: string, score?: number }
//   distance_km                  great-circle from tx to receiver
//                                (when both lat/lon known)
//   advisory                     ALWAYS true for rows in this schema —
//                                use the residual table in
//                                sdrCalibration.js for filing-grade rows
//   residual_db_observed_vs_predicted
//                                OPTIONAL.  Only populated when the
//                                capture carries calibrated field
//                                strength AND a model prediction was
//                                computable at the receiver point.
//   residual_band                OPTIONAL.  "within" (<6 dB) /
//                                "moderate" (6-10 dB) /
//                                "significant" (>10 dB) — only set
//                                when residual_db_observed_vs_predicted
//                                is finite.
//
// FUTURE SUPPORT (advisory, not wired)
//   * KiwiSDR network: when a KiwiSDR audio + signal-meter feed is
//     wired in, populate receiver.kind="kiwisdr" and receiver.host with
//     the public KiwiSDR hostname so a reviewer can replay live.
//   * OpenWebRX (and OpenWebRX+): same shape — receiver.kind="openwebrx".
//   * Drive-test uploads (user-supplied WAV + GPS track): kind="drivetest",
//     audio_url pointing at the operator-uploaded artifact.  When the
//     drive-test includes a calibrated signal-strength channel, the
//     calibration block lets sdrCalibration.js compute residuals.
//
// NO ENGINE-CONTROLLING MATH HAPPENS HERE.
//   Rows produced from this schema NEVER mutate radial_table or
//   contour_definitions.  They are pure observability evidence with
//   advisory:true.

export const SDR_EVIDENCE_SCHEMA_NAME    = 'genoa.sdrEvidence.v1';
export const SDR_EVIDENCE_SCHEMA_VERSION = 1;

// Residual bands (dB).  Match the engineering-interpretation bands
// used elsewhere for consistency.
export const RESIDUAL_BAND_THRESHOLDS = Object.freeze({
  WITHIN_MAX_DB:      6,    // |delta| < 6 dB  → "within"
  MODERATE_MAX_DB:    10    // 6 ≤ |delta| ≤ 10 dB → "moderate"; >10 → "significant"
});

/**
 * Classify a residual (observed - predicted, in dB) into one of the
 * three engineering bands.  Returns null when delta is not finite.
 */
export function classifyResidualBand(delta_db){
  const d = Number(delta_db);
  if (!Number.isFinite(d)) return null;
  const abs = Math.abs(d);
  if (abs < RESIDUAL_BAND_THRESHOLDS.WITHIN_MAX_DB)   return 'within';
  if (abs <= RESIDUAL_BAND_THRESHOLDS.MODERATE_MAX_DB) return 'moderate';
  return 'significant';
}

/**
 * Normalize a raw capture record (from ZTR / KiwiSDR / OpenWebRX /
 * drive-test upload) into the canonical sdrEvidence row shape.
 *
 * Defensive across naming variants — accepts id / capture_id /
 * ztr_capture_id, frequency_khz / frequency_mhz / frequency,
 * created_at / captured_at / start_time / updated_at, etc.  Never
 * throws on missing fields; returns a row with `audio_available:false`
 * and the missing fields left as null when they can't be resolved.
 *
 * @param {object} raw           the raw capture record
 * @param {object} [opts]
 * @param {object} [opts.residual]   optional residual analysis result:
 *                                   { delta_db, predicted_dBu?, measured_dBu? }
 * @returns {object} canonical row
 */
export function normalizeCapture(raw, opts){
  if (!raw || typeof raw !== 'object'){
    return emptyRow();
  }
  const o = opts || {};
  const id = raw.id ?? raw.capture_id ?? raw.ztr_capture_id ?? null;
  const audio_url = raw.audio_url
                 ?? raw.audio_proxy
                 ?? (id != null ? `/api/captures/${id}/audio` : null);
  const audio_available = !!audio_url
                       && raw.audio_available !== false
                       && raw.status !== 'failed';

  const freq = extractFrequency(raw);
  const receiver = extractReceiver(raw);
  const distance_km = numOrNull(raw.distance_km ?? raw.range_km);

  // Residual fields only populated when BOTH calibrated measurement
  // AND model prediction were available upstream.  The caller is the
  // arbiter — this normalizer simply surfaces what was passed.
  let residual_db = null;
  let residual_band = null;
  if (o.residual && Number.isFinite(Number(o.residual.delta_db))){
    residual_db = Number(Number(o.residual.delta_db).toFixed(2));
    residual_band = classifyResidualBand(residual_db);
  }

  const row = {
    capture_id:        id != null ? String(id) : null,
    receiver,
    timestamp_utc:     normalizeTimestamp(
                         raw.timestamp_utc
                         ?? raw.start_time
                         ?? raw.captured_at
                         ?? raw.created_at
                         ?? raw.updated_at
                         ?? null),
    frequency:         freq,
    mode:              normalizeMode(raw.mode ?? raw.service_type ?? null),
    purpose:           raw.capture_purpose ?? raw.purpose ?? null,
    status:            raw.status ?? raw.latest_session_status ?? null,
    audio_available,
    audio_url:         audio_url ?? null,
    confidence:        extractConfidence(raw),
    distance_km,
    advisory:          true
  };

  if (residual_db !== null){
    row.residual_db_observed_vs_predicted = residual_db;
    row.residual_band = residual_band;
  }
  return row;
}

/**
 * Validate a row against the sdrEvidence v1 shape.  Returns
 * { valid:boolean, errors:string[] }.  Cheap structural check — no
 * domain logic.
 */
export function validateCaptureRow(row){
  const errors = [];
  if (!row || typeof row !== 'object'){
    return { valid: false, errors: ['row is not an object'] };
  }
  if (row.capture_id !== null && typeof row.capture_id !== 'string'){
    errors.push('capture_id must be string or null');
  }
  if (!row.receiver || typeof row.receiver !== 'object'){
    errors.push('receiver block missing');
  }
  if (row.timestamp_utc !== null && typeof row.timestamp_utc !== 'string'){
    errors.push('timestamp_utc must be ISO string or null');
  }
  if (row.frequency !== null
      && (typeof row.frequency !== 'object'
          || !['kHz','MHz'].includes(row.frequency?.unit))){
    errors.push('frequency must be {value, unit:"kHz"|"MHz"} or null');
  }
  if (row.advisory !== true){
    errors.push('advisory must be true for rows in sdrEvidence schema');
  }
  if ('residual_db_observed_vs_predicted' in row
      && !Number.isFinite(row.residual_db_observed_vs_predicted)){
    errors.push('residual_db_observed_vs_predicted, when present, must be finite');
  }
  if ('residual_band' in row
      && !['within','moderate','significant'].includes(row.residual_band)){
    errors.push('residual_band, when present, must be within|moderate|significant');
  }
  // Residual fields go together.
  const hasDb   = 'residual_db_observed_vs_predicted' in row;
  const hasBand = 'residual_band' in row;
  if (hasDb !== hasBand){
    errors.push('residual_db_observed_vs_predicted and residual_band must be set together');
  }
  return { valid: errors.length === 0, errors };
}

// ─────────────── helpers ───────────────

function emptyRow(){
  return {
    capture_id:       null,
    receiver:         { name: null, host: null, lat: null, lon: null, kind: 'unknown' },
    timestamp_utc:    null,
    frequency:        null,
    mode:             null,
    purpose:          null,
    status:           null,
    audio_available:  false,
    audio_url:        null,
    confidence:       { band: null, score: null },
    distance_km:      null,
    advisory:         true
  };
}

function numOrNull(v){
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function extractFrequency(raw){
  const khz = numOrNull(raw.frequency_khz);
  if (khz !== null) return { value: khz, unit: 'kHz' };
  const mhz = numOrNull(raw.frequency_mhz);
  if (mhz !== null) return { value: mhz, unit: 'MHz' };
  const generic = numOrNull(raw.frequency);
  if (generic !== null){
    // Best-effort: AM/MW captures (<= 30 MHz) report in kHz, FM in MHz.
    return generic > 1000
      ? { value: generic, unit: 'kHz' }
      : { value: generic, unit: 'MHz' };
  }
  return null;
}

function extractReceiver(raw){
  // The receiver block is best-effort: many ZTR records don't carry
  // station coords, in which case lat/lon stay null and consumers
  // can't compute distance.  kind defaults to "unknown" so the UI
  // can still render an ADVISORY badge meaningfully.
  const r = raw.receiver || raw._receiver || raw.station || {};
  const lat = numOrNull(r.lat ?? r.latitude ?? raw.receiver_lat ?? raw.station_lat);
  const lon = numOrNull(r.lon ?? r.longitude ?? raw.receiver_lon ?? raw.station_lon);
  const host = r.host ?? r.hostname ?? raw.receiver_host ?? null;
  const name = r.name ?? r.label ?? raw.station_callsign ?? raw.receiver_name ?? null;
  const kindRaw = String(r.kind ?? raw.receiver_kind ?? raw.source ?? '').toLowerCase();
  const kind = ['kiwisdr','openwebrx','drivetest','ztr'].includes(kindRaw)
               ? kindRaw
               : (kindRaw === 'zerotrustradio' ? 'ztr' : 'unknown');
  return { name: name ?? null, host: host ?? null, lat, lon, kind };
}

function extractConfidence(raw){
  const band  = raw.confidence_band ?? raw.verdict?.confidence_band ?? null;
  const score = numOrNull(raw.confidence_score ?? raw.verdict?.confidence_score);
  return { band: band || null, score };
}

function normalizeMode(m){
  if (m === null || m === undefined || m === '') return null;
  return String(m).toUpperCase();
}

function normalizeTimestamp(t){
  if (t === null || t === undefined || t === '') return null;
  try {
    const d = (t instanceof Date) ? t : new Date(t);
    if (Number.isNaN(d.getTime())) return String(t);
    return d.toISOString();
  } catch {
    return String(t);
  }
}

export const SDR_EVIDENCE_PROVENANCE = Object.freeze({
  module:        'src/types/sdrEvidence.schema.js',
  schema_name:   SDR_EVIDENCE_SCHEMA_NAME,
  version:       SDR_EVIDENCE_SCHEMA_VERSION,
  scope:         'advisory SDR observability — never filing-controlling',
  related: {
    calibrated_residuals: 'src/evidence/sdrCalibration.js (promotes captures to residual evidence when the calibration chain + model prediction are both available)'
  }
});
