import React, { useEffect, useMemo, useRef, useState } from 'react';
import RackPanel from './RackPanel.jsx';
import LedStatus from './LedStatus.jsx';

// Service-health panel — left rail telemetry block.
//
// Polls /readyz every POLL_MS and renders one row per service:
// the Genoa API, Postgres, every configured sidecar (terrain, splat,
// identity, map, nec, measurement) and every public upstream
// (facility, population, fccContours, fccLms).  Each row shows a
// red/amber/green/off LED and a one-word status label.
//
// LED semantics:
//   green   = configured AND healthy (probe returned ok)
//   red     = configured AND unhealthy (probe failed / timed out)
//   amber   = configured AND healthy but slow (>1500 ms)
//   off     = NOT configured (operator hasn't set the URL — by design)
//
// The poll is fire-and-forget and AbortControlled on unmount.

const POLL_MS    = 20_000;
const SLOW_MS    = 1_500;
const READYZ_URL = '/readyz';

// Display order + display labels.  Anything in `sidecars` not in this
// table still renders, just at the bottom in alphabetical order.
const ROWS = [
  // [key, label, kind]
  ['api',         'Genoa API',                 'core'],
  ['db',          'Postgres',                  'core'],
  ['terrain',     'Terrain',                   'sidecar'],
  ['splat',       'SPLAT (ITM / Longley-Rice)','sidecar'],
  ['map',         'Map render',                'sidecar'],
  ['identity',    'Identity (RadioDNS)',       'sidecar'],
  ['nec',         'NEC2++',                    'sidecar'],
  ['measurement', 'Measurement',               'sidecar'],
  ['los',         'LOS (ZTR)',                 'sidecar'],
  ['facility',    'Facility (ZTR)',            'upstream'],
  ['asr',         'ASR (FCC opendata)',        'upstream'],
  ['faaOe',       'FAA OE/AAA',                'upstream'],
  ['population',  'Population',                'upstream'],
  ['fccContours', 'FCC contours',              'upstream'],
  ['fccLms',      'FCC LMS',                   'upstream']
];

function ledFor(entry){
  if (!entry) return 'offline';
  if (!entry.configured) return 'offline';
  if (!entry.healthy) return 'blocked';
  if (entry.latency_ms != null && entry.latency_ms > SLOW_MS) return 'degraded';
  return 'nominal';
}

function detailFor(key, entry){
  if (!entry) return '—';
  if (!entry.configured) return key === 'db' ? 'stateless mode' : 'not configured';
  if (!entry.healthy) return entry.latency_ms != null ? `unreachable · ${entry.latency_ms} ms` : 'unreachable';
  return entry.latency_ms != null ? `${entry.latency_ms} ms` : 'reachable';
}

export default function ServiceHealthPanel(){
  const [snap,    setSnap]    = useState(null);
  const [error,   setError]   = useState(null);
  const [updated, setUpdated] = useState(null);
  const aborter = useRef(null);

  async function probe(){
    if (aborter.current) aborter.current.abort();
    const ac = new AbortController();
    aborter.current = ac;
    try {
      const r = await fetch(READYZ_URL, { signal: ac.signal, cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setSnap(j);
      setError(null);
      setUpdated(new Date());
    } catch (e){
      if (e.name === 'AbortError') return;
      setError(e.message || String(e));
    }
  }

  useEffect(() => {
    probe();
    const id = setInterval(probe, POLL_MS);
    return () => { clearInterval(id); aborter.current?.abort(); };
  }, []);

  // Build the row entries from the snapshot.
  const rows = useMemo(() => {
    const sidecars = snap?.sidecars || {};
    // API itself: green when we got a response, red when we didn't.
    const apiEntry = error
      ? { configured: true, healthy: false }
      : (snap ? { configured: true, healthy: true, latency_ms: null } : null);
    // DB: derive from snap.db_configured + snap.db_healthy.
    const dbEntry = !snap
      ? null
      : (snap.db_configured
          ? { configured: true,  healthy: !!snap.db_healthy }
          : { configured: false, healthy: false });

    const known = new Set(ROWS.map(r => r[0]));
    const tail  = Object.keys(sidecars)
      .filter(k => !known.has(k))
      .sort()
      .map(k => [k, k.replace(/_/g, ' '), 'sidecar']);

    return [...ROWS, ...tail].map(([key, label, kind]) => {
      let entry = null;
      if (key === 'api') entry = apiEntry;
      else if (key === 'db') entry = dbEntry;
      else entry = sidecars[key] || null;
      return { key, label, kind, entry };
    });
  }, [snap, error]);

  const ts = updated
    ? updated.toLocaleTimeString(undefined, { hour12: false })
    : '—';

  return (
    <RackPanel
      eyebrow="Telemetry"
      title="Service health"
      italicAccent="One LED per service.  Polled every 20 s."
      dense
      tone="default"
      right={(
        <button
          type="button"
          onClick={probe}
          className="font-mono text-[10px] uppercase tracking-rack text-textDim hover:text-text"
          title="Refresh now"
        >Refresh</button>
      )}
    >
      <ul className="divide-y divide-rule">
        {rows.map(({ key, label, kind, entry }) => {
          const status = ledFor(entry);
          return (
            <li key={key} className="flex items-center justify-between py-1.5 gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <LedStatus status={status} label="" />
                <span className="font-mono text-[11px] uppercase tracking-rack text-text truncate">
                  {label}
                </span>
              </div>
              <span
                className="font-mono text-[10px] tracking-rack uppercase text-textDim shrink-0"
                title={entry?.baseUrl || ''}
              >
                {detailFor(key, entry)}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="pt-2 mt-2 border-t border-rule font-mono text-[10px] tracking-rack uppercase text-textDim flex items-center justify-between">
        <span>Last poll · {ts}</span>
        {error && <span className="text-red">{error}</span>}
      </div>
    </RackPanel>
  );
}
