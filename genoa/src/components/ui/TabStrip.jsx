import React from 'react';

// TabStrip — two-level Bloomberg-style nav.
//
// Two prop shapes accepted:
//   - tabs:   [{ id, label }, ...]                                (legacy flat)
//   - groups: [{ label, items: [{ id, label }, ...] }, ...]       (preferred)
//
// When groups is supplied, the strip renders TWO rows:
//   Row 1 — primary: one tab per group label (Exhibit, Studies, AM, …).
//   Row 2 — secondary: only the items inside the active group.
//
// Active id is always a leaf (item) id.  We find which group contains
// it to highlight the right primary tab.  Clicking a primary tab that
// doesn't contain the current active id jumps to that group's first
// item.  Single-item groups skip the secondary row entirely.

export default function TabStrip({ tabs, groups, activeId, onChange }) {
  if (Array.isArray(groups) && groups.length > 0){
    const foundIdx = groups.findIndex(
      (g) => (g.items || []).some((t) => t.id === activeId)
    );
    const activeGroupIdx = foundIdx >= 0 ? foundIdx : 0;
    const activeGroup = groups[activeGroupIdx] || groups[0];
    return (
      <nav className="tab-strip tab-strip-2lvl" role="tablist">
        <div className="tab-primary-row">
          {groups.map((g, i) => (
            <button
              key={`grp-${i}`}
              role="tab"
              aria-selected={i === activeGroupIdx}
              onClick={() => {
                if (i === activeGroupIdx) return;
                const first = (g.items || [])[0];
                if (first) onChange(first.id);
              }}
              className={`tab tab-primary ${i === activeGroupIdx ? 'active' : ''}`}>
              {g.label}
            </button>
          ))}
        </div>
        {(activeGroup?.items?.length || 0) > 1 && (
          <div className="tab-secondary-row">
            {activeGroup.items.map((t) => (
              <TabButton key={t.id} t={t} activeId={activeId} onChange={onChange} secondary />
            ))}
          </div>
        )}
      </nav>
    );
  }
  return (
    <nav className="tab-strip" role="tablist">
      {(tabs || []).map((t) => (
        <TabButton key={t.id} t={t} activeId={activeId} onChange={onChange} />
      ))}
    </nav>
  );
}

function TabButton({ t, activeId, onChange, secondary = false }){
  return (
    <button
      role="tab"
      aria-selected={t.id === activeId}
      onClick={() => onChange(t.id)}
      className={`tab ${secondary ? 'tab-secondary' : ''} ${t.id === activeId ? 'active' : ''}`}>
      {t.label}
    </button>
  );
}
