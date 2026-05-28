import React from 'react';
import RackPanel from '../RackPanel.jsx';

// OptimizerInputsPanel — left rail.  Pure controlled component;
// owns no fetch logic.  Goals checkboxes that are not yet wired
// backend-side render a "(SCREENING ONLY)" hint so the operator
// is never lied to about which signals reached the ranking.
//
// Adds (Genoa AM Co-Location Engine):
//   • Search mode selector (GRID / INFRASTRUCTURE / HYBRID).
//   • Infrastructure Filters fieldset (only visible when not GRID).
//   • Grid spacing input is greyed when mode === 'INFRASTRUCTURE'.

const GOAL_KEYS = [
  { key: 'maximize_col_coverage',    label: 'Maximize COL coverage'     },
  { key: 'maximize_population',      label: 'Maximize population'       },
  { key: 'minimize_blanket_population', label: 'Minimize blanket population' },
  { key: 'prefer_high_conductivity', label: 'Prefer high conductivity'   },
  { key: 'avoid_wildfire_risk',      label: 'Avoid wildfire risk',       screening: true },
  { key: 'minimize_int_treaty_zone', label: "Minimize int'l treaty zone", screening: true }
];

const SEARCH_MODES = [
  { key: 'GRID',           label: 'Grid sweep' },
  { key: 'INFRASTRUCTURE', label: 'Existing infrastructure only' },
  { key: 'HYBRID',         label: 'Hybrid grid + infrastructure' }
];

const INFRA_TOGGLES = [
  { key: 'include_towers',   label: 'Towers'    },
  { key: 'include_asr',      label: 'ASR'       },
  { key: 'include_am_sites', label: 'AM sites'  },
  { key: 'include_fm_sites', label: 'FM sites'  },
  { key: 'include_tv_sites', label: 'TV sites'  }
];

function NumField({ label, value, onChange, step, suffix, hint, disabled }){
  return (
    <label className={['block', disabled ? 'opacity-40' : ''].join(' ')}>
      <span className="block rack-eyebrow mb-1">{label}</span>
      <span className="flex items-center gap-2">
        <input
          type="number"
          value={value ?? ''}
          step={step || 'any'}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className={[
            'bg-panelDeep border border-rule rounded-sm px-2 py-1 font-mono text-[12px] text-cream w-full focus:outline-none focus:border-gold/60',
            disabled ? 'cursor-not-allowed' : ''
          ].join(' ')}
        />
        {suffix && <span className="font-mono text-[10px] text-textDim uppercase tracking-rack">{suffix}</span>}
      </span>
      {hint && <span className="block font-mono text-[10px] text-textDim mt-1">{hint}</span>}
    </label>
  );
}

function TxtField({ label, value, onChange, placeholder, hint }){
  return (
    <label className="block">
      <span className="block rack-eyebrow mb-1">{label}</span>
      <input
        type="text"
        value={value ?? ''}
        placeholder={placeholder || ''}
        onChange={(e) => onChange(e.target.value)}
        className="bg-panelDeep border border-rule rounded-sm px-2 py-1 font-mono text-[12px] text-cream w-full focus:outline-none focus:border-gold/60"
      />
      {hint && <span className="block font-mono text-[10px] text-textDim mt-1">{hint}</span>}
    </label>
  );
}

