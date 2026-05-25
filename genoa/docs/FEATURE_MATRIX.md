# Genoa · Feature Matrix

**Audience:** broadcast owners and engineering directors comparing
Genoa against desktop-era ComStudy-style tools (RadioSoft ComStudy,
V-Soft FMCommander / CONTOUR / Probe).  One page, no marketing.
Where Genoa does not yet do a thing, the matrix says so.

## 1. Coverage by rule frame

| Rule frame                          | What Genoa does today                            | Status                                  |
|-------------------------------------|--------------------------------------------------|-----------------------------------------|
| 47 CFR §73.313 / §73.333 FM         | F(50,50) and F(50,10) contour distances; curve interpolation; pattern table | **implemented**; clears with authoritative validation |
| 47 CFR §73.811 LPFM                 | Distance wrapper over §73.333 with LP100 ceiling guard at 0.1 kW             | **implemented**                          |
| 47 CFR §74.1204(a) translators      | Distance wrapper over §73.333 with ERP guard at 0.25 kW                      | **implemented (distance only)**          |
| 47 CFR §74.1204(b) D/U interference | —                                                                            | **not yet implemented**; engine emits `FCC_METHOD_MISSING` |
| 47 CFR §73.183 / §73.184 AM         | Reference field E₀ = 100·√(P_kW); contour distances `null`                   | **not yet implemented to filing fidelity**; emits `AM_ENGINE_NOT_IMPLEMENTED` |
| 47 CFR §73.215 short-spacing        | —                                                                            | **not yet implemented**                  |
| 47 CFR §74.131 / DTV                | —                                                                            | **out of scope** for current revision    |
| FCC Part 101 microwave P2P (STL)    | —                                                                            | **out of scope**                         |
| HD Radio / IBOC / DRM mask          | —                                                                            | **out of scope**                         |

See [ENGINEERING_METHODOLOGY.md](./ENGINEERING_METHODOLOGY.md) for the
methods and assumptions.

## 2. Adjacent capabilities

| Capability                          | Genoa today                                                                       | Notes                                   |
|-------------------------------------|-----------------------------------------------------------------------------------|-----------------------------------------|
| Per-radial HAAT, 3–16 km arc        | Arc-averaged DEM via terrain sidecar (SPLAT / itmlogic / ZTRpsITS); flat-user fallback | `CONSTANT_HAAT_ASSUMED` when flat       |
| Directional antenna pattern         | User-supplied relative-field table; azimuth-linear interpolation                  | `omni_assumed` when absent              |
| Allotment / channel search          | —                                                                                 | **not yet implemented**                  |
| Allocation studies                  | —                                                                                 | **not yet implemented**                  |
| Population / demographics           | Uniform-density placeholder (80 / km²)                                            | emits `POPULATION_PLACEHOLDER`           |
| Coverage maps                       | GeoJSON export; Leaflet panels in genoa-ui                                        | implemented                              |
| Distance-to-contour tables          | Radial table, configurable azimuth count                                          | implemented                              |
| PDF engineering exhibit             | —                                                                                 | planned                                   |
| JSON / TXT / GeoJSON export         | implemented                                                                       | replay token survives export             |
| FCC facility lookup (LMS)           | Read-only adapter via `chelstein/zerotrustradio`                                  | identity sidecar; advisory               |
| RadioDNS resolution                 | `chelstein/massdns`                                                               | identity sidecar; advisory               |
| EAS / SAME identity                 | `chelstein/EAS-Tools`                                                             | identity sidecar; advisory               |
| SDR capture ingest                  | `chelstein/SigMF` via measurement sidecar                                         | advisory; calibration required           |
| Validation suite                    | Authoritative + regression + demo cases                                           | only authoritative clears the blocker    |
| Reproducibility                     | Replay token + build signature + curve dataset SHA                                | see [REPRODUCIBILITY.md](./REPRODUCIBILITY.md) |

## 3. Architectural posture

| Axis                  | Desktop-era tools                       | Genoa                                          |
|-----------------------|-----------------------------------------|------------------------------------------------|
| Form factor           | Windows desktop / workstation           | Cloud-native; browser SPA + REST API           |
| Automation            | Per-tool macros                         | REST API; n8n workflows; CI-callable           |
| Provenance per number | Tool version + operator notes           | Inputs + method + curve dataset SHA + engine signature + replay token + warning log |
| Failure modes         | Dialog box; user retries                | Structured warnings on the exhibit             |
| AI involvement        | None or bolted on                       | Templated narrative; `narrative.ai_used: false` |
| Validation discipline | Vendor-asserted                         | Authoritative reference cases or it does not clear `CURVE_VALIDATION_MISSING` |
| Sidecars              | n/a                                     | Optional terrain / measurement / identity adapters around `chelstein/*` |
| Storage               | Local files                             | Postgres + S3-compatible object store; stateless mode supported |
| Reproducibility       | "Reopen the project"                    | Replay token contract; see [REPRODUCIBILITY.md](./REPRODUCIBILITY.md) |
| Filing certification  | Engineer signs                          | Engineer signs (Genoa does not certify)        |

## 4. What Genoa explicitly does not do

These are deliberate scope boundaries, not gaps to be papered over:

- **Genoa does not certify filings.**  The engineer of record signs the
  §73.3539 / §1.65 / §73.3514 submission.  Genoa reports readiness;
  it does not approve.
- **Genoa does not invent missing inputs.**  Missing coordinates,
  missing patterns, missing per-radial HAAT, missing AM curves, and
  missing population data are surfaced as warnings, not silently
  defaulted.
- **Genoa does not modify upstream data sources.**  Every adapter
  is read-only; writing back to `chelstein/zerotrustradio` is
  forbidden by design.
- **AI does not compute.**  AI may explain templated narrative on
  top of a frozen exhibit; it never writes a contour distance, a
  HAAT value, an ERP value, or a field-strength interpolation.
- **DTV (Part 73 subpart E) is out of scope** for the current
  revision.
- **Microwave P2P STL planning (Part 101) is out of scope.**
- **HD Radio / IBOC / DRM mask analysis is out of scope.**
- **Allotment search and FCC channel-availability scanning are not
  yet implemented.**
- **D/U interference studies under §74.1204(b) are not yet
  implemented.**  Translator exhibits are distance-only.

## 5. Where to learn more

- [EXECUTIVE_BRIEF.md](./EXECUTIVE_BRIEF.md) — one-page overview.
- [ENGINEERING_METHODOLOGY.md](./ENGINEERING_METHODOLOGY.md) — the
  methods, assumptions, and where the engine refuses to guess.
- [SIDECAR_ARCHITECTURE.md](./SIDECAR_ARCHITECTURE.md) — how the
  service mesh isolates the engine from optional services and how
  `filing_effect` labels every contribution.
- [FILING_READINESS.md](./FILING_READINESS.md) — the five-state
  readiness model (`FILLED` / `SUGGESTED` / `NEEDS_INPUT` /
  `EVIDENCE_MISSING` / `NOT_APPLICABLE`).
- [ADVISORY_EVIDENCE.md](./ADVISORY_EVIDENCE.md) — why advisory
  evidence is structurally separated from filing math.
- [REPRODUCIBILITY.md](./REPRODUCIBILITY.md) — replay token + build
  signature + curve dataset SHA.
