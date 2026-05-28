import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAmDaPatternCompliance } from '../engine/regulatory/section_73_150.js';

// Build a smooth omni-ish pattern (no abrupt transitions, max:min < 15 dB).
function smoothPattern(){
  return Array.from({ length: 36 }, (_, i) => [i * 10, 1 - 0.2 * Math.cos(i * 10 * Math.PI / 180)]);
}

test('§73.150 — smooth pattern passes all decisive checks', () => {
  const r = checkAmDaPatternCompliance({ pattern_table: smoothPattern() });
  assert.equal(r.overall_pass, true);
  const smooth = r.findings.find((f) => f.rule === 'smoothness');
  const maxMin = r.findings.find((f) => f.rule === 'max_to_min_ratio');
  assert.equal(smooth.pass, true);
  assert.equal(maxMin.pass, true);
});

test('§73.150 — deep-null pattern fails max:min ratio', () => {
  // Single deep null > 15 dB below the maximum.
  const harsh = [[0, 1.0], [10, 0.05], [20, 1.0], [30, 0.1], [40, 1.0]];
  const r = checkAmDaPatternCompliance({ pattern_table: harsh });
  assert.equal(r.overall_pass, false);
  const maxMin = r.findings.find((f) => f.rule === 'max_to_min_ratio');
  assert.equal(maxMin.pass, false);
});

test('§73.150 — jagged transitions fail smoothness limit (>2 dB/10°)', () => {
  // 25 dB jump across 10° — way beyond the §73.150 smoothness limit.
  const jagged = [[0, 1.0], [10, 0.05], [20, 1.0], [30, 1.0]];
  const r = checkAmDaPatternCompliance({ pattern_table: jagged });
  const smooth = r.findings.find((f) => f.rule === 'smoothness');
  assert.equal(smooth.pass, false);
});

test('§73.150 — RMS check reports "not measured" without authorized pattern', () => {
  const r = checkAmDaPatternCompliance({ pattern_table: smoothPattern() });
  const rms = r.findings.find((f) => f.rule === 'rms_minimum');
  assert.equal(rms.pass, null);
});

test('§73.150 — RMS check passes when as-built matches authorized 100%', () => {
  const pat = smoothPattern();
  const r = checkAmDaPatternCompliance({ pattern_table: pat, authorized_pattern_table: pat });
  const rms = r.findings.find((f) => f.rule === 'rms_minimum');
  assert.equal(rms.pass, true);
});

test('§73.150 — RMS check fails when as-built is < 85% of authorized', () => {
  const auth   = smoothPattern();
  const builtFraction = 0.5;   // RMS drops to ~50% of authorized
  const built  = auth.map(([az, f]) => [az, f * builtFraction]);
  const r = checkAmDaPatternCompliance({ pattern_table: built, authorized_pattern_table: auth });
  const rms = r.findings.find((f) => f.rule === 'rms_minimum');
  assert.equal(rms.pass, false);
});

test('§73.150 — non-applicable when no pattern attached (NDA / single-tower)', () => {
  const r = checkAmDaPatternCompliance({ pattern_table: [] });
  assert.equal(r.applicable, false);
});

test('§73.150 — wrap-around smoothness catches 350°→0° transitions', () => {
  // 5 dB drop across the 350°→0° wrap; smoothness limit is 2 dB/10°.
  const wrapJagged = Array.from({ length: 36 }, (_, i) => {
    const az = i * 10;
    return [az, az === 350 ? 0.3 : 1.0];
  });
  const r = checkAmDaPatternCompliance({ pattern_table: wrapJagged });
  const smooth = r.findings.find((f) => f.rule === 'smoothness');
  // The 0→350 wrap evaluation must catch the 10° span with 10+ dB delta.
  assert.equal(smooth.pass, false);
});
