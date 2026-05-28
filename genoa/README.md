# Genoa · FCC Propagation Studio

**Genoa is the cloud-native, evidence-aware successor to ComStudy-style RF
planning tools.** It is a modern web-native, API-first, reproducible
platform for AM / FM / LPFM / FM-translator broadcast RF studies, intended
to grow into the role currently filled by RadioSoft ComStudy and V-Soft
FMCommander / CONTOUR / Probe.

It is built like an engineering instrument, not a demo.  Every number is
traceable back to inputs + method + version + calculation module +
warning status.  AI may explain, summarize, and draft narrative; AI
**never** calculates contours, modifies engineering output, overrides
warnings, fabricates measurements, or claims FCC approval.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Layer 1 — Official FCC method   (deterministic, dataset-pinned)         │
│  Layer 2 — Scientific evidence   (terrain, SDR, identity, uncertainty)   │
│  Layer 3 — AI narrative          (templated text on top of the exhibit)  │
└──────────────────────────────────────────────────────────────────────────┘
```

## Short-term scope (this revision)

The first milestone replaces the **core FM exhibit workflow**:

1. enter or load a facility
2. compute FCC-style contours (deterministic §73.333 F(50,50))
3. generate the radial table
4. generate GeoJSON / Leaflet map
5. attach warnings, evidence, filing readiness
6. export JSON / TXT / GeoJSON
7. (later) PDF
8. (later) interference / allocation / population modules

## Long-term product scope

Genoa is designed to grow into:

- AM / FM / LPFM / FM-translator studies
- coverage maps
- distance-to-contour tables
- interference studies
- allocation studies
- terrain-aware studies
- HAAT / radial profiles
- population / census overlays
- FCC facility lookup
- RadioDNS / signal identity validation
- SDR measurement evidence
- exportable FCC-style engineering exhibits
- audit / reproducibility trail

The `genoa.exhibit.v2` schema and the layered service architecture were
designed so each of these can be added without re-doing the engineering
core.

## Quick start

```bash
# 1. install
npm install

# 2. run the deterministic engine end-to-end (no API, no DB, no UI)
node scripts/sample-exhibit.js
node scripts/sample-exhibit.js --station kslx     # KSLX-FM, no coords

# 3. unit + integration tests (16 engine + 4 export + 6 API = 26)
npm test

