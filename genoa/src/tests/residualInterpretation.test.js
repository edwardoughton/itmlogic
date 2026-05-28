// Residual interpretation — engineering-grade narrative for SDR residuals.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyResidual, summarizeResiduals,
  CLASS_WITHIN, CLASS_MODERATE, CLASS_SIGNIFICANT, CLASS_UNKNOWN
} from '../analysis/residualInterpretation/classifyResiduals.js';
import { generateNarrative }    from '../analysis/residualInterpretation/generateNarrative.js';
import { interpretResiduals }   from '../analysis/residualInterpretation/index.js';
import { buildEngineeringReport }      from '../exports/engineeringReport/index.js';
import { renderEngineeringReportText } from '../exports/engineeringReport/renderText.js';
import { buildExhibit, FM_CLASS_A }    from './_helpers.js';

// ── classifyResidual thresholds ────────────────────────────────────────────

test('classifyResidual: |Δ| < 6 dB ⇒ WITHIN_EXPECTATION', () => {
  assert.equal(classifyResidual(0),    CLASS_WITHIN);
  assert.equal(classifyResidual(5.9),  CLASS_WITHIN);
  assert.equal(classifyResidual(-3),   CLASS_WITHIN);
});

test('classifyResidual: 6 ≤ |Δ| ≤ 10 dB ⇒ MODERATE_DEVIATION', () => {
  assert.equal(classifyResidual(6),    CLASS_MODERATE);
  assert.equal(classifyResidual(8),    CLASS_MODERATE);
  assert.equal(classifyResidual(-10),  CLASS_MODERATE);
});

test('classifyResidual: |Δ| > 10 dB ⇒ SIGNIFICANT_DEVIATION', () => {
  assert.equal(classifyResidual(10.1), CLASS_SIGNIFICANT);
  assert.equal(classifyResidual(-15),  CLASS_SIGNIFICANT);
});

test('classifyResidual: non-numeric ⇒ UNKNOWN', () => {
  assert.equal(classifyResidual(NaN), CLASS_UNKNOWN);
  assert.equal(classifyResidual(null), CLASS_UNKNOWN);
});

// ── summarizeResiduals ─────────────────────────────────────────────────────

test('summarizeResiduals computes rms / mean / counts / dominant direction', () => {
  const table = [
    { azimuth_deg: 0,   residual_db:  4   },
    { azimuth_deg: 90,  residual_db:  -3  },
    { azimuth_deg: 180, residual_db:  -12 },
    { azimuth_deg: 270, residual_db:  -14 }
  ];
  const s = summarizeResiduals(table);
  assert.equal(s.available, true);
  assert.equal(s.n_samples, 4);
  assert.equal(s.n_significant, 2);
  assert.ok(Math.abs(s.mean_db - (-6.25)) < 1e-6);
  assert.ok(s.rms_db > 0);
  assert.equal(s.worst_case.azimuth_deg, 270);
  // Top quartile of |Δ| (1 sample) is at 270° ⇒ compass 'W'.
  assert.equal(s.dominant_direction.compass, 'W');
});

test('summarizeResiduals returns available:false on empty input', () => {
  assert.equal(summarizeResiduals([]).available, false);
  assert.equal(summarizeResiduals(null).available, false);
});

// ── generateNarrative — required phrases ───────────────────────────────────

test('generateNarrative: large residual mentions terrain-induced attenuation', () => {
  const summary = summarizeResiduals([
    { azimuth_deg: 0,   residual_db: -15 },
    { azimuth_deg: 90,  residual_db: -12 },
    { azimuth_deg: 180, residual_db: -14 },
    { azimuth_deg: 270, residual_db: -11 }
  ]);
  const narrative = generateNarrative(summary);
  assert.ok(narrative.includes('terrain-induced attenuation'),
    'large-residual narrative must mention terrain-induced attenuation');
  assert.ok(!/FCC.*error|FCC.*incorrect|FCC.*wrong/i.test(narrative),
    'narrative must not claim FCC error');
});

test('generateNarrative: moderate residual mentions localized variation', () => {
  const summary = summarizeResiduals([
    { azimuth_deg: 0,   residual_db: 7  },
    { azimuth_deg: 45,  residual_db: -8 },
    { azimuth_deg: 90,  residual_db: 6  },
    { azimuth_deg: 135, residual_db: -7 },
    { azimuth_deg: 180, residual_db: 4  }
  ]);
  const narrative = generateNarrative(summary);
  assert.ok(narrative.includes('localized variation'),
    'moderate-residual narrative must mention localized variation');
});

