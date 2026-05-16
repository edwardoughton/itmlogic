// Auth routes — POST /auth/login, POST /auth/logout, GET /auth/me.
// Mounted at /api so URLs are /api/auth/*.  Login verifies the
// shared password against AUTH_PASSWORD_HASH (scrypt) and sets a
// signed session cookie; logout clears it; /me reports session state.

import express from 'express';
import crypto from 'node:crypto';
import { newSessionCookie, clearSessionCookie, parseCookies, verifySession, COOKIE_NAME } from '../middleware/auth.js';

const r = express.Router();

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

function verifyPassword(plain){
  const stored = process.env.AUTH_PASSWORD_HASH || '';
  // Format: scrypt$<saltHex>$<hashHex>
  const m = stored.match(/^scrypt\$([0-9a-f]+)\$([0-9a-f]+)$/i);
  if (!m) return false;
  let salt, expected;
  try {
    salt = Buffer.from(m[1], 'hex');
    expected = Buffer.from(m[2], 'hex');
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  let actual;
  try {
    actual = crypto.scryptSync(String(plain || ''), salt, expected.length, SCRYPT_PARAMS);
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

r.post('/auth/login', (req, res) => {
  if (!process.env.AUTH_PASSWORD_HASH || !process.env.AUTH_SESSION_SECRET){
    return res.status(503).json({
      error:  'AUTH_NOT_CONFIGURED',
      detail: 'Server is missing AUTH_PASSWORD_HASH or AUTH_SESSION_SECRET.'
    });
  }
  const password = req.body?.password;
  if (!password || typeof password !== 'string'){
    return res.status(400).json({ error: 'BAD_REQUEST', detail: 'password is required' });
  }
  if (!verifyPassword(password)){
    return res.status(401).json({ error: 'INVALID_CREDENTIALS', detail: 'Wrong password.' });
  }
  res.setHeader('Set-Cookie', newSessionCookie());
  res.json({ ok: true });
});

r.post('/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
});

r.get('/auth/me', (req, res) => {
  if (!process.env.AUTH_PASSWORD_HASH || !process.env.AUTH_SESSION_SECRET){
    return res.status(503).json({ error: 'AUTH_NOT_CONFIGURED' });
  }
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySession(cookies[COOKIE_NAME]);
  if (!session) return res.status(401).json({ error: 'UNAUTHENTICATED' });
  res.json({ ok: true, exp: session.exp });
});

export default r;
