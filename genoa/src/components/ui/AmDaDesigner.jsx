import React, { useEffect, useMemo, useState } from 'react';
import PolarPattern from './PolarPattern.jsx';
import AmNightNifPreview   from './AmNightNifPreview.jsx';
import AmSunAuthorityPanel from './AmSunAuthorityPanel.jsx';
import AmPsraPssaPanel     from './AmPsraPssaPanel.jsx';
import AmPhysicsEvidencePanel from './AmPhysicsEvidencePanel.jsx';
import TabStrip            from './TabStrip.jsx';
import { describeAmKhz, normalizeAmKhz } from '../../engine/am/band.js';

// AM rack panel — single workbench tab housing four engineer-grade
// sub-tools, each on its own internal sub-tab so the operator gets
// one tool at a time instead of a long stacked scroll:
//
//   PATTERN          — §73.150 directional array synthesis
//   NIGHT NIF        — §73.182 nighttime interference-free contour
//   SUN & WINDOWS    — §73.99 / §73.1209 sunrise/sunset + PSRA/PSSA windows
//   REDUCED POWER    — §73.99(b)(1)/(2) PSRA/PSSA reduced-power exhibit
//
// VISIBILITY
//   AM only.  For FM / LPFM / FX / TV the entire panel collapses to
//   a single "applies to AM stations only" line — no carrier auto-
//   convert from 90.5 MHz → 91 kHz (the prior behavior, which made
//   the designer compute nonsense for FM facilities).

const STARTER = {
  frequency_khz: 1000,
  towers: [
    { id: 'T1', distance_m: 0,  bearing_deg: 0, current_ratio: 1.0, phase_deg:   0, electrical_height_deg: 90 },
    { id: 'T2', distance_m: 75, bearing_deg: 0, current_ratio: 1.0, phase_deg: -90, electrical_height_deg: 90 }
  ]
};

const SUB_TABS = [
  { id: 'pattern',  label: 'Pattern · §73.150' },
  { id: 'nif',      label: 'Night NIF · §73.182' },
  { id: 'sun',      label: 'Sun & windows · §73.99/1209' },
  { id: 'power',    label: 'Reduced power · §73.99(b)' },
  { id: 'physics',  label: 'Physics · SOMNEC2D (advisory)' }
];

