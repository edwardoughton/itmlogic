// Service wording — per-service terminology used in narrative prose so
// reports speak the language of the rule the engine actually evaluated.
//
// AM/FM/LPFM/FX/TV each have distinct vocabularies in the FCC rules:
//
//   AM    — "power", "groundwave field strength", "§73.184", "§73.182",
//           "groundwave conductivity" (47 CFR Part 73 Subpart A).
//   FM    — "ERP", "predicted contour", "§73.313", "§73.215" (Subpart B).
//   LPFM  — "ERP", "service contour", "§73.811", "§73.807" (Subpart G).
//   FX    — "FM translator", "§74.1204", "§74.1235" (Part 74).
//   TV    — "ERP", "F(50,90) / F(50,10) contour", "§73.616 / §73.626".
//
// In addition to the per-service vocabulary, this module enforces
// project-wide rewordings that replace internal engineering jargon with
// terminology suitable for an audited engineering report:
//
//   "tier-3 fallback"     → "engineering reference fallback"
//   "engine-self"         → "computational pipeline"
//   "orchestrator"        → "computational pipeline"
//   "stale exhibit"       → "previously cached"
//   "screening-grade"     → "advisory screening engine"

const SERVICE_VOCABULARIES = Object.freeze({
  AM: Object.freeze({
    service_label:        'AM',
    erp_term:             'power',
    erp_units:            'kW',
    coverage_term:        'groundwave field strength contour',
    contour_metric:       'mV/m groundwave field strength',
    propagation_cite:     '§73.184',
    coverage_rule_cite:   '§73.184',
    allocation_rule_cite: '§73.182',
    // AM has two distinct interference-protection regimes — daytime
    // (Class B / D radiation limits under §73.187 + groundwave overlap
    // under §73.182/§73.185) and nighttime (§73.182(k) NIF + §73.190
    // SS-1 skywave RSS).  PRF-008 identified that the day-agnostic
    // COMPLIANT_VIA_ALT_RULE narrative previously cited only the
    // nighttime rule for both day and night AM exhibits.  The
    // generic interference_cite now names both regimes so the
    // narrative is correct under either; downstream callers that need
    // a specific regime should read daytime_interference_cite /
    // nighttime_interference_cite directly.
    interference_cite:           '§73.182 / §73.187 (daytime) and §73.182(k) / §73.190 (nighttime)',
    daytime_interference_cite:   '§73.187',
    nighttime_interference_cite: '§73.182(k)',
    skywave_cite:                '§73.190(c)',
    daytime_cite:                '§73.182(a)',
    nighttime_cite:              '§73.182(k)',
    fcc_cite_root:        '47 CFR Part 73 Subpart A',
    coverage_phrase:      'groundwave field strength',
    pattern_phrase:       'directional antenna pattern',
    waiver_options:       'DA pattern redesign, reduced power, daytime-only mode, or PSRA/PSSA reduced-power authority'
  }),
  FM: Object.freeze({
    service_label:        'FM',
    erp_term:             'ERP',
    erp_units:            'kW',
    coverage_term:        'predicted service contour',
    contour_metric:       'dBµV/m field strength',
    propagation_cite:     '§73.313',
    coverage_rule_cite:   '§73.313',
    allocation_rule_cite: '§73.207',
    interference_cite:    '§73.215',
    skywave_cite:         null,
    fcc_cite_root:        '47 CFR Part 73 Subpart B',
    coverage_phrase:      'predicted F(50,50) contour',
    pattern_phrase:       'directional antenna pattern',
    waiver_options:       'antenna redesign, reduced ERP, or §73.215 contour-protection alternative'
  }),
  LPFM: Object.freeze({
    service_label:        'LPFM',
    erp_term:             'ERP',
    erp_units:            'W',
    coverage_term:        'service contour',
    contour_metric:       'dBµV/m field strength',
    propagation_cite:     '§73.333',
    coverage_rule_cite:   '§73.313',
    allocation_rule_cite: '§73.807',
    interference_cite:    '§73.809',
    erp_ceiling_cite:     '§73.811',
    skywave_cite:         null,
    fcc_cite_root:        '47 CFR Part 73 Subpart G',
    coverage_phrase:      'predicted 60 dBµV/m service contour',
    pattern_phrase:       'antenna pattern',
    waiver_options:       'reduced ERP or relocation'
  }),
  FX: Object.freeze({
    service_label:        'FM translator',
    erp_term:             'ERP',
    erp_units:            'W',
    coverage_term:        'service contour',
    contour_metric:       'dBµV/m field strength',
    propagation_cite:     '§74.1235',
    coverage_rule_cite:   '§74.1235',
    allocation_rule_cite: '§74.1204',
    interference_cite:    '§74.1204',
    skywave_cite:         null,
    fcc_cite_root:        '47 CFR Part 74 Subpart L',
    coverage_phrase:      'predicted 60 dBµV/m service contour',
    pattern_phrase:       'directional antenna pattern',
    waiver_options:       'reduced ERP, relocation, or directional antenna pattern'
  }),
  TV: Object.freeze({
    service_label:        'TV',
    erp_term:             'ERP',
    erp_units:            'kW',
    coverage_term:        'predicted service contour',
    contour_metric:       'dBµV/m F(50,90) field strength',
    propagation_cite:     '§73.625',
    coverage_rule_cite:   '§73.625',
    allocation_rule_cite: '§73.616',
    interference_cite:    '§73.616',
    skywave_cite:         null,
    fcc_cite_root:        '47 CFR Part 73 Subpart E',
    coverage_phrase:      'predicted F(50,90) noise-limited service contour',
    pattern_phrase:       'directional antenna pattern',
    waiver_options:       'antenna redesign, reduced ERP, or directional antenna pattern'
  })
});

