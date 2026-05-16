# ZeroTrustRadio data audit

**Audit date:** 2026-05-03
**Scope:** Decide whether Genoa should reuse `chelstein/zerotrustradio` for terrain / HAAT / curve-validation / population / SDR evidence, or build its own scaffolding (Outcome A vs Outcome B per the phase-2 directive).
**Live target probed:** `https://zerotrustradio-app-vvhi8.ondigitalocean.app`

---

## 1. Existing ZTR endpoints relevant to Genoa

| Method | Path | What it returns | Genoa use |
|---|---|---|---|
| `GET` | `/api/broadcast/stations?facility_id=…` | Single FM/AM/LPFM/translator row from `broadcast_stations` (FCC FMQ/AMQ ingest) | ✅ already in use (PR #21) |
| `GET` | `/api/broadcast/stations?q=…` | Free-text search on call / name / city | ✅ already in use |
| `GET` | `/api/search/callsign?q=…` | Callsign search across spots + broadcasts | available |
| `GET` | `/api/radiodns/station/:id` | **Rich enrichment** — station fields **plus** `_fcc_contour` (live proxy of `geo.fcc.gov/api/contours/entity.json`), `_captures`, `_los`, `_nearest_sdrs`, `_weather`, `_environment` | **NEW reuse path** |
| `GET` | `/api/los/profile` | Two-point line-of-sight profile w/ DEM elevations + Fresnel + clearance % | building-block reuse for terrain |
| `GET` | `/api/sdr/captures?...` | SDR capture sessions list | reusable |
| `GET` | `/api/sdr/captures/:id` | Single capture with measurements + audio link | reusable |
| `GET` | `/api/sdr/stations/search?q=…` | Match station for capture | available |

## 2. Existing ZTR tables / modules relevant to Genoa

| Table / module | Relevant fields / capability |
|---|---|
| `broadcast_stations` | `facility_id`, `callsign`, `service`, `kind`, `frequency_khz`, `latitude`, `longitude`, `power_watts`, `haat_m`, `haat_horiz_m`, `haat_vert_m`, `ground_elevation_m`, `station_class`, `antenna_type`, `erp_horiz_kw`, `erp_vert_kw`, `structure_height_m`, `amsl_m`, `channel`, `last_seen` |
| `src/services/los.js` | `fetchElevations(points[])` via OpenTopoData SRTM30m — point cloud → elevations. Reusable to compute per-radial arc-averaged HAAT around a transmitter. |
| `src/lib/propagation.js` | Quality scoring (ground bonus, HAAT factor) — not a contour solver |
| `src/services/sdr-capture.js` | Full session lifecycle, measurements, S3 audio storage, `searchStations` |
| `src/services/sdr-verdict.js` | Verdict scoring on capture results |
| `src/ingest/broadcast.js` | FCC FMQ / AMQ ingest pipeline — populates `broadcast_stations` |

## 3. Field coverage for facility lookup

KSLX-FM (facility_id 11282) live response at `/api/radiodns/station/757546`:

| Field | Value |
|---|---|
| `callsign` | KSLX-FM |
| `facility_id` | 11282 |
| `service` / `kind` | FM / fm |
| `frequency_khz` | 100700 |
| `latitude / longitude` | 33.33144… / -112.06375 |
| `power_watts` | 100000 |
| `haat_m`, `haat_horiz_m`, `haat_vert_m` | 561 / 561 / 561 |
| `station_class` | C |
| `antenna_type` | ND |
| `erp_horiz_kw`, `erp_vert_kw` | 100 / 100 |
| `structure_height_m`, `amsl_m` | 922 / 922 |
| `channel` | 264 |
| `licensee` | PHOENIX FCC LICENSE SUB, LLC |
| `city` / `state` | SCOTTSDALE / AZ |
| `status` | LIC |
| `last_seen` | 2026-04-12T16:56:14Z (FCC ingest timestamp) |
| `radiodns_supported`, `radiodns_fqdn`, `radiodns_status` | true / `10070.d4eb.da0.fm.radiodns.org` / `resolved` |

**All Genoa engineering inputs except per-radial HAAT are available.**

## 4. Terrain / HAAT data

- ZTR carries **a single HAAT value per station** (`haat_m`, `haat_horiz_m`, `haat_vert_m`) ingested from FCC LMS — sufficient to compute a flat-HAAT contour, but not §73.313 arc-averaged per-radial HAAT.
- ZTR has `services/los.js` with `fetchElevations()` (OpenTopoData SRTM30m) for two-point LOS profiles. The DEM-fetch primitive is in place; only the **arc-averaging at every azimuth** is missing.
- ZTR's `_los` field on `/api/radiodns/station/:id` carries a representative LOS profile, not 36 azimuths.
- **Verdict:** ZTR has the building blocks; per-radial HAAT requires one thin new endpoint that drives `los.fetchElevations()` along a §73.313 arc per azimuth.

## 5. FCC curve validation data

- ZTR has **no** §73.333 / §73.184 reference suite, no `F(50,50)` / `F(50,10)` table validation.
- However, `/api/radiodns/station/:id` returns **`_fcc_contour`** — the FCC's own canonical contour from `geo.fcc.gov/api/contours/entity.json`, with per-feature `field`, `erp`, `curve`, `channel`, `nradial`, `rcamsl`, `elevation_data_source`. KSLX-FM returns 3 `MultiPolygon` features (likely 60 / 54 / 40 dBu).
- **Verdict:** ZTR has the FCC's authoritative contour for the same station. Genoa can validate its deterministic engine output against this (mean-radial agreement within tolerance) and that **clears `CURVE_VALIDATION_MISSING`** with full provenance — without Genoa shipping its own reference suite.

## 6. Population / Census data

- Neither ZTR nor Genoa has population/Census data today.
- **Verdict:** `POPULATION_PLACEHOLDER` stays.  Add `POPULATION_EVIDENCE_URL` env hook so a future Census/ACS sidecar can plug in without Genoa changes.

## 7. SDR / measurement evidence

- ZTR has full SDR capture infrastructure: `/api/sdr/captures*`, measurements + verdict in `sdr-capture.js` + `sdr-verdict.js`, S3-stored audio, station resolution by callsign / lat / lon.
- `/api/radiodns/station/:id` returns `_captures` (recent capture requests for the station id).
- **Verdict:** Genoa pulls `_captures` (or queries `/api/sdr/captures?station_id=`) into the evidence block. `SDR_MEASUREMENTS_MISSING` clears only when there is at least one real capture record with a verdict and timestamp.

## 8. Recommended architecture

```
                ┌────────────────────────────────────────────┐
                │ chelstein/zerotrustradio                   │
                │   · /api/broadcast/stations?facility_id=…  │
                │   · /api/radiodns/station/:id              │
                │       → _fcc_contour (geo.fcc.gov)         │
                │       → _captures                          │
                │       → _los, _nearest_sdrs                │
                │   · /api/los/profile                       │
                │   · NEW: /api/broadcast/stations/:fid/     │
                │           terrain-haat                     │  ← ZTR PR
                └────────────────────────────────────────────┘
                            ▲ read-only adapter
                            │
            ┌───────────────┴────────────────┐
            │ Genoa                          │
            │   src/api/services/            │
            │     facilityClient.js          │  ← extend
            │   src/evidence/terrain/        │
            │     ztrTerrainClient.js        │  ← new
            │   src/evidence/curveValidation/│
            │     ztrFccContourValidator.js  │  ← new
            │   src/evidence/measurements/   │
            │     ztrCapturesClient.js       │  ← new
            └────────────────────────────────┘
```

## 9. Missing pieces (and where they go)

| Missing | Goes where |
|---|---|
| Per-radial §73.313 arc-averaged HAAT | **ZTR** — new thin route `GET /api/broadcast/stations/:facility_id/terrain-haat` reusing `los.fetchElevations()` |
| FM curve validation suite | **Genoa** — but the *implementation* is "compare to FCC's `_fcc_contour` from ZTR", not a re-implementation |
| Population / Census data | **Out of scope** today; env hook only (`POPULATION_EVIDENCE_URL`) |
| Calibrated SDR captures by facility | **ZTR** already has it; Genoa just needs to consume |

## 10. Implementation decision: **Outcome A**

ZTR already owns the heavy infrastructure (facility ingest, FCC contour proxy, SDR captures, DEM-fetch). Genoa will:

1. Read all source data through ZTR.  Never re-ingest.
2. Extend the existing adapter (`src/api/services/facilityClient.js`) to call `/api/radiodns/station/:id` and pull `_fcc_contour` and `_captures`.
3. Add one thin ZTR endpoint for per-radial HAAT (the only true gap), reusing ZTR's DEM-fetch.
4. Compute curve-validation status by **comparing Genoa's deterministic mean radial to FCC's `_fcc_contour` mean radial per contour band**, with explicit tolerance.
5. Stamp every evidence class with `source`, `endpoint`, `fetched_at`, and (where available) a SHA so the exhibit's `facility_metadata` / `evidence` blocks are auditable.
6. Update readiness scoring so each warning/blocker clears **only** when real, sourced evidence is present (no artificial bumps).

---

## Provenance shape (Outcome A)

Every Genoa exhibit produced via the ZTR adapter will carry:

```json
{
  "facility_metadata": {
    "cached":                 true,
    "facility_lookup_source": "zerotrustradio",
    "facility_endpoint":      "/api/broadcast/stations?facility_id=11282",
    "facility_updated_at":    "2026-04-12T16:56:14.271Z",
    "raw":                    { /* normalized facility row */ }
  },
  "evidence": {
    "terrain": {
      "available":  true,
      "source":     "zerotrustradio",
      "endpoint":   "/api/broadcast/stations/11282/terrain-haat",
      "method":     "47 CFR §73.313 arc-averaged HAAT",
      "dem":        "OpenTopoData SRTM30m",
      "profiles":   [ /* one entry per radial */ ]
    },
    "measurements": {
      "available":  true,
      "source":     "zerotrustradio",
      "endpoint":   "/api/sdr/captures?station_id=...",
      "n_records":  3,
      "calibrated": false
    }
  },
  "validation": {
    "runs": [
      { "source": "zerotrustradio", "method": "FCC contour cross-check",
        "endpoint": "/api/radiodns/station/757546",
        "n_authoritative_run": 3, "n_authoritative_pass": 3,
        "max_error_km": 0.6, "authoritative_pass": true,
        "fcc_contour_features": 3 }
    ],
    "reference_cases_present": true
  }
}
```

This is the foundation for the Phase-2 implementation; the ZTR PR adds the one missing endpoint, and the Genoa PR wires everything else without duplicating ZTR data.
