// POST /api/exhibits/certify             — stamp an exhibit with a PE seal
// POST /api/exhibits/verify-cert         — recompute the hash, confirm the seal
// POST /api/exhibits/verify-build        — verify the build attestation HMAC
// POST /api/exhibits/verify-replay-token — verify the replay token HMAC
//
// All routes are stateless and mounted under the auth gate.

import express from 'express';
import { buildCertification, verifyCertification, validateEngineer } from '../../engine/regulatory/peCertification.js';
import { verifyAttestation, verifyReplayToken } from '../../engine/buildAttestation.js';
import { asyncHandler } from '../middleware/errors.js';

const r = express.Router();

r.post('/exhibits/certify', asyncHandler(async (req, res) => {
  const body = req.body || {};
  const exhibit = body.exhibit;
  const engineer = body.engineer;
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({
      error:  'BAD_REQUEST',
      detail: 'exhibit is required'
    });
  }
  let valid;
  try {
    valid = validateEngineer(engineer);
  } catch (err){
    return res.status(400).json({
      error:  'BAD_REQUEST',
      detail: String(err.message || err)
    });
  }

  const { pe_certification, exhibit_hash } = buildCertification(exhibit, valid);
  const sealed = { ...exhibit, pe_certification };
  res.json({
    exhibit:        sealed,
    exhibit_hash,
    pe_certification
  });
}));

r.post('/exhibits/verify-cert', asyncHandler(async (req, res) => {
  const exhibit = req.body?.exhibit;
  if (!exhibit || typeof exhibit !== 'object'){
    return res.status(400).json({
      error:  'BAD_REQUEST',
      detail: 'exhibit is required'
    });
  }
  const result = verifyCertification(exhibit);
  res.json(result);
}));

// Build attestation verify path.  Recomputes the canonical fingerprint
// from the attestation block's stored inputs, HMACs it with the local
// BUILD_SIGNING_SECRET, and compares constant-time.
r.post('/exhibits/verify-build', asyncHandler(async (req, res) => {
  const att = req.body?.exhibit?.build_attestation || req.body?.attestation || req.body;
  const result = verifyAttestation(att);
  res.json(result);
}));

// Replay-token verify path.  Decodes the base64url-JSON, recomputes
// the inner HMAC, and walks into verifyAttestation for the embedded
// build attestation.
r.post('/exhibits/verify-replay-token', asyncHandler(async (req, res) => {
  const token = req.body?.replay_token || req.body?.exhibit?.replay_token || req.body?.token;
  if (!token || typeof token !== 'string'){
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'replay_token (string) is required' });
  }
  const result = verifyReplayToken(token);
  res.json(result);
}));

export default r;
