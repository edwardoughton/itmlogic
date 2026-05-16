// Form 301-FM mapping: exhibit → filled fields.
//
// Pure function.  Given (exhibit, optional applicant overrides),
// resolves every field in FORM_301_FM_FIELDS to one of:
//   { status: 'filled',    value, provenance } — Genoa knows it (with source)
//   { status: 'suggested', value, provenance } — Genoa pre-stages a value
//                                                 (e.g. ERP-V = ERP-H for ND);
//                                                 engineer must confirm
//   { status: 'gap',       value: null }       — manual entry required
//   { status: 'unknown',   value: null }       — Genoa SHOULD know but evidence missing
//
// `provenance` is a plain object: { source, fetched_at?, dataset?, note? }
// rendered next to the value in the HTML/CSV/JSON cheatsheet so engineers
// can see "this came from FCC FMQ at 2026-05-08T18:14Z" vs "operator typed".

import { FORM_301_FM_FIELDS, FORM_301_FM_META } from './form301fm.js';

function dotPath(obj, path){
  if (!obj || !path) return undefined;
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

// Resolve a sensible provenance block for a filled field, given which
// dot-path it came from in the exhibit.  Inspects the standard exhibit
// blocks (facility_metadata, evidence.terrain, evidence.fcc_lms,
// population_estimate) so the per-field provenance always matches the
// upstream that delivered the value.
function resolveProvenance(exhibit, def){
  const fm  = exhibit?.facility_metadata     || {};
  const evt = exhibit?.evidence?.terrain     || {};
  const lms = exhibit?.evidence?.fcc_lms     || {};
  const pop = exhibit?.population_estimate   || {};

  // station_inputs fields: prefer facility_metadata source if a lookup
  // happened; otherwise the value came from operator input.
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

  // evidence.terrain.* fields: terrain sidecar.
  if (def.mapping?.startsWith('evidence.terrain.')){
    return {
      source:     evt.source || 'terrain-sidecar',
      endpoint:   evt.endpoint || null,
      dataset:    `${evt.dem?.source || 'DEM'} ${evt.dem?.dataset || ''}`.trim(),
      method:     evt.method || null,
      fetched_at: evt.fetched_at || null
    };
  }

  // evidence.fcc_lms fields.
  if (def.mapping?.startsWith('evidence.fcc_lms.') ||
      def.mapping?.startsWith('evidence.fcc_lms_attempt.')){
    return {
      source:     lms.source || 'fcc-lms',
      endpoint:   null,
      fetched_at: lms.fetched_at || null
    };
  }

  // population_estimate fields.
  if (def.mapping?.startsWith('population_estimate.')){
    return {
      source:     pop.source || 'fcc-census',
      dataset:    pop.dataset || null,
      vintage:    pop.vintage || null,
      method:     pop.method || null,
      sha256:     pop.sha256 ? pop.sha256.slice(0, 16) + '…' : null,
      fetched_at: pop.fetched_at || null,
      note:       'INFORMATIONAL — not a §73.x compliance input'
    };
  }

  // Derived (no static mapping): provenance = the engine itself.
  return {
    source:    'genoa-engine',
    note:      'computed from exhibit',
    method:    def.id
  };
}

export function mapForm301Fm(exhibit, applicant = {}){
  if (!exhibit || typeof exhibit !== 'object'){
    throw new Error('mapForm301Fm: exhibit is required');
  }
  const filled = [];
  for (const def of FORM_301_FM_FIELDS){
    let value = null;
    let status = 'gap';
    let provenance = null;

    if (def.source === 'genoa-auto'){
      // Operator-typed engineer field wins over Genoa derivation
      // ALWAYS — including for genoa-auto fields with derive() / mapping.
      // The PR #79 schema change (3E fields manual-engineer → genoa-auto
      // with derive() pulling from evidence.asr / faa_oe / tower_compliance)
      // had the side effect of locking out the FilingPackagePanel's
      // localStorage form: when an engineer typed ASR / tower height /
      // FAA determination / painting / lighting in the panel, the values
      // landed in applicant.engineer[def.id] but the genoa-auto branch
      // ignored them and still showed EVIDENCE MISSING.  Now operator
      // input has the same priority on genoa-auto fields as it has on
      // manual-engineer fields: operator-wins, evidence-second.
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
      // Operator-provided value wins over a Genoa suggestion.
      const v = applicant?.engineer?.[def.id];
      if (v !== undefined && v !== null && v !== ''){
        value = v;
        status = 'filled';
        provenance = { source: 'engineer of record', note: 'operator input via workbench' };
      } else if (typeof def.suggest === 'function'){
        // Pre-stage a Genoa-derived candidate.  Engineer must confirm
        // before filing; status='suggested' so the UI flags it distinctly.
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
      // manual-applicant — out of scope; surface as gap.
      status = 'gap';
    }
    filled.push({ ...def, value: value ?? null, status, provenance });
  }

  const summary = {
    total:         filled.length,
    filled:        filled.filter(f => f.status === 'filled').length,
    suggested:     filled.filter(f => f.status === 'suggested').length,
    gaps:          filled.filter(f => f.status === 'gap').length,
    unknown:       filled.filter(f => f.status === 'unknown').length,
    // A 'suggested' value still counts as a required gap because the
    // engineer hasn't confirmed yet; filing-readiness should not flip
    // to true merely because Genoa pre-staged a candidate.
    required_gaps: filled.filter(f => f.required && f.status !== 'filled').length
  };

  const compliance_pass = filled.find(f => f.id === 'compliance-pass')?.value;
  const blockers = exhibit.blockers?.length || 0;
  const filing_ready = summary.required_gaps === 0
    && blockers === 0
    && (compliance_pass === 'PASS' || compliance_pass === 'PASS-via-73.215');

  return {
    form:        FORM_301_FM_META,
    fields:      filled,
    summary,
    filing_ready,
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
