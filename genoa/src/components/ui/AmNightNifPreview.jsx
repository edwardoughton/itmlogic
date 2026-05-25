import React, { useEffect, useRef, useState } from 'react';

// Live NIF-contour preview for the AM DA designer.  Watches the
// proposed station (lat/lon/freq/erp/class) + the currently
// synthesized pattern_table; debounces POST /api/am-night/nif so
// the engineer sees the §73.182 nighttime allocation outcome
// update as they retune the array.
//
// CONTRACT
//   <AmNightNifPreview
//      lat, lon, freq_khz, erp_kw, fcc_class,
//      pattern_table, pattern_mode = 'omni' | 'DA',
//      debounceMs = 600
//   />
//
// FAIL-SOFT
//   - When required inputs are missing → renders a "needs lat/lon/..."
//     hint, no fetch.
//   - When the orchestrator returns { available: false } → renders the
//     diagnostic message (FCCAM unconfigured, no nearby AMs, etc.).
//   - When the network hiccups → renders the error inline; the next
//     pattern change retries automatically.
//
// REGULATORY
//   - 47 CFR §73.182 — AM nighttime engineering standards of allocation
//   - 47 CFR §73.183 — protection ratios per class + relation
//   - 47 CFR §73.190(c) — Wang skywave formula explicitly permitted
//
// REPLAY DETERMINISM
//   This component is preview-only — it does NOT mutate exhibit state.
//   The orchestrator's compute is identical to the exhibit-time path
//   (same endpoint, same engine), so what you see here is what the
//   exhibit will report once you re-compute.

const DEFAULT_DEBOUNCE_MS = 600;

export default function AmNightNifPreview({
  lat, lon, freq_khz, erp_kw, fcc_class,
  pattern_table = null,
  pattern_mode  = 'omni',
  azimuths_deg  = null,     // default uses orchestrator default [0,10,...,350]
  max_interferers = null,
  debounceMs = DEFAULT_DEBOUNCE_MS
}){
  const [state, setState] = useState({ loading: false, study: null, error: null });
  const abortRef = useRef(null);

  // Stable string for the dependency array — useEffect compares
  // references, so re-creating pattern_table every render would loop.
  const key = JSON.stringify({
    lat, lon, freq_khz, erp_kw, fcc_class,
    pattern_mode,
    pattern_table: pattern_table && Object.keys(pattern_table).length ? pattern_table : null,
    azimuths_deg, max_interferers
  });

  useEffect(() => {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))){
      setState({ loading: false, study: null, error: null });
      return undefined;
    }
    if (!Number.isFinite(Number(freq_khz)) || !Number.isFinite(Number(erp_kw))){
      setState({ loading: false, study: null, error: null });
      return undefined;
    }
    if (!fcc_class){
      setState({ loading: false, study: null,
        error: 'AM class (A/B/C/D) required — §73.183 D/U ratios are class-dependent.' });
      return undefined;
    }

    const id = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const body = {
          proposed: {
            lat:           Number(lat),
            lon:           Number(lon),
            freq_khz:      Number(freq_khz),
            erp_kw:        Number(erp_kw),
            fcc_class,
            pattern_mode,
            pattern_table: pattern_mode === 'DA' ? (pattern_table || null) : null
          },
          options: {
            ...(azimuths_deg    ? { azimuths_deg }    : {}),
            ...(max_interferers ? { max_interferers } : {})
          }
        };
        const r = await fetch('/api/am-night/nif', {
          method:      'POST',
          credentials: 'same-origin',
          headers:     { 'content-type': 'application/json' },
          body:        JSON.stringify(body),
          signal:      ctrl.signal
        });
        if (!r.ok){
          const j = await r.json().catch(() => ({}));
          setState({ loading: false, study: null,
            error: j.error || `HTTP ${r.status}` });
          return;
        }
        const j = await r.json();
        setState({ loading: false, study: j, error: null });
      } catch (e){
        if (e.name === 'AbortError') return;   // superseded by next nudge
        setState({ loading: false, study: null, error: String(e.message || e) });
      }
    }, debounceMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, debounceMs]);

  // Identify which skywave engine the orchestrator picked (FCCAM
  // Wang vs Berry analytical screening).  When evidence carries
  // engine: 'berry-1968-screening' or source: 'berry-1968-screening',
  // surface a SCREENING badge so the engineer doesn't mistake the
  // preview for filing-grade output.
  const engineId = state.study?.source
                || state.study?.proposed?.source
                || (state.study?.engine === 'berry-1968-screening' ? 'berry-1968-screening' : null);
  const isBerry = engineId === 'berry-1968-screening';
  const footerText = isBerry
    ? 'Preview only — exhibit re-compute is what files.  Numbers come from Berry analytical model (§73.190(c)) — SCREENING-grade.  Re-run with FCCAM Wang before filing.'
    : 'Preview only — exhibit re-compute is what files.  Numbers come from FCCAM (Wang 1985 skywave model, §73.190(c)).';

  return (
    <div className="rounded-md border border-rule p-3 space-y-2 font-mono text-[12px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase flex items-center gap-2">
        <span>AM nighttime allocation (§73.182) — live preview</span>
        {state.loading && <span className="text-gold">computing…</span>}
        {!state.loading && state.study?.available && isBerry && (
          <span
            title="Berry analytical formula (§73.190(c)) — under-estimates field strength relative to FCCAM Wang.  SCREENING-grade only.  Re-run with FCCAM before filing."
            className="ml-auto text-[10px] tracking-rack uppercase border border-amber-400 text-amber-400 rounded px-1.5 py-0.5">
            Berry · screening
          </span>
        )}
        {!state.loading && state.study?.available && !isBerry && engineId && (
          <span
            title="FCCAM Wang 1985 skywave model — filing-grade per §73.190(c)."
            className="ml-auto text-[10px] tracking-rack uppercase border border-emerald-400 text-emerald-400 rounded px-1.5 py-0.5">
            FCCAM · filing-grade
          </span>
        )}
      </div>
      <NifBody state={state} />
      <div className={`text-[10px] ${isBerry ? 'text-amber-400' : 'text-textDim'}`}>
        {footerText}
      </div>
    </div>
  );
}

