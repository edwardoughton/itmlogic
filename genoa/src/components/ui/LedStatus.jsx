import React from 'react';

const TONE = {
  nominal:  { cls: 'led-green', label: 'NOMINAL'  },
  degraded: { cls: 'led-amber led-blink', label: 'DEGRADED' },
  blocked:  { cls: 'led-red led-blink',   label: 'BLOCKED'  },
  offline:  { cls: 'led-off',             label: 'OFFLINE'  }
};

export default function LedStatus({ status = 'nominal', label }) {
  const t = TONE[status] || TONE.offline;
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`led-dot ${t.cls}`} aria-hidden="true" />
      <span className="font-mono text-[10px] tracking-rack uppercase text-textDim">
        {label || t.label}
      </span>
    </span>
  );
}
