# Genoa · Filing Readiness Model

**Audience:** FCC consulting engineers and filing coordinators who
need to know exactly what state every field on a Genoa exhibit is in
before signing off on a §73.3539 application or a §1.65 amendment.

Genoa does **not** certify filings.  The engineer of record signs the
filing.  Genoa's job is to report — with no marketing softening — what
is and is not ready, and why.  That reporting is structured as a
five-state model.

## 1. The five states

Each exhibit field carries exactly one of:

| State                | Meaning                                                                                         |
|----------------------|-------------------------------------------------------------------------------------------------|
| `FILLED`             | A defensible value is present, sourced from authoritative inputs or a wired filing-input sidecar. |
| `SUGGESTED`          | A value is present, but it was inferred (defaulted, derived from a sibling field, or pattern-matched). The engineer must confirm before filing. |
| `NEEDS_INPUT`        | No value present; the field is required for the chosen filing path; operator action required.   |
| `EVIDENCE_MISSING`   | A value is present, but a required piece of `filing_input` evidence (e.g. authoritative validation, per-radial HAAT, calibrated measurement) is not on the exhibit. |
| `NOT_APPLICABLE`     | The field is not required for this filing path (e.g. directional pattern on a true non-directional facility, AM fields on an FM exhibit).  |

The model is intentionally a finite enumeration.  An exhibit field is
never "kind of filled" — every field is in exactly one of the five
states above, and `filing_candidate` requires every required field to
be `FILLED` or `NOT_APPLICABLE`.

## 2. How a field reaches `FILLED`

A field reaches `FILLED` when **all** of the following are true:

1. A value is present, set by the operator or imported from FCC LMS.
2. Any sidecar input the value depends on is tagged
   `filing_effect: filing_input` (per
   [SIDECAR_ARCHITECTURE.md](./SIDECAR_ARCHITECTURE.md)) — not
   `advisory_only`.
3. No blocking warning for that field is present in the warning log.
4. For curve-derived fields (contour distances under §73.313 /
   §73.333), the authoritative validation suite has cleared
   `CURVE_VALIDATION_MISSING` for the curve dataset in use.

If any condition fails, the field stays at `SUGGESTED`,
`EVIDENCE_MISSING`, or `NEEDS_INPUT`.

## 3. How `SUGGESTED` differs from `FILLED`

`SUGGESTED` is the engine's polite way of saying "I have a value, but
a human should sign off on it."  Common sources:

- HAAT in `user_flat` mode (`CONSTANT_HAAT_ASSUMED` is on the
  exhibit; the value is a single user-entered HAAT applied to every
  radial rather than per-radial `arc_averaged_dem`).
- A non-directional pattern assumed because no relative-field table
  was supplied (`omni_assumed`).
- A population estimate produced by the uniform-density placeholder
  (`POPULATION_PLACEHOLDER`).
- A station class inferred from ERP / HAAT and §73.211 class minima
  rather than read from LMS.

A `SUGGESTED` field cannot be promoted to `FILLED` automatically.
The promotion is a deliberate operator action against a frozen
exhibit, and it is recorded in the audit trail.

## 4. How `NEEDS_INPUT` differs from `EVIDENCE_MISSING`

- `NEEDS_INPUT` means the operator has not supplied a value yet.
  Example: latitude / longitude on a KSLX-style demo facility where
  `coords` is intentionally `null` — the engine emits
  `FACILITY_COORDINATES_MISSING` and `NEEDS_INPUT` is the field
  state.  An operator pulls the coordinates from FCC LMS and the
  field moves to `FILLED` (assuming no other blocker).
- `EVIDENCE_MISSING` means a value is present but the supporting
  evidence is not.  Example: contour distances are present under
  §73.313, but no authoritative reference case has passed for the
  active curve dataset; `CURVE_VALIDATION_MISSING` is on the
  exhibit, and the contour fields are `EVIDENCE_MISSING`, not
  `FILLED`.

This distinction matters because the two states need different
remediation: `NEEDS_INPUT` needs a value, `EVIDENCE_MISSING` needs an
authoritative input or a wired filing-input sidecar.

## 5. How `NOT_APPLICABLE` works

`NOT_APPLICABLE` is used only where a §73.x or §74.x rule excludes
the field.  Examples:

- Directional pattern relative-field table on a non-directional
  full-service FM facility.
- §73.183 AM groundwave fields on a §73.313 FM exhibit.
- §74.1204(b) D/U interference fields on a translator exhibit using
  the distance-only wrapper — these are still flagged
  `FCC_METHOD_MISSING` so the operator knows the interference
  analysis was not performed.
- §73.811 LPFM-only fields on a full-service FM exhibit.

`NOT_APPLICABLE` never blocks `filing_candidate`.

## 6. `filing_candidate`

`filing_candidate` is a single boolean computed by `genoa-api`'s
readiness route from the field-state grid plus the warning log.
It is `true` when **all** of the following hold:

1. Every required field for the chosen filing path is `FILLED` or
   `NOT_APPLICABLE`.
2. No field is in `NEEDS_INPUT` or `EVIDENCE_MISSING`.
3. `CURVE_VALIDATION_MISSING` is cleared (authoritative pass).
4. No `FCC_METHOD_MISSING` warning is on the exhibit.
5. `AM_ENGINE_NOT_IMPLEMENTED` is not on the exhibit (FM / LPFM /
   translator only, until AM lands).
6. All sidecar contributions feeding required fields are
   `filing_effect: filing_input`, not `advisory_only`.

`filing_candidate: false` is the default.  The boolean is conservative
on purpose: a false positive here would put an engineer of record's
signature on a deficient filing.

## 7. What `filing_candidate: true` does and does not mean

It means the exhibit is engineering-ready and the engine has no
self-known blocker for filing.  It does **not** mean:

- That the engineer of record has reviewed the exhibit.
- That FCC LMS has been queried for an up-to-the-minute facility
  record.
- That the underlying curve dataset is the most recent OET-published
  dataset (the operator chooses which `data/fcc-curves/<version>/` to
  pin to; the exhibit records that choice).
- That the AI narrative was reviewed.
- That the engineer of record agrees with the engine's interpretation
  of station class, applicability of §73.211, or applicability of
  §73.215.

The boolean is a readiness signal, not a certification.  See
[ADVISORY_EVIDENCE.md](./ADVISORY_EVIDENCE.md) and
[REPRODUCIBILITY.md](./REPRODUCIBILITY.md).
