// Terrain-aware engineering confidence — pure analysis layer.
//
// Required scenarios from the spec:
//   1. high terrain variance              → LOW confidence
//   2. low variance + low residual        → HIGH confidence
//   3. SDR residual > 10 dB                → LOW confidence
//   4. no SDR + flat terrain               → HIGH confidence
//
// Plus integration coverage for the engineering report wiring.

import test from 'node:test';
import assert from 'node:assert/strict';

import { computeTerrainMetrics }          from '../analysis/terrainConfidence/terrainMetrics.js';
import { computeCurveDeviation }          from '../analysis/terrainConfidence/curveDeviation.js';
import { radialConfidence }               from '../analysis/terrainConfidence/radialConfidence.js';
import { aggregateEngineeringConfidence,
         /* exported helpers if any */ }  from '../analysis/terrainConfidence/confidenceScoring.js';
import { analyzeTerrainConfidence }       from '../analysis/terrainConfidence/index.js';
import { buildEngineeringReport }         from '../exports/engineeringReport/index.js';
import { renderEngineeringReportText }    from '../exports/engineeringReport/renderText.js';
import { buildExhibit, FM_CLASS_A }       from './_helpers.js';

// ── Helpers ────────────────────────────────────────────────────────────────

function flatProfile(km, n = 30, base = 100){
  const out = [];
  for (let i = 0; i < n; i++){
    out.push({ distance_km: (i / (n - 1)) * km, elevation_m: base });
  }
  return out;
}

function jaggedProfile(km, n = 30, base = 100, amplitude = 400){
  const out = [];
  for (let i = 0; i < n; i++){
    const t = i / (n - 1);
    // A pair of large bumps that rise far above the LOS line — guaranteed
    // to trigger both the obstruction-index and roughness gates.
    const e = base + amplitude * Math.exp(-((t - 0.5) ** 2) / 0.01)
                   + (amplitude * 0.5) * Math.exp(-((t - 0.25) ** 2) / 0.005);
    out.push({ distance_km: t * km, elevation_m: e });
  }
  return out;
}

// ── 1. high terrain variance → LOW ─────────────────────────────────────────

test('radialConfidence is LOW for highly variable terrain (no measurements attached)', () => {
  const terrain = computeTerrainMetrics({ terrain_profile: jaggedProfile(20) });
  assert.equal(terrain.available, true);
  assert.ok(terrain.obstruction_index >= 0.30 || terrain.roughness_score >= 1.0,
    'jagged profile should be flagged severe');
  const r = radialConfidence({ terrain });
  assert.equal(r.confidence, 'LOW');
  assert.ok(r.reasons.includes('terrain_shadowing'));
});

// ── 2. low variance + low residual → HIGH ──────────────────────────────────

test('radialConfidence is HIGH for flat terrain + small residual', () => {
  const terrain = computeTerrainMetrics({ terrain_profile: flatProfile(20) });
  const r = radialConfidence({ terrain, sdr_residual_db: 1.5 });
  assert.equal(r.confidence, 'HIGH');
  assert.deepEqual(r.reasons, []);
});

// ── 3. SDR residual > 10 dB → LOW ──────────────────────────────────────────

test('radialConfidence is LOW when SDR residual exceeds severe threshold', () => {
  const terrain = computeTerrainMetrics({ terrain_profile: flatProfile(20) });
  const r = radialConfidence({ terrain, sdr_residual_db: -14.2 });
  assert.equal(r.confidence, 'LOW');
  assert.ok(r.reasons.includes('measurement_variance'));
});

// ── 4. no SDR + flat terrain → HIGH ────────────────────────────────────────

test('radialConfidence is HIGH when no SDR is attached and terrain is flat', () => {
  const terrain = computeTerrainMetrics({ terrain_profile: flatProfile(20) });
  const r = radialConfidence({ terrain, sdr_residual_db: null });
  assert.equal(r.confidence, 'HIGH');
  assert.deepEqual(r.reasons, []);
});

// ── computeCurveDeviation classification thresholds ────────────────────────

test('computeCurveDeviation classifies <6 dB as within_tolerance', () => {
  const d = computeCurveDeviation(60, 64);
  assert.equal(d.classification, 'within_tolerance');
  assert.equal(d.delta_db, 4);
});

test('computeCurveDeviation classifies 6-10 dB as moderate', () => {
  const d = computeCurveDeviation(60, 67);
  assert.equal(d.classification, 'moderate');
});

