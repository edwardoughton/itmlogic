import React, { useEffect, useMemo, useState } from 'react';

// Filing Package panel (FCC Form 301-FM, Section III).
//
// Shows the cheatsheet: every LMS Section III field, what Genoa has
// filled, what the engineer of record still has to provide (tower /
// FAA / ASR), and what's out of scope (legal / ownership — sections
// I, II, IV — handled by the licensee + counsel).  Surfaces filing-
// readiness front and center: required-fields filled + no engine
// blockers + a §73.207 OR §73.215 pass.
//
// Operator interactions:
//   * Engineer info — the few manual-engineer fields (ASR, FAA
//     determination, tower height AGL, antenna make/model, painting,
//     lighting) live in localStorage so the operator types them once
//     per facility and not once per compute.
//   * Download buttons — HTML cheatsheet (printable, H&D-style),
//     JSON LMS field map, plain-text terminal-friendly version, CSV
//     for spreadsheet paste.

const STATUS_BADGE = {
  filled:    { color: '#43a85a', label: 'FILLED' },
  suggested: { color: '#5a9ec4', label: 'SUGGESTED' },
  gap:       { color: '#c4745a', label: 'NEEDS INPUT' },
  unknown:   { color: '#d6a36a', label: 'EVIDENCE MISSING' }
};

function fmtProvenance(p){
  if (!p || typeof p !== 'object') return '';
  const bits = [];
  if (p.source) bits.push(p.source);
  if (p.dataset) bits.push(p.dataset);
  if (p.vintage) bits.push(`vintage ${p.vintage}`);
  if (p.method) bits.push(p.method);
  if (p.fetched_at) bits.push(`fetched ${p.fetched_at}`);
  if (p.note) bits.push(p.note);
  return bits.join(' · ');
}

// Manual-engineer fields the operator can fill via the panel form.
// These IDs match form301fm.js.
const ENGINEER_FIELDS = [
  { id: 'antenna-make-model',         label: 'Antenna make / model',          placeholder: 'Shively 6810 (8-bay full-wave)' },
  { id: 'asr-number',                 label: 'ASR number',                    placeholder: '1234567' },
  { id: 'tower-overall-height-agl-m', label: 'Tower overall height AGL (m)',  type: 'number', placeholder: '120' },
  { id: 'rcagl-m',                    label: 'Radiation center AGL (m)',      type: 'number', placeholder: '110' },
  { id: 'erp-kw-vertical',            label: 'ERP vertical (kW)',             type: 'number', placeholder: 'leave blank if = ERP-H' },
  { id: 'faa-determination',          label: 'FAA determination',
    options: ['NO-HAZARD', 'CONDITIONED', 'NOT-REQUIRED'] },
  { id: 'tower-painting',             label: 'Tower painting / marking',      placeholder: 'AC 70/7460-1L Chapter 3' },
  { id: 'tower-lighting',             label: 'Tower lighting',                placeholder: 'A0-A1-A2 dual flashing/steady' },
  { id: 'antenna-elevation-pattern',  label: 'Elevation pattern reference',   placeholder: 'Manufacturer pattern data, ED-7842' }
];

