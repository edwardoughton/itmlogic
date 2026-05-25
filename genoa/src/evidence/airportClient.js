// Genoa airport client — wraps the genoa-faa-airports sidecar.
//
// Used by the engine/tower compliance path to consult §17.7(c) airport
// proximity instead of trusting an operator-supplied `near_airport`
// boolean.  The sidecar holds OurAirports.com's CSV redistribution of
// FAA NASR + ICAO data, refreshed weekly.
//
// Fail-soft: when AIRPORTS_SIDECAR_URL is unset OR the sidecar is
// unreachable, getAirportsNear() returns
// `{ available: false, source, error, airports: [] }` and the caller
// falls back to the legacy near_airport flag.

const FETCH_TIMEOUT_MS = Number(process.env.AIRPORTS_SIDECAR_TIMEOUT_MS) || 8_000;

export function makeAirportClient(){
  const url = process.env.AIRPORTS_SIDECAR_URL || null;
  if (!url) return null;
  return {
    async getAirportsNear({ lat, lon, radius_nm = 6, limit = 10 } = {}){
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))){
        return { available: false, source: 'airports-client', error: 'lat/lon required', airports: [] };
      }
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
      const u = new URL('/airports/near', url);
      u.searchParams.set('lat', String(lat));
      u.searchParams.set('lon', String(lon));
      u.searchParams.set('radius_nm', String(radius_nm));
      u.searchParams.set('limit', String(limit));
      try {
        const res = await fetch(u.toString(), { signal: ctl.signal });
        if (!res.ok){
          return {
            available: false,
            source:    'airports-sidecar',
            error:     `airports-sidecar HTTP ${res.status}`,
            airports:  []
          };
        }
        const body = await res.json();
        const records = Array.isArray(body.records) ? body.records
                      : Array.isArray(body.airports) ? body.airports
                      : [];
        return {
          available: true,
          source:    body.source || 'airports-sidecar',
          n:         body.n || records.length,
          airports:  records
        };
      } catch (err){
        return {
          available: false,
          source:    'airports-sidecar',
          error:     `airports-sidecar fetch: ${err.message}`,
          airports:  []
        };
      } finally {
        clearTimeout(t);
      }
    }
  };
}
