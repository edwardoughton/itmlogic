# Genoa · Executive Brief

**Audience:** broadcast owners, group engineering directors, FCC
consulting engineers, and procurement.  One page.  No marketing.

## What Genoa is

Genoa is a cloud-native, evidence-aware RF planning platform for
US FM, LPFM, and FM-translator broadcast studies.  It is positioned
as a successor to desktop ComStudy-style tools (RadioSoft ComStudy,
V-Soft FMCommander / CONTOUR / Probe), implemented as a service mesh
with a deterministic engineering core, optional terrain / measurement /
identity sidecars, and a templated narrative layer that AI may explain
but never compute.

The unit of work is an **exhibit** — a self-describing JSON document
that records inputs, the FCC method invoked (47 CFR §73.313 /
§73.333 for FM contours; §73.811 for LPFM; §74.1204 for translators),
the curve dataset version, the engine signature, the calculation
trace, every warning the run produced, the validation status of the
curve dataset, and the readiness state of every field a filing
would consume.  Every number in an exhibit is traceable to inputs,
method, dataset, module, and warning state.

## What Genoa is not

Genoa **does not certify filings.**  Filings are signed and submitted
by an engineer of record, not by Genoa.  Genoa produces engineering
exhibits and a filing-readiness report; the engineer of record is
responsible for the §1.65 / §73.3539 / §73.3514 submission.  Genoa is
also **not** a DTV planning tool, **not** an allotment / channel-search
tool (yet), **not** a microwave point-to-point STL planner, and **not**
a DRM / IBOC mask analyzer.  AM groundwave (§73.183 / §73.184) is
present in the schema but **not yet implemented to filing fidelity** —
it emits `AM_ENGINE_NOT_IMPLEMENTED` and returns `null` contour
distances on purpose.  See [FEATURE_MATRIX.md](./FEATURE_MATRIX.md)
for the full scope grid.

## How Genoa is structurally different

1. **Deterministic engine is the source of truth.**  The narrative
   layer, the AI assistant, the UI, and the API may all consume
   engine output; none of them may modify engine output.  See
   [ENGINEERING_METHODOLOGY.md](./ENGINEERING_METHODOLOGY.md).
2. **Sidecars are optional.**  Missing terrain or measurement
   sidecars do not break FM compute; they emit
   `SIDECAR_UNAVAILABLE` warnings and the run continues with a
   documented degraded mode.  See
   [SIDECAR_ARCHITECTURE.md](./SIDECAR_ARCHITECTURE.md).
3. **Advisory evidence is structurally separated from filing
   math.**  RadioDNS resolution, EAS / SAME fingerprinting, SDR
   captures, and zerotrustradio identity confirmations are advisory
   inputs; none of them feed §73.313 contour distances.  See
   [ADVISORY_EVIDENCE.md](./ADVISORY_EVIDENCE.md).
4. **Readiness is a five-state model, not a checkbox.**  Each
   exhibit field is `FILLED`, `SUGGESTED`, `NEEDS_INPUT`,
   `EVIDENCE_MISSING`, or `NOT_APPLICABLE`.  An exhibit is a
   `filing_candidate` only when authoritative §73.313 reference
   cases pass and no required field is in a blocking state.  See
   [FILING_READINESS.md](./FILING_READINESS.md).
5. **Reproducibility is a first-class artifact.**  Every exhibit
   carries a replay token + curve-dataset SHA + engine build
   signature; the same inputs reproduce the same numbers on a
   different machine and a different day.  See
   [REPRODUCIBILITY.md](./REPRODUCIBILITY.md).

## Posture toward AI

`narrative.ai_used` is `false`.  The narrative module is templated
text on top of the deterministic exhibit.  No language model writes,
edits, or selects contour distances, HAAT values, ERP values, or
field-strength interpolations.  AI assistance is permitted only as
post-hoc narrative on top of an already-frozen exhibit, and only
when the operator opts in.

## Current honest status (as designed)

- §73.333 FM F(50,50) and F(50,10) contours: **implemented** with
  curve interpolation; authoritative validation cases must pass to
  clear `CURVE_VALIDATION_MISSING`.
- §73.811 LPFM: **wrapper implemented** on top of §73.333; ERP guard
  at 0.1 kW.
- §74.1204 translators: **distance-only wrapper**; D/U interference
  analysis explicitly **not** implemented (the engine emits
  `FCC_METHOD_MISSING`).
- §73.183 / §73.184 AM groundwave: **not yet implemented** to filing
  fidelity.
- Population: placeholder; emits `POPULATION_PLACEHOLDER`.
- Terrain HAAT: arc-averaged from sidecar when wired, flat-user
  fallback otherwise.

## Where to go next

- [ENGINEERING_METHODOLOGY.md](./ENGINEERING_METHODOLOGY.md)
- [SIDECAR_ARCHITECTURE.md](./SIDECAR_ARCHITECTURE.md)
- [FILING_READINESS.md](./FILING_READINESS.md)
- [ADVISORY_EVIDENCE.md](./ADVISORY_EVIDENCE.md)
- [REPRODUCIBILITY.md](./REPRODUCIBILITY.md)
- [FEATURE_MATRIX.md](./FEATURE_MATRIX.md)
