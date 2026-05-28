import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAmNightNarrative,
  AM_NIGHT_NARRATIVE_PROVENANCE
} from '../exports/engineeringReport/sections/amNightNarrative.js';
import { buildAppendixSections } from '../exports/engineeringReport/sections/appendices.js';

const PROPOSED = { lat: 40, lon: -75, freq_khz: 700, erp_kw: 50,
                   fcc_class: 'B', call: 'WTST', facility_id: 1234 };

const FULL_NIF_PASS = {
  available: true,
  source:    'fccam',
  fetched_at:'2026-05-16T01:23:45Z',
  regulation:'47 CFR §73.182',
  proposed:  PROPOSED,
  summary: {
    n_azimuths: 36, n_failing_azimuths: 0, n_no_service_azimuths: 0,
    mean_radius_km: 215, min_radius_km: 50, max_radius_km: 400,
    worst_margin_db: 1.5, n_interferers_used: 5, n_interferers_seen: 8
  },
  contour: [
    { azimuth_deg: 0,   distance_km: 400, lat: 43.6, lon: -75,
      binding: { relation: 'co_channel', margin_db: 1.5, pass: true,
                 desired_uv_m: 200, required_uv_m: 168,
                 contributing: ['WBLK', 'WTOY'] } },
    { azimuth_deg: 180, distance_km: 50,  lat: 39.5, lon: -75,
      binding: { relation: 'co_channel', margin_db: 4.5, pass: true,
                 desired_uv_m: 800, required_uv_m: 480 } }
  ],
  interferers: [
    { call: 'WBLK', station_id: 1, fcc_class: 'B', freq_khz: 700,
      erp_kw: 50, lat: 40, lon: -82, relation: 'co_channel', distance_km: 600 },
    { call: 'WADJ', station_id: 2, fcc_class: 'B', freq_khz: 690,
      erp_kw: 25, lat: 40, lon: -78, relation: 'first_adjacent', distance_km: 250 }
  ],
  interferer_cap_applied: false,
  provenance: { upstream_skywave: 'FCCAM (Fccam.for / Wang 1985)' }
};

const FAILING_NIF = {
  ...FULL_NIF_PASS,
  summary: {
    ...FULL_NIF_PASS.summary,
    n_failing_azimuths: 4, worst_margin_db: -3.2
  },
  contour: [
    ...FULL_NIF_PASS.contour,
    { azimuth_deg: 270, distance_km: 30, lat: 40, lon: -75.4,
      binding: { relation: 'co_channel', margin_db: -3.2, pass: false,
                 desired_uv_m: 50, required_uv_m: 100,
                 contributing: ['WBLK'] } }
  ]
};

const ALL_NO_SERVICE = {
  ...FULL_NIF_PASS,
  summary: {
    ...FULL_NIF_PASS.summary,
    n_failing_azimuths: 0,
    n_no_service_azimuths: 36,
    mean_radius_km: 0, min_radius_km: 0, max_radius_km: 0,
    worst_margin_db: -25
  },
  contour: Array.from({ length: 36 }, (_, i) => ({
    azimuth_deg: i * 10, distance_km: 0, lat: 40, lon: -75,
    saturated: 'no_service'
  }))
};

function mkExhibit(nif, svc = 'AM'){
  return { station_inputs: { ...PROPOSED, service: svc }, evidence: { am_night_nif: nif } };
}

/* ---------- gating ---------- */

test('buildAmNightNarrative: FM exhibit returns ok:false', () => {
  const r = buildAmNightNarrative(mkExhibit(FULL_NIF_PASS, 'FM'));
  assert.equal(r.ok, false);
  assert.deepEqual(r.paragraphs, []);
});

test('buildAmNightNarrative: AM exhibit without nif returns ok:false', () => {
  const r = buildAmNightNarrative({ station_inputs: { service: 'AM' }, evidence: {} });
  assert.equal(r.ok, false);
});

test('buildAmNightNarrative: nif available:false returns ok:false', () => {
  const r = buildAmNightNarrative(mkExhibit({ available: false, error: 'FCCAM not configured' }));
  assert.equal(r.ok, false);
});

/* ---------- happy path: passing exhibit ---------- */

