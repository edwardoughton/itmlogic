// Build / commit signature.  Resolved at module load.
//
// SCOPE
//   Every exhibit produced by the engine carries
//   exhibit.engine_signature so a saved JSON can be audited later:
//   same engine version + same curve dataset hash + same git hash
//   MUST produce the same numbers.  This module owns the build-time
//   side of that contract.
//
// RESOLUTION ORDER
//   1. /app/.build_sha      (baked into Docker image at build time —
//                            primary path in production)
//   2. process.env.GIT_COMMIT_SHA  (CI / docker-build --build-arg)
//   3. .git/HEAD reading           (local dev)
//   4. 'uncommitted'               (last-resort fallback)
//
//   Same chain for .build_tag (release tag from `git describe
//   --tags --always --dirty`) and .build_time (UTC ISO8601 stamp
//   from the build container).

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const ENGINE_MODULE  = 'genoa-engine';
export const ENGINE_VERSION = '2.0.0';

function readBakedFile(filename){
  for (const candidate of ['/app', '/usr/src/app', __dirname.replace(/\/src\/engine$/, '')]){
    try {
      const p = path.join(candidate, filename);
      if (fs.existsSync(p)){
        const v = fs.readFileSync(p, 'utf8').trim();
        if (v) return v;
      }
    } catch {}
  }
  return null;
}

function readGitHead(){
  try {
    let dir = __dirname;
    for (let i = 0; i < 10; i++){
      const head = path.join(dir, '.git', 'HEAD');
      if (fs.existsSync(head)){
        const ref = fs.readFileSync(head, 'utf8').trim();
        if (ref.startsWith('ref: ')){
          const refPath = path.join(dir, '.git', ref.slice(5).trim());
          if (fs.existsSync(refPath)) return fs.readFileSync(refPath, 'utf8').trim();
        } else {
          return ref;
        }
        return null;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {}
  return null;
}

const _sha  = readBakedFile('.build_sha')  || process.env.GIT_COMMIT_SHA || readGitHead() || 'uncommitted';
const _tag  = readBakedFile('.build_tag')  || process.env.RELEASE_TAG    || 'untagged';
const _time = readBakedFile('.build_time') || process.env.BUILD_TIME     || null;
const _node = process.versions?.node || 'unknown';

// Canonical fingerprint string.  Hashed for the build attestation;
// any drift in any component bumps the fingerprint.  Deliberately
// excludes wall-clock time of the *exhibit* (which would make it
// non-deterministic) — only build_time and stable engine identity
// participate.
const _fingerprintInput = [
  `module=${ENGINE_MODULE}`,
  `version=${ENGINE_VERSION}`,
  `sha=${_sha}`,
  `tag=${_tag}`,
  `build_time=${_time || 'unknown'}`,
  `node=${_node}`,
  `schema=genoa.exhibit.v2`
].join('\n');

const _fingerprint = crypto.createHash('sha256').update(_fingerprintInput, 'utf8').digest('hex');

export const ENGINE_SIGNATURE = Object.freeze({
  module:               ENGINE_MODULE,
  version:              ENGINE_VERSION,
  hash:                 _sha,
  release_tag:          _tag,
  build_time:           _time,
  node:                 _node,
  fingerprint_sha256:   _fingerprint,
  fingerprint_inputs:   _fingerprintInput.split('\n')
});

// Exposed for buildAttestation.js (HMAC over fingerprint, replay token).
export const BUILD_SHA          = _sha;
export const RELEASE_TAG        = _tag;
export const BUILD_TIME         = _time;
export const NODE_VERSION       = _node;
export const BUILD_FINGERPRINT  = _fingerprint;
export const BUILD_FINGERPRINT_INPUT = _fingerprintInput;
