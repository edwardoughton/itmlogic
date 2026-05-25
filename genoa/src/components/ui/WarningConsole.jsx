import React from 'react';

// Terminal-style console for blockers / warnings / recommendations.
// Codes are deduped visually (one row per code; the first detail wins,
// matching the engine's W.dedupe behavior).
//
// Display-text override per regulatory context
// =============================================
// When `regulatoryContext.facilityStatus === 'licensed'` AND a warning
// code appears in `warningsToDowngrade`, we render a softer message
// (the console row keeps the original code so reviewers can still
// look it up, but the detail text is replaced with the spec's
// licensed-facility wording).  The warning is NOT dropped — it stays
// visible per the spec's "do not hide failures" requirement.  See
// src/engine/regulatory/context.js for the source-of-truth list.

const LICENSED_DOWNGRADE_DETAIL =
  'Current-rule conflict detected: this existing licensed facility ' +
  'does not clear the modeled §73.207/§73.215 checks.  This is a ' +
  'regulatory-risk condition for modification or renewal review, not ' +
  'a standalone finding that the licensed facility is unauthorized.';

function dedupe(list){
  const seen = new Map();
  for (const w of (list || [])){
    if (!seen.has(w.code)) seen.set(w.code, w);
  }
  return [...seen.values()];
}

/**
 * Apply the regulatory-context override (when applicable) to a single
 * warning entry.  Returns a plain copy with the new detail; never
 * mutates the input.  Adds a `_downgraded` marker the renderer uses
 * to color the row distinctly.
 */
function applyDowngrade(w, downgradeSet, isLicensed){
  if (!w || !w.code) return w;
  if (!isLicensed || !downgradeSet.has(w.code)) return w;
  return {
    ...w,
    detail:       LICENSED_DOWNGRADE_DETAIL,
    _original:    w.detail,
    _downgraded:  true
  };
}

function Block({ heading, items, codeCls, gtCls = 'gt' }) {
  if (!items || !items.length){
    return (
      <div className="mb-2">
        <div className="font-mono text-[10px] tracking-rack uppercase text-textDim mb-1">[ {heading} ]</div>
        <div className="font-mono text-[12px] text-textDim italic">— none —</div>
      </div>
    );
  }
  const list = typeof items[0] === 'string' ? items.map(s => ({ code: '', detail: s })) : dedupe(items);
  return (
    <div className="mb-3">
      <div className="font-mono text-[10px] tracking-rack uppercase text-textDim mb-1">[ {heading} ]</div>
      <div className="space-y-1">
        {list.map((w, i) => (
          <div key={(w.code || '') + i} className="console-line">
            <span className={`gt ${gtCls}`}>{'>'}</span>
            <span className={`font-mono text-[12px] ${w._downgraded ? 'text-cyan' : codeCls}`}>
              {w.code || ''}
              {w._downgraded && (
                <span className="font-mono text-[9px] uppercase tracking-rack text-textDim ml-1.5 px-1 py-0.5 border border-[rgba(214,163,106,0.20)] rounded">
                  context: licensed
                </span>
              )}
              {w.detail ? <span className="text-textDim">{w.code ? ' — ' : ''}{w.detail}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function WarningConsole({
  blockers           = [],
  warnings           = [],
  recommendations    = [],
  warningsToDowngrade = [],
  regulatoryContext  = null
}) {
  // Filter the warnings list down to severity 'warning' only — blockers
  // are already shown separately and 'info' items aren't surfaced here.
  const ws = (warnings || []).filter(w => w.severity !== 'blocker');
  const isLicensed = regulatoryContext?.facilityStatus === 'licensed';
  const downgradeSet = new Set(Array.isArray(warningsToDowngrade) ? warningsToDowngrade : []);
  const downgradedWs       = ws.map(w => applyDowngrade(w, downgradeSet, isLicensed));
  const downgradedBlockers = (blockers || []).map(w => applyDowngrade(w, downgradeSet, isLicensed));
  return (
    <div className="console-frame">
      <Block heading="Blockers"        items={downgradedBlockers} codeCls="text-red"   gtCls="text-red"/>
      <Block heading="Warnings"        items={downgradedWs}       codeCls="text-amber" gtCls="text-amber"/>
      <Block heading="Recommendations" items={recommendations}    codeCls="text-cyan"  gtCls="text-cyan"/>
    </div>
  );
}
