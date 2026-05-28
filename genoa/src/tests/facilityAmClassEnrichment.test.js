import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { enrichAmFromAmq, _resetAmClassCache } from '../api/services/facilityClient.js';

// The in-process AM-class cache is module-level; clear it before each
// test so cached entries from one test don't shadow another's fake fmq.
beforeEach(() => { _resetAmClassCache(); });

// Why this helper exists:
//   ZTR's broadcast_stations table does not carry the FCC AM service class
//   (A / B / C / D).  Without it, the AM-night orchestrator (§73.182 NIF +
//   §73.99 PSRA/PSSA) refuses to run because §73.183 D/U protection ratios
//   are class-dependent.  enrichAmFromAmq() patches ZTR rows by querying
//   FCC AMQ (the authoritative class-of-station data) for the matching
//   facility_id / callsign and patches fcc_class onto the row before it
//   reaches the form.
//
// All tests here use an injectable fake fmqClient — no network.

const WBOB_ZTR = {
  facility_id: '53588',
  call:        'WBOB',
  service:     'AM',
  fcc_class:   null,
  frequency:   600,
  frequency_unit: 'kHz'
};

const AMQ_WBOB = {
  facility_id: '53588',
  call:        'WBOB',
  service:     'AM',
  fcc_class:   'A'
};

function fakeFmq({ rows = [AMQ_WBOB], delayMs = 0, throwOnCall = false } = {}){
  return {
    async searchByCallsign(_call){
      if (throwOnCall) throw new Error('boom');
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      return { rows, source: 'fcc-fmq' };
    }
  };
}

/* ---------- happy path ---------- */

test('AM row with null fcc_class is patched with AMQ class', async () => {
  const out = await enrichAmFromAmq(WBOB_ZTR, fakeFmq());
  assert.equal(out.fcc_class, 'A');
  assert.equal(out.fcc_class_source, 'fcc-amq');
});

test('matching prefers facility_id over callsign', async () => {
  const fmq = fakeFmq({ rows: [
    { ...AMQ_WBOB, facility_id: '99999', fcc_class: 'D' },   // wrong facility
    { ...AMQ_WBOB,                       fcc_class: 'A' }    // correct
  ]});
  const out = await enrichAmFromAmq(WBOB_ZTR, fmq);
  assert.equal(out.fcc_class, 'A');
});

test('falls back to callsign match when facility_id absent on AMQ row', async () => {
  const fmq = fakeFmq({ rows: [{ ...AMQ_WBOB, facility_id: null, fcc_class: 'B' }] });
  const out = await enrichAmFromAmq(WBOB_ZTR, fmq);
  assert.equal(out.fcc_class, 'B');
});

/* ---------- guards: never modify non-AM rows ---------- */

test('FM row passes through unchanged (no AMQ call made)', async () => {
  let called = 0;
  const fmq = { async searchByCallsign(){ called++; return { rows: [] }; } };
  const fmRow = { ...WBOB_ZTR, service: 'FM' };
  const out = await enrichAmFromAmq(fmRow, fmq);
  assert.equal(out, fmRow, 'returned identity reference (no copy)');
  assert.equal(called, 0);
});

test('LPFM row passes through unchanged', async () => {
  let called = 0;
  const fmq = { async searchByCallsign(){ called++; return { rows: [] }; } };
  const out = await enrichAmFromAmq({ ...WBOB_ZTR, service: 'LPFM' }, fmq);
  assert.equal(out.service, 'LPFM');
  assert.equal(called, 0);
});

test('AM row that already has fcc_class is not re-queried', async () => {
  let called = 0;
  const fmq = { async searchByCallsign(){ called++; return { rows: [AMQ_WBOB] }; } };
  const already = { ...WBOB_ZTR, fcc_class: 'D' };
  const out = await enrichAmFromAmq(already, fmq);
  assert.equal(out.fcc_class, 'D');
  assert.equal(called, 0);
});

test('missing call → no AMQ call made (we have no key to look up)', async () => {
  let called = 0;
  const fmq = { async searchByCallsign(){ called++; return { rows: [AMQ_WBOB] }; } };
  const noCall = { ...WBOB_ZTR, call: null };
  const out = await enrichAmFromAmq(noCall, fmq);
  assert.equal(out.fcc_class, null);
  assert.equal(called, 0);
});

test('null fmqClient → row passes through unchanged', async () => {
  const out = await enrichAmFromAmq(WBOB_ZTR, null);
  assert.equal(out, WBOB_ZTR);
});

/* ---------- fail-soft ---------- */

test('AMQ throwing returns the ZTR row unchanged (does NOT propagate)', async () => {
  const out = await enrichAmFromAmq(WBOB_ZTR, fakeFmq({ throwOnCall: true }));
  assert.equal(out.fcc_class, null);
  assert.equal(out.fcc_class_source, undefined);
});

test('AMQ slower than 1 s budget → row passes through (timeout bound holds)', async () => {
  const t0 = Date.now();
  const out = await enrichAmFromAmq(WBOB_ZTR, fakeFmq({ delayMs: 1500 }));
  const elapsed = Date.now() - t0;
  assert.equal(out.fcc_class, null);
  assert.ok(elapsed < 1300, `should bail by ~1 s, took ${elapsed} ms`);
});

test('AMQ returns no matching AM row → fcc_class stays null, no spurious source', async () => {
  const out = await enrichAmFromAmq(WBOB_ZTR, fakeFmq({ rows: [] }));
  assert.equal(out.fcc_class, null);
  assert.equal(out.fcc_class_source, undefined);
});

test('AMQ returns FM rows for the same callsign → AM enrichment ignores them', async () => {
  const fmFromAmq = { ...AMQ_WBOB, service: 'FM', fcc_class: 'C1' };
  const out = await enrichAmFromAmq(WBOB_ZTR, fakeFmq({ rows: [fmFromAmq] }));
  assert.equal(out.fcc_class, null);
});

/* ---------- cache ---------- */

test('repeated enrichment for the same facility_id hits the in-process cache', async () => {
  // NB: the cache is module-level; this test asserts cache-hit behavior
  // by counting AMQ calls across two enrichments of an unseen station.
  let calls = 0;
  const fmq = {
    async searchByCallsign(){
      calls++;
      return { rows: [{ ...AMQ_WBOB, facility_id: 'cache-test-1', call: 'CTSTA', fcc_class: 'A' }] };
    }
  };
  const row = { ...WBOB_ZTR, facility_id: 'cache-test-1', call: 'CTSTA' };
  const a = await enrichAmFromAmq(row, fmq);
  const b = await enrichAmFromAmq(row, fmq);
  assert.equal(a.fcc_class, 'A');
  assert.equal(b.fcc_class, 'A');
  assert.equal(calls, 1, 'second enrichment must be cached');
  // Cache source tag distinguishes cached hits.
  assert.equal(b.fcc_class_source, 'fcc-amq-cache');
});
