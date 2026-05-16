// ZTR Line-of-Sight (LOS) profile client.
//
// SCOPE
//   Calls ZTR's /api/los/profile endpoint to obtain a point-to-point
//   line-of-sight profile (terrain elevation along the great-circle
//   path, first-Fresnel-zone clearance test, obstruction summary).
//   Used by the engine for §73.314 / §73.685 LOS verification when
//   the operator supplies a receiver location, AND by the engineering
//   exhibit's "Path Analysis" section for filed point-to-point links.
//
//   ZTR is the SAME upstream the facility / contour clients use — we
//   keep LOS as a separate Genoa-side client so the panel and
//   /readyz probe surface this capability distinctly (you can have
//   ZTR up but LOS broken, or vice versa).
//
// ENDPOINT (ZTR)
//   GET /api/los/profile
//     ?tx_lat=&tx_lon=&rx_lat=&rx_lon=&freq_khz=
//     [&tx_height=30&rx_height=10&points=64]
//
// HEALTH PROBE
//   ZTR's /healthz returns 200 when the Express app is up; we use
//   that as the liveness signal.  Any HTTP response (2xx-4xx) on the
//   /api/los/profile endpoint with a sentinel sample also counts as
//   "host reachable" — falls through to that if /healthz is blocked
//   by a reverse proxy.
//
// PROVENANCE
//   Every successful response carries the upstream URL + timestamp so
//   the engineering exhibit can cite exactly where the LOS profile
//   came from (§73.314 audit trail).

const DEFAULT_TIMEOUT_MS = 8_000;

export function makeLosClient({
  baseUrl   = process.env.LOS_SIDECAR_URL || process.env.ZERO_TRUST_RADIO_READONLY_URL || null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn   = (typeof fetch === 'function' ? fetch : null)
} = {}){
  if (!baseUrl || !fetchFn) return null;

  return {
    baseUrl,

    // Liveness probe used by /readyz.  Hits ZTR's /healthz first;
    // falls through to a probe of /api/los/profile with a sentinel
    // sample (returns 4xx for a missing facility but proves the host
    // is alive).  Any HTTP response is "reachable"; only network /
    // DNS / TLS / timeout failures register as unhealthy.
    async health(){
      const probes = [
        joinUrl(baseUrl, '/healthz'),
        // Sentinel LOS probe: WBOB-FM (synthetic) → KSLX-FM coords on
        // 100.7 MHz.  ZTR returns either a 200 with the profile or a
        // 4xx with a structured error.  Either proves the host alive.
        joinUrl(baseUrl, '/api/los/profile')
          + '?tx_lat=37.0902&tx_lon=-95.7129&rx_lat=33.4484&rx_lon=-112.0740&freq_khz=100700&tx_height=30&rx_height=10&points=16'
      ];
      for (const url of probes){
        try {
          const r = await fetchFn(url, { signal: AbortSignal.timeout(3000) });
          if (r.status >= 200 && r.status < 600) return true;
        } catch { /* try next */ }
      }
      return false;
    },

    /**
     * Fetch a point-to-point LOS profile from ZTR.
     *
     * @param {object} args
     * @param {number} args.tx_lat        Transmitter latitude (deg)
     * @param {number} args.tx_lon        Transmitter longitude (deg)
     * @param {number} args.rx_lat        Receiver latitude (deg)
     * @param {number} args.rx_lon        Receiver longitude (deg)
     * @param {number} args.freq_khz      Path frequency in kHz (drives Fresnel zone radius)
     * @param {number} [args.tx_height_m=30] Tx antenna height AGL (default 30 m)
     * @param {number} [args.rx_height_m=10] Rx antenna height AGL (default 10 m)
     * @param {number} [args.points=64]      Number of profile samples
     */
    async computeProfile({
      tx_lat, tx_lon, rx_lat, rx_lon, freq_khz,
      tx_height_m = 30, rx_height_m = 10, points = 64
    } = {}){
      if (![tx_lat, tx_lon, rx_lat, rx_lon, freq_khz].every(v => Number.isFinite(Number(v)))){
        return { available: false, source: null, error: 'tx_lat / tx_lon / rx_lat / rx_lon / freq_khz required (all numeric)' };
      }
      const params = new URLSearchParams({
        tx_lat: String(tx_lat), tx_lon: String(tx_lon),
        rx_lat: String(rx_lat), rx_lon: String(rx_lon),
        freq_khz: String(freq_khz),
        tx_height: String(tx_height_m),
        rx_height: String(rx_height_m),
        points:    String(points)
      });
      const endpoint = joinUrl(baseUrl, '/api/los/profile') + '?' + params.toString();
      try {
        const r = await fetchFn(endpoint, { signal: AbortSignal.timeout(timeoutMs) });
        if (!r.ok){
          const txt = await r.text().catch(() => '');
          return {
            available: false, source: null, endpoint,
            error: `HTTP ${r.status} from ZTR /api/los/profile${txt ? ' — ' + txt.slice(0, 200) : ''}`
          };
        }
        const j = await r.json();
        return {
          available:    true,
          source:       'zerotrustradio',
          endpoint,
          fetched_at:   new Date().toISOString(),
          // Pass through the full ZTR shape; engine consumers pick the
          // fields they need (line_of_sight bool, fresnel_clearance,
          // obstructions, profile_points).
          profile:      j,
          // Cite-grade summary for the engineering exhibit.
          summary: {
            tx:           { lat: Number(tx_lat), lon: Number(tx_lon), height_m: Number(tx_height_m) },
            rx:           { lat: Number(rx_lat), lon: Number(rx_lon), height_m: Number(rx_height_m) },
            freq_khz:     Number(freq_khz),
            n_points:     Number(points),
            line_of_sight:           j?.line_of_sight ?? null,
            fresnel_clearance_pct:   j?.fresnel_clearance_pct ?? j?.fresnel_clearance ?? null,
            distance_km:             j?.distance_km ?? null,
            n_obstructions:          Array.isArray(j?.obstructions) ? j.obstructions.length : null
          }
        };
      } catch (e){
        return { available: false, source: null, endpoint, error: `ZTR LOS fetch failed: ${e.message}` };
      }
    }
  };
}

function joinUrl(base, suffix){
  if (base.endsWith('/')) base = base.slice(0, -1);
  if (!suffix.startsWith('/')) suffix = '/' + suffix;
  return base + suffix;
}

export const LOS_PROVENANCE = Object.freeze({
  regulation:    '47 CFR §73.314 (FM coverage); §73.685 (TV coverage); §74.x (auxiliary services)',
  upstream:      'chelstein/zerotrustradio /api/los/profile',
  method:        'Point-to-point great-circle path with terrain interpolation; first-Fresnel-zone clearance test',
  license_basis: 'Operator-controlled service; provenance carried in evidence.los.endpoint + fetched_at'
});
