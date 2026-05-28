// FAA airports / heliports client — calls the genoa-faa-airports
// sidecar's /airports/near endpoint.  Used by exhibitService.js to
// fan out the Mullaney KELP 1989 Table 3 "Other Services within 8 km"
// site-survey block.  Sidecar URL comes from AIRPORTS_SIDECAR_URL.

const DEFAULT_TIMEOUT_MS = 8_000;

export function makeAirportsClient({
  baseUrl   = process.env.AIRPORTS_SIDECAR_URL || null,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn   = globalThis.fetch
} = {}){
  const configured = !!baseUrl;

  async function health(){
    if (!configured) return { available: false, source: null, reason: 'AIRPORTS_SIDECAR_URL not set' };
    try {
      const r = await fetchFn(joinUrl(baseUrl, '/healthz'), { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) return { available: false, source: 'genoa-faa-airports-sidecar', http: r.status };
      const j = await r.json();
      return { available: true, source: 'genoa-faa-airports-sidecar', ...j };
    } catch (e){
      return { available: false, source: 'genoa-faa-airports-sidecar', error: String(e?.message || e) };
    }
  }

  /**
   * Query airports / heliports within `radius_nm` of (lat, lon).
   * Returns { available, n, airports: [...] } with each airport
   * carrying ident, type (AP/HP/SP), name, city, state, lat, lon,
   * distance_m, bearing_deg.
   */
  async function getNearby({ lat, lon, radius_nm = 6, limit = 25 } = {}){
    if (!configured){
      return { available: false, source: null, reason: 'AIRPORTS_SIDECAR_URL not set' };
    }
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))){
      return { available: false, source: 'genoa-faa-airports-sidecar', error: 'lat / lon required' };
    }
    try {
      const u = joinUrl(baseUrl,
        `/airports/near?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`
        + `&radius_nm=${encodeURIComponent(radius_nm)}&limit=${encodeURIComponent(limit)}`);
      const r = await fetchFn(u, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok){
        return { available: false, source: 'genoa-faa-airports-sidecar', http: r.status,
                 error: `HTTP ${r.status} from /airports/near` };
      }
      const j = await r.json();
      // Annotate each airport with bearing-from-tx (true degrees) and
      // distance_km so the site-survey table can render Mullaney-style.
      const enriched = (j?.airports || []).map((a) => {
        const aLat = Number(a.latitude_deg ?? a.lat);
        const aLon = Number(a.longitude_deg ?? a.lon);
        return {
          ...a,
          lat:             aLat,
          lon:             aLon,
          bearing_deg:     Number.isFinite(aLat) && Number.isFinite(aLon)
                            ? greatCircleBearing(Number(lat), Number(lon), aLat, aLon) : null,
          distance_km:     Number.isFinite(Number(a.distance_m)) ? Number(a.distance_m) / 1000 : null
        };
      });
      return {
        available: !!j?.available,
        source:    j?.source || 'genoa-faa-airports-sidecar',
        endpoint:  u,
        query:     j?.query || { lat, lon, radius_nm, limit },
        n:         enriched.length,
        airports:  enriched,
        fetched_at: new Date().toISOString()
      };
    } catch (e){
      return { available: false, source: 'genoa-faa-airports-sidecar', error: String(e?.message || e) };
    }
  }

  return { health, getNearby, configured };
}

function joinUrl(base, path){
  return String(base).replace(/\/+$/, '') + (path.startsWith('/') ? path : '/' + path);
}
function greatCircleBearing(lat1, lon1, lat2, lon2){
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const dλ = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}
