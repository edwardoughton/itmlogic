import React, { useEffect, useMemo, useRef, useState } from 'react';

// Comparable-facility benchmarking workbench panel.  Wraps
// POST /api/comparables/fm and renders the top-K most similar
// already-licensed full-service FMs with similarity scoring,
// per-axis component breakdown, and §73.211 class-headroom
// diagnostics.
//
// Use case
//   "Is this facility competitive?" — the broker / engineer
//   walks in cold, sets the FacilityRack inputs, opens this
//   panel.  No fileable artifact; this is a screening view.

const DEFAULT_RADIUS_KM = 300;
const DEFAULT_TOP_K     = 20;

export default function ComparableFacilitiesPanel({ baseInputs }){
  const [radiusKm,  setRadiusKm]  = useState(DEFAULT_RADIUS_KM);
  const [topK,      setTopK]      = useState(DEFAULT_TOP_K);
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState('');
  const [result,    setResult]    = useState(null);
  const abortRef = useRef(null);

  const subject = useMemo(() => ({
    lat:           Number(baseInputs?.lat),
    lon:           Number(baseInputs?.lon),
    fcc_class:     baseInputs?.fcc_class || null,
    erp_kw:        Number(baseInputs?.erp_kw),
    haat_m:        Number(baseInputs?.haat_m),
    frequency_mhz: Number(baseInputs?.frequency),
    facility_id:   baseInputs?.facility_id || null
  }), [baseInputs]);

  const subjectComplete = Number.isFinite(subject.lat)
                       && Number.isFinite(subject.lon)
                       && !!subject.fcc_class;

  async function runSearch(){
    if (!subjectComplete){
      setError('FacilityRack needs lat, lon, and fcc_class before benchmarking.');
      return;
    }
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/comparables/fm', {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'content-type': 'application/json' },
        body:        JSON.stringify({
          subject,
          radius_km: Number(radiusKm) || DEFAULT_RADIUS_KM,
          topK:      Number(topK)     || DEFAULT_TOP_K
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

  useEffect(() => {
    if (subjectComplete) runSearch();
    return () => { if (abortRef.current) abortRef.current.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4 font-mono text-[12px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase">
        Peer benchmarking — §73.211 class context, §73.215 contour thresholds
      </div>

      <div className="rounded-md border border-rule p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Subject">
            <span className="text-cream">
              {subject.fcc_class || '?'}
              {Number.isFinite(subject.erp_kw) ? ` · ${subject.erp_kw} kW` : ''}
              {Number.isFinite(subject.haat_m) ? ` · ${subject.haat_m} m HAAT` : ''}
            </span>
          </Field>
          <Field label="Site">
            <span className="text-cream">
              {Number.isFinite(subject.lat) ? subject.lat.toFixed(4) : '—'}, {Number.isFinite(subject.lon) ? subject.lon.toFixed(4) : '—'}
            </span>
          </Field>
          <Field label="Radius (km)">
            <input
              type="number" min="50" max="1500" step="10"
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value) || DEFAULT_RADIUS_KM)}
              className="w-20 bg-black/70 border border-rule rounded px-2 py-1 text-cream"
            />
          </Field>
          <Field label="Top K">
            <input
              type="number" min="1" max="100" step="1"
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value) || DEFAULT_TOP_K)}
              className="w-20 bg-black/70 border border-rule rounded px-2 py-1 text-cream"
            />
          </Field>
          <button
            onClick={runSearch}
            disabled={busy || !subjectComplete}
            className="ml-auto text-[10px] tracking-rack uppercase bg-gradient-to-b from-gold/30 to-gold/10 hover:from-gold/40 hover:to-gold/20 border border-gold/50 rounded px-3 py-1 disabled:opacity-40"
          >
            {busy ? 'Ranking…' : 'Run benchmark'}
          </button>
        </div>

        {!subjectComplete && (
          <div className="text-amber-400 text-[11px]">
            FacilityRack needs lat / lon / class before the benchmark can run.
          </div>
        )}
        {error && <div className="text-red-400 text-[11px]">{error}</div>}
        {result?.ok && <SummaryRow result={result} />}
      </div>

      {result?.ok && (
        <>
          {result.reference && (
            <div className="rounded-md border border-rule p-3 text-[11px] space-y-1">
              <div className="text-textDim text-[10px] tracking-rack uppercase">
                §73.211 reference for class {result.subject?.fcc_class}
              </div>
              <div className="text-cream">
                Max ERP: <span className="text-textDim">{result.reference.max_erp_kw} kW</span>
                <span className="mx-3">·</span>
                Max HAAT: <span className="text-textDim">{result.reference.max_haat_m} m</span>
                <span className="mx-3">·</span>
                Service contour: <span className="text-textDim">{result.reference.service_contour_dbu} dBu</span>
              </div>
            </div>
          )}
          <div className="rounded-md border border-rule p-3 space-y-2">
            <div className="text-textDim text-[10px] tracking-rack uppercase">Top {result.results?.length ?? 0} comparable facilities</div>
            <ResultsTable rows={result.results} subject={result.subject} />
          </div>
        </>
      )}

      <div className="text-[10px] text-textDim">
        Screening view.  Ranking is informative — pull the comparator's full
        exhibit to drill into geometry, contours, or population.
      </div>
    </div>
  );
}

