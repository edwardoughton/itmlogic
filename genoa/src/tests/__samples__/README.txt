Genoa QA — baseline JSON exhibits.

These artifacts are NOT byte-equal golden fixtures (Agent 2 owns those
under __golden__/).  Rather, they are sparse JSON manifests that capture
structural / regulatory invariants for sample stations.  The tests in:

  sampleArtifactsSmoke.test.js   — render full PDF, check appendix list
  regressionInvariance.test.js   — FCC outputs unchanged with sidecars on/off
  replayDeterminism.test.js      — exhibits are byte-equal across runs

read these files via JSON.parse() and assert exhibit.<field> matches the
recorded shape (count, range, presence) — NOT exact deep-equal values.

Updating a baseline:
  1. Inspect the diff in the failing test.
  2. If the change is intended, update the corresponding JSON.
  3. Update the cite/notes block in the JSON to explain WHY the
     invariant changed.
