import React from 'react';

// ScoreBreakdownChart — tiny horizontal bar chart of per-goal points
// contributing to a candidate's composite score.  Pure SVG, no deps.
// Used inside the candidate detail drawer to make the ranking
// explainable at a glance.

const GOAL_COLORS = {
  col_coverage:  '#ffb347',
  population:    '#f3c86d',
  blanket:       '#6fd3ff',
  conductivity:  '#63d471',
  wildfire:      '#e89972',
  treaty_zone:   '#c98aff'
};

const GOAL_LABELS = {
  col_coverage: 'COL coverage',
  population:   'Population',
  blanket:      'Blanket pop.',
  conductivity: 'Conductivity',
  wildfire:     'Wildfire risk',
  treaty_zone:  'Treaty zone'
};

export default function ScoreBreakdownChart({ breakdown, totalScore }){
  const entries = Object.entries(breakdown || {});
  if (entries.length === 0){
    return (
      <div className="font-mono text-[11px] text-textDim italic">
        No per-goal breakdown returned by engine.
      </div>
    );
  }
  const max = Math.max(...entries.map(([, v]) => Math.abs(Number(v) || 0)), 1);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between mb-1">
        <span className="rack-eyebrow">Score breakdown</span>
        <span className="font-mono text-[11px] text-textDim">
          total <span className="text-cream">{(Number(totalScore) || 0).toFixed(1)}</span>
        </span>
      </div>
      {entries.map(([k, v]) => {
        const val   = Number(v) || 0;
        const pct   = Math.max(0, Math.min(100, (val / max) * 100));
        const color = GOAL_COLORS[k] || '#a89c84';
        return (
          <div key={k} className="grid grid-cols-[110px_1fr_36px] items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-rack text-textDim">
              {GOAL_LABELS[k] || k}
            </span>
            <span className="block h-2 rounded-sm bg-[#06141a] border border-rule overflow-hidden">
              <span
                className="block h-full"
                style={{ width: `${pct}%`, background: color }}
              />
            </span>
            <span
              className="font-mono text-[11px] text-right"
              style={{ color }}
            >
              {val.toFixed(0)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
