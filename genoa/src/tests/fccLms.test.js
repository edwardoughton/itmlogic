// FCC LMS / public-file consolidated client tests.
//
// These tests exercise the parsers and the consolidated client with a
// fake fmqClient + a fake fetch.  No network calls.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  makeFccLmsClient,
  parseLicenseFromFmqRow,
  parsePublicFileFolder,
  FCC_LMS_PROVENANCE
} from '../evidence/fccLmsClient.js';

/* ---------------- parseLicenseFromFmqRow ---------------- */

test('parseLicenseFromFmqRow: missing row → available:false with reason', () => {
  const r = parseLicenseFromFmqRow(null);
  assert.equal(r.available, false);
  assert.match(r.reason, /no FMQ\/AMQ row/);
});

test('parseLicenseFromFmqRow: license expiring in 60 days → expiring_soon=true', () => {
  const future = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const row = {
    facility_id: '12345', call: 'KTEST', service: 'FM', fcc_class: 'A',
    frequency: 100.7, frequency_unit: 'MHz', erp_kw: 6, haat_m: 100,
    licensee: 'Test LLC', expiration_date: future, status: 'LIC'
  };
  const r = parseLicenseFromFmqRow(row, 180);
  assert.equal(r.available, true);
  assert.equal(r.expiring_soon, true);
  assert.equal(r.expired, false);
  assert.ok(r.days_to_expiration >= 58 && r.days_to_expiration <= 62);
});

test('parseLicenseFromFmqRow: license already expired → expired=true', () => {
  const past = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const r = parseLicenseFromFmqRow({ call: 'KEXP', expiration_date: past }, 180);
  assert.equal(r.expired, true);
  assert.ok(r.days_to_expiration < 0);
});

test('parseLicenseFromFmqRow: license well-future → expiring_soon=false', () => {
  const far = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const r = parseLicenseFromFmqRow({ call: 'KOK', expiration_date: far }, 180);
  assert.equal(r.expiring_soon, false);
  assert.equal(r.expired,       false);
  assert.ok(r.days_to_expiration > 180);
});

test('parseLicenseFromFmqRow: configurable expiring_soon window', () => {
  const future = new Date(Date.now() + 100 * 86_400_000).toISOString().slice(0, 10);
  const w180 = parseLicenseFromFmqRow({ call: 'K', expiration_date: future }, 180);
  const w30  = parseLicenseFromFmqRow({ call: 'K', expiration_date: future }, 30);
  assert.equal(w180.expiring_soon, true);
  assert.equal(w30.expiring_soon,  false);
});

/* ---------------- parsePublicFileFolder ---------------- */

test('parsePublicFileFolder: contents-style response → folders + documents counted', () => {
  const j = {
    id: 'fm/53996', name: '53996',
    contents: [
      { type: 'folder', name: 'Authorizations' },
      { type: 'folder', name: 'EEO-Public-File-Report' },
      { type: 'folder', name: 'Issues-and-Programs-Lists' },
      { type: 'folder', name: 'Political-File' },
      { type: 'file',   name: 'authorization-2026.pdf' }
    ]
  };
  const r = parsePublicFileFolder(j, 'http://test/folder');
  assert.equal(r.available, true);
  assert.equal(r.folder_count, 4);
  assert.equal(r.file_count,   1);
  assert.ok(r.required_folders.present_count >= 4);
});

test('parsePublicFileFolder: missing required folders flagged', () => {
  const j = {
    contents: [
      { type: 'folder', name: 'Authorizations' }    // only one of many
    ]
  };
  const r = parsePublicFileFolder(j, 'http://test/folder');
  assert.equal(r.required_folders.present_count, 1);
  assert.ok(r.required_folders.missing.length >= 5);
});

test('parsePublicFileFolder: bad JSON → available:false with error', () => {
  const r = parsePublicFileFolder(null, 'http://test/folder');
  assert.equal(r.available, false);
  assert.equal(r.folder_url, 'http://test/folder');
});

test('parsePublicFileFolder: explicit folders/documents arrays both supported', () => {
  const j = {
    folders:   [{ name: 'Authorizations' }, { name: 'Political-File' }],
    documents: [{ name: 'a.pdf' }]
  };
  const r = parsePublicFileFolder(j, 'http://x');
  assert.equal(r.folder_count, 2);
  assert.equal(r.file_count,   1);
});

/* ---------------- consolidated getStationRecord ---------------- */

function fakeFmqClient(rowOrNull){
  return {
    async searchByCallsign(_call){
      return rowOrNull
        ? { rows: [rowOrNull], source: 'fcc-fmq' }
        : { rows: [],          source: 'fcc-fmq' };
    }
  };
}

