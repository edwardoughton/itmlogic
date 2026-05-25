import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hhmmToMinutes,
  minutesToHhmm,
  buildPsraPssaWindows,
  classifyMode,
  buildMonthlySchedule,
  PSRA_PSSA_PROVENANCE
} from '../engine/am/psraPssa.js';

/* ---------- HH:MM ↔ minutes ---------- */

test('hhmmToMinutes: standard times', () => {
  assert.equal(hhmmToMinutes('00:00'), 0);
  assert.equal(hhmmToMinutes('06:00'), 360);
  assert.equal(hhmmToMinutes('12:30'), 750);
  assert.equal(hhmmToMinutes('18:00'), 1080);
  assert.equal(hhmmToMinutes('23:59'), 1439);
});

test('hhmmToMinutes: rejects bad input', () => {
  assert.ok(Number.isNaN(hhmmToMinutes('24:00')));
  assert.ok(Number.isNaN(hhmmToMinutes('12:60')));
  assert.ok(Number.isNaN(hhmmToMinutes('')));
  assert.ok(Number.isNaN(hhmmToMinutes(null)));
  assert.ok(Number.isNaN(hhmmToMinutes('hello')));
});

test('minutesToHhmm: zero-pads', () => {
  assert.equal(minutesToHhmm(0), '00:00');
  assert.equal(minutesToHhmm(360), '06:00');
  assert.equal(minutesToHhmm(1080), '18:00');
  assert.equal(minutesToHhmm(1439), '23:59');
});

/* ---------- buildPsraPssaWindows guards ---------- */

test('buildPsraPssaWindows: bad input rejected', () => {
  assert.equal(buildPsraPssaWindows({ sunrise: 'foo', sunset: '17:00' }).ok, false);
  assert.equal(buildPsraPssaWindows({ sunrise: '17:00', sunset: '06:00' }).ok, false);
  assert.equal(buildPsraPssaWindows({}).ok, false);
});

/* ---------- buildPsraPssaWindows happy path ---------- */

test('buildPsraPssaWindows: typical winter day in Phoenix (07:30 / 17:30)', () => {
  const r = buildPsraPssaWindows({
    sunrise: '07:30', sunset: '17:30',
    timezone_label: 'Mountain Standard Time (Arizona)'
  });
  assert.equal(r.ok, true);
  // Daytime: 07:30 → 17:30 = 600 min
  assert.equal(r.windows.daytime.duration_minutes, 600);
  assert.equal(r.windows.daytime.start, '07:30');
  assert.equal(r.windows.daytime.end,   '17:30');
  // PSRA: 06:00 → 07:30 = 90 min, applicable
  assert.equal(r.windows.psra.applicable, true);
  assert.equal(r.windows.psra.start, '06:00');
  assert.equal(r.windows.psra.end,   '07:30');
  assert.equal(r.windows.psra.duration_minutes, 90);
  // PSSA: 17:30 → 18:00 = 30 min, applicable
  assert.equal(r.windows.pssa.applicable, true);
  assert.equal(r.windows.pssa.start, '17:30');
  assert.equal(r.windows.pssa.end,   '18:00');
  assert.equal(r.windows.pssa.duration_minutes, 30);
  // Nighttime always 720 min total.
  assert.equal(r.windows.nighttime.duration_minutes, 720);
  assert.equal(r.windows.nighttime.wraps_midnight, true);
});

test('buildPsraPssaWindows: summer day with sunrise before 6 AM → no PSRA', () => {
  const r = buildPsraPssaWindows({ sunrise: '05:15', sunset: '20:45' });
  assert.equal(r.windows.psra.applicable, false);
  assert.equal(r.windows.psra.duration_minutes, 0);
  assert.match(r.windows.psra.note, /no PSRA window/);
});

test('buildPsraPssaWindows: summer day with sunset after 6 PM → no PSSA', () => {
  const r = buildPsraPssaWindows({ sunrise: '05:15', sunset: '20:45' });
  assert.equal(r.windows.pssa.applicable, false);
  assert.equal(r.windows.pssa.duration_minutes, 0);
  assert.match(r.windows.pssa.note, /no PSSA window/);
});

test('buildPsraPssaWindows: timezone label passes through', () => {
  const r = buildPsraPssaWindows({
    sunrise: '07:00', sunset: '17:00',
    timezone_label: 'Eastern Standard Time'
  });
  assert.equal(r.timezone_label, 'Eastern Standard Time');
});

/* ---------- classifyMode ---------- */

const WINTER_WINDOWS = buildPsraPssaWindows({ sunrise: '07:30', sunset: '17:30' });