export default function OptimizerInputsPanel({
  inputs,
  onChange,
  onRun,
  running,
  error
}){
  const setGoal = (k, v) => onChange('optimization_goals', { ...inputs.optimization_goals, [k]: v });
  const setInfra = (k, v) => onChange('infrastructure_filters', { ...inputs.infrastructure_filters, [k]: v });
  const mode = inputs.search_mode || 'HYBRID';
  const showInfra = mode !== 'GRID';
  const gridSpacingDisabled = mode === 'INFRASTRUCTURE';
  const filters = inputs.infrastructure_filters || {};
  return (
    <RackPanel
      eyebrow="Mission Inputs"
      title="Search parameters"
      italicAccent="Pin the regional radius.  The grid sweeps from here."
      tone="cyan"
    >
      <div className="grid grid-cols-1 gap-3">
        {/* Search mode selector — sits above the Callsign field so the
            operator sets the discovery strategy before anything else. */}
        <fieldset className="border border-rule rounded-sm p-3">
          <legend className="rack-eyebrow px-1">Search mode</legend>
          <div className="space-y-1.5 mt-1">
            {SEARCH_MODES.map((m) => (
              <label key={m.key} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="search_mode"
                  value={m.key}
                  checked={mode === m.key}
                  onChange={() => onChange('search_mode', m.key)}
                  className="accent-amber"
                />
                <span className="font-mono text-[11px] text-text">{m.label}</span>
                <span className="font-mono text-[9px] tracking-rack uppercase text-textDim ml-auto">{m.key}</span>
              </label>
            ))}
          </div>
          {showInfra && (
            <div className="mt-2 font-mono text-[10px] text-cyan/80 italic leading-snug">
              Co-location goal: prefer existing structures over greenfield grid points so the
              owner / ASR / structural / RF-MPE workstreams can ride existing approvals.
            </div>
          )}
        </fieldset>

        <TxtField
          label="Callsign"
          value={inputs.callsign}
          onChange={(v) => onChange('callsign', v.toUpperCase())}
          placeholder="KAZM"
        />
        <NumField
          label="Frequency"
          value={inputs.frequency_khz}
          onChange={(v) => onChange('frequency_khz', v)}
          step="10"
          suffix="kHz"
          hint="Carrier centre — AM band 530–1700 kHz."
        />
        <div className="grid grid-cols-2 gap-3">
          <NumField
            label="Current lat"
            value={inputs.current_site?.lat}
            onChange={(v) => onChange('current_site', { ...inputs.current_site, lat: v })}
            step="0.0001"
            suffix="°N"
          />
          <NumField
            label="Current lon"
            value={inputs.current_site?.lon}
            onChange={(v) => onChange('current_site', { ...inputs.current_site, lon: v })}
            step="0.0001"
            suffix="°E"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumField
            label="Search radius"
            value={inputs.search_radius_km}
            onChange={(v) => onChange('search_radius_km', v)}
            step="1"
            suffix="km"
          />
          <NumField
            label="Grid spacing"
            value={inputs.grid_spacing_km}
            onChange={(v) => onChange('grid_spacing_km', v)}
            step="0.5"
            suffix="km"
            disabled={gridSpacingDisabled}
            hint={gridSpacingDisabled ? 'n/a in infrastructure-only mode' : 'Finer = more candidates.'}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <NumField
            label="Power (TPO)"
            value={inputs.tpo_kw}
            onChange={(v) => onChange('tpo_kw', v)}
            step="0.1"
            suffix="kW"
          />
          <label className="block">
            <span className="block rack-eyebrow mb-1">Pattern mode</span>
            <select
              value={inputs.pattern_mode}
              onChange={(e) => onChange('pattern_mode', e.target.value)}
              className="bg-panelDeep border border-rule rounded-sm px-2 py-1 font-mono text-[12px] text-cream w-full focus:outline-none focus:border-gold/60"
            >
              <option value="NDA">NDA — non-directional</option>
              <option value="DA-D">DA-D — directional day</option>
              <option value="DA-N">DA-N — directional night</option>
              <option value="DA-2">DA-2 — directional day+night</option>
            </select>
          </label>
        </div>
        <label className="block">
          <span className="block rack-eyebrow mb-1">FCC class</span>
          <select
            value={inputs.fcc_class}
            onChange={(e) => onChange('fcc_class', e.target.value)}
            className="bg-panelDeep border border-rule rounded-sm px-2 py-1 font-mono text-[12px] text-cream w-full focus:outline-none focus:border-gold/60"
          >
            {['A','B','C','D'].map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <fieldset className="border border-rule rounded-sm p-3 mt-2">
          <legend className="rack-eyebrow px-1">Optimization goals</legend>
          <div className="space-y-1.5 mt-1">
            {GOAL_KEYS.map((g) => {
              const checked = !!inputs.optimization_goals?.[g.key];
              return (
                <label key={g.key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => setGoal(g.key, e.target.checked)}
                    className="accent-amber"
                  />
                  <span className="font-mono text-[11px] text-text">{g.label}</span>
                  {g.screening && (
                    <span className="font-mono text-[9px] tracking-rack uppercase text-amberDim bg-amber/10 border border-amber/30 rounded-sm px-1.5 py-0.5">
                      Screening only
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </fieldset>

        {showInfra && (
          <fieldset className="border border-rule rounded-sm p-3">
            <legend className="rack-eyebrow px-1">Infrastructure filters</legend>
            <div className="space-y-1.5 mt-1">
              {INFRA_TOGGLES.map((t) => {
                const checked = filters[t.key] !== false;
                return (
                  <label key={t.key} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => setInfra(t.key, e.target.checked)}
                      className="accent-cyan"
                    />
                    <span className="font-mono text-[11px] text-text">{t.label}</span>
                  </label>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <NumField
                label="Min tower height"
                value={filters.min_tower_height_m}
                onChange={(v) => setInfra('min_tower_height_m', v)}
                step="1"
                suffix="m"
              />
              <NumField
                label="Max tower height"
                value={filters.max_tower_height_m}
                onChange={(v) => setInfra('max_tower_height_m', v)}
                step="1"
                suffix="m"
              />
            </div>
            <div className="mt-3">
              <TxtField
                label="Owner contains"
                value={filters.owner_contains}
                onChange={(v) => setInfra('owner_contains', v)}
                placeholder="e.g. American Tower"
                hint="Case-insensitive substring match on owner / operator field."
              />
            </div>
          </fieldset>
        )}

        {error && (
          <div className="font-mono text-[11px] text-red border border-red/40 bg-red/10 rounded-sm px-3 py-2">
            {error}
          </div>
        )}

        <button
          onClick={onRun}
          disabled={running}
          className={[
            'mt-1 px-4 py-2 rounded-sm border font-mono tracking-rack uppercase text-[11px]',
            running
              ? 'border-rule text-textDim cursor-not-allowed'
              : 'border-amber/60 bg-amber/15 text-amber hover:bg-amber/25 hover:border-amber'
          ].join(' ')}
        >
          {running ? 'Searching candidates…' : 'Run regional sweep'}
        </button>
      </div>
    </RackPanel>
  );
}
