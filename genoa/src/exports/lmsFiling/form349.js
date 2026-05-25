// 47 CFR Form 349 — FM Translator / FM Booster CP application
// (skeleton schema).
//
// Form 349 governs FX (FM translator) and FM booster filings under
// Subpart L of Part 74 (§§74.1201–74.1290).  Most of the FM
// engineering data is identical to Form 301-FM (frequency, ERP,
// HAAT, antenna pattern, coordinates) — but the compliance regime
// is different (translator-to-station / translator-to-translator
// rules, fill-in service area).
//
// This is a SKELETON.  Required fields are flagged so the readiness
// gate refuses to mark a translator filing ready until the engineer
// of record supplies the FX-specific values (originating primary
// station, fill-in justification, etc.).
//
// REFERENCES
//   FCC Form 349    https://www.fcc.gov/media/radio/fm-translators
//   47 CFR §74.1201 FM translator definitions
//   47 CFR §74.1233 application for FX construction permit
//   47 CFR §74.1235 power / antenna height
//   47 CFR §74.1204 protection of FM stations
//   47 CFR §74.1232 eligibility / ownership

function firstNonEmptyPath(exhibit, paths){
  for (const p of paths){
    const v = p.split('.').reduce((o, k) => (o == null ? o : o[k]), exhibit);
    if (v !== undefined && v !== null && !(typeof v === 'string' && !v.trim())){
      return v;
    }
  }
  return null;
}

