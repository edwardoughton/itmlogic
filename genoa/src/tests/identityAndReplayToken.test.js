// Regression tests for two evidence-reporting-agent BLOCKERs:
//
//   1. Cover ↔ Executive Summary identity drift (KAZM-class).  The two
//      sections must report the same community-of-license and station
//      class for any exhibit, including shapes where the identity lives
//      ONLY in evidence.fcc_lms.license / facility_metadata.raw — i.e.
//      where the prior narrow executiveSummary chain fell back to "—
//      (community-of-license not stated)" while cover.js printed the
//      enriched value.
//
//   2. Appendix E checklist item 7: the HMAC-signed replay token must
//      appear on Appendix E.  Pre-fix it only lived in Build Attestation.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildCoverSection }            from '../exports/engineeringReport/sections/cover.js';
import { buildExecutiveSummarySection } from '../exports/engineeringReport/sections/executiveSummary.js';
import { buildAppendixSections }        from '../exports/engineeringReport/sections/appendices.js';

/* ─────────── Identity helper (BLOCKER-1) ─────────── */

test('cover + executive summary agree when community + class live only in evidence.fcc_lms.license', () => {
  const exhibit = {
    station_inputs: {
      call: 'KAZM', facility_id: '63881', service: 'FM',
      frequency: 102.5, frequency_unit: 'MHz', erp_kw: 4.6,
      lat: 35.0, lon: -111.7
    },
    evidence: {
      fcc_lms: {
        license: { community: 'SEDONA', fcc_class: 'C3' }
      }
    }
  };
  const cover = buildCoverSection(exhibit);
  const exec  = buildExecutiveSummarySection(exhibit);
  const coverRow = (label) => cover.rows.find(r => r[0] === label)?.[1];
  assert.equal(coverRow('Community of License'), 'SEDONA');
  assert.equal(coverRow('Class'), 'C3');
  // Executive summary ¶1 weaves community + class into prose.
  assert.match(exec.paragraphs[0], /SEDONA/);
  assert.match(exec.paragraphs[0], /Class C3/);
  assert.doesNotMatch(exec.paragraphs[0], /community-of-license not stated/);
});

test('cover + executive summary agree when community lives only in facility_metadata.raw', () => {
  const exhibit = {
    station_inputs: {
      call: 'KAZX', facility_id: '99999', service: 'FM',
      frequency: 92.1, frequency_unit: 'MHz', erp_kw: 6,
      lat: 32.3, lon: -110.9
    },
    facility_metadata: { raw: { community: 'CASAS ADOBES', fcc_class: 'A' } }
  };
  const cover = buildCoverSection(exhibit);
  const exec  = buildExecutiveSummarySection(exhibit);
  const coverRow = (label) => cover.rows.find(r => r[0] === label)?.[1];
  assert.equal(coverRow('Community of License'), 'CASAS ADOBES');
  assert.equal(coverRow('Class'), 'A');
  assert.match(exec.paragraphs[0], /CASAS ADOBES/);
  assert.match(exec.paragraphs[0], /Class A/);
});

test('cover + executive summary agree when community is on exhibit.licensing only', () => {
  // exec-summary historically reached exhibit.licensing; cover did not.
  // After the helper, cover should also resolve it.
  const exhibit = {
    station_inputs: { call: 'KTST', facility_id: '1', service: 'FM',
                      frequency: 100.1, frequency_unit: 'MHz' },
    licensing: { community: 'TUCSON', fcc_class: 'C' }
  };
  const cover = buildCoverSection(exhibit);
  const exec  = buildExecutiveSummarySection(exhibit);
  const coverRow = (label) => cover.rows.find(r => r[0] === label)?.[1];
  assert.equal(coverRow('Community of License'), 'TUCSON');
  assert.equal(coverRow('Class'), 'C');
  assert.match(exec.paragraphs[0], /TUCSON/);
});

test('both sections still render the not-stated placeholder when no source carries community', () => {
  const exhibit = {
    station_inputs: { call: 'KTST', facility_id: '1', service: 'FM',
                      frequency: 100.1, frequency_unit: 'MHz' }
  };
  const cover = buildCoverSection(exhibit);
  const exec  = buildExecutiveSummarySection(exhibit);
  const coverRow = (label) => cover.rows.find(r => r[0] === label)?.[1];
  assert.equal(coverRow('Community of License'), '—');
  assert.match(exec.paragraphs[0], /community-of-license not stated/);
});

/* ─────────── Appendix E replay token (BLOCKER-2) ─────────── */

function makeMinAmExhibit(extra = {}){
  return {
    station_inputs: { call: 'KRDM', service: 'AM', frequency: 1240,
                      frequency_unit: 'kHz', erp_kw: 1, ground_sigma_mS_m: 8,
                      lat: 44.27, lon: -121.14, radial_step_deg: 10 },
    method_versions: {
      curve_dataset: { meta_sha256: 'deadbeef00112233' },
      curve_engine: null
    },
    engine_signature: { fingerprint_sha256: 'a'.repeat(64) },
    generated_at: '2026-05-21T00:00:00Z',
    ...extra
  };
}

test('Appendix E includes the HMAC-signed replay token when exhibit.replay_token is present', () => {
  const tok = 'v1:' + 'b'.repeat(64) + ':' + 'c'.repeat(64);
  const x = makeMinAmExhibit({
    replay_token: tok,
    replay_digest: {
      exhibit_sha256:  'e'.repeat(64),
      inputs_sha256:   'i'.repeat(64),
      evidence_sha256: 'v'.repeat(64)
    }
  });
  const ae = buildAppendixSections(x).find(s => s.id === 'appendix-e');
  const get = (key) => ae.rows.find(r => r[0] === key)?.[1];
  assert.ok(get('Replay token (HMAC-signed)'), 'replay token row must exist');
  assert.ok(String(get('Replay token (HMAC-signed)')).startsWith(tok.slice(0, 32)),
            'token row must show the (truncated) literal token');
  assert.match(get('Replay token verifier'), /\/api\/exhibits\/verify-replay-token/);
  assert.equal(get('Replay digest — exhibit'),  'e'.repeat(64));
  assert.equal(get('Replay digest — inputs'),   'i'.repeat(64));
  assert.equal(get('Replay digest — evidence'), 'v'.repeat(64));
});

test('Appendix E reports the replay token as not attached when absent (no crash)', () => {
  const ae = buildAppendixSections(makeMinAmExhibit()).find(s => s.id === 'appendix-e');
  const get = (key) => ae.rows.find(r => r[0] === key)?.[1];
  assert.equal(get('Replay token (HMAC-signed)'), '(not attached)');
  assert.equal(get('Replay digest — exhibit'), '—');
});
