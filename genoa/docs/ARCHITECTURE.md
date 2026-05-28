# Genoa Architecture

## Position

Genoa is the **cloud-native, evidence-aware successor to ComStudy-style RF
planning tools** (RadioSoft ComStudy, V-Soft FMCommander / CONTOUR /
Probe).  Where the legacy tools are desktop / workstation products, Genoa
is browser-based, service-oriented, deployable, automatable via REST and
n8n, evidence-aware, deterministic in its engineering math, and extensible
through sidecar services.

## Hard rules

These are non-negotiable invariants of the system:

1. **The deterministic engine is the source of truth.**  The narrative
   layer, the AI assistant, the UI, and the API may all consume engine
   output.  None of them may modify engine output.
2. **AI may explain.  AI may not calculate.**  The narrative module is
   templated text; `narrative.ai_used` is `false`.
3. **Every engineering number is traceable** to (input, method,
   interpolation, engine module, engine signature, curve dataset version,
   calculation trace, warning status).
4. **Sidecars are optional.**  Missing terrain / measurement / identity
   sidecars must not break FM compute.  Missing sidecars emit
   `SIDECAR_UNAVAILABLE`; they do not throw.
5. **Validation is honest.**  Only authoritative reference cases clear
   `CURVE_VALIDATION_MISSING`.  Smoke / regression-guard cases run for
   CI signal but cannot certify the curve dataset.
6. **Genoa never writes to upstream data sources.**

## Service mesh

| Service                           | Role                                                           |
|-----------------------------------|----------------------------------------------------------------|
| `genoa-ui`                        | Single-page app (Bobby Caldwell aesthetic).                   |
| `genoa-api`                       | Express. Routes for compute / save / list / get / exports / readiness / validation. |
| `genoa-engine`                    | Pure JS module; no Express, no DOM, no AI imports.            |
| `genoa-postgres`                  | Exhibit storage, validation runs, facility cache, evidence log, warning log. |
| `genoa-object-store`              | S3-compatible (DigitalOcean Spaces).  JSON / TXT / GeoJSON / PDF / SigMF artifacts. |
| `genoa-worker`                    | Async jobs: validation runs, exports, measurement ingest.     |
| `genoa-terrain-sidecar`           | THIN ADAPTER around `chelstein/splat`, `chelstein/itmlogic`, `chelstein/ZTRpsITS`. |
| `genoa-measurement-sidecar`       | THIN ADAPTER around `chelstein/SigMF`, `chelstein/EAS-Tools`, `EAS_Listener`. |
| `genoa-identity-sidecar`          | THIN ADAPTER around `chelstein/massdns`, `chelstein/EAS-Tools`, `chelstein/zerotrustradio` (read-only). |

The sidecar layer is an **adapter**, not a new engine.  Reimplementing
propagation, SDR, or EAS logic inside the sidecars is forbidden by design.

## Layering

```
                   ┌─────────────────────────────────────────────────┐
                   │  AI narrative   (templated text, ai_used=false) │   Layer 3
                   ├─────────────────────────────────────────────────┤
                   │  Evidence       (terrain, measurement, identity)│   Layer 2
                   ├─────────────────────────────────────────────────┤
                   │  Engine         (deterministic FCC calculation) │   Layer 1
                   └─────────────────────────────────────────────────┘
                                      ▲ ▲ ▲
        Curve dataset (sha256-pinned) │ │ │ engine_signature (module + version + git hash)
        47 CFR § references           │ │ └─ method_versions
        Reference validation suite ────┘ └─── interpolation + calculation_trace
```

## `compute()` contract (locked)

```
compute({ inputs, evidence?, options }) -> exhibit
```

- Throws `INVALID_INPUTS` if `inputs` is missing or non-object.
- Throws `VALIDATION_CONTEXT_REQUIRED` if `options.validation` is missing.
- Returns a fully populated `genoa.exhibit.v2` (every required block
  present, including `engine_signature`, `blockers`, `degraded_mode`,
  `degraded_reasons`, `calculation_trace`).
- Never reaches out to a network at compute time; all evidence is
  pre-resolved by the caller.
- Never imports the narrative module.  The narrative is rendered after
  compute by `src/narrative/generator.js`.

## `genoa.exhibit.v2` schema

Top-level required blocks:

```
schema, generated_at, engine_signature,
software_versions, method_versions,
operator_metadata, station_inputs, facility_metadata,
calculation_method, interpolation, calculation_trace,
contour_definitions,
radial_table, polygons, geojson,
evidence, validation, uncertainty, population_estimate,
warnings, blockers, degraded_mode, degraded_reasons,
filing_readiness,
exports, narrative
```

`exports.generated_at` is set by exporters when they actually render so
downstream systems can tell freshness.

## Warnings + readiness

- Warnings are typed enums (see `src/types/warnings.js`).
- Severity is `blocker | warning | info`.
- `exhibit.blockers` is a derived view: `warnings.filter(w => w.severity === 'blocker')`.
- `exhibit.degraded_mode = warnings.length > 0`.
- `exhibit.degraded_reasons` is the deduped code list.
- `filing_readiness` is a deterministic function of warnings + presence of
  required exhibit blocks.  Status is `demo | engineering_review |
  filing_candidate`.  Any blocker forces `demo` and score ≤ 49.

## Determinism

`engine_signature.hash` is resolved at module load:

1. `process.env.GIT_COMMIT_SHA` (set by CI / Docker build args)
2. local `.git/HEAD` walk
3. `'uncommitted'` fallback

Combined with the sha256-pinned curve dataset (`method_versions.curve_dataset.dataset_sha256`)
and the engine version, this is sufficient for an audit-grade reproducibility claim.
