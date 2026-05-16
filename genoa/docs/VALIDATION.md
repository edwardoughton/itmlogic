# Genoa · Validation

Genoa distinguishes three categories of reference data.  Confusing them
is the surest way to ship a "validated" exhibit that has not actually
been validated against anything authoritative.

## 1. Authoritative reference cases

- `authoritative: true`
- `expected_distance_km` (or `expected_contours[]`) drawn directly from
  an authoritative source: FCC OET bulletin, NTIA reference vectors,
  published peer-reviewed comparison.
- `source_note` cites that source.
- **Passing one or more authoritative cases is what clears
  `CURVE_VALIDATION_MISSING`** for filing readiness.
- Lives under `src/engine/validation/referenceCases/`.

## 2. Regression-guard ("smoke") cases

- `authoritative: false`
- `expected_distance_km` is the value the *current* engine + curve
  dataset produce, with a tight tolerance.
- Useful to detect silent engine drift in CI.
- **Cannot clear `CURVE_VALIDATION_MISSING`.**  Tracked separately in
  the validation report as `n_regression_run` / `n_regression_pass`.
- Lives under `src/engine/validation/referenceCases/` alongside (1),
  filtered by the `authoritative` field.

## 3. Real-station demo fixtures

- `authoritative: false`
- Often missing `expected_contours` (the engine emits
  `REFERENCE_EXPECTED_CONTOURS_MISSING`) and / or coordinates (the
  engine emits `FACILITY_COORDINATES_MISSING`).
- Useful as API / UI seed data and as future authoritative-validation
  candidates once independent expected values are obtained.
- Lives under `src/engine/validation/demoStations/`.
- The first one is **KSLX-FM** (`kslx_fm.json`).

## What the validation suite reports

Every `runValidationSuite()` returns:

```
{
  ran_at, curve_version,
  n_cases,                          // total cases on disk
  n_run, n_pass,                    // AUTHORITATIVE cases only — used for scoring
  max_error_km, mean_error_km,      // authoritative cases only
  n_regression_run, n_regression_pass,
  results: [{ case, role, authoritative, status, ... }],
  pass,                             // n_run > 0 && n_pass === n_run
  authoritative_pass,               // === pass; explicit alias
  regression_pass,
  reference_cases_present
}
```

## What clears the blocker

| State                                             | `CURVE_VALIDATION_MISSING`? |
|---------------------------------------------------|------------------------------|
| No reference cases on disk                        | yes (blocker)               |
| Only smoke / regression cases on disk             | yes (blocker)               |
| At least one authoritative case fails             | yes (blocker)               |
| All authoritative cases pass                      | **cleared**                 |

A `filing_candidate` exhibit therefore requires authoritative validation
to have passed.  A non-authoritative pass is good engineering hygiene
but is not enough to file.

## CLI

```bash
# build a sample exhibit, run the validation suite, render narrative,
# write JSON / TXT / GeoJSON to /tmp/genoa-sample/
node scripts/sample-exhibit.js
node scripts/sample-exhibit.js --station kslx
```

The exit codes are:

- `0` — exhibit built and schema-valid
- `1` — runtime error
- `2` — exhibit failed schema validation
- `3` — exhibit missing a required block