const SERVICE_ALIASES = Object.freeze({
  'AM':       'AM',
  'FM':       'FM',
  'LPFM':     'LPFM',
  'LP':       'LPFM',
  'FX':       'FX',
  'FT':       'FX',
  'TRANS':    'FX',
  'TRANSLATOR': 'FX',
  'FM_TRANSLATOR': 'FX',
  'TV':       'TV',
  'DTV':      'TV',
  'DT':       'TV'
});

/**
 * Return the vocabulary block for a service.  Falls back to FM if the
 * caller passes something unrecognised (FM is the most generic full-
 * service broadcast vocabulary in the engine and the default the older
 * codepaths assume).
 */
export function wordingFor(service){
  const key  = String(service || '').toUpperCase();
  const norm = SERVICE_ALIASES[key] || key;
  return SERVICE_VOCABULARIES[norm] || SERVICE_VOCABULARIES.FM;
}

/**
 * Project-wide rewording table.  Replace internal jargon with audit-
 * friendly terminology before a string reaches a PDF or TXT renderer.
 */
const REWORDINGS = Object.freeze([
  [/tier[\s-]?3 fallback/gi,        'engineering reference fallback'],
  [/tier[\s-]?2 fallback/gi,        'engineering reference fallback'],
  [/engine[\s-]?self/gi,            'computational pipeline'],
  [/orchestrator/gi,                'computational pipeline'],
  [/stale exhibit/gi,               'previously cached'],
  [/screening[\s-]?grade/gi,        'advisory screening engine']
]);

/**
 * Apply the project-wide rewordings to a piece of free-form text.
 * Idempotent — applying twice yields the same result.
 */
export function rewordForReport(text){
  if (typeof text !== 'string' || text.length === 0) return text;
  let out = text;
  for (const [pat, rep] of REWORDINGS){
    out = out.replace(pat, rep);
  }
  return out;
}

/**
 * Convenience accessor: return the canonical normalised service code
 * (one of 'AM' | 'FM' | 'LPFM' | 'FX' | 'TV') for an arbitrary input.
 */
export function normalizeService(service){
  const key  = String(service || '').toUpperCase();
  return SERVICE_ALIASES[key] || (SERVICE_VOCABULARIES[key] ? key : 'FM');
}

/** Exported for tests / inspection. */
export const __SERVICE_VOCABULARIES = SERVICE_VOCABULARIES;
