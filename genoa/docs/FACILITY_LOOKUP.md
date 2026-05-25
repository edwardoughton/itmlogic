# Genoa · Facility lookup

Genoa does **not** ingest FCC FM/AM Query data on its own.  It calls
existing read-only sources and normalizes their rows into Genoa's
facility shape.

## Sources (priority order)

1. **`chelstein/zerotrustradio`** — primary.
   - Existing endpoint: `GET /api/broadcast/stations`
   - The `broadcast_stations` table is populated by
     `src/ingest/broadcast.js` from the FCC FM Query
     (`transition.fcc.gov/fcc-bin/fmq`) and AM Query (`/fcc-bin/amq`).
   - Genoa adds the query params:
     - `?facility_id=<id>` — exact match (PR
       [chelstein/zerotrustradio#242](https://github.com/chelstein/zerotrustradio/pull/242)).
     - `?q=<text>`         — case-insensitive callsign / name / city.
   - Configured via `ZERO_TRUST_RADIO_READONLY_URL` (read-only; Genoa
     never writes back).

2. **n8n station/analyze webhook** — optional fallback.
   - Existing workflow: "FCC FM Fetch", "FCC LPFM Fetch", "FCC Station
     Detail Fetch", "Parse FCC Station Detail", "Parse FCC Translator
     Data" (all already in n8n).
   - Webhook path: `/webhook/station/analyze`.
   - Configured via `N8N_BASE_URL` + `N8N_WEBHOOK_SECRET` (passed as
     `x-genoa-secret`).

If neither source is configured, the facility client returns `null`
and the routes / `compute()` emit `FACILITY_LOOKUP_UNAVAILABLE`.

## Routes

```
GET /api/facilities/search?q=KSLX        -> { q, count, source, rows[] }
GET /api/facilities/:id                  -> { facility, source, cached }
```

Each row / facility has the shape:

```
{
  facility_id, call, station_name,
  service:       'FM' | 'AM' | 'LPFM' | 'FX',
  fcc_class,
  frequency,     frequency_unit:  'MHz' | 'kHz',
  erp_kw,        haat_m,
  lat, lon,
  city, state, country_code,
  licensee, status,
  facility_lookup_source: { upstream, endpoint, fetched_at, ... }
}
```

`facility_id`, `call`, and `service` are best-effort: if the upstream
row is missing them, they are `null`.  `erp_kw`, `haat_m`, `lat`, `lon`
are **never fabricated** — when the upstream row lacks them, they stay
`null` and the engine emits `FACILITY_COORDINATES_MISSING` etc. on the
exhibit.

## Cache

Hits are written through to `genoa_facility_cache` (TTL 24h) so subsequent
lookups don't re-hit the upstream.  Falls open when `DATABASE_URL` is
unset.

## Compute integration

`POST /api/exhibits/compute` accepts `inputs.facility_id` directly.  The
service:

1. Resolves the facility (cache → ZTR → n8n).
2. Fills any **missing** fields on `inputs` from the resolved row.
3. **Never overwrites** caller-supplied values.
4. Records the resolved row in `exhibit.facility_metadata.raw` with the
   upstream source noted in `facility_lookup_source`.

Example:

```bash
curl -s http://localhost:8080/api/exhibits/compute \
  -H 'content-type: application/json' \
  -d '{"inputs":{"facility_id":"11282"}}' | jq '.station_inputs'
```

If the upstream is wired up, this returns a fully populated KSLX-FM
exhibit with the engineering numbers driven by the FCC-ingested row.
