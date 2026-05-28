import React from 'react';

// FindingBadge — a uniform status pill for any FindingStatus value.
//
// Accepts:
//   status    : one of the closed FindingStatus enum strings
//   label     : optional override text (defaults to status)
//   size      : 'sm' | 'md'  (default 'sm')
//   title     : optional tooltip
//
// Colour mapping mirrors the rack-panel tone palette (red / amber / green
// / cyan / muted) so badges read clearly against the dark studio chrome.

const TONE = {
  PASS:            { bg: 'bg-green/15',  text: 'text-green',  bd: 'border-green/40'  },
  SCREENING_PASS:  { bg: 'bg-green/10',  text: 'text-green',  bd: 'border-green/30'  },
  INFO:            { bg: 'bg-cyan/10',   text: 'text-cyan',   bd: 'border-cyan/30'   },
  ADVISORY:        { bg: 'bg-amber/10',  text: 'text-amber',  bd: 'border-amber/40'  },
  SKIP:            { bg: 'bg-textDim/10',text: 'text-textDim',bd: 'border-rule'      },
  NOT_RUN:         { bg: 'bg-textDim/10',text: 'text-textDim',bd: 'border-rule'      },
  INCOMPLETE:      { bg: 'bg-amber/15',  text: 'text-amber',  bd: 'border-amber/40'  },
  SCREENING:       { bg: 'bg-cyan/10',   text: 'text-cyan',   bd: 'border-cyan/30'   },
  SCREENING_FAIL:  { bg: 'bg-red/15',    text: 'text-red',    bd: 'border-red/40'    },
  FAIL:            { bg: 'bg-red/20',    text: 'text-red',    bd: 'border-red/50'    },
  BLOCKER:         { bg: 'bg-red/25',    text: 'text-red',    bd: 'border-red/60'    },
  FILING_BLOCKER:  { bg: 'bg-red/30',    text: 'text-red',    bd: 'border-red/70'    }
};

const DEFAULT_TONE = { bg: 'bg-textDim/10', text: 'text-textDim', bd: 'border-rule' };

export default function FindingBadge({ status, label, size = 'sm', title }) {
  const key  = (status || 'NOT_RUN').toString().toUpperCase();
  const tone = TONE[key] || DEFAULT_TONE;
  const text = (label || key).replace(/_/g, ' ');
  const pad  = size === 'md' ? 'px-2.5 py-1 text-[11px]' : 'px-2 py-[2px] text-[10px]';
  return (
    <span
      title={title || key}
      className={`inline-flex items-center font-mono uppercase tracking-rack border rounded-sm ${pad} ${tone.bg} ${tone.text} ${tone.bd}`}
    >
      {text}
    </span>
  );
}
