// Identity-evidence client.  Talks to the identity sidecar to obtain
// RDS / RadioDNS / EAS-SAME / audio-fingerprint confirmations that the
// signal at the measured location is the licensed station.
//
// Each confirmation is one of: 'confirmed' | 'mismatch' | 'absent' |
// 'unavailable'.  The engine never converts "absent" or "unavailable"
// into a confirmation; those map to RADIODNS_VALIDATION_UNAVAILABLE or
// SIDECAR_UNAVAILABLE warnings.

const DEFAULT_TIMEOUT_MS = 8000;

export function makeIdentityClient({ baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}){
  if (!baseUrl) return null;
  return {
    async health(){
      try {
        const r = await fetch(joinUrl(baseUrl, '/health'), { signal: AbortSignal.timeout(3000) });
        return r.ok;
      } catch { return false; }
    },
    async resolve({ call, facility_id, frequency, frequency_unit, gcc, pi }){
      try {
        const r = await fetch(joinUrl(baseUrl, '/v1/identity/resolve'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ call, facility_id, frequency, frequency_unit, gcc, pi }),
          signal: AbortSignal.timeout(timeoutMs)
        });
        if (!r.ok) throw new Error(`identity sidecar HTTP ${r.status}`);
        return await r.json();
      } catch (e){
        return {
          available:      false,
          sources:        [],
          confirmations:  [],
          error:          String(e.message)
        };
      }
    }
  };
}

function joinUrl(base, suffix){
  if (base.endsWith('/')) base = base.slice(0, -1);
  if (!suffix.startsWith('/')) suffix = '/' + suffix;
  return base + suffix;
}
