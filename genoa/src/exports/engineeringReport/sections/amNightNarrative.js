// Auto-narrative for the §73.182 nighttime allocation appendix.
//
// PROBLEM
//   Engineers manually write the prose paragraph that frames Appendix F's
//   tables — "the proposed Class B station at 700 kHz protects every
//   §73.182 RSS-evaluated AM within 750 mi; the binding constraint is
//   the WBLK co-channel pair at 600 km with a +1.2 dB margin..."  This
//   module composes that prose deterministically from the
//   evidence.am_night_nif payload Genoa already captures, so the
//   Appendix F render carries the same reviewer-first narrative an H&D
//   consultant would draft by hand.
//
// CONTRACT
//   buildAmNightNarrative(exhibit) → { ok, paragraphs[] } | { ok:false }
//
//   Returns ok:false (paragraphs:[]) for non-AM exhibits, exhibits
//   without am_night_nif evidence, or NIF studies that returned
//   available:false.  Caller surfaces the underlying §73.182 NOT-RUN
//   block via Appendix F's existing fallback.
//
// IMPLEMENTATION
//   Entirely deterministic.  No LLM dependency — every paragraph is
//   built from the structured fields in evidence.am_night_nif.summary,
//   evidence.am_night_nif.contour, and evidence.am_night_nif.interferers
//   so the prose is replay-stable across re-computes of the same
//   inputs.  Reviewers can match every claim back to a numbered field
//   in Appendix F's tables.
//
// REGULATORY
//   - 47 CFR §73.182  — engineering standards of allocation, AM nighttime
//   - 47 CFR §73.183  — protection ratios per class + relation
//   - 47 CFR §73.190  — engineering charts, Wang skywave model

export function buildAmNightNarrative(exhibit){
  if (!exhibit || typeof exhibit !== 'object') return { ok: false, paragraphs: [] };
  const svc = String(exhibit.station_inputs?.service || '').toUpperCase();
  if (svc !== 'AM') return { ok: false, paragraphs: [] };

  const nif = exhibit.evidence?.am_night_nif;
  if (!nif || nif.available !== true) return { ok: false, paragraphs: [] };

  const proposed = nif.proposed || exhibit.station_inputs || {};
  const summary  = nif.summary  || {};
  const interferers = Array.isArray(nif.interferers) ? nif.interferers : [];
  const contour    = Array.isArray(nif.contour)     ? nif.contour     : [];

  const paragraphs = [];

  // 1. Opener — verdict-first sentence the reviewer wants up top.
  paragraphs.push(opener({ proposed, summary }));

  // 2. Methodology + RSS pool composition.
  paragraphs.push(methodologyParagraph({ summary, interferers, nif }));

  // 3. Binding constraint, when one exists.  This is the paragraph
  //    that earns the auto-narrative its keep — engineers want to
  //    know the SINGLE worst pair, not browse a 36-row table.
  const binding = bindingPair(contour);
  if (binding) paragraphs.push(bindingParagraph({ binding, proposed }));

  // 4. Failing-azimuth roll-up, when applicable.
  if ((summary.n_failing_azimuths || 0) > 0
      || (summary.n_no_service_azimuths || 0) > 0){
    paragraphs.push(failureRollupParagraph({ summary, contour }));
  }

  // 5. Closing — replay-determinism reassurance.
  paragraphs.push(closingParagraph({ nif }));

  return { ok: true, paragraphs };
}

// ---------------------------------------------------------------------------
// section composers
// ---------------------------------------------------------------------------

function opener({ proposed, summary }){
  const tag = stationTag(proposed);
  const cls = proposed.fcc_class ? `Class ${proposed.fcc_class}` : 'subject';
  const passing = (summary.n_failing_azimuths || 0) === 0
               && (summary.n_no_service_azimuths || 0) === 0;
  if (passing){
    return `Under 47 CFR §73.182, the proposed ${cls} ${tag} provides interference-free nighttime service over its full ${summary.n_azimuths || 0}-azimuth NIF contour.  Mean NIF radius ${fmtKm(summary.mean_radius_km)} (range ${fmtKm(summary.min_radius_km)}–${fmtKm(summary.max_radius_km)}); worst binding margin ${fmtMargin(summary.worst_margin_db)} against the §73.183 protection ratio for the binding relation.`;
  }
  if ((summary.n_no_service_azimuths || 0) === summary.n_azimuths && summary.n_azimuths){
    return `Under 47 CFR §73.182, the proposed ${cls} ${tag} cannot provide interference-free nighttime service at any azimuth — every one of the ${summary.n_azimuths} evaluated bearings is dominated by RSS-aggregated co- or adjacent-channel interference.  The facility as proposed does not qualify under §73.182 and would require either pattern redesign or class change before filing.`;
  }
  // n_no_service_azimuths is a SUBSET of n_failing_azimuths in the
  // orchestrator's accounting — no-service rows carry binding.pass=false
  // by construction (see nifContour.js nifRadiusAtAzimuth).  Subtract
  // only n_failing_azimuths to avoid the double-count Codex caught
  // on #173.
  const n_failing = summary.n_failing_azimuths || 0;
  const n_no_serv = summary.n_no_service_azimuths || 0;
  const n_served  = (summary.n_azimuths || 0) - n_failing;
  const failBreakdown = n_no_serv > 0
    ? `${n_failing} azimuth(s) fail the §73.183 protection ratio for the binding relation (of which ${n_no_serv} cannot provide service at any radius — RSS interference dominates everywhere)`
    : `${n_failing} azimuth(s) fail the §73.183 protection ratio for the binding relation`;
  return `Under 47 CFR §73.182, the proposed ${cls} ${tag} provides interference-free nighttime service over ${n_served} of ${summary.n_azimuths || 0} evaluated azimuths.  ${failBreakdown}.  Worst binding margin ${fmtMargin(summary.worst_margin_db)}.`;
}