test('buildAmNightNarrative: passing exhibit emits 4 paragraphs (no failure roll-up)', () => {
  const r = buildAmNightNarrative(mkExhibit(FULL_NIF_PASS));
  assert.equal(r.ok, true);
  assert.equal(r.paragraphs.length, 4, 'opener + methodology + binding + closing');
  // Opener verdict + key numbers.
  assert.match(r.paragraphs[0], /interference-free/i);
  assert.match(r.paragraphs[0], /Class B/);
  assert.match(r.paragraphs[0], /WTST/);
  assert.match(r.paragraphs[0], /215\.0 km/);
  // Methodology cites the regulations.
  assert.match(r.paragraphs[1], /73\.182\(k\)/);
  assert.match(r.paragraphs[1], /73\.150/);
  assert.match(r.paragraphs[1], /Wang/);
  // Binding paragraph identifies azimuth + distance + margin.
  assert.match(r.paragraphs[2], /azimuth 0°/);
  assert.match(r.paragraphs[2], /400\.0 km/);
  assert.match(r.paragraphs[2], /co_channel/);
  assert.match(r.paragraphs[2], /\+1\.50 dB/);
  assert.match(r.paragraphs[2], /WBLK/);
  // Closing references replay determinism + skywave engine.
  assert.match(r.paragraphs[3], /deterministic/i);
  assert.match(r.paragraphs[3], /FCCAM/);
});

/* ---------- no-double-count regression (Codex P1 on #173) ---------- */

test('buildAmNightNarrative: opener does NOT double-subtract no-service from served count', () => {
  // n_no_service_azimuths is a subset of n_failing_azimuths
  // (no-service rows have binding.pass=false), so subtracting both
  // undercounted served azimuths.  Pin the correct arithmetic:
  // served = n_azimuths - n_failing.
  //
  // Scenario: 36 total, 5 failing (of which 2 are no-service) → 31 served.
  const exhibit = mkExhibit({
    ...FULL_NIF_PASS,
    summary: {
      ...FULL_NIF_PASS.summary,
      n_failing_azimuths:    5,
      n_no_service_azimuths: 2,
      worst_margin_db:       -1.5
    }
  });
  const r = buildAmNightNarrative(exhibit);
  assert.equal(r.ok, true);
  assert.match(r.paragraphs[0], /service over 31 of 36/);
  // Roll-up sentence still mentions both counts so the engineer
  // sees 5 failing AND 2 no-service explicitly.
  assert.match(r.paragraphs[0], /5 azimuth\(s\) fail/);
  assert.match(r.paragraphs[0], /of which 2 cannot provide service/);
});

test('buildAmNightNarrative: opener with zero no-service uses the simple breakdown', () => {
  const exhibit = mkExhibit({
    ...FULL_NIF_PASS,
    summary: { ...FULL_NIF_PASS.summary, n_failing_azimuths: 3, n_no_service_azimuths: 0,
               worst_margin_db: -1.0 }
  });
  const r = buildAmNightNarrative(exhibit);
  assert.match(r.paragraphs[0], /service over 33 of 36/);
  assert.match(r.paragraphs[0], /3 azimuth\(s\) fail/);
  assert.doesNotMatch(r.paragraphs[0], /of which/);
});

/* ---------- failing exhibit ---------- */

test('buildAmNightNarrative: failing exhibit names the failing-azimuth count + worst margin', () => {
  const r = buildAmNightNarrative(mkExhibit(FAILING_NIF));
  assert.equal(r.ok, true);
  assert.equal(r.paragraphs.length, 5, 'opener + methodology + binding + roll-up + closing');
  assert.match(r.paragraphs[0], /4 azimuth\(s\) fail/);
  assert.match(r.paragraphs[0], /-3\.20 dB/);
  // Binding paragraph picks the most-negative margin (the 270° row).
  assert.match(r.paragraphs[2], /azimuth 270°/);
  assert.match(r.paragraphs[2], /-3\.20 dB/);
  // Roll-up enumerates the failing azimuth.
  const rollup = r.paragraphs[3];
  assert.match(rollup, /Failing azimuths \(1\)/);
  assert.match(rollup, /270°/);
});

test('buildAmNightNarrative: all-no-service emits the cannot-qualify opener', () => {
  const r = buildAmNightNarrative(mkExhibit(ALL_NO_SERVICE));
  assert.equal(r.ok, true);
  assert.match(r.paragraphs[0], /cannot provide interference-free/i);
  assert.match(r.paragraphs[0], /pattern redesign|class change/i);
});

/* ---------- engine-identity adaptive prose ---------- */

