import React from 'react';

// TabStrip — dense Bloomberg-style mono tabs with amber underline.
// tabs: [{ id, label }]

export default function TabStrip({ tabs, activeId, onChange }) {
  return (
    <nav className="tab-strip" role="tablist">
      {tabs.map(t => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === activeId}
          onClick={() => onChange(t.id)}
          className={`tab ${t.id === activeId ? 'active' : ''}`}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
