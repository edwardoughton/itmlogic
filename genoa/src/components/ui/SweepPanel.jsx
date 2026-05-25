import React, { useState } from 'react';
import HardwareButton from './HardwareButton.jsx';
import MetricReadout  from './MetricReadout.jsx';

// SweepPanel — UI surface for POST /api/exhibits/sweep ("H&D-killer").
//
// The panel's job is presentation only.  It posts the current base
// inputs (resolved via getBaseInputs() so dirty state in FacilityRack
// is captured) and a sweep-range spec to the server, then renders the
// ranked compliant configurations.  All FCC math is server-side.
//
// Props
//   getBaseInputs   () => object   — returns the sanitized inputs for
//                                    the base facility (call/lat/lon/
//                                    service/frequency).  Caller is
//                                    responsible for stripping UI-only
//                                    flags and num-casting.
//   onApplyCombo    (combo) => void — optional; lets the user push the
//                                     best combo back into the form.
//
// Layout: range form on top, results below.  The "Best" card is
// promoted above the ranked table because that's the headline answer
// reviewers want ("best compliant config: ERP 68 kW, HAAT 470 m").

const DEFAULT_RANGES = {
  erp_kw: { min: 1,   max: 100, step: 5  },
  haat_m: { min: 50,  max: 600, step: 50 }
};

