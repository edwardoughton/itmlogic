// TXT exporter — engineering-style report.
// Sections: cover, inputs, method, contours, radials, terrain, evidence,
// warnings, version block, reproducibility statement.
//
// The TXT export is the human-readable snapshot of the exhibit; it MUST
// pin the engine version, schema version, curve dataset version + per-
// dataset sha256s so a reader can re-derive the same numbers later.

export function exportTxt(exhibit){
  const s   = exhibit.station_inputs   || {};
  const m   = exhibit.calculation_method || {};
  const ip  = exhibit.interpolation     || {};
  const sw  = exhibit.software_versions || {};
  const mv  = exhibit.method_versions   || {};
  const cd  = mv.curve_dataset          || {};
  const fr  = exhibit.filing_readiness  || {};
  const ws  = exhibit.warnings          || [];
  const polygons = exhibit.polygons     || [];
  const rt  = exhibit.radial_table      || [];
  const cdef = exhibit.contour_definitions || [];
  const ev  = exhibit.evidence || {};
  const pop = exhibit.population_estimate || {};

  const L = [];
  L.push('GENOA — FCC PROPAGATION EXHIBIT');
  L.push('================================');
  L.push(`Schema:           ${exhibit.schema?.name} v${exhibit.schema?.version}`);
  L.push(`Generated at:     ${exhibit.generated_at}`);
  L.push('');

  L.push('-- STATION INPUTS --');
  L.push(`Call sign:        ${s.call || '—'}`);
  L.push(`Facility ID:      ${s.facility_id || '—'}`);
  L.push(`Service / class:  ${s.service || '—'} ${s.fcc_class || ''}`);
  L.push(`Frequency:        ${num(s.frequency)} ${s.frequency_unit || ''}`);
  L.push(`ERP (h):          ${num(s.erp_kw)} kW`);
  L.push(`HAAT (input):     ${s.service === 'AM' ? 'n/a (AM)' : num(s.haat_m_input) + ' m'}`);
  L.push(`Coordinates:      ${num(s.lat,5)}, ${num(s.lon,5)}`);
  L.push(`Pattern:          ${Array.isArray(s.pattern) ? `directional (${s.pattern.length} pts)` : 'non-directional'}`);
  L.push(`Radial step:      ${s.radial_step_deg}°`);
  if (s.service === 'AM') L.push(`Ground σ:         ${num(s.ground_sigma_mS_m)} mS/m`);
  L.push('');

  L.push('-- CALCULATION METHOD --');
  L.push(`Method:           ${m.name || '—'}`);
  L.push(`Regulations:      ${(m.regulations || []).join(', ') || '—'}`);
  L.push(`Engine module:    ${m.engine_module || '—'}`);
  L.push(`Engine version:   ${m.engine_version || '—'}`);
  L.push(`Interp · field:   ${ip.along_field || '—'}`);
  L.push(`Interp · HAAT:    ${ip.along_haat  || '—'}`);
  L.push(`Curve src:        ${ip.source      || '—'}`);
  L.push('');

  L.push('-- CONTOUR RESULTS --');
  for (const p of polygons){
    const fs = p.field_strength || {};
    L.push(`  ${pad(p.label || p.contour_id, 36)} mean ${num(p.mean_radial_km, 2)} km · area ${num(p.area_km2, 0)} km²  (${fs.value ?? '—'} ${fs.unit ?? ''})`);
  }
  L.push('');

  L.push('-- RADIAL TABLE (truncated to first 32 rows; see JSON for full) --');
  const cols = ['az(°)', 'F·rel', 'haat(m)'].concat(cdef.map(c => c.id + '(km)'));
  L.push('  ' + cols.map(c => pad(c, 12)).join(''));
  rt.slice(0, 32).forEach(r => {
    const row = [
      pad(num(r.azimuth_deg, 1), 12),
      pad(num(r.relative_field, 3), 12),
      pad(num(r.haat_computed_m ?? r.haat_input_m, 0), 12),
      ...cdef.map(c => pad(num(r.contour_distances_km?.[c.id], 2), 12))
    ].join('');
    L.push('  ' + row);
  });
  if (rt.length > 32) L.push(`  ... ${rt.length - 32} more rows`);
  L.push('');

  L.push('-- POPULATION ESTIMATE --');
  if (pop.source){
    L.push(`Persons:          ~${(pop.primary || 0).toLocaleString()}`);
    if (pop.protected != null) L.push(`Protected:        ~${(pop.protected || 0).toLocaleString()}`);
    L.push(`Source:           ${pop.source}`);
    if (pop.dataset)  L.push(`Dataset:          ${pop.dataset}`);
    if (pop.vintage)  L.push(`Census vintage:   ${pop.vintage}`);
    if (pop.method)   L.push(`Method:           ${pop.method}`);
    if (pop.endpoint) L.push(`Endpoint:         ${pop.endpoint}`);
    if (pop.fetched_at) L.push(`Fetched at:       ${pop.fetched_at}`);
  } else {
    L.push(`Primary:          ~${(pop.primary || 0).toLocaleString()}  (${pop.model || '—'})`);
    L.push(`Protected:        ~${(pop.protected || 0).toLocaleString()}`);
    L.push(`** PLACEHOLDER — population sourced from model estimate only. **`);
    L.push(`** A Census/ACS dispatch is required for any filing-grade population claim. **`);
  }
  L.push('');

  L.push('-- EVIDENCE --');
  L.push(`Terrain:          ${ev.terrain?.available ? `attached (source ${ev.terrain.source || '—'})` : 'not attached'}`);
  L.push(`Measurements:     ${ev.measurements?.available
    ? `${ev.measurements.n_records ?? ev.measurements.records?.length ?? 0} record(s); calibrated=${!!ev.measurements.calibrated}`
    : 'none'}`);
  L.push(`Identity:         ${ev.identity?.available ? `attached, ${ev.identity.confirmations?.length || 0} confirmations` : 'none'}`);
  L.push('');

  L.push('-- WARNINGS --');
  if (!ws.length) L.push('  (none)');
  for (const w of ws){
    L.push(`  [${(w.severity || '').toUpperCase().padEnd(7)}] ${w.code} — ${w.title}`);
    if (w.detail) L.push(`             ${w.detail}`);
  }
  L.push('');

  L.push('-- FILING READINESS --');
  L.push(`Score:            ${fr.score ?? '—'}/100`);
  L.push(`Status:           ${fr.status || '—'}`);
  if (fr.blockers?.length){
    L.push('Blockers:');
    for (const b of fr.blockers) L.push(`  · ${b.code}  ${b.detail || b.description || ''}`);
  }
  if (fr.recommendations?.length){
    L.push('Recommendations:');
    for (const r of fr.recommendations) L.push(`  · ${r}`);
  }
  L.push('');

  L.push('-- VERSION BLOCK --');
  L.push(`Genoa engine:     ${sw.genoa_engine || '—'}`);
  L.push(`Schema:           ${sw.schema || '—'}`);
  L.push(`Node:             ${sw.node || '—'}`);
  L.push(`Curve dataset:    ${cd.curve_version || '—'}`);
  L.push(`Curve meta sha256:${cd.meta_sha256 || '—'}`);
  Object.entries(cd.dataset_sha256 || {}).forEach(([k, h]) => L.push(`  · ${pad(k, 18)} sha256 ${h}`));
  L.push('');

  L.push('-- REPRODUCIBILITY STATEMENT --');
  L.push('This exhibit is a deterministic function of (station inputs, terrain HAAT per radial,');
  L.push('curve dataset version, engine version). Re-running with the same inputs and the same');
  L.push('curve dataset version on a different machine MUST produce the same radial table.');
  L.push('');

  L.push('-- ENGINEERING CERTIFICATION PLACEHOLDER --');
  L.push('This exhibit was generated by Genoa FCC Propagation Studio. Deterministic FCC contour');
  L.push('calculations are intended for review and certification by a qualified broadcast engineer');
  L.push('prior to filing.');
  L.push('');
  L.push('Engineer of record:   ___________________________');
  L.push('License #:            ___________________________');
  L.push('Date:                 ___________________________');
  L.push('Signature:            ___________________________');
  L.push('');
  L.push('— End of exhibit —');

  return L.join('\n');
}

function num(v, d = 2){
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number(v).toFixed(d);
}
function pad(s, w){ s = String(s); return s.length >= w ? s : s + ' '.repeat(w - s.length); }

export const TXT_CONTENT_TYPE = 'text/plain';
