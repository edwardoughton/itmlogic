// statusUtil — shared color + label helpers for candidate status badges.
//
// Two parallel vocabularies are supported:
//
//  1) Legacy free-text labels coming from the original site-optimizer
//     payload (PROMISING, REVIEW REQUIRED, ENGINEER REVIEW REQUIRED,
//     SCREENING ONLY, NON-COMPLIANT).
//
//  2) Co-location opportunity engine `status_category` enum:
//        PROMISING                      — green
//        REVIEW_REQUIRED                — amber
//        RECOVERABLE_WITH_DA            — cyan (DA variant)
//        RECOVERABLE_WITH_REDUCED_POWER — cyan (reduced power variant)
//        RECOVERABLE_WITH_COL_CHANGE    — cyan (COL change variant)
//        TREATY_REVIEW                  — violet
//        NON_COMPLIANT                  — red
//        UNKNOWN_DATA                   — neutral grey

export const STATUS_TONES = {
  // legacy free-text labels
  'PROMISING':                  { fg: '#63d471', bg: 'rgba(99,212,113,0.12)',  border: 'rgba(99,212,113,0.5)'  },
  'SCREENING ONLY':             { fg: '#6fd3ff', bg: 'rgba(111,211,255,0.10)', border: 'rgba(111,211,255,0.45)' },
  'REVIEW REQUIRED':            { fg: '#ffb347', bg: 'rgba(255,179,71,0.12)',  border: 'rgba(255,179,71,0.5)'  },
  'ENGINEER REVIEW REQUIRED':   { fg: '#ffb347', bg: 'rgba(255,179,71,0.12)',  border: 'rgba(255,179,71,0.5)'  },
  'NON-COMPLIANT':              { fg: '#ff5a5a', bg: 'rgba(255,90,90,0.12)',   border: 'rgba(255,90,90,0.55)'  },

  // co-location status_category enum
  'REVIEW_REQUIRED':                { fg: '#ffb347', bg: 'rgba(255,179,71,0.12)',  border: 'rgba(255,179,71,0.5)'  },
  'RECOVERABLE_WITH_DA':            { fg: '#6fd3ff', bg: 'rgba(111,211,255,0.12)', border: 'rgba(111,211,255,0.55)' },
  'RECOVERABLE_WITH_REDUCED_POWER': { fg: '#9fd3bd', bg: 'rgba(159,211,189,0.12)', border: 'rgba(159,211,189,0.55)' },
  'RECOVERABLE_WITH_COL_CHANGE':    { fg: '#7ec8ff', bg: 'rgba(126,200,255,0.12)', border: 'rgba(126,200,255,0.55)' },
  'TREATY_REVIEW':                  { fg: '#c79bff', bg: 'rgba(199,155,255,0.12)', border: 'rgba(199,155,255,0.55)' },
  'NON_COMPLIANT':                  { fg: '#ff5a5a', bg: 'rgba(255,90,90,0.12)',   border: 'rgba(255,90,90,0.55)'  },
  'UNKNOWN_DATA':                   { fg: '#a89c84', bg: 'rgba(168,156,132,0.10)', border: 'rgba(168,156,132,0.45)' }
};

// Human-readable label for an enum code (or a free-text legacy label).
export const STATUS_LABELS = {
  'PROMISING':                      'PROMISING',
  'REVIEW_REQUIRED':                'REVIEW REQUIRED',
  'RECOVERABLE_WITH_DA':            'RECOVERABLE · DA',
  'RECOVERABLE_WITH_REDUCED_POWER': 'RECOVERABLE · REDUCED PWR',
  'RECOVERABLE_WITH_COL_CHANGE':    'RECOVERABLE · COL CHANGE',
  'TREATY_REVIEW':                  'TREATY REVIEW',
  'NON_COMPLIANT':                  'NON-COMPLIANT',
  'UNKNOWN_DATA':                   'UNKNOWN DATA'
};

// Tiny glyph rendered before the label inside StatusChip.  Unicode-only
// so we don't add an icon dependency.
export const STATUS_ICONS = {
  'PROMISING':                      '●',
  'REVIEW_REQUIRED':                '!',
  'RECOVERABLE_WITH_DA':            '↻',
  'RECOVERABLE_WITH_REDUCED_POWER': '↓',
  'RECOVERABLE_WITH_COL_CHANGE':    '⇄',
  'TREATY_REVIEW':                  '§',
  'NON_COMPLIANT':                  '✕',
  'UNKNOWN_DATA':                   '?'
};

export function tonesFor(label){
  return STATUS_TONES[label] || { fg: '#a89c84', bg: 'rgba(168,156,132,0.08)', border: 'rgba(168,156,132,0.4)' };
}

export function labelFor(code){
  if (!code) return 'UNKNOWN DATA';
  return STATUS_LABELS[code] || String(code).replace(/_/g, ' ');
}

export function iconFor(code){
  return STATUS_ICONS[code] || '';
}

// Rank → colour gradient.  Top-rank candidate is amber (warm/featured);
// gradient cools through gold → cyan as rank degrades.
const RANK_COLORS = ['#ffb347', '#f3c86d', '#d6a36a', '#9fd3bd', '#6fd3ff', '#3e7e94'];
export function rankColor(rank){
  const i = Math.min(Math.max(0, (rank | 0) - 1), RANK_COLORS.length - 1);
  return RANK_COLORS[i];
}

// A candidate's primary "headline" status — chosen so the rank table
// can show one chip per row even when the server returns several.
// Severity order: NON-COMPLIANT > REVIEW REQUIRED > ENGINEER REVIEW
// REQUIRED > PROMISING > SCREENING ONLY.
const SEVERITY = [
  'NON-COMPLIANT',
  'REVIEW REQUIRED',
  'ENGINEER REVIEW REQUIRED',
  'PROMISING',
  'SCREENING ONLY'
];
export function primaryStatus(labels){
  if (!Array.isArray(labels) || labels.length === 0) return 'SCREENING ONLY';
  for (const s of SEVERITY){
    if (labels.includes(s)) return s;
  }
  return labels[0];
}
