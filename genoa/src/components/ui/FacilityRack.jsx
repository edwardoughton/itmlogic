import React from 'react';
import RackPanel      from './RackPanel.jsx';
import HardwareButton from './HardwareButton.jsx';

// FacilityRack — the studio input strip.  Controlled component: every
// field reads from `inputs` and writes via `onChange(field, value)`.
// The buttons fire callbacks; this component holds no business logic.

const SERVICES = [
  { v: 'FM',   label: 'FM full-service' },
  { v: 'LPFM', label: 'LPFM (§73.811)'  },
  { v: 'FX',   label: 'FM translator (§74.1204)' },
  { v: 'AM',   label: 'AM (§73.183 groundwave)' }
];
const FCC_CLASSES = ['A','B1','B','C3','C2','C1','C0','C','L1'];
const RADIAL_STEPS = [
  { v: 45,    label: '45°' },
  { v: 22.5,  label: '22.5°' },
  { v: 10,    label: '10°' },
  { v: 1,     label: '1° (full exhibit)' }
];

export default function FacilityRack({
  inputs = {},
  onChange,
  onCompute, onReset, onLookupFid, onSave, onExport,
  onLoadKslx, onLoadSynthetic,
  facilitySource,
  // Station search (call sign, partial, or facility ID against
  // /api/facilities/search).  Debounced in App.jsx; this component
  // only renders the textbox + results list.
  stationQuery        = '',
  stationResults      = [],
  stationSearching    = false,
  stationSearched     = false,
  stationError        = '',
  onStationQueryChange,
  onStationPick,
  computing = false,
  busy = false
}) {
  const set = (k, v) => onChange && onChange(k, v);
  return (
    <RackPanel
      eyebrow="Console / 01"
      title="Facility"
      italicAccent="Station identity & FCC fields"
      tone="amber"
    >
      <div className="rack-eyebrow mb-1">Station search</div>
      <input
        className="rack-input"
        value={stationQuery}
        onChange={e => onStationQueryChange && onStationQueryChange(e.target.value)}
        placeholder="Call sign, partial (e.g. KSLX), or facility ID"
        autoComplete="off"
      />
      {stationSearching && (
        <div className="mt-1 font-mono text-[11px] text-textDim">Searching…</div>
      )}
      {stationError && !stationSearching && (
        <div className="mt-1 font-mono text-[11px] text-rose-300">{stationError}</div>
      )}
      {stationSearched && stationResults.length === 0 && !stationSearching && !stationError && stationQuery.trim().length >= 2 && (
        <div className="mt-1 font-mono text-[11px] text-textDim">
          No matches in catalog for "<span className="text-text">{stationQuery}</span>".
          Try a different spelling or partial match — the FCC catalog
          uses current call signs (e.g. KDKB → KMVP-FM).
          You can still enter a Facility ID below and click Lookup.
        </div>
      )}
      {stationResults.length > 0 && (
        <ul className="mt-2 max-h-48 overflow-y-auto border border-text/10 rounded-sm bg-black/30">
          {stationResults.map((row, i) => (
            <li key={`${row.facility_id || 'x'}-${i}`}>
              <button
                type="button"
                className="w-full text-left px-2 py-1 font-mono text-[11px] hover:bg-text/10"
                onClick={() => onStationPick && onStationPick(row)}
                disabled={busy || computing}
              >
                <span className="text-text">{row.call || '—'}</span>
                <span className="text-textDim">
                  {' · '}{row.service || '?'}
                  {row.frequency ? ` · ${row.frequency} ${row.frequency_unit || ''}` : ''}
                  {row.facility_id ? ` · #${row.facility_id}` : ''}
                  {row.city || row.state ? ` · ${[row.city, row.state].filter(Boolean).join(', ')}` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="font-mono text-[10px] text-textDim mt-1 leading-snug">
        Pick a station to fill the form and run an exhibit. Backed by{' '}
        <code className="text-text/80">/api/facilities/search</code> — same
        upstream as the Lookup button, just multi-result interactive.
      </p>

      <div className="my-3 border-t border-text/10" />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="rack-label">Service</label>
          <select className="rack-input" value={inputs.service || 'FM'} onChange={e => set('service', e.target.value)}>
            {SERVICES.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="rack-label">FCC class</label>
          <select className="rack-input" value={inputs.fcc_class || 'A'} onChange={e => set('fcc_class', e.target.value)}>
            {FCC_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label className="rack-label">Call sign</label>
          <input className="rack-input" value={inputs.call || ''} onChange={e => set('call', e.target.value)} placeholder="WXYZ-FM" />
        </div>
        <div>
          <label className="rack-label">Facility ID</label>
          <div className="flex gap-2">
            <input className="rack-input" value={inputs.facility_id || ''} onChange={e => set('facility_id', e.target.value)} placeholder="e.g. 11282" />
            <HardwareButton variant="cyan" onClick={onLookupFid} disabled={busy} title="Resolve from chelstein/zerotrustradio (read-only FCC source)">
              Lookup
            </HardwareButton>
          </div>
        </div>
      </div>

      {facilitySource && (
        <div className="mt-2 font-mono text-[11px] text-textDim">{facilitySource}</div>
      )}

      <div className="grid grid-cols-3 gap-2 mt-3">
        <div>
          <label className="rack-label">Frequency</label>
          <input className="rack-input" value={inputs.frequency ?? ''} onChange={e => set('frequency', e.target.value)} placeholder="MHz / kHz" />
        </div>
        <div>
          <label className="rack-label">ERP (kW)</label>
          <input className="rack-input" value={inputs.erp_kw ?? ''} onChange={e => set('erp_kw', e.target.value)} placeholder="e.g. 100" />
        </div>
        <div>
          <label className="rack-label">HAAT (m)</label>
          <input className="rack-input" value={inputs.haat_m ?? ''} onChange={e => set('haat_m', e.target.value)} placeholder="e.g. 561" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 mt-3">
        <div>
          <label className="rack-label">Latitude (°N)</label>
          <input className="rack-input" value={inputs.lat ?? ''} onChange={e => set('lat', e.target.value)} placeholder="33.30" />
        </div>
        <div>
          <label className="rack-label">Longitude (°W neg.)</label>
          <input className="rack-input" value={inputs.lon ?? ''} onChange={e => set('lon', e.target.value)} placeholder="-112.0" />
        </div>
        {String(inputs.service || '').toUpperCase() === 'AM' && (
        <div>
          <label className="rack-label">AM σ (mS/m)</label>
          <input className="rack-input" value={inputs.ground_sigma_mS_m ?? ''} onChange={e => set('ground_sigma_mS_m', e.target.value)} placeholder="e.g. 8" />
        </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3">
        <div>
          <label className="rack-label">Pattern</label>
          <select className="rack-input" value={inputs.pattern_mode || 'ND'} onChange={e => set('pattern_mode', e.target.value)}>
            <option value="ND">Non-directional</option>
            <option value="DA">Directional (paste table)</option>
          </select>
        </div>
        <div>
          <label className="rack-label">Radial step</label>
          <select className="rack-input" value={inputs.radial_step_deg || 10} onChange={e => set('radial_step_deg', Number(e.target.value))}>
            {RADIAL_STEPS.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {inputs.pattern_mode === 'DA' && (
        <div className="mt-3">
          <label className="rack-label">Pattern table (azimuth, relative field)</label>
          <textarea
            className="rack-input"
            rows={4}
            value={inputs.pattern_table || ''}
            onChange={e => set('pattern_table', e.target.value)}
            placeholder={'0,1.00\n90,0.85\n180,0.40\n270,0.85'}
          />
        </div>
      )}

      <div className="rack-eyebrow mt-4 mb-1">Demo presets</div>
      <div className="flex flex-wrap gap-2">
        <HardwareButton variant="ghost" onClick={onLoadKslx}      disabled={busy}>Load KSLX-FM</HardwareButton>
        <HardwareButton variant="ghost" onClick={onLoadSynthetic} disabled={busy}>Reset synthetic Class A</HardwareButton>
      </div>

      <div className="rack-eyebrow mt-4 mb-1">Evidence</div>
      <label className="flex items-center gap-2 font-mono text-[11px] text-text">
        <input
          type="checkbox"
          checked={!!inputs.use_terrain}
          onChange={e => set('use_terrain', e.target.checked)}
        />
        <span>Request per-radial §73.313 HAAT (terrain) from ZTR</span>
      </label>
      <p className="font-mono text-[10px] text-textDim mt-1 leading-snug">
        Calls ZTR's terrain-haat endpoint (OpenTopoData SRTM30m). Slow (~30s) on cold cache. Clears the CONSTANT_HAAT_ASSUMED warning when valid radials are returned.
      </p>

      <label className="flex items-center gap-2 font-mono text-[11px] text-text mt-3">
        <input
          type="checkbox"
          checked={!!inputs.use_itm}
          onChange={e => set('use_itm', e.target.checked)}
        />
        <span>Compute terrain-aware ITM coverage (SPLAT / Bullington-P.526)</span>
      </label>
      <p className="font-mono text-[10px] text-textDim mt-1 leading-snug">
        Runs Longley-Rice ITM v1.2.2 against the SPLAT sidecar (high-fidelity) or the in-process JS Bullington + ITU-R P.526 fallback. Slow (~30-90s for 36 radials × 40 samples). Populates evidence.itm_coverage + the ITM Coverage section in the engineering statement.
      </p>

      <div className="rack-eyebrow mt-4 mb-1">Operate</div>
      <div className="flex flex-wrap gap-2">
        <HardwareButton variant="primary" onClick={onCompute} disabled={busy || computing}>
          {computing ? 'Computing…' : 'Compute exhibit'}
        </HardwareButton>
        <HardwareButton variant="secondary" onClick={onSave}                disabled={busy}>Save</HardwareButton>
        <HardwareButton variant="secondary" onClick={() => onExport('json')}    disabled={busy}>JSON</HardwareButton>
        <HardwareButton variant="secondary" onClick={() => onExport('txt')}     disabled={busy}>TXT</HardwareButton>
        <HardwareButton variant="secondary" onClick={() => onExport('geojson')} disabled={busy}>GeoJSON</HardwareButton>
        <HardwareButton variant="secondary" onClick={() => onExport('engineering-txt')} disabled={busy}>Engineering Statement TXT</HardwareButton>
        <HardwareButton variant="secondary" onClick={() => onExport('engineering-pdf')} disabled={busy}>Engineering Statement PDF</HardwareButton>
        <HardwareButton variant="ghost"     onClick={onReset}              disabled={busy}>Reset</HardwareButton>
      </div>
    </RackPanel>
  );
}
