// Build a SigMF-meta JSON document from a KiwiSDR (or any AM-band SDR)
// capture session.  Pure function — no I/O.
//
// PURPOSE
//   The user's capture flow is: chelstein/zerotrustradio's capture-proxy
//   tunnels a WebSocket session to a remote KiwiSDR, the operator records
//   N seconds of audio (or IQ) at a known frequency from a known
//   geographic location, and reads off an S-meter / RSSI value.  Genoa's
//   evidence pipeline (src/evidence/measurements/sigmf.js + sdrCalibration.js)
//   wants a sigmf-meta JSON with calibration metadata and a measured
//   field-strength annotation per capture.  This module bridges the two:
//   given the KiwiSDR session metadata + a calibration chain, it emits
//   a sigmf-meta object that parseSigmfMeta accepts as `calibrated:true`.
//
// CALIBRATION CHAIN
//   Mirrors src/evidence/sdrCalibration.js applyCalibration():
//     E_dBu = RSSI_dBm − LNA_gain − antenna_gain + cable_loss + AF
//   where AF = antenna_factor_db_per_m if known, else 107 dB
//   (50Ω matched-antenna default for an isotropic receiver).  Same
//   regulatory citations: §73.186 (AM), §73.314 (FM), OET-69.
//
// SHAPE
//   Output conforms to the subset of SigMF that
//   src/evidence/measurements/sigmf.js parseSigmfMeta consumes:
//     global['core:hw']                  → required for calibrated=true
//     global['core:sample_rate']         → required for calibrated=true
//     global['genoa:calibration_dB']     → required for calibrated=true
//     captures[i]['core:datetime']
//     captures[i]['core:geolocation']    → GeoJSON Point [lon, lat]
//     annotations[i]['core:label']       → must contain "<X> dBu" for
//                                          parseSigmfMeta to extract the
//                                          measurement.

const POWER_TO_FIELD_DB = 107;     // dBm→dBu, 50Ω matched-antenna default
const KIWI_DEFAULT_RATE = 12000;   // Hz; KiwiSDR's stock AM-mode demod rate

// Canonical ZTR capture-audio URL.  ZTR's app serves captured audio
// through an API endpoint keyed by the per-capture id (NOT the station
// id — a station can have many captures over time):
//   <ZTR_APP_URL>/api/sdr/captures/<ztr_capture_id>/audio
// e.g.
//   https://zerotrustradio-app-vvhi8.ondigitalocean.app/api/sdr/captures/71268/audio
//
// The endpoint is auth-gated; downstream fetchers (the future
// exhibitService side-channel) will need a ZTR API token.  This module
// only records the URL — it does no fetching.
//
// ZTR_APP_URL_DEFAULT points at the production DO App Platform deploy.
// Override via the ZTR_APP_URL env var on the genoa side, or
// --ztr-app-url on the CLI, when running against staging / a custom
// domain.
export const ZTR_APP_URL_DEFAULT = 'https://zerotrustradio-app-vvhi8.ondigitalocean.app';

export function ztrCaptureAudioUrl(ztr_capture_id, base = ZTR_APP_URL_DEFAULT){
  if (ztr_capture_id === null || ztr_capture_id === undefined || ztr_capture_id === '') return null;
  // Trim trailing slash on the base so a user-supplied "https://host/" works.
  const cleanBase = String(base).replace(/\/+$/, '');
  return `${cleanBase}/api/sdr/captures/${encodeURIComponent(String(ztr_capture_id))}/audio`;
}

