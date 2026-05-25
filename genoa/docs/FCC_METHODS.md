# Genoa · FCC methods

This document records the deterministic FCC methods Genoa implements and
their current implementation status.  It is the engineering-side
counterpart to the curve dataset manifest at
`data/fcc-curves/<version>/manifest.json`.

## FM full-service · 47 CFR §73.313 / §73.333

Status: **implemented** for F(50,50) and F(50,10).

- Engine module:           `src/engine/fm/contour.js`
- Curve datasets:          `data/fcc-curves/v0.2/{f5050,f5010}.json`
- Interpolation:           `linear-log10` along field axis (per HAAT row);
                           `linear-linear` along HAAT axis.
- Pattern:                 non-directional or user-supplied azimuth →
                           relative-field table (linear interpolation
                           in azimuth).
- Inputs guarded by:       `src/engine/fm/rules.js`
- Validation:              authoritative reference cases required to
                           clear `CURVE_VALIDATION_MISSING` (see
                           [`VALIDATION.md`](VALIDATION.md)).

The FCC §73.313 calls for arc-averaged HAAT per radial (3–16 km).  Genoa
supports two HAAT sources:

- `user_flat` — single user-entered HAAT applied to every radial
  (emits `CONSTANT_HAAT_ASSUMED`).
- `arc_averaged_dem` — per-radial HAAT from the terrain sidecar
  (`src/engine/haat/radial.js`); requires the sidecar to be wired against
  `chelstein/splat` or `chelstein/itmlogic`.

## AM groundwave · 47 CFR §73.183 / §73.184

Status: **NOT YET IMPLEMENTED** to filing fidelity.

- Engine module:           `src/engine/am/groundwave.js`
- The reference Sommerfeld–Norton attenuation factor A(p) requires a
  per-(σ, ε, f) family of curves rather than the single normalized A(p)
  approximation shipped in the legacy v0.2 dataset.
- Today the engine emits the unattenuated reference field
  E₀ = 100·√(P_kW) mV/m at 1 km, returns `null` for every contour
  distance, and emits the structured warnings
  `AM_ENGINE_NOT_IMPLEMENTED` and `CURVE_VALIDATION_MISSING`.
- The AM module ships explicitly so AM exhibits round-trip through the
  schema; it must not be confused with a complete groundwave solver.

## LPFM · 47 CFR §73.811

Status: **wrapper implemented**; uses §73.333 F(50,50) for distances.

- Engine module:           `src/engine/lpfm/contour.js`
- ERP guard:               `> 0.1 kW` triggers `FCC_METHOD_MISSING`
                           ("exceeds the §73.811 LP100 ceiling").
- LPFM kept in its own module so future rule changes don't bleed into
  full-service FM.

## FM translators / boosters · 47 CFR §74.1204

Status: **distance-only wrapper implemented**; interference / D-U
analysis NOT YET IMPLEMENTED.

- Engine module:           `src/engine/translators/contour.js`
- ERP guard:               `> 0.25 kW` triggers `FCC_METHOD_MISSING`.
- §74.1204(a) protected-contour thresholds depend on translator class
  and the underlying primary station class; the per-class table is a
  documented next step.
- §74.1204(b) D/U interference analysis is explicitly not implemented:
  the engine emits `FCC_METHOD_MISSING` so translator exhibits cannot be
  silently mistaken for full interference studies.

## Population estimate

Status: **placeholder**.

The engine reports a uniform-density estimate (80 / km²) and emits
`POPULATION_PLACEHOLDER`.  A Census/ACS dispatch via the worker is the
documented next step; until then, no exhibit can clear that warning.

## Real-station fixtures (NOT validation cases)

Genoa ships a small number of real-station demo fixtures under
`src/engine/validation/demoStations/` and matching reference cases under
`src/engine/validation/referenceCases/`.  These are positioned as
**demo / smoke / future-validation candidates**.  The first one is:

- **KSLX-FM, 100.7 MHz, Scottsdale / Phoenix AZ** (Class C, 100 kW,
  HAAT 561 m, facility 11282).  Coordinates intentionally `null` — they
  must be pulled from FCC LMS and not invented.  See the case file at
  `src/engine/validation/referenceCases/kslx_fm_real_station.json`.

KSLX-FM is **not** an authoritative FCC validation case.  It exists to
prove the engine can ingest a real station profile end-to-end.  See
[`VALIDATION.md`](VALIDATION.md) for the authoritative-vs-non rule.
