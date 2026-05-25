import React, { useState } from 'react';

// InfrastructureLegend — small floating legend hosted inside the
// OptimizerMap container.  Explains the nine marker treatments used
// when search_mode !== 'GRID'.  Hidden in GRID mode (the parent passes
// `visible={false}` and we render nothing).
//
// Marker treatments:
//   TOWER       (cyan circle)        + selected variant (cyan ring)
//   ASR         (gold square)        + selected variant
//   AM_SITE     (amber diamond)      + selected variant
//   FM_SITE     (green triangle)     + selected variant
//   TV_SITE     (violet hexagon)     + selected variant
//   NON_EVAL    (muted grey ring)    — reserved for sites included
//                                       by filters but unscored

const ITEMS = [
  { key: 'TOWER',    label: 'Tower',           color: '#6fd3ff', shape: 'circle'   },
  { key: 'ASR',      label: 'ASR registered',  color: '#f3c86d', shape: 'square'   },
  { key: 'AM_SITE',  label: 'AM site',         color: '#ffb347', shape: 'diamond'  },
  { key: 'FM_SITE',  label: 'FM site',         color: '#63d471', shape: 'triangle' },
  { key: 'TV_SITE',  label: 'TV site',         color: '#c79bff', shape: 'hexagon'  },
  { key: 'NON_EVAL', label: 'Unscored',        color: '#a89c84', shape: 'ring'     }
];

function Glyph({ color, shape }){
  const size = 12;
  const common = { width: size, height: size, viewBox: '0 0 12 12' };
  switch (shape){
    case 'square':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="1.5" y="1.5" width="9" height="9" fill={color} stroke="#0a1a25" strokeWidth="1" />
        </svg>
      );
    case 'diamond':
      return (
        <svg {...common} aria-hidden="true">
          <polygon points="6,1 11,6 6,11 1,6" fill={color} stroke="#0a1a25" strokeWidth="1" />
        </svg>
      );
    case 'triangle':
      return (
        <svg {...common} aria-hidden="true">
          <polygon points="6,1 11,11 1,11" fill={color} stroke="#0a1a25" strokeWidth="1" />
        </svg>
      );
    case 'hexagon':
      return (
        <svg {...common} aria-hidden="true">
          <polygon points="6,1 10.5,3.5 10.5,8.5 6,11 1.5,8.5 1.5,3.5" fill={color} stroke="#0a1a25" strokeWidth="1" />
        </svg>
      );
    case 'ring':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="6" cy="6" r="4" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="2 1.5" />
        </svg>
      );
    case 'circle':
    default:
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="6" cy="6" r="4.5" fill={color} stroke="#0a1a25" strokeWidth="1" />
        </svg>
      );
  }
}

export default function InfrastructureLegend({ visible = true }){
  const [open, setOpen] = useState(true);
  if (!visible) return null;
  return (
    <div
      className="absolute z-[400] bottom-3 left-3 bg-panelDeep/90 border border-rule rounded-sm shadow-rackDeep backdrop-blur-sm"
      style={{ minWidth: open ? 180 : 0 }}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 px-2 py-1 border-b border-rule/60 font-mono text-[9px] tracking-rack uppercase text-textDim hover:text-cream"
        aria-label={open ? 'Collapse legend' : 'Expand legend'}
      >
        <span>Infrastructure layer</span>
        <span className="text-amber">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <ul className="px-2 py-1.5 space-y-1">
          {ITEMS.map(it => (
            <li key={it.key} className="flex items-center gap-2 font-mono text-[10px] text-text">
              <Glyph color={it.color} shape={it.shape} />
              <span>{it.label}</span>
            </li>
          ))}
          <li className="pt-1 mt-1 border-t border-rule/60 font-mono text-[9px] italic text-textDim">
            Selected = bright ring.
          </li>
        </ul>
      )}
    </div>
  );
}

// Public marker spec — imported by OptimizerMap so the two surfaces
// stay in lockstep on colour/shape.
export const INFRA_MARKER_SPEC = {
  TOWER:    { color: '#6fd3ff', shape: 'circle'   },
  ASR:      { color: '#f3c86d', shape: 'square'   },
  AM_SITE:  { color: '#ffb347', shape: 'diamond'  },
  FM_SITE:  { color: '#63d471', shape: 'triangle' },
  TV_SITE:  { color: '#c79bff', shape: 'hexagon'  },
  NON_EVAL: { color: '#a89c84', shape: 'ring'     }
};
