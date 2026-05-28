import React, { useEffect, useMemo, useState } from 'react';
import {
  FCC_TIMEZONE_CODES,
  defaultTzForLatLon
} from '../../evidence/fccSunClient.js';

// AM Sunrise / Sunset Authority — surfaces the FCC SRSSTIME
// sidecar's per-month local-time sunrise/sunset for the
// currently-loaded AM facility.  Used as an operational
// primitive for §73.99 PSRA / PSSA support, AM day/night mode
// switching, transmitter power schedules, and the §73.1209
// service-hour exhibit appendix.
//
// VISIBILITY
//   Renders only for AM facilities (service === 'AM' on
//   baseInputs).  For FM/FX renders an inline "not applicable"
//   hint.
//
// FAIL-SOFT
//   - When the sidecar is unavailable: shows the warning
//     "FCC sunrise/sunset sidecar unavailable — AM timing
//     appendix omitted."  Study is not blocked.
//
// REGULATORY
//   - 47 CFR §73.99   — pre-sunrise / post-sunset authority
//   - 47 CFR §73.1209 — day/night-mode service hours

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export default function AmSunAuthorityPanel({ baseInputs }){
  const isAm = String(baseInputs?.service || '').toUpperCase() === 'AM';
  const lat  = Number(baseInputs?.lat);
  const lon  = Number(baseInputs?.lon);
  const haveSite = Number.isFinite(lat) && Number.isFinite(lon);

  const defaultTz = useMemo(
    () => (haveSite ? defaultTzForLatLon(lat, lon) : 'B'),
    [haveSite, lat, lon]
  );

  const [tz,       setTz]       = useState(defaultTz);
  const [busy,     setBusy]     = useState(false);
  const [result,   setResult]   = useState(null);
  const [error,    setError]    = useState('');
  const [replayOpen, setReplayOpen] = useState(false);

  // Reset tz default when the facility (and therefore the natural
  // default) changes.
  useEffect(() => { setTz(defaultTz); }, [defaultTz]);

  useEffect(() => {
    if (!isAm || !haveSite) return undefined;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError('');
      try {
        const url = `/api/am/sun?lat=${encodeURIComponent(lat.toFixed(6))}`
                  + `&lon=${encodeURIComponent(lon.toFixed(6))}`
                  + `&tzone=${encodeURIComponent(tz)}`;
        const r = await fetch(url, { credentials: 'same-origin' });
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
  }, [isAm, haveSite, lat, lon, tz]);

  if (!isAm){
    return (
      <div className="rounded-md border border-rule p-3 text-[11px] text-textDim font-mono">
        AM Sunrise / Sunset Authority — applies only to AM facilities (service=AM).
      </div>
    );
  }
  if (!haveSite){
    return (
      <div className="rounded-md border border-rule p-3 text-[11px] text-textDim font-mono">
        AM Sunrise / Sunset Authority — needs facility lat / lon.
      </div>
    );
  }

  return (
    <div className="space-y-4 font-mono text-[12px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase flex items-center gap-2">
        <span>AM Sunrise / Sunset Authority — §73.99 / §73.1209</span>
        {result?.available && (
          <span
            title="FCC SRSSTIME — operator sidecar implementing the FCC's published sunrise/sunset calculation schedule."
            className="ml-auto text-[10px] tracking-rack uppercase border border-emerald-400 text-emerald-400 rounded px-1.5 py-0.5">
            FCC SRSSTIME
          </span>
        )}
      </div>

      <div className="rounded-md border border-rule p-3 space-y-3">
        <div className="flex flex-wrap items-end gap-3 text-[11px]">
          <Field label="Lat">
            <span className="text-cream">{lat.toFixed(4)}</span>
          </Field>
          <Field label="Lon">
            <span className="text-cream">{lon.toFixed(4)}</span>
          </Field>
          <Field label="Timezone (FCC code)">
            <select
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              className="bg-black/70 border border-rule rounded px-2 py-1 text-cream text-[12px]">
              {FCC_TIMEZONE_CODES.map((t) => (
                <option key={t.code} value={t.code}>{t.code} · {t.label}</option>
              ))}
            </select>
          </Field>
          {result?.timezone_label && (
            <span className="text-textDim text-[10px]">
              Resolved: {result.timezone_label}
            </span>
          )}
        </div>
        {busy && <div className="text-textDim text-[11px]">fetching FCC SRSSTIME…</div>}

        {/* Fail-soft warning when sidecar unconfigured or unreachable.  */}
        {result && !result.available && (
          <div className="rounded-md border border-amber-400 bg-amber-400/10 p-2 text-[11px] text-amber-300">
            FCC sunrise/sunset sidecar unavailable — AM timing appendix omitted.
            {error || result.error
              ? <div className="text-textDim text-[10px] mt-1">{error || result.error}</div>
              : null}
          </div>
        )}
      </div>

      {result?.available && <MonthlyTable monthly={result.monthly} />}

      {result?.available && result.dms && (
        <DmsBlock dms={result.dms} />
      )}

      {result?.available && result.replay && (
        <details className="rounded-md border border-rule p-3 text-[11px]"
                 open={replayOpen}
                 onToggle={(e) => setReplayOpen(e.target.open)}>
          <summary className="cursor-pointer text-textDim text-[10px] tracking-rack uppercase">
            Replay / provenance
          </summary>
          <pre className="mt-2 whitespace-pre-wrap text-cream text-[11px]">{result.replay}</pre>
        </details>
      )}

      <div className="text-[10px] text-amber-300/80">
        FCC authorizations use standard time unless otherwise specified.  Final authority remains the station license.
      </div>
    </div>
  );
}

function MonthlyTable({ monthly }){
  if (!monthly || typeof monthly !== 'object') return null;
  return (
    <div className="rounded-md border border-rule p-3 space-y-2">
      <div className="text-textDim text-[10px] tracking-rack uppercase">Monthly sunrise / sunset</div>
      <table className="w-full text-[11px]">
        <thead className="text-textDim text-[10px] tracking-rack uppercase">
          <tr>
            <th className="text-left py-1">Month</th>
            <th className="text-right">Sunrise</th>
            <th className="text-right">Sunset</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 12 }, (_, i) => {
            const key = String(i + 1);
            const row = monthly[key] || monthly[i + 1] || {};
            return (
              <tr key={key} className="border-t border-rule/40">
                <td className="text-left py-0.5">{MONTH_LABELS[i]}</td>
                <td className="text-right text-cream">{fmtHm(row.sunrise)}</td>
                <td className="text-right text-cream">{fmtHm(row.sunset)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DmsBlock({ dms }){
  if (!dms) return null;
  const fmt = (d) => d ? `${d.degrees ?? '—'}° ${d.minutes ?? '—'}′ ${d.seconds ?? '—'}″` : '—';
  return (
    <div className="rounded-md border border-rule p-3 text-[11px] space-y-1">
      <div className="text-textDim text-[10px] tracking-rack uppercase">DMS coordinates (as FCC ingested)</div>
      <div className="text-cream">Lat {fmt(dms.lat)}</div>
      <div className="text-cream">Lon {fmt(dms.lon)}</div>
    </div>
  );
}

function fmtHm(v){
  if (!v) return '—';
  return String(v);
}

function Field({ label, children }){
  return (
    <div className="flex flex-col gap-0.5">
      <label className="text-textDim text-[10px] tracking-rack uppercase">{label}</label>
      <div className="text-[12px]">{children}</div>
    </div>
  );
}
