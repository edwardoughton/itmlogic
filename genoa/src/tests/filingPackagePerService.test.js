// Per-service filing-package mappers — contract tests.
//
// Asserts:
//   1. mapping.js routes the right form_meta for each service:
//        AM   → Form 301-AM  (form_id '301-AM')
//        FM   → Form 301-FM  (form_id '301-FM')   (legacy)
//        FX   → Form 349     (form_id '349')
//        LPFM → Form 318     (form_id '318')
//   2. AM filings carry the AM-specific schema language:
//        - Class A/B/C/D enum (NOT FM A/B1/B/C0/C1/C2/C3)
//        - "power" language (NOT "ERP")
//        - §73.183/.184/.182/.187/.190/.99 citations present
//        - NO HAAT field
//   3. FM filings still produce the prior field shape (no regression).
//   4. Every field carries { source, status, value, provenance,
//      engineer_confirmation_required? }.
//   5. _readiness.gateFilingReady gates correctly and advisory
//      evidence (am_physics, geo_rf_evidence) is NEVER a filing gap.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFilingPackage } from '../exports/lmsFiling/packager.js';
import { mapForm301Fm, selectSchemaForService } from '../exports/lmsFiling/mapping.js';
import { gateFilingReady, FieldStatus, ADVISORY_EVIDENCE_KEYS } from '../exports/lmsFiling/_readiness.js';
import { FORM_301_AM_FIELDS, FORM_301_AM_META } from '../exports/lmsFiling/form301am.js';
import { FORM_349_META } from '../exports/lmsFiling/form349.js';
import { FORM_318_META } from '../exports/lmsFiling/form318.js';

// ── Fixtures ───────────────────────────────────────────────────────

const KAZM_AM = {
  station_inputs: {
    call: 'KAZM',
    facility_id: '35149',
    service: 'AM',
    fcc_class: 'C',
    frequency_khz: 780,
    power_day_kw: 1.0,
    power_night_kw: 0.052,
    community: 'Sedona',
    lat: 34.86833,
    lon: -111.79111,
    tower_count: 1,
    rms_field_mv_m: 309,
    m3_conductivity_zone: '4 mS/m'
  },
  evidence: {}
};

const WFAN_AM = {
  station_inputs: {
    call: 'WFAN',
    facility_id: '28617',
    service: 'AM',
    fcc_class: 'A',
    frequency_khz: 660,
    power_day_kw: 50,
    power_night_kw: 50,
    community: 'New York',
    lat: 40.859833,
    lon: -73.785417,
    tower_count: 6,
    m3_conductivity_zone: '15 mS/m (coastal)'
  },
  evidence: {}
};

const WPLJ_FM = {
  station_inputs: {
    call: 'WPLJ',
    facility_id: '36479',
    service: 'FM',
    fcc_class: 'B',
    frequency: 95.5,
    erp_kw: 6.0,
    haat_m_input: 410,
    community: 'New York',
    lat: 40.7488,
    lon: -73.9858
  },
  evidence: {}
};

// ── 1. Service routing → correct form_meta ────────────────────────

test('mapping routes AM → Form 301-AM', () => {
  const r = selectSchemaForService('AM');
  assert.equal(r.key, 'AM');
  assert.equal(r.meta.form_id, '301-AM');
});

test('mapping routes FM → Form 301-FM (legacy preserved)', () => {
  const r = selectSchemaForService('FM');
  assert.equal(r.key, 'FM');
  assert.equal(r.meta.form_id, '301-FM');
});

test('mapping routes FX → Form 349', () => {
  const r = selectSchemaForService('FX');
  assert.equal(r.key, 'FX');
  assert.equal(r.meta.form_id, '349');
});

test('mapping routes LPFM → Form 318', () => {
  const r = selectSchemaForService('LPFM');
  assert.equal(r.key, 'LPFM');
  assert.equal(r.meta.form_id, '318');
});

