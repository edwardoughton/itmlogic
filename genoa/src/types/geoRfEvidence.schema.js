// Geo-RF Evidence envelope — schema constant + validator.
//
// Single canonical description of the evidence.geo_rf_evidence envelope
// produced by genoa/src/evidence/geoRfEvidenceClient.js (and exposed via
// /api/geo-rf-evidence/sample).  This module is the contract surface — the
// engineering report's Appendix I, the LMS-filing packager's advisory_notes,
// and the GeoRfEvidencePanel UI all read these slot names; new datasets
// land here first.
//
// REGULATORY POSTURE
//   Environmental RF evidence is ADVISORY only.  Does not modify FCC
//   filing-controlling contour or allocation calculations
//   (§73.184 / §73.182 / §73.190 / §73.313 / §73.207 / §73.215).
//
//   `filing_effect` is locked to the literal string 'none' on every
//   envelope and is asserted by the geoRfFilingInvariance* tests.

/**
 * The full set of dataset slot names the envelope MAY carry.  Slots not
 * known to the sidecar appear as `{available:false}` — never invented
 * placeholder data.
 *
 * Order is the canonical render order used by Appendix I.
 */
export const GEO_RF_DATASET_SLOTS = Object.freeze([
  'tree_canopy',                          // USFS TCC CONUS (canonical canopy density slot)
  'tree_canopy_conus',                    // back-compat alias (older sidecar contract)
  'landcover',                            // NLCD / NRCan landcover (CONUS + cross-border)
  'tau_rf_models',                        // RF / environment statistical model artifacts
  'fcc_m3_conductivity_availability',     // FCC §73.190 Fig. M3 conductivity coverage indicator
  'water_proximity',                      // surface-water / coastal proximity (advisory propagation context)
  'climate_projection_availability',      // climate-projection raster availability flag
  'sdr_residual_support',                 // independent SDR observed-vs-predicted residual support
  'canada_landcover'                      // back-compat alias for NRCan landcover (cross-border)
]);

/** Allowed top-level envelope status values. */
export const GEO_RF_STATUS_VALUES = Object.freeze([
  'run', 'not_configured', 'failed', 'offline'
]);

/**
 * Schema constant — the structural contract.  Each leaf describes either
 * { required, type } or a nested shape.  Validation is intentionally
 * permissive (extra keys allowed) so the sidecar can grow new fields
 * without breaking the receiver.
 */
export const GEO_RF_EVIDENCE_SCHEMA = Object.freeze({
  $id:           'genoa.geo_rf_evidence.envelope.v2',
  version:       2,
  advisory_only: true,
  filing_effect: 'none',

  required: ['status', 'advisory', 'filing_effect', 'inputs', 'datasets', 'notes'],

  fields: {
    status:        { type: 'string', enum: GEO_RF_STATUS_VALUES },
    advisory:      { type: 'boolean', literal: true },
    filing_effect: { type: 'string',  literal: 'none' },
    inputs: {
      type: 'object',
      fields: {
        lat:         { type: ['number', 'null'] },
        lon:         { type: ['number', 'null'] },
        service:     { type: ['string', 'null'] },
        call:        { type: ['string', 'null'] },
        facility_id: { type: ['string', 'null'] }
      }
    },
    datasets: {
      type: 'object',
      // Each slot is an object with at least { available: boolean }.
      slots: GEO_RF_DATASET_SLOTS,
      slot_shape: {
        available: { type: 'boolean', required: true }
      }
    },
    map_marker: {
      type: ['object', 'null'],
      optional: true,
      fields: {
        lat:        { type: 'number',  required: true },
        lon:        { type: 'number',  required: true },
        label:      { type: 'string',  required: true },
        popup_text: { type: 'string',  required: true }
      }
    },
    confidence_scoring_context: {
      type:     ['object', 'null'],
      optional: true
    },
    residual_support: {
      type:     ['object', 'null'],
      optional: true
    },
    notes:           { type: 'array', items: { type: 'string' } },
    sidecar_service: { type: ['string', 'null'], optional: true },
    fetched_at:      { type: ['string', 'null'], optional: true },
    elapsed_ms:      { type: ['number', 'null'], optional: true },
    error:           { type: ['string', 'null'], optional: true }
  }
});

