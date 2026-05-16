// Sanitizer tests — proves the payload sent to /api/exhibits/compute
// can never carry a React SyntheticEvent or a DOM node, even if a
// future onClick={fn} regression smuggles one in.
//
// Background: clicking "Compute exhibit" with a bare onClick={compute}
// passes the React SyntheticEvent as the first argument.  That object
// has nativeEvent, currentTarget, target, _reactName fields with
// circular references — JSON.stringify crashes with "Converting
// circular structure to JSON … HTMLButtonElement".  The wrappers
// (() => compute()) prevent it; this sanitizer is the seatbelt.

import test from 'node:test';
import assert from 'node:assert/strict';

import { stripDomAndReact } from '../ui/lib/stripDomAndReact.js';

// Build a fake SyntheticEvent shape (we don't have a real DOM here).
function fakeSyntheticEvent(){
  const target = { tagName: 'BUTTON', __reactFiber$x: { /* circular: */ } };
  target.__reactFiber$x.stateNode = target;          // self-cycle
  return {
    _reactName:    'onClick',
    nativeEvent:   { type: 'click', currentTarget: target },
    currentTarget: target,
    target,
    bubbles:       true,
    type:          'click'
  };
}

function fakeDomElement(){
  // Without jsdom, fake the duck-type check the sanitizer uses.
  const el = { tagName: 'BUTTON', innerHTML: '' };
  el.parent = el;                                    // circular
  return el;
}

test('SyntheticEvent at the top level is stripped to undefined', () => {
  const ev = fakeSyntheticEvent();
  assert.equal(stripDomAndReact(ev), undefined);
});

test('SyntheticEvent inside an inputs object is removed without breaking siblings', () => {
  const payload = {
    inputs: { call: 'KSLX-FM', frequency: 100.7, _event: fakeSyntheticEvent() }
  };
  const cleaned = stripDomAndReact(payload);
  // _event was a SyntheticEvent → key must be gone.
  assert.equal(cleaned.inputs._event, undefined);
  // Siblings must survive.
  assert.equal(cleaned.inputs.call, 'KSLX-FM');
  assert.equal(cleaned.inputs.frequency, 100.7);
});

test('Sanitized payload survives JSON.stringify (no circular crash)', () => {
  const payload = {
    inputs: { call: 'KSLX-FM' },
    accidental_event: fakeSyntheticEvent(),
    _react: { __reactFiber: 'cycle' }
  };
  const cleaned = stripDomAndReact(payload);
  // The core failure mode in production: this used to throw.
  let s;
  assert.doesNotThrow(() => { s = JSON.stringify(cleaned); });
  assert.equal(JSON.parse(s).inputs.call, 'KSLX-FM');
});

test('per-key strip: __react* keys dropped from otherwise safe inputs', () => {
  // A safe inputs object that happens to carry React-internal residue
  // (e.g. when state is captured from a DOM ref).  The object itself
  // is NOT classified as an event because no _reactName / nativeEvent
  // / currentTarget / target keys are present at the top level.
  const cleaned = stripDomAndReact({
    inputs: {
      call:                'KSLX',
      frequency:           100.7,
      __reactProps$x:      { x: 1 },
      __reactFiber$x:      { y: 2 }
    }
  });
  assert.equal(cleaned.inputs.call,             'KSLX');
  assert.equal(cleaned.inputs.frequency,        100.7);
  assert.equal(cleaned.inputs.__reactProps$x,   undefined, '__react*-prefixed keys must be dropped');
  assert.equal(cleaned.inputs.__reactFiber$x,   undefined, '__react*-prefixed keys must be dropped');
});

test('object that has all three event signals is classified as event and stripped wholesale', () => {
  // This is the protective behavior: when something LOOKS like an
  // event (target + currentTarget + nativeEvent + _reactName), the
  // entire object is dropped — we'd rather lose it than recurse into
  // a circular DOM tree.
  const looksLikeEvent = {
    target:        { tag: 'BUTTON' },
    currentTarget: { tag: 'BUTTON' },
    nativeEvent:   { type: 'click' },
    _reactName:    'onClick',
    incidental:    'value'
  };
  assert.equal(stripDomAndReact(looksLikeEvent), undefined);
});

test('Arrays of events become arrays without events', () => {
  const cleaned = stripDomAndReact([
    { call: 'A' },
    fakeSyntheticEvent(),
    { call: 'B' }
  ]);
  assert.deepEqual(cleaned, [{ call: 'A' }, { call: 'B' }]);
});

test('Plain primitives, null, and undefined pass through unchanged', () => {
  assert.equal(stripDomAndReact(42), 42);
  assert.equal(stripDomAndReact('hello'), 'hello');
  assert.equal(stripDomAndReact(null), null);
  assert.equal(stripDomAndReact(undefined), undefined);
  assert.equal(stripDomAndReact(true), true);
});

test('Nested compute payload (the production shape) round-trips intact', () => {
  const payload = {
    inputs: {
      call: 'KSLX-FM', facility_id: '11282',
      service: 'FM', fcc_class: 'C',
      frequency: 100.7, erp_kw: 100, haat_m: 561,
      lat: 33.331, lon: -112.063,
      pattern_table: null,
      use_terrain: true
    },
    options: { use_terrain: true }
  };
  const cleaned = stripDomAndReact(payload);
  assert.deepEqual(cleaned, payload);
  assert.equal(JSON.stringify(cleaned), JSON.stringify(payload));
});

test('Payload simulating a regressed onClick={compute} is sanitized into a valid request body', () => {
  // Simulate the failure mode: someone calls compute(event).  Inside
  // compute, the defensive `overrideInputs && overrideInputs.nativeEvent`
  // check drops it back to null — but if that check were removed, the
  // event would land in payload.inputs.  Prove the sanitizer catches it.
  const accidentalInputs = fakeSyntheticEvent();
  const payload = { inputs: accidentalInputs, options: {} };
  const cleaned = stripDomAndReact(payload);
  assert.equal(cleaned.inputs, undefined,
    'accidental SyntheticEvent under inputs must be stripped');
  let s;
  assert.doesNotThrow(() => { s = JSON.stringify(cleaned); });
  assert.ok(typeof s === 'string' && s.length > 0);
});
