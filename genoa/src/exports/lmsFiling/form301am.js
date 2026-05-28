// 47 CFR Form 301-AM — declarative field schema for Section III
// (Engineering Data) of the FCC's "Application for Construction
// Permit for Commercial Broadcast Station" filed against the AM
// broadcast service.
//
// SCHEMA VERSION
//   This module encodes Form 301 (AM) as it appears in the FCC
//   Licensing & Management System (LMS) circa the 2024 revision
//   (last consolidated rulemaking that touched AM engineering
//   §73.183/.184/.187/.190 was the 2017 AM revitalization R&O,
//   updated for the 2023 §73.99 cross-reference cleanup).  When
//   the LMS form template revs we'll bump the META.lms_revision
//   string below — the field IDs are stable.
//
// SCOPE
//   AM physics is fundamentally different from FM: groundwave
//   (Sommerfeld–Norton over finite-conductivity earth, §73.183 /
//   §73.184) plus skywave (Berry model under §73.190 conditions of
//   atmosphere) — NOT free-space ERP into HAAT-driven F(50,50)
//   contours.  This schema therefore:
//
//     * uses "Power (kW)" (the §73.21 authorized antenna input
//       power) — NOT ERP
//     * omits HAAT entirely — AM contours scale with ground
//       conductivity / dielectric, not antenna height above
//       average terrain
//     * carries Class A/B/C/D (NOT FM A/B1/B/C0/C1/C2/C3) per
//       §73.21
//     * uses §73.182 / §73.183 / §73.184 / §73.187 / §73.190 /
//       §73.99 (PSRA/PSSA) / §73.37 (co-channel separations)
//       citations — NOT §73.207 / §73.215 / §73.313
//     * groundwave-language: "groundwave field at 1 km
//       (mV/m)", "principal community / city-grade contour",
//       "primary service contour", "0.5 mV/m and 0.1 mV/m
//       groundwave contours" — NOT "service / protected /
//       interfering contour"
//
// REFERENCES
//   FCC Form 301-AM             https://www.fcc.gov/media/radio/am-fm-distance-program
//   47 CFR §73.21               AM station classes (A, B, C, D)
//   47 CFR §73.37               AM co-channel / adjacent-channel separations
//   47 CFR §73.99               AM Presunrise (PSRA) / Postsunset (PSSA) service authorization
//   47 CFR §73.182              Engineering standards of allocation (NIF / RSS)
//   47 CFR §73.183              AM groundwave signals
//   47 CFR §73.184              AM groundwave field strength graphs
//   47 CFR §73.187              AM limitation on daytime radiation
//   47 CFR §73.190              AM engineering charts and related formulas

function firstNonEmptyPath(exhibit, paths){
  for (const p of paths){
    const v = p.split('.').reduce((o, k) => (o == null ? o : o[k]), exhibit);
    if (v !== undefined && v !== null && !(typeof v === 'string' && !v.trim())){
      return v;
    }
  }
  return null;
}

