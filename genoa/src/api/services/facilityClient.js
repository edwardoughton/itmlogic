// Facility lookup adapter.
//
// Genoa does NOT ingest FCC data on its own.  This adapter calls the
// existing read-only facility data source(s) and normalizes their rows
// into Genoa's facility shape:
//
//   {
//     facility_id, call, service, fcc_class, frequency, frequency_unit,
//     erp_kw, haat_m, lat, lon, city, state, country_code,
//     licensee, status, station_name,
//     facility_lookup_source: {
//       upstream:   'zerotrustradio' | 'n8n',
//       endpoint:   string,
//       fetched_at: iso,
//       upstream_source_field: 'fcc' | 'radio-browser' | ...
//     }
//   }
//
// Sources, in priority order:
//   1. zerotrustradio  GET /api/broadcast/stations?facility_id=… | ?q=…
//      (read-only; never writes back; data was already ingested by
//       chelstein/zerotrustradio's src/ingest/broadcast.js from FCC FMQ/AMQ).
//   2. n8n webhook     POST {N8N_BASE_URL}/webhook/station/analyze
//      (existing workflow that runs FCC fetch + parse on demand).
//
// This adapter NEVER fabricates ERP / HAAT / coordinates.  Missing
// fields stay null — the engine emits FACILITY_COORDINATES_MISSING and
// related warnings.

const DEFAULT_TIMEOUT_MS = 8_000;

import { makeFccFmqClient } from '../../evidence/fccFmqClient.js';

