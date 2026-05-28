import React from 'react';
import { tonesFor, labelFor, iconFor } from './statusUtil.js';

// StatusChip — compact uppercase label used on rows, markers, tooltips
// and inside the detail drawer.  Borrows tones from statusUtil so every
// surface tells the same story for the same label.
//
// Two forms are accepted:
//   <StatusChip label="REVIEW REQUIRED" />     // legacy free-text label
//   <StatusChip status="RECOVERABLE_WITH_DA"/> // co-location enum code
//
// When `status` is supplied, both the colour tone and the rendered text
// are looked up via the enum so the operator sees a consistent label.

export default function StatusChip({ label, status, dense = false }){
  // Prefer the enum code if both are supplied.
  const code = status || label;
  if (!code) return null;
  // Tones come from the enum first; otherwise legacy label lookup.
  const t = tonesFor(status) === tonesFor(undefined) && !status
    ? tonesFor(label)
    : tonesFor(code);
  const text = status ? labelFor(status) : label;
  const glyph = status ? iconFor(status) : '';
  const pad = dense ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]';
  return (
    <span
      className={`inline-flex items-center gap-1 font-mono tracking-rack uppercase border rounded-sm ${pad}`}
      style={{ color: t.fg, background: t.bg, borderColor: t.border }}
      title={text}
    >
      {glyph && <span aria-hidden="true" style={{ opacity: 0.85 }}>{glyph}</span>}
      <span>{text}</span>
    </span>
  );
}
