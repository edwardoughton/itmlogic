// Shared-password session-cookie auth.  HMAC-SHA256 over a JSON
// payload `{iat, exp}`; cookie format is `<b64url(payload)>.<b64url(sig)>`.
// No DB, no session store — the cookie itself is the session.  Verified
// constant-time; expired or tampered tokens return null from verifySession().
//
// Operator service-token bypass: requireAuth ALSO accepts a header-based
// service token on a small allowlist of read-only verification routes
// (see SERVICE_TOKEN_ROUTE_PATTERNS).  This lets the operator curl the
// geodata evidence endpoints from a shell without juggling browser
// cookies.  The bypass is constant-time, supports comma-separated
// rotation, and refuses to authenticate write endpoints — those still
// require a real cookie session.
//
// Required env:
//   AUTH_PASSWORD_HASH            scrypt$<saltHex>$<hashHex>  (login.js owns the verify)
//   AUTH_SESSION_SECRET           hex string, ≥32 bytes recommended
//   AUTH_SESSION_MAX_AGE_SECONDS  default 2592000 (30 days)
//   AUTH_COOKIE_NAME              default 'genoa_session'
//   GENOA_SERVICE_TOKEN           optional; one token or
//                                 comma-separated list (for rotation).
//                                 Presented via `x-service-token: <t>`
//                                 or `Authorization: Bearer <t>`.

import crypto from 'node:crypto';

export const COOKIE_NAME = process.env.AUTH_COOKIE_NAME || 'genoa_session';
const MAX_AGE_S = parseInt(process.env.AUTH_SESSION_MAX_AGE_SECONDS || '2592000', 10);

function getSecret(){
  const s = process.env.AUTH_SESSION_SECRET;
  if (!s) return null;
  return Buffer.from(s, 'utf8');
}

function b64url(buf){
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(s){
  s = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return Buffer.from(s, 'base64');
}

export function signSession(payload){
  const secret = getSecret();
  if (!secret) throw new Error('AUTH_SESSION_SECRET not set');
  const body = b64url(JSON.stringify(payload));
  const sig  = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

export function verifySession(token){
  if (!token || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig  = token.slice(dot + 1);
  const secret = getSecret();
  if (!secret) return null;
  const expectedSig = b64url(crypto.createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(b64urlDecode(body).toString('utf8')); }
  catch { return null; }
  if (typeof payload?.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function parseCookies(header){
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(';')){
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (!k) continue;
    out[k] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

function cookieAttrs(){
  return [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Secure'
  ];
}

export function newSessionCookie(){
  const now = Math.floor(Date.now() / 1000);
  const token = signSession({ iat: now, exp: now + MAX_AGE_S });
  return [`${COOKIE_NAME}=${token}`, `Max-Age=${MAX_AGE_S}`, ...cookieAttrs()].join('; ');
}

export function clearSessionCookie(){
  return [`${COOKIE_NAME}=`, 'Max-Age=0', ...cookieAttrs()].join('; ');
}

// Route patterns that may be authenticated via GENOA_SERVICE_TOKEN
// (header-based) instead of a cookie session.  Kept narrow on purpose:
// only the geodata evidence/manifest endpoints — all read-only.
// requireAuth is mounted under `/api` so req.path here begins at
// `/geodata/...` (no `/api` prefix).
export const SERVICE_TOKEN_ROUTE_PATTERNS = [
  /^\/geodata(\/|$)/
];

export function isServiceTokenRoute(reqPath){
  return SERVICE_TOKEN_ROUTE_PATTERNS.some((rx) => rx.test(reqPath));
}

// Read configured service tokens.  Comma-separated to support
// rotation (deploy new value alongside old, flip clients, drop old).
function readServiceTokens(){
  const raw = process.env.GENOA_SERVICE_TOKEN || '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// Header preference: x-service-token wins over Authorization: Bearer.
// Returns null when neither header is present (so the caller can fall
// through to cookie auth).
export function extractServiceToken(req){
  const explicit = req.headers['x-service-token'];
  if (explicit) return String(explicit).trim();
  const auth = req.headers['authorization'];
  if (auth){
    const m = String(auth).match(/^Bearer\s+(.+)$/i);
    if (m) return m[1].trim();
  }
  return null;
}

// Constant-time compare against each configured token.  Mismatched
// lengths short-circuit before timingSafeEqual to avoid a length-side-
// channel; the overall set scan is still O(N) over configured tokens.
export function verifyServiceToken(presented, tokens){
  if (!presented || !tokens?.length) return false;
  const pres = Buffer.from(presented, 'utf8');
  let ok = false;
  for (const t of tokens){
    const tb = Buffer.from(t, 'utf8');
    if (pres.length !== tb.length) continue;
    if (crypto.timingSafeEqual(pres, tb)) ok = true;
    // Don't break: keep loop length data-independent across the
    // configured set so timing doesn't reveal *which* token matched.
  }
  return ok;
}

export function requireAuth(req, res, next){
  // Service-token branch — tried FIRST on whitelisted read-only
  // routes so operator CLI verification works even if cookie config
  // is mid-rotation.  Falls through to cookie path when no service-
  // token header is presented.
  if (isServiceTokenRoute(req.path)){
    const presented = extractServiceToken(req);
    if (presented){
      const tokens = readServiceTokens();
      if (tokens.length === 0){
        return res.status(503).json({
          error: 'SERVICE_TOKEN_NOT_CONFIGURED',
          detail: 'Server has no GENOA_SERVICE_TOKEN set; service-token auth is disabled.'
        });
      }
      if (!verifyServiceToken(presented, tokens)){
        return res.status(401).json({ error: 'INVALID_SERVICE_TOKEN' });
      }
      req.session = { kind: 'service', auth: 'service_token' };
      return next();
    }
    // No service-token header — fall through to cookie auth below.
  }

  if (!process.env.AUTH_PASSWORD_HASH || !process.env.AUTH_SESSION_SECRET){
    // Fail closed: with auth misconfigured, every request is denied
    // rather than silently allowing through.
    return res.status(503).json({
      error: 'AUTH_NOT_CONFIGURED',
      detail: 'Server is missing AUTH_PASSWORD_HASH or AUTH_SESSION_SECRET; auth gate cannot run.'
    });
  }
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySession(cookies[COOKIE_NAME]);
  if (!session){
    return res.status(401).json({ error: 'UNAUTHENTICATED', detail: 'Login required.' });
  }
  req.session = { kind: 'cookie', auth: 'cookie', ...session };
  next();
}
