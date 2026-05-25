// Physics advisory evidence schema — locks the shape of advisory
// physics sidecar evidence blocks attached to a Genoa exhibit
// (currently: evidence.am_physics — SOMNEC2D output).
//
// CRITICAL CONTRACT
//   Every block matching this schema MUST be advisory only.  The
//   schema therefore REQUIRES:
//     - advisory      === true
//     - filing_effect === 'none'
//   Any block that fails either invariant is invalid and the
//   exhibit-builder must refuse to attach it.  This is how the
//   "physics never modifies filing" boundary is enforced at the
//   data-shape layer (in addition to the engine boundary).
//
// SCOPE
//   This schema covers the four observable states the orchestrator
//   may attach for a physics sidecar:
//     - status: 'not_configured'  — sidecar URL unset
//     - status: 'not_run'         — preconditions missing (e.g. no freq)
//     - status: 'run'             — sidecar returned a result
//     - status: 'failed'          — sidecar reachable but errored or timed out
//
//   The schema deliberately does NOT validate the deep shape of
//   outputs / stdout_summary (those are sidecar-version-specific and
//   surface through Appendix H as opaque diagnostics).
//
// REGULATORY POSTURE
//   FCC §73.183 / §73.184 / §73.190 / §73.182 math is unaffected by
//   anything in a block matching this schema.  Reviewers verify the
//   boundary by checking filing_effect on every advisory block.

export const PHYSICS_EVIDENCE_SCHEMA_NAME    = 'genoa.physics_evidence.v1';
export const PHYSICS_EVIDENCE_SCHEMA_VERSION = 1;

export const PHYSICS_EVIDENCE_STATUSES = Object.freeze([
  'not_configured',
  'not_run',
  'run',
  'failed'
]);

// The canonical schema descriptor.  Hand-rolled (not JSON Schema) to
// stay consistent with src/types/schema.js for the top-level exhibit.
export const PHYSICS_EVIDENCE_SCHEMA = Object.freeze({
  name:    PHYSICS_EVIDENCE_SCHEMA_NAME,
  version: PHYSICS_EVIDENCE_SCHEMA_VERSION,
  required: Object.freeze([
    'status',
    'advisory',
    'filing_effect',
    'engine'
  ]),
  invariants: Object.freeze({
    advisory:      true,
    filing_effect: 'none'
  }),
  enums: Object.freeze({
    status: PHYSICS_EVIDENCE_STATUSES
  }),
  optional: Object.freeze([
    'method',
    'sidecar_configured',
    'source_path',
    'inputs',
    'outputs',
    'stdout_summary',
    'notes',
    'warning',
    'error',
    'elapsed_ms',
    'fetched_at'
  ]),
  // Allowed shape for the inputs sub-block — only structural keys.
  inputs_shape: Object.freeze([
    'epr', 'epr_source',
    'sig_s_m', 'sigma_ms_m', 'sigma_source',
    'frequency_mhz'
  ])
});

/**
 * Validate a physics-evidence block.
 *
 * Returns { ok: true } when valid, else { ok: false, errors: string[] }.
 *
 * The function is deliberately strict on the two invariants that make
 * the advisory boundary safe (`advisory === true`,
 * `filing_effect === 'none'`) and lenient on optional payload shape
 * (sidecar diagnostics evolve independently of the schema).
 *
 * @param {object} obj — candidate evidence.am_physics value
 * @returns {{ ok: boolean, errors?: string[] }}
 */
export function validatePhysicsEvidence(obj){
  const errors = [];
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)){
    return { ok: false, errors: ['physics_evidence must be a non-null object'] };
  }
  for (const k of PHYSICS_EVIDENCE_SCHEMA.required){
    if (!(k in obj)) errors.push(`missing required key: ${k}`);
  }
  if (obj.advisory !== true){
    errors.push('advisory must be exactly true (advisory-only contract)');
  }
  if (obj.filing_effect !== 'none'){
    errors.push("filing_effect must be exactly 'none' (advisory-only contract)");
  }
  if (obj.status != null
      && !PHYSICS_EVIDENCE_STATUSES.includes(obj.status)){
    errors.push(`status must be one of ${PHYSICS_EVIDENCE_STATUSES.join(', ')} (got ${JSON.stringify(obj.status)})`);
  }
  if (obj.engine != null && typeof obj.engine !== 'string'){
    errors.push('engine must be a string when present');
  }
  if (obj.inputs != null){
    if (typeof obj.inputs !== 'object' || Array.isArray(obj.inputs)){
      errors.push('inputs must be an object when present');
    } else {
      // Each known input key must be numeric or a known string tag.
      const numericKeys = ['epr', 'sig_s_m', 'sigma_ms_m', 'frequency_mhz'];
      for (const k of numericKeys){
        if (obj.inputs[k] != null && !Number.isFinite(Number(obj.inputs[k]))){
          errors.push(`inputs.${k} must be a finite number when present`);
        }
      }
      for (const k of ['epr_source', 'sigma_source']){
        if (obj.inputs[k] != null
            && obj.inputs[k] !== 'default'
            && obj.inputs[k] !== 'input'){
          errors.push(`inputs.${k} must be 'default' or 'input' when present`);
        }
      }
    }
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true };
}

/**
 * Convenience: synthesize a minimal not_configured block that already
 * satisfies validatePhysicsEvidence.  Used by sidecars/orchestrator to
 * avoid scattering boilerplate.
 */
export function notConfiguredPhysicsEvidence({ engine = 'somnec2d', reason = 'AM_PHYSICS_SIDECAR_URL unset' } = {}){
  return {
    status:        'not_configured',
    advisory:      true,
    filing_effect: 'none',
    engine,
    method:        'NEC-family modified Sommerfeld integral ground-field solver',
    notes: [
      'Independent physics evidence only.',
      'Does not modify FCC §73.184 curve-derived contour distances.',
      reason
    ]
  };
}