test('generateNarrative: small residual states consistent with FCC curves', () => {
  const summary = summarizeResiduals([
    { azimuth_deg: 0,   residual_db: 1  },
    { azimuth_deg: 90,  residual_db: -2 },
    { azimuth_deg: 180, residual_db: 3  },
    { azimuth_deg: 270, residual_db: -1 }
  ]);
  const narrative = generateNarrative(summary);
  assert.ok(narrative.includes('consistent with FCC curves'),
    'small-residual narrative must state consistent with FCC curves');
});

test('generateNarrative is deterministic (same summary ⇒ same output)', () => {
  const summary = summarizeResiduals([
    { azimuth_deg: 0,  residual_db: -12 },
    { azimuth_deg: 90, residual_db:  -8 }
  ]);
  const a = generateNarrative(summary);
  const b = generateNarrative(summary);
  assert.equal(a, b);
});

test('generateNarrative always carries the advisory disclaimer', () => {
  const summaries = [
    summarizeResiduals([{ azimuth_deg: 0, residual_db:  2 }]),
    summarizeResiduals([{ azimuth_deg: 0, residual_db:  8 }]),
    summarizeResiduals([{ azimuth_deg: 0, residual_db: -15 }])
  ];
  for (const s of summaries){
    const n = generateNarrative(s);
    assert.ok(/regulatory contour distances reported elsewhere remain authoritative/.test(n),
      'narrative must defer to FCC authoritative distances');
    assert.ok(!/FCC error/i.test(n),
      'narrative must not claim FCC error');
  }
});

test('generateNarrative handles empty input with neutral wording', () => {
  const n = generateNarrative(summarizeResiduals([]));
  assert.ok(/No SDR drive-test residuals were attached/.test(n));
});

// ── Pipeline + report integration ──────────────────────────────────────────

test('interpretResiduals reads exhibit.evidence.sdr_calibration.residuals', () => {
  const exhibit = {
    evidence: {
      sdr_calibration: {
        residuals: [
          { azimuth_deg: 0,  residual_db: -12 },
          { azimuth_deg: 90, residual_db: -14 }
        ]
      }
    }
  };
  const ri = interpretResiduals(exhibit);
  assert.equal(ri.available, true);
  assert.ok(ri.engineering_interpretation_text.includes('terrain-induced attenuation'));
});

test('engine attaches exhibit.residual_interpretation', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  assert.ok(x.residual_interpretation, 'exhibit should carry residual_interpretation');
  // No SDR attached for the FM_CLASS_A helper, so neutral wording is expected.
  assert.equal(x.residual_interpretation.available, false);
  assert.ok(/No SDR drive-test residuals/.test(x.residual_interpretation.engineering_interpretation_text));
});

test('engineering report renders ENGINEERING INTERPRETATION when residuals present', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  // Inject a synthetic SDR residual table → re-run interpretation manually
  // (mirrors what the engine does).
  x.evidence = {
    ...(x.evidence || {}),
    sdr_calibration: {
      residuals: [
        { azimuth_deg: 0,   residual_db: -12 },
        { azimuth_deg: 90,  residual_db: -13 },
        { azimuth_deg: 180, residual_db:  -7 },
        { azimuth_deg: 270, residual_db:  -2 }
      ]
    }
  };
  x.residual_interpretation = interpretResiduals(x);
  const doc = buildEngineeringReport(x);
  const sec = doc.sections.find(s => s.id === 'engineering-interpretation');
  assert.ok(sec, 'document should include engineering-interpretation');
  const txt = renderEngineeringReportText(doc);
  assert.ok(txt.includes('ENGINEERING INTERPRETATION'));
  assert.ok(txt.includes('terrain-induced attenuation'));
});

test('interpretResiduals does not mutate the exhibit', () => {
  const exhibit = {
    evidence: { sdr_calibration: { residuals: [{ azimuth_deg: 0, residual_db: -12 }] } }
  };
  const before = JSON.stringify(exhibit);
  interpretResiduals(exhibit);
  assert.equal(JSON.stringify(exhibit), before);
});
