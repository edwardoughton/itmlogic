// Genoa terrain sidecar client.  HTTP only, optional, fail-soft.
// If TERRAIN_SIDECAR_URL is unset OR the sidecar is unreachable, the
// client returns null and the engine falls back to flat HAAT (with a
// SIDECAR_UNAVAILABLE / TERRAIN_NOT_APPLIED warning).

const DEFAULT_TIMEOUT_MS = 20_000;

export function makeTerrainClient({ baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}){
  if (!baseUrl) return null;
  return {
    async health(){
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      try {
        const r = await fetch(joinUrl(baseUrl, '/health'), { signal: ctrl.signal });
        return r.ok;
      } catch { return false; }
      finally { clearTimeout(t); }
    },
    async haatPerRadial(req){
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const r = await fetch(joinUrl(baseUrl, '/v1/haat'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req),
          signal: ctrl.signal
        });
        if (!r.ok) throw new Error(`terrain sidecar HTTP ${r.status}`);
        return await r.json();
      } finally { clearTimeout(t); }
    },
    baseUrl
  };
}

function joinUrl(base, suffix){
  if (base.endsWith('/')) base = base.slice(0, -1);
  if (!suffix.startsWith('/')) suffix = '/' + suffix;
  return base + suffix;
}