function methodologyParagraph({ summary, interferers, nif }){
  const n_used = summary.n_interferers_used || 0;
  const n_seen = summary.n_interferers_seen || 0;
  const cap   = nif.interferer_cap_applied;
  const relations = uniqueRelations(interferers);
  const relText = relations.length ? relations.join(', ') : 'co/1st/2nd-adjacent';
  const capText = cap
    ? `  The interferer pool was capped at ${n_used} (of ${n_seen} pulled from FCC AM Query within 1500 km); the cap is sorted by distance so the strongest interferers always survive.`
    : '';
  const engineText = describeEngine(nif);
  const engineCaveat = isBerryEngine(nif)
    ? '  SCREENING-grade per §73.190(c) — Re-run with FCCAM (Wang 1985) before filing.'
    : '';
  return `The §73.182(k) RSS aggregation uses ${n_used} nearby AM station${n_used === 1 ? '' : 's'} (of ${n_seen} candidates within the 1500 km LMS query radius), covering the ${relText} channel relations the §73.183 D/U table protects.  The 25% exclusion threshold of §73.182(k) is applied per receiver — a station that contributes at one azimuth may be excluded at another.  Skywave field strengths come from ${engineText}; pattern-factor application uses the §73.150 horizontal pattern when a directional pattern_table is attached, omni otherwise.${engineCaveat}${capText}`;
}

function isBerryEngine(nif){
  const engine = nif?.engine || nif?.source || 'fccam';
  return engine === 'berry-1968-screening' || (typeof engine === 'string' && engine.startsWith('berry'));
}

// Engine-aware methodology + closing prose.  Reads the engine
// identity threaded through from the skywave client (FCCAM Wang
// vs Berry-1968-screening) so the appendix doesn't claim "FCCAM"
// when Berry actually ran.  When Berry ran, the prose includes the
// explicit "SCREENING-grade — re-run with FCCAM Wang before filing"
// disclaimer the reviewer needs to see.
function describeEngine(nif){
  const engine = nif?.engine || nif?.source || 'fccam';
  if (engine === 'berry-1968-screening' || engine?.startsWith?.('berry')){
    return 'the Berry analytical model (47 CFR §73.190(c)) — SCREENING-grade per §73.190(c) — re-run with FCCAM (Wang 1985) before filing';
  }
  return 'FCCAM (Wang 1985 model, 47 CFR §73.190(c)) — filing-grade';
}

function bindingParagraph({ binding, proposed }){
  const azText = `azimuth ${fmtDeg(binding.azimuth_deg)}`;
  const distText = fmtKm(binding.distance_km);
  const rel = binding.binding?.relation || '?';
  const margin = fmtMargin(binding.binding?.margin_db);
  const required = Number.isFinite(binding.binding?.required_uv_m)
    ? `${binding.binding.required_uv_m.toFixed(2)} µV/m`
    : '—';
  const desired = Number.isFinite(binding.binding?.desired_uv_m)
    ? `${binding.binding.desired_uv_m.toFixed(2)} µV/m`
    : '—';
  const contributors = Array.isArray(binding.binding?.contributing) && binding.binding.contributing.length
    ? `Contributing interferers in the binding RSS at this receiver: ${binding.binding.contributing.slice(0, 5).join(', ')}${binding.binding.contributing.length > 5 ? `, …(+${binding.binding.contributing.length - 5})` : ''}.`
    : '';
  return `The binding constraint is at ${azText}, distance ${distText} from the proposed transmitter.  At that receiver point the proposed station's directional 50% skywave field is ${desired}; the §73.183 ${rel} protection threshold against the §73.182(k) RSS-aggregated interference requires at least ${required} (margin ${margin}).  ${contributors}`.trim();
}