test('mapping defaults to FM when service is unknown / blank', () => {
  assert.equal(selectSchemaForService(null).meta.form_id, '301-FM');
  assert.equal(selectSchemaForService('').meta.form_id, '301-FM');
});

// ── 2. AM-specific schema language ────────────────────────────────

test('Form 301-AM has Class A/B/C/D enum (not FM classes)', () => {
  const cls = FORM_301_AM_FIELDS.find(f => f.id === 'am-class');
  assert.ok(cls, 'am-class field must exist');
  assert.deepEqual([...cls.options].sort(), ['A','B','C','D']);
});

test('Form 301-AM uses "power" language, NOT "ERP"', () => {
  const labels = FORM_301_AM_FIELDS.map(f => f.lms_label).join(' || ');
  assert.match(labels, /Authorized antenna input power/i);
  // 'ERP' must NOT appear anywhere in an AM-form lms_label.
  for (const f of FORM_301_AM_FIELDS){
    assert.ok(!/\bERP\b/.test(f.lms_label),
      `AM field ${f.id} must not contain "ERP" in its label: ${f.lms_label}`);
  }
});

test('Form 301-AM has no HAAT field', () => {
  for (const f of FORM_301_AM_FIELDS){
    assert.ok(!/HAAT/i.test(f.id) && !/HAAT/.test(f.lms_label),
      `AM field ${f.id} unexpectedly mentions HAAT: ${f.lms_label}`);
  }
});

test('Form 301-AM cites the AM §73.x sections', () => {
  const cites = FORM_301_AM_FIELDS.map(f => f.cite || '').join(' || ');
  for (const expected of ['73.183', '73.184', '73.182', '73.187', '73.190', '73.99']){
    assert.match(cites, new RegExp(`§${expected.replace('.', '\\.')}`),
      `AM schema must cite §${expected}`);
  }
});

test('Form 301-AM cites groundwave concepts (NOT FM contour concepts)', () => {
  const allText = FORM_301_AM_FIELDS
    .map(f => `${f.lms_label} ${f.notes || ''}`)
    .join(' || ');
  assert.match(allText, /groundwave/i);
  // The FM-specific "service / protected / interfering" trio of
  // contour names must not appear in the AM AM-form schema labels.
  const fmContourLabels = FORM_301_AM_FIELDS.filter(f =>
    /60\s*dBu|40\s*dBu|F\(50,10\)/i.test(f.lms_label));
  assert.equal(fmContourLabels.length, 0,
    'AM form must not carry FM dBu / F(50,10) contour labels');
});

// ── 3. KAZM AM filing-package end-to-end ──────────────────────────

test('KAZM AM filing package routes to Form 301-AM', () => {
  const pkg = buildFilingPackage(KAZM_AM);
  const j = JSON.parse(pkg.json);
  assert.equal(j.form.form_id, '301-AM');
  assert.match(j.schema, /form_301_am/);
  assert.match(pkg.filename_stem, /form301am-filing-package$/);
  // Filing cheatsheet must not contain FM contour vocabulary.
  assert.ok(!/60\s*dBu/.test(pkg.plain_text), 'AM cheatsheet must not mention 60 dBu');
  assert.ok(!/F\(50,10\)/.test(pkg.plain_text), 'AM cheatsheet must not mention F(50,10)');
});

test('KAZM AM filing package fills key AM-specific fields', () => {
  const pkg = buildFilingPackage(KAZM_AM);
  const j = JSON.parse(pkg.json);
  const byId = Object.fromEntries(j.fields.map(f => [f.id, f]));
  assert.equal(byId['am-class'].status, 'filled');
  assert.equal(byId['am-class'].value, 'C');
  assert.equal(byId['frequency-khz'].status, 'filled');
  assert.equal(byId['frequency-khz'].value, 780);
  assert.equal(byId['power-day-kw'].status, 'filled');
  assert.equal(byId['power-day-kw'].value, 1.0);
  assert.equal(byId['rms-groundwave-field-1km'].status, 'filled');
  assert.equal(byId['rms-groundwave-field-1km'].value, 309);
});