export const FORM_301_AM_FIELDS = Object.freeze([
  // ── 3A — General application data ───────────────────────
  {
    id: 'application-purpose',
    lms_label: 'Purpose of application',
    section: 'III', subsection: '3A',
    type: 'enum',
    options: ['new-station', 'major-modification', 'minor-modification', 'license-to-cover'],
    source: 'manual-applicant',
    required: true,
    cite: '47 CFR §73.3539',
    mapping: null,
    notes: 'Licensee filing intent; Genoa cannot infer.'
  },
  {
    id: 'station-call-sign',
    lms_label: 'Call sign (existing facility)',
    section: 'III', subsection: '3A',
    type: 'string',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §73.3539',
    mapping: 'station_inputs.call'
  },
  {
    id: 'facility-id',
    lms_label: 'Facility ID number',
    section: 'III', subsection: '3A',
    type: 'string',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.3539',
    mapping: 'station_inputs.facility_id'
  },
  {
    id: 'community-of-license',
    lms_label: 'Community of license',
    section: 'III', subsection: '3A',
    type: 'string',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.3539',
    mapping: 'station_inputs.community',
    derive: (exhibit) => firstNonEmptyPath(exhibit, [
      'station_inputs.community',
      'station_inputs.community_of_license',
      'station_inputs.city',
      'evidence.fcc_lms.license.community',
      'evidence.fcc_lms.license.community_of_license',
      'facility_metadata.community',
      'facility_metadata.community_of_license',
      'facility_metadata.city'
    ])
  },
  {
    id: 'service',
    lms_label: 'Service',
    section: 'III', subsection: '3A',
    type: 'enum',
    options: ['AM'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.21',
    mapping: 'station_inputs.service'
  },
  {
    id: 'am-class',
    lms_label: 'AM station class (A / B / C / D)',
    section: 'III', subsection: '3A',
    type: 'enum',
    options: ['A', 'B', 'C', 'D'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.21',
    mapping: 'station_inputs.fcc_class',
    notes: 'AM classes are A/B/C/D per §73.21 — these are NOT the FM A/B1/B/C0/C1/C2/C3 classes.',
    derive: (exhibit) => firstNonEmptyPath(exhibit, [
      'station_inputs.fcc_class',
      'station_inputs.am_class',
      'station_inputs.class',
      'station_inputs.station_class',
      'evidence.fcc_lms.license.fcc_class',
      'evidence.fcc_lms.license.am_class',
      'evidence.fcc_lms.license.station_class',
      'facility_metadata.fcc_class',
      'facility_metadata.am_class',
      'facility_metadata.station_class'
    ])
  },

  // ── 3B — Frequency / power / pattern ──────────────────────────
  {
    id: 'frequency-khz',
    lms_label: 'Operating frequency (kHz)',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'kHz',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.21',
    derive: (exhibit) => {
      // Accept input either in kHz directly or in MHz (legacy
      // FM-shaped exhibit).  AM band is 535–1705 kHz so any
      // input < 2 we interpret as MHz and convert.
      const v = exhibit?.station_inputs?.frequency_khz
              ?? exhibit?.station_inputs?.frequency;
      if (v == null) return null;
      const n = Number(v);
      if (!Number.isFinite(n)) return null;
      return n < 2 ? Math.round(n * 1000) : n;
    }
  },
  {
    id: 'power-day-kw',
    lms_label: 'Authorized antenna input power — daytime (kW)',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'kW',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.21, §73.51',
    // AM filings carry "power" (antenna input power), not ERP.
    derive: (exhibit) => firstNonEmptyPath(exhibit, [
      'station_inputs.power_day_kw',
      'station_inputs.day_power_kw',
      'station_inputs.power_kw_day',
      'station_inputs.power_kw',
      'station_inputs.erp_kw'  // legacy FM-shaped exhibits
    ])
  },
  {
    id: 'power-night-kw',
    lms_label: 'Authorized antenna input power — nighttime (kW)',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'kW',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §73.21, §73.182, §73.187',
    notes: 'Required for Class A/B/D when night service authorized; Class C unique-permission day-only stations leave blank.',
    derive: (exhibit) => firstNonEmptyPath(exhibit, [
      'station_inputs.power_night_kw',
      'station_inputs.night_power_kw',
      'station_inputs.power_kw_night'
    ])
  },
  {
    id: 'antenna-pattern',
    lms_label: 'Antenna pattern (ND / DA-D / DA-N / DA-2)',
    section: 'III', subsection: '3B',
    type: 'enum',
    options: ['ND', 'DA-D', 'DA-N', 'DA-2'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.150',
    derive: (exhibit) => {
      const s = exhibit?.station_inputs || {};
      if (s.am_pattern) return s.am_pattern;
      const hasDay   = Array.isArray(s.pattern_day)   && s.pattern_day.length > 0;
      const hasNight = Array.isArray(s.pattern_night) && s.pattern_night.length > 0;
      const hasAny   = Array.isArray(s.pattern)       && s.pattern.length > 0;
      if (hasDay && hasNight) return 'DA-2';
      if (hasDay)             return 'DA-D';
      if (hasNight)           return 'DA-N';
      if (hasAny)             return 'DA-D';
      return 'ND';
    }
  },
  {
    id: 'antenna-pattern-table-day',
    lms_label: 'Antenna pattern table — daytime (azimuth × theoretical pattern, rms)',
    section: 'III', subsection: '3B',
    type: 'pattern_table',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §73.150, §73.152',
    mapping: 'station_inputs.pattern_day',
    notes: 'Required only when daytime pattern is DA-D or DA-2.'
  },
  {
    id: 'antenna-pattern-table-night',
    lms_label: 'Antenna pattern table — nighttime (azimuth × theoretical pattern, rms)',
    section: 'III', subsection: '3B',
    type: 'pattern_table',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §73.150, §73.152, §73.182',
    mapping: 'station_inputs.pattern_night',
    notes: 'Required only when nighttime pattern is DA-N or DA-2.'
  },
  {
    id: 'rms-groundwave-field-1km',
    lms_label: 'Theoretical rms groundwave field at 1 km (mV/m)',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'mV/m at 1 km',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.183, §73.184, §73.189',
    notes: 'AM filings report groundwave field strength at 1 km — NOT ERP.  Computed from antenna efficiency and pattern rms per §73.189.',
    derive: (exhibit) => firstNonEmptyPath(exhibit, [
      'station_inputs.rms_field_mv_m',
      'station_inputs.rms_groundwave_mv_m_at_1km',
      'evidence.am_physics.outputs.rms_field_mv_m_at_1km'
    ])
  },
  {
    id: 'antenna-coordinates-nad83',
    lms_label: 'Antenna coordinates (NAD83 decimal degrees)',
    section: 'III', subsection: '3B',
    type: 'coords',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.99, §73.158',
    derive: (exhibit) => {
      const lat = exhibit?.station_inputs?.lat;
      const lon = exhibit?.station_inputs?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon, datum: 'NAD83' };
    }
  },
  {
    id: 'tower-count',
    lms_label: 'Number of towers in the antenna system',
    section: 'III', subsection: '3B',
    type: 'number',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.150',
    derive: (exhibit) => firstNonEmptyPath(exhibit, [
      'station_inputs.tower_count',
      'station_inputs.n_towers'
    ])
  },
  {
    id: 'tower-electrical-height',
    lms_label: 'Tower electrical height (degrees, λ-electrical)',
    section: 'III', subsection: '3B',
    type: 'string',
    source: 'manual-engineer',
    required: false,
    cite: '47 CFR §73.190',
    mapping: null,
    notes: 'Per-tower electrical height in degrees of operating wavelength.  Required for DA arrays (§73.150) and §73.190 antenna parameters.'
  },
  {
    id: 'ground-system-radials',
    lms_label: 'Ground system — buried radial count and length',
    section: 'III', subsection: '3B',
    type: 'string',
    source: 'manual-engineer',
    required: true,
    cite: '47 CFR §73.189',
    mapping: null,
    notes: 'Number and physical length of buried-copper radials per tower (typically 120 radials × 0.25λ for full ground system).'
  },

  // ── 3C — §73.182 / §73.187 protection (AM allocation) ────────
  {
    id: 'compliance-rule-path',
    lms_label: 'AM compliance basis (§73.182 daytime / §73.182 nighttime / §73.187)',
    section: 'III', subsection: '3C',
    type: 'enum',
    options: ['§73.182-daytime', '§73.182-nighttime', '§73.187', '§73.182-and-§73.187'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.182, §73.187',
    derive: (exhibit) => {
      const rc = exhibit?.regulatory_compliance;
      const nif = exhibit?.evidence?.am_night_nif;
      if (!rc && !nif) return null;
      const hasNight = nif && nif.available;
      const cite = rc?.cite || '';
      if (hasNight && /73\.187/.test(cite)) return '§73.182-and-§73.187';
      if (hasNight)                         return '§73.182-nighttime';
      if (/73\.187/.test(cite))             return '§73.187';
      if (/73\.182/.test(cite))             return '§73.182-daytime';
      return null;
    }
  },
  {
    id: 'compliance-pass',
    lms_label: 'AM engineering compliance pass/fail',
    section: 'III', subsection: '3C',
    type: 'enum',
    options: ['PASS', 'FAIL', 'NIGHT-NIF-FAIL'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.182',
    derive: (exhibit) => {
      const rc  = exhibit?.regulatory_compliance;
      const nif = exhibit?.evidence?.am_night_nif;
      if (nif && nif.available){
        const nFail = Number(nif.summary?.n_failing_azimuths) || 0;
        const worst = Number(nif.summary?.worst_margin_db);
        if (nFail > 0 || (Number.isFinite(worst) && worst < 0)) return 'NIGHT-NIF-FAIL';
      }
      if (!rc) return null;
      if (rc.pass === true)  return 'PASS';
      if (rc.pass === false) return 'FAIL';
      return null;
    }
  },
  {
    id: 'principal-community-contour-mv-m',
    lms_label: 'Principal community (city-grade) contour — 5 mV/m groundwave (all AM classes, §73.24(i))',
    section: 'III', subsection: '3C',
    type: 'number', unit: 'mV/m',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.24, §73.184',
    notes: 'AM principal community contour is a field-strength value (mV/m), NOT a distance.  Per §73.24, all AM classes use the 5 mV/m groundwave contour to define city-grade service over the community of license.',
    derive: (exhibit) => firstNonEmptyPath(exhibit, [
      'station_inputs.principal_community_contour_mv_m'
    ]) ?? 5.0
  },
  {
    id: 'primary-service-contour-mv-m',
    lms_label: 'Primary service contour — 0.5 mV/m groundwave (B/C/D) / 0.1 mV/m (Class A)',
    section: 'III', subsection: '3C',
    type: 'number', unit: 'mV/m',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.182, §73.184',
    derive: (exhibit) => {
      const cls = firstNonEmptyPath(exhibit, ['station_inputs.fcc_class','station_inputs.am_class']);
      const explicit = firstNonEmptyPath(exhibit, ['station_inputs.primary_service_contour_mv_m']);
      if (explicit != null) return explicit;
      if (String(cls).toUpperCase() === 'A') return 0.1;
      return 0.5;
    }
  },
  {
    id: 'secondary-service-contour-mv-m',
    lms_label: 'Secondary service contour — 0.5 mV/m skywave 50% (Class A only)',
    section: 'III', subsection: '3C',
    type: 'number', unit: 'mV/m',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §73.182, §73.190',
    notes: 'Defined only for Class A clear-channel stations; §73.182(c).',
    derive: (exhibit) => {
      const cls = firstNonEmptyPath(exhibit, ['station_inputs.fcc_class','station_inputs.am_class']);
      if (String(cls).toUpperCase() !== 'A') return null;
      return firstNonEmptyPath(exhibit, ['station_inputs.secondary_service_contour_mv_m']) ?? 0.5;
    }
  },
  {
    id: 'nighttime-interference-free-contour-mv-m',
    lms_label: 'Nighttime interference-free (NIF) limit — RSS @ 50% exclusion (mV/m)',
    section: 'III', subsection: '3C',
    type: 'number', unit: 'mV/m',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §73.182(k)',
    derive: (exhibit) => exhibit?.evidence?.am_night_nif?.summary?.rss_50_mv_m ?? null
  },
  {
    id: 'nighttime-nif-worst-margin-db',
    lms_label: 'NIF worst-azimuth margin (dB)',
    section: 'III', subsection: '3C',
    type: 'number', unit: 'dB',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §73.182',
    mapping: 'evidence.am_night_nif.summary.worst_margin_db'
  },
  {
    id: 'ground-conductivity-zone',
    lms_label: 'Ground conductivity — §73.190 M3 conductivity zone(s)',
    section: 'III', subsection: '3C',
    type: 'string',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.190 Fig. M3, §73.184',
    notes: 'Per §73.190, AM groundwave field strength depends on ground conductivity from the M3 conductivity map.  AM has NO HAAT.',
    derive: (exhibit) => firstNonEmptyPath(exhibit, [
      'station_inputs.m3_conductivity_zone',
      'evidence.am_physics.inputs.m3_zone',
      'evidence.am_physics.outputs.conductivity_summary'
    ])
  },

  // ── 3D — RF safety (OET-65) ────────────────────────────────
  {
    id: 'oet-65-boundary-pass',
    lms_label: 'OET-65 §1.1310 RF exposure boundary check pass',
    section: 'III', subsection: '3D',
    type: 'enum',
    options: ['PASS', 'FAIL', 'NEAR-FIELD-REQUIRED', 'SKIPPED'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §1.1310, OET-65',
    derive: (exhibit) => {
      const oet = exhibit?.oet65;
      if (!oet || oet.pass == null) return 'SKIPPED';
      if (oet.near_field?.required_for_filing) return 'NEAR-FIELD-REQUIRED';
      if (oet.compliance?.boundary_check?.pass === true)  return 'PASS';
      if (oet.compliance?.boundary_check?.pass === false) return 'FAIL';
      return 'SKIPPED';
    }
  },
  {
    id: 'oet-65-near-field-required',
    lms_label: 'Near-field analysis required (AM towers radiate at human-occupied distances)',
    section: 'III', subsection: '3D',
    type: 'enum',
    options: ['YES', 'NO'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §1.1310, OET-65 §IV.B',
    notes: 'AM stations typically require near-field analysis around the tower base because of finite-source / induction-field effects; far-field OET-65 distance is not the full story.',
    derive: (exhibit) => exhibit?.oet65?.near_field?.required_for_filing ? 'YES' : 'NO'
  },

  // ── 3E — Tower / structure (FAA / Part 17) ────────────────────
  {
    id: 'asr-number',
    lms_label: 'Antenna structure registration (ASR) number',
    section: 'III', subsection: '3E',
    type: 'string',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §17.4',
    derive: (exhibit) => firstNonEmptyPath(exhibit, [
      'station_inputs.asr_number',
      'evidence.asr.asr_number'
    ])
  },
  {
    id: 'tower-overall-height-agl-m',
    lms_label: 'Overall tower height AGL (m)',
    section: 'III', subsection: '3E',
    type: 'number', unit: 'm',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §17',
    derive: (exhibit) => firstNonEmptyPath(exhibit, [
      'station_inputs.overall_height_m',
      'evidence.asr.overall_height_m',
      'tower_compliance.height_agl_m'
    ])
  },
  {
    id: 'faa-determination',
    lms_label: 'FAA determination (No Hazard / Conditioned / N/A)',
    section: 'III', subsection: '3E',
    type: 'enum',
    options: ['NO-HAZARD', 'CONDITIONED', 'NOT-REQUIRED'],
    source: 'genoa-auto',
    required: true,
    cite: '14 CFR Part 77; 47 CFR §17.7',
    derive: (exhibit) => {
      const faa = exhibit?.evidence?.faa_oe;
      if (faa?.available && faa.determination){
        const d = String(faa.determination).toUpperCase();
        if (/DNH|NO\s*HAZARD/.test(d)) return 'NO-HAZARD';
        if (/CONDITION/.test(d))       return 'CONDITIONED';
        if (/HAZARD/.test(d))          return 'HAZARD';
        return d;
      }
      const cmpl = exhibit?.tower_compliance;
      if (cmpl?.applicable && cmpl.notification_required === false) return 'NOT-REQUIRED';
      return null;
    }
  },
  {
    id: 'tower-painting',
    lms_label: 'Tower painting / marking specification',
    section: 'III', subsection: '3E',
    type: 'string',
    source: 'manual-engineer',
    required: false,
    cite: '47 CFR §17.21, AC 70/7460-1L',
    mapping: null,
    engineer_confirmation_required: true
  },
  {
    id: 'tower-lighting',
    lms_label: 'Tower obstruction lighting style',
    section: 'III', subsection: '3E',
    type: 'string',
    source: 'manual-engineer',
    required: false,
    cite: '47 CFR §17.23, AC 70/7460-1L',
    mapping: null,
    engineer_confirmation_required: true
  },

  // ── 3F — Reference exhibits attached to LMS ──────────────────
  {
    id: 'engineering-statement-exhibit',
    lms_label: 'Engineering Statement (PDF, signed by PE)',
    section: 'III', subsection: '3F',
    type: 'file_reference',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.3539',
    derive: (exhibit) => {
      const call = String(exhibit?.station_inputs?.call || 'exhibit')
                     .replace(/[^A-Za-z0-9]/g, '_');
      const ts = new Date().toISOString().slice(0, 10);
      return `genoa-engineering-statement-${call}-${ts}.pdf  (download from Exports panel)`;
    }
  },
  {
    id: 'groundwave-contour-exhibit',
    lms_label: 'Groundwave contour map — 5 mV/m, 0.5 mV/m, 0.1 mV/m (PDF)',
    section: 'III', subsection: '3F',
    type: 'file_reference',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.183, §73.184',
    notes: 'AM contour map shows groundwave field strength contours from §73.183 / §73.184 curves applied with §73.190 M3 conductivity — NOT FM 60/54/40 dBu contours.',
    derive: (exhibit) => {
      const call = String(exhibit?.station_inputs?.call || 'exhibit')
                     .replace(/[^A-Za-z0-9]/g, '_');
      return `embedded in Engineering Statement PDF · ${call} AM groundwave contour map`;
    }
  },
  {
    id: 'nighttime-nif-exhibit',
    lms_label: 'Nighttime allocation study (§73.182 NIF / RSS)',
    section: 'III', subsection: '3F',
    type: 'file_reference',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §73.182, §73.190',
    derive: (exhibit) => {
      const nif = exhibit?.evidence?.am_night_nif;
      if (!nif || !nif.available) return 'not applicable (daytime-only filing OR night allocation not exercised)';
      const call = String(exhibit?.station_inputs?.call || 'exhibit')
                     .replace(/[^A-Za-z0-9]/g, '_');
      return `embedded in Engineering Statement PDF · ${call} §73.182 NIF / RSS appendix`;
    }
  },
  {
    id: 'oet-65-statement-exhibit',
    lms_label: 'RF exposure (OET-65) compliance statement',
    section: 'III', subsection: '3F',
    type: 'file_reference',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §1.1307, §1.1310',
    derive: (exhibit) => {
      const call = String(exhibit?.station_inputs?.call || 'exhibit')
                     .replace(/[^A-Za-z0-9]/g, '_');
      return `embedded in Engineering Statement PDF · ${call} AM near-field RF exposure section`;
    }
  }
]);

export const FORM_301_AM_META = Object.freeze({
  form_id:      '301-AM',
  form_title:   'Application for Construction Permit for Commercial Broadcast Station — AM',
  cite:         '47 CFR §73.3539, §73.3540',
  lms_revision: '2024-consolidated (post-2017-AM-revitalization, post-2023 §73.99 cleanup)',
  fcc_url:      'https://www.fcc.gov/media/radio/broadcast-applications-and-forms',
  lms_portal_url: 'https://enterpriseefiling.fcc.gov/dataentry/login.html',
  lms_schedule:   'Schedule 301-AM',
  lms_filing_path:
    'LMS → File New Application → Media Bureau (Audio) → Construction Permit ' +
    'or Modification → Service: AM → Schedule 301-AM → Section III (Engineering Data)',
  lms_section:  'III (Engineering Data)',
  submission_checklist: Object.freeze([
    'Engineering Statement PDF signed by a qualified broadcast engineer; AM-specific narrative (skywave + groundwave + ground system) included',
    'PE signature / seal on the certification page',
    'Method-of-Moments (MoM) proof attached if directional and §73.151(c) is invoked; sample-system schematic + reference field per §73.152',
    'Ground system description per §73.189 (120 buried 90° radials minimum for non-directional, or as filed for directional)',
    '§73.182 nighttime interference / RSS aggregation: nighttime NIF contour computed; protected stations listed',
    '§73.99 pre-sunrise (PSRA) / post-sunset (PSSA) service-authorization tables included if PSRA/PSSA requested',
    'OET-65 RF-exposure exhibit attached (AM tower base-current → near-field MPE check at fence line)',
    'Tower lighting / marking per FCC Part 17; FAA 7460-1 determination on file',
    'Filing fee verified — pay via Fee Filer in LMS before final submission',
    'Section I (Applicant), Section II (Legal), and Section IV (Ownership) prepared by licensee / FCC counsel — NOT in this exhibit'
  ]),
  scope_note:   'Genoa fills Section III (AM engineering): groundwave (§73.183/.184), nighttime allocation (§73.182), and tower / RF safety.  Sections I (applicant), II (legal), IV (ownership) are out of scope.'
});
