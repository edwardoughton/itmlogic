import React, { useEffect, useState } from 'react';

// Modal dialog for stamping the current exhibit with a Professional
// Engineer seal.  Hits POST /api/exhibits/certify; on success, hands
// the sealed exhibit back to the caller via onSealed(sealedExhibit).
//
// Required fields: name, license_no, license_state.
// Optional: license_expiration, firm, title, statement (defaults to
// the NSPE-style language baked into the backend).

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA',
  'RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC','PR','VI','GU'
];

export default function PeCertifyDialog({ exhibit, onClose, onSealed }){
  const [eng, setEng] = useState(() => loadCachedEngineer());
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function onKey(e){ if (e.key === 'Escape') onClose?.(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function set(k, v){ setEng(prev => ({ ...prev, [k]: v })); }

  async function submit(e){
    e?.preventDefault();
    if (!eng.name || !eng.license_no || !eng.license_state){
      setError('Name, license #, and state are required.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/exhibits/certify', {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'content-type': 'application/json' },
        body:        JSON.stringify({ exhibit, engineer: eng })
      });
      if (!r.ok){
        const j = await r.json().catch(() => ({}));
        setError(j.detail || j.error || `Certify failed (${r.status})`);
        return;
      }
      const j = await r.json();
      saveCachedEngineer({
        name:               eng.name,
        license_no:         eng.license_no,
        license_state:      eng.license_state,
        license_expiration: eng.license_expiration,
        firm:               eng.firm,
        title:              eng.title
      });
      onSealed?.(j.exhibit);
      onClose?.();
    } catch (err){
      setError(err.message || 'Network error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-[560px] max-w-[94vw] max-h-[92vh] overflow-y-auto rounded-xl border border-rule bg-black/85 shadow-[0_30px_80px_rgba(0,0,0,0.6)] font-mono"
      >
        <div className="px-6 pt-6 pb-3 border-b border-rule">
          <div className="text-cream text-[15px] tracking-rack uppercase">
            Professional Engineer Seal
          </div>
          <div className="text-textDim text-[10px] tracking-rack uppercase mt-1">
            §73.x exhibit certification — signs the canonical SHA-256 of the exhibit body
          </div>
        </div>

        <div className="px-6 py-5 space-y-4 text-[12px]">
          <Row>
            <Field label="Engineer Name *" value={eng.name} onChange={(v) => set('name', v)} autoFocus />
          </Row>
          <Row>
            <Field label="License No. *" value={eng.license_no} onChange={(v) => set('license_no', v)} />
            <Select
              label="State *"
              value={eng.license_state}
              onChange={(v) => set('license_state', v)}
              options={['', ...US_STATES]}
            />
          </Row>
          <Row>
            <Field
              label="License Expiration (YYYY-MM-DD)"
              value={eng.license_expiration}
              onChange={(v) => set('license_expiration', v)}
              placeholder="2027-12-31"
            />
            <Field label="Title" value={eng.title} onChange={(v) => set('title', v)} placeholder="Professional Engineer" />
          </Row>
          <Row>
            <Field label="Firm" value={eng.firm} onChange={(v) => set('firm', v)} placeholder="Acme Engineering, LLC" />
          </Row>
          <div>
            <label className="block text-textDim text-[10px] tracking-rack uppercase mb-1">
              Certification Statement (optional — leave blank for NSPE default)
            </label>
            <textarea
              rows={4}
              value={eng.statement || ''}
              onChange={(e) => set('statement', e.target.value)}
              placeholder="Leave blank to use the default NSPE-style language."
              className="w-full bg-black/70 border border-rule rounded px-3 py-2 text-cream text-[12px] focus:outline-none focus:border-gold/60"
            />
          </div>

          {error ? (
            <div className="text-red text-[11px] bg-red/10 border border-red/40 rounded px-3 py-2">
              {error}
            </div>
          ) : null}

          <div className="text-textDim text-[10px] leading-relaxed border-t border-rule pt-3">
            Stamping this exhibit attaches a SHA-256 hash of the canonical exhibit
            JSON (excluding <code className="text-cream">pe_certification</code>,
            <code className="text-cream"> exports</code>, <code className="text-cream">history</code>,
            and <code className="text-cream"> id</code>).  Re-running the same
            inputs through the engine will reproduce the same hash; mutating the
            sealed body afterwards will fail
            <code className="text-cream"> POST /api/exhibits/verify-cert</code>.
          </div>
        </div>

        <div className="px-6 py-4 border-t border-rule flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-rule rounded text-textDim hover:text-cream text-[11px] tracking-rack uppercase"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !eng.name || !eng.license_no || !eng.license_state}
            className="px-5 py-2 bg-gradient-to-b from-gold/30 to-gold/10 hover:from-gold/40 hover:to-gold/20 border border-gold/50 rounded text-cream text-[11px] tracking-rack uppercase disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {busy ? 'Stamping…' : 'Stamp Exhibit'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Row({ children }){
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}

function Field({ label, value, onChange, placeholder, autoFocus }){
  return (
    <div className="col-span-2 sm:col-span-1">
      <label className="block text-textDim text-[10px] tracking-rack uppercase mb-1">{label}</label>
      <input
        type="text"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="w-full bg-black/70 border border-rule rounded px-3 py-2 text-cream text-[13px] focus:outline-none focus:border-gold/60"
      />
    </div>
  );
}

function Select({ label, value, onChange, options }){
  return (
    <div className="col-span-2 sm:col-span-1">
      <label className="block text-textDim text-[10px] tracking-rack uppercase mb-1">{label}</label>
      <select
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-black/70 border border-rule rounded px-3 py-2 text-cream text-[13px] focus:outline-none focus:border-gold/60"
      >
        {options.map(opt => <option key={opt} value={opt}>{opt || '—'}</option>)}
      </select>
    </div>
  );
}

function loadCachedEngineer(){
  try {
    const raw = localStorage.getItem('genoa.pe_engineer');
    if (!raw) return defaultEngineer();
    const j = JSON.parse(raw);
    return { ...defaultEngineer(), ...j };
  } catch { return defaultEngineer(); }
}
function saveCachedEngineer(eng){
  try { localStorage.setItem('genoa.pe_engineer', JSON.stringify(eng || {})); } catch {}
}
function defaultEngineer(){
  return {
    name:               '',
    license_no:         '',
    license_state:      '',
    license_expiration: '',
    title:              'Professional Engineer',
    firm:               '',
    statement:          ''
  };
}
