// Build attestation + replay-token signing.
//
// SCOPE
//   For every exhibit the engine produces, attach a signed
//   attestation block proving WHICH build of the engine wrote it,
//   and a replay token that lets a third party reproduce the
//   exhibit byte-for-byte from the inputs + evidence.
//
// SHIPPED FIELDS (exhibit.build_attestation)
//   sha                 immutable git SHA of the build (no 'uncommitted')
//   release_tag         git describe --tags --always --dirty result
//   build_time          UTC ISO8601 stamp from the build container
//   node                node major.minor.patch the engine ran on
//   fingerprint_sha256  SHA-256 of the canonical fingerprint string
//                       (module + version + sha + tag + build_time +
//                        node + schema)
//   signing_key_id      stable identifier for the secret used to sign
//   signature           HMAC-SHA256(fingerprint, BUILD_SIGNING_SECRET)
//   signed_at           UTC ISO8601 stamp at exhibit-render time
//
// REPLAY TOKEN (exhibit.replay_token)
//   base64url(canonical-JSON({
//     v: 1,
//     attestation,                — full block above
//     inputs_sha256,              — canonical-JSON SHA-256 of station inputs
//     evidence_sha256,            — canonical-JSON SHA-256 of evidence inputs
//     exhibit_sha256,             — canonical-JSON SHA-256 of the produced
//                                    exhibit minus pe_certification, exports,
//                                    history, id, build_attestation, replay_token
//                                    (so adding the token doesn't invalidate it)
//     signature                   — HMAC over the canonical-JSON of the rest
//   }))
//
//   Anyone holding BUILD_SIGNING_SECRET can verify both the build
//   attestation AND the replay token via /api/exhibits/verify-build.
//   Without the secret, the token is still useful as an opaque
//   identifier of "exactly this exhibit, exactly this build".

import crypto from 'node:crypto';
import {
  BUILD_SHA, RELEASE_TAG, BUILD_TIME, NODE_VERSION,
  BUILD_FINGERPRINT, BUILD_FINGERPRINT_INPUT,
  ENGINE_MODULE, ENGINE_VERSION
} from './signature.js';

const REPLAY_EXCLUDE_KEYS = new Set([
  'pe_certification',  // signed separately
  'exports',           // mutated per render
  'history',           // not part of engineering content
  'id',                // assigned by save endpoint
  'build_attestation', // self-reference avoidance
  'replay_token'       // self-reference avoidance
]);

function getSecret(){
  const s = process.env.BUILD_SIGNING_SECRET;
  if (!s) return null;
  return Buffer.from(s, 'utf8');
}
function getKeyId(){
  return process.env.BUILD_SIGNING_KEY_ID || 'genoa-build-default';
}

export function canonicalize(value){
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object') return value;
  const out = {};
  for (const k of Object.keys(value).sort()){
    out[k] = canonicalize(value[k]);
  }
  return out;
}

function hashCanonical(value){
  const canon = JSON.stringify(canonicalize(value));
  return crypto.createHash('sha256').update(canon, 'utf8').digest('hex');
}

function hmac(input){
  const key = getSecret();
  if (!key) return null;
  return crypto.createHmac('sha256', key).update(input, 'utf8').digest('hex');
}

