// genoa.exhibit.v2 — schema descriptor + builder + lightweight validator.
//
// This is intentionally a hand-built schema (not JSON Schema) because the
// exhibit is structural and traceability-driven, not freeform JSON: every
// engineering number must be linkable back to (input, method, version,
// calculation module, warning status).
//
// REQUIRED BLOCKS (all top-level keys):
//   schema, generated_at, software_versions, method_versions,
//   operator_metadata, station_inputs, facility_metadata,
//   calculation_method, interpolation, contour_definitions, radial_table,
//   polygons, geojson, evidence, validation, uncertainty,
//   population_estimate, warnings, filing_readiness, exports, narrative

export const SCHEMA_NAME    = 'genoa.exhibit.v2';
export const SCHEMA_VERSION = 2;

export const REQUIRED_BLOCKS = [
  'schema', 'generated_at', 'engine_signature',
  'software_versions', 'method_versions',
  'operator_metadata', 'station_inputs', 'facility_metadata',
  'calculation_method', 'interpolation', 'calculation_trace',
  'contour_definitions',
  'radial_table', 'polygons', 'geojson', 'evidence', 'validation',
  'uncertainty', 'population_estimate',
  'warnings', 'blockers', 'degraded_mode', 'degraded_reasons',
  'filing_readiness',
  'exports', 'narrative'
];

export function emptyExhibit(){
  return {
    schema:              { name: SCHEMA_NAME, version: SCHEMA_VERSION },
    generated_at:        new Date().toISOString(),
    engine_signature:    null,
    software_versions:   {},
    method_versions:     {},
    operator_metadata:   {},
    station_inputs:      {},
    facility_metadata:   {},
    calculation_method:  null,
    interpolation:       null,
    calculation_trace:   null,
    contour_definitions: [],
    radial_table:        [],
    polygons:            [],
    geojson:             { type: 'FeatureCollection', features: [] },
    evidence:            { terrain: null, measurements: null, identity: null, uncertainty: null },
    validation:          { runs: [], reference_cases_present: false },
    uncertainty:         null,
    population_estimate: null,
    warnings:            [],
    blockers:            [],
    degraded_mode:       false,
    degraded_reasons:    [],
    filing_readiness:    null,
    exports:             { json: null, txt: null, geojson: null, pdf: null, generated_at: null },
    narrative:           null
  };
}

export function validateExhibit(exhibit){
  const missing = REQUIRED_BLOCKS.filter(k => !(k in exhibit));
  if (missing.length){
    return { ok: false, missing };
  }
  if (exhibit.schema?.name !== SCHEMA_NAME)   return { ok: false, missing: ['schema.name mismatch'] };
  if (exhibit.schema?.version !== SCHEMA_VERSION) return { ok: false, missing: ['schema.version mismatch'] };
  return { ok: true, missing: [] };
}
