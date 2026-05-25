# Reference validation cases

Each `.json` file in this directory is a single deterministic reference
case for the Genoa engine. Cases are loaded by
`src/engine/validation/runner.js` and exercised against the active FCC
curve dataset (`data/fcc-curves/<version>/`).

A case is **only** counted toward validation if it carries every one of:

- `id`
- `service`             (`FM` | `LPFM` | `FX` | `AM`)
- `mode`                (`50,50` | `50,10` for FM/LPFM/FX)
- `erp_kW`
- `haat_m`              (n/a for AM)
- `target_dBu`          (or `target_mvm` for AM)
- `expected_distance_km`
- `tolerance_km`
- `authoritative`       — boolean; see below
- `source_note`         — a citable reference to the FCC publication,
  reference table, NTIA test vector, or peer-reviewed comparison from
  which the expected distance was taken

## `authoritative` field

- `authoritative: true`  — expected distance is taken verbatim from an
  authoritative source (FCC OET bulletin, NTIA reference vector,
  published peer-reviewed comparison). Passing one or more authoritative
  cases is what clears `CURVE_VALIDATION_MISSING` for filing readiness.
- `authoritative: false` — smoke / engineering rough-check value. The
  case is run by the validation suite (good for catching engine
  regressions in CI) but **does not** clear `CURVE_VALIDATION_MISSING`.
  An exhibit whose validation block contains only non-authoritative
  passes will still fail filing readiness on
  `CURVE_VALIDATION_MISSING`.

Cases with missing `source_note` or `expected_distance_km` are loaded
but **skipped**, and the validation suite reports
`REFERENCE_CASES_MISSING`. This is by design: do not fabricate expected
values, do not back-fit them from the engine itself.

The legacy v0.2 curve dataset shipping with this repo has **not** been
externally validated against an authoritative third-party suite; the
seed cases below are placeholders flagged as such. Replace with cases
from the FCC OET Bulletin or NTIA reference vectors before treating the
output as filing-grade.