export const FORM_349_FIELDS = Object.freeze([
  // ── 3A — General application data ──────────────────────────
  {
    id: 'application-purpose',
    lms_label: 'Purpose of application',
    section: 'III', subsection: '3A',
    type: 'enum',
    options: ['new-translator', 'major-modification', 'minor-modification', 'license-to-cover'],
    source: 'manual-applicant',
    required: true,
    cite: '47 CFR §74.1233',
    mapping: null
  },
  {
    id: 'station-call-sign',
    lms_label: 'Call sign (existing translator, if any)',
    section: 'III', subsection: '3A',
    type: 'string',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §74.1233',
    mapping: 'station_inputs.call'
  },
  {
    id: 'facility-id',
    lms_label: 'Facility ID number',
    section: 'III', subsection: '3A',
    type: 'string',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §74.1233',
    mapping: 'station_inputs.facility_id'
  },
  {
    id: 'community-of-license',
    lms_label: 'Community of license / principal community to be served',
    section: 'III', subsection: '3A',
    type: 'string',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §74.1201',
    mapping: 'station_inputs.community',
    derive: (exhibit) => firstNonEmptyPath(exhibit, [
      'station_inputs.community',
      'station_inputs.community_of_license',
      'station_inputs.city',
      'facility_metadata.community',
      'facility_metadata.city'
    ])
  },
  {
    id: 'service',
    lms_label: 'Service (FX = FM translator / FB = FM booster)',
    section: 'III', subsection: '3A',
    type: 'enum',
    options: ['FX', 'FB'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §74.1201',
    mapping: 'station_inputs.service'
  },
  {
    id: 'translator-class',
    lms_label: 'Translator class (fill-in / non-fill-in)',
    section: 'III', subsection: '3A',
    type: 'enum',
    options: ['fill-in', 'non-fill-in'],
    source: 'manual-engineer',
    required: true,
    cite: '47 CFR §74.1201(g), §74.1232',
    mapping: null,
    notes: 'Driven by relationship between translator service contour and primary station\'s protected contour; engineer of record determines per §74.1201(g).',
    engineer_confirmation_required: true
  },
  {
    id: 'primary-station-call',
    lms_label: 'Originating (primary) FM/HD2 station call sign',
    section: 'III', subsection: '3A',
    type: 'string',
    source: 'manual-engineer',
    required: true,
    cite: '47 CFR §74.1231, §74.1232',
    mapping: null,
    notes: 'Translator must rebroadcast a primary full-service station; identify it here.',
    engineer_confirmation_required: true
  },
  {
    id: 'primary-station-facility-id',
    lms_label: 'Primary station facility ID',
    section: 'III', subsection: '3A',
    type: 'string',
    source: 'manual-engineer',
    required: true,
    cite: '47 CFR §74.1231',
    mapping: null,
    engineer_confirmation_required: true
  },

  // ── 3B — Frequency / channel / power / height ──────────────
  {
    id: 'frequency-mhz',
    lms_label: 'Frequency (MHz)',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'MHz',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §74.1202',
    mapping: 'station_inputs.frequency'
  },
  {
    id: 'channel-number',
    lms_label: 'Channel number',
    section: 'III', subsection: '3B',
    type: 'number',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §74.1202',
    derive: (exhibit) => {
      const f = Number(exhibit?.station_inputs?.frequency);
      if (!Number.isFinite(f) || f < 88.1 || f > 107.9) return null;
      return Math.round((f - 88.1) / 0.2) + 201;
    }
  },
  {
    id: 'erp-kw',
    lms_label: 'ERP (kW) — translator authorized ERP per §74.1235',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'kW',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §74.1235',
    mapping: 'station_inputs.erp_kw',
    notes: 'Translator ERP capped per §74.1235: 250 W max for non-fill-in, higher with §74.1235(e) showing.'
  },
  {
    id: 'haat-m',
    lms_label: 'HAAT (m) — §74.1235(c) / §73.313 method',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'm',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §74.1235, §73.313',
    mapping: 'station_inputs.haat_m_input'
  },
  {
    id: 'rcamsl-m',
    lms_label: 'Radiation center AMSL (m)',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'm',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.313',
    mapping: 'evidence.terrain.rcamsl_m'
  },
  {
    id: 'antenna-pattern',
    lms_label: 'Antenna pattern (ND / DA)',
    section: 'III', subsection: '3B',
    type: 'enum',
    options: ['ND', 'DA'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §74.1235, §73.316',
    derive: (exhibit) => Array.isArray(exhibit?.station_inputs?.pattern) ? 'DA' : 'ND'
  },
  {
    id: 'antenna-pattern-table',
    lms_label: 'Antenna pattern table (azimuth × relative-field)',
    section: 'III', subsection: '3B',
    type: 'pattern_table',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §74.1235, §73.316',
    mapping: 'station_inputs.pattern'
  },
  {
    id: 'antenna-coordinates-nad83',
    lms_label: 'Antenna coordinates (NAD83 decimal degrees)',
    section: 'III', subsection: '3B',
    type: 'coords',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.208',
    derive: (exhibit) => {
      const lat = exhibit?.station_inputs?.lat;
      const lon = exhibit?.station_inputs?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon, datum: 'NAD83' };
    }
  },

  // ── 3C — §74.1204 protection / interference ────────────────
  {
    id: 'protection-pass',
    lms_label: '§74.1204 protection to full-service FM stations: pass/fail',
    section: 'III', subsection: '3C',
    type: 'enum',
    options: ['PASS', 'FAIL'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §74.1204',
    derive: (exhibit) => {
      const rc = exhibit?.regulatory_compliance;
      if (!rc) return null;
      return rc.pass === true ? 'PASS' : (rc.pass === false ? 'FAIL' : null);
    }
  },
  {
    id: 'fill-in-justification',
    lms_label: 'Fill-in translator service-area showing (§74.1201(g))',
    section: 'III', subsection: '3C',
    type: 'string',
    source: 'manual-engineer',
    required: false,
    cite: '47 CFR §74.1201(g)',
    mapping: null,
    notes: 'Required when translator-class = fill-in; demonstrates the translator 60 dBµV/m predicted service contour is located ENTIRELY WITHIN the primary station protected contour (60 dBu for a commercial FM primary; 2 mV/m for an AM primary under §74.1231(i); the analogous NCE protected contour for an NCE primary).  A translator whose service contour merely overlaps — but is not entirely within — is non-fill-in and falls under §74.1232 eligibility / coordination provisions.',
    engineer_confirmation_required: true
  },

  // ── 3D — RF safety ─────────────────────────────────────────
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

  // ── 3E — Tower (FAA / Part 17) ─────────────────────────────
  {
    id: 'asr-number',
    lms_label: 'ASR number',
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

  // ── 3F — Exhibits ──────────────────────────────────────────
  {
    id: 'engineering-statement-exhibit',
    lms_label: 'Engineering Statement (PDF, signed by PE)',
    section: 'III', subsection: '3F',
    type: 'file_reference',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §74.1233',
    derive: (exhibit) => {
      const call = String(exhibit?.station_inputs?.call || 'exhibit')
                     .replace(/[^A-Za-z0-9]/g, '_');
      const ts = new Date().toISOString().slice(0, 10);
      return `genoa-engineering-statement-${call}-${ts}.pdf  (download from Exports panel)`;
    }
  }
]);

export const FORM_349_META = Object.freeze({
  form_id:      '349',
  form_title:   'Application for Authority to Construct or Make Changes in an FM Translator or FM Booster Station',
  cite:         '47 CFR §74.1233',
  lms_revision: '2024-consolidated',
  fcc_url:      'https://www.fcc.gov/media/radio/broadcast-applications-and-forms',
  lms_portal_url: 'https://enterpriseefiling.fcc.gov/dataentry/login.html',
  lms_schedule:   'Schedule 349',
  lms_filing_path:
    'LMS → File New Application → Media Bureau (Audio) → FM Translator / Booster → ' +
    'Schedule 349 → Section III (Engineering Data)',
  lms_section:  'III (Engineering Data)',
  submission_checklist: Object.freeze([
    'Engineering Statement PDF signed by a qualified broadcast engineer',
    'Primary-station identification: call sign, facility ID, and §74.1232 eligibility statement (commercial primary vs. NCE primary)',
    '§74.1204 protection compliance: contour-overlap analysis vs. all co/1st/2nd/3rd-adjacent stations and Class D applications within the protected contour',
    'Fill-in vs. cross-service translator: justification per §74.1201(g) (fill-in: translator 60 dBµV/m service contour entirely within primary protected contour) and §74.1231 (eligibility and licensing requirements — see §74.1231(i) for AM-primary translator-area and protected-contour definitions); §74.1232 governs additional ownership/eligibility provisions',
    '§74.1235 frequency-coordination: confirm channel selection is consistent with §73.207 if co-channel-adjacent to a full-service FM',
    'OET-65 RF-exposure showing for the translator tx site',
    'Tower / antenna structure: ASR #, FAA Form 7460-1 determination, marking & lighting per FCC Part 17',
    'Filing fee verified — pay via Fee Filer in LMS before final submission',
    'Section I (Applicant), Section II (Legal) prepared by licensee / FCC counsel — NOT in this exhibit'
  ]),
  scope_note:   'SKELETON.  Genoa fills FM-translator engineering data inherited from the FM core (frequency, ERP, HAAT, antenna, OET-65) plus §74.1204 protection compliance.  Translator-specific fields (primary-station identification, fill-in justification, translator class) require engineer-of-record input.'
});
