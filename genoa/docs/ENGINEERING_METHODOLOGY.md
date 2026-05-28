# Genoa · Engineering Methodology

**Audience:** an FCC consulting engineer reviewing whether Genoa's
engineering math is defensible.  This document describes the methods
Genoa implements, the assumptions it makes, the warnings it emits when
those assumptions degrade, and the structural reasons the engine cannot
be silently overridden by the narrative layer or the UI.

## 1. Layering

Genoa is built as three concentric layers:

```
Layer 1 — deterministic engine     (FCC methods, curves, geometry)
Layer 2 — scientific evidence      (terrain, SDR, identity, uncertainty)
Layer 3 — AI narrative             (templated text on top of the exhibit)
```

Layer 1 is the source of truth for every engineering number.  Layer 2
adds context but cannot rewrite Layer 1 outputs; if it fails, it emits a
structured warning and Layer 1 proceeds in a documented degraded mode.
Layer 3 is templated text that explains the exhibit; `narrative.ai_used`
is `false`.  No language model writes contour distances, HAAT values,
ERP values, or field-strength interpolations.  These are non-negotiable
invariants; see [SIDECAR_ARCHITECTURE.md](./SIDECAR_ARCHITECTURE.md)
section "Hard rules."

## 2. FM full-service — 47 CFR §73.313 / §73.333

Genoa implements F(50,50) and F(50,10) field-strength curves from the
§73.333 graphs as a tabulated dataset under
`data/fcc-curves/v0.2/{f5050,f5010}.json`.  Interpolation is:

- **`linear-log10` along the field axis** within each HAAT row — i.e.
  log10(distance) is linear in field-strength along a fixed HAAT row.
- **`linear-linear` along the HAAT axis** between adjacent HAAT rows.

Both choices are documented in `data/fcc-curves/v0.2/manifest.json` so
the same dataset version always produces the same interpolated answer.
The §73.313 protected-contour thresholds (60 dBu Class A/B1/B/C series;
70 dBu commercial / city-grade where applicable; 57 dBu / 54 dBu /
40 dBu interference contours) are looked up by station class and
service rather than hard-coded into the engine.

HAAT is the arc-averaged height above average terrain on each radial,
sampled from 3 km to 16 km per §73.313.  Genoa supports two HAAT
sources:

- **`user_flat`** — a single user-entered HAAT is applied to every
  radial.  This is acceptable for engineering review but emits
  `CONSTANT_HAAT_ASSUMED`.  An exhibit produced in this mode is not a
  filing candidate.
- **`arc_averaged_dem`** — per-radial HAAT computed by the terrain
  sidecar (`src/engine/haat/radial.js`).  This is the §73.313-faithful
  path and requires the sidecar to be wired against
  `chelstein/splat`, `chelstein/itmlogic`, or `chelstein/ZTRpsITS`.

Antenna pattern is non-directional unless the operator supplies a
relative-field table; the relative-field is then linearly interpolated
in azimuth.  Pattern data is not synthesized; an exhibit with
`pattern: omni_assumed` cannot clear filing readiness for a directional
licensed facility.

## 3. LPFM — 47 CFR §73.811

LPFM contours use §73.333 F(50,50) with an LP100 ceiling guard at
0.1 kW ERP.  Inputs exceeding the ceiling emit `FCC_METHOD_MISSING`
("exceeds the §73.811 LP100 ceiling") rather than silently producing a
field-strength answer outside the LPFM regime.  LPFM lives in its own
engine module (`src/engine/lpfm/contour.js`) so future rule changes do
not bleed into full-service FM math.

## 4. FM translators / boosters — 47 CFR §74.1204

Translators use the same §73.333 curves to produce protected-contour
distances, with an ERP guard at 0.25 kW.  However:

- §74.1204(a) per-class protected-contour thresholds depend on the
  translator class **and** the underlying primary station class; the
  per-class table is a documented next step.
- §74.1204(b) D/U interference analysis is explicitly **not yet
  implemented**.  The engine emits `FCC_METHOD_MISSING` for any input
  that would require D/U evaluation.  This is deliberate: translator
  exhibits must not be silently mistaken for full interference studies.

## 5. AM groundwave — 47 CFR §73.183 / §73.184

Status: **not yet implemented to filing fidelity.**  The reference
Sommerfeld-Norton attenuation factor A(p) requires a per-(σ, ε, f)
family of curves rather than a single normalized A(p) approximation.
Today the engine emits the unattenuated reference field
E₀ = 100·√(P_kW) mV/m at 1 km, returns `null` for every protected and
interfering contour distance, and emits `AM_ENGINE_NOT_IMPLEMENTED`
plus `CURVE_VALIDATION_MISSING`.  The AM module ships in the schema so
AM exhibits round-trip, but it must not be confused with a complete
groundwave solver.

## 6. Population / coverage demographics

Status: **placeholder.**  The engine reports a uniform-density estimate
at 80 / km² and emits `POPULATION_PLACEHOLDER`.  A
Census/ACS dispatch via the worker is the documented next step; until
that lands, no exhibit can clear that warning.

## 7. Validation discipline

Three classes of reference data exist in the repo, and Genoa is
strict about which one clears the blocker:

1. **Authoritative reference cases** (`authoritative: true`) drawn from
   FCC OET bulletins, NTIA reference vectors, or published peer-reviewed
   comparisons.  Passing one or more authoritative cases is what
   clears `CURVE_VALIDATION_MISSING` for filing readiness.
2. **Regression-guard ("smoke") cases** — current-engine output, tight
   tolerance, useful for CI drift detection.  These **cannot** clear
   `CURVE_VALIDATION_MISSING`.
3. **Real-station demo fixtures** (e.g. KSLX-FM) — useful as API / UI
   seed data and as future authoritative-validation candidates, but
   they are not authoritative until independent expected values are
   obtained.

A `filing_candidate` exhibit requires authoritative validation to have
passed; non-authoritative validation is good engineering hygiene but
not enough to file.  See [FILING_READINESS.md](./FILING_READINESS.md)
and [REPRODUCIBILITY.md](./REPRODUCIBILITY.md).

## 8. Where the engine refuses to guess

The engine will emit a structured warning and (where appropriate)
return `null` rather than fabricate any of the following:

- coordinates not present in the facility record (`FACILITY_COORDINATES_MISSING`)
- pattern data for a directional licensed facility (`omni_assumed`)
- HAAT samples when no terrain sidecar is wired (`CONSTANT_HAAT_ASSUMED`)
- a complete D/U interference analysis under §74.1204(b)
- AM contour distances under §73.183 / §73.184
- population counts beyond the uniform placeholder

These refusals are the engine's audit posture, not bugs.  See
[ADVISORY_EVIDENCE.md](./ADVISORY_EVIDENCE.md) for the parallel
discipline around advisory inputs.
