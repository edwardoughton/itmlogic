// Advisory AI exhibit-review pass.
//
// Runs the assembled exhibit's verdict / conclusion / HAAT / contour
// surface through the DO inference router's engineering-exhibit-
// validation policy (grounded in the FCC Part-73 KB when available) and
// returns INTERNAL-CONSISTENCY findings — e.g. "FILING READINESS: READY
// while the conclusion is NON-COMPLIANT", or "flat HAAT but varying
// per-radial distances".
//
// STRICTLY ADVISORY.  This never changes contour distances, §73.x
// compliance determinations, readiness gates, or any deterministic
// engine output.  It emits warnings + an advisory section the engineer
// of record reviews.  No MODEL_ACCESS_KEY → no-op (returns null), so
// offline/local/test runs are unaffected.

import * as aiRouter from '../services/aiRouter.js';
import * as fccKb from '../services/fccKb.js';

const SYSTEM_PROMPT =
  'You are an FCC broadcast engineering-exhibit consistency auditor.  You are given a ' +
  'condensed snapshot of a generated propagation exhibit (validation verdict, engineering ' +
  'conclusion, HAAT validation, and contour summary).  Identify ONLY concrete internal ' +
  'contradictions or claims that are physically/regulatorily impossible given the other ' +
  'values shown.  Do NOT restate the exhibit, do NOT speculate, do NOT comment on filing ' +
  'merits.  When grounding CFR text is provided, use it to check citations.  Respond as a ' +
  'JSON array of {"issue":"<one sentence>","severity":"WARNING|INFO"}; empty array [] if ' +
  'internally consistent.';

// Build a compact, deterministic snapshot of the consistency-relevant
// surface.  Kept small (the router bills per token) and stable (so the
// same exhibit yields the same prompt → reproducible advisory).
export function snapshot(exhibit){
  const v  = exhibit?.validation_verdict || exhibit?.verdict || {};
  const cat = v.categories || {};
  const hv = exhibit?.haat_validation || {};
  const lines = [];
  lines.push(`service=${exhibit?.station_inputs?.service || '?'} call=${exhibit?.station_inputs?.call || '?'}`);
  if (cat.computational) lines.push(`computational=${cat.computational.status}`);
  if (cat.external)      lines.push(`external_parity=${cat.external.status}`);
  if (cat.filing)        lines.push(`filing_readiness=${cat.filing.status}`);
  if (v.status)          lines.push(`verdict_status=${v.status}`);
  for (const c of (v.components || [])){
    if (c?.name && c?.status) lines.push(`component: ${c.name} = ${c.status}`);
  }
  if (exhibit?.regulatory_compliance?.pass != null)
    lines.push(`regulatory_pass=${exhibit.regulatory_compliance.pass}`);
  if (exhibit?.engineering_conclusion?.conclusion)
    lines.push(`engineering_conclusion=${exhibit.engineering_conclusion.conclusion}`);
  if (hv.status) lines.push(`haat_status=${hv.status} haat_basis=${hv.basis || '?'}`);
  const s = hv.stats || {};
  if (s.min_m != null && s.max_m != null)
    lines.push(`haat_per_radial_range=[${s.min_m}, ${s.max_m}] mean=${s.mean_m} operator=${s.operator_m}`);
  // Contour distance spread — the flat-HAAT-but-varying-distance tell.
  const rt = Array.isArray(exhibit?.radial_table) ? exhibit.radial_table : [];
  const dvals = [];
  for (const r of rt){
    const cd = r?.contour_distances_km || {};
    for (const k of Object.keys(cd)){ const d = Number(cd[k]); if (Number.isFinite(d)) dvals.push(d); }
  }
  if (dvals.length){
    lines.push(`contour_distance_spread_km=[${Math.min(...dvals).toFixed(2)}, ${Math.max(...dvals).toFixed(2)}]`);
  }
  return lines.join('\n');
}

// Pull a couple of grounding chunks for any CFR sections the exhibit
// leans on.  Best-effort; ungrounded if the KB isn't authorized.
async function groundingFor(exhibit){
  if (!fccKb.isEnabled()) return '';
  const svc = String(exhibit?.station_inputs?.service || '').toUpperCase();
  const q = svc === 'AM'
    ? '§73.182 nighttime interference RSS and §73.184 groundwave protected contours'
    : '§73.215 contour protection and §73.207 minimum distance separation';
  const res = await fccKb.retrieve(q, { k: 2 });
  if (!res.available) return '';
  return 'Grounding CFR excerpts:\n' + res.chunks.map(c => c.text.slice(0, 800)).join('\n---\n');
}

export async function reviewExhibit(exhibit){
  if (!aiRouter.isEnabled()) return null;   // no key → advisory layer off
  const snap = snapshot(exhibit);
  const grounding = await groundingFor(exhibit);
  const user = grounding ? `${snap}\n\n${grounding}` : snap;

  const out = await aiRouter.complete({ system: SYSTEM_PROMPT, user, maxTokens: 600 });
  if (!out.available) return { available: false, reason: out.reason, grounded: !!grounding };

  let findings = [];
  try {
    const m = out.content.match(/\[[\s\S]*\]/);   // tolerate prose around the JSON
    if (m) findings = JSON.parse(m[0]);
  } catch { /* leave empty; raw content preserved below */ }

  return {
    available: true,
    grounded:  !!grounding,
    model:     out.model,
    findings:  Array.isArray(findings) ? findings : [],
    raw:       out.content
  };
}