function loadCachedEngineer(facilityId){
  try {
    const raw = localStorage.getItem(`genoa.filing_engineer.${facilityId || 'default'}`);
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}
function saveCachedEngineer(facilityId, engineer){
  try {
    localStorage.setItem(`genoa.filing_engineer.${facilityId || 'default'}`,
                         JSON.stringify(engineer || {}));
  } catch {}
}

export default function FilingPackagePanel({ exhibit }){
  const facilityId = exhibit?.station_inputs?.facility_id || '';
  const [engineer, setEngineer] = useState(() => loadCachedEngineer(facilityId));
  const [pkg, setPkg]           = useState(null);
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');
  const [downloadFormat, setDownloadFormat] = useState('html');

  // Re-cache when facility changes.
  useEffect(() => {
    setEngineer(loadCachedEngineer(facilityId));
  }, [facilityId]);

  // Recompute summary whenever exhibit or engineer changes.
  useEffect(() => {
    if (!exhibit) { setPkg(null); return; }
    let cancelled = false;
    setBusy(true);
    setError('');
    fetch('/api/exhibits/filing-package/summary', {
      method:      'POST',
      credentials: 'same-origin',
      headers:     { 'content-type': 'application/json' },
      body:        JSON.stringify({ exhibit, applicant: { engineer } })
    })
      .then(r => r.ok ? r.json() : r.json().then(j => Promise.reject(j)))
      .then(j => { if (!cancelled) setPkg(j); })
      .catch(e => { if (!cancelled) setError(e?.detail || e?.error || String(e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exhibit?.replay_digest?.exhibit_sha256, JSON.stringify(engineer)]);

  function setEngineerField(k, v){
    setEngineer(prev => {
      const next = { ...prev, [k]: v };
      saveCachedEngineer(facilityId, next);
      return next;
    });
  }

  async function downloadFile(format){
    if (!exhibit){ setError('Run a compute first.'); return; }
    setBusy(true);
    setError('');
    try {
      const r = await fetch(`/api/exhibits/filing-package/download?format=${encodeURIComponent(format)}`, {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'content-type': 'application/json' },
        body:        JSON.stringify({ exhibit, applicant: { engineer } })
      });
      if (!r.ok){
        const j = await r.json().catch(() => ({}));
        setError(j.detail || j.error || `Download failed (${r.status})`);
        return;
      }
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const cd = r.headers.get('content-disposition') || '';
      const m = cd.match(/filename="([^"]+)"/);
      a.download = m ? m[1] : `filing-package.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err){
      setError(err.message || 'Network error');
    } finally {
      setBusy(false);
    }
  }

  if (!exhibit){
    return (
      <div className="font-mono text-[12px] text-textDim italic">
        — compute an exhibit first —
      </div>
    );
  }

  const summary = pkg?.summary || { total: 0, filled: 0, suggested: 0, gaps: 0, unknown: 0, required_gaps: 0 };
  const ready   = pkg?.filing_ready === true;
  const fieldsBySection = (pkg?.fields || []).reduce((acc, f) => {
    const k = f.subsection || f.section || '—';
    (acc[k] = acc[k] || []).push(f);
    return acc;
  }, {});

  return (
    <div className="space-y-4 font-mono text-[12px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase">
        FCC Form 301-FM &middot; Section III (engineering)
      </div>

      {/* Readiness header */}
      <div className={`rounded-md border px-3 py-2 ${ready ? 'border-green/60 bg-green/10' : 'border-amber/60 bg-amber/10'}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-[11px] tracking-rack uppercase font-bold ${ready ? 'text-green' : 'text-amber'}`}>
            {ready ? 'FILING-READY' : 'NOT FILING-READY'}
          </span>
          <span className="text-textDim text-[10px]">
            ({pkg?.compliance_pass || 'compliance: unknown'} · {pkg?.blockers_count ?? '?'} blocker(s))
          </span>
        </div>
        <div className="grid grid-cols-5 gap-2 text-[11px]">
          <Stat label="Filled"    value={summary.filled} of={summary.total} accent="text-green" />
          <Stat label="Suggested" value={summary.suggested ?? 0}            accent="text-cyan" />
          <Stat label="Manual"    value={summary.gaps}                      accent="text-amber" />
          <Stat label="Evidence"  value={summary.unknown}                   accent="text-amber" />
          <Stat label="Req gaps"  value={summary.required_gaps}             accent={summary.required_gaps ? 'text-red' : 'text-green'} />
        </div>
      </div>

      {/* Engineer fields */}
      <div className="rounded-md border border-rule p-3 space-y-2">
        <div className="text-textDim text-[10px] tracking-rack uppercase">
          Engineer-of-record manual fields
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-2">
          {ENGINEER_FIELDS.map(f => (
            <EngineerInput key={f.id} field={f} value={engineer[f.id] ?? ''} onChange={v => setEngineerField(f.id, v)} />
          ))}
        </div>
        <div className="text-[10px] text-textDim">
          These persist per-facility in localStorage so you don't retype between computes.
          Sections I (applicant ID), II (legal certs), IV (ownership) are out of scope —
          handled by the licensee + FCC counsel.
        </div>
      </div>

      {/* Download bar */}
      <div className="rounded-md border border-rule p-3 space-y-2">
        <div className="text-textDim text-[10px] tracking-rack uppercase">Download cheatsheet</div>
        <div className="flex gap-2 flex-wrap">
          {[
            { fmt: 'html', label: 'HTML (printable)' },
            { fmt: 'txt',  label: 'Plain text'        },
            { fmt: 'csv',  label: 'CSV'               },
            { fmt: 'json', label: 'JSON (LMS field map)' }
          ].map(({ fmt, label }) => (
            <button
              key={fmt}
              onClick={() => downloadFile(fmt)}
              disabled={busy || !exhibit}
              className="text-[11px] tracking-rack uppercase border border-rule rounded px-3 py-1.5 hover:border-gold/60 hover:text-cream disabled:opacity-40"
            >
              {label}
            </button>
          ))}
        </div>
        <div className="text-[10px] text-textDim">
          Hand the HTML to the licensee or FCC counsel; they paste the
          values into LMS Section III as listed.  JSON is for any future
          LMS API integration.
        </div>
      </div>

      {error ? (
        <div className="text-red text-[11px] bg-red/10 border border-red/40 rounded px-3 py-2">{error}</div>
      ) : null}

      {/* Field table */}
      {Object.entries(fieldsBySection).map(([sub, fields]) => (
        <div key={sub} className="rounded-md border border-rule">
          <div className="bg-cream/5 px-3 py-1.5 text-textDim text-[10px] tracking-rack uppercase border-b border-rule">
            Section III · {sub}
          </div>
          <table className="w-full text-[11px]">
            <thead className="text-textDim text-[9px] tracking-rack uppercase">
              <tr className="border-b border-rule/50">
                <th className="text-left px-3 py-1.5">Field</th>
                <th className="text-left px-3 py-1.5">Value</th>
                <th className="text-left px-3 py-1.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {fields.map(f => (
                <FieldRow key={f.id} field={f} />
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value, of, accent }){
  return (
    <div className="border border-rule rounded px-2 py-1 bg-black/30">
      <div className="text-textDim text-[9px] tracking-rack uppercase">{label}</div>
      <div className={`text-[14px] font-mono ${accent || 'text-cream'}`}>
        {value}{of != null && <span className="text-textDim text-[10px]"> / {of}</span>}
      </div>
    </div>
  );
}

function FieldRow({ field }){
  const badge = STATUS_BADGE[field.status] || STATUS_BADGE.gap;
  let valueText;
  if (field.value == null){
    valueText = field.status === 'gap' ? 'manual entry required' :
                field.status === 'unknown' ? 'evidence missing' : '—';
  } else if (field.type === 'coords' && field.value && Number.isFinite(field.value.lat)){
    valueText = `${field.value.lat.toFixed(6)}, ${field.value.lon.toFixed(6)} (${field.value.datum || 'NAD83'})`;
  } else if (field.type === 'pattern_table' && Array.isArray(field.value)){
    valueText = `${field.value.length}-row pattern`;
  } else if (typeof field.value === 'number'){
    valueText = String(Math.round(field.value * 100) / 100) + (field.unit ? ` ${field.unit}` : '');
  } else {
    valueText = String(field.value);
  }
  const isMissingValue = field.value == null;
  const provText = fmtProvenance(field.provenance);
  return (
    <tr className="border-b border-rule/30 hover:bg-cream/5">
      <td className="px-3 py-1.5 align-top">
        <div className="text-cream">{field.lms_label}{field.required && <span className="text-red text-[9px] ml-1">REQ</span>}</div>
        <div className="text-textDim text-[9px]">{field.cite || ''}</div>
      </td>
      <td className="px-3 py-1.5 align-top">
        {isMissingValue
          ? <span className="text-textDim italic">{valueText}</span>
          : <>
              <code className="text-cream text-[11px]">{valueText}</code>
              {field.status === 'suggested' && (
                <span className="ml-1 text-cyan text-[9px] italic">— confirm before filing</span>
              )}
            </>}
        {provText && (
          <div className="text-textDim text-[9px] font-mono mt-0.5 break-words">src: {provText}</div>
        )}
      </td>
      <td className="px-3 py-1.5 align-top">
        <span style={{ background: badge.color }} className="text-[9px] tracking-wider uppercase text-white rounded px-1.5 py-0.5 font-bold whitespace-nowrap">
          {badge.label}
        </span>
      </td>
    </tr>
  );
}

function EngineerInput({ field, value, onChange }){
  if (field.options){
    return (
      <div>
        <label className="block text-textDim text-[10px] tracking-rack uppercase mb-0.5">{field.label}</label>
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          className="w-full bg-black/70 border border-rule rounded px-2 py-1 text-cream text-[11px]"
        >
          <option value="">—</option>
          {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div>
      <label className="block text-textDim text-[10px] tracking-rack uppercase mb-0.5">{field.label}</label>
      <input
        type={field.type || 'text'}
        value={value}
        onChange={e => onChange(field.type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
        placeholder={field.placeholder || ''}
        className="w-full bg-black/70 border border-rule rounded px-2 py-1 text-cream text-[11px]"
      />
    </div>
  );
}