function withFetch(fakeFetch, fn){
  const orig = global.fetch;
  global.fetch = fakeFetch;
  return Promise.resolve(fn()).finally(() => { global.fetch = orig; });
}

test('getStationRecord: missing call AND facility_id → guard error', async () => {
  const lms = makeFccLmsClient({ fmqClient: fakeFmqClient(null) });
  const r = await lms.getStationRecord({});
  assert.equal(r.available, false);
  assert.match(r.error, /call or facility_id/);
});

test('getStationRecord: FMQ row found + public file 404 → license available, public file unavailable', async () => {
  const future = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const fmq = fakeFmqClient({
    facility_id: '12345', call: 'KTEST', service: 'FM', fcc_class: 'A',
    frequency: 100.7, frequency_unit: 'MHz', expiration_date: future, status: 'LIC',
    facility_lookup_source: { upstream: 'fcc-fmq', endpoint: 'https://transition.fcc.gov/fcc-bin/fmq' }
  });
  await withFetch(async () => ({ ok: false, status: 404 }), async () => {
    const lms = makeFccLmsClient({ fmqClient: fmq });
    const r = await lms.getStationRecord({ call: 'KTEST', service: 'FM' });
    assert.equal(r.available, true);
    assert.equal(r.license.available, true);
    assert.equal(r.license.call, 'KTEST');
    assert.equal(r.public_file.available, false);
    assert.ok(r.errors.some(e => /publicfiles/.test(e)));
  });
});

test('getStationRecord: FMQ row + public file folder both reachable', async () => {
  const future = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const fmq = fakeFmqClient({
    facility_id: '53996', call: 'KSLX-FM', service: 'FM', fcc_class: 'A',
    frequency: 100.7, frequency_unit: 'MHz', expiration_date: future
  });
  await withFetch(async (url) => ({
    ok: true, status: 200,
    async json(){ return {
      id: 'fm/53996',
      contents: [
        { type: 'folder', name: 'Authorizations' },
        { type: 'folder', name: 'EEO-Public-File-Report' },
        { type: 'folder', name: 'Political-File' }
      ]
    }; }
  }), async () => {
    const lms = makeFccLmsClient({ fmqClient: fmq });
    const r = await lms.getStationRecord({ call: 'KSLX-FM', service: 'FM' });
    assert.equal(r.available, true);
    assert.equal(r.license.available, true);
    assert.equal(r.public_file.available, true);
    assert.match(r.public_file.folder_url, /\/fm\/53996\/contents/);
    assert.equal(r.sources_tried.includes('fcc-fmq'), true);
    assert.equal(r.sources_tried.includes('publicfiles.fcc.gov'), true);
    assert.match(r.authorization_history.deeper_review_url, /enterpriseefiling\.fcc\.gov/);
  });
});

test('getStationRecord: no FMQ row + no facility_id → public-file probe also skipped', async () => {
  await withFetch(async () => { throw new Error('SHOULD NOT FETCH'); }, async () => {
    const lms = makeFccLmsClient({ fmqClient: fakeFmqClient(null) });
    const r = await lms.getStationRecord({ call: 'KGHOST' });
    assert.equal(r.available, false);
    assert.equal(r.license.available, false);
    assert.equal(r.public_file.available, false);
  });
});

test('getStationRecord: FCC_PUBLIC_FILES_DISABLE=1 skips the public-file probe', async () => {
  const future = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  const fmq = fakeFmqClient({
    facility_id: '12345', call: 'KTEST', service: 'FM',
    expiration_date: future
  });
  let pfilesCalls = 0;
  await withFetch(async () => { pfilesCalls++; return { ok: false, status: 500 }; }, async () => {
    const lms = makeFccLmsClient({ fmqClient: fmq, publicFilesEnabled: false });
    const r = await lms.getStationRecord({ call: 'KTEST', service: 'FM' });
    assert.equal(r.license.available, true);
    assert.equal(r.public_file.available, false);
    assert.equal(pfilesCalls, 0, 'public-file probe should be skipped');
  });
});

/* ---------------- provenance ---------------- */

test('FCC_LMS_PROVENANCE names regulation + upstreams + license basis', () => {
  assert.match(FCC_LMS_PROVENANCE.regulation, /73\.3526/);
  assert.match(FCC_LMS_PROVENANCE.regulation, /73\.1620/);
  assert.ok(FCC_LMS_PROVENANCE.upstreams.some(u => /transition\.fcc\.gov/.test(u.endpoint)));
  assert.ok(FCC_LMS_PROVENANCE.upstreams.some(u => /publicfiles\.fcc\.gov/.test(u.endpoint)));
  assert.ok(FCC_LMS_PROVENANCE.upstreams.every(u => /17 USC §105/.test(u.license_basis)));
});
