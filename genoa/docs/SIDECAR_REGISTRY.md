# Genoa Sidecar Registry

Public-facing one-pager describing every sidecar Genoa knows about, its
role, and whether its output influences a filing-controlling number.

## What is a sidecar?

A sidecar is an out-of-process HTTP service that Genoa probes over the
network — never bundled in the same image. Sidecars are **optional**
unless explicitly flagged otherwise: a sidecar that is not configured
must not break exhibit generation, only narrow what Genoa can claim.

Every sidecar exposes the common contract:

```
GET /health   -> 200 "ok"
GET /version  -> { sidecar, upstream_tools }
```

Live status is surfaced at `GET /readyz`, which annotates each entry
with `role` and `filing_effect` from the registry below.

## Roles

| role              | meaning                                                           |
|-------------------|-------------------------------------------------------------------|
| fcc               | FCC-authored / FCC-data reference engine                          |
| reference_engine  | Vendored reference engine (parity, fallbacks)                     |
| advisory_physics  | Physics solver attached as evidence only                          |
| environmental     | Environmental / geospatial evidence dataset                       |
| identity          | Station-identity / RadioDNS / EAS lookups                         |
| rendering         | Exhibit page rendering (headless browser)                         |
| observability     | Measurement / telemetry collection                                |

## Filing effect

| filing_effect  | meaning                                                                              |
|----------------|--------------------------------------------------------------------------------------|
| authoritative  | Output feeds §73.* rule math directly (contours, allocation, allotment, NIF, sunrise)|
| none           | Advisory / observability only — cannot move a contour or change an allocation        |

## Registry

| Sidecar         | Env var                       | Role              | Filing effect | Required for           |
|-----------------|-------------------------------|-------------------|---------------|------------------------|
| fortranFcc      | `FORTRAN_FCC_SIDECAR_URL`     | fcc               | authoritative | FM, LPFM, FX, TV       |
| fccam           | `FCCAM_SIDECAR_URL`           | fcc               | authoritative | AM                     |
| sun             | `FCC_SUN_SIDECAR_URL`         | fcc               | authoritative | AM                     |
| fccContours     | `FCC_CONTOURS_URL`            | fcc               | authoritative | All                    |
| fccLms          | `FCC_LMS_URL`                 | fcc               | authoritative | All                    |
| asr             | `ASR_SIDECAR_URL`             | fcc               | authoritative | All                    |
| faaOe           | `FAA_OE_SIDECAR_URL`          | fcc               | authoritative | All                    |
| amPhysics       | `AM_PHYSICS_SIDECAR_URL`      | advisory_physics  | none          | AM                     |
| nec             | `NEC_SIDECAR_URL`             | advisory_physics  | none          | All                    |
| geoRfEvidence   | `GEO_RF_EVIDENCE_SIDECAR_URL` | environmental     | none          | All                    |
| terrain         | `TERRAIN_SIDECAR_URL`         | reference_engine  | authoritative | FM, LPFM, FX, TV       |
| splat           | `SPLAT_SIDECAR_URL`           | reference_engine  | none          | FM, LPFM, FX, TV       |
| identity        | `IDENTITY_SIDECAR_URL`        | identity          | none          | All                    |
| map             | `MAP_SIDECAR_URL`             | rendering         | none          | All                    |
| measurement     | `MEASUREMENT_SIDECAR_URL`     | observability     | none          | —                      |
| population      | `POPULATION_EVIDENCE_URL`     | reference_engine  | authoritative | All                    |
| facility        | `ZTR_BASE_URL`                | reference_engine  | none          | All                    |
| los             | `ZTR_BASE_URL`                | reference_engine  | none          | FM, LPFM, FX, TV       |

## How to read this for a filing

* If the row says `filing_effect = authoritative`, losing that sidecar
  reduces the numerical fidelity of an exhibit. Genoa will degrade the
  affected panel with a structured warning rather than substitute a
  silently weaker number.
* If the row says `filing_effect = none`, the sidecar adds optional
  evidence (e.g., observed-vs-predicted residuals, tree-canopy context,
  station-identity cross-checks). Its absence only narrows the
  evidence the exhibit can cite.

The machine-readable source of truth is `SIDECAR_REGISTRY` exported
from `genoa/src/api/services/sidecars.js`.