function b64url(buf){
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

export function buildAttestation(){
  const sig = hmac(BUILD_FINGERPRINT);
  return {
    schema:             'genoa.build_attestation.v1',
    module:             ENGINE_MODULE,
    version:            ENGINE_VERSION,
    sha:                BUILD_SHA,
    release_tag:        RELEASE_TAG,
    build_time:         BUILD_TIME,
    node:               NODE_VERSION,
    fingerprint_sha256: BUILD_FINGERPRINT,
    fingerprint_inputs: BUILD_FINGERPRINT_INPUT.split('\n'),
    signing_key_id:     getKeyId(),
    signature:          sig,
    signature_algorithm: sig ? 'HMAC-SHA256' : null,
    signed_at:          new Date().toISOString(),
    notes: sig
      ? 'Verify via POST /api/exhibits/verify-build with the exhibit body.'
      : 'BUILD_SIGNING_SECRET is not set on this deploy; signature is null and the attestation is informational only.'
  };
}

export function buildReplayToken(exhibit, { inputs, evidence } = {}){
  const exhibit_sha256  = computeReplayExhibitHash(exhibit);
  const inputs_sha256   = inputs   ? hashCanonical(inputs)   : null;
  const evidence_sha256 = evidence ? hashCanonical(evidence) : null;
  const attestation     = exhibit?.build_attestation || buildAttestation();
  const payload = {
    v:              1,
    attestation,
    inputs_sha256,
    evidence_sha256,
    exhibit_sha256
  };
  const canon = JSON.stringify(canonicalize(payload));
  const sig   = hmac(canon);
  const signed = { ...payload, signature: sig, signature_algorithm: sig ? 'HMAC-SHA256' : null };
  const token = b64url(JSON.stringify(canonicalize(signed)));
  return {
    token,
    exhibit_sha256,
    inputs_sha256,
    evidence_sha256,
    signature: sig
  };
}

export function computeReplayExhibitHash(exhibit){
  if (!exhibit || typeof exhibit !== 'object'){
    throw new Error('computeReplayExhibitHash: exhibit is required');
  }
  const filtered = {};
  for (const k of Object.keys(exhibit)){
    if (REPLAY_EXCLUDE_KEYS.has(k)) continue;
    filtered[k] = exhibit[k];
  }
  return hashCanonical(filtered);
}

export function verifyAttestation(attestation){
  if (!attestation || typeof attestation !== 'object'){
    return { ok: false, reason: 'no attestation' };
  }
  if (!attestation.signature){
    return { ok: false, reason: 'unsigned (BUILD_SIGNING_SECRET was not set when the exhibit was rendered)' };
  }
  const inputStr = Array.isArray(attestation.fingerprint_inputs)
    ? attestation.fingerprint_inputs.join('\n')
    : null;
  if (!inputStr){
    return { ok: false, reason: 'fingerprint_inputs missing' };
  }
  const recomputedFingerprint = crypto.createHash('sha256').update(inputStr, 'utf8').digest('hex');
  if (recomputedFingerprint !== attestation.fingerprint_sha256){
    return {
      ok: false,
      reason: 'fingerprint_sha256 mismatch (claimed ' + attestation.fingerprint_sha256 + ', recomputed ' + recomputedFingerprint + ')'
    };
  }
  // Both sign and verify HMAC the fingerprint hash, not the input
  // string — keeps the signed payload short and stable.
  const expected = hmac(recomputedFingerprint);
  if (!expected){
    return { ok: false, reason: 'BUILD_SIGNING_SECRET not configured on verifier; cannot recompute HMAC' };
  }
  const a = Buffer.from(attestation.signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)){
    return { ok: false, reason: 'HMAC mismatch (different signing key, tampered fingerprint, or wrong build)' };
  }
  return {
    ok:                  true,
    sha:                 attestation.sha,
    release_tag:         attestation.release_tag,
    build_time:          attestation.build_time,
    fingerprint_sha256:  attestation.fingerprint_sha256,
    signing_key_id:      attestation.signing_key_id
  };
}

export function verifyReplayToken(token){
  let decoded;
  try {
    const padded = token.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - token.length % 4) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    decoded = JSON.parse(json);
  } catch (e){
    return { ok: false, reason: 'invalid token encoding: ' + (e.message || e) };
  }
  if (!decoded || decoded.v !== 1){
    return { ok: false, reason: 'unsupported token version' };
  }
  const sig = decoded.signature;
  const { signature, signature_algorithm, ...rest } = decoded;
  const canon = JSON.stringify(canonicalize(rest));
  const expected = hmac(canon);
  if (!expected){
    return { ok: false, reason: 'BUILD_SIGNING_SECRET not configured on verifier; cannot recompute HMAC' };
  }
  if (!sig){
    return { ok: false, reason: 'token has no signature' };
  }
  const a = Buffer.from(sig, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)){
    return { ok: false, reason: 'HMAC mismatch' };
  }
  const attResult = verifyAttestation(decoded.attestation);
  if (!attResult.ok){
    return { ok: false, reason: 'embedded attestation: ' + attResult.reason };
  }
  return {
    ok:                 true,
    attestation:        decoded.attestation,
    inputs_sha256:      decoded.inputs_sha256,
    evidence_sha256:    decoded.evidence_sha256,
    exhibit_sha256:     decoded.exhibit_sha256
  };
}
