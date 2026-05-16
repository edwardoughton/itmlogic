// Build attestation report section.
//
// Shipped on every exhibit immediately before the certification
// section.  Tells the reviewer exactly which build of the engine
// produced this exhibit, the canonical fingerprint hash, the HMAC
// signature, and the signing key ID — so a tampered build cannot
// pass through unnoticed and a PE-reviewed exhibit is reproducible
// from the inputs + the SHA at attestation time.

export function buildBuildAttestationSection(exhibit, options){
  const att = exhibit?.build_attestation;
  if (!att) return null;
  const sha     = att.sha || '—';
  const tag     = att.release_tag || '—';
  const fp      = att.fingerprint_sha256 || '';
  const sig     = att.signature || '';
  const keyId   = att.signing_key_id || '—';
  const buildT  = att.build_time || '—';
  const node    = att.node || '—';
  const algo    = att.signature_algorithm || '—';
  const shaShort = sha.length > 12 ? sha.slice(0, 12) + '…' : sha;

  const rows = [
    ['Engine module',          att.module || 'genoa-engine'],
    ['Engine version',         att.version || '—'],
    ['Build SHA',              sha],
    ['Release tag',            tag],
    ['Build time (UTC)',       buildT],
    ['Node version',           node],
    ['Fingerprint SHA-256',    fp],
    ['Signature',              sig || '(unsigned — BUILD_SIGNING_SECRET not configured)'],
    ['Signature algorithm',    algo],
    ['Signing key ID',         keyId],
    ['Signed at (UTC)',        att.signed_at || '—'],
    ['Replay token',           exhibit?.replay_token
                                  ? `${exhibit.replay_token.slice(0, 32)}… (POST /api/exhibits/verify-replay-token)`
                                  : '(not attached)'],
    ['Replay digest — exhibit',  exhibit?.replay_digest?.exhibit_sha256  || '—'],
    ['Replay digest — inputs',   exhibit?.replay_digest?.inputs_sha256   || '—'],
    ['Replay digest — evidence', exhibit?.replay_digest?.evidence_sha256 || '—']
  ];

  return {
    id:      'build_attestation',
    type:    'paragraphs-with-kv',
    heading: 'BUILD ATTESTATION',
    paragraphs: [
      'This exhibit was produced by Genoa engine ' +
      `${att.version || 'unknown'} at git SHA ${shaShort} (release tag ${tag}, ` +
      `built ${buildT}).  The fingerprint SHA-256 below covers the engine ` +
      'module identity, version, immutable build SHA, release tag, build ' +
      'time, Node runtime version, and exhibit schema; any drift bumps the ' +
      'hash.  The HMAC signature commits the fingerprint under a deploy-' +
      'scoped key, and the replay token additionally commits the exhibit ' +
      'content hash and canonical input/evidence hashes so the exhibit can ' +
      'be reproduced byte-for-byte from those inputs at this build SHA.',

      'Verify the build attestation by POSTing the exhibit (or just the ' +
      'build_attestation block) to /api/exhibits/verify-build.  Verify the ' +
      'replay token by POSTing it to /api/exhibits/verify-replay-token.  ' +
      'Both endpoints require BUILD_SIGNING_SECRET to be configured on the ' +
      'verifier and recompute the HMAC constant-time before reporting ok.'
    ],
    rows
  };
}