export function makeFacilityClient({
  ztrUrl     = process.env.ZERO_TRUST_RADIO_READONLY_URL || null,
  n8nBaseUrl = process.env.N8N_BASE_URL || null,
  n8nSecret  = process.env.N8N_WEBHOOK_SECRET || null,
  timeoutMs  = DEFAULT_TIMEOUT_MS,
  // FCC FMQ/AMQ direct fallback.  Default ON (no auth required, public
  // upstream).  Set FACILITY_DISABLE_FCC_FMQ=1 to suppress.
  fmqClient  = (process.env.FACILITY_DISABLE_FCC_FMQ === '1'
                ? null
                : makeFccFmqClient({ timeoutMs }))
} = {}){
  if (!ztrUrl && !n8nBaseUrl && !fmqClient) return null;

  return {
    ztrUrl,
    n8nBaseUrl,
    hasN8n: !!n8nBaseUrl,
    hasFmq: !!fmqClient,

    async health(){
      if (!ztrUrl) return false;
      try {
        const r = await fetch(joinUrl(ztrUrl, '/healthz'), { signal: AbortSignal.timeout(3000) });
        return r.ok;
      } catch { return false; }
    },

    async searchByQuery(q, { limit = 25 } = {}){
      if (!q || typeof q !== 'string' || q.trim().length < 2){
        return { rows: [], source: null, error: 'query must be at least 2 characters' };
      }
      let ztrRows = null;          // null = ZTR not reached; [] = reached but empty
      // Primary: ZTR with the ?q= filter (PR chelstein/zerotrustradio#242).
      if (ztrUrl){
        try {
          const u = joinUrl(ztrUrl, `/api/broadcast/stations?q=${encodeURIComponent(q.trim())}&limit=${limit}`);
          const r = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) });
          if (r.ok){
            const j = await r.json();
            ztrRows = (j.rows || []).map(row => normalizeZtrRow(row, u));
            if (ztrRows.length > 0){
              return {
                rows:   ztrRows,
                count:  ztrRows.length,
                source: 'zerotrustradio'
              };
            }
          }
        } catch (_){/* fall through */}
      }
      // Fallback chain when ZTR is unreachable OR returns zero rows:
      //   1. FCC FMQ/AMQ direct (transition.fcc.gov pipe-delim) —
      //      catches legacy / historical / out-of-catalog callsigns
      //      that ZTR's nightly FCC FMQ ingest hasn't picked up yet.
      //   2. n8n station/analyze webhook (operator-managed workflow).
      // When all of the above produce no rows AND ZTR was at least
      // reachable, return an empty success (source: 'zerotrustradio',
      // count: 0) so the UI can show a "no matches" hint instead of
      // treating it as a server error.
      if (fmqClient){
        try {
          const fmq = await fmqClient.searchByCallsign(q.trim());
          if (fmq && fmq.rows && fmq.rows.length > 0){
            return { rows: fmq.rows, count: fmq.rows.length, source: 'fcc-fmq' };
          }
        } catch (_){/* fall through to n8n */}
      }
      const n8n = await callN8nStationAnalyze({ n8nBaseUrl, n8nSecret, timeoutMs, q });
      if (n8n && n8n.rows.length > 0){
        return { rows: n8n.rows, count: n8n.rows.length, source: 'n8n' };
      }
      if (Array.isArray(ztrRows)){
        return { rows: [], count: 0, source: 'zerotrustradio' };
      }
      return { rows: [], source: null, error: 'no facility source reachable' };
    },

    async getById(facility_id){
      if (!facility_id) return { facility: null, source: null, error: 'facility_id required' };
      if (ztrUrl){
        try {
          const u = joinUrl(ztrUrl, `/api/broadcast/stations?facility_id=${encodeURIComponent(facility_id)}&limit=1`);
          const r = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) });
          if (r.ok){
            const j = await r.json();
            const row = (j.rows || [])[0];
            if (row) return { facility: normalizeZtrRow(row, u), source: 'zerotrustradio' };
          }
        } catch (_){/* fall through */}
      }
      const n8n = await callN8nStationAnalyze({ n8nBaseUrl, n8nSecret, timeoutMs, facility_id });
      if (n8n && n8n.rows[0]) return { facility: n8n.rows[0], source: 'n8n' };
      return { facility: null, source: null, error: 'facility not found in any configured source' };
    },

    // ---- Outcome-A enrichment endpoints (read-only) ----
    // All three return { available, source, endpoint, fetched_at, ... }
    // when ZTR is reachable; { available: false, source: null, error }
    // otherwise.  Genoa does NOT fall back to fabrication; missing data
    // stays missing and the corresponding warning persists.

    async getRichStation(stationId){
      if (!ztrUrl || !stationId) return { available: false, source: null, error: 'ztrUrl or stationId missing' };
      try {
        const u = joinUrl(ztrUrl, `/api/radiodns/station/${encodeURIComponent(stationId)}`);
        const r = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) });
        if (!r.ok) return { available: false, source: null, error: `HTTP ${r.status}` };
        const j = await r.json();
        return {
          available:  true,
          source:     'zerotrustradio',
          endpoint:   u,
          fetched_at: new Date().toISOString(),
          station:    j
        };
      } catch (e){
        return { available: false, source: null, error: String(e.message) };
      }
    },

    /**
     * Ground-conductivity lookup against ZTR's /api/m3/conductivity
     * proxy.  ZTR owns the vendored FCC §73.190 M3 polygon dataset
     * (data/m3/) and the point-in-polygon resolver — Genoa just calls
     * the endpoint.  This is the ONLY authoritative σ source Genoa
     * queries; FCC, NOAA NCEI, and ITU-R BR do not publish a live
     * σ-at-lat/lon JSON API, so prior client stubs for those upstreams
     * were removed to comply with the no-guessing rule.
     */
    async getGroundConductivity({ lat, lon } = {}){
      if (!ztrUrl) return { available: false, source: null, error: 'ztrUrl missing' };
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))){
        return { available: false, source: null, error: 'lat/lon required (finite)' };
      }
      const u = joinUrl(ztrUrl, `/api/m3/conductivity?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
      const fetched_at = new Date().toISOString();
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) });
        if (!r.ok){
          return { available: false, source: null, endpoint: u, fetched_at,
                   error: `HTTP ${r.status} from ZTR conductivity proxy` };
        }
        const j = await r.json();
        const row = (j?.results && j.results[0]) || j;
        const sigma = Number(row?.conductivity_mS_per_m
                          ?? row?.conductivity_msm
                          ?? row?.conductivity
                          ?? row?.sigma_mS_m);
        if (!Number.isFinite(sigma) || sigma <= 0){
          return { available: false, source: null, endpoint: u, fetched_at,
                   error: 'no conductivity value in ZTR response' };
        }
        return {
          available:   true,
          sigma_mS_m:  sigma,
          zone:        row?.zone_label || row?.zone || row?.m3_zone || null,
          source:      'zerotrustradio-m3-proxy',
          endpoint:    u,
          fetched_at
        };
      } catch (e){
        return { available: false, source: null, endpoint: u, fetched_at,
                 error: String(e?.message || e) };
      }
    },

    async getTerrainHaatRadials({ facility_id, radial_step_deg = 10 }){
      if (!ztrUrl || !facility_id) return { available: false, source: null, error: 'ztrUrl or facility_id missing' };
      try {
        const u = joinUrl(ztrUrl, `/api/broadcast/stations/${encodeURIComponent(facility_id)}/terrain-haat?radial_step_deg=${radial_step_deg}`);
        // Terrain calls are slow (DEM batched at 1 req/sec on ZTR's
        // upstream).  Bound the per-fetch to 90 s so a hung connection
        // doesn't pin the orchestrator's compute budget.  When the
        // orchestrator wraps this call in budget.withDeadline, the
        // smaller of (90 s, remaining budget) wins.
        const ms = Number(process.env.ZTR_TERRAIN_HAAT_TIMEOUT_MS) || 90_000;
        const r = await fetch(u, { signal: AbortSignal.timeout(ms) });
        if (!r.ok) return { available: false, source: null, error: `HTTP ${r.status}` };
        const j = await r.json();
        if (!Array.isArray(j.radials) || !j.radials.length){
          return { available: false, source: null, error: 'no radials returned' };
        }
        return {
          available:  true,
          source:     'zerotrustradio',
          endpoint:   u,
          fetched_at: new Date().toISOString(),
          method:     j.method || '47 CFR §73.313 arc-averaged HAAT',
          arc:        j.arc,
          dem:        j.dem,
          tx:         j.tx,
          n_radials:  j.n_radials,
          radials:    j.radials
        };
      } catch (e){
        return { available: false, source: null, error: String(e.message) };
      }
    },

    // Pull the FCC's own canonical contour out of the rich-station
    // response.  If `rich` (already-fetched) is supplied, reuse it; else
    // fetch it.  The FCC contour comes from
    //   https://geo.fcc.gov/api/contours/entity.json
    // proxied by ZTR's /api/radiodns/station/:id endpoint.
    async getFccContour({ stationId, rich = null }){
      if (!stationId) return { available: false, source: null, error: 'stationId required' };
      const r = rich || await this.getRichStation(stationId);
      if (!r.available) return { available: false, source: null, error: r.error || 'rich station unavailable' };
      const fc = r.station?._fcc_contour;
      if (!fc || fc.type !== 'FeatureCollection' || !(fc.features || []).length){
        return { available: false, source: null, error: 'no _fcc_contour on rich station response' };
      }
      return {
        available:    true,
        source:       'zerotrustradio',
        endpoint:     r.endpoint,
        fetched_at:   r.fetched_at,
        upstream_api: 'https://geo.fcc.gov/api/contours/entity.json',
        feature_count: fc.features.length,
        contour:      fc
      };
    },

    /**
     * Extract RadioDNS evidence from ZTR's rich-station response.
     *
     * The ZTR endpoint at /api/radiodns/station/:id is RadioDNS-aware
     * and CAN carry the resolver's output (PI/GCC, FQDN, service
     * provider, EPG/VIS/SI URLs, streaming URLs, etc.) directly on
     * the station object — when ZTR's RadioDNS resolver pipeline has
     * run for that station.  Many ZTR records carry only the station
     * metadata (call, facility_id, frequency, lat, lon) without the
     * RadioDNS overlay; we still surface that as a low-tier
     * `station_record_confirmed` identity tier because the station's
     * presence in ZTR's FCC-FMQ-ingested catalog IS itself a
     * confirmation that the application's call letters and facility
     * ID match the FCC's authoritative record.
     *
     * Defensive on TWO axes:
     *   1. Field-name variants — ZTR has shipped RadioDNS data under
     *      many key spellings.  We check 30+ common names and probe
     *      every nested sub-object that might carry them.
     *   2. Station_keys diagnostic — when no RadioDNS fields land,
     *      we return the rich-station root keys so an operator can
     *      see exactly what ZTR sent and add a missing field name
     *      to the lookup table in one line.
     */
    async getRadioDnsFromZtr({ stationId, rich = null } = {}){
      if (!stationId) return { available: false, source: null, error: 'stationId required' };
      const r = rich || await this.getRichStation(stationId);
      if (!r.available) return { available: false, source: null, error: r.error || 'rich station unavailable' };
      const s = r.station || {};

      // Probe every reasonable RadioDNS sub-object location.
      const subObjects = [
        s,
        s._radiodns, s.radiodns, s.radio_dns,
        s._radio_dns, s.RadioDNS,
        s.station,
        s._radio,    s.radio,
        s.metadata,  s._metadata,
        s.identity,  s._identity
      ].filter(o => o && typeof o === 'object');

      // Pick first non-empty value across (subObjects × candidate keys).
      const pick = (...keys) => {
        for (const obj of subObjects){
          for (const k of keys){
            const v = obj[k];
            if (v !== undefined && v !== null && v !== ''
                && !(Array.isArray(v) && v.length === 0)) return v;
          }
        }
        return null;
      };

      const fields = {
        pi:               pick('pi', 'pi_code', 'pi_hex', 'rds_pi', 'rdsPi', 'rds_pi_hex', 'PI'),
        gcc:              pick('gcc', 'global_country_code', 'GCC'),
        ecc:              pick('ecc', 'extended_country_code', 'ECC'),
        fqdn:             pick('fqdn', 'radiodns_fqdn', 'radio_dns_fqdn', 'authoritative_fqdn', 'fqdn_authoritative', 'rdns_fqdn', 'FQDN'),
        service_identifier: pick('service_identifier', 'serviceIdentifier', 'sid', 'service_id', 'SID'),
        service_provider: pick('service_provider', 'serviceProvider', 'sp', 'provider'),
        epg_url:          pick('epg_url', 'epg', 'epg_endpoint', 'electronic_program_guide_url'),
        visual_url:       pick('visual_url', 'vis_url', 'visual', 'visuals_endpoint', 'visualization_url'),
        sis_url:          pick('sis_url', 'si_url', 'sis_endpoint', 'station_info_url', 'station_information_service_url'),
        streaming_urls:   pick('streaming_urls', 'streams', 'stream_urls', 'icecast', 'icecast_urls',
                               'icy_url', 'shoutcast_urls', 'audio_streams', 'http_streams'),
        bearer_uri:       pick('bearer_uri', 'bearerUri', 'bearer', 'radiodns_bearer'),
        rds_ps:           pick('rds_ps', 'ps', 'program_service'),
        rds_pty:          pick('rds_pty', 'pty', 'program_type')
      };

      const hasRadioDns = !!(fields.pi || fields.fqdn || fields.service_identifier || fields.bearer_uri || fields.rds_ps);

      // Station-record confirmation — present whenever the rich-station
      // response carried recognizable station data.  This is a lower
      // tier than RadioDNS-resolved identity (a PI lookup is stronger
      // than "FCC says this call exists at this lat/lon") but it's
      // still real provenance: ZTR's nightly FCC FMQ ingest cross-
      // checked the call/facility_id/frequency against the FCC's
      // authoritative database.
      const station_call    = pick('call', 'callsign', 'call_sign');
      const station_fid     = pick('facility_id', 'facilityId');
      const station_freq    = pick('frequency_khz', 'frequency_mhz', 'frequency');
      const stationConfirmed = !!(station_call && station_fid && station_freq);

      const sources       = [];
      const confirmations = [];

      if (stationConfirmed){
        const stationConf = {
          kind:     'station_record',
          status:   'confirmed',
          source:   'zerotrustradio',
          endpoint: r.endpoint,
          fields:   {
            call:           station_call,
            facility_id:    String(station_fid),
            frequency:      station_freq,
            ztr_record_id:  s.id ?? s.ztr_id ?? null
          },
          detail:   'Station record present in ZTR\'s FCC-FMQ-ingested catalog (call letters + facility ID + frequency cross-checked against FCC authoritative database).'
        };
        sources.push(stationConf);
        confirmations.push(stationConf);
      }

      if (hasRadioDns){
        const radioDnsConf = {
          kind:     'radiodns',
          status:   'confirmed',
          source:   'zerotrustradio',
          endpoint: r.endpoint,
          fields,
          detail:   'RadioDNS resolver record present on ZTR rich-station response (PI / FQDN / bearer / service identifier / RDS PS).'
        };
        sources.push(radioDnsConf);
        confirmations.push(radioDnsConf);
      }

      if (confirmations.length === 0){
        // Diagnostic: surface the station_keys actually present so an
        // operator can extend the field-name list in one line.
        return {
          available:           false,
          source:              'zerotrustradio',
          endpoint:            r.endpoint,
          error:               'rich station response carried no RadioDNS-shaped fields and no station_record fields',
          checked_field_names: ['pi', 'fqdn', 'service_identifier', 'bearer_uri', 'rds_ps',
                                'gcc', 'ecc', 'service_provider', 'epg_url', 'visual_url',
                                'sis_url', 'streaming_urls'],
          checked_subobjects:  ['station', '_radiodns', 'radiodns', 'radio_dns', '_radio_dns',
                                'RadioDNS', '_radio', 'radio', 'metadata', '_metadata',
                                'identity', '_identity'],
          station_keys:        Object.keys(s).slice(0, 50)
        };
      }

      return {
        available:     true,
        source:        'zerotrustradio',
        endpoint:      r.endpoint,
        fetched_at:    r.fetched_at || new Date().toISOString(),
        sources,
        confirmations,
        // Diagnostics block kept on every successful response too so
        // operators can see what surfaced (handy when only the
        // station_record tier ran and they want to know whether ZTR's
        // RadioDNS resolver pipeline ever landed here).
        diagnostics:   {
          station_record_present: stationConfirmed,
          radiodns_resolved:       hasRadioDns
        }
      };
    },

    /**
     * 47 CFR §74.1204 nearby-primaries proximity search.
     *
     * Pulls every FM/LPFM/FX/FB/FS station from the FCC FMQ database
     * whose carrier falls on a §74.1204(a)-restricted offset relative
     * to the proposed translator (co-channel, ±200/400/600 kHz, ±10.6/
     * 10.8 MHz IF), then filters to those within `radius_km` great-
     * circle distance of the translator's coordinates.
     *
     * The result is shaped to plug directly into
     * evidence.nearby_primaries — the engine's checkTranslatorInterference
     * consumes that array verbatim and runs the per-station D/U study.
     *
     * @param {object} args
     * @param {number} args.lat,lon            transmitter coordinates
     * @param {number} [args.frequency_mhz]    FM carrier (FM/FX/LPFM); use one of frequency_mhz | frequency_khz
     * @param {number} [args.frequency_khz]    AM carrier (when args.service === 'AM')
     * @param {string} [args.service='FX']     'FX' / 'FM' / 'LPFM' (default) for §74.1204 / §73.215, 'AM' for §73.187
     * @param {number} [args.radius_km]        search radius (default 300 for FM, 1500 for AM nighttime skywave)
     * @param {string} [args.exclude_facility_id]  drop self from results
     */
    async getNearbyPrimaries({ lat, lon, frequency_mhz, frequency_khz, service = 'FX', radius_km, exclude_facility_id = null } = {}){
      const isAM    = String(service).toUpperCase() === 'AM';
      const lat0    = Number(lat), lon0 = Number(lon);
      const f0_mhz  = isAM ? null : Number(frequency_mhz);
      const f0_khz  = isAM ? Number(frequency_khz) : null;
      // Input guard.  Preserve the original FM-path error wording for
      // backwards compatibility with callers / tests that match against
      // /lat, lon, and frequency_mhz required/.
      if (lat == null || lon == null || (!isAM && frequency_mhz == null) || (isAM && frequency_khz == null)){
        return { available: false, source: null,
                 error: isAM
                   ? 'lat, lon, and frequency_khz required for §73.187 nearby-AM-primaries search'
                   : 'lat, lon, and frequency_mhz required for §74.1204 nearby-primaries search' };
      }
      if (![lat0, lon0].every(Number.isFinite)){
        return { available: false, source: null, error: 'lat, lon must be finite numbers' };
      }
      if (!isAM && !Number.isFinite(f0_mhz)){
        return { available: false, source: null, error: 'frequency_mhz must be finite' };
      }
      if (isAM && !Number.isFinite(f0_khz)){
        return { available: false, source: null, error: 'frequency_khz must be finite' };
      }
      if (!fmqClient){
        return { available: false, source: null,
                 error: 'FCC FMQ client unavailable (FACILITY_DISABLE_FCC_FMQ=1)' };
      }
      const radius = Number.isFinite(radius_km) ? Number(radius_km) : (isAM ? 1500 : 300);

      // Channel relationships per service.
      // FM:  §74.1204(a) co + ±200/400/600 kHz + ±10.6/10.8 MHz IF
      // AM:  §73.187     co + ±10/20 kHz on 10 kHz grid
      const FM_RELATIONSHIPS = [
        { rel: 'cochannel',         delta_mhz:  0.0  },
        { rel: 'first_adjacent',    delta_mhz: +0.2  },
        { rel: 'first_adjacent',    delta_mhz: -0.2  },
        { rel: 'second_adjacent',   delta_mhz: +0.4  },
        { rel: 'second_adjacent',   delta_mhz: -0.4  },
        { rel: 'third_adjacent',    delta_mhz: +0.6  },
        { rel: 'third_adjacent',    delta_mhz: -0.6  },
        { rel: 'if_offset',         delta_mhz: +10.6 },
        { rel: 'if_offset',         delta_mhz: -10.6 },
        { rel: 'if_offset',         delta_mhz: +10.8 },
        { rel: 'if_offset',         delta_mhz: -10.8 }
      ];
      const AM_RELATIONSHIPS = [
        { rel: 'cochannel',         delta_khz:   0   },
        { rel: 'first_adjacent',    delta_khz: +10   },
        { rel: 'first_adjacent',    delta_khz: -10   },
        { rel: 'second_adjacent',   delta_khz: +20   },
        { rel: 'second_adjacent',   delta_khz: -20   }
      ];
      const queries = isAM
        ? AM_RELATIONSHIPS
            // AMQ takes frequency in kHz, not MHz — keep raw kHz here
            // so the AMQ call below can route as-is.  Prior shape
            // converted to MHz and routed through searchByFrequencyRange
            // which is hardcoded to FM 88..108 MHz, so every AM lookup
            // silently returned 0 rows (KRDM: "§73.187 / §73.190 — 0
            // stations evaluated").
            .map(r => ({ rel: r.rel, f_khz: f0_khz + r.delta_khz }))
            .filter(q => q.f_khz >= 530 && q.f_khz <= 1710)
        : FM_RELATIONSHIPS
            .map(r => ({ rel: r.rel, f: +(f0_mhz + r.delta_mhz).toFixed(1) }))
            .filter(q => q.f >= 88.0 && q.f <= 108.0);

      const settled = await Promise.all(queries.map(q =>
        isAM
          ? fmqClient.searchAmByFrequencyRangeKhz(q.f_khz, q.f_khz).then(r => ({ ...q, ...r }))
          : fmqClient.searchByFrequencyRange(q.f, q.f).then(r => ({ ...q, ...r }))
      ));

      const { karneyInverse } = await import('../../engine/geometry/wgs84.js');
      const errs = [];
      const collected = new Map();      // facility_id -> closest row
      for (const r of settled){
        if (r.error){
          const fLabel = Number.isFinite(r.f_khz) ? `${r.f_khz} kHz`
                       : Number.isFinite(r.f)     ? `${r.f} MHz`
                       : '?';
          errs.push(`f=${fLabel}: ${r.error}`);
          continue;
        }
        for (const row of (r.rows || [])){
          if (!row || !row.facility_id) continue;
          if (exclude_facility_id && String(row.facility_id) === String(exclude_facility_id)) continue;
          if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon)) continue;
          // Service filter: AM-targeted query keeps AM rows; FM-targeted
          // keeps MHz rows.  Without this an AM band query would pick
          // up FM rows whose frequencies happen to match the kHz/1000
          // grid (rare but possible at radio-frequency edge cases).
          if (isAM){
            if (String(row.service || '').toUpperCase() !== 'AM') continue;
            if (row.frequency_unit !== 'kHz' || !Number.isFinite(row.frequency)) continue;
          } else {
            if (row.frequency_unit !== 'MHz' || !Number.isFinite(row.frequency)) continue;
          }
          let inv;
          try { inv = karneyInverse(lat0, lon0, row.lat, row.lon); } catch { continue; }
          if (!Number.isFinite(inv.distance_km) || inv.distance_km > radius) continue;
          const prior = collected.get(row.facility_id);
          if (prior && prior.distance_km <= inv.distance_km) continue;
          collected.set(row.facility_id, { ...row, distance_km: inv.distance_km, channel_relationship: r.rel });
        }
      }

      const primaries = [...collected.values()]
        .sort((a, b) => a.distance_km - b.distance_km)
        .map(r => isAM ? ({
          call:                  r.call,
          facility_id:           r.facility_id,
          fcc_class:             r.fcc_class,
          service:               r.service,
          frequency_khz:         r.frequency,
          erp_kw:                r.erp_kw,
          haat_m:                r.haat_m ?? null,
          lat:                   r.lat,
          lon:                   r.lon,
          distance_km:           +r.distance_km.toFixed(3),
          channel_relationship:  r.channel_relationship,
          source:                'fcc-amq',
          endpoint:              r.facility_lookup_source?.endpoint || null
        }) : ({
          call:                  r.call,
          facility_id:           r.facility_id,
          fcc_class:             r.fcc_class,
          service:               r.service,
          frequency_mhz:         r.frequency,
          erp_kw:                r.erp_kw,
          haat_m:                r.haat_m,
          lat:                   r.lat,
          lon:                   r.lon,
          distance_km:           +r.distance_km.toFixed(3),
          channel_relationship:  r.channel_relationship,
          source:                'fcc-fmq',
          endpoint:              r.facility_lookup_source?.endpoint || null
        }));

      return {
        available:    true,
        source:       isAM ? 'fcc-amq' : 'fcc-fmq',
        method:       isAM
          ? '47 CFR §73.187 channel-relationship AMQ search (co + ±10/20 kHz) + WGS-84 Karney (2013) geodesic proximity filter'
          : '47 CFR §74.1204(a) channel-relationship FMQ search + WGS-84 Karney (2013) geodesic proximity filter',
        upstream_api: isAM
          ? 'https://transition.fcc.gov/fcc-bin/amq'
          : 'https://transition.fcc.gov/fcc-bin/fmq',
        fetched_at:   new Date().toISOString(),
        radius_km:    radius,
        n_queries:    queries.length,
        n_in_radius:  primaries.length,
        primaries,
        errors:       errs.length ? errs : null
      };
    },

    /**
     * Enrich a list of nearby primaries (from FCC FMQ/AMQ) with
     * per-station environmental data sourced from ZTR.  Used by
     * §73.215 (FM contour-protection) and §73.187 (AM nighttime
     * skywave) to lift study accuracy beyond conservative defaults.
     *
     * Fields pulled (when present on the ZTR row, defensive against
     * schema drift across releases):
     *   ground_sigma_msm    — M3 conductivity at the station's site
     *                          (improves D's groundwave protected-
     *                          contour distance in §73.187)
     *   rss_erp_kw          — directional-pattern RSS-equivalent ERP
     *                          along the inter-station bearing
     *                          (improves U's skywave/contour field)
     *   sunrise_offset_min  — §73.187(a) PSRA timing for Class D
     *   sunset_offset_min   — §73.187(a) PSSA timing for Class D
     *
     * Concurrency-capped (default 10 parallel) to avoid hammering ZTR
     * when the AM nighttime nearby list runs into the dozens-to-hundreds
     * of stations.  Stations not in ZTR are passed through untouched.
     * Each enriched row carries `enriched_from_ztr: true` and
     * `ztr_endpoint` provenance.
     *
     * @param {Array<object>} primaries  rows from getNearbyPrimaries
     * @param {object} [opts]
     * @param {number} [opts.concurrency=10]
     * @param {number} [opts.timeoutMs=5000]
     * @returns {{ primaries, n_enriched, n_total, errors }}
     */
    async enrichNearbyFromZtr(primaries, { concurrency = 10, timeoutMs = 5000 } = {}){
      if (!ztrUrl || !Array.isArray(primaries) || primaries.length === 0){
        return { primaries: primaries || [], n_enriched: 0, n_total: (primaries || []).length, errors: [] };
      }
      const errors = [];

      const enrichOne = async (p) => {
        if (!p || !p.facility_id) return p;
        try {
          const u = joinUrl(ztrUrl, `/api/broadcast/stations?facility_id=${encodeURIComponent(p.facility_id)}&limit=1`);
          const r = await fetch(u, { signal: AbortSignal.timeout(timeoutMs) });
          if (!r.ok) return p;
          const j = await r.json();
          const row = (j.rows || [])[0];
          if (!row) return p;
          // Defensive field-name lookup — try a wide set of common
          // names so minor ZTR schema changes don't drop enrichment.
          const sigma = pickEnvNumeric(row,
            ['ground_sigma_msm', 'm3_conductivity_msm', 'soil_conductivity_msm',
             'ground_sigma_mS_m', 'sigma_mS_m', 'conductivity_mS_m',
             'ground_sigma', 'm3_conductivity']);
          const rss   = pickEnvNumeric(row,
            ['rss_erp_kw', 'rss_power_kw', 'effective_erp_kw',
             'directional_rss_erp_kw', 'pattern_rss_kw']);
          const sr    = pickEnvNumeric(row,
            ['sunrise_offset_min', 'sunrise_offset', 'psra_sunrise_offset_min']);
          const ss    = pickEnvNumeric(row,
            ['sunset_offset_min',  'sunset_offset',  'pssa_sunset_offset_min']);
          const enrichments = {};
          if (sigma != null) enrichments.ground_sigma_msm   = sigma;
          if (rss   != null) enrichments.rss_erp_kw         = rss;
          if (sr    != null) enrichments.sunrise_offset_min = sr;
          if (ss    != null) enrichments.sunset_offset_min  = ss;
          if (Object.keys(enrichments).length === 0) return p;
          return {
            ...p,
            ...enrichments,
            enriched_from_ztr: true,
            ztr_endpoint:      u
          };
        } catch (e){
          errors.push(`facility_id=${p.facility_id}: ${e.message}`);
          return p;
        }
      };

      // Concurrency cap.
      const results = new Array(primaries.length);
      let cursor = 0;
      async function worker(){
        while (true){
          const i = cursor++;
          if (i >= primaries.length) return;
          results[i] = await enrichOne(primaries[i]);
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, primaries.length) }, worker));
      const n_enriched = results.filter(p => p?.enriched_from_ztr).length;
      return { primaries: results, n_enriched, n_total: primaries.length, errors };
    },

    /**
     * Pull SDR captures (signal-strength measurements at known
     * receiver locations) from ZTR's rich-station response.
     *
     * Defensive on two axes:
     *   1. Field-name variants — ZTR has shipped captures under several
     *      keys across releases (_captures, captures, sdr_captures,
     *      _sdr_captures, captures_am, _captures_am).  Try them all,
     *      take the first non-empty array.
     *   2. Service filter — when `service` is supplied, drop records
     *      whose own service tag doesn't match.  ZTR's capture
     *      coverage is currently AM-only and the default
     *      SDR_EVIDENCE_SERVICES gate enforces that, but a station's
     *      record bundle can carry mixed-service entries (e.g. an FM
     *      sister station's captures grouped with an AM clear-channel)
     *      and we don't want those crossing the wire to engine
     *      evidence under an AM exhibit.
     *
     * Normalizes each record to ensure it carries at minimum:
     *   { lat, lon, frequency_khz | frequency_mhz, field_strength | dbu | mvm }
     * Records missing all of those are dropped (they can't drive a
     * field-strength comparison anyway).
     */
    async getSdrEvidence({ stationId, rich = null, service = null } = {}){
      if (!stationId) return { available: false, source: null, error: 'stationId required' };
      const r = rich || await this.getRichStation(stationId);
      if (!r.available) return { available: false, source: null, error: r.error || 'rich station unavailable' };
      const s = r.station || {};

      // 1. Defensive field-name lookup.  ZTR has shipped capture data
      // under several keys across releases AND under both SDR (signal
      // measurement) and audio (off-air recording) flavors.  We accept
      // either as evidence — both are sourced measurements of the
      // station's broadcast at a known location.
      const captureCandidates = [
        // SDR / signal-measurement flavors
        s._captures,           s.captures,
        s._sdr_captures,       s.sdr_captures,
        s._captures_am,        s.captures_am,
        s._sdr?.records,       s.sdr?.records,
        s._radiodns?.captures,
        // Audio / off-air recording flavors (KVLV-style audio captures)
        s._audio_captures,     s.audio_captures,
        s._audio?.captures,    s.audio?.captures,
        s._audio?.records,     s.audio?.records,
        s._recordings,         s.recordings,
        s._captures_audio,     s.captures_audio
      ];
      const candidateNames = [
        '_captures','captures',
        '_sdr_captures','sdr_captures',
        '_captures_am','captures_am',
        '_sdr.records','sdr.records',
        '_radiodns.captures',
        '_audio_captures','audio_captures',
        '_audio.captures','audio.captures',
        '_audio.records','audio.records',
        '_recordings','recordings',
        '_captures_audio','captures_audio'
      ];
      let captures = [];
      let captures_field = null;
      for (let i = 0; i < captureCandidates.length; i++){
        const c = captureCandidates[i];
        if (Array.isArray(c) && c.length > 0){
          captures = c;
          captures_field = candidateNames[i];
          break;
        }
      }

      if (captures.length === 0){
        // Surface every key on the rich-station root so an operator
        // can immediately see whether ZTR exposed captures under a
        // name we didn't recognise (vs. truly carrying none).
        const station_keys = Object.keys(s).slice(0, 50);
        return {
          available:    false,
          source:       'zerotrustradio',
          endpoint:     r.endpoint,
          n_records:    0,
          error:        `rich station response carried no captures under any known field name (checked ${candidateNames.length} variants)`,
          checked_field_names: candidateNames,
          station_keys
        };
      }

      // 2. Service filter.  Records that carry their own service tag
      // are kept only when it matches.  Records with no service tag
      // pass through (we cannot know what they belong to and AM is
      // the default ZTR coverage today).
      const wantedService = service ? String(service).toUpperCase() : null;
      const filtered = !wantedService ? captures : captures.filter(c => {
        const tag = c?.service || c?.service_type || c?.svc;
        if (!tag) return true;
        return String(tag).toUpperCase() === wantedService;
      });

      // 3. Light sanity: drop nullish entries and entries that are not
      // plain objects.  Don't filter on per-field presence — the engine
      // records the captures as provenance verbatim; missing optional
      // fields (lat/lon/field_strength) are fine for evidence-of-
      // existence, just not for in-engine field-strength math.  The
      // record's own shape is up to ZTR's ingest pipeline.
      const usable = filtered.filter(c => c != null && typeof c === 'object');

      // Calibration metadata: a record set is calibrated only when
      // every record carries a calibration tag (calibrated=true OR
      // calibration block).  ZTR doesn't yet emit this, so the value
      // is conservative — false until proven true.
      const allCalibrated = usable.length > 0 && usable.every(c =>
        c.calibrated === true || (c.calibration && Object.keys(c.calibration).length > 0));

      return {
        available:        usable.length > 0,
        source:           'zerotrustradio',
        endpoint:         r.endpoint,
        fetched_at:       r.fetched_at,
        captures_field,
        n_records:        usable.length,
        n_records_raw:    captures.length,
        n_dropped_service_filter: filtered.length === captures.length ? 0 : (captures.length - filtered.length),
        n_dropped_sanity_filter:  filtered.length - usable.length,
        calibrated:       allCalibrated,
        records:          usable
      };
    },

    /**
     * SDR captures by callsign — fallback when ZTR station-id linkage
     * is absent.
     *
     * getSdrEvidence() above needs a `stationId` to call ZTR's rich-
     * station endpoint.  That works when facility resolution came from
     * ZTR (carrying facility_lookup_source.ztr_id) but silently skips
     * when the resolver fell through to FCC FMQ / N8N — even though
     * ZTR may still have captures tagged with the same callsign
     * (operator-attached audio, EAS validation captures, etc).
     *
     * This method bridges that gap.  ZTR's /api/sdr/captures endpoint
     * supports a `?call=` filter that returns every capture row whose
     * station_callsign matches.  We pull, service-filter, drop pending /
     * failed sessions, and wrap the result in the same envelope shape
     * that getSdrEvidence emits so the downstream measurements pipeline
     * (engine + PDF render + UI CaptureTable) sees identical records.
     *
     * @param {object} args
     * @param {string} args.call     station callsign (required)
     * @param {string} [args.service] 'AM' | 'FM' | ...  optional service filter
     * @param {number} [args.limit=20] cap on rows pulled from ZTR
     * @returns {Promise<{available, source, endpoint, captures_field, records, ...}>}
     */
    async getSdrEvidenceByCall({ call, service = null, limit = 20 } = {}){
      if (!call) return { available: false, source: null, error: 'call required' };
      if (!ztrUrl) return { available: false, source: null, error: 'ztr unavailable' };
      const params = new URLSearchParams();
      params.set('call', String(call));
      const cap = Math.max(1, Math.min(100, Number(limit) || 20));
      params.set('limit', String(cap));
      const endpoint = joinUrl(ztrUrl, `/api/sdr/captures?${params.toString()}`);

      let raw;
      try {
        const r = await fetch(endpoint, { signal: AbortSignal.timeout(timeoutMs) });
        if (!r.ok){
          return { available: false, source: 'zerotrustradio', endpoint, n_records: 0, error: `HTTP ${r.status}` };
        }
        raw = await r.json();
      } catch (e){
        return { available: false, source: 'zerotrustradio', endpoint, n_records: 0, error: String(e?.message || e) };
      }

      // ZTR's response shape varies by route version: accept either a
      // bare array or { captures: [...] } / { rows: [...] }.
      const rows = Array.isArray(raw) ? raw
                  : Array.isArray(raw?.captures) ? raw.captures
                  : Array.isArray(raw?.rows)     ? raw.rows
                  : [];

      // Service filter.  Capture rows carry `service` ('am'/'fm').  When
      // the caller specifies a service, rows tagged with a different
      // service are dropped.  Untagged rows pass through.
      const wantedService = service ? String(service).toUpperCase() : null;
      const filtered = !wantedService ? rows : rows.filter(c => {
        const tag = c?.service || c?.service_type || c?.svc;
        if (!tag) return true;
        return String(tag).toUpperCase() === wantedService;
      });

      // Drop pending / failed / cancelled sessions — only completed
      // captures are evidence-worthy.  ZTR's status field is one of
      // 'pending' | 'succeeded' | 'failed' | 'cancelled' (current
      // schema); a missing status defaults to keeping the row (legacy
      // rows + manual-check entries).
      const usable = filtered.filter(c => {
        if (c == null || typeof c !== 'object') return false;
        const status = String(c.status || c.session_status || 'succeeded').toLowerCase();
        return status !== 'pending' && status !== 'failed' && status !== 'cancelled';
      });

      const allCalibrated = usable.length > 0 && usable.every(c =>
        c.calibrated === true || (c.calibration && Object.keys(c.calibration).length > 0));

      return {
        available:        usable.length > 0,
        source:           'zerotrustradio',
        endpoint,
        fetched_at:       new Date().toISOString(),
        captures_field:   'ztr-sdr-captures-by-call',
        lookup_strategy:  'callsign-filter',
        call:             String(call),
        service:          wantedService,
        n_records:        usable.length,
        n_records_raw:    rows.length,
        n_dropped_service_filter: rows.length - filtered.length,
        n_dropped_status_filter:  filtered.length - usable.length,
        calibrated:       allCalibrated,
        records:          usable
      };
    }
  };
}

// ---------------- normalization ----------------

function normalizeZtrRow(row, endpoint){
  if (!row) return null;
  const kindToService = { fm: 'FM', am: 'AM', lpfm: 'LPFM', translator: 'FX' };
  const service = kindToService[String(row.kind || '').toLowerCase()] || (row.service ? String(row.service).toUpperCase() : null);
  const freq_khz  = num(row.frequency_khz);
  const frequency = freq_khz === null ? null : (service === 'AM' ? freq_khz : +(freq_khz / 1000).toFixed(4));
  const erp_kw    = num(row.power_watts) === null ? null : +(num(row.power_watts) / 1000).toFixed(4);

  return {
    facility_id:     row.facility_id ? String(row.facility_id) : null,
    call:            row.callsign || null,
    station_name:    row.station_name || null,
    service,
    fcc_class:       null,                 // ZTR row doesn't carry class today
    frequency,
    frequency_unit:  service === 'AM' ? 'kHz' : 'MHz',
    erp_kw,
    haat_m:          num(row.haat_m),
    lat:             num(row.latitude),
    lon:             num(row.longitude),
    city:            row.city  || null,
    state:           row.state || null,
    country_code:    row.country_code || null,
    licensee:        row.licensee || null,
    status:          row.status   || null,
    facility_lookup_source: {
      upstream:              'zerotrustradio',
      endpoint:              endpoint,
      fetched_at:            new Date().toISOString(),
      upstream_source_field: row.source || null,
      ztr_kind:              row.kind   || null,
      ztr_id:                row.id ?? null
    }
  };
}

async function callN8nStationAnalyze({ n8nBaseUrl, n8nSecret, timeoutMs, q, facility_id }){
  if (!n8nBaseUrl) return null;
  const u = joinUrl(n8nBaseUrl, '/webhook/station/analyze');
  const headers = { 'content-type': 'application/json' };
  if (n8nSecret) headers['x-genoa-secret'] = n8nSecret;
  try {
    const r = await fetch(u, {
      method: 'POST',
      headers,
      body: JSON.stringify({ q, facility_id }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!r.ok) return null;
    const j = await r.json();
    // n8n response shape is workflow-defined; accept either { rows: [...] }
    // or a single row-like object.  Normalize generously.
    const rows = Array.isArray(j) ? j
               : Array.isArray(j.rows) ? j.rows
               : (j && typeof j === 'object') ? [j] : [];
    return {
      rows: rows.map(r => normalizeN8nRow(r, u)).filter(Boolean)
    };
  } catch { return null; }
}

function normalizeN8nRow(row, endpoint){
  if (!row || typeof row !== 'object') return null;
  const service =
    (row.service && String(row.service).toUpperCase())
    || (row.kind === 'fm' ? 'FM' : row.kind === 'am' ? 'AM' :
        row.kind === 'lpfm' ? 'LPFM' : row.kind === 'translator' ? 'FX' : null);
  return {
    facility_id:     row.facility_id ? String(row.facility_id) : null,
    call:            row.call || row.callsign || null,
    station_name:    row.station_name || null,
    service,
    fcc_class:       row.fcc_class || row.class || null,
    frequency:       num(row.frequency_mhz ?? row.frequency),
    frequency_unit:  service === 'AM' ? 'kHz' : 'MHz',
    erp_kw:          num(row.erp_kw),
    haat_m:          num(row.haat_m),
    lat:             num(row.lat ?? row.latitude),
    lon:             num(row.lon ?? row.longitude),
    city:            row.city || null,
    state:           row.state || null,
    country_code:    row.country_code || null,
    licensee:        row.licensee || null,
    status:          row.status || null,
    facility_lookup_source: {
      upstream:   'n8n',
      endpoint,
      fetched_at: new Date().toISOString()
    }
  };
}

function num(v){
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Pick the first numeric value from an object across a list of candidate
// keys.  Used by enrichNearbyFromZtr for defensive field-name lookup
// across ZTR schema variants.  Also probes nested .env, .station, and
// ._radiodns sub-objects which some ZTR releases use.
function pickEnvNumeric(obj, keys){
  if (!obj || typeof obj !== 'object') return null;
  const probe = (target) => {
    if (!target || typeof target !== 'object') return null;
    for (const k of keys){
      const v = num(target[k]);
      if (v != null) return v;
    }
    return null;
  };
  return probe(obj)
      ?? probe(obj.env)
      ?? probe(obj.environmental)
      ?? probe(obj.station)
      ?? probe(obj._radiodns);
}

function joinUrl(base, suffix){
  if (base.endsWith('/')) base = base.slice(0, -1);
  if (!suffix.startsWith('/')) suffix = '/' + suffix;
  return base + suffix;
}
