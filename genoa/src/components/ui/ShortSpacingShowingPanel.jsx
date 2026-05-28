import React, { useEffect, useMemo, useRef, useState } from 'react';

// §73.215 short-spacing showing workbench panel.  When §73.207
// minimum-distance separations fail but §73.215 contour-protection
// passes (the canonical "short-spaced waiver" filing situation),
// this panel posts the current exhibit to /api/exhibits/short-
// spacing-showing and renders the per-pair table + boilerplate
// narrative + certification block — copy-paste-ready cover-letter
// content for the engineer of record.
//
// CONTRACT
//   <ShortSpacingShowingPanel exhibit={exhibit}/>
//
// FAIL-SOFT
//   - No exhibit yet → instructive hint, no fetch.
//   - §73.207 passes outright → "not applicable" message.
//   - §73.207 fails but no §73.215 attached → instructive error
//     pointing at re-compute with ERP/HAAT supplied.

export default function ShortSpacingShowingPanel({ exhibit }){
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');
  const [showing, setShowing] = useState(null);
  const [copied,  setCopied]  = useState(null);
  const abortRef = useRef(null);

  // Fingerprint the exhibit so we re-fetch when it changes; computed
  // once per exhibit object instead of stringifying the whole tree.
  const exhibitKey = useMemo(() => {
    if (!exhibit) return null;
    return exhibit.engine_signature?.fingerprint_sha256
        || exhibit.id
        || exhibit.generated_at
        || JSON.stringify(exhibit.station_inputs || {});
  }, [exhibit]);

  useEffect(() => {
    if (!exhibit){
      setShowing(null);
      setError('');
      return undefined;
    }
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setBusy(true);
    setError('');
    (async () => {
      try {
        const r = await fetch('/api/exhibits/short-spacing-showing', {
          method:      'POST',
          credentials: 'same-origin',
          headers:     { 'content-type': 'application/json' },
          body:        JSON.stringify({ exhibit }),
          signal:      ctrl.signal
        });
        if (!r.ok){
          const j = await r.json().catch(() => ({}));
          setError(j.error || `HTTP ${r.status}`);
          setShowing(null);
          return;
        }
        const j = await r.json();
        setShowing(j);
      } catch (e){
        if (e.name === 'AbortError') return;
        setError(e.message || 'Network error');
      } finally {
        setBusy(false);
      }
    })();
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [exhibitKey]);

  if (!exhibit){
    return (
      <div className="rounded-md border border-rule p-3 text-[11px] text-textDim font-mono">
        Compute an exhibit first; this panel works off its §73.207 / §73.215 results.
      </div>
    );
  }

  return (
    <div className="space-y-4 font-mono text-[12px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase flex items-center gap-2">
        <span>§73.215 short-spacing showing — auto-generated cover content</span>
        {busy && <span className="text-gold">computing…</span>}
      </div>

      {error && <div className="rounded-md border border-red-500 p-3 text-red-400 text-[11px]">{error}</div>}
      {showing && <ShowingBody showing={showing} copied={copied} setCopied={setCopied} />}
    </div>
  );
}

function ShowingBody({ showing, copied, setCopied }){
  if (!showing.ok){
    return <div className="rounded-md border border-red-500 p-3 text-red-400 text-[11px]">{showing.error}</div>;
  }
  if (showing.applicable === false){
    return (
      <div className="rounded-md border border-rule p-3 text-[11px] space-y-1">
        <div className="text-emerald-400 tracking-rack uppercase text-[10px]">Not applicable</div>
        <div className="text-cream">{showing.reason}</div>
      </div>
    );
  }

  const s = showing.summary || {};
  const verdictColor = s.filing_qualifies ? 'text-emerald-400' : 'text-red-400';
  const verdictText  = s.filing_qualifies ? 'FILING QUALIFIES under §73.215' : 'CANNOT QUALIFY under §73.215 alone';

  return (
    <>
      {/* Verdict header */}
      <div className="rounded-md border border-rule p-3 space-y-2">
        <div className={`text-[12px] tracking-rack uppercase ${verdictColor}`}>{verdictText}</div>
        <div className="text-[11px] text-textDim">
          {s.n_short_spaced} short-spaced pair{s.n_short_spaced === 1 ? '' : 's'}
          <span className="mx-2">·</span>
          <span className="text-emerald-400">{s.n_qualifying} cured by §73.215</span>
          {s.n_cannot_cure > 0 && (
            <>
              <span className="mx-2">·</span>
              <span className="text-red-400">{s.n_cannot_cure} cannot be cured</span>
            </>
          )}
        </div>
      </div>

      {/* Qualifying pairs */}
      {showing.short_spaced_pairs?.length > 0 && (
        <PairTable
          title={`Pairs cured under §73.215 (${showing.short_spaced_pairs.length})`}
          pairs={showing.short_spaced_pairs}
          tone="ok"
        />
      )}

      {/* Cannot-cure pairs */}
      {showing.cannot_cure_pairs?.length > 0 && (
        <PairTable
          title={`Pairs requiring true §73.207 waiver (${showing.cannot_cure_pairs.length})`}
          pairs={showing.cannot_cure_pairs}
          tone="bad"
        />
      )}

      {/* Boilerplate narrative + copy button */}
      <CopyableBlock
        label="Boilerplate cover narrative"
        text={showing.boilerplate_narrative}
        copied={copied === 'narrative'}
        onCopy={() => copyTo('narrative', showing.boilerplate_narrative, setCopied)}
      />

      {/* Per-pair narratives — concatenated */}
      <CopyableBlock
        label="Per-pair narrative paragraphs"
        text={(showing.short_spaced_pairs || []).map((p) => p.narrative).join('\n\n')}
        copied={copied === 'pair_narratives'}
        onCopy={() => copyTo('pair_narratives',
          (showing.short_spaced_pairs || []).map((p) => p.narrative).join('\n\n'),
          setCopied)}
      />

      {/* Certification block */}
      <CopyableBlock
        label="Certification language"
        text={showing.certification_language}
        copied={copied === 'certification'}
        onCopy={() => copyTo('certification', showing.certification_language, setCopied)}
      />

      <div className="text-[10px] text-textDim">
        Cover-letter content auto-generated from this exhibit's §73.207/§73.215 evidence.
        Engineer of record is responsible for review + signature.  Replay-deterministic:
        re-compute the exhibit with the same inputs to regenerate identical text.
      </div>
    </>
  );
}

function PairTable({ title, pairs, tone }){
  const headerColor = tone === 'ok' ? 'text-emerald-400' : 'text-red-400';
  return (
    <div className="rounded-md border border-rule p-3 space-y-2">
      <div className={`text-[10px] tracking-rack uppercase ${headerColor}`}>{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[11px]">
          <thead className="text-textDim text-[10px] tracking-rack uppercase">
            <tr>
              <th className="text-left py-1">Call</th>
              <th className="text-right">Class pair</th>
              <th className="text-right">Required (km)</th>
              <th className="text-right">Actual (km)</th>
              <th className="text-right">Deficit (km)</th>
              <th className="text-right">Fwd D/U</th>
              <th className="text-right">Rev D/U</th>
              <th className="text-center">§73.215</th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => (
              <tr key={`${p.facility_id || p.call}`} className="border-t border-rule/40">
                <td className="text-left py-0.5 text-cream">{p.call || '—'}</td>
                <td className="text-right text-textDim">{p.section_73_207?.class_pair || '—'}</td>
                <td className="text-right">{Number.isFinite(p.section_73_207?.required_km) ? p.section_73_207.required_km : '—'}</td>
                <td className="text-right">{Number.isFinite(p.section_73_207?.actual_km) ? p.section_73_207.actual_km : '—'}</td>
                <td className="text-right text-red-400">{Number.isFinite(p.section_73_207?.deficit_km) ? `-${p.section_73_207.deficit_km}` : '—'}</td>
                <td className="text-right">{fmtDb(p.section_73_215?.forward_du_db)}</td>
                <td className="text-right">{fmtDb(p.section_73_215?.reverse_du_db)}</td>
                <td className={`text-center ${p.section_73_215?.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                  {p.section_73_215?.passed === true ? 'PASS'
                    : p.section_73_215?.passed === false ? 'FAIL' : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CopyableBlock({ label, text, copied, onCopy }){
  return (
    <div className="rounded-md border border-rule p-3 space-y-2">
      <div className="flex items-center gap-2">
        <div className="text-[10px] tracking-rack uppercase text-textDim">{label}</div>
        <button
          onClick={onCopy}
          className="ml-auto text-[10px] tracking-rack uppercase border border-rule rounded px-2 py-0.5 hover:border-gold/60 hover:text-cream"
        >
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre className="whitespace-pre-wrap text-[11px] text-cream font-mono leading-relaxed">{text || '—'}</pre>
    </div>
  );
}

function fmtDb(v){
  if (!Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`;
}

function copyTo(key, text, setCopied){
  if (!text) return;
  if (typeof navigator !== 'undefined' && navigator.clipboard){
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  }
}
