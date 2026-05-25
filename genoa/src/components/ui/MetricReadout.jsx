import React from 'react';

const TONE = {
  default: 'text-cream',
  amber:   'text-amber',
  gold:    'text-gold',
  cyan:    'text-cyan',
  red:     'text-red',
  green:   'text-green',
  dim:     'text-textDim'
};

// MetricReadout — a single rack-display readout.
//
// label    e.g. "ERP"
// value    e.g. 100.0
// unit     e.g. "kW"
// tone     default | amber | gold | cyan | red | green | dim
// led      optional 'amber' | 'cyan' | 'red' | 'green' to show a status dot
// subvalue secondary line (e.g. "via FCC")

export default function MetricReadout({ label, value, unit, tone = 'default', led, subvalue, className = '' }) {
  const valueCls = TONE[tone] || TONE.default;
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 border-b border-[rgba(214,163,106,0.10)] last:border-b-0 ${className}`}>
      <span className="font-mono text-[10px] tracking-rack uppercase text-textDim flex items-center gap-2">
        {led && <span className={`led-dot led-${led}`} aria-hidden="true" />}
        {label}
      </span>
      <span className="text-right">
        <span className={`font-mono text-[14px] font-medium tabular-nums ${valueCls}`}>
          {value === null || value === undefined || value === '' ? '—' : value}
        </span>
        {unit && (
          <span className="font-mono text-[10px] tracking-rack uppercase text-textDim ml-1.5">{unit}</span>
        )}
        {subvalue && (
          <div className="font-mono text-[10px] text-textDim mt-0.5">{subvalue}</div>
        )}
      </span>
    </div>
  );
}
