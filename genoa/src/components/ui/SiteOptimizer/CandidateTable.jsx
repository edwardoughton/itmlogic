import React, { useMemo, useState } from 'react';
import RackPanel from '../RackPanel.jsx';
import StatusChip from './StatusChip.jsx';
import { primaryStatus, rankColor } from './statusUtil.js';

// CandidateTable — sortable ranked-candidates ledger.  Click a column
// header to sort; click a row to open the detail drawer.  Renders a
// muted "no candidates yet" message before the first search.
//
// Adds (Genoa AM Co-Location Engine):
//   • Source column — GRID / INFRA chip (so the operator knows whether
//     this row comes from greenfield grid scanning or an existing site).
//   • Host column — host_kind + truncated host_owner from
//     colocation_analysis.
//   • Status column — uses StatusChip with the enum status_category if
//     present, otherwise falls back to legacy free-text labels.

const COLUMNS = [
  { key: 'rank',                       label: '#',                  align: 'right' },
  { key: 'score',                      label: 'Score',              align: 'right' },
  { key: '_source',                    label: 'Source',             align: 'left',  unsortable: true },
  { key: '_host',                      label: 'Host',               align: 'left',  unsortable: true },
  { key: 'distance_from_current_km',   label: 'Dist',               align: 'right' },
  { key: 'col_coverage_pct',           label: 'COL %',              align: 'right' },
  { key: 'nif_status',                 label: 'NIF',                align: 'left'  },
  { key: 'daytime_reach_km',           label: 'Day reach',          align: 'right' },
  { key: 'fuel_risk',                  label: 'Fuel risk',          align: 'left'  },
  { key: '_status',                    label: 'Status',             align: 'left',  unsortable: true },
  { key: 'notes',                      label: 'Notes',              align: 'left',  unsortable: true }
];

function cellValue(c, key){
  if (key === '_status') return c.status_category || primaryStatus(c.status_labels);
  if (key === 'col_coverage_pct') return Number(c.col_coverage_pct) || 0;
  return c[key];
}

function fmt(key, v){
  if (v == null) return '—';
  if (key === 'rank')   return String(v);
  if (key === 'score')  return Number(v).toFixed(1);
  if (key === 'distance_from_current_km') return `${Number(v).toFixed(1)} km`;
  if (key === 'col_coverage_pct')         return `${(Number(v) * 100).toFixed(0)}%`;
  if (key === 'daytime_reach_km')         return `${Number(v).toFixed(1)} km`;
  if (key === 'notes') return String(v);
  return String(v);
}

function SourceChip({ source }){
  const isInfra = source === 'INFRASTRUCTURE';
  const fg     = isInfra ? '#6fd3ff' : '#d6a36a';
  const bg     = isInfra ? 'rgba(111,211,255,0.10)' : 'rgba(214,163,106,0.10)';
  const border = isInfra ? 'rgba(111,211,255,0.45)' : 'rgba(214,163,106,0.45)';
  const text   = isInfra ? 'INFRA' : (source ? 'GRID' : '—');
  return (
    <span
      className="inline-flex items-center font-mono tracking-rack uppercase border rounded-sm px-1.5 py-0.5 text-[9px]"
      style={{ color: fg, background: bg, borderColor: border }}
      title={source || 'GRID'}
    >
      {text}
    </span>
  );
}

function HostCell({ candidate }){
  const a = candidate?.colocation_analysis;
  if (!a) return <span className="text-textDim">—</span>;
  const kind = (a.host_kind || '').replace(/_/g, ' ');
  const owner = (a.host_owner || '').toString();
  const ownerShort = owner.length > 22 ? owner.slice(0, 21) + '…' : owner;
  return (
    <span className="text-cream" title={`${a.host_kind || '—'} · ${owner || '—'}`}>
      <span className="text-textDim">{kind || '—'}</span>
      {ownerShort && <span className="ml-1">· {ownerShort}</span>}
    </span>
  );
}