export default function AmDaDesigner({ baseInputs, onApplyPattern }){
  const isAm = String(baseInputs?.service || '').toUpperCase() === 'AM';
  const [sub, setSub] = useState('pattern');

  if (!isAm){
    return (
      <div className="space-y-2 font-mono text-[12px]">
        <div className="text-textDim text-[10px] tracking-rack uppercase">AM designer</div>
        <div className="rounded-md border border-rule p-3 text-[11px] text-textDim">
          The AM designer applies to AM stations (service = AM).&nbsp;
          The currently-loaded facility is <span className="text-cream">{baseInputs?.service || 'unset'}</span>; load an AM station to design a §73.150 array, run the §73.182 NIF, view §73.99 windows, or compute §73.99(b) reduced power.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 font-mono text-[12px]">
      <div className="flex items-center gap-3">
        <div className="text-textDim text-[10px] tracking-rack uppercase">
          AM designer — {baseInputs?.call || 'no call'} · {baseInputs?.facility_id || '—'}
        </div>
      </div>
      <TabStrip tabs={SUB_TABS} activeId={sub} onChange={setSub} />
      <div className="pt-2">
        {sub === 'pattern' && (
          <PatternDesigner baseInputs={baseInputs} onApplyPattern={onApplyPattern} />
        )}
        {sub === 'nif' && (
          <AmNightNifPreview
            lat={baseInputs?.lat}
            lon={baseInputs?.lon}
            freq_khz={amFreqKhzFromBase(baseInputs)}
            erp_kw={baseInputs?.erp_kw}
            fcc_class={baseInputs?.fcc_class}
            pattern_mode={Array.isArray(baseInputs?.pattern) ? 'DA' : 'omni'}
            pattern_table={Array.isArray(baseInputs?.pattern)
                            ? Object.fromEntries(baseInputs.pattern)
                            : null}
          />
        )}
        {sub === 'sun'   && <AmSunAuthorityPanel baseInputs={baseInputs} />}
        {sub === 'power' && <AmPsraPssaPanel     baseInputs={baseInputs} />}
        {sub === 'physics' && <AmPhysicsEvidencePanel baseInputs={baseInputs} />}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// PATTERN DESIGNER — §73.150 ground-wave synthesis
// (Extracted from the prior top-level component so the AM designer
// can render it as one of N sub-tabs without forcing the operator
// past it to reach NIF / Sun / PSRA-PSSA.)
// ────────────────────────────────────────────────────────────────────

function PatternDesigner({ baseInputs, onApplyPattern }){
  const [spec, setSpec]       = useState(() => deriveStarter(baseInputs));
  const [pattern, setPattern] = useState(null);
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState('');
  const [nullTarget, setNullTarget] = useState(270);
  const [appliedAt, setAppliedAt]   = useState(null);

  const carrierCheck = useMemo(
    () => describeAmKhz(spec.frequency_khz),
    [spec.frequency_khz]
  );

  useEffect(() => {
    const id = setTimeout(() => synthesize(spec), 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(spec)]);

  async function synthesize(s){
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/am-da/design', {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'content-type': 'application/json' },
        body:        JSON.stringify(s)
      });
      if (!r.ok){
        const j = await r.json().catch(() => ({}));
        setError(j.detail || j.error || `Design failed (${r.status})`);
        setPattern(null);
        return;
      }
      const j = await r.json();
      setPattern(j);
    } catch (err){
      setError(err.message || 'Network error');
    } finally {
      setBusy(false);
    }
  }

  async function placeNull(){
    setBusy(true);
    setError('');
    try {
      const r = await fetch('/api/am-da/null', {
        method:      'POST',
        credentials: 'same-origin',
        headers:     { 'content-type': 'application/json' },
        body:        JSON.stringify({ spec, target_az_deg: nullTarget, tower_index: 1 })
      });
      if (!r.ok){
        const j = await r.json().catch(() => ({}));
        setError(j.detail || j.error || `Null search failed (${r.status})`);
        return;
      }
      const j = await r.json();
      setSpec({ ...spec, towers: j.nudge.adjusted_towers });
      setPattern(j);
    } catch (err){
      setError(err.message || 'Network error');
    } finally {
      setBusy(false);
    }
  }

  function setTower(i, field, val){
    setSpec(s => ({
      ...s,
      towers: s.towers.map((t, j) => j === i ? { ...t, [field]: val } : t)
    }));
  }
  function addTower(){
    if (spec.towers.length >= 12) return;
    setSpec(s => ({
      ...s,
      towers: [...s.towers, {
        id: `T${s.towers.length + 1}`,
        distance_m: 75 * s.towers.length,
        bearing_deg: 0,
        current_ratio: 1.0,
        phase_deg: 0,
        electrical_height_deg: 90
      }]
    }));
  }
  function removeTower(i){
    if (spec.towers.length <= 1) return;
    setSpec(s => ({ ...s, towers: s.towers.filter((_, j) => j !== i) }));
  }

  function apply(){
    if (!pattern?.pattern_table){ setError('No pattern to apply yet.'); return; }
    onApplyPattern?.(pattern.pattern_table);
    setAppliedAt(new Date().toISOString().slice(11, 19) + 'Z');
  }

  const f0   = pattern?.pattern_table?.[0]?.[1];
  const f180 = pattern?.pattern_table?.[180]?.[1];

  return (
    <div className="space-y-4">
      <div className="text-textDim text-[10px] tracking-rack uppercase">
        AM directional array — §73.150 ground-wave synthesis
      </div>

      <div className="rounded-md border border-rule p-3 space-y-3">
        <div className="flex items-center gap-3">
          <label className="text-textDim text-[10px] tracking-rack uppercase">Carrier (kHz)</label>
          <input
            type="number"
            value={spec.frequency_khz}
            onChange={(e) => setSpec({ ...spec, frequency_khz: Number(e.target.value) || 0 })}
            onBlur={(e) => {
              const snapped = normalizeAmKhz(e.target.value);
              if (snapped !== null && snapped !== spec.frequency_khz){
                setSpec({ ...spec, frequency_khz: snapped });
              }
            }}
            min="540" max="1700" step="10"
            className={`w-24 bg-black/70 border rounded px-2 py-1 text-cream text-[12px] ${
              carrierCheck.valid ? 'border-rule' : 'border-red-500'
            }`}
            aria-invalid={!carrierCheck.valid}
          />
          <span className="text-textDim text-[10px]">
            λ ≈ {pattern?.wavelength_m?.toFixed?.(1) || '—'} m
          </span>
          {carrierCheck.message && (
            <span className={`text-[10px] ${
              carrierCheck.valid ? 'text-textDim' : 'text-red-400'
            }`}>
              {carrierCheck.message}
            </span>
          )}
          <button
            onClick={addTower}
            disabled={spec.towers.length >= 12}
            className="ml-auto text-[10px] tracking-rack uppercase border border-rule rounded px-2 py-1 hover:border-gold/60 hover:text-cream disabled:opacity-40"
          >
            + Add tower
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-textDim text-[10px] tracking-rack uppercase">
              <tr>
                <th className="text-left py-1">ID</th>
                <th className="text-right">Dist (m)</th>
                <th className="text-right">Brg (°)</th>
                <th className="text-right">I-ratio</th>
                <th className="text-right">Φ (°)</th>
                <th className="text-right">Elec H (°)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {spec.towers.map((t, i) => (
                <tr key={i} className="border-t border-rule/50">
                  <td className="py-1">
                    <input
                      type="text"
                      value={t.id || `T${i + 1}`}
                      onChange={(e) => setTower(i, 'id', e.target.value)}
                      className="w-12 bg-black/70 border border-rule rounded px-1.5 py-0.5 text-cream"
                    />
                  </td>
                  <td><NumCell value={t.distance_m} onChange={(v) => setTower(i, 'distance_m', v)} step="1" /></td>
                  <td><NumCell value={t.bearing_deg} onChange={(v) => setTower(i, 'bearing_deg', v)} step="1" /></td>
                  <td><NumCell value={t.current_ratio} onChange={(v) => setTower(i, 'current_ratio', v)} step="0.05" /></td>
                  <td><NumCell value={t.phase_deg} onChange={(v) => setTower(i, 'phase_deg', v)} step="1" /></td>
                  <td><NumCell value={t.electrical_height_deg} onChange={(v) => setTower(i, 'electrical_height_deg', v)} step="1" /></td>
                  <td className="pl-1">
                    <button
                      onClick={() => removeTower(i)}
                      disabled={spec.towers.length <= 1}
                      title="Remove tower"
                      className="text-textDim hover:text-red disabled:opacity-30"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {error ? (
        <div className="text-red text-[11px] bg-red/10 border border-red/40 rounded px-3 py-2">{error}</div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 items-start">
        <div className="rounded-md border border-rule p-3">
          <PolarPattern
            pattern={pattern?.pattern_table || []}
            highlightAz={Number.isFinite(nullTarget) ? nullTarget : null}
            size={360}
            label={pattern ? `${pattern.method || ''}  ·  λ=${pattern.wavelength_m?.toFixed(1)}m  ·  N=${pattern.n_towers}` : ''}
          />
        </div>

        <div className="rounded-md border border-rule p-3 space-y-2 min-w-[220px]">
          <div className="text-textDim text-[10px] tracking-rack uppercase">Pattern summary</div>
          <Kv k="Max field"     v={pattern ? `f=1.000 @ ${pattern.max_az_deg}°` : '—'} />
          <Kv k="Min field"     v={pattern ? `f=${(pattern.min_field / Math.max(1e-12, pattern.max_field)).toFixed(4)} @ ${pattern.min_az_deg}°` : '—'} />
          <Kv k="Mean f"        v={pattern?.mean_factor ?? '—'} />
          <Kv k="Nulls (≤0.10)" v={pattern?.null_directions_deg?.join(', ') || '—'} />
          <Kv k="f(0°)"         v={Number.isFinite(f0) ? f0.toFixed(4) : '—'} />
          <Kv k="f(180°)"       v={Number.isFinite(f180) ? f180.toFixed(4) : '—'} />

          <div className="border-t border-rule pt-2 mt-2 space-y-2">
            <div className="text-textDim text-[10px] tracking-rack uppercase">Place null at azimuth</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={nullTarget}
                onChange={(e) => setNullTarget(Number(e.target.value) || 0)}
                min="0" max="359" step="1"
                className="w-20 bg-black/70 border border-rule rounded px-2 py-1 text-cream text-[12px]"
              />
              <button
                onClick={placeNull}
                disabled={busy || spec.towers.length < 2}
                className="text-[10px] tracking-rack uppercase border border-cyan/40 rounded px-2 py-1 hover:border-cyan/80 hover:text-cyan disabled:opacity-40"
              >
                {busy ? '…' : 'Nudge'}
              </button>
            </div>
            {pattern?.nudge ? (
              <div className="text-[10px] text-cyan">
                Last nudge: tower #{pattern.nudge.adjusted_tower_index + 1} → φ={pattern.nudge.adjusted_towers[pattern.nudge.adjusted_tower_index].phase_deg}°,
                null depth {pattern.nudge.achieved_null_db.toFixed(1)} dB
              </div>
            ) : null}
          </div>

          <div className="border-t border-rule pt-3 mt-2 space-y-1">
            <button
              onClick={apply}
              disabled={!pattern}
              className="w-full text-[11px] tracking-rack uppercase bg-gradient-to-b from-gold/30 to-gold/10 hover:from-gold/40 hover:to-gold/20 border border-gold/50 rounded py-2 disabled:opacity-40"
            >
              Apply to facility
            </button>
            {appliedAt ? (
              <div className="text-[10px] text-gold">Applied at {appliedAt} — re-compute to use new pattern.</div>
            ) : (
              <div className="text-[10px] text-textDim">
                Pushes the pattern table to inputs.pattern_table and switches pattern_mode→DA.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NumCell({ value, onChange, step }){
  return (
    <input
      type="number"
      value={value}
      step={step}
      onChange={(e) => onChange(Number(e.target.value) || 0)}
      className="w-20 bg-black/70 border border-rule rounded px-1.5 py-0.5 text-right text-cream text-[11px]"
    />
  );
}
function Kv({ k, v }){
  return (
    <div className="grid grid-cols-[110px_1fr] gap-x-2 text-[11px]">
      <span className="text-textDim text-[10px] tracking-rack uppercase">{k}</span>
      <span className="text-cream text-right">{v}</span>
    </div>
  );
}

// Derive a sensible AM-band starter carrier from baseInputs.  Only
// converts when the source frequency is plausibly AM — if the loaded
// facility is on 90.5 MHz the right answer is "fall back to 1000 kHz"
// not "Math.round(90.5) = 91 kHz" (which the prior code did, then
// flagged red as out-of-band on every FM facility).
function deriveStarter(baseInputs){
  const f = Number(baseInputs?.frequency);
  let frequency_khz = STARTER.frequency_khz;
  if (Number.isFinite(f) && f > 0){
    // AM values arrive as kHz (e.g. 1240) or as small MHz (e.g. 1.24).
    if (f >= 535 && f <= 1705){
      frequency_khz = Math.round(f);
    } else if (f >= 0.5 && f < 30){
      frequency_khz = Math.round(f * 1000);
      if (frequency_khz < 535 || frequency_khz > 1705){
        frequency_khz = STARTER.frequency_khz;
      }
    }
    // else: out-of-band (FM 88-108 MHz, TV, etc.) → keep STARTER 1000.
  }
  return { ...STARTER, frequency_khz, towers: STARTER.towers.map(t => ({ ...t })) };
}

// Helper for the NIF preview sub-tab — same shape as PatternDesigner's
// deriveStarter but returns kHz or null (NIF preview accepts null and
// shows "needs frequency" when not AM-band).
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