export function buildSigmfFromKiwiCapture({
  // ---- transmitter under test ----
  callsign,
  service              = 'AM',
  frequency_khz,                              // required (kHz integer for AM)
  tx_lat,
  tx_lon,
  // ---- receiver / capture ----
  rx_lat,
  rx_lon,
  captured_at,                                // ISO 8601 UTC
  duration_seconds     = null,
  sample_rate_hz       = KIWI_DEFAULT_RATE,
  // ---- raw signal reading ----
  rssi_dbm             = null,                // S-meter reading (dBm)
  field_dBu_override   = null,                // skip the chain, supply dBu directly
  field_mvm_override   = null,                // alt. supply mV/m
  // ---- receiver calibration chain ----
  antenna_gain_dbi     = 0,
  antenna_factor_db_per_m = null,             // overrides 107 if provided
  cable_loss_db        = 0,
  lna_gain_db          = 0,
  sensitivity_floor_dbm = null,
  last_calibration_date = null,
  calibration_method    = null,
  traceable             = false,
  uncertainty_db        = null,
  // ---- KiwiSDR session metadata ----
  kiwi_host             = null,               // "kiwisdr.example.org:8073"
  kiwi_user             = null,
  capture_proxy_url     = null,
  audio_filename        = null,
  audio_url             = null,               // fully-qualified URL to the audio (e.g. ZTR app API)
  ztr_capture_id        = null,               // numeric ZTR capture id; if set and audio_url is null, derives the ZTR app API URL
  ztr_station_id        = null,               // numeric ZTR station id (cross-ref to facility_lookup_source.ztr_id); metadata only
  ztr_app_url           = ZTR_APP_URL_DEFAULT,
  // ---- meta ----
  author                = 'genoa sigmfFromKiwiCapture',
  description           = null
} = {}){
  // ---- validation ----
  const missing = [];
  if (!callsign)               missing.push('callsign');
  if (!Number.isFinite(frequency_khz)) missing.push('frequency_khz');
  if (!Number.isFinite(tx_lat) || !Number.isFinite(tx_lon)) missing.push('tx_lat/tx_lon');
  if (!Number.isFinite(rx_lat) || !Number.isFinite(rx_lon)) missing.push('rx_lat/rx_lon');
  if (!captured_at)            missing.push('captured_at');
  if (missing.length){
    throw new Error(`buildSigmfFromKiwiCapture: missing required fields: ${missing.join(', ')}`);
  }
  const svc = String(service).toUpperCase();

  // ---- calibration chain → field_dBu ----
  // Direct overrides win.
  let field_dBu;
  let field_basis;
  if (Number.isFinite(field_dBu_override)){
    field_dBu   = +Number(field_dBu_override).toFixed(2);
    field_basis = 'direct_field_strength_reading';
  } else if (Number.isFinite(field_mvm_override)){
    const mvm = Number(field_mvm_override);
    field_dBu   = +(20 * Math.log10(Math.max(mvm * 1000, 1e-9))).toFixed(2);
    field_basis = 'direct_field_strength_reading_mvm';
  } else if (Number.isFinite(rssi_dbm)){
    const af = Number.isFinite(antenna_factor_db_per_m)
                  ? Number(antenna_factor_db_per_m)
                  : POWER_TO_FIELD_DB;
    field_dBu   = +(Number(rssi_dbm)
                  - Number(lna_gain_db || 0)
                  - Number(antenna_gain_dbi || 0)
                  + Number(cable_loss_db || 0)
                  + af).toFixed(2);
    field_basis = Number.isFinite(antenna_factor_db_per_m)
                    ? 'rssi_to_field_chain (antenna_factor_db_per_m)'
                    : `rssi_to_field_chain (${POWER_TO_FIELD_DB} dB matched-antenna default)`;
  } else {
    throw new Error('buildSigmfFromKiwiCapture: must supply rssi_dbm OR field_dBu_override OR field_mvm_override');
  }

  // ---- calibration metadata ----
  const calibration_dB = Number.isFinite(antenna_factor_db_per_m)
                            ? Number(antenna_factor_db_per_m)
                            : POWER_TO_FIELD_DB;
  // parseSigmfMeta requires three globals to flip calibrated:true.  We
  // populate all three when we have an actual chain reading; if the
  // user gave us a direct dBu override and zero chain context, mark
  // not-calibrated (we can't substantiate the calibration story).
  const has_chain_context = Number.isFinite(rssi_dbm)
                         || (cable_loss_db || 0) !== 0
                         || (lna_gain_db || 0) !== 0
                         || (antenna_gain_dbi || 0) !== 0
                         || Number.isFinite(antenna_factor_db_per_m)
                         || !!last_calibration_date
                         || !!calibration_method;

  const hw = kiwi_host
              ? `KiwiSDR @ ${kiwi_host}${kiwi_user ? ` (${kiwi_user})` : ''}`
              : 'unknown SDR (no kiwi_host supplied)';

  // ---- assemble ----
  const meta = {
    global: {
      'core:datatype':       'cf32_le',                      // KiwiSDR demod default
      'core:sample_rate':    Number(sample_rate_hz),
      'core:version':        '1.0.0',
      'core:hw':             hw,
      'core:author':         author,
      'core:datetime':       captured_at,
      'core:description':    description
                              || `${svc} ${frequency_khz} kHz ${callsign} via KiwiSDR session`,
      'genoa:calibration_dB': calibration_dB,
      'genoa:tx': {
        callsign,
        service:        svc,
        frequency_khz:  Number(frequency_khz),
        lat:            Number(tx_lat),
        lon:            Number(tx_lon)
      },
      'genoa:calibration': {
        calibrated:               has_chain_context,
        antenna_gain_dbi:         Number(antenna_gain_dbi) || 0,
        antenna_factor_db_per_m:  Number.isFinite(antenna_factor_db_per_m)
                                    ? Number(antenna_factor_db_per_m)
                                    : null,
        cable_loss_db:            Number(cable_loss_db) || 0,
        lna_gain_db:              Number(lna_gain_db) || 0,
        sensitivity_floor_dbm:    Number.isFinite(sensitivity_floor_dbm)
                                    ? Number(sensitivity_floor_dbm)
                                    : null,
        last_calibration_date,
        calibration_method,
        traceable:                !!traceable,
        uncertainty_db:           Number.isFinite(uncertainty_db)
                                    ? Number(uncertainty_db)
                                    : null
      },
      'genoa:capture_proxy': capture_proxy_url
                                ? { url: capture_proxy_url }
                                : null,
      'genoa:audio_filename': audio_filename || null,
      // ZTR serves captured audio through an API endpoint keyed by the
      // per-capture id (a station can have many captures over time):
      //   <ZTR_APP_URL>/api/sdr/captures/<capture_id>/audio
      // When ztr_capture_id is supplied we synthesise that URL so the
      // SigMF doc is self-contained — a human (or the future
      // exhibitService side-channel) can pull the audio with one
      // request.  Note this endpoint is auth-gated; downstream
      // fetchers need a ZTR API token.  audio_url overrides this if
      // explicitly supplied.
      'genoa:audio_url':      audio_url || ztrCaptureAudioUrl(ztr_capture_id, ztr_app_url),
      'genoa:ztr_capture_id': ztr_capture_id !== null && ztr_capture_id !== undefined && ztr_capture_id !== ''
                                ? String(ztr_capture_id)
                                : null,
      'genoa:ztr_station_id': ztr_station_id !== null && ztr_station_id !== undefined && ztr_station_id !== ''
                                ? String(ztr_station_id)
                                : null,
      'genoa:provenance': {
        regulation:     svc === 'AM' ? '47 CFR §73.186' : '47 CFR §73.314',
        reference:      'OET Bulletin 69 (receiver-calibration framework)',
        chain:          'E_dBu = RSSI_dBm − LNA − ant_gain + cable_loss + AF',
        license_basis:  '17 USC §105'
      }
    },
    captures: [{
      'core:sample_start':   0,
      'core:datetime':       captured_at,
      'core:frequency':      Number(frequency_khz) * 1000,   // SigMF wants Hz
      'core:geolocation':    {
        type:        'Point',
        coordinates: [Number(rx_lon), Number(rx_lat)]        // [lon, lat]
      },
      // Per-capture mirrors so consumers that bypass the annotation can
      // still get the numbers (sdrCalibration.js applyCalibration also
      // accepts these directly).
      lat:                   Number(rx_lat),
      lon:                   Number(rx_lon),
      frequency_khz:         Number(frequency_khz),
      rssi_dbm:              Number.isFinite(rssi_dbm) ? Number(rssi_dbm) : null,
      field_dBu,
      field_basis,
      duration_seconds
    }],
    annotations: [{
      'core:sample_start':  0,
      'core:sample_count':  Number.isFinite(duration_seconds) && Number.isFinite(sample_rate_hz)
                              ? Math.round(Number(duration_seconds) * Number(sample_rate_hz))
                              : 0,
      // parseSigmfMeta extracts measured_dBu by regex'ing for "<X> dBu"
      // in the annotation label — preserve that contract verbatim.
      'core:label':         `${field_dBu} dBu ${callsign} ${frequency_khz} kHz`,
      'core:freq_lower_edge': (Number(frequency_khz) - 5) * 1000,
      'core:freq_upper_edge': (Number(frequency_khz) + 5) * 1000,
      'genoa:field_basis':  field_basis
    }]
  };

  return meta;
}
