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
  const [radiusKm,        setRadiusKm]        = useState(DEFAULT_RADIUS_KM);
  const [topK,            setTopK]            = useState(DEFAULT_TOP_K);
  const [includeCoverage, setIncludeCoverage] = useState(false);
  const [busy,            setBusy]            = useState(false);
  const [error,           setError]           = useState('');
  const [result,          setResult]          = useState(null);
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
    // When the engineer toggles "Include coverage", we POST to the
    // SPLAT-fan-out endpoint (parallel ITM coverage per peer); the
    // base /comparables/fm endpoint stays the fast path for
    // metadata-only ranking.
    const endpoint = includeCoverage ? '/api/comparables/fm/with-coverage'
                                     : '/api/comparables/fm';
    try {
      const r = await fetch(endpoint, {
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
          <label className="text-[11px] flex items-center gap-1.5 text-textDim"
                 title="Fan SPLAT ITM coverage per peer in parallel — slower (10-60s) but shows actual coverage rings, not just metadata.">
            <input
              type="checkbox"
              checked={includeCoverage}
              onChange={(e) => setIncludeCoverage(e.target.checked)}
            />
            Include ITM coverage
          </label>
          <button
            onClick={runSearch}
            disabled={busy || !subjectComplete}
            className="ml-auto text-[10px] tracking-rack uppercase bg-gradient-to-b from-gold/30 to-gold/10 hover:from-gold/40 hover:to-gold/20 border border-gold/50 rounded px-3 py-1 disabled:opacity-40"
          >
            {busy ? (includeCoverage ? 'Ranking + fanning SPLAT…' : 'Ranking…')
                  : (includeCoverage ? 'Run benchmark + coverage' : 'Run benchmark')}
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
          {result.coverage && <CoverageSummary coverage={result.coverage} />}
          <div className="rounded-md border border-rule p-3 space-y-2">
            <div className="text-textDim text-[10px] tracking-rack uppercase">Top {result.results?.length ?? 0} comparable facilities</div>
            <ResultsTable rows={result.results} subject={result.subject} coverage={result.coverage} />
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

function ResultsTable({ rows, subject, coverage }){
  if (!rows || rows.length === 0){
    return <div className="text-textDim text-[11px]">No comparators in radius.</div>;
  }
  // When the with-coverage endpoint ran, build a lookup from
  // facility_id|call → coverage summary so each row can show
  // mean / area alongside its metadata.
  const covByKey = new Map();
  if (coverage?.comparators){
    for (const c of coverage.comparators){
      if (c.id        != null) covByKey.set(String(c.id), c);
      if (c.call           )   covByKey.set(c.call.toUpperCase(), c);
    }
  }
  const showCoverage = !!coverage?.comparators?.length;
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
            {showCoverage && <th className="text-right">Mean ITM (km)</th>}
            {showCoverage && <th className="text-right">Service area (km²)</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <ResultRow
              key={row.facility_id || row.call || i}
              rank={i + 1} row={row} subject={subject}
              coverage={
                covByKey.get(String(row.facility_id))
                || (row.call && covByKey.get(row.call.toUpperCase()))
                || null
              }
              showCoverage={showCoverage}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoverageSummary({ coverage }){
  const proposed = coverage?.proposed;
  return (
    <div className="rounded-md border border-rule p-3 space-y-1 text-[11px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase">
        ITM coverage fan-out · {coverage.n_ok}/{coverage.n_attempted} ok
        {coverage.n_failed > 0 && (
          <span className="text-amber-400"> · {coverage.n_failed} failed</span>
        )}
        <span className="text-textDim ml-2">
          (concurrency {coverage.fanout_concurrency}, {coverage.elapsed_ms} ms wall)
        </span>
      </div>
      {proposed?.available && (
        <div className="text-cream">
          Proposed: mean {proposed.mean_radial_km?.toFixed?.(1) || '—'} km
          · area {proposed.service_area_km2?.toFixed?.(0) || '—'} km²
          · n_radials {proposed.n_radials}
          {proposed.n_blocked ? ` · ${proposed.n_blocked} blocked` : ''}
        </div>
      )}
      {proposed && !proposed.available && (
        <div className="text-amber-400">
          Proposed coverage unavailable: {proposed.error}
        </div>
      )}
    </div>
  );
}

function ResultRow({ rank, row, subject, coverage = null, showCoverage = false }){
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
      {showCoverage && (
        <td className={`text-right ${coverage && !coverage.available ? 'text-amber-400' : ''}`}
            title={coverage && !coverage.available ? coverage.error : null}>
          {coverage?.available && Number.isFinite(coverage.mean_radial_km)
            ? coverage.mean_radial_km.toFixed(1)
            : (coverage ? '—' : '·')}
        </td>
      )}
      {showCoverage && (
        <td className="text-right text-textDim">
          {coverage?.available && Number.isFinite(coverage.service_area_km2)
            ? Math.round(coverage.service_area_km2)
            : (coverage ? '—' : '·')}
        </td>
      )}
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
