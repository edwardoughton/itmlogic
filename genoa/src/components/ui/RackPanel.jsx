import React from 'react';

// Generic rack panel.  Accepts an optional `tone` for the left accent rail
// (amber | cyan | danger | default), a small mono `eyebrow` string, a
// `title`, and `dense` to tighten padding for very compact telemetry blocks.

export default function RackPanel({
  title,
  eyebrow,
  italicAccent,
  children,
  tone = 'default',
  dense = false,
  className = '',
  right
}) {
  const tonecls = tone && tone !== 'default' ? `tone-${tone}` : '';
  const pad = dense ? 'p-3' : 'p-5';
  return (
    <section className={`rack-panel ${tonecls} ${pad} ${className}`}>
      {(title || eyebrow || right) && (
        <header className="flex items-end justify-between gap-3 mb-3">
          <div>
            {eyebrow && <div className="rack-eyebrow mb-1">{eyebrow}</div>}
            {title    && <div className="rack-title">{title}</div>}
            {italicAccent && (
              <div className="rack-italic text-[13px] mt-1">{italicAccent}</div>
            )}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div>{children}</div>
    </section>
  );
}