test('WFAN AM (Class A) gets the Class A primary service contour (0.1 mV/m)', () => {
  const pkg = buildFilingPackage(WFAN_AM);
  const j = JSON.parse(pkg.json);
  const psc = j.fields.find(f => f.id === 'primary-service-contour-mv-m');
  assert.equal(psc.value, 0.1);
  const ssc = j.fields.find(f => f.id === 'secondary-service-contour-mv-m');
  // Class A → secondary service contour is defined (0.5 mV/m skywave)
  assert.equal(ssc.value, 0.5);
});

test('KAZM AM (Class C) does NOT carry a secondary service contour', () => {
  const pkg = buildFilingPackage(KAZM_AM);
  const j = JSON.parse(pkg.json);
  const ssc = j.fields.find(f => f.id === 'secondary-service-contour-mv-m');
  assert.equal(ssc.value, null);  // §73.182(c) Class A only
});

// ── 4. FM still works (no regression) ─────────────────────────────

test('WPLJ FM filing package still routes to Form 301-FM', () => {
  const pkg = buildFilingPackage(WPLJ_FM);
  const j = JSON.parse(pkg.json);
  assert.equal(j.form.form_id, '301-FM');
  assert.match(pkg.filename_stem, /form301fm-filing-package$/);
  // FM should still carry its HAAT field.
  const haat = j.fields.find(f => f.id === 'haat-m');
  assert.ok(haat, 'FM form must still have haat-m');
  assert.equal(haat.value, 410);
  // Class field uses FM enum (look it up in mapped output's form schema).
  const m = mapForm301Fm(WPLJ_FM);
  const clsSchema = m.fields.find(f => f.id === 'fcc-class');
  assert.ok(clsSchema && Array.isArray(clsSchema.options));
  assert.ok(clsSchema.options.includes('B1'), 'FM class enum must still include B1');
});

// ── 5. Per-field shape ────────────────────────────────────────────

test('every AM field carries source/status/value/provenance keys', () => {
  const pkg = buildFilingPackage(KAZM_AM);
  const j = JSON.parse(pkg.json);
  for (const f of j.fields){
    assert.ok('source' in f, `field ${f.id} missing source`);
    assert.ok('status' in f, `field ${f.id} missing status`);
    assert.ok('value' in f, `field ${f.id} missing value`);
    assert.ok('provenance' in f, `field ${f.id} missing provenance`);
    // engineer_confirmation_required must at least be defined
    assert.ok('engineer_confirmation_required' in f,
      `field ${f.id} missing engineer_confirmation_required`);
  }
});

test('manual-engineer fields flag engineer_confirmation_required', () => {
  const pkg = buildFilingPackage(KAZM_AM);
  const j = JSON.parse(pkg.json);
  const ground = j.fields.find(f => f.id === 'ground-system-radials');
  // manual-engineer + no operator input + required → must flag confirmation
  assert.equal(ground.source, 'manual-engineer');
  assert.equal(ground.engineer_confirmation_required, true);
});

// ── 6. Readiness gating ───────────────────────────────────────────

test('gateFilingReady returns ready when no gaps / blockers', () => {
  const r = gateFilingReady({
    fields: [
      { required: true, status: FieldStatus.FILLED },
      { required: true, status: FieldStatus.NOT_APPLICABLE }
    ],
    blockers: 0
  });
  assert.equal(r.ready, true);
  assert.equal(r.gating_reason, null);
});

test('gateFilingReady blocks on NEEDS_INPUT required field', () => {
  const r = gateFilingReady({
    fields: [
      { required: true, status: FieldStatus.FILLED },
      { required: true, status: FieldStatus.NEEDS_INPUT }
    ],
    blockers: 0
  });
  assert.equal(r.ready, false);
  assert.match(r.gating_reason, /not filled/);
});