test('computeCurveDeviation classifies >10 dB as severe', () => {
  const d = computeCurveDeviation(60, 48);
  assert.equal(d.classification, 'severe');
  assert.equal(d.abs_delta_db, 12);
});

// ── Aggregate engineering confidence ───────────────────────────────────────

test('aggregateEngineeringConfidence is HIGH when every radial is HIGH', () => {
  const list = [...Array(10)].map((_, i) =>
    radialConfidence({
      terrain: computeTerrainMetrics({ terrain_profile: flatProfile(20) }),
      sdr_residual_db: 1.0,
      azimuth_deg: i * 36
    })
  );
  const agg = aggregateEngineeringConfidence(list);
  assert.equal(agg.level, 'HIGH');
  assert.equal(agg.percent_high, 100);
  assert.equal(agg.percent_low, 0);
  assert.equal(agg.flagged_radials.length, 0);
});

test('aggregateEngineeringConfidence is LOW when ≥20% of radials are LOW', () => {
  const flat = computeTerrainMetrics({ terrain_profile: flatProfile(20) });
  const jag  = computeTerrainMetrics({ terrain_profile: jaggedProfile(20) });
  const list = [
    radialConfidence({ terrain: jag,  azimuth_deg: 0 }),
    radialConfidence({ terrain: jag,  azimuth_deg: 36 }),
    radialConfidence({ terrain: flat, azimuth_deg: 72 }),
    radialConfidence({ terrain: flat, azimuth_deg: 108 }),
    radialConfidence({ terrain: flat, azimuth_deg: 144 })
  ];
  const agg = aggregateEngineeringConfidence(list);
  assert.equal(agg.level, 'LOW');
  assert.ok(agg.percent_low >= 20);
  assert.ok(agg.flagged_radials.length >= 2);
  assert.ok(agg.explanation.includes('LOW'));
  assert.ok(agg.explanation.includes('does NOT modify'));
});

// ── Pipeline + report integration ──────────────────────────────────────────

test('analyzeTerrainConfidence produces aggregate summary on a real exhibit', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const ec = analyzeTerrainConfidence(x);
  assert.ok(['HIGH', 'MODERATE', 'LOW'].includes(ec.level));
  assert.ok(typeof ec.explanation === 'string' && ec.explanation.length > 20);
});

test('engine attaches exhibit.engineering_confidence after compute', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  assert.ok(x.engineering_confidence, 'exhibit should carry engineering_confidence');
  assert.ok(['HIGH', 'MODERATE', 'LOW'].includes(x.engineering_confidence.level));
});

test('engineering report includes Engineering Considerations and methodology mention', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  // Force a rich confidence picture so we definitely render the table form.
  x.engineering_confidence = aggregateEngineeringConfidence([
    radialConfidence({ terrain: computeTerrainMetrics({ terrain_profile: jaggedProfile(20) }), azimuth_deg: 0 }),
    radialConfidence({ terrain: computeTerrainMetrics({ terrain_profile: flatProfile(20)  }), azimuth_deg: 36 })
  ]);
  const doc = buildEngineeringReport(x);
  const ids = doc.sections.map(s => s.id);
  assert.ok(ids.includes('engineering-considerations'),
    'document should include the engineering-considerations section');
  // Methodology must mention the advisory-only nature.
  const meth = doc.sections.find(s => s.id === 'methodology');
  assert.ok(meth.paragraphs.some(p => p.includes('advisory only')),
    'methodology should mention the terrain-aware advisory layer');
  // Validation verdict must include an Engineering confidence component.
  const verdict = doc.sections.find(s => s.id === 'validation').verdict;
  const ecComp = verdict.components.find(c => /Engineering confidence/.test(c.name));
  assert.ok(ecComp, 'validation verdict should include Engineering confidence component');
});

test('TXT renderer emits Engineering Considerations heading and preface', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  x.engineering_confidence = aggregateEngineeringConfidence([
    radialConfidence({ terrain: computeTerrainMetrics({ terrain_profile: jaggedProfile(20) }), azimuth_deg: 0 })
  ]);
  const txt = renderEngineeringReportText(buildEngineeringReport(x));
  assert.ok(txt.includes('ENGINEERING CONSIDERATIONS'));
  const collapsed = txt.replace(/\s+/g, ' ');
  assert.ok(collapsed.includes('certain terrain conditions may result in deviations'));
});

test('analyzeTerrainConfidence does not mutate the exhibit', async () => {
  const x = await buildExhibit(FM_CLASS_A);
  const before = JSON.stringify(x);
  analyzeTerrainConfidence(x);
  assert.equal(JSON.stringify(x), before);
});
