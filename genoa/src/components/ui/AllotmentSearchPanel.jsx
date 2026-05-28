import React, { useEffect, useMemo, useRef, useState } from 'react';

// FM channel-search workbench panel.  Wraps POST /api/allotment/search
// and renders a ranked table — every FM channel 200-300 with §73.207 /
// §73.215 pass-state, binding constraint when blocked, and a "pick"
// button that pushes the channel's frequency back into the FacilityRack
// so the operator can re-compute on the new allotment.
//
// IMPORTANT — NOT a filing-grade analysis
//   This is a SCREENING tool.  V-Soft Probe5 lets engineers winnow
//   class+location combinations in seconds; the *fileable* analysis
//   still runs through the normal exhibit compute (which carries the
//   PE-cert, replay determinism, and the audited §73.207 / §73.215
//   exhibit appendix).  This panel reuses the same engines but doesn't
//   produce a filing artifact.
//
// REGULATORY
//   - 47 CFR §73.201 (allotments) + §73.207 (Table A) + §73.215 (contours)

const DEFAULT_RADIUS_KM = 300;

export default function AllotmentSearchPanel({ baseInputs, onPickChannel }){
  const [radiusKm,  setRadiusKm]  = useState(DEFAULT_RADIUS_KM);
  const [reservedBand, setReservedBand] = useState(true);
  const [filterMode, setFilterMode]     = useState('all');   // 'all' | 'available' | 'blocked'
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const abortRef = useRef(null);

  // Subject derived from the FacilityRack inputs.
  const subject = useMemo(() => ({
    lat:       Number(baseInputs?.lat),
    lon:       Number(baseInputs?.lon),
    fcc_class: baseInputs?.fcc_class || 'A',
    erp_kw:    Number(baseInputs?.erp_kw),
    haat_m:    Number(baseInputs?.haat_m),
    facility_id: baseInputs?.facility_id || null
  }), [baseInputs]);

  const subjectComplete = Number.isFinite(subject.lat)
                       && Number.isFinite(subject.lon)
                       && !!subject.fcc_class;

  async function runSearch(){
    if (!subjectComplete){
      setError('FacilityRack needs lat, lon, and fcc_class before searching.');
      return;
    }
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/allotment/search', {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'content-type': 'application/json' },
        body:        JSON.stringify({
          subject:       subject,
          radius_km:     Number(radiusKm) || DEFAULT_RADIUS_KM,
          reserved_band: !!reservedBand
        }),
        signal:      ctrl.signal
      });
      if (!r.ok){
        const j = await r.json().catch(() => ({}));
        setError(j.error || `HTTP ${r.status}`);
        setResult(null);
        return;
      }
      const j = await r.json();
      setResult(j);
    } catch (e){
      if (e.name === 'AbortError') return;
      setError(e.message || 'Network error');
    } finally {
      setBusy(false);
    }
  }

  // Auto-run once on mount when subject is complete.  No useEffect
  // looping — only the explicit "Search" button re-runs.
  useEffect(() => {
    if (subjectComplete) runSearch();
    return () => { if (abortRef.current) abortRef.current.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = useMemo(() => {
    if (!result?.results) return [];
    if (filterMode === 'available') return result.results.filter((r) => r.available);
    if (filterMode === 'blocked')   return result.results.filter((r) => !r.available);
    return result.results;
  }, [result, filterMode]);

  return (
    <div className="space-y-4 font-mono text-[12px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase">
        FM channel search — §73.201 / §73.207 / §73.215
      </div>

      <div className="rounded-md border border-rule p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Class">
            <span className="text-cream">{subject.fcc_class || '—'}</span>
          </Field>
          <Field label="Site">
            <span className="text-cream">
              {Number.isFinite(subject.lat) ? subject.lat.toFixed(4) : '—'}, {Number.isFinite(subject.lon) ? subject.lon.toFixed(4) : '—'}
            </span>
          </Field>
          <Field label="ERP (kW)">
            <span className="text-cream">{Number.isFinite(subject.erp_kw) ? subject.erp_kw : '—'}</span>
          </Field>
          <Field label="HAAT (m)">
            <span className="text-cream">{Number.isFinite(subject.haat_m) ? subject.haat_m : '—'}</span>
          </Field>
          <Field label="Scan radius (km)">
            <input
              type="number"
              min="50" max="1500" step="10"
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value) || DEFAULT_RADIUS_KM)}
              className="w-20 bg-black/70 border border-rule rounded px-2 py-1 text-cream"
            />
          </Field>
          <label className="text-[11px] flex items-center gap-1.5 text-textDim">
            <input
              type="checkbox"
              checked={reservedBand}
              onChange={(e) => setReservedBand(e.target.checked)}
            />
            Include reserved band (200-220)
          </label>
          <button
            onClick={runSearch}
            disabled={busy || !subjectComplete}
            className="ml-auto text-[10px] tracking-rack uppercase bg-gradient-to-b from-gold/30 to-gold/10 hover:from-gold/40 hover:to-gold/20 border border-gold/50 rounded px-3 py-1 disabled:opacity-40"
          >
            {busy ? 'Searching…' : 'Search'}
          </button>
        </div>

        {!subjectComplete && (
          <div className="text-amber-400 text-[11px]">
            FacilityRack needs lat / lon / class before the search can run.
          </div>
        )}
        {error && (
          <div className="text-red-400 text-[11px]">{error}</div>
        )}
        {result && !error && (
          <SummaryRow result={result} />
        )}
      </div>

      {result && (
        <div className="rounded-md border border-rule p-3 space-y-2">
          <div className="flex items-center gap-2">
            <div className="text-textDim text-[10px] tracking-rack uppercase">Results</div>
            <div className="ml-auto flex gap-1 text-[10px]">
              {['all', 'available', 'blocked'].map((m) => (
                <button
                  key={m}
                  onClick={() => setFilterMode(m)}
                  className={`px-2 py-0.5 border border-rule rounded uppercase tracking-rack ${
                    filterMode === m ? 'border-gold text-cream' : 'text-textDim hover:text-cream'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <ResultsTable rows={rows} onPickChannel={onPickChannel} />
        </div>
      )}

      <div className="text-[10px] text-textDim">
        Screening tool — engineers winnow channels in seconds.  The fileable analysis still runs through the normal exhibit compute (PE cert, replay determinism, §73.207/§73.215 appendix).
      </div>
    </div>
  );
}

function SummaryRow({ result }){
  if (!result.ok){
    return <div className="text-red-400 text-[11px]">{result.error || 'unknown error'}</div>;
  }
  return (
    <div className="text-[11px] flex flex-wrap gap-3">
      <span className="text-emerald-400">{result.n_available} available</span>
      <span className="text-textDim">/ {result.n_channels_evaluated} channels</span>
      {result.n_available_207_only != null && (
        <span className="text-textDim">
          (§73.207 clean: {result.n_available_both + result.n_available_207_only},
           §73.215 rescue: {result.n_available_215_only})
        </span>
      )}
      {result.upstream && (
        <span className="text-textDim ml-auto">
          {result.upstream.n_nearby} incumbent FMs within {result.upstream.radius_km} km · {result.upstream.source}
        </span>
      )}
    </div>
  );
}

function ResultsTable({ rows, onPickChannel }){
  if (rows.length === 0){
    return <div className="text-textDim text-[11px]">No rows match the current filter.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead className="text-textDim text-[10px] tracking-rack uppercase">
          <tr>
            <th className="text-right py-1">#</th>
            <th className="text-right">Ch</th>
            <th className="text-right">MHz</th>
            <th className="text-left pl-2">Band</th>
            <th className="text-center">§73.207</th>
            <th className="text-center">§73.215</th>
            <th className="text-right">Margin (km)</th>
            <th className="text-left pl-2">Binding</th>
            <th className="text-right"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <ResultRow key={row.channel} row={row} onPickChannel={onPickChannel} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultRow({ row, onPickChannel }){
  const verdictColor = row.available ? 'text-emerald-400' : 'text-red-400';
  const sec207 = pillFor(row.pass_73207);
  const sec215 = pillFor(row.pass_73215);
  return (
    <tr className={`border-t border-rule/40 ${row.available ? '' : 'opacity-70'}`}>
      <td className="text-right text-textDim">{row.scoring_rank}</td>
      <td className={`text-right ${verdictColor}`}>{row.channel}</td>
      <td className="text-right">{row.frequency_mhz?.toFixed?.(1)}</td>
      <td className="text-left pl-2 text-textDim">{row.band === 'reserved' ? 'NCE' : ''}</td>
      <td className="text-center">{sec207}</td>
      <td className="text-center">{sec215}</td>
      <td className="text-right">
        {Number.isFinite(row.margin_km) ? (
          <span className={row.margin_km < 0 ? 'text-red-400' : 'text-textDim'}>
            {row.margin_km > 0 ? '+' : ''}{row.margin_km.toFixed(1)}
          </span>
        ) : '—'}
      </td>
      <td className="text-left pl-2 text-textDim">
        {row.binding ? (
          <span title={`${row.binding.required_km} km required, ${row.binding.distance_km} km actual`}>
            {row.binding.station || '—'} ({row.binding.relation || '?'})
          </span>
        ) : '—'}
      </td>
      <td className="text-right pr-1">
        {row.available && onPickChannel ? (
          <button
            onClick={() => onPickChannel(row)}
            className="text-[10px] tracking-rack uppercase border border-rule rounded px-2 py-0.5 hover:border-gold/60 hover:text-cream"
          >
            Pick
          </button>
        ) : null}
      </td>
    </tr>
  );
}

function pillFor(state){
  if (state === true)             return <span className="text-emerald-400">PASS</span>;
  if (state === false)            return <span className="text-red-400">FAIL</span>;
  if (state === 'not_evaluated')  return <span className="text-textDim">—</span>;
  if (state === 'error')          return <span className="text-amber-400">err</span>;
  return <span className="text-textDim">—</span>;
}

function Field({ label, children }){
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-textDim text-[10px] tracking-rack uppercase">{label}</label>
      <div className="text-[12px]">{children}</div>
    </div>
  );
}
