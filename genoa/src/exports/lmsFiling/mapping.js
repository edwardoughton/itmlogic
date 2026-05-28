// LMS filing-package mapping — service-aware router.
//
// Genoa's filing-package machinery used to assume every exhibit
// targeted Form 301-FM.  That was wrong: AM filings should
// produce Form 301-AM language (§73.183/.184/.182/.187/.190/.99,
// "power" not "ERP", no HAAT), FM-translator filings should
// produce Form 349 (Part 74 Subpart L), and LPFM filings should
// produce Form 318 (Part 73 Subpart G).  This module is the
// dispatcher: based on station_inputs.service it picks the right
// schema + field-set and runs the same generic mapper over it.
//
//   AM   → form301am  (FORM_301_AM_FIELDS / FORM_301_AM_META)
//   FM   → form301fm  (FORM_301_FM_FIELDS / FORM_301_FM_META) — unchanged
//   FX   → form349    (FORM_349_FIELDS    / FORM_349_META)
//   LPFM → form318    (FORM_318_FIELDS    / FORM_318_META)
//
// `mapForm301Fm` is kept as a back-compat alias of
// `mapFilingPackage` so existing callers (the lmsFiling route, the
// packager, older tests) continue to work.  When the incoming
// exhibit's service is anything other than FM, the alias still
// routes to the correct mapper — the FM-specific name is purely
// historical at this point.
//
// Per-field output shape (single source of truth across services):
//   {
//     id, lms_label, section, subsection, type, unit, options,
//     required, cite, source, notes,
//     value,                    null when no value resolved
//     status,                   one of FieldStatus (FILLED / SUGGESTED /
//                               NEEDS_INPUT / EVIDENCE_MISSING / NOT_APPLICABLE)
//                               OR the legacy 'filled' / 'suggested' /
//                               'gap' / 'unknown' for back-compat with the
//                               existing FM cheatsheet renderer
//     provenance,               { source, fetched_at?, dataset?, ... }
//     engineer_confirmation_required?  hoisted from the schema when
//                                      the field is operator-overridable
//   }

import { FORM_301_FM_FIELDS, FORM_301_FM_META } from './form301fm.js';
import { FORM_301_AM_FIELDS, FORM_301_AM_META } from './form301am.js';
import { FORM_349_FIELDS,    FORM_349_META    } from './form349.js';
import { FORM_318_FIELDS,    FORM_318_META    } from './form318.js';
import { gateFilingReady, FieldStatus } from './_readiness.js';

