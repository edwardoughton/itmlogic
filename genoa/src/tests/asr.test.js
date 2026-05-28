// 47 CFR §17.4 ASR (Antenna Structure Registration) cross-check tests.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAsrClient, checkAsrAgainstApplication, ASR_PROVENANCE } from '../evidence/asrClient.js';

const ASR_RECORD = {
  available: true,
  source: 'asr-sidecar',
  endpoint: 'http://asr-sidecar.test/api/v1/asr/1234567',
  asr_number:           '1234567',
  latitude_deg:          33.331440,
  longitude_deg:        -112.063750,
  overall_height_m:      305,
  overall_height_amsl_m: 855,
  ground_elevation_m:    550,
  lighting_requirement:  'A2',
  painting_requirement:  'orange/white',
  owner:                 'Test Tower LLC',
  status:                'CONSTRUCTED'
};

/* ---------- client construction ---------- */

test('makeAsrClient: returns null when no source configured', () => {
  // Socrata is on by default since PR1 (opendata.fcc.gov ASR DB).
  // The test of "no source configured" must also disable that tier.
  const fc = makeAsrClient({ ztrUrl: null, asrSidecarUrl: null, htmlFallback: false, socrataUrl: null });
  assert.equal(fc, null);
});

test('makeAsrClient: surfaces source flags', () => {
  const fc = makeAsrClient({ ztrUrl: 'http://z', asrSidecarUrl: 'http://a', htmlFallback: false });
  assert.equal(fc.sources.ztr,         true);
  assert.equal(fc.sources.asr_sidecar, true);
  assert.equal(fc.sources.uls_html,    false);
});

/* ---------- extractFromRichStation ---------- */

test('extractFromRichStation: pulls asr_number + tower data from ZTR rich payload', () => {
  const fc = makeAsrClient({ ztrUrl: 'http://z' });
  const rich = {
    available: true,
    endpoint: 'http://z/api/radiodns/station/757546',
    fetched_at: '2026-05-06T00:00:00Z',
    station: {
      facility_id: '11282', call: 'KSLX-FM',
      asr_number: '1234567',
      _tower: {
        latitude_deg: 33.33144, longitude_deg: -112.06375,
        overall_height_m: 305, ground_elevation_m: 550,
        lighting_requirement: 'A2', painting_requirement: 'orange/white',
        owner: 'Test Tower LLC', status: 'CONSTRUCTED'
      }
    }
  };
  const r = fc.extractFromRichStation(rich);
  assert.equal(r.available, true);
  assert.equal(r.asr_number, '1234567');
  assert.equal(r.latitude_deg, 33.33144);
  assert.equal(r.overall_height_m, 305);
  // AMSL derived from AGL + ground elevation when not explicitly carried
  assert.equal(r.overall_height_amsl_m, 855);
});

test('extractFromRichStation: missing asr_number returns structured failure', () => {
  const fc = makeAsrClient({ ztrUrl: 'http://z' });
  const rich = { available: true, endpoint: 'http://z/r', station: { call: 'KX' } };
  const r = fc.extractFromRichStation(rich);
  assert.equal(r.available, false);
  assert.match(r.error, /did not carry an asr_number/);
});

test('extractFromRichStation: schema variants — asrn / antenna_structure_registration', () => {
  const fc = makeAsrClient({ ztrUrl: 'http://z' });
  const rich1 = { available: true, station: { asrn: '99' } };
  const r1 = fc.extractFromRichStation(rich1);
  assert.equal(r1.asr_number, '99');
  const rich2 = { available: true, station: { antenna_structure_registration: '7777777' } };
  const r2 = fc.extractFromRichStation(rich2);
  assert.equal(r2.asr_number, '7777777');
});

test('extractFromRichStation: nested _tower.asr_number is picked up', () => {
  const fc = makeAsrClient({ ztrUrl: 'http://z' });
  const rich = { available: true, station: { _tower: { asr_number: '8888888' } } };
  const r = fc.extractFromRichStation(rich);
  assert.equal(r.asr_number, '8888888');
});

/* ---------- cross-check ---------- */

