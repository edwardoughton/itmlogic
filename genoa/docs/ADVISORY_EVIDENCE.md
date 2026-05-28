# Genoa · Advisory Evidence

**Audience:** FCC consulting engineers who need to know exactly which
parts of an exhibit are method-derived (and therefore filing-grade) and
which parts are advisory context that the engineer of record may use
but the engine math does not.

This document explains why Genoa structurally separates advisory
evidence from filing math, how that separation shows up in the
`filing_effect` label, and what it means for a reviewer.

## 1. The separation

Genoa recognizes two structurally distinct categories of input that
land on an exhibit:

- **Filing inputs** (`filing_effect: filing_input`) — facility record
  fields, ERP, antenna height, HAAT samples per radial from a wired
  terrain sidecar, station class, pattern relative-field table, and
  the §73.313 / §73.333 curve dataset.  These directly feed the
  protected-contour distance computation.  An exhibit field cannot
  reach `FILLED` (see [FILING_READINESS.md](./FILING_READINESS.md))
  without filing-input evidence.
- **Advisory inputs** (`filing_effect: advisory_only`) — SDR
  measurements, EAS / SAME header captures, audio fingerprints,
  RadioDNS resolution, zerotrustradio identity confirmations, and
  third-party "we received your signal" reports.  These are useful
  context that the engineer of record may cite in narrative or in
  supplementary exhibits.  They do **not** move a §73.313 contour
  distance.

## 2. Why advisory evidence cannot feed §73.313 math

The §73.313 protected-contour method is method-derived from the
F(50,50) curves, station class, ERP, and HAAT.  An SDR measurement
showing 70 dBu at 32 km from the transmitter is interesting; it is not
the same thing as a §73.313 60 dBu protected contour at that radial.
The two numbers live in different rule frames:

- §73.313 contours are defined by the F(50,50) curves at a specified
  HAAT and ERP for the station class — a deterministic, regulatory
  field-strength prediction.
- A measured field at a point is a single-time, single-point sample
  of the actual propagation environment, subject to receiver
  calibration, antenna response, time-of-day variation, multipath,
  and fading.

The FCC's §73.151 / §74.7 measurement methods exist precisely because
measurements and predictions are different things.  Genoa keeps them
in different categories so the reviewer can see at a glance which is
which, and so that a future AI narrative module cannot accidentally
treat one as the other.

## 3. What advisory evidence is good for

The advisory category is not second-class — it is intentionally
positioned for a different job:

1. **Sanity-checking the prediction.**  A wildly-off measurement set
   is a real signal that something on the facility record (ERP,
   antenna height, pattern orientation) may be wrong.  Genoa logs
   the measurement set as evidence with `filing_effect: advisory_only`
   so the engineer can pursue it without it silently re-shaping the
   protected contour.
2. **Identity confirmation.**  When the identity sidecar resolves
   RadioDNS or matches an EAS / SAME header to the facility, the
   exhibit records `confirmed | mismatch | absent | unavailable`.
   `confirmed` is advisory: it raises confidence that the exhibit is
   describing the station you think it is, but it does not replace
   the LMS facility record.
3. **Narrative.**  The narrative layer may cite advisory evidence in
   templated text (e.g., "Field measurements at three locations
   along the 270° radial showed signal at or above the predicted
   level on date X").  Narrative cannot, however, change the
   exhibit's numeric prediction.
4. **Future filing-grade work.**  Advisory evidence is the raw
   material that, after a rule update or a §73.151 measurement
   campaign, may be re-classified as filing input for a directional
   pattern verification — but that re-classification is an explicit
   operator action against a frozen exhibit, not an automatic
   promotion.

## 4. How the separation is enforced

The separation is enforced in three places:

1. **Schema** — every evidence record on the exhibit carries a
   mandatory `filing_effect` enum field with three legal values:
   `filing_input | advisory_only | audit_only`.  Records missing the
   field fail schema validation.
2. **Readiness math** — the field-state computation in
   `/api/readiness` only consults `filing_input` evidence when
   promoting a field from `NEEDS_INPUT` or `EVIDENCE_MISSING` toward
   `FILLED`.  Advisory evidence cannot move a field state.
3. **Engine API surface** — the engine modules
   (`src/engine/fm/contour.js`, `src/engine/lpfm/contour.js`,
   `src/engine/translators/contour.js`) take only facility record
   fields and curve datasets as input.  They have no code path that
   reads measurement records, identity records, or RadioDNS
   resolutions.  This is enforceable by static review: a grep across
   the engine modules will not find a measurement / identity /
   RadioDNS import.

## 5. What this means for the reviewer

When you open a Genoa exhibit, you can read its math by reading only
the `filing_input` evidence and the §73.313 / §73.333 method block.
The advisory evidence is a separate, clearly-labeled section.  If you
trust the curve dataset, the HAAT source, and the facility record,
you can trust the contour distances regardless of what the advisory
evidence says.  Conversely, if the advisory evidence contradicts the
prediction in interesting ways, the exhibit's warning log will say
so, but the contour distances will still be what §73.313 says they
are.

## 6. What this means for AI

`narrative.ai_used` is `false` (see
[ENGINEERING_METHODOLOGY.md](./ENGINEERING_METHODOLOGY.md)).  Even
when an operator opts in to an AI-authored summary on top of an
already-frozen exhibit, the AI is restricted to advisory evidence
plus engine outputs as read-only inputs.  The AI has no write path
to the contour distances.  The structural separation between
advisory and filing math is therefore also the structural separation
between what an AI may explain and what an AI may never compute.

See also: [FILING_READINESS.md](./FILING_READINESS.md),
[SIDECAR_ARCHITECTURE.md](./SIDECAR_ARCHITECTURE.md),
[REPRODUCIBILITY.md](./REPRODUCIBILITY.md).
