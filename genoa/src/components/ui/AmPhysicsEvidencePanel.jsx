import React, { useEffect, useMemo, useState } from 'react';

// AM Physics Evidence — surfaces the independent NEC-family
// SOMNEC2D physics sidecar's modified-Sommerfeld-integral ground-
// field solver result for the currently-loaded AM facility.
//
// ADVISORY ONLY.  The sidecar produces independent physics evidence
// that sits BESIDE FCC §73.183 / §73.184 / §73.190 / §73.182
// deterministic rule math.  It never overrides, modifies, or
// substitutes for FCC curve-derived contour distances, allocation
// results, or any filing-controlling rule calculation.
//
// VISIBILITY
//   Renders only for AM facilities (service === 'AM' on baseInputs).
//   For FM/FX renders an inline "not applicable" hint.
//
// FAIL-SOFT
//   - When the sidecar is unavailable (AM_PHYSICS_SIDECAR_URL unset
//     or the host is unreachable): renders an amber warning panel
//     and the study is not blocked.
//
// REGULATORY POSTURE
//   Genoa does not replace FCC allocation rules with NEC-family
//   physics output.  Genoa uses SOMNEC2D as an independent physics
//   engine beside deterministic FCC rule calculations.

export default function AmPhysicsEvidencePanel({ baseInputs }){
  const isAm = String(baseInputs?.service || '').toUpperCase() === 'AM';
  const freq_khz = useMemo(() => amFreqKhzFromBase(baseInputs), [baseInputs]);
  const sigma_ms_m = numOrNull(baseInputs?.ground_sigma_mS_m);
  const epr = numOrNull(baseInputs?.ground_epr);

  const [busy,    setBusy]    = useState(false);
  const [result,  setResult]  = useState(null);
  const [error,   setError]   = useState('');
  const [copied,  setCopied]  = useState(false);

  // Copy the full Grid SHA-256 (not the abbreviated display value) so
  // reviewers can paste the bytes-of-record into their replay tooling.
  async function copyGridSha(sha){
    if (!sha) return;
    try {
      if (navigator?.clipboard?.writeText){
        await navigator.clipboard.writeText(String(sha));
      } else {
        const ta = document.createElement('textarea');
        ta.value = String(sha);
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* fall through silently */ }
  }

  useEffect(() => {
    if (!isAm || !freq_khz) return undefined;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setError('');
      try {
        const body = {
          frequency_khz: freq_khz,
          ...(sigma_ms_m ? { sigma_ms_m } : {}),
          ...(epr ? { epr } : {}),
          print_grid: 1
        };
        const r = await fetch('/api/am/physics/somnec', {
          method:      'POST',
          credentials: 'same-origin',
          headers:     { 'content-type': 'application/json' },
          body:        JSON.stringify(body)
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
  }, [isAm, freq_khz, sigma_ms_m, epr]);

  if (!isAm){
    return (
      <div className="rounded-md border border-rule p-3 text-[11px] text-textDim font-mono">
        AM Physics (SOMNEC2D) — applies only to AM facilities (service=AM).
      </div>
    );
  }
  if (!freq_khz){
    return (
      <div className="rounded-md border border-rule p-3 text-[11px] text-textDim font-mono">
        AM Physics (SOMNEC2D) — needs an AM-band frequency on the facility.
      </div>
    );
  }

  // Prominent advisory badge — bright amber, uppercase, lockup
  // explicitly states filing_effect:none so reviewers cannot miss
  // the boundary even at a glance.
  const advisoryBadge = (
    <span
      title="Independent physics evidence — NEC-family FORTRAN SOMNEC2D modified Sommerfeld integral solver.  Does NOT modify FCC §73.184 curve-derived contour distances or any filing-controlling rule math. filing_effect = none."
      className="ml-auto text-[10px] tracking-rack uppercase font-semibold border border-amber-400 bg-amber-400/15 text-amber-300 rounded px-2 py-0.5 shadow-[0_0_0_1px_rgba(251,191,36,0.25)]">
      Advisory · SOMNEC2D · filing_effect=none
    </span>
  );

  const inputs  = result?.inputs || {};
  const outputs = result?.outputs || {};
  const summary = result?.stdout_summary || {};
  const status  = result?.status
                  || (result?.available ? 'run'
                      : (result?.error ? 'failed' : 'pending'));

  return (
    <div className="space-y-4 font-mono text-[12px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase flex items-center gap-2">
        <span>AM Physics — independent NEC ground-field evidence</span>
        {advisoryBadge}
      </div>

      <div className="rounded-md border border-rule p-3 space-y-3">
        <div className="text-[11px] text-textDim leading-snug">
          Independent NEC-family AM physics sidecar runs <span className="text-cream">SOMNEC2D</span>,
          a FORTRAN solver that numerically evaluates modified Sommerfeld integrals
          for lossy-ground field components.  Output is the SOM2D.NEC interpolation grid
          used by NEC-2 / NEC2++.  <span className="text-amber-300">
          This evidence is advisory and does not modify FCC §73.184 curve-derived
          contour distances.</span>
        </div>

        {busy && <div className="text-textDim text-[11px]">running SOMNEC2D…</div>}

        {result && (result.available === false || status !== 'run') && (
          <div className="rounded-md border border-amber-400 bg-amber-400/10 p-2 text-[11px] text-amber-300">
            {status === 'not_configured'
              ? 'AM physics sidecar not configured — independent evidence omitted (AM_PHYSICS_SIDECAR_URL unset).'
              : (result.error || error || 'AM physics sidecar unreachable.')}
          </div>
        )}

        {status === 'run' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-md border border-rule p-3 space-y-1">
              <div className="text-textDim text-[10px] tracking-rack uppercase">Inputs</div>
              <Kv k="EPR (εᵣ)"        v={inputs.epr ?? '—'} note={inputs.epr_source === 'default' ? 'default' : null} />
              <Kv k="Conductivity"   v={inputs.sig_s_m != null ? `${inputs.sig_s_m} S/m` : '—'} />
              <Kv k="(equiv.)"       v={inputs.sigma_ms_m != null ? `${inputs.sigma_ms_m} mS/m` : '—'} note={inputs.sigma_source === 'default' ? 'default' : null} />
              <Kv k="Frequency"      v={inputs.frequency_mhz != null ? `${inputs.frequency_mhz} MHz` : '—'} />
              <Kv k="Print grid"     v={inputs.print_grid ? 'yes' : 'no'} />
            </div>
            <div className="rounded-md border border-rule p-3 space-y-1">
              <div className="text-textDim text-[10px] tracking-rack uppercase">Outputs</div>
              <Kv k="Engine"         v={result.engine || 'somnec2d'} />
              <Kv k="Method"         v="Modified Sommerfeld integrals" />
              <Kv k="Grid file"      v={outputs.grid_file || '—'} />
              <div className="grid grid-cols-[110px_1fr] gap-x-2 text-[11px]"
                   title={outputs.grid_sha256 || ''}>
                <span className="text-textDim text-[10px] tracking-rack uppercase">Grid SHA-256</span>
                <span className="text-cream text-right break-all flex items-center justify-end gap-1">
                  <span>{outputs.grid_sha256 ? short(outputs.grid_sha256) : '—'}</span>
                  {outputs.grid_sha256 && (
                    <button
                      type="button"
                      onClick={() => copyGridSha(outputs.grid_sha256)}
                      title="Copy full SHA-256 to clipboard"
                      aria-label="Copy full Grid SHA-256"
                      className="ml-1 px-1 py-0 text-[9px] tracking-rack uppercase border border-rule rounded hover:border-cyan-400 hover:text-cyan-400">
                      {copied ? 'copied' : 'copy'}
                    </button>
                  )}
                </span>
              </div>
              <Kv k="Runtime"        v={summary.time_seconds != null ? `${Number(summary.time_seconds).toFixed(4)} s` : '—'} />
              <Kv k="Filing effect"  v="None (advisory)" />
            </div>
          </div>
        )}

        {status === 'run' && (
          <details className="rounded-md border border-rule p-3 text-[11px] group">
            <summary className="cursor-pointer text-textDim text-[10px] tracking-rack uppercase flex items-center gap-2 group-open:text-cream">
              <span>Solver detail (EPSCF, AR1, grid provenance)</span>
              <span className="ml-auto text-[9px] text-amber-300/80">advisory · filing_effect=none</span>
            </summary>
            <div className="mt-2 space-y-1 text-cream">
              {summary.epscf   && <div>EPSCF       = <span className="text-textDim">{summary.epscf}</span></div>}
              {summary.ar1_1_1 && <div>AR1[1,1,1]  = <span className="text-textDim">{summary.ar1_1_1}</span></div>}
              {outputs.grid_sha256 && (
                <div className="pt-1 border-t border-rule/40">
                  <div className="text-textDim text-[9px] tracking-rack uppercase">Grid SHA-256 (full)</div>
                  <div className="break-all text-[10px]">{outputs.grid_sha256}</div>
                </div>
              )}
              {!summary.epscf && !summary.ar1_1_1 && !outputs.grid_sha256 && (
                <div className="text-textDim">(no diagnostic detail returned by sidecar)</div>
              )}
            </div>
          </details>
        )}
      </div>

      <div className="text-[10px] text-amber-300/80 leading-snug">
        Genoa does not replace FCC allocation rules with NEC-family physics output.
        Genoa uses SOMNEC2D as an independent physics engine beside deterministic
        FCC rule calculations.
      </div>
    </div>
  );
}

function Kv({ k, v, note, title }){
  return (
    <div className="grid grid-cols-[110px_1fr] gap-x-2 text-[11px]" title={title || ''}>
      <span className="text-textDim text-[10px] tracking-rack uppercase">{k}</span>
      <span className="text-cream text-right break-all">
        {v}{note ? <span className="text-textDim text-[10px] ml-1">({note})</span> : null}
      </span>
    </div>
  );
}

function short(s){
  const str = String(s);
  if (str.length <= 16) return str;
  return str.slice(0, 8) + '…' + str.slice(-6);
}

function numOrNull(v){
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function amFreqKhzFromBase(baseInputs){
  const f = Number(baseInputs?.frequency);
  if (!Number.isFinite(f) || f <= 0) return null;
  if (f >= 535 && f <= 1705) return Math.round(f);
  if (f >= 0.5 && f < 30){
    const khz = Math.round(f * 1000);
    return (khz >= 535 && khz <= 1705) ? khz : null;
  }
  return null;
}
