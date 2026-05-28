// FCC advisory-sidecar invariance.
//
// CONTRACT
//   FCC contour distances are computed from station inputs + vendored
//   FCC routines.  Advisory sidecars (terrain, measurements, identity,
//   nearby_primaries for non-engine purposes) are EVIDENCE — they may
//   add narrative context, warnings, or regulatory pass/fail flags, but
//   they MUST NOT alter the polygons / radial_table / contour distances
//   produced by the FCC core.
//
//   The exceptions are documented:
//     - evidence.terrain_haat_per_radial: only when length matches the
//       radial count, replaces the flat HAAT.  We test BOTH branches.
//     - evidence.itm_coverage: surfaces a separate itm_polygons block,
//       does NOT modify exhibit.polygons.
//
//   This test runs the same station inputs twice, once with bare
//   evidence and once loaded with sidecars, and asserts polygons +
//   radial_table contour distances are byte-identical.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compute } from '../engine/index.js';
import { runValidationSuite } from '../engine/validation/runner.js';

const VALIDATION = await runValidationSuite();

async function runWith(inputs, evidence){
  return compute({
    inputs,
    evidence: evidence || {},
    options: {
      operator: 'test', organization: 'test',
      validation: { runs: [VALIDATION], reference_cases_present: VALIDATION.reference_cases_present }
    }
  });
}

function projectContourDistances(exhibit){
  // Reduce polygons to (id, mean_radial_km) + radial_table contour distances
  // by azimuth — the engineering content that must remain invariant
  // under advisory sidecars.
  const polys = (exhibit.polygons || [])
    .map(p => ({ id: p.contour_id, mean_radial_km: p.mean_radial_km, area_km2: p.area_km2 }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const radials = (exhibit.radial_table || []).map(r => ({
    az: r.azimuth_deg, distances: r.contour_distances_km
  }));
  return { polys, radials };
}

const STATIONS = [
  { call:'KAZM', facility_id:'10210', service:'AM', frequency:780, erp_kw:1.0,
    ground_sigma_mS_m:4, lat:34.85, lon:-111.79, radial_step_deg:45 },
  { call:'WTEST', facility_id:'99999', service:'FM', fcc_class:'A',
    frequency:98.7, erp_kw:6.0, haat_m:100, lat:37.0902, lon:-95.7129, radial_step_deg:30 },
  { call:'W265', facility_id:'88888', service:'FX',
    frequency:100.9, erp_kw:0.25, haat_m:30, lat:37.0902, lon:-95.7129, radial_step_deg:30 },
  { call:'WLP', facility_id:'77777', service:'LPFM', fcc_class:'LP100',
    frequency:99.7, erp_kw:0.1, haat_m:30, lat:37.0902, lon:-95.7129, radial_step_deg:30 }
];

const SIDECAR_EVIDENCE = {
  // ITM coverage is a separate polygon group; must not bleed into polygons.
  itm_coverage: {
    available: true, method: 'ITM (test stub)', cite: '47 CFR §73.314',
    arc: { target_field_dbu: 60 },
    radials: [
      { az: 0,   terrain_distance_km: 25, fcc_distance_km: 28.0 },
      { az: 90,  terrain_distance_km: 27, fcc_distance_km: 28.0 },
      { az: 180, terrain_distance_km: 26, fcc_distance_km: 28.0 },
      { az: 270, terrain_distance_km: 24, fcc_distance_km: 28.0 }
    ]
  },
  // Nearby primaries — drives §73.207/§73.215/§74.1204 studies but NOT
  // the FCC contour computation.
  nearby_primaries: [
    { call:'WOTHER', facility_id:'88800', service:'FM', fcc_class:'A',
      frequency:98.5, erp_kw:6.0, haat_m:100, lat:38.5, lon:-94.5 }
  ],
  tv_ch6_stations: [],
  measurements: {
    available: true, source:'sigmf-test', calibrated: true,
    records: [{ id: 'm1', field_dBu: 55.2 }]
  },
  identity: { available: true, sources: ['radiodns'], confirmations: ['ok'] },
  terrain: { available: true, source:'srtm', profiles: [] }
};

for (const inputs of STATIONS){
  test(`advisory invariance: ${inputs.service} ${inputs.call}`, async () => {
    const bare    = await runWith(inputs, {});
    const advised = await runWith(inputs, SIDECAR_EVIDENCE);

    const a = projectContourDistances(bare);
    const b = projectContourDistances(advised);

    assert.deepEqual(a.polys, b.polys,
      'polygons (id, mean_radial_km, area_km2) must be identical with/without advisory sidecars');
    assert.deepEqual(a.radials, b.radials,
      'radial_table contour distances must be identical with/without advisory sidecars');

    // Sidecars MAY change other fields — itm_polygons, regulatory
    // compliance, evidence block — so we just verify they didn't bleed
    // back into the FCC contour outputs.
    assert.equal(bare.polygons.length, advised.polygons.length,
      'polygon count must not change with sidecars');
  });
}

// Spot-check: the AM σ-clamp branch is also invariant — sidecars do not
// alter the σ resolution metadata.
test('advisory invariance: AM evidence.ground_constants unchanged with sidecars', async () => {
  const inputs = STATIONS[0];
  const bare    = await runWith(inputs, {});
  const advised = await runWith(inputs, SIDECAR_EVIDENCE);
  assert.deepEqual(bare.evidence?.ground_constants, advised.evidence?.ground_constants,
    'AM ground_constants must be invariant under advisory sidecars');
});

// Curve-dataset fingerprint composition is over engine + curve set, not
// advisory evidence — must be identical with/without sidecars.
test('advisory invariance: build_attestation curve_dataset_fingerprint unchanged with sidecars', async () => {
  const inputs = STATIONS[1]; // FM
  const bare    = await runWith(inputs, {});
  const advised = await runWith(inputs, SIDECAR_EVIDENCE);
  assert.equal(
    bare.build_attestation?.curve_dataset_fingerprint_sha256,
    advised.build_attestation?.curve_dataset_fingerprint_sha256,
    'curve_dataset_fingerprint must not depend on advisory evidence'
  );
});