test('gateFilingReady blocks on engine blockers', () => {
  const r = gateFilingReady({ fields: [], blockers: 2 });
  assert.equal(r.ready, false);
  assert.match(r.gating_reason, /blocker/);
});

test('gateFilingReady blocks AM night NIF when azimuths fail', () => {
  const r = gateFilingReady({
    fields: [],
    blockers: 0,
    am_night_nif: { available: true, summary: { n_failing_azimuths: 3 } }
  });
  assert.equal(r.ready, false);
  assert.match(r.gating_reason, /NIF/);
});

test('gateFilingReady allows AM night NIF when all azimuths pass', () => {
  const r = gateFilingReady({
    fields: [],
    blockers: 0,
    am_night_nif: { available: true, summary: { n_failing_azimuths: 0, worst_margin_db: 4.2 } }
  });
  assert.equal(r.ready, true);
});

// ── 7. Advisory evidence is NEVER a filing gap (anti-regression) ──

test('ADVISORY_EVIDENCE_KEYS list includes am_physics, geo_rf_evidence, sdr_captures', () => {
  assert.ok(ADVISORY_EVIDENCE_KEYS.includes('am_physics'));
  assert.ok(ADVISORY_EVIDENCE_KEYS.includes('geo_rf_evidence'));
  assert.ok(ADVISORY_EVIDENCE_KEYS.includes('sdr_captures'));
});

test('adding am_physics advisory evidence does NOT change filing_ready', () => {
  const without = buildFilingPackage(KAZM_AM);
  const withAp = buildFilingPackage({
    ...KAZM_AM,
    evidence: {
      ...KAZM_AM.evidence,
      am_physics: {
        status: 'run',
        advisory: true,
        filing_effect: 'none',
        outputs: { grid_sha256: 'abc123' },
        fetched_at: '2026-05-16T00:00:00Z'
      }
    }
  });
  assert.equal(without.filing_ready, withAp.filing_ready);
  assert.equal(without.blockers_count, withAp.blockers_count);
});

test('adding geo_rf_evidence does NOT add or remove LMS fields on an AM exhibit', () => {
  const without = JSON.parse(buildFilingPackage(KAZM_AM).json);
  const withGeo = JSON.parse(buildFilingPackage({
    ...KAZM_AM,
    evidence: {
      ...KAZM_AM.evidence,
      geo_rf_evidence: {
        status: 'run',
        advisory: true,
        filing_effect: 'none',
        datasets: { tree_canopy_conus: { value_numeric: 12, dataset: 'tcc-2022' } }
      }
    }
  }).json);
  const fp = (j) => j.fields.map(f => `${f.id}::${f.status}`);
  assert.deepEqual(fp(without), fp(withGeo),
    'advisory geo_rf_evidence must not alter LMS field statuses');
});

// ── 8. Form 301-AM META meets the schema-version contract ────────

test('Form 301-AM META declares its LMS revision', () => {
  assert.ok(FORM_301_AM_META.lms_revision);
  assert.match(FORM_301_AM_META.form_title, /AM/);
});

test('Form 349 META is FM-translator-shaped', () => {
  assert.equal(FORM_349_META.form_id, '349');
  assert.match(FORM_349_META.form_title, /FM Translator|FM Booster/);
});

test('Form 318 META is LPFM-shaped', () => {
  assert.equal(FORM_318_META.form_id, '318');
  assert.match(FORM_318_META.form_title, /Low Power FM/);
});

// ── 9. mapForm301Fm back-compat alias still routes by service ────

test('mapForm301Fm alias routes AM exhibit to Form 301-AM (not FM)', () => {
  const m = mapForm301Fm(KAZM_AM);
  assert.equal(m.form.form_id, '301-AM');
});