test('methodology + closing name FCCAM Wang when engine=fccam', () => {
  const r = buildAmNightNarrative(mkExhibit({ ...FULL_NIF_PASS, engine: 'fccam', source: 'fccam' }));
  assert.match(r.paragraphs[1], /FCCAM \(Wang 1985 model/);
  assert.match(r.paragraphs[1], /filing-grade/);
  assert.doesNotMatch(r.paragraphs[1], /Berry/);
  // Closing references FCCAM source SHA + does NOT include screening warning.
  const closing = r.paragraphs[r.paragraphs.length - 1];
  assert.match(closing, /FCCAM/);
  assert.doesNotMatch(closing, /SCREENING-grade/);
});

test('methodology + closing name Berry analytical when engine=berry-1968-screening', () => {
  const r = buildAmNightNarrative(mkExhibit({
    ...FULL_NIF_PASS,
    engine: 'berry-1968-screening', source: 'berry-1968-screening'
  }));
  // Methodology names Berry + the screening grade + the §73.190(c) cite.
  assert.match(r.paragraphs[1], /Berry analytical model/);
  assert.match(r.paragraphs[1], /SCREENING-grade/);
  assert.match(r.paragraphs[1], /73\.190\(c\)/);
  assert.match(r.paragraphs[1], /re-run with FCCAM/);
  assert.doesNotMatch(r.paragraphs[1], /Wang 1985 model/);
  // Closing: drops the "same FCCAM source SHA" claim (since Berry has
  // no source SHA), adds the screening warning.
  const closing = r.paragraphs[r.paragraphs.length - 1];
  assert.match(closing, /Berry analytical model/);
  assert.match(closing, /SCREENING-grade/);
  assert.match(closing, /Re-run with FCCAM/);
  assert.doesNotMatch(closing, /FCCAM source SHA/);
});

test('engine identity defaults to FCCAM when missing (older orchestrator shape)', () => {
  const nifWithoutEngine = { ...FULL_NIF_PASS };
  delete nifWithoutEngine.engine;
  delete nifWithoutEngine.source;
  const r = buildAmNightNarrative(mkExhibit(nifWithoutEngine));
  assert.match(r.paragraphs[1], /FCCAM/);
  assert.doesNotMatch(r.paragraphs[1], /Berry/);
});

/* ---------- determinism ---------- */

test('buildAmNightNarrative: deterministic — same inputs produce identical paragraphs', () => {
  const a = buildAmNightNarrative(mkExhibit(FULL_NIF_PASS));
  const b = buildAmNightNarrative(mkExhibit(FULL_NIF_PASS));
  assert.deepEqual(a, b);
});

/* ---------- appendix wiring ---------- */

test('appendices.js: narrative section emitted between summary KV + per-azimuth table when available', () => {
  const exhibit = {
    station_inputs: { ...PROPOSED, service: 'AM' },
    evidence:       { am_night_nif: FULL_NIF_PASS },
    radial_table:   [],
    method_versions:    {},
    validation_context: {}
  };
  const sections = buildAppendixSections(exhibit);
  const ids = sections.map((s) => s.id);
  const iSummary    = ids.indexOf('appendix-f');
  const iNarrative  = ids.indexOf('appendix-f-narrative');
  const iAzimuths   = ids.indexOf('appendix-f-azimuths');
  assert.ok(iSummary >= 0 && iNarrative >= 0 && iAzimuths >= 0,
            `expected appendix-f + narrative + azimuths; got: ${ids.join(', ')}`);
  assert.ok(iNarrative > iSummary, 'narrative should follow the summary KV');
  assert.ok(iNarrative < iAzimuths, 'narrative should precede the azimuths table');
});

test('appendices.js: narrative section omitted when nif available:false', () => {
  const exhibit = {
    station_inputs: { ...PROPOSED, service: 'AM' },
    evidence:       { am_night_nif: { available: false, error: 'FCCAM not configured' } },
    radial_table:   [],
    method_versions:    {},
    validation_context: {}
  };
  const sections = buildAppendixSections(exhibit);
  const ids = sections.map((s) => s.id);
  assert.ok(ids.includes('appendix-f'),
            `appendix-f NOT-RUN block should still render: ${ids.join(', ')}`);
  assert.ok(!ids.includes('appendix-f-narrative'));
});

/* ---------- provenance ---------- */

test('AM_NIGHT_NARRATIVE_PROVENANCE names §73.182 + 17 USC §105', () => {
  assert.match(AM_NIGHT_NARRATIVE_PROVENANCE.regulation, /73\.182/);
  assert.match(AM_NIGHT_NARRATIVE_PROVENANCE.license_basis, /17 USC §105/);
});
