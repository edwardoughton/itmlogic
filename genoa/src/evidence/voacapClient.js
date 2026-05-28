// VOACAP advisory sidecar client — STUB.
//
// VOACAP (Voice of America Coverage Analysis Program) is the
// long-standing NTIA/ITS HF propagation prediction tool.  Its outputs
// are useful as an *advisory* second opinion for AM skywave / HF link
// budget context, but never as the basis for any FCC filing math.
//
// REGULATORY POSTURE
//   Filing-controlling AM skywave math remains §73.190 / §73.182(k) /
//   Berry-style closed form (see evidence/berrySkywaveClient.js and
//   engine/am/skywave.js).  Anything this client returns is ADVISORY
//   ONLY and surfaces via the same advisory envelope contract used by
//   evidence/amPhysicsClient.js — i.e. blocks carry
//     { advisory: true, filing_effect: 'none' }
//   and are validated by validatePhysicsEvidence() in
//   types/physicsEvidence.schema.js before they are attached to the
//   exhibit.
//
// LIFECYCLE
//   This module ships as a *stub* — no live HTTP, no FORTRAN call.
//   makeVoacapClient() returns null when VOACAP_SIDECAR_URL is unset
//   so the orchestrator can fail-soft exactly like SOMNEC2D and NEC.
//   When the URL is set, the returned client exposes a stable
//   { health(), runPath() } interface that follows the advisory
//   envelope contract; the live wire-up will be done in a later
//   change once a vendored VOACAP sidecar container is published.

const DEFAULT_TIMEOUT_MS = 60_000;

// Symbolic version tag — bumped when the wire contract changes.
export const VOACAP_CLIENT_STUB_VERSION = '0.0.1-stub';

/**
 * Construct a VOACAP advisory client.
 *
 * @param {object}  [opts]
 * @param {string}  [opts.baseUrl=process.env.VOACAP_SIDECAR_URL]
 * @param {number}  [opts.timeoutMs=60000]
 * @returns {{
 *   baseUrl: string,
 *   stub: true,
 *   version: string,
 *   health: () => Promise<{reachable:boolean, stub:true}>,
 *   runPath: (path:object) => Promise<{
 *     available: false,
 *     status: 'not_run',
 *     advisory: true,
 *     filing_effect: 'none',
 *     engine: 'voacap',
 *     stub: true,
 *     reason: string
 *   }>
 * } | null}
 */
export function makeVoacapClient({
  baseUrl   = process.env.VOACAP_SIDECAR_URL || null,
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}){
  if (!baseUrl) return null;
  // intentionally unused while STUB — kept on the closure so the live
  // implementation can pick it up without changing the call site.
  void timeoutMs;
  return {
    baseUrl,
    stub:    true,
    version: VOACAP_CLIENT_STUB_VERSION,

    /**
     * Stub health probe.  Reports reachable:false with stub:true so
     * the orchestrator knows the client is wired but the live HTTP
     * path has not yet been implemented.  Does NOT make a network
     * call.
     */
    async health(){
      return { reachable: false, stub: true, version: VOACAP_CLIENT_STUB_VERSION };
    },

    /**
     * Stub `/run/path` entry point.  Live wire-up will POST a
     * VOACAP path-method request (TX/RX coordinates, frequencies,
     * months, SSN, antennas) and return propagation predictions.
     * For now this returns an advisory envelope marked not_run with
     * stub:true so callers can attach it as advisory evidence
     * without failing the study.
     *
     * @param {object} path — placeholder spec; ignored by the stub.
     * @returns advisory envelope (see makeVoacapClient JSDoc)
     */
    async runPath(path = {}){
      return advisoryEnvelope({
        available:  false,
        status:     'not_run',
        reason:     'voacapClient is a stub; live HTTP path not yet implemented',
        request:    safePath(path)
      });
    }
  };
}

/**
 * Build the advisory envelope every VOACAP response (live or stub)
 * must conform to.  Centralized so the live implementation cannot
 * accidentally drop the `advisory: true` / `filing_effect: 'none'`
 * invariants — those are the boundary that keeps VOACAP out of
 * filing math.
 */
export function advisoryEnvelope(extra = {}){
  return {
    advisory:      true,
    filing_effect: 'none',
    engine:        'voacap',
    stub:          true,
    ...extra
  };
}

function safePath(p){
  if (!p || typeof p !== 'object') return null;
  // Strip non-serializable / oversized fields defensively.
  try { return JSON.parse(JSON.stringify(p)); }
  catch { return null; }
}

export const VOACAP_PROVENANCE = Object.freeze({
  module:         'src/evidence/voacapClient.js',
  upstream:       'VOACAP (NTIA/ITS HF propagation prediction)',
  status:         'STUB — no live HTTP, no FORTRAN call',
  posture:        'ADVISORY — never substitutes for FCC §73.190 / §73.182(k) skywave math',
  envelope:       'advisory:true + filing_effect:none on every response (live or stub)',
  not_modeled: [
    'Filing-controlling AM skywave field strength — remains §73.190 / Berry-style closed form',
    'Filing-controlling RSS share — remains §73.182(k)',
    'Any FCC allocation / contour math'
  ]
});