function fmtKm2(v){
  if (v == null) return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function ruleLabel(path){
  if (path === '73.207') return '§73.207';
  if (path === '73.215') return '§73.215';
  if (path === '74.1204') return '§74.1204';
  return '—';
}

function ruleTone(path){
  return path === '73.207' ? 'green'
       : path === '73.215' ? 'cyan'
       : path === '74.1204' ? 'amber'
       : 'dim';
}

export default function SweepPanel({ getBaseInputs, onApplyCombo }) {
  const [ranges, setRanges] = useState(DEFAULT_RANGES);
  const [maxCombos, setMaxCombos]     = useState(1000);
  const [topN, setTopN]               = useState(10);
  const [onlyCompliant, setOnly]      = useState(true);
  const [running, setRunning]         = useState(false);
  const [error, setError]             = useState('');
  const [result, setResult]           = useState(null);
  const [elapsed, setElapsed]         = useState(0);

  function setRange(dim, key, raw){
    const v = Number(raw);
    setRanges(r => ({
      ...r,
      [dim]: { ...r[dim], [key]: Number.isFinite(v) ? v : r[dim][key] }
    }));
  }

  async function run(){
    setError('');
    setResult(null);
    const baseInputs = getBaseInputs ? getBaseInputs() : {};
    if (!baseInputs || !baseInputs.service){
      setError('Set a service (FM/LPFM/FX/AM) on the Facility rack before sweeping.');
      return;
    }
    if (baseInputs.lat == null || baseInputs.lon == null){
      setError('Latitude and longitude are required — the orchestrator computes the base exhibit before sweeping.');
      return;
    }
    setRunning(true);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 500);
    try {
      const r = await fetch('/api/exhibits/sweep', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          base_inputs:      baseInputs,
          sweep:            ranges,
          max_combinations: Number(maxCombos) || undefined,
          top_n:            Number(topN)      || undefined,
          only_compliant:   !!onlyCompliant
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok){
        throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      }
      setResult(j);
    } catch (e){
      setError(e.message || String(e));
    } finally {
      clearInterval(tick);
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="rack-eyebrow mb-1">Sweep ranges</div>
        <p className="font-mono text-[10px] text-textDim mb-2 leading-snug">
          Cartesian grid of ERP × HAAT around the base facility.  Engine compute
          per combo is a few ms; the orchestrator runs once on the base inputs
          to resolve <code className="text-text/80">nearby_primaries</code> and
          FCC LMS evidence, then every combo is scored against §73.207 / §73.215
          / OET-65 with that evidence reused.
        </p>
        <div className="grid grid-cols-[80px_repeat(3,1fr)] gap-2 items-center">
          <div className="font-mono text-[10px] uppercase tracking-rack text-textDim">ERP (kW)</div>
          <input className="rack-input" value={ranges.erp_kw.min}  onChange={e => setRange('erp_kw', 'min',  e.target.value)} />
          <input className="rack-input" value={ranges.erp_kw.max}  onChange={e => setRange('erp_kw', 'max',  e.target.value)} />
          <input className="rack-input" value={ranges.erp_kw.step} onChange={e => setRange('erp_kw', 'step', e.target.value)} />
          <div className="font-mono text-[10px] uppercase tracking-rack text-textDim">HAAT (m)</div>
          <input className="rack-input" value={ranges.haat_m.min}  onChange={e => setRange('haat_m', 'min',  e.target.value)} />
          <input className="rack-input" value={ranges.haat_m.max}  onChange={e => setRange('haat_m', 'max',  e.target.value)} />
          <input className="rack-input" value={ranges.haat_m.step} onChange={e => setRange('haat_m', 'step', e.target.value)} />
          <div className="col-span-1" />
          <div className="font-mono text-[10px] text-textDim text-center">min</div>
          <div className="font-mono text-[10px] text-textDim text-center">max</div>
          <div className="font-mono text-[10px] text-textDim text-center">step</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="rack-label">Max combos</label>
          <input className="rack-input" value={maxCombos} onChange={e => setMaxCombos(e.target.value)} />
        </div>
        <div>
          <label className="rack-label">Top N</label>
          <input className="rack-input" value={topN} onChange={e => setTopN(e.target.value)} />
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 font-mono text-[11px] text-text">
            <input type="checkbox" checked={onlyCompliant} onChange={e => setOnly(e.target.checked)} />
            <span>Only compliant in results</span>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <HardwareButton variant="primary" onClick={run} disabled={running}>
          {running ? `Sweeping… ${elapsed}s` : 'Find best config'}
        </HardwareButton>
        {error && <span className="font-mono text-[11px] text-red">{error}</span>}
        {result && !error && (
          <span className="font-mono text-[11px] text-textDim">
            {result.total_evaluated} evaluated · {result.total_compliant} compliant · {result.runtime_ms} ms
          </span>
        )}
      </div>

      {result?.best && (
        <div className="rack-panel tone-cyan p-4">
          <div className="rack-eyebrow mb-1">Best compliant configuration</div>
          <div className="rack-title mb-3">
            ERP {result.best.combo.erp_kw} kW · HAAT {result.best.combo.haat_m} m
          </div>
          <div className="grid grid-cols-2 gap-x-6">
            <MetricReadout
              label="Distance path"
              value={ruleLabel(result.best.compliance?.distance_path)}
              tone={ruleTone(result.best.compliance?.distance_path)}
              led="green"
            />
            <MetricReadout
              label="Service contour"
              value={fmtKm2(result.best.coverage_km2 ?? result.best.summary?.service_contour_area_km2)}
              unit="km²"
              tone="gold"
            />
            <MetricReadout
              label="Efficiency"
              value={result.best.efficiency_km2_per_kw?.toFixed?.(1) ?? '—'}
              unit="km²/kW"
              tone="cyan"
            />
            <MetricReadout
              label="Score"
              value={result.best.score?.toFixed?.(1) ?? '—'}
            />
            <MetricReadout
              label="OET-65 boundary"
              value={result.best.compliance?.oet65 === false ? 'FAIL' : 'pass'}
              tone={result.best.compliance?.oet65 === false ? 'red' : 'green'}
            />
            <MetricReadout
              label="Blockers"
              value={result.best.summary?.n_blockers ?? 0}
              tone={result.best.summary?.n_blockers ? 'red' : 'green'}
            />
          </div>
          {onApplyCombo && (
            <div className="mt-3">
              <HardwareButton variant="cyan" onClick={() => onApplyCombo(result.best.combo)}>
                Apply to facility form
              </HardwareButton>
            </div>
          )}
        </div>
      )}

      {result?.top_compliant?.length > 0 && (
        <div>
          <div className="rack-eyebrow mb-1">Top {result.top_compliant.length} compliant configurations</div>
          <div className="rounded-md border border-rule overflow-auto max-h-[420px]">
            <table className="telemetry">
              <thead>
                <tr>
                  <th>#</th>
                  <th className="text-right">ERP kW</th>
                  <th className="text-right">HAAT m</th>
                  <th>Path</th>
                  <th className="text-right">Area km²</th>
                  <th className="text-right">km²/kW</th>
                  <th className="text-right">Score</th>
                  <th>OET-65</th>
                  <th>Blockers</th>
                  {onApplyCombo && <th></th>}
                </tr>
              </thead>
              <tbody>
                {result.top_compliant.map((r, i) => (
                  <tr key={i}>
                    <td className="text-textDim">{i + 1}</td>
                    <td className="text-right text-cream">{r.combo.erp_kw}</td>
                    <td className="text-right text-cream">{r.combo.haat_m}</td>
                    <td className={
                      r.compliance?.distance_path === '73.207' ? 'text-green'
                      : r.compliance?.distance_path === '73.215' ? 'text-cyan'
                      : 'text-textDim'
                    }>{ruleLabel(r.compliance?.distance_path)}</td>
                    <td className="text-right">{fmtKm2(r.coverage_km2 ?? r.summary?.service_contour_area_km2)}</td>
                    <td className="text-right">{r.efficiency_km2_per_kw?.toFixed?.(1) ?? '—'}</td>
                    <td className="text-right text-cream">{r.score?.toFixed?.(1) ?? '—'}</td>
                    <td className={r.compliance?.oet65 === false ? 'text-red' : 'text-green'}>
                      {r.compliance?.oet65 === false ? 'FAIL' : 'pass'}
                    </td>
                    <td className={r.summary?.n_blockers ? 'text-red' : 'text-green'}>
                      {r.summary?.n_blockers ?? 0}
                    </td>
                    {onApplyCombo && (
                      <td>
                        <button
                          type="button"
                          className="font-mono text-[10px] text-cyan underline-offset-2 hover:underline"
                          onClick={() => onApplyCombo(r.combo)}
                        >apply</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {result.base_regulatory_context && (
            <div className="font-mono text-[10px] text-textDim mt-2 leading-snug">
              Base regulatory context: <span className="text-text/80">{result.base_regulatory_context.facilityStatus}</span>
              {' · '}{result.base_regulatory_context.studyIntent}
              {' · '}filing risk{' '}
              <span className={
                result.base_regulatory_context.filingRisk === 'high'   ? 'text-red'
                : result.base_regulatory_context.filingRisk === 'medium' ? 'text-amber'
                : 'text-cyan'
              }>{result.base_regulatory_context.filingRisk}</span>
            </div>
          )}
        </div>
      )}

      {result && !result.best && !error && (
        <div className="font-mono text-[11px] text-amber">
          No compliant configurations found in the swept grid.  Widen the
          ranges (especially ERP) or relax HAAT to find a viable point.
        </div>
      )}

      <div className="font-mono text-[10px] text-textDim leading-snug border-t border-rule pt-2">
        Compliance ranking: a configuration is compliant iff (§73.207 OR §73.215)
        AND OET-65 boundary AND no engine blockers.  Score is service-contour area
        per kW (km²/kW) — higher = more reach for the same power; ties break to
        lower ERP, then lower HAAT.  Final filing certification remains the
        responsibility of the qualified broadcast engineer.
      </div>
    </div>
  );
}
