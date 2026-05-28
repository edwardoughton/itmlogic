import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAm73_24g } from '../engine/regulatory/section_73_24g.js';

function makeAmExhibit({
  blanketKm = 0.9, service25Km = 13.4,
  blanketPop = null, service25Pop = null
} = {}){
  const radials = Array.from({ length: 36 }, (_, i) => ({
    azimuth_deg: i * 10,
    contour_distances_km: {
      blanket_1000mvm: blanketKm,
      service_25mvm:   service25Km
    }
  }));
  const exhibit = {
    station_inputs: { service: 'AM' },
    radial_table:   radials
  };
  if (blanketPop != null || service25Pop != null){
    exhibit.population_estimate = {
      by_contour: {
        ...(blanketPop  != null ? { blanket_1000mvm: blanketPop  } : {}),
        ...(service25Pop != null ? { service_25mvm:  service25Pop } : {})
      }
    };
  }
  return exhibit;
}

test('§73.24(g) — applicable only to AM service', () => {
  const r = checkAm73_24g({ exhibit: { station_inputs: { service: 'FM' } } });
  assert.equal(r.applicable, false);
});

test('§73.24(g) — blanket contour present finding passes when computed', () => {
  const r = checkAm73_24g({ exhibit: makeAmExhibit() });
  const present = r.findings.find((f) => f.rule === 'blanket_contour_present');
  assert.equal(present.pass, true);
});

test('§73.24(g) — ratio check is NOT_MEASURED when population not attached', () => {
  const r = checkAm73_24g({ exhibit: makeAmExhibit() });
  const ratio = r.findings.find((f) => f.rule === 'blanket_population_ratio');
  assert.equal(ratio.pass, null);
});

test('§73.24(g) — KELP 1989 numbers reproduce 1.46% ratio FAIL', () => {
  // Mullaney KELP 1989 reported 4,146 blanket / 284,773 service-25mvm
  // = 1.456% → above the 1.0% §73.24(g) limit.
  const r = checkAm73_24g({ exhibit: makeAmExhibit({
    blanketPop: 4146, service25Pop: 284773
  })});
  const ratio = r.findings.find((f) => f.rule === 'blanket_population_ratio');
  assert.equal(ratio.pass, false);
  assert.match(ratio.observed, /1\.4[56]%/);
});

test('§73.24(g) — compliant ratio under 1% passes overall', () => {
  const r = checkAm73_24g({ exhibit: makeAmExhibit({
    blanketPop: 2000, service25Pop: 280000
  })});
  assert.equal(r.overall_pass, true);
});

test('§73.24(g) — falls back to international_25mvm when service_25mvm absent (legacy exhibits)', () => {
  const ex = {
    station_inputs: { service: 'AM' },
    radial_table: Array.from({ length: 36 }, (_, i) => ({
      azimuth_deg: i * 10,
      contour_distances_km: {
        blanket_1000mvm: 0.9,
        international_25mvm: 13.4   // legacy id only
      }
    })),
    population_estimate: {
      by_contour: { blanket_1000mvm: 100, international_25mvm: 50000 }
    }
  };
  const r = checkAm73_24g({ exhibit: ex });
  const ratio = r.findings.find((f) => f.rule === 'blanket_population_ratio');
  assert.equal(ratio.pass, true);   // 0.2% well under 1%
});
