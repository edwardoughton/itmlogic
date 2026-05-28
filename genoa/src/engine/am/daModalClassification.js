// AM antenna-mode classification per FCC notation.
//
// Real-world reference: Mullaney KELP 1989 — facility designated as
// "0.8/5.0 kW DA-2-U" on every page of the engineering statement.
// That single notation encodes four orthogonal facts:
//
//   DA / ND      — directional vs non-directional
//   -D / -N / -2 / -3 — modal mode (see below)
//   -U / -D / -N — hours of operation
//   first/second power — night / day kW
//
// FCC modal codes:
//   NDA / ND    — non-directional in all operating modes
//   DA-D        — directional daytime only (NDA at night)
//   DA-N        — directional nighttime only (NDA in day)
//   DA-2        — directional day AND night, DIFFERENT constants
//   DA-3        — directional day, critical hours, AND night with
//                 three different sets of parameters
//
// Hours-of-operation suffix:
//   -U  unlimited (day + night)
//   -D  daytime only (sunrise to sunset)
//   -N  nighttime only (Class C / similar; rare)
//
// Returns: { modal_code, hours_code, full_notation, rationale }
// All strings are FCC notation; full_notation = "DA-2-U" / "ND-D" /
// "NDA-U" / etc.  Result is INFORMATIONAL — does not modify the
// engine compute path.

export function classifyAmDaMode({ inputs = {} } = {}){
  const pattern_mode    = String(inputs.pattern_mode || 'ND').toUpperCase();
  const day_power_kw    = Number(inputs.erp_kw);
  const night_power_kw  = Number(inputs.night_power_kw);
  const day_only        = inputs.daytime_only === true || inputs.hours_of_operation === 'daytime_only';
  const night_only      = inputs.nighttime_only === true || inputs.hours_of_operation === 'nighttime_only';
  const has_night_pat   = Array.isArray(inputs.am_night_pattern_table)
                          && inputs.am_night_pattern_table.length > 0;
  const has_critical_pat = Array.isArray(inputs.am_critical_hours_pattern_table)
                          && inputs.am_critical_hours_pattern_table.length > 0;

  // Modal classification.
  let modal_code;
  const rationale_bits = [];

  if (pattern_mode === 'ND' || pattern_mode === 'NDA'){
    modal_code = 'NDA';
    rationale_bits.push('No directional pattern attached');
  } else if (pattern_mode === 'DA'){
    if (has_critical_pat){
      modal_code = 'DA-3';
      rationale_bits.push('Day, critical-hours, and night pattern tables all attached');
    } else if (has_night_pat){
      modal_code = 'DA-2';
      rationale_bits.push('Day and night pattern tables attached (different constants)');
    } else if (day_only){
      modal_code = 'DA-D';
      rationale_bits.push('Daytime-only operation; DA pattern applies in day only');
    } else if (night_only){
      modal_code = 'DA-N';
      rationale_bits.push('Nighttime-only operation; DA pattern applies at night only');
    } else if (Number.isFinite(night_power_kw) && night_power_kw > 0 && night_power_kw !== day_power_kw){
      // Day + night both authorized at DIFFERENT power but only one
      // pattern attached.  This is functionally a DA-2 even when the
      // night-mode pattern wasn't explicitly handed to Genoa — FCC
      // notation would still tag it DA-2.
      modal_code = 'DA-2';
      rationale_bits.push(`Day power ${day_power_kw} kW vs night power ${night_power_kw} kW; defaults to DA-2 (night pattern table not attached but the modal designation reflects the power split)`);
    } else {
      // Day-night same power, single pattern → "DA-1" in old notation,
      // collapses to plain DA-D under modern practice.
      modal_code = 'DA-D';
      rationale_bits.push('Single DA pattern, same parameters day and night (collapses to DA-D in modern FCC notation)');
    }
  } else {
    modal_code = pattern_mode || 'NDA';
    rationale_bits.push(`Unrecognized pattern_mode='${pattern_mode}' — surfaced verbatim`);
  }

  // Hours of operation.
  let hours_code;
  if (day_only)          { hours_code = 'D'; rationale_bits.push('Hours: daytime only'); }
  else if (night_only)   { hours_code = 'N'; rationale_bits.push('Hours: nighttime only'); }
  else                    { hours_code = 'U'; rationale_bits.push('Hours: unlimited (day + night)'); }

  // Compose the full notation.  Convention:
  //   DA-D / DA-N already encode hours-of-operation in the modal
  //   code (D = day-only, N = night-only) so the redundant -D / -N
  //   suffix is suppressed (produces 'DA-D' not 'DA-D-D').
  //   DA-2 / DA-3 / NDA carry the hours suffix because the modal
  //   code is hours-agnostic.
  const modal_already_encodes_hours = modal_code === 'DA-D' || modal_code === 'DA-N';
  const full_notation = modal_already_encodes_hours
    ? modal_code
    : `${modal_code}-${hours_code}`;

  // Power notation that mirrors Mullaney KELP's "0.8/5.0 kW DA-2-U"
  // format — night-power slash day-power when both are present and
  // differ, otherwise just the single power.
  let power_notation;
  if (Number.isFinite(night_power_kw) && night_power_kw > 0
      && Number.isFinite(day_power_kw) && day_power_kw > 0
      && Math.abs(night_power_kw - day_power_kw) > 1e-6){
    power_notation = `${night_power_kw}/${day_power_kw} kW`;
  } else if (Number.isFinite(day_power_kw)){
    power_notation = `${day_power_kw} kW`;
  } else {
    power_notation = '— kW';
  }

  return {
    modal_code,
    hours_code,
    full_notation,
    power_notation,
    composite: `${power_notation} ${full_notation}`,
    rationale: rationale_bits.join('; '),
    inputs_observed: {
      pattern_mode,
      day_power_kw:        Number.isFinite(day_power_kw) ? day_power_kw : null,
      night_power_kw:      Number.isFinite(night_power_kw) ? night_power_kw : null,
      day_only,
      night_only,
      has_night_pattern:   has_night_pat,
      has_critical_pattern: has_critical_pat
    }
  };
}
