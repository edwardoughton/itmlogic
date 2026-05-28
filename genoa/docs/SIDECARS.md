# Genoa · Sidecars

The sidecar layer is **adapters around upstream `chelstein/*` tools**, not
new engines.  Each sidecar exposes a stable HTTP contract to the API and
shells out to a chelstein tool to do the actual work.  Reimplementing
propagation, SDR, or EAS logic inside a sidecar is forbidden by design.

Common contract for every sidecar:

```
GET  /health    -> 200 "ok"               (liveness)
GET  /version   -> { sidecar, upstream_tools }   (audit / debug)
```

Each sidecar's API endpoints live under `/v1/*`.  Sidecars are
**optional**; an unconfigured or failed sidecar must not break FM
compute.  The genoa-api treats every sidecar failure as a structured
warning (`SIDECAR_UNAVAILABLE`, `TERRAIN_NOT_APPLIED`,
`RADIODNS_VALIDATION_UNAVAILABLE`, etc.).

## genoa-terrain-sidecar

Wraps:

- [`chelstein/splat`](https://github.com/chelstein/splat) — terrain-aware
  Longley-Rice contour overlays (binary execution).
- [`chelstein/itmlogic`](https://github.com/chelstein/itmlogic) —
  pure-Python ITM, terrain profiles.
- [`chelstein/ZTRpsITS`](https://github.com/chelstein/ZTRpsITS) — ITS /
  NTIA reference comparisons.

Endpoint:

```
POST /v1/haat
{
  "tx_lat":      37.0902,
  "tx_lon":     -95.7129,
  "tx_amsl_m":   500,
  "radials_deg": [0, 10, 20, ...],
  "from_km":     3,
  "to_km":       16,
  "samples":     27
}
->
{
  "provider": "splat" | "itmlogic" | "ztrpsits",
  "arc":      { "from_km": 3, "to_km": 16, "samples": 27 },
  "haat_per_radial": [
    { "az": 0, "avg_elev_m": ..., "min_elev_m": ..., "max_elev_m": ..., "haat_m": ... },
    ...
  ]
}
```

Set `TERRAIN_BACKEND=splat | itmlogic | ztrpsits` and ensure the upstream
binary / Python module is on PATH; otherwise the sidecar returns 503
`TERRAIN_BACKEND_NOT_WIRED`, the engine emits `SIDECAR_UNAVAILABLE`, and
FM compute proceeds with flat HAAT.

## genoa-measurement-sidecar

Wraps:

- [`chelstein/SigMF`](https://github.com/chelstein/SigMF) — canonical
  SDR capture + metadata schema.
- [`chelstein/EAS-Tools`](https://github.com/chelstein/EAS-Tools) — EAS /
  SAME header decoding + audio fingerprint validation.
- `chelstein/EAS_Listener` — live EAS chain audibility (when added).

Endpoints:

```
POST /v1/sigmf/parse
{ "meta": { ... sigmf-meta JSON ... }, "source": "..." }
-> { available, calibrated, n_records, records: [...] }

POST /v1/measurements
{ "records": [ ... ], "calibrated": bool, "source": "..." }
-> { available, calibrated, n_records, records }
```

Calibration metadata is required for the record to be marked
`calibrated: true`; otherwise the engine emits
`SDR_MEASUREMENTS_NOT_CALIBRATED`.

## genoa-identity-sidecar

Wraps:

- [`chelstein/massdns`](https://github.com/chelstein/massdns) — RadioDNS
  resolution.
- [`chelstein/EAS-Tools`](https://github.com/chelstein/EAS-Tools) — EAS /
  SAME identity, audio fingerprint.
- `chelstein/zerotrustradio` — read-only facility metadata (write access
  is forbidden).

Endpoint:

```
POST /v1/identity/resolve
{ "call": "WBOB-FM", "facility_id": "12345",
  "frequency": 98.7, "frequency_unit": "MHz" }
->
{ "available": bool,
  "requested_at": iso,
  "sources":      [ { kind, status, detail, ... } ],
  "confirmations":[ { kind, status, detail, ... } ] }
```

Each source's `status` is one of:
`confirmed | mismatch | absent | unavailable`.  The engine never
converts `absent` or `unavailable` into a confirmation.

## Why sidecars

Three reasons:

1. **Single-responsibility.**  The genoa-api stays small and the engine
   stays pure.  A subprocess crash in SPLAT does not take down the API.
2. **Honest failure modes.**  Each sidecar's `/version` reports which
   upstream tools it can find; the API surfaces this on `/readyz`.
3. **Independent deployment.**  Sidecars can scale, update, and be
   swapped (e.g. SPLAT → itmlogic → ZTRpsITS) without redeploying the
   engine.

## Why not bake it all into the API

Because Genoa is **adapters around chelstein/*, not a reimplementation**.
The upstream tools are the trusted reference for terrain propagation,
SDR metadata, and EAS-SAME / RadioDNS identity.  The sidecars are how we
let those tools speak the engine's JSON.
