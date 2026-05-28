# Genoa · Sidecar Architecture

**Audience:** consulting engineers and infra reviewers who need to see
how the deterministic engine is isolated from optional services, and
how each sidecar tags its contribution to the exhibit so an FCC
filing reviewer can see which numbers come from `§73.313` and which
come from advisory infrastructure.

## 1. Topology

```
  ┌───────────┐   ┌──────────────────────┐   ┌──────────────────────────────┐
  │ genoa-ui  │ ⇄ │ genoa-api (Express)  │ ⇄ │  genoa-engine (pure JS)      │
  │ Leaflet   │   │ /api/exhibits/*      │   │  curves / fm / am / lpfm /   │
  │ panels    │   │ /api/curves          │   │  translators / haat / geom   │
  └───────────┘   │ /api/validation      │   └──────────────────────────────┘
                  │ /api/readiness       │                ▲
                  └──────────┬───────────┘                │
                             │                            │
                             ▼                            │ pure JSON, no
                  ┌────────────────────────┐              │ shared state
                  │ optional sidecars      │──────────────┘
                  │  · terrain             │
                  │  · measurement         │
                  │  · identity            │
                  └────────────────────────┘
```

The genoa-api is the only Express surface.  The genoa-engine is pure
JS — no Express, no DOM, no AI imports, no network IO.  Sidecars
are independent HTTP services that the API may call; if a sidecar is
unwired or fails, the engine's degraded path runs and a structured
warning lands on the exhibit.

## 2. Three sidecars

### 2.1 genoa-terrain-sidecar

Thin adapter around `chelstein/splat`, `chelstein/itmlogic`, and
`chelstein/ZTRpsITS`.  Exposes `POST /v1/haat` returning per-radial
arc-averaged HAAT from 3–16 km per §73.313.  When wired
(`TERRAIN_BACKEND=splat | itmlogic | ztrpsits`), the engine uses
`arc_averaged_dem` HAAT; when not wired, the sidecar returns 503
`TERRAIN_BACKEND_NOT_WIRED`, the engine emits `SIDECAR_UNAVAILABLE`,
and FM compute continues in `user_flat` HAAT mode with
`CONSTANT_HAAT_ASSUMED`.  Terrain contributions are tagged
`filing_effect: filing_input` because per-radial HAAT directly feeds
§73.313 distances.

### 2.2 genoa-measurement-sidecar

Thin adapter around `chelstein/SigMF` (SDR capture + metadata) and
`chelstein/EAS-Tools` (EAS / SAME header + audio fingerprint).
Exposes `POST /v1/sigmf/parse` and `POST /v1/measurements`.  A record
is `calibrated: true` only when calibration metadata is present;
otherwise the engine emits `SDR_MEASUREMENTS_NOT_CALIBRATED`.
Measurement contributions are tagged `filing_effect: advisory_only`
because §73.313 / §73.333 protected contours are method-derived from
the curves, not measurement-derived.  Field measurements may be
attached as evidence for the engineer of record's narrative but they
do not move the contour line in the exhibit math.

### 2.3 genoa-identity-sidecar

Thin adapter around `chelstein/massdns` (RadioDNS), `chelstein/EAS-Tools`
(EAS / SAME identity and audio fingerprint), and
`chelstein/zerotrustradio` (read-only facility metadata).  Exposes
`POST /v1/identity/resolve`.  Each source's `status` is exactly one of
`confirmed | mismatch | absent | unavailable`; the engine never
converts `absent` or `unavailable` into a confirmation.  Identity
contributions are tagged `filing_effect: advisory_only`.  See
[ADVISORY_EVIDENCE.md](./ADVISORY_EVIDENCE.md) for why this is
structurally enforced.

## 3. The `filing_effect` label

Every sidecar response — and every evidence record an exhibit
attaches — carries a `filing_effect` label.  The label takes exactly
one of three values:

| `filing_effect`     | Meaning                                                                  |
|---------------------|--------------------------------------------------------------------------|
| `filing_input`      | Contributes directly to a §73.x-derived number in the exhibit math.      |
| `advisory_only`     | Useful context for the engineer of record; does not change exhibit math. |
| `audit_only`        | Bookkeeping (version, build signature, replay token); never math.        |

Only `filing_input` evidence can move a field's readiness from
`NEEDS_INPUT` or `EVIDENCE_MISSING` toward `FILLED`.  An exhibit can
be rich with `advisory_only` evidence and still be `NEEDS_INPUT` —
that is the intended posture.  See
[FILING_READINESS.md](./FILING_READINESS.md).

## 4. Failure semantics

Every sidecar emits a structured failure into the exhibit's warning
log instead of throwing.  The recognized warning codes include:

- `SIDECAR_UNAVAILABLE` — sidecar /health failed, timed out, or returned 5xx
- `TERRAIN_NOT_APPLIED` — terrain sidecar reachable but no HAAT returned
- `RADIODNS_VALIDATION_UNAVAILABLE` — massdns unreachable / mass timeout
- `SDR_MEASUREMENTS_NOT_CALIBRATED` — record lacks calibration metadata
- `EAS_FINGERPRINT_ABSENT` — EAS-Tools returned no matching fingerprint

Each warning carries `code`, `severity`, `module`, `hint`, and the
sidecar's `/version` snapshot if available.  These are part of the
exhibit; they survive export to JSON / TXT / GeoJSON and they survive
the replay-token round-trip described in
[REPRODUCIBILITY.md](./REPRODUCIBILITY.md).

## 5. Why a sidecar mesh and not a monolith

1. **Single-responsibility.**  A subprocess crash in SPLAT does not
   take down the API.  An OOM in massdns does not corrupt an FM
   exhibit in flight.
2. **Honest failure modes.**  Each sidecar's `/version` reports which
   upstream tools it can find; the API surfaces this on `/readyz`.
   The exhibit's warning log mirrors that posture.
3. **Independent deployment.**  Sidecars can scale, update, and be
   swapped (SPLAT ↔ itmlogic ↔ ZTRpsITS) without redeploying the
   engine — and without invalidating archived exhibits, because the
   engine signature, curve dataset SHA, and replay token are part of
   the exhibit, not part of the sidecar.
4. **Adapter, not reimplementation.**  The upstream `chelstein/*`
   tools are the trusted reference; sidecars exist only to let those
   tools speak the engine's JSON.

## 6. What lives outside the sidecar mesh

- **Curve datasets** (`data/fcc-curves/<version>/`) — versioned in
  source control, not in a sidecar; the engine reads them directly.
- **Validation suite** — runs against the in-process engine; never
  calls a sidecar.
- **AI narrative** — never reads a sidecar; reads only the
  already-frozen exhibit.

This separation is deliberate.  No sidecar can perturb a §73.x number
that is already on the exhibit, and no sidecar can rewrite the curve
dataset or the validation report.