function NifBody({ state }){
  if (state.error){
    return (
      <div className="text-red-400 text-[11px]">
        {state.error}
      </div>
    );
  }
  if (state.loading && !state.study){
    return <div className="text-textDim text-[11px]">Waiting for first compute…</div>;
  }
  const s = state.study;
  if (!s){
    return <div className="text-textDim text-[11px]">No preview yet.</div>;
  }
  if (!s.available){
    return (
      <div className="space-y-1">
        <div className="text-amber-400 text-[11px]">NIF preview unavailable.</div>
        <div className="text-textDim text-[10px]">{s.error || 'no detail returned'}</div>
      </div>
    );
  }
  const sum = s.summary || {};
  const passing = (sum.n_failing_azimuths || 0) === 0
               && (sum.n_no_service_azimuths || 0) === 0;
  const verdictColor = passing ? 'text-emerald-400' : 'text-red-400';
  const verdictText  = passing ? 'PROTECTED' : 'PROTECTION FAILS';
  const radiusLine = (Number.isFinite(sum.mean_radius_km)
                       ? `${sum.mean_radius_km.toFixed(0)} km mean`
                       : '—') +
                     (Number.isFinite(sum.min_radius_km) && Number.isFinite(sum.max_radius_km)
                       ? `  (${sum.min_radius_km.toFixed(0)}–${sum.max_radius_km.toFixed(0)} km range)`
                       : '');
  const marginLine = Number.isFinite(sum.worst_margin_db)
    ? `${sum.worst_margin_db > 0 ? '+' : ''}${sum.worst_margin_db.toFixed(1)} dB worst margin`
    : 'worst margin —';
  const failing = (s.contour || [])
    .filter((p) => p?.binding && p.binding.pass === false)
    .slice(0, 3);

  return (
    <div className="space-y-1">
      <div className={`text-[12px] tracking-rack uppercase ${verdictColor}`}>
        {verdictText} · {sum.n_failing_azimuths || 0} fail / {sum.n_azimuths || 0} azimuths
      </div>
      <div className="text-cream">NIF radius: {radiusLine}</div>
      <div className="text-cream">{marginLine}</div>
      <div className="text-textDim text-[10px]">
        {sum.n_interferers_used || 0} interferers (of {sum.n_interferers_seen || 0}) within §73.182(k) RSS pool
        {s.interferer_cap_applied ? ' · cap applied' : ''}
      </div>
      {failing.length > 0 && (
        <div className="pt-1 border-t border-rule/40">
          <div className="text-[10px] tracking-rack uppercase text-textDim mb-1">Failing azimuths</div>
          <table className="w-full text-[11px]">
            <thead className="text-textDim text-[10px] tracking-rack uppercase">
              <tr>
                <th className="text-right">Az (°)</th>
                <th className="text-right">NIF (km)</th>
                <th className="text-left pl-2">Binding</th>
                <th className="text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {failing.map((p) => (
                <tr key={p.azimuth_deg} className="border-t border-rule/30">
                  <td className="text-right py-0.5">{p.azimuth_deg?.toFixed?.(0)}</td>
                  <td className="text-right">{p.distance_km?.toFixed?.(0)}</td>
                  <td className="text-left pl-2 text-textDim">{p.binding?.relation || '—'}</td>
                  <td className="text-right text-red-400">
                    {Number.isFinite(p.binding?.margin_db)
                      ? `${p.binding.margin_db > 0 ? '+' : ''}${p.binding.margin_db.toFixed(1)} dB`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