# 4. local stack via docker-compose
docker compose up --build
# open http://localhost:8080
```

Stateless mode (no `DATABASE_URL`) is supported: compute / exports /
readiness all work; persistence routes return 503.

## Architecture (one screen)

```
                                         ┌──────────────────────────┐
                                         │ chelstein/splat          │ terrain
                                         │ chelstein/itmlogic       │ terrain / ITM
                                         │ chelstein/ZTRpsITS       │ ITS reference
                                         │ chelstein/SigMF          │ SDR schema
                                         │ chelstein/EAS-Tools      │ EAS / audio id
                                         │ chelstein/zerotrustradio │ facility DB (R/O)
                                         │ chelstein/massdns        │ RadioDNS resolver
                                         └──────────────────────────┘
                                                     ▲ read-only adapters
                                                     │
  ┌───────────┐    ┌──────────────────────┐    ┌─────┴────────────────────────┐
  │ genoa-ui  │ ←→ │ genoa-api (Express)  │ ←→ │  genoa-engine (pure JS)      │
  │ (Leaflet, │    │ /api/exhibits/*      │    │  curves / fm / am / lpfm /   │
  │  panels)  │    │ /api/curves          │    │  translators / haat / pattern│
  └───────────┘    │ /api/validation      │    │  geometry / validation       │
                   └──────────────────────┘    └──────────────────────────────┘
                          │             │
                          ▼             ▼
                  ┌──────────────┐  ┌──────────────────┐
                  │ genoa-postgres│  │ genoa-object-store│
                  │ (exhibits,    │  │ (S3-compatible:   │
                  │  evidence,    │  │  DigitalOcean     │
                  │  warnings,    │  │  Spaces)          │
                  │  validation)  │  │ JSON / TXT / PDF /│
                  └──────────────┘  │ GeoJSON / SigMF   │
                          ▲          └──────────────────┘
                          │
                  ┌──────────────┐
                  │ genoa-worker │  async: validation runs, exports,
                  │              │  measurement ingest
                  └──────────────┘

   Optional sidecars (each fail-soft; missing sidecar ≠ broken FM compute):
     genoa-terrain-sidecar       (wraps splat / itmlogic / ZTRpsITS)
     genoa-measurement-sidecar   (wraps SigMF / EAS-Tools / EAS_Listener)
     genoa-identity-sidecar      (wraps massdns / EAS-Tools / zerotrustradio R/O)
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full picture.

## Repository layout

```
genoa/
├── src/
│   ├── api/         Express server, routes, middleware, services
│   ├── engine/      Deterministic FCC kernel — curves, fm/am/lpfm/translators,
│   │                geometry, pattern, haat, validation, signature
│   ├── evidence/    Terrain / measurement / identity / uncertainty clients
│   ├── narrative/   AI-FREE templated narrative generator
│   ├── exports/     JSON / TXT / GeoJSON / PDF (PDF intentionally 501)
│   ├── db/          Postgres pool + migrations
│   ├── workers/     Async job processor
│   ├── sidecars/    Thin HTTP adapters around chelstein/* tools
│   ├── ui/public/   index.html + style.css + app.js + panels/
│   ├── types/       schema.js, warnings.js, readiness.js
│   └── tests/       node:test suite
├── data/fcc-curves/ Versioned, sha256-pinned curve datasets
├── docs/            ARCHITECTURE / DEPLOYMENT / FCC_METHODS / SIDECARS / VALIDATION
├── infra/
│   ├── docker/      api, worker, sidecar Dockerfiles
│   └── digitalocean/ App Platform spec
└── scripts/         sample-exhibit.js, wire-env.sh
```

## What Genoa promises

- **Deterministic.**  Same inputs + same curve dataset version + same engine
  signature → byte-identical radial table.
- **Auditable.**  Every exhibit carries `engine_signature`, `method_versions`
  (with sha256-pinned curve dataset), `interpolation`, `calculation_trace`,
  `warnings`, `blockers`, `degraded_mode`, `degraded_reasons`,
  `filing_readiness`.
- **Honest.**  AM groundwave is *not yet implemented* to §73.184 fidelity;
  the engine refuses to fabricate AM distances and emits
  `AM_ENGINE_NOT_IMPLEMENTED`.  PDF export is *not yet implemented* and
  returns 501 with a structured warning.
- **Sidecar-aware.**  Missing terrain / measurement / identity sidecars do
  NOT break FM compute; they emit `SIDECAR_UNAVAILABLE` and the engine
  proceeds with the available evidence.
- **Never fakes validation.**  `CURVE_VALIDATION_MISSING` is only cleared
  by an authoritative reference case (`authoritative: true` with a citable
  `source_note`).  Smoke / regression-guard cases catch silent engine
  drift but cannot certify a curve dataset.

## What Genoa does NOT do

- Genoa does NOT certify a filing.  A licensed broadcast engineer does.
- Genoa does NOT use AI to compute contours.
- Genoa does NOT write to upstream data sources (zerotrustradio /
  buoyIQ / etc.).
- Genoa does NOT promise FCC approval or compliance.

## Vocabulary

We say *FCC-style exhibit*, *deterministic FCC method*, *engineering review
required*, *filing candidate*.  We do not say *FCC approved*, *guaranteed
compliant*, *certified by AI*.

## License

Inherits the `chelstein/itmlogic` repository license.  Curve datasets and
upstream tools retain their own licenses; see the upstream repos.
