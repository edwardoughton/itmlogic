# FCC golden suite fixtures

Per-station deterministic snapshots used by `fccGoldenSuite.test.js` to
verify the FCC core (gwave.js + tvfm_curves.js) keeps producing the same
contour `mean_radial_km` across refactors.

Each fixture stores:

- `station_inputs` — the exact compute() inputs.
- `expected_polygons[].mean_radial_km` — recorded to two decimals; the
  test asserts agreement within ±0.1 km.

Updating a fixture is a *load-bearing* event: any drift indicates that
the FCC vendored routine (or a curve dataset) changed.  Update only
after engineering review.