function dotPath(obj, path){
  if (!obj || !path) return undefined;
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

// Normalize service string for routing.  AM/FM are unambiguous; FX
// covers FM translator filings (FCC service code 'FX').  'FB' (FM
// booster) also routes to Form 349.  'LPFM' and 'LP' both route to
// Form 318.
function selectSchemaForService(service){
  const svc = String(service || '').toUpperCase();
  if (svc === 'AM')                  return { fields: FORM_301_AM_FIELDS, meta: FORM_301_AM_META, key: 'AM' };
  if (svc === 'FX' || svc === 'FB')  return { fields: FORM_349_FIELDS,    meta: FORM_349_META,    key: 'FX' };
  if (svc === 'LPFM' || svc === 'LP') return { fields: FORM_318_FIELDS,   meta: FORM_318_META,    key: 'LPFM' };
  // Default — FM full-service.  Preserves prior behavior for every
  // exhibit that didn't carry a service hint or shipped 'FM'.
  return { fields: FORM_301_FM_FIELDS, meta: FORM_301_FM_META, key: 'FM' };
}

// Resolve provenance for a filled field, consistent across services.
// Inspects standard exhibit blocks (facility_metadata, evidence.terrain,
// evidence.fcc_lms, evidence.am_physics, population_estimate).
function resolveProvenance(exhibit, def){
  const fm  = exhibit?.facility_metadata     || {};
  const evt = exhibit?.evidence?.terrain     || {};
  const lms = exhibit?.evidence?.fcc_lms     || {};
  const pop = exhibit?.population_estimate   || {};
  const amp = exhibit?.evidence?.am_physics  || {};

  if (def.mapping?.startsWith('station_inputs.')){
    if (fm.facility_lookup_source){
      return {
        source:     fm.facility_lookup_source,
        endpoint:   fm.facility_endpoint || null,
        fetched_at: fm.facility_updated_at || null,
        note:       'FCC facility record'
      };
    }
    return { source: 'operator input', note: 'manually entered in workbench' };
  }
  if (def.mapping?.startsWith('evidence.terrain.')){
    return {
      source:     evt.source || 'terrain-sidecar',
      endpoint:   evt.endpoint || null,
      dataset:    `${evt.dem?.source || 'DEM'} ${evt.dem?.dataset || ''}`.trim(),
      method:     evt.method || null,
      fetched_at: evt.fetched_at || null
    };
  }
  if (def.mapping?.startsWith('evidence.fcc_lms.') ||
      def.mapping?.startsWith('evidence.fcc_lms_attempt.')){
    return {
      source:     lms.source || 'fcc-lms',
      endpoint:   null,
      fetched_at: lms.fetched_at || null
    };
  }
  if (def.mapping?.startsWith('evidence.am_physics.')){
    return {
      source:     'am-physics (SOMNEC2D advisory)',
      fetched_at: amp.fetched_at || null,
      note:       'AM physics evidence is advisory; values shown here are still required to come through §73.184 curve method for filing'
    };
  }
  if (def.mapping?.startsWith('population_estimate.')){
    return {
      source:     pop.source || 'fcc-census',
      dataset:    pop.dataset || null,
      vintage:    pop.vintage || null,
      method:     pop.method || null,
      sha256:     pop.sha256 ? pop.sha256.slice(0, 16) + '…' : null,
      fetched_at: pop.fetched_at || null,
      note:       'INFORMATIONAL — not a §73 compliance input (FCC tests are distance and field-strength, not population)'
    };
  }
  return { source: 'genoa-engine', note: 'computed from exhibit', method: def.id };
}

// Run the schema-agnostic mapper.  Same logic for every form: the
// difference is the FIELDS array passed in.  Status codes use the
// legacy strings (`filled`/`suggested`/`gap`/`unknown`) for back-
// compat with the existing FM packager renderer; the readiness gate
// in _readiness.js maps these onto the 5-state FieldStatus enum.
function mapFields(exhibit, fields, applicant){
  const filled = [];
  for (const def of fields){
    let value = null;
    let status = 'gap';
    let provenance = null;

    if (def.source === 'genoa-auto'){
      // Operator override has priority on every genoa-auto field
      // (matches FM behavior — see PR #79 / mapping.js prior art).
      const operatorVal = applicant?.engineer?.[def.id];
      if (operatorVal !== undefined && operatorVal !== null && operatorVal !== ''){
        value = operatorVal;
        status = 'filled';
        provenance = { source: 'engineer of record', note: 'operator input via workbench (override of auto-derive)' };
      } else {
        if (typeof def.derive === 'function'){
          value = def.derive(exhibit);
        } else if (def.mapping){
          value = dotPath(exhibit, def.mapping);
        }
        if (value !== undefined && value !== null && !(typeof value === 'string' && !value.trim())){
          status = 'filled';
          provenance = resolveProvenance(exhibit, def);
        } else {
          status = 'unknown';
        }
      }
    } else if (def.source === 'manual-engineer'){
      const v = applicant?.engineer?.[def.id];
      if (v !== undefined && v !== null && v !== ''){
        value = v;
        status = 'filled';
        provenance = { source: 'engineer of record', note: 'operator input via workbench' };
      } else if (typeof def.suggest === 'function'){
        const sv = def.suggest(exhibit);
        if (sv !== undefined && sv !== null && sv !== ''){
          value = sv;
          status = 'suggested';
          provenance = {
            source: 'genoa-engine',
            note:   def.suggest_note || 'pre-staged for engineer confirmation'
          };
        } else {
          status = 'gap';
        }
      } else {
        status = 'gap';
      }
    } else {
      // manual-applicant — out of scope.
      status = 'gap';
    }
    const row = { ...def, value: value ?? null, status, provenance };
    // Hoist engineer_confirmation_required: every field that landed
    // 'suggested' or 'gap' for a manual-* source needs operator
    // confirmation before filing.  Schemas may also flag this
    // explicitly via the def.engineer_confirmation_required key.
    if (def.engineer_confirmation_required
        || status === 'suggested'
        || (def.source === 'manual-engineer' && status !== 'filled')){
      row.engineer_confirmation_required = true;
    }
    filled.push(row);
  }
  return filled;
}

// Service-aware mapper.  Pick the schema, run mapFields, compute
// summary + filing_ready + metadata.  Returns the same shape as the
// historic mapForm301Fm so the packager + route + tests are agnostic.
export function mapFilingPackage(exhibit, applicant = {}){
  if (!exhibit || typeof exhibit !== 'object'){
    throw new Error('mapFilingPackage: exhibit is required');
  }
  const { fields: SCHEMA, meta } = selectSchemaForService(exhibit?.station_inputs?.service);
  const filled = mapFields(exhibit, SCHEMA, applicant);

  const summary = {
    total:         filled.length,
    filled:        filled.filter(f => f.status === 'filled').length,
    suggested:     filled.filter(f => f.status === 'suggested').length,
    gaps:          filled.filter(f => f.status === 'gap').length,
    unknown:       filled.filter(f => f.status === 'unknown').length,
    not_applicable: filled.filter(f => f.status === 'na' || f.status === FieldStatus.NOT_APPLICABLE).length,
    // 'suggested' still counts as a required gap — engineer hasn't
    // confirmed yet, so filing_ready should not flip true on a pre-
    // staged candidate.
    required_gaps: filled.filter(f => f.required && f.status !== 'filled').length
  };

  const compliance_pass = filled.find(f => f.id === 'compliance-pass')?.value;
  const blockers = exhibit.blockers?.length || 0;
  const svc = String(exhibit?.station_inputs?.service || '').toUpperCase();
  const am_night_nif = svc === 'AM' ? (exhibit?.evidence?.am_night_nif || null) : null;

  // Use the readiness gate from _readiness.js so AM / FM / FX /
  // LPFM all share the same definition of "filing-ready".  Note:
  // advisory evidence (am_physics, geo_rf_evidence, sdr_captures)
  // is INTENTIONALLY not passed to gateFilingReady() — those are
  // never filing gaps.
  const gate = gateFilingReady({
    fields:        filled,
    blockers,
    am_night_nif,
    compliance_pass: compliance_pass || null
  });

  return {
    form:        meta,
    fields:      filled,
    summary,
    filing_ready: gate.ready,
    gating_reason: gate.gating_reason,
    blockers_count: blockers,
    compliance_pass: compliance_pass || null,
    exhibit_metadata: {
      call:        exhibit?.station_inputs?.call || null,
      facility_id: exhibit?.station_inputs?.facility_id || null,
      service:     exhibit?.station_inputs?.service || null,
      build_sha:   exhibit?.build_attestation?.sha || exhibit?.engine_signature?.hash || null,
      replay_token: exhibit?.replay_token || null,
      replay_digest_exhibit_sha256: exhibit?.replay_digest?.exhibit_sha256 || null
    }
  };
}

// Back-compat alias.  Historically the only mapper was
// `mapForm301Fm` — callers (the lmsFiling route, the packager,
// older tests) still import it by that name.  It now routes to the
// service-appropriate schema; for FM exhibits behavior is
// byte-identical to the prior implementation.
export function mapForm301Fm(exhibit, applicant = {}){
  return mapFilingPackage(exhibit, applicant);
}

// Helper export — lets the packager pick the right form_meta /
// schema name for filename stem + cheatsheet title.
export { selectSchemaForService };
