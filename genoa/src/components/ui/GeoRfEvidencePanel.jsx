import React, { useEffect, useMemo, useState } from 'react';

// Environmental RF Evidence — surfaces the advisory geo-RF evidence
// sidecar's per-point sample for the currently-loaded facility.
// Datasets currently surfaced:
//   - USFS Tree Canopy Cover (CONUS) — per-point canopy density
//   - tau_statistic_for_rf_models — availability flag only
//   - NRCan Canada landcover — availability flag (for cross-border)
//
// ADVISORY ONLY.  Environmental RF evidence provides advisory context
// from canopy, landcover, and RF/environment statistical datasets.  It
// may inform confidence scoring and residual analysis, but does not
// modify FCC rule outputs (§73.184 / §73.182 / §73.190 / §73.313 /
// §73.207 / §73.215).
//
// FAIL-SOFT
//   - sidecar unconfigured  → amber "not configured" notice
//   - sidecar unreachable   → amber "offline" notice
//   - coordinates missing   → amber "needs facility lat/lon" notice
//   None of these block the exhibit.

export default function GeoRfEvidencePanel({ baseInputs }){
  const lat = Number(baseInputs?.lat);
  const lon = Number(baseInputs?.lon);
  const haveSite = Number.isFinite(lat) && Number.isFinite(lon);

  const [busy,   setBusy]   = useState(false);
  const [result, setResult] = useState(null);
  const [error,  setError]  = useState('');

  useEffect(() => {
    if (!haveSite) return undefined;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError('');
      try {
        const params = new URLSearchParams({
          lat: lat.toFixed(6),
          lon: lon.toFixed(6),
          ...(baseInputs?.service     ? { service:     baseInputs.service }     : {}),
          ...(baseInputs?.call        ? { call:        baseInputs.call }        : {}),
          ...(baseInputs?.facility_id ? { facility_id: String(baseInputs.facility_id) } : {})
        });
        const r = await fetch(`/api/geo-rf-evidence/sample?${params}`, { credentials: 'same-origin' });
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
  }, [haveSite, lat, lon, baseInputs?.service, baseInputs?.call, baseInputs?.facility_id]);

  if (!haveSite){
    return (
      <div className="rounded-md border border-rule p-3 text-[11px] text-textDim font-mono">
        Environmental RF Evidence — needs facility lat / lon.
      </div>
    );
  }

  const status = String(result?.status || '').toLowerCase();
  const ds     = result?.datasets || {};
  // Prefer canonical `tree_canopy`; fall back to legacy
  // `tree_canopy_conus` so older sidecar contracts still render.
  const tc     = (ds.tree_canopy && ds.tree_canopy.available)
                   ? ds.tree_canopy : (ds.tree_canopy_conus || {});
  const lc     = ds.landcover                        || ds.canada_landcover || {};
  const tau    = ds.tau_rf_models                    || {};
  const m3     = ds.fcc_m3_conductivity_availability || {};
  const wp     = ds.water_proximity                  || {};
  const cp     = ds.climate_projection_availability  || {};
  const rs     = ds.sdr_residual_support             || {};
  const mm     = result?.map_marker                  || null;

  const advisoryBadge = (
    <span
      title="Environmental RF evidence — advisory only.  Does not modify FCC contour distances or any filing-controlling rule math."
      className="ml-auto text-[10px] tracking-rack uppercase border border-cyan-400 text-cyan-400 rounded px-1.5 py-0.5">
      Advisory · Geo-RF
    </span>
  );

  return (
    <div className="space-y-4 font-mono text-[12px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase flex items-center gap-2">
        <span>Environmental RF Evidence — advisory geospatial context</span>
        {advisoryBadge}
      </div>

      <div className="rounded-md border border-rule p-3 space-y-3">
        <div className="text-[11px] text-textDim leading-snug">
          Environmental RF evidence provides advisory context from canopy,
          landcover, and RF/environment statistical datasets.  It may inform
          confidence scoring and residual analysis, but{' '}
          <span className="text-amber-300">does not modify FCC rule outputs</span>{' '}
          (§73.184 / §73.182 / §73.190 / §73.313 / §73.207 / §73.215).
        </div>

        {busy && <div className="text-textDim text-[11px]">sampling geo-RF evidence…</div>}

        {result && status !== 'run' && (
          <div className="rounded-md border border-amber-400 bg-amber-400/10 p-2 text-[11px] text-amber-300">
            {status === 'not_configured'
              ? 'Geo-RF Evidence sidecar not configured (GEO_RF_EVIDENCE_SIDECAR_URL unset).'
              : status === 'offline'
                ? 'Geo-RF Evidence sidecar offline.'
                : (result.error || error || 'Geo-RF Evidence sample failed.')}
          </div>
        )}

        {status === 'run' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-md border border-rule p-3 space-y-1">
              <div className="text-textDim text-[10px] tracking-rack uppercase">Tree canopy (per-point)</div>
              <Kv k="Dataset"    v={tc.dataset || '—'} title={tc.dataset || ''} />
              <Kv k="Value"      v={tc.value_numeric != null ? String(tc.value_numeric) : (tc.value_raw || '—')} />
              <Kv k="Context"    v={tc.interpretation || '—'} />
              <Kv k="Coordinates" v={`${Number(lat).toFixed(4)}, ${Number(lon).toFixed(4)}`} />
              {mm && (
                <Kv k="Map marker"  v={mm.popup_text || `(${mm.lat}, ${mm.lon})`} title={mm.popup_text || ''} />
              )}
            </div>
            <div className="rounded-md border border-rule p-3 space-y-1">
              <div className="text-textDim text-[10px] tracking-rack uppercase">Auxiliary datasets</div>
              {lc.available  && <Kv k="Landcover"          v="available" />}
              {tau.available && <Kv k="Tau RF models"      v="available" />}
              {m3.available  && <Kv k="FCC M3 cond."       v="available" />}
              {wp.available  && <Kv k="Water proximity"    v="available" />}
              {cp.available  && <Kv k="Climate projection" v="available" />}
              {rs.available  && <Kv k="SDR residual"       v="available" />}
              {!(lc.available || tau.available || m3.available || wp.available || cp.available || rs.available) && (
                <div className="text-[11px] text-textDim italic">no auxiliary datasets sampled for this point</div>
              )}
              <Kv k="Filing effect"      v="None (advisory)" />
              <Kv k="Fetched at"         v={result.fetched_at || '—'} />
            </div>
          </div>
        )}
      </div>

      <div className="text-[10px] text-amber-300/80 leading-snug">
        Environmental RF evidence is advisory only.  Does not modify FCC
        filing-controlling contour or allocation calculations.
      </div>
    </div>
  );
}

function Kv({ k, v, title }){
  return (
    <div className="grid grid-cols-[110px_1fr] gap-x-2 text-[11px]" title={title || ''}>
      <span className="text-textDim text-[10px] tracking-rack uppercase">{k}</span>
      <span className="text-cream text-right break-all">{v}</span>
    </div>
  );
}
