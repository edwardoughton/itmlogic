import React, { useEffect, useMemo, useState } from 'react';

// Move-in / what-if diff workbench panel.  Picks a "before" exhibit
// from history, takes the current computed exhibit as the "after",
// posts both to /api/exhibits/diff, and renders the per-section delta
// payload — the engineer's view into "what changed if I move this
// station / bump ERP / change class".
//
// CONTRACT
//   <ExhibitDiffPanel afterExhibit={exhibit} history={history}/>
//
//   - afterExhibit is the currently-loaded compute() output (live in
//     the workbench).
//   - history is the [{ id, ... }] list the workbench already
//     renders in PaneHistory; we reuse the same source.

export default function ExhibitDiffPanel({ afterExhibit, history }){
  const [beforeId, setBeforeId] = useState('');
  const [before,   setBefore]   = useState(null);
  const [diff,     setDiff]     = useState(null);
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState('');

  // Load the chosen baseline whenever beforeId changes.
  useEffect(() => {
    if (!beforeId){ setBefore(null); setDiff(null); return undefined; }
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError('');
      try {
        const r = await fetch(`/api/exhibits/${encodeURIComponent(beforeId)}`,
                              { credentials: 'same-origin' });
        if (!r.ok){
          const j = await r.json().catch(() => ({}));
          if (!cancelled) setError(j.error || `HTTP ${r.status}`);
          return;
        }
        const j = await r.json();
        if (!cancelled) setBefore(j.payload || j);
      } catch (e){
        if (!cancelled) setError(e.message || 'Network error');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [beforeId]);

  // Re-diff when both sides are present.
  useEffect(() => {
    if (!before || !afterExhibit){ setDiff(null); return undefined; }
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError('');
      try {
        const r = await fetch('/api/exhibits/diff', {
          method:      'POST',
          credentials: 'same-origin',
          headers:     { 'content-type': 'application/json' },
          body:        JSON.stringify({ before, after: afterExhibit })
        });
        if (!r.ok){
          const j = await r.json().catch(() => ({}));
          if (!cancelled) setError(j.error || `HTTP ${r.status}`);
          return;
        }
        const j = await r.json();
        if (!cancelled) setDiff(j);
      } catch (e){
        if (!cancelled) setError(e.message || 'Network error');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [before, afterExhibit]);

  if (!afterExhibit){
    return (
      <div className="rounded-md border border-rule p-3 text-[11px] text-textDim font-mono">
        Compute an exhibit to use as the "after" side; this panel diffs it against a chosen historical baseline.
      </div>
    );
  }

  return (
    <div className="space-y-4 font-mono text-[12px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase">
        Move-in / what-if exhibit diff — §73.207 / §73.215 / §73.182
      </div>

      <BaselinePicker
        history={history}
        beforeId={beforeId}
        setBeforeId={setBeforeId}
        before={before}
      />

      {busy && <div className="text-textDim text-[11px]">computing…</div>}
      {error && <div className="rounded-md border border-red-500 p-3 text-red-400 text-[11px]">{error}</div>}
      {diff?.ok && <DiffBody diff={diff} />}
    </div>
  );
}

function BaselinePicker({ history, beforeId, setBeforeId, before }){
  const rows = Array.isArray(history) ? history : [];
  return (
    <div className="rounded-md border border-rule p-3 space-y-2">
      <div className="flex items-center gap-3">
        <label className="text-textDim text-[10px] tracking-rack uppercase">Baseline (before)</label>
        <select
          value={beforeId}
          onChange={(e) => setBeforeId(e.target.value)}
          className="bg-black/70 border border-rule rounded px-2 py-1 text-cream text-[12px]"
        >
          <option value="">— pick from history —</option>
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              #{row.id} · {row.call || 'unknown'} · {row.frequency || ''} · {row.created_at || row.computed_at || ''}
            </option>
          ))}
        </select>
        {before && (
          <span className="text-[10px] text-textDim ml-auto">
            loaded: {before.station_inputs?.call} · {before.station_inputs?.frequency}
          </span>
        )}
      </div>
      {rows.length === 0 && (
        <div className="text-amber-400 text-[11px]">
          No exhibit history yet — save a compute first to use it as a baseline.
        </div>
      )}
    </div>
  );
}

function DiffBody({ diff }){
  const sev = diff.summary?.severity || 'minor';
  const sevColor = sev === 'blocking' ? 'text-red-400'
                 : sev === 'major'    ? 'text-amber-400'
                                       : 'text-emerald-400';
  return (
    <>
      <div className="rounded-md border border-rule p-3 space-y-1">
        <div className={`text-[12px] tracking-rack uppercase ${sevColor}`}>
          {sev}
        </div>
        <div className="text-cream text-[11px]">{diff.summary?.headline || '—'}</div>
      </div>

      <StationInputsBlock d={diff.station_inputs_delta} />
      <ContourBlock     deltas={diff.contour_delta} />
      <InterferenceBlock d={diff.interference_delta} />
      <RegulatoryBlock   d={diff.regulatory_compliance_delta} />
      <WarningsBlock     d={diff.warnings_delta} />

      <div className="text-[10px] text-textDim">
        Pure shape-comparison — both sides must already be computed exhibits.  Re-compute either
        side and re-pick the baseline to refresh.
      </div>
    </>
  );
}

function StationInputsBlock({ d }){
  if (!d) return null;
  // AM uses transmitter power + ground conductivity, not ERP/HAAT.
  // Diff rows track the operator's vocabulary so a side-by-side AM
  // diff reads as "TPO 5 kW → 10 kW", not "ERP 5 kW → 10 kW".
  const isAm = String(d.service || '').toUpperCase() === 'AM';
  const rows = isAm ? [
    ['Frequency',          d.frequency],
    ['TPO (kW)',           d.erp_kw],
    ['σ (mS/m)',           d.ground_sigma_mS_m ?? d.ground_sigma_ms_m],
    ['RMS field @ 1 km',   d.rms_field_1km],
    ['FCC class',          d.fcc_class],
    ['Antenna mode',       d.pattern_mode]
  ] : [
    ['Frequency',     d.frequency],
    ['ERP (kW)',      d.erp_kw],
    ['HAAT (m)',      d.haat_m],
    ['FCC class',     d.fcc_class],
    ['Pattern mode',  d.pattern_mode]
  ];
  return (
    <div className="rounded-md border border-rule p-3 space-y-2">
      <div className="text-textDim text-[10px] tracking-rack uppercase">Station inputs</div>
      <table className="w-full text-[11px]">
        <thead className="text-textDim text-[10px] tracking-rack uppercase">
          <tr><th className="text-left">Field</th><th className="text-right">Before</th><th className="text-right">After</th><th className="text-right">Δ</th></tr>
        </thead>
        <tbody>
          {rows.map(([label, val]) => (
            <tr key={label} className={`border-t border-rule/40 ${val?.changed ? 'text-amber-400' : ''}`}>
              <td className="text-left py-0.5">{label}</td>
              <td className="text-right">{fmtVal(val?.before)}</td>
              <td className="text-right">{fmtVal(val?.after)}</td>
              <td className="text-right">{fmtDelta(val)}</td>
            </tr>
          ))}
          {d.site_changed && (
            <tr className="border-t border-rule/40 text-amber-400">
              <td className="text-left py-0.5">Site move</td>
              <td colSpan="2" className="text-right text-textDim">great-circle</td>
              <td className="text-right">{Number.isFinite(d.distance_moved_km) ? `${d.distance_moved_km} km` : '—'}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ContourBlock({ deltas }){
  if (!deltas || Object.keys(deltas).length === 0) return null;
  return (
    <div className="rounded-md border border-rule p-3 space-y-2">
      <div className="text-textDim text-[10px] tracking-rack uppercase">Contour deltas</div>
      <table className="w-full text-[11px]">
        <thead className="text-textDim text-[10px] tracking-rack uppercase">
          <tr>
            <th className="text-left">Contour</th>
            <th className="text-right">Mean before (km)</th>
            <th className="text-right">Mean after (km)</th>
            <th className="text-right">Δ km</th>
            <th className="text-right">Δ area (km²)</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(deltas).map(([id, c]) => (
            <tr key={id} className="border-t border-rule/40">
              <td className="text-left py-0.5">{id}</td>
              <td className="text-right">{fmtNum(c.before_mean_km)}</td>
              <td className="text-right">{fmtNum(c.after_mean_km)}</td>
              <td className={`text-right ${c.delta_km > 0 ? 'text-emerald-400' : c.delta_km < 0 ? 'text-red-400' : ''}`}>
                {fmtSignedNum(c.delta_km)}
              </td>
              <td className={`text-right ${c.delta_area_km2 > 0 ? 'text-emerald-400' : c.delta_area_km2 < 0 ? 'text-red-400' : ''}`}>
                {fmtSignedNum(c.delta_area_km2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InterferenceBlock({ d }){
  if (!d) return null;
  return (
    <div className="rounded-md border border-rule p-3 space-y-1 text-[11px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase">Interference study</div>
      <div className="text-cream">
        Verdict: <Verdict v={d.before_qualifies} /> → <Verdict v={d.after_qualifies} />
      </div>
      {d.new_violations?.length > 0 && (
        <div className="text-red-400">+ new violations: {d.new_violations.join(', ')}</div>
      )}
      {d.cleared_violations?.length > 0 && (
        <div className="text-emerald-400">– cleared violations: {d.cleared_violations.join(', ')}</div>
      )}
      {(d.delta_pass != null || d.delta_fail != null) && (
        <div className="text-textDim text-[10px]">
          Δ pass {fmtSignedNum(d.delta_pass)} · Δ fail {fmtSignedNum(d.delta_fail)}
        </div>
      )}
    </div>
  );
}

function Verdict({ v }){
  if (v === true)  return <span className="text-emerald-400">QUALIFIES</span>;
  if (v === false) return <span className="text-red-400">DOES NOT QUALIFY</span>;
  return <span className="text-textDim">—</span>;
}

function RegulatoryBlock({ d }){
  if (!d) return null;
  if (!d.became_failing?.length && !d.became_passing?.length){
    return null;
  }
  return (
    <div className="rounded-md border border-rule p-3 space-y-1 text-[11px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase">Regulatory compliance transitions</div>
      {d.became_failing?.length > 0 && (
        <div className="text-red-400">+ now failing: {d.became_failing.join(', ')}</div>
      )}
      {d.became_passing?.length > 0 && (
        <div className="text-emerald-400">– now passing: {d.became_passing.join(', ')}</div>
      )}
    </div>
  );
}

function WarningsBlock({ d }){
  if (!d) return null;
  if (!d.added?.length && !d.removed?.length){
    return null;
  }
  return (
    <div className="rounded-md border border-rule p-3 space-y-1 text-[11px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase">Warnings</div>
      {d.added?.length > 0 && (
        <div className="text-amber-400">+ {d.added.join(', ')}</div>
      )}
      {d.removed?.length > 0 && (
        <div className="text-emerald-400">– {d.removed.join(', ')}</div>
      )}
    </div>
  );
}

function fmtVal(v){
  if (v == null) return '—';
  if (typeof v === 'number') return Number.isFinite(v) ? v : '—';
  return String(v);
}

function fmtNum(v){
  if (!Number.isFinite(v)) return '—';
  return v.toFixed(2);
}

function fmtSignedNum(v){
  if (!Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
}

function fmtDelta(val){
  if (!val) return '—';
  if (Number.isFinite(val.delta)){
    return `${val.delta > 0 ? '+' : ''}${val.delta}`;
  }
  if (val.changed) return `${val.before ?? '—'} → ${val.after ?? '—'}`;
  return '—';
}
