import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyAmDaMode } from '../engine/am/daModalClassification.js';

test('DA modal — Mullaney KELP 1989: 0.8/5.0 kW DA-2-U', () => {
  const r = classifyAmDaMode({ inputs: { pattern_mode: 'DA', erp_kw: 5.0, night_power_kw: 0.8 } });
  assert.equal(r.full_notation, 'DA-2-U');
  assert.match(r.composite, /0\.8\/5 kW DA-2-U/);
});

test('DA modal — KDUS-style non-directional unlimited: NDA-U', () => {
  const r = classifyAmDaMode({ inputs: { pattern_mode: 'ND', erp_kw: 5.0 } });
  assert.equal(r.full_notation, 'NDA-U');
});

test('DA modal — daytime-only DA collapses to DA-D (suppresses double-D)', () => {
  const r = classifyAmDaMode({ inputs: { pattern_mode: 'DA', erp_kw: 10.0, daytime_only: true } });
  assert.equal(r.full_notation, 'DA-D');
  // Must NOT be the broken 'DA-D-D' the pre-audit code produced.
  assert.notEqual(r.full_notation, 'DA-D-D');
});

test('DA modal — nighttime-only DA = DA-N', () => {
  const r = classifyAmDaMode({ inputs: { pattern_mode: 'DA', erp_kw: 1.0, nighttime_only: true } });
  assert.equal(r.full_notation, 'DA-N');
});

test('DA modal — three pattern tables = DA-3-U', () => {
  const r = classifyAmDaMode({
    inputs: {
      pattern_mode: 'DA', erp_kw: 5.0,
      am_night_pattern_table: [[0, 1]],
      am_critical_hours_pattern_table: [[0, 1]]
    }
  });
  assert.equal(r.full_notation, 'DA-3-U');
});

test('DA modal — same power day+night, single pattern = DA-D collapse', () => {
  const r = classifyAmDaMode({ inputs: { pattern_mode: 'DA', erp_kw: 5.0, night_power_kw: 5.0 } });
  assert.equal(r.full_notation, 'DA-D');
});

test('DA modal — power notation reflects day/night split', () => {
  const r = classifyAmDaMode({ inputs: { pattern_mode: 'DA', erp_kw: 50.0, night_power_kw: 10.0 } });
  assert.match(r.power_notation, /10\/50 kW/);
});
