// 47 CFR §73.x — Professional Engineer certification block.
//
// SCOPE
//   Genoa never certifies a filing.  A licensed PE (Professional
//   Engineer) reviews the exhibit and stamps it.  This module owns:
//     1. The canonical-JSON hash of the exhibit (the "what was signed")
//     2. The certification block shape (what gets attached to the exhibit)
//     3. The verify path (recompute the hash, compare)
//
// HASH SCOPE
//   The hash covers the exhibit MINUS the pe_certification block itself
//   (otherwise the act of certifying would invalidate the hash).  The
//   exports / runtime metadata that change between renderings are also
//   excluded so that exporting a JSON copy doesn't invalidate the seal.
//
// STATEMENT
//   The default statement matches the NSPE-recommended language for
//   technical exhibits in regulatory filings.  Per-state language can
//   be supplied via opt.statement; if omitted, the default is used.

import crypto from 'node:crypto';

const HASH_EXCLUDE_KEYS = new Set([
  'pe_certification',     // self
  'exports',              // mutated on every render
  'history',              // not part of engineering content
  'id'                    // assigned by save endpoint, not engineering input
]);

const DEFAULT_STATEMENT =
  'I hereby certify that this engineering exhibit was prepared by me or ' +
  'under my direct supervision, and that I am a duly licensed Professional ' +
  'Engineer in good standing.  The technical analysis, methodology, and ' +
  'conclusions are correct to the best of my knowledge and belief.  The ' +
  'underlying calculations are deterministic and reproducible from the ' +
  'station inputs and evidence package shown herein.';

// Recursively sort object keys to produce a canonical JSON string.
// Arrays preserve order (semantic).  Excluded top-level keys are
// dropped from the input before serializing.
function canonicalize(value){
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object') return value;
  const out = {};
  const keys = Object.keys(value).sort();
  for (const k of keys){
    out[k] = canonicalize(value[k]);
  }
  return out;
}

export function computeExhibitHash(exhibit){
  if (!exhibit || typeof exhibit !== 'object'){
    throw new Error('computeExhibitHash: exhibit is required');
  }
  const filtered = {};
  for (const k of Object.keys(exhibit)){
    if (HASH_EXCLUDE_KEYS.has(k)) continue;
    filtered[k] = exhibit[k];
  }
  const canon = JSON.stringify(canonicalize(filtered));
  return crypto.createHash('sha256').update(canon, 'utf8').digest('hex');
}

function trim(s, max = 200){
  s = String(s ?? '').trim();
  return s.length > max ? s.slice(0, max) : s;
}

// Validate the engineer payload from the request.  Returns the
// normalized engineer object on success, throws on missing/invalid
// fields.  `name`, `license_no`, `license_state` are required; the
// rest are optional.  All string fields are trimmed and length-capped.
export function validateEngineer(eng){
  if (!eng || typeof eng !== 'object'){
    throw new Error('engineer payload is required');
  }
  const name           = trim(eng.name, 120);
  const license_no     = trim(eng.license_no, 60);
  const license_state  = trim(eng.license_state, 4).toUpperCase();
  if (!name)          throw new Error('engineer.name is required');
  if (!license_no)    throw new Error('engineer.license_no is required');
  if (!license_state) throw new Error('engineer.license_state is required');
  return {
    name,
    license_no,
    license_state,
    license_expiration: trim(eng.license_expiration, 32) || null,
    firm:               trim(eng.firm, 120) || null,
    title:              trim(eng.title, 120) || 'Professional Engineer',
    statement:          trim(eng.statement, 2000) || DEFAULT_STATEMENT
  };
}

// Build a certification block ready to attach to the exhibit.  Pure:
// does not mutate `exhibit`.  Returns { pe_certification, exhibit_hash }.
export function buildCertification(exhibit, engineer){
  const valid = validateEngineer(engineer);
  const hash  = computeExhibitHash(exhibit);
  const now   = new Date().toISOString();
  const sigId = `genoa-pe-${crypto.randomBytes(8).toString('hex')}`;
  const pe_certification = {
    certified:        true,
    engineer:         valid,
    signed_at:        now,
    exhibit_sha256:   hash,
    signature_id:     sigId,
    hash_algorithm:   'sha256',
    hash_scope:       'exhibit minus pe_certification, exports, history, id (canonical-JSON, sorted keys)',
    software:         'Genoa FCC Propagation Studio',
    software_version: exhibit?.engine_signature?.version || '2.0.0'
  };
  return { pe_certification, exhibit_hash: hash };
}

// Verify a previously-signed exhibit: recompute the hash with
// pe_certification excluded, compare to stored hash.  Returns
// { ok: true } or { ok: false, error, computed_hash, stored_hash }.
export function verifyCertification(exhibit){
  const cert = exhibit?.pe_certification;
  if (!cert || cert.certified !== true){
    return { ok: false, error: 'NOT_CERTIFIED' };
  }
  const computed = computeExhibitHash(exhibit);
  if (computed !== cert.exhibit_sha256){
    return {
      ok:            false,
      error:         'HASH_MISMATCH',
      detail:        'Exhibit content has changed since certification.',
      computed_hash: computed,
      stored_hash:   cert.exhibit_sha256
    };
  }
  return { ok: true };
}

export const PE_CERTIFICATION_DEFAULT_STATEMENT = DEFAULT_STATEMENT;
