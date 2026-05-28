// Regression: buildEngineeringReport must include the contour-map
// section in its document model.  Without this wiring, the route
// fetches the PNG, stuffs it into options.contour_map_png, and
// buildEngineeringReport silently drops it because no section
// builder ever consumes it — so the rendered PDF has no map page.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEngineeringReport } from '../exports/engineeringReport/index.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

// Tiny but valid 1x1 PNG so coerceMapBuffer accepts it.  Built once;
// header + IHDR + IDAT + IEND.
const TINY_PNG = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
  0x89, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9C, 0x62, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
  0x42, 0x60, 0x82
]);

function mkExhibit(){
  return {
    station_inputs: { call: 'WTST', frequency: 100.7, service: 'FM',
                      lat: 40, lon: -75, fcc_class: 'A',
                      erp_kw: 6, haat_m: 100 },
    radial_table:   [],
    contour_definitions: [],
    interference_study: null,
    population_estimate: { primary: null, informational_only: true },
    method_versions:    {},
    evidence:           {},
    engine_signature:   {},
    warnings:           []
  };
}

test('mapPackage section is present in the document model', () => {
  const doc = buildEngineeringReport(mkExhibit(), {});
  const ids = doc.sections.map((s) => s.id);
  assert.ok(ids.includes('map-package'),
    `'map-package' missing from section list — got: ${ids.join(', ')}`);
});

test('mapPackage section: PNG buffer wires through to type=image', () => {
  const doc = buildEngineeringReport(mkExhibit(), { contour_map_png: TINY_PNG });
  const map = doc.sections.find((s) => s.id === 'map-package');
  assert.ok(map);
  assert.equal(map.type, 'image');
  assert.ok(Buffer.isBuffer(map.image_buffer));
  assert.ok(map.image_buffer.subarray(0, 8).equals(PNG_MAGIC));
});

test('mapPackage section: no PNG → placeholder paragraphs (never silently dropped)', () => {
  const doc = buildEngineeringReport(mkExhibit(), {});
  const map = doc.sections.find((s) => s.id === 'map-package');
  assert.ok(map);
  assert.equal(map.type, 'paragraphs');
  assert.match(map.paragraphs[0], /map sidecar|no contour map/i);
});

test('mapPackage section: figure_number is set so PDF heading reads "FIGURE N — Contour Map"', () => {
  const doc = buildEngineeringReport(mkExhibit(), { contour_map_png: TINY_PNG });
  const map = doc.sections.find((s) => s.id === 'map-package');
  assert.ok(map);
  assert.equal(map.figure_number, 1, 'figure_number must be set on the image section so renderImage() emits "FIGURE 1 — CONTOUR MAP"');
});

test('mapPackage section ordering: appears after methodology, before validation/conclusion', () => {
  // contour-results / itm-coverage are both conditional on the
  // exhibit having data — assert against sections that always render
  // (methodology + validation) so the test is shape-stable across
  // exhibit fixtures.
  const doc = buildEngineeringReport(mkExhibit(), {});
  const ids = doc.sections.map((s) => s.id);
  const iMethod  = ids.indexOf('methodology');
  const iMap     = ids.indexOf('map-package');
  const iValid   = ids.indexOf('validation');
  assert.ok(iMethod >= 0 && iMap >= 0 && iValid >= 0,
            `expected methodology + map-package + validation; got: ${ids.join(', ')}`);
  assert.ok(iMap > iMethod, `map (${iMap}) should appear after methodology (${iMethod})`);
  assert.ok(iMap < iValid,  `map (${iMap}) should appear before validation (${iValid})`);
});
