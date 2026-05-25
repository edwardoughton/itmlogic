import React, { useEffect, useMemo, useState } from 'react';

// AM PSRA / PSSA Reduced-Power Exhibit — surfaces the §73.99(b)(1)
// reduced-power formula for the currently-loaded AM facility.  Hits
// POST /api/am/psra-pssa, which threads sun + nearby-primaries +
// FCCAM/Berry skywave + the closed-form scaling per protected pair.
//
// VISIBILITY
//   AM only (service === 'AM' on baseInputs).
//
// FAIL-SOFT
//   - available:false → warning banner, study not blocked
//   - sun unconfigured → power section still shows (ceiling-only)
//   - skywave unconfigured → pairs empty, ceiling-only verdict
//
// REGULATORY
//   - 47 CFR §73.99(b)(1)   — 500 W ceiling + per-pair scaling
//   - 47 CFR §73.99(b)(2)   — SS-1 (PSSA) vs SS-2 (PSRA) selection
//   - 47 CFR §73.182(k)     — RSS budget for E_max_allowed
//   - 47 CFR §73.190(c)     — skywave field engine

export default function AmPsraPssaPanel({ baseInputs }){
  const isAm = String(baseInputs?.service || '').toUpperCase() === 'AM';
  const lat  = Number(baseInputs?.lat);
  const lon  = Number(baseInputs?.lon);
  const haveSite = Number.isFinite(lat) && Number.isFinite(lon);

  // Pull the proposed facility numbers from the facility rack.  The
  // engine wants frequency in kHz and p_daytime in kW; the rack stores
  // frequency in MHz for FM compatibility, so normalize here.
  const proposed = useMemo(() => {
    if (!isAm || !haveSite) return null;
    const f = Number(baseInputs?.frequency);
    const freq_khz = Number.isFinite(f) && f > 0
      ? (f < 30 ? Math.round(f * 1000) : Math.round(f))
      : null;
    const p_daytime_kw = Number(baseInputs?.erp_kw);
    if (!Number.isFinite(freq_khz) || !Number.isFinite(p_daytime_kw) || p_daytime_kw <= 0){
      return null;
    }
    return {
      call:          baseInputs?.call || null,
      facility_id:   baseInputs?.facility_id || null,
      lat, lon,
      freq_khz,
      fcc_class:     baseInputs?.fcc_class || 'B',
      p_daytime_kw,
      timezone_code: baseInputs?.timezone_code || undefined
    };
  }, [isAm, haveSite, lat, lon, baseInputs?.frequency, baseInputs?.erp_kw,
      baseInputs?.fcc_class, baseInputs?.call, baseInputs?.facility_id,
      baseInputs?.timezone_code]);

  const [busy,   setBusy]   = useState(false);
  const [result, setResult] = useState(null);
  const [error,  setError]  = useState('');

  useEffect(() => {
    if (!proposed) return undefined;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError('');
      try {
        const r = await fetch('/api/am/psra-pssa', {
          method:      'POST',
          credentials: 'same-origin',
          headers:     { 'content-type': 'application/json' },
          body:        JSON.stringify({ proposed })
        });
        const j = await r.json().catch(() => ({}));
        if (!cancelled){
          setResult(j);
          if (!r.ok) setError(j.error || `HTTP ${r.status}`);
        }
      } catch (e){
        if (!cancelled) setError(e.message || 'Network error');
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, [JSON.stringify(proposed)]);

  if (!isAm){
    return (
      <div className="rounded-md border border-rule p-3 text-[11px] text-textDim font-mono">
        AM Reduced-Power Exhibit (§73.99) — applies only to AM facilities (service=AM).
      </div>
    );
  }
  if (!haveSite || !proposed){
    return (
      <div className="rounded-md border border-rule p-3 text-[11px] text-textDim font-mono">
        AM Reduced-Power Exhibit (§73.99) — needs facility lat/lon, frequency, and a positive daytime ERP.
      </div>
    );
  }

  const engine = result?.provenance?.skywave_engine || null;
  const engineBadge = engine === 'fccam-wang-1985'   ? 'FCCAM'
                    : engine === 'berry-1968-screening' ? 'BERRY (SCREENING)'
                    : engine === 'unconfigured'      ? 'NO SKYWAVE'
                    : null;

  return (
    <div className="space-y-4 font-mono text-[12px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase flex items-center gap-2">
        <span>AM Reduced Power — §73.99(b)(1)/(2)</span>
        {engineBadge && (
          <span
            className={`ml-auto text-[10px] tracking-rack uppercase border rounded px-1.5 py-0.5 ${
              engineBadge === 'FCCAM' ? 'border-emerald-400 text-emerald-400'
                : engineBadge === 'BERRY (SCREENING)' ? 'border-amber-400 text-amber-300'
                : 'border-rule text-textDim'
            }`}
            title={
              engineBadge === 'FCCAM' ? 'FCCAM Wang 1985 (FCC reference skywave engine)'
                : engineBadge === 'BERRY (SCREENING)' ? 'Berry 1968 screening fallback — not filing-grade per §73.190(c)'
                : 'No skywave sidecar configured — protected_pairs empty, only the §73.99(b)(1) 500 W ceiling applies.'
            }>
            {engineBadge}
          </span>
        )}
      </div>

      {busy && <div className="text-textDim text-[11px]">computing §73.99 reduced powers…</div>}

      {result && !result.available && (
        <div className="rounded-md border border-amber-400 bg-amber-400/10 p-2 text-[11px] text-amber-300">
          §73.99 reduced-power exhibit unavailable — {result.error || error || 'upstream error'}
        </div>
      )}

      {result?.available && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <PowerWindowCard label="PSSA · 50% skywave (SS-1)" pool={result.power?.pssa} ceiling={result.power?.ceiling_w} />
            <PowerWindowCard label="PSRA · 10% skywave (SS-2)" pool={result.power?.psra} ceiling={result.power?.ceiling_w} />
          </div>

          {result.windows?.windows && (
            <WindowSchedule windows={result.windows.windows} />
          )}

          <ProtectedPairsTable pairs={result.protected_pairs} />

          {result.power?.notes?.length ? (
            <ul className="text-[10.5px] text-textDim space-y-0.5 list-disc list-inside">
              {result.power.notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          ) : null}

          <div className="text-[10px] text-amber-300/80">
            Genoa does not certify FCC filings.  Final certification remains the responsibility of the qualified broadcast engineer of record.
          </div>
        </>
      )}
    </div>
  );
}

function PowerWindowCard({ label, pool, ceiling }){
  if (!pool){
    return (
      <div className="rounded-md border border-rule p-3 text-[11px] text-textDim">
        {label} — not computed
      </div>
    );
  }
  const p = pool.p_reduced_w;
  const fmtPw = (x) => Number.isFinite(x) ? `${Number(x).toFixed(x >= 100 ? 0 : 1)} W` : '—';
  return (
    <div className={`rounded-md border p-3 space-y-2 ${
      pool.available ? 'border-rule' : 'border-red-500 bg-red-500/5'
    }`}>
      <div className="text-textDim text-[10px] tracking-rack uppercase">{label}</div>

      <div className="flex items-baseline gap-2">
        <span className="text-[22px] text-cream font-semibold">{fmtPw(p)}</span>
        {pool.ceiling_applied && (
          <span
            title={`Clipped to §73.99(b)(1) ${ceiling ?? 500} W ceiling`}
            className="text-[10px] tracking-rack uppercase border border-gold/40 text-gold rounded px-1 py-0.5">
            ceiling
          </span>
        )}
        {!pool.available && (
          <span className="text-[10px] tracking-rack uppercase border border-red-400 text-red-300 rounded px-1 py-0.5">
            unavailable
          </span>
        )}
      </div>

      {pool.binding ? (
        <div className="text-[10.5px] text-textDim">
          Binding pair:&nbsp;
          <span className="text-cream">
            {pool.binding.call || pool.binding.facility_id || 'unknown'} ({pool.binding.relation})
          </span>
          {' · '}
          <span title="Closed-form scale factor (E_max/E_actual)²">scale {pool.binding.scale_factor}</span>
        </div>
      ) : (
        <div className="text-[10.5px] text-textDim">No binding protected pair — only the ceiling applies.</div>
      )}

      {pool.note  && <div className="text-[10.5px] text-textDim">{pool.note}</div>}
      {pool.error && <div className="text-[10.5px] text-red-300">{pool.error}</div>}
    </div>
  );
}

function WindowSchedule({ windows }){
  if (!windows?.psra && !windows?.pssa) return null;
  return (
    <div className="rounded-md border border-rule p-3 text-[11px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase mb-1">§73.99 windows (local time)</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <div className="text-textDim text-[10px]">PSRA · pre-sunrise</div>
          <div className="text-cream">{windows.psra?.start || '—'} → {windows.psra?.end || '—'}</div>
        </div>
        <div>
          <div className="text-textDim text-[10px]">PSSA · post-sunset</div>
          <div className="text-cream">{windows.pssa?.start || '—'} → {windows.pssa?.end || '—'}</div>
        </div>
      </div>
    </div>
  );
}

function ProtectedPairsTable({ pairs }){
  if (!Array.isArray(pairs) || pairs.length === 0){
    return (
      <div className="rounded-md border border-rule p-3 text-[10.5px] text-textDim">
        No protected primaries in radius — §73.99(b)(1) ceiling-only verdict.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-rule p-3 space-y-2">
      <div className="text-textDim text-[10px] tracking-rack uppercase">Protected primaries</div>
      <table className="w-full text-[11px]">
        <thead className="text-textDim text-[10px] tracking-rack uppercase">
          <tr>
            <th className="text-left py-1">Call</th>
            <th className="text-left">kHz</th>
            <th className="text-left">Class</th>
            <th className="text-left">Relation</th>
            <th className="text-right">Dist (km)</th>
            <th className="text-right">ERP day (kW)</th>
          </tr>
        </thead>
        <tbody>
          {pairs.map((p, i) => (
            <tr key={i} className="border-t border-rule/40">
              <td className="py-0.5 text-cream">{p.call || '—'}</td>
              <td>{p.frequency_khz ?? '—'}</td>
              <td>{p.fcc_class ?? '—'}</td>
              <td>{p.channel_relationship || p.relation || '—'}</td>
              <td className="text-right text-cream">
                {Number.isFinite(Number(p.distance_km)) ? Number(p.distance_km).toFixed(0) : '—'}
              </td>
              <td className="text-right text-cream">
                {Number.isFinite(Number(p.erp_kw)) ? Number(p.erp_kw).toFixed(2) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