test('checkAsrAgainstApplication: exact match → matches=true, no mismatches', () => {
  const r = checkAsrAgainstApplication({
    asr: ASR_RECORD,
    application: { asr_number: '1234567', lat: 33.331440, lon: -112.063750,
                    overall_height_m: 305, overall_height_amsl_m: 855 }
  });
  assert.equal(r.cross_check.matches, true);
  assert.equal(r.cross_check.n_mismatches, 0);
});

test('checkAsrAgainstApplication: lat off by 5 arcsec → minor mismatch', () => {
  // 5 arcsec ≈ 0.00139° → just over the 1-arcsec tolerance, but well below 10×.
  const r = checkAsrAgainstApplication({
    asr: ASR_RECORD,
    application: { asr_number: '1234567', lat: 33.331440 + 5/3600, lon: -112.063750,
                    overall_height_m: 305, overall_height_amsl_m: 855 }
  });
  assert.equal(r.cross_check.matches, false);
  assert.equal(r.cross_check.n_mismatches, 1);
  assert.equal(r.cross_check.mismatches[0].field, 'latitude_deg');
  assert.equal(r.cross_check.mismatches[0].severity, 'minor');
  assert.ok(Math.abs(r.cross_check.mismatches[0].delta_arcsec - 5) < 0.5);
});

test('checkAsrAgainstApplication: lat off by 30 arcsec → major mismatch', () => {
  // 30 arcsec > 10× the 1-arcsec tolerance → severity 'major'
  const r = checkAsrAgainstApplication({
    asr: ASR_RECORD,
    application: { asr_number: '1234567', lat: 33.331440 + 30/3600, lon: -112.063750,
                    overall_height_m: 305, overall_height_amsl_m: 855 }
  });
  assert.equal(r.cross_check.mismatches[0].severity, 'major');
});

test('checkAsrAgainstApplication: overall_height_m off by 10 m → major mismatch', () => {
  // 10 m > 5× the 1 m tolerance → severity 'major'
  const r = checkAsrAgainstApplication({
    asr: ASR_RECORD,
    application: { asr_number: '1234567', lat: 33.331440, lon: -112.063750,
                    overall_height_m: 295, overall_height_amsl_m: 855 }
  });
  assert.equal(r.cross_check.matches, false);
  const m = r.cross_check.mismatches.find(x => x.field === 'overall_height_m');
  assert.ok(m);
  assert.equal(m.severity, 'major');
  assert.ok(Math.abs(m.delta_m - 10) < 0.01);
});

test('checkAsrAgainstApplication: ASR_number mismatch is flagged exactly', () => {
  const r = checkAsrAgainstApplication({
    asr: ASR_RECORD,
    application: { asr_number: '9999999', lat: 33.331440, lon: -112.063750 }
  });
  assert.equal(r.cross_check.matches, false);
  const m = r.cross_check.mismatches.find(x => x.field === 'asr_number');
  assert.ok(m);
  assert.equal(m.severity, 'mismatch');
});

test('checkAsrAgainstApplication: unavailable ASR → applicable=false', () => {
  const r = checkAsrAgainstApplication({
    asr: { available: false, source: null, error: 'no source' },
    application: { lat: 33, lon: -112 }
  });
  assert.equal(r.cross_check.applicable, false);
});

test('checkAsrAgainstApplication: missing application data → applicable=false', () => {
  const r = checkAsrAgainstApplication({ asr: ASR_RECORD, application: null });
  assert.equal(r.cross_check.applicable, false);
});

/* ---------- provenance ---------- */

test('ASR_PROVENANCE names §17.4, FAA Form 7460, fallback chain, license', () => {
  assert.match(ASR_PROVENANCE.regulation, /17\.4/);
  assert.ok(ASR_PROVENANCE.related.some(r => /FAA Form 7460/.test(r)));
  // PR1 promoted Socrata to the primary upstream; the legacy ULS HTML
  // path is the last-resort fallback.
  assert.match(ASR_PROVENANCE.upstream, /opendata\.fcc\.gov/);
  // Fallback chain grew from 3 (ZTR / sidecar / ULS HTML) to 4
  // (ZTR / Socrata / sidecar / ULS HTML) in PR1.
  assert.equal(ASR_PROVENANCE.fallback_chain.length, 4);
  assert.match(ASR_PROVENANCE.license_basis, /17 U\.S\.C\. § 105/);
});
