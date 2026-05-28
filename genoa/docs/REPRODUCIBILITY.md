# Genoa · Reproducibility

**Audience:** consulting engineers, auditors, opposing parties, and
FCC staff who need to reproduce a Genoa exhibit's numbers six months
or six years after it was filed.  This document describes the three
artifacts every Genoa exhibit carries — replay token, engine build
signature, and curve dataset SHA — and how they combine into a
deterministic replay guarantee.

## 1. The reproducibility contract

Genoa's contract is narrow and concrete:

> Given the same exhibit inputs, the same curve dataset (by SHA), and
> the same engine build (by signature), Genoa will reproduce the same
> §73.313 contour distances, HAAT samples, and warning log — bit-for-bit
> on the engineering numbers and structurally identical on the warning
> log — on a different machine, at a different time, by a different
> operator.

That is a strong claim, and it is achievable only because the
engine is deterministic (pure JS, no wall-clock dependence in math
paths, no `Math.random` in math paths, no floating-point reduction
that depends on iteration order), the curves are versioned data,
and the build signature is recorded on every exhibit.

## 2. The three artifacts

### 2.1 Replay token

The replay token is a deterministic hash over the canonical-JSON
serialization of:

1. the input facility record (call, facility ID, ERP, antenna
   height, station class, pattern source, HAAT source);
2. the chosen FCC method (e.g. `§73.313 F(50,50)`);
3. the curve dataset SHA (see 2.3);
4. the engine build signature (see 2.2);
5. the protected-contour threshold table identifier;
6. the chosen HAAT mode (`user_flat` or `arc_averaged_dem`) and, if
   applicable, the sidecar's HAAT response (also canonical-JSON
   hashed).

Two exhibits with identical replay tokens describe identical runs.
The replay token is carried inside the exhibit and survives export
to JSON / TXT / GeoJSON.  Re-running a saved exhibit through
`scripts/sample-exhibit.js` re-derives the replay token; a mismatch
is a hard failure.

### 2.2 Engine build signature

The build signature pins the engine to a specific commit and
package set:

- `engine_commit` — git SHA of the deployed `src/engine/` tree.
- `engine_npm_lockfile_sha` — SHA of `package-lock.json` at build time.
- `engine_node_major` — the Node major version the build was tested
  against (engine math is pinned to a Node major to avoid silent
  Math/Intl behavior drift).
- `engine_curve_loader` — the version of the curve-loader module
  used to interpolate the curve dataset.

The build signature is stamped at build time and read by the engine
at runtime.  An exhibit produced by a different engine build will
have a different signature, and therefore (almost certainly) a
different replay token — even if the curve dataset and the inputs
are identical.  This is intentional: an engine math change is a
real change, and it should be visible in the audit trail.

### 2.3 Curve dataset SHA

Curve datasets live under `data/fcc-curves/<version>/` with a
`manifest.json` that records:

- the version label (e.g. `v0.2`);
- the published source the curves were transcribed from;
- the interpolation rule (`linear-log10` field axis, `linear-linear`
  HAAT axis);
- a SHA-256 over the canonical-JSON of the curve files in the
  version directory.

The exhibit records `curve_dataset.version` and
`curve_dataset.sha256`.  Two exhibits at the same version label must
have the same SHA; a mismatch means someone edited the curves
without bumping the version, and the validation suite will refuse
to clear `CURVE_VALIDATION_MISSING`.

## 3. Determinism in the engine math

Determinism is not free.  Genoa enforces it through several explicit
choices:

- **No wall-clock in math paths.**  The engine reads `Date.now()` only
  to record `computed_at` on the exhibit, not as an input to any
  contour or HAAT computation.
- **No randomness in math paths.**  No `Math.random` or
  `crypto.randomBytes` is used inside the engine math; tokens are
  hash-derived from inputs.
- **Sorted iteration.**  Object keys are sorted in canonical-JSON
  before hashing; radial iteration is in ascending azimuth.
- **Pure modules.**  The engine modules import no Express, no DOM,
  no AI client, no network layer, and no measurement / identity
  sidecar.  This is enforceable by static review.
- **Numeric library pinning.**  `package-lock.json` pins every
  dependency the engine touches; the lockfile SHA is part of the
  build signature.

## 4. What replay verifies

A successful replay verifies, in order:

1. The exhibit's recorded inputs hash to the recorded replay token
   under the recorded engine build signature and curve dataset SHA.
2. Re-running the engine on the recorded inputs produces the same
   contour distances and the same warning log codes.
3. The curve dataset on disk at the recorded version has the
   recorded SHA.
4. The validation suite for the recorded curve dataset still passes
   on the authoritative reference cases.

A replay that succeeds on (1)–(3) but fails on (4) means the curve
dataset's authoritative validation regressed — that is rare and is
treated as a hard incident: the exhibit's `filing_candidate` is no
longer trustworthy, even though its numbers are unchanged.

## 5. What replay does not verify

Replay does **not** verify:

- That the FCC facility record was correct at the time of filing
  (LMS state at a past moment is not a Genoa artifact).
- That the engineer of record's narrative was accurate.
- That the engineer of record's interpretation of §73.211 station
  class or §73.215 short-spacing was correct.
- That advisory evidence (SDR, EAS, RadioDNS) was correctly
  captured — replay confirms the records on the exhibit are
  unchanged, not that the underlying field reality was as captured.

Replay is a math-and-method guarantee, not a regulatory guarantee.
The engineer of record is responsible for the filing.  See
[ENGINEERING_METHODOLOGY.md](./ENGINEERING_METHODOLOGY.md) and
[ADVISORY_EVIDENCE.md](./ADVISORY_EVIDENCE.md).

## 6. Reproducing an exhibit

The canonical reproduction path is:

```bash
# pin to the engine build the exhibit was produced under
git checkout <engine_commit>
npm ci   # locked to engine_npm_lockfile_sha

# verify the curve dataset
node scripts/verify-curve-sha.js data/fcc-curves/<version>/

# replay
node scripts/sample-exhibit.js --replay /path/to/exhibit.json
```

The replay script re-derives the replay token and compares it to the
one on the input exhibit.  Match: pass.  Mismatch: hard fail with
the specific field that diverged.  See also
[FILING_READINESS.md](./FILING_READINESS.md) and
[SIDECAR_ARCHITECTURE.md](./SIDECAR_ARCHITECTURE.md).