function failureRollupParagraph({ summary, contour }){
  const failing = contour.filter((p) => p?.binding && p.binding.pass === false);
  const noServ  = contour.filter((p) => p?.saturated === 'no_service');
  const failingAzimuths = failing.map((p) => fmtDeg(p.azimuth_deg)).slice(0, 12);
  const noServAzimuths  = noServ.map((p) => fmtDeg(p.azimuth_deg)).slice(0, 12);
  const parts = [];
  if (failing.length){
    parts.push(`Failing azimuths (${failing.length}): ${failingAzimuths.join(', ')}${failing.length > 12 ? `, …(+${failing.length - 12})` : ''}.`);
  }
  if (noServ.length){
    parts.push(`No-service azimuths (${noServ.length}): ${noServAzimuths.join(', ')}${noServ.length > 12 ? `, …(+${noServ.length - 12})` : ''}.`);
  }
  parts.push(`See Appendix F-1 for the per-azimuth NIF radius and Appendix F-2 for the interferer pool that fed the RSS.`);
  return parts.join('  ');
}

function closingParagraph({ nif }){
  const engine = nif?.engine || nif?.source || 'fccam';
  const isBerry = engine === 'berry-1968-screening' || engine?.startsWith?.('berry');
  const engineLabel = isBerry
    ? 'Berry analytical model (47 CFR §73.190(c), SCREENING-grade)'
    : (nif.provenance?.upstream_skywave || 'FCCAM (Fccam.for / Wang 1985)');
  const determinismClaim = isBerry
    ? 'These NIF results are deterministic and replay-verifiable: re-computing the exhibit with the same station inputs produces identical NIF radii and margins.'
    : 'These NIF results are deterministic and replay-verifiable: re-computing the exhibit with the same station inputs against the same FCCAM source SHA produces identical NIF radii and margins.';
  const filingNote = isBerry
    ? '  SCREENING-grade per §73.190(c) — Re-run with FCCAM (Wang 1985) before filing.  The Berry analytical formula is permitted by §73.190(c) but under-estimates field strength compared to FCCAM Wang in most regimes.  Re-run with FCCAM before filing.'
    : '';
  return `${determinismClaim}  Skywave engine: ${engineLabel}.${filingNote}  Regulation: ${nif.regulation || '47 CFR §73.182 / §73.183 / §73.190(c)'}.`;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function bindingPair(contour){
  // The "binding" pair is the per-azimuth row with the smallest
  // (most negative or smallest positive) margin.  Tiebreak by
  // pass:false first, then by smallest margin_db.
  let best = null;
  for (const p of contour){
    if (!p?.binding) continue;
    if (!Number.isFinite(p.binding.margin_db)) continue;
    if (!best){ best = p; continue; }
    const a = best.binding.margin_db;
    const b = p.binding.margin_db;
    // Smaller margin = tighter constraint = "more binding".  Negative
    // < positive automatically.
    if (b < a) best = p;
  }
  return best;
}

function uniqueRelations(interferers){
  const set = new Set();
  for (const i of interferers){
    if (i?.relation) set.add(i.relation);
  }
  return [...set].map((r) => r.replace(/_/g, '-'));
}

function stationTag(s){
  const call = s.call || null;
  const fid  = s.facility_id || null;
  const freq = Number.isFinite(s.freq_khz) ? `${s.freq_khz} kHz`
             : Number.isFinite(s.frequency) ? `${s.frequency} kHz`
             : null;
  const bits = [call, fid ? `Facility ${fid}` : null, freq].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'subject station';
}

function fmtKm(v){
  if (!Number.isFinite(v)) return '—';
  return `${v.toFixed(1)} km`;
}

function fmtDeg(v){
  if (!Number.isFinite(v)) return '—';
  return `${v.toFixed(0)}°`;
}

function fmtMargin(v){
  if (!Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)} dB`;
}

export const AM_NIGHT_NARRATIVE_PROVENANCE = Object.freeze({
  module:        'src/exports/engineeringReport/sections/amNightNarrative.js',
  regulation:    '47 CFR §73.182 (engineering standards of allocation, AM nighttime)',
  modeled: [
    'Verdict-first opener composed from summary stats',
    'Methodology paragraph referencing §73.182(k) RSS, §73.150 pattern, §73.190(c) Wang',
    'Binding-constraint paragraph (azimuth, distance, D/U, contributing interferers)',
    'Failing-azimuth roll-up when applicable',
    'Replay-determinism closing'
  ],
  not_modeled: [
    'LLM-generated prose (deterministic templates only — keeps replay stable)',
    'Per-pair §73.215-style polygon-overlap commentary (separate showing module)'
  ],
  license_basis: '17 USC §105 (FCC rules + technical tables, US Government public domain)'
});