// ── 10. Submission scaffolding: every form has LMS portal + checklist ──
//
// The cheatsheet's whole purpose is to get an engineer to "submission
// ready".  Each form META must therefore carry:
//   - lms_portal_url    (the actual FCC LMS portal entry)
//   - lms_schedule      (Schedule 301-FM / Schedule 349 / etc.)
//   - lms_filing_path   (one-line breadcrumb of clicks inside LMS)
//   - submission_checklist (array of pre-flight items the engineer
//                           verifies before upload)
// Missing any of these means the cheatsheet won't tell the engineer
// where to file or what to attach — which defeats the point.

import { FORM_301_FM_META } from '../exports/lmsFiling/form301fm.js';
const ALL_FORM_METAS = [
  ['301-FM', FORM_301_FM_META],
  ['301-AM', FORM_301_AM_META],
  ['349',    FORM_349_META],
  ['318',    FORM_318_META]
];

for (const [label, meta] of ALL_FORM_METAS){
  test(`${label} META carries LMS portal URL + schedule + filing path`, () => {
    assert.match(meta.lms_portal_url, /^https:\/\/enterpriseefiling\.fcc\.gov/,
      `${label}.lms_portal_url must point at the FCC LMS entry`);
    assert.match(meta.lms_schedule, /Schedule/, `${label}.lms_schedule should reference its LMS Schedule`);
    assert.ok(meta.lms_filing_path && meta.lms_filing_path.length > 40,
      `${label}.lms_filing_path must be a usable breadcrumb`);
  });
  test(`${label} META carries a non-trivial submission checklist`, () => {
    assert.ok(Array.isArray(meta.submission_checklist), `${label}.submission_checklist must be an array`);
    assert.ok(meta.submission_checklist.length >= 5,
      `${label} checklist has ${meta.submission_checklist.length} items — too thin to be useful pre-flight`);
    for (const item of meta.submission_checklist){
      assert.equal(typeof item, 'string');
      assert.ok(item.length > 20, `checklist item too terse: "${item}"`);
    }
  });
}

test('cheatsheet HTML embeds the portal URL + schedule + checklist for FM CP', () => {
  const pkg = buildFilingPackage({
    station_inputs: { call: 'WTST', service: 'FM', frequency: 100.7, lat: 40, lon: -75,
                      erp_kw: 6, haat_m: 100, fcc_class: 'A' },
    evidence: {}
  });
  assert.match(pkg.html, /enterpriseefiling\.fcc\.gov/, 'HTML must surface the LMS portal URL');
  assert.match(pkg.html, /Schedule 301-FM/, 'HTML must surface the LMS schedule name');
  assert.match(pkg.html, /Pre-flight checklist/i, 'HTML must include the pre-flight checklist section');
  assert.match(pkg.html, /Engineering Statement PDF/, 'HTML must list the PDF as a required attachment');
  // Header used to be hardcoded "Form 301-FM" — verify the form_id is now templated.
  assert.match(pkg.html, /FCC Form 301-FM/);
});

test('cheatsheet HTML retitles correctly for an AM filing (no "Form 301-FM" hardcode)', () => {
  const pkg = buildFilingPackage(KAZM_AM);
  assert.match(pkg.html, /FCC Form 301-AM/, 'AM filing must render as Form 301-AM, not Form 301-FM');
  assert.doesNotMatch(pkg.html, /<h1>[^<]*Form 301-FM[^<]*<\/h1>/, 'AM filing must not render an FM h1');
  assert.match(pkg.html, /Schedule 301-AM/);
});

test('cheatsheet plain-text retitles correctly for FM translator (Form 349)', () => {
  const pkg = buildFilingPackage({
    station_inputs: { call: 'W123XY', service: 'FX', frequency: 92.1, lat: 40, lon: -75,
                      erp_kw: 0.250, haat_m: 30 },
    evidence: {}
  });
  assert.match(pkg.plain_text, /FCC FORM 349/, 'translator filing must render as Form 349');
  assert.match(pkg.plain_text, /SUBMISSION PORTAL/);
  assert.match(pkg.plain_text, /PRE-FLIGHT CHECKLIST/);
});
