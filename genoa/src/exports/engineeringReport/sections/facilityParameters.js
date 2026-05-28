// Facility parameters — inputs to the propagation study.

import { classifyAmDaMode } from '../../../engine/am/daModalClassification.js';

export function buildFacilityParametersSection(exhibit){
  const s = exhibit.station_inputs || {};
  const ev = exhibit.evidence || {};
  const fmt = (v, suffix = '', dash = '—') => {
    if (v === null || v === undefined || v === '') return dash;
    return suffix ? `${v} ${suffix}`.trim() : String(v);
  };
  const channel = s.service === 'AM'
    ? null
    : (Number.isFinite(Number(s.frequency)) ? Math.round((Number(s.frequency) - 87.9) / 0.2 + 200) : null);

  // HAAT fallback: when the operator didn't type a filed HAAT, fall
  // back to the per-radial DEM compute we just performed.  The engine
  // populates evidence.terrain_haat_per_radial with rows that carry
  // `haat_computed_m` (NOT `haat_m`) — the latter only appears on the
  // operator's typed value via station_inputs.haat_m.  Average of the
  // per-radial array (already conformant to §73.313(d)) is the correct
  // "average HAAT" for the parameters table.
  const perRadial = Array.isArray(ev.terrain_haat_per_radial) ? ev.terrain_haat_per_radial : null;
  const radialHaats = perRadial
    ? perRadial.map(r => Number(r?.haat_computed_m ?? r?.haat_m)).filter(Number.isFinite)
    : [];
  const haatAvgFromRadials = radialHaats.length
    ? radialHaats.reduce((a, h) => a + h, 0) / radialHaats.length
    : null;
  const haatDisplay = (s.haat_m != null && s.haat_m !== '')
    ? s.haat_m
    : (Number.isFinite(s.haat_m_input) ? s.haat_m_input
       : Number.isFinite(ev.terrain?.haat_m) ? ev.terrain.haat_m
       : Number.isFinite(haatAvgFromRadials) ? Number(haatAvgFromRadials.toFixed(1))
       : null);

  const lat_dms  = Number.isFinite(Number(s.lat)) ? toDms(Number(s.lat), 'lat') : null;
  const lon_dms  = Number.isFinite(Number(s.lon)) ? toDms(Number(s.lon), 'lon') : null;
  const coordRow = (Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lon)))
    ? `${Number(s.lat).toFixed(6)}, ${Number(s.lon).toFixed(6)}  (${lat_dms}, ${lon_dms})`
    : '—';

  // AM stations use ground conductivity (σ, mS/m), not HAAT — the
  // groundwave engine reads §73.184 Figure M3 curves keyed on σ.  FM/FX
  // stations use HAAT per §73.313.  Building one section that prints
  // both fields for both services would just be lying.
  const isAm = String(s.service || '').toUpperCase() === 'AM';
  const sigma = isAm
    ? (Number.isFinite(Number(s.ground_sigma_mS_m)) ? Number(s.ground_sigma_mS_m)
       : Number.isFinite(Number(s.ground_sigma_ms_m)) ? Number(s.ground_sigma_ms_m)
       : null)
    : null;
  const heightOrConductivity = isAm
    ? ['Ground conductivity (σ)',
       sigma != null ? `${sigma} mS/m (per 47 CFR §73.190 Figure M3)` : '—']
    : ['HAAT', fmt(haatDisplay, 'm')];
  const terrainRow = isAm
    ? ['Allocation basis',
       'Groundwave field strength per §73.184 / §73.183; no terrain elevation model required']
    : ['Terrain source',
       ev.terrain?.source || (ev.terrain_haat_per_radial?.length ? 'per-radial DEM' : 'flat HAAT (CONSTANT_HAAT_ASSUMED)')];

  // AM parameter vocabulary differs from FM/TV.  Per 47 CFR §73.183 /
  // §73.184 an AM allocation is described by transmitter power (TPO),
  // unattenuated RMS field at 1 km (inverse-distance reference field),
  // ground conductivity σ, and antenna mode (DA / NDA).  ERP and HAAT
  // are FM/TV terms and don't apply.  Field labels diverge accordingly.
  const tpoLabel = isAm ? 'Transmitter power (TPO)' : 'ERP';
  const tpoUnit  = 'kW';

  // Inverse-distance reference field — for non-DA AM the unattenuated
  // RMS field at 1 km, in mV/m.  When the operator entered a licensed
  // value (inputs.rms_field_1km) prefer that; otherwise omit (the
  // groundwave engine computes one from TPO + pattern but we don't
  // surface a derived number as if it were filed).
  const rmsField = isAm && (s.rms_field_1km != null && s.rms_field_1km !== '')
                   ? Number(s.rms_field_1km) : null;
  const rmsFieldRow = isAm && Number.isFinite(rmsField)
                      ? ['Inverse-distance field @ 1 km', `${rmsField} mV/m (filed / licensed value)`]
                      : null;

  // Pattern row — AM has explicit DA / NDA terminology; FM/TV just says
  // directional / non-directional.
  // AM antenna mode + FCC modal notation (DA-D / DA-N / DA-2 / DA-3
  // / NDA-U / etc.) per Mullaney KELP 1989 industry practice.
  // classifyAmDaMode derives the modal code from existing inputs
  // (pattern_mode, night_power_kw, daytime_only, attached pattern
  // tables) so no schema change is required for first-pass rendering.
  const amModal = isAm ? classifyAmDaMode({ inputs: s }) : null;
  const patternRow = isAm
    ? ['Antenna mode',
       amModal
         ? `${amModal.full_notation} (${amModal.composite})`
         : (s.pattern_mode === 'DA' ? 'DA (directional, per pattern_table)' : 'NDA (non-directional)')]
    : ['Antenna pattern', s.pattern_mode === 'DA' ? 'Directional (per pattern_table)' : 'Non-directional'];

  // License + public-file rows from the fcc_lms enrichment (per
  // compliance-officer F-003 / F-004).  Both surfaces are populated by
  // genoa/src/evidence/fccLmsClient.js and would otherwise stay hidden
  // from the rendered exhibit even when the upstream record was
  // fetched cleanly.  Either row is omitted when its value is absent.
  const lic     = exhibit.evidence?.fcc_lms?.license || {};
  const pubFile = exhibit.evidence?.fcc_lms?.public_file || {};
  const licExp  = lic.license_expiration_date || null;
  const expSuffix = lic.expiring_soon ? '  (expiring soon)'
                  : lic.expired       ? '  (EXPIRED — verify status)'
                  : '';
  const licenseExpRow = licExp
    ? ['License expiration (§73.1020)', `${licExp}${expSuffix}`]
    : null;
  const publicFileUrl = pubFile.folder_url || null;
  const publicFileRow = publicFileUrl
    ? ['Public inspection file (§73.3526 / §73.3527)', publicFileUrl]
    : null;

  return {
    id:      'parameters',
    type:    'kv',
    heading: 'FACILITY PARAMETERS',
    rows: [
      ['Frequency',           fmt(s.frequency, s.frequency_unit || (isAm ? 'kHz' : 'MHz'))],
      channel != null ? ['Channel', String(channel)] : null,
      [tpoLabel,              fmt(s.erp_kw, tpoUnit)],
      rmsFieldRow,
      heightOrConductivity,
      ['Coordinates (NAD83 / WGS-84)', coordRow],
      patternRow,
      ['Radial resolution',   fmt(s.radial_step_deg || 10, '° step')],
      terrainRow,
      licenseExpRow,
      publicFileRow,
      ['Facility source',     exhibit.facility_metadata?.source
                              || (exhibit.station_inputs?.facility_id ? 'operator-supplied facility_id' : 'inputs only')]
    ].filter(Boolean)
  };
}

function toDms(deg, kind){
  const sign = deg < 0 ? -1 : 1;
  const abs = Math.abs(deg);
  const d = Math.floor(abs);
  const minF = (abs - d) * 60;
  const m = Math.floor(minF);
  const s = (minF - m) * 60;
  const hemi = kind === 'lat' ? (sign < 0 ? 'S' : 'N') : (sign < 0 ? 'W' : 'E');
  return `${d}° ${m}' ${s.toFixed(2)}" ${hemi}`;
}