function SummaryRow({ result }){
  const s = result.stats || {};
  return (
    <div className="text-[11px] flex flex-wrap gap-3">
      <span className="text-emerald-400">{s.n_returned ?? 0} comparable</span>
      <span className="text-textDim">/ {s.n_in_radius ?? 0} in radius / {s.n_total ?? 0} pulled</span>
      <span className="text-textDim">{s.n_same_class ?? 0} same class</span>
      {Number.isFinite(s.median_erp_kw) && (
        <span className="text-textDim">median ERP {s.median_erp_kw} kW</span>
      )}
      {Number.isFinite(s.median_haat_m) && (
        <span className="text-textDim">median HAAT {s.median_haat_m} m</span>
      )}
      {result.upstream && (
        <span className="text-textDim ml-auto">{result.upstream.source}</span>
      )}
    </div>
  );
}

function ResultsTable({ rows, subject }){
  if (!rows || rows.length === 0){
    return <div className="text-textDim text-[11px]">No comparators in radius.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead className="text-textDim text-[10px] tracking-rack uppercase">
          <tr>
            <th className="text-right py-1">#</th>
            <th className="text-left pl-2">Call</th>
            <th className="text-right">Class</th>
            <th className="text-right">MHz</th>
            <th className="text-right">ERP (kW)</th>
            <th className="text-right">HAAT (m)</th>
            <th className="text-right">Dist (km)</th>
            <th className="text-right">Score</th>
            <th className="text-right">Headroom (ERP/HAAT)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <ResultRow key={row.facility_id || row.call || i} rank={i + 1} row={row} subject={subject} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultRow({ rank, row, subject }){
  const sameClass = subject?.fcc_class && row.fcc_class === subject.fcc_class;
  return (
    <tr className="border-t border-rule/40">
      <td className="text-right text-textDim">{rank}</td>
      <td className="text-left pl-2 text-cream">{row.call || '—'}</td>
      <td className={`text-right ${sameClass ? 'text-emerald-400' : 'text-cream'}`}>
        {row.fcc_class || '—'}
      </td>
      <td className="text-right">{Number.isFinite(row.frequency_mhz) ? row.frequency_mhz.toFixed(1) : '—'}</td>
      <td className="text-right">{Number.isFinite(row.erp_kw) ? row.erp_kw : '—'}</td>
      <td className="text-right">{Number.isFinite(row.haat_m) ? row.haat_m : '—'}</td>
      <td className="text-right text-textDim">{Number.isFinite(row.distance_km) ? row.distance_km.toFixed(1) : '—'}</td>
      <td className="text-right">{Number.isFinite(row.similarity_score) ? row.similarity_score.toFixed(3) : '—'}</td>
      <td className="text-right text-textDim">
        {row.class_headroom ? (
          <span className={row.class_headroom.at_class_ceiling ? 'text-amber-400' : ''}
                title={row.class_headroom.at_class_ceiling ? 'At §73.211 class ceiling' : '§73.211 headroom remaining'}>
            {Number.isFinite(row.class_headroom.erp_kw_remaining) ? `+${row.class_headroom.erp_kw_remaining} kW` : '—'}
            {' / '}
            {Number.isFinite(row.class_headroom.haat_m_remaining) ? `+${row.class_headroom.haat_m_remaining} m` : '—'}
          </span>
        ) : '—'}
      </td>
    </tr>
  );
}

function Field({ label, children }){
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-textDim text-[10px] tracking-rack uppercase">{label}</label>
      <div className="text-[12px]">{children}</div>
    </div>
  );
}