/**
 * Validate a candidate `envelope` against GEO_RF_EVIDENCE_SCHEMA.
 *
 * Returns { ok: true, errors: [] } on success, { ok: false, errors: [...] }
 * otherwise.  Never throws.  Validation is structural — it ensures filing-
 * controlling fields are absent and that filing_effect === 'none', so it
 * can be used as a runtime guard on whatever the sidecar produces.
 *
 * @param {object} envelope  candidate evidence.geo_rf_evidence value
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateGeoRfEvidenceEnvelope(envelope){
  const errors = [];
  if (envelope == null || typeof envelope !== 'object' || Array.isArray(envelope)){
    return { ok: false, errors: ['envelope must be a non-null object'] };
  }

  // Required top-level keys.
  for (const k of GEO_RF_EVIDENCE_SCHEMA.required){
    if (!(k in envelope)) errors.push(`missing required key: ${k}`);
  }

  // Status enum.
  if (envelope.status != null && !GEO_RF_STATUS_VALUES.includes(envelope.status)){
    errors.push(`status must be one of ${GEO_RF_STATUS_VALUES.join('|')} (got ${JSON.stringify(envelope.status)})`);
  }

  // Advisory + filing_effect literals (regulatory-posture lock).
  if (envelope.advisory !== true){
    errors.push('advisory must be literal true');
  }
  if (envelope.filing_effect !== 'none'){
    errors.push(`filing_effect must be the literal string "none" (got ${JSON.stringify(envelope.filing_effect)})`);
  }

  // Datasets: every present slot must carry { available: boolean }.
  const ds = envelope.datasets;
  if (ds == null || typeof ds !== 'object' || Array.isArray(ds)){
    errors.push('datasets must be an object');
  } else {
    for (const [slot, val] of Object.entries(ds)){
      if (val == null || typeof val !== 'object' || Array.isArray(val)){
        errors.push(`datasets.${slot} must be an object`);
        continue;
      }
      if (typeof val.available !== 'boolean'){
        errors.push(`datasets.${slot}.available must be boolean`);
      }
    }
  }

  // Inputs.
  if (envelope.inputs != null && typeof envelope.inputs !== 'object'){
    errors.push('inputs must be an object');
  }

  // map_marker — optional, but if present must be well-formed.
  if (envelope.map_marker != null){
    const m = envelope.map_marker;
    if (typeof m !== 'object' || Array.isArray(m)){
      errors.push('map_marker must be an object');
    } else {
      if (!Number.isFinite(m.lat)) errors.push('map_marker.lat must be finite number');
      if (!Number.isFinite(m.lon)) errors.push('map_marker.lon must be finite number');
      if (typeof m.label      !== 'string' || !m.label)      errors.push('map_marker.label must be non-empty string');
      if (typeof m.popup_text !== 'string' || !m.popup_text) errors.push('map_marker.popup_text must be non-empty string');
    }
  }

  // Regulatory-posture: forbid filing-controlling keys at the top level.
  const FORBIDDEN = [
    'contour_distance_km', 'protected_contour_uv_m', 'allocation_result',
    'permitted_erp_kw',    'filing_decision',        'compliance_pass',
    'filing_ready',        'blockers'
  ];
  for (const k of FORBIDDEN){
    if (k in envelope){
      errors.push(`envelope must not carry filing-controlling key "${k}"`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Build an empty `{available:false}` dataset map covering every known
 * slot.  Useful for the not_configured envelope and for tests that need
 * to assert "no dataset reports invented data".
 */
export function makeEmptyDatasetMap(){
  const out = {};
  for (const s of GEO_RF_DATASET_SLOTS) out[s] = { available: false };
  return out;
}

export const GEO_RF_EVIDENCE_SCHEMA_PROVENANCE = Object.freeze({
  module:   'src/types/geoRfEvidence.schema.js',
  schema:   GEO_RF_EVIDENCE_SCHEMA.$id,
  version:  GEO_RF_EVIDENCE_SCHEMA.version,
  posture:  'ADVISORY only — schema locks filing_effect="none" and forbids filing-controlling keys.'
});