export default function CandidateTable({ candidates, selectedRank, onSelect, evaluated, returned }){
  const [sortKey, setSortKey] = useState('rank');
  const [sortDir, setSortDir] = useState('asc');

  const rows = useMemo(() => {
    const arr = [...(candidates || [])];
    arr.sort((a, b) => {
      const av = cellValue(a, sortKey);
      const bv = cellValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number'){
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      const as = String(av), bs = String(bv);
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as);
    });
    return arr;
  }, [candidates, sortKey, sortDir]);

  function clickHeader(k, unsortable){
    if (unsortable) return;
    if (k === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir(k === 'rank' ? 'asc' : 'desc'); }
  }

  return (
    <RackPanel
      eyebrow="Ranked Candidates"
      title="Candidate ledger"
      italicAccent="Click a row to open the engineering drawer."
      tone="amber"
      dense
      right={(
        <div className="font-mono text-[10px] tracking-rack uppercase text-textDim">
          {returned != null ? `${returned} shown` : ''}
          {evaluated != null ? ` · ${evaluated} evaluated` : ''}
        </div>
      )}
    >
      {(!candidates || candidates.length === 0) ? (
        <div className="font-mono text-[11px] text-textDim italic py-6 text-center">
          No candidates yet.  Set inputs and press <span className="text-amber">Run regional sweep</span>.
        </div>
      ) : (
        <div className="overflow-auto max-h-[420px] border border-rule rounded-sm">
          <table className="w-full font-mono text-[11px]">
            <thead className="sticky top-0 bg-panelDeep border-b border-rule">
              <tr>
                {COLUMNS.map(col => {
                  const active = sortKey === col.key;
                  return (
                    <th
                      key={col.key}
                      onClick={() => clickHeader(col.key, col.unsortable)}
                      className={[
                        'px-2 py-2 uppercase tracking-rack text-[10px] text-textDim',
                        col.align === 'right' ? 'text-right' : 'text-left',
                        col.unsortable ? 'cursor-default' : 'cursor-pointer hover:text-cream',
                        active ? 'text-cream' : ''
                      ].join(' ')}
                    >
                      {col.label}
                      {active && (
                        <span className="ml-1 text-amber">{sortDir === 'asc' ? '↑' : '↓'}</span>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(c => {
                const isSel = c.rank === selectedRank;
                const statusCode = c.status_category;
                const statusLegacy = primaryStatus(c.status_labels);
                return (
                  <tr
                    key={c.rank}
                    onClick={() => onSelect && onSelect(c.rank)}
                    className={[
                      'cursor-pointer transition-colors border-t border-rule/60',
                      isSel ? 'bg-amber/10' : 'hover:bg-cyan/5'
                    ].join(' ')}
                  >
                    <td className="px-2 py-1.5 text-right">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-block w-2 h-2 rounded-full"
                          style={{ background: rankColor(c.rank) }}
                          aria-hidden="true"
                        />
                        <span className="text-cream">{c.rank}</span>
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right text-cream">{fmt('score', c.score)}</td>
                    <td className="px-2 py-1.5"><SourceChip source={c.source} /></td>
                    <td className="px-2 py-1.5"><HostCell candidate={c} /></td>
                    <td className="px-2 py-1.5 text-right text-textDim">{fmt('distance_from_current_km', c.distance_from_current_km)}</td>
                    <td className="px-2 py-1.5 text-right text-textDim">{fmt('col_coverage_pct', c.col_coverage_pct)}</td>
                    <td className="px-2 py-1.5 text-textDim">{c.nif_status || '—'}</td>
                    <td className="px-2 py-1.5 text-right text-textDim">{fmt('daytime_reach_km', c.daytime_reach_km)}</td>
                    <td className="px-2 py-1.5 text-textDim">{c.fuel_risk || '—'}</td>
                    <td className="px-2 py-1.5">
                      {statusCode
                        ? <StatusChip status={statusCode} dense />
                        : <StatusChip label={statusLegacy} dense />}
                    </td>
                    <td className="px-2 py-1.5 text-textDim truncate max-w-[260px]" title={c.notes || ''}>
                      {c.notes || ''}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </RackPanel>
  );
}