test('classifyMode: 12:00 → daytime', () => {
  const r = classifyMode(WINTER_WINDOWS, '12:00');
  assert.equal(r.mode, 'daytime');
});

test('classifyMode: 06:30 → psra', () => {
  const r = classifyMode(WINTER_WINDOWS, '06:30');
  assert.equal(r.mode, 'psra');
  assert.equal(r.in_window.start, '06:00');
});

test('classifyMode: 17:45 → pssa', () => {
  const r = classifyMode(WINTER_WINDOWS, '17:45');
  assert.equal(r.mode, 'pssa');
});

test('classifyMode: 22:00 → nighttime', () => {
  const r = classifyMode(WINTER_WINDOWS, '22:00');
  assert.equal(r.mode, 'nighttime');
});

test('classifyMode: 02:30 (after midnight) → nighttime', () => {
  const r = classifyMode(WINTER_WINDOWS, '02:30');
  assert.equal(r.mode, 'nighttime');
});

test('classifyMode: 07:30 (exact sunrise) → daytime (sunrise is inclusive)', () => {
  const r = classifyMode(WINTER_WINDOWS, '07:30');
  assert.equal(r.mode, 'daytime');
});

test('classifyMode: 17:30 (exact sunset) → pssa (sunset is inclusive to PSSA)', () => {
  const r = classifyMode(WINTER_WINDOWS, '17:30');
  assert.equal(r.mode, 'pssa');
});

test('classifyMode: 18:00 (exact 6 PM boundary) → nighttime', () => {
  const r = classifyMode(WINTER_WINDOWS, '18:00');
  assert.equal(r.mode, 'nighttime');
});

test('classifyMode: 06:00 (exact morning boundary) → psra', () => {
  const r = classifyMode(WINTER_WINDOWS, '06:00');
  assert.equal(r.mode, 'psra');
});

test('classifyMode: summer no-PSRA day → 05:30 falls into nighttime (PSRA inactive)', () => {
  const summer = buildPsraPssaWindows({ sunrise: '05:15', sunset: '20:45' });
  const r = classifyMode(summer, '05:30');
  // sunrise was 05:15 → 05:30 is already daytime
  assert.equal(r.mode, 'daytime');
});

test('classifyMode: bad payload / time returns unknown', () => {
  assert.equal(classifyMode(null, '12:00').mode, 'unknown');
  assert.equal(classifyMode(WINTER_WINDOWS, 'xyz').mode, 'unknown');
});

/* ---------- buildMonthlySchedule (sidecar payload integration) ---------- */

test('buildMonthlySchedule: 12 rows from sun-sidecar monthly payload', () => {
  const sidecar = {
    available: true,
    timezone_code:  'D',
    timezone_label: 'Mountain Standard Time (Arizona)',
    monthly: Array.from({ length: 12 }, (_, i) => [String(i + 1),
      { sunrise: `0${5 + (i % 2)}:30`, sunset: `${17 + (i % 2)}:30` }
    ]).reduce((acc, [k, v]) => { acc[k] = v; return acc; }, {})
  };
  const sched = buildMonthlySchedule(sidecar);
  assert.equal(sched.ok, true);
  assert.equal(sched.months.length, 12);
  assert.equal(sched.timezone_code, 'D');
  for (const m of sched.months){
    assert.equal(m.ok, true);
    assert.ok(m.windows.daytime.duration_minutes > 0);
  }
});

test('buildMonthlySchedule: missing months yield ok:false rows but the others still ship', () => {
  const sidecar = {
    available: true,
    monthly: { 1: { sunrise: '07:30', sunset: '17:30' } }   // only Jan
  };
  const sched = buildMonthlySchedule(sidecar);
  assert.equal(sched.ok, true);
  assert.equal(sched.months.length, 12);
  assert.equal(sched.months[0].ok, true);
  assert.equal(sched.months[1].ok, false);
});

test('buildMonthlySchedule: rejects unavailable sidecar payload', () => {
  assert.equal(buildMonthlySchedule({ available: false }).ok, false);
  assert.equal(buildMonthlySchedule(null).ok, false);
  assert.equal(buildMonthlySchedule({ available: true }).ok, false);   // no monthly
});

/* ---------- provenance ---------- */

test('PSRA_PSSA_PROVENANCE names §73.99 + §73.1209 + 17 USC §105', () => {
  assert.match(PSRA_PSSA_PROVENANCE.regulation, /73\.99/);
  assert.match(PSRA_PSSA_PROVENANCE.regulation, /73\.1209/);
  assert.match(PSRA_PSSA_PROVENANCE.license_basis, /17 USC §105/);
});
