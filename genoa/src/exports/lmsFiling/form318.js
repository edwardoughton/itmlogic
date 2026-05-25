// 47 CFR Form 318 — Low Power FM (LPFM) construction permit
// application (skeleton schema).
//
// Form 318 governs LPFM filings under Subpart G of Part 73
// (§§73.801–73.872) — non-commercial, max 100 W ERP, max 30 m
// HAAT.  Most of the FM engineering data has direct analogues but
// the rules are different (LPFM-specific minimum-distance
// separations per §73.807, no §73.215 path).
//
// This is a SKELETON.  Engineer-of-record inputs are flagged so the
// readiness gate refuses to mark an LPFM filing ready until LPFM-
// specific values are supplied.
//
// REFERENCES
//   FCC Form 318    https://www.fcc.gov/media/radio/lpfm
//   47 CFR §73.801  LPFM cross-reference table
//   47 CFR §73.807  LPFM minimum-distance separations
//   47 CFR §73.811  LPFM power and antenna height
//   47 CFR §73.816  LPFM antennas
//   47 CFR §73.825  LPFM blanketing interference
//   47 CFR §73.853  LPFM eligibility / ownership

function firstNonEmptyPath(exhibit, paths){
  for (const p of paths){
    const v = p.split('.').reduce((o, k) => (o == null ? o : o[k]), exhibit);
    if (v !== undefined && v !== null && !(typeof v === 'string' && !v.trim())){
      return v;
    }
  }
  return null;
}

export const FORM_318_FIELDS = Object.freeze([
  // ── 3A — General application data ──────────────────────────
  {
    id: 'application-purpose',
    lms_label: 'Purpose of application',
    section: 'III', subsection: '3A',
    type: 'enum',
    options: ['new-lpfm', 'major-modification', 'minor-modification', 'license-to-cover'],
    source: 'manual-applicant',
    required: true,
    cite: '47 CFR §73.870',
    mapping: null
  },
  {
    id: 'station-call-sign',
    lms_label: 'Call sign (existing LPFM, if any)',
    section: 'III', subsection: '3A',
    type: 'string',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §73.853',
    mapping: 'station_inputs.call'
  },
  {
    id: 'facility-id',
    lms_label: 'Facility ID number',
    section: 'III', subsection: '3A',
    type: 'string',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.853',
    mapping: 'station_inputs.facility_id'
  },
  {
    id: 'community-of-license',
    lms_label: 'Principal community to be served',
    section: 'III', subsection: '3A',
    type: 'string',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.853',
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
    lms_label: 'Service (LP = Low Power FM)',
    section: 'III', subsection: '3A',
    type: 'enum',
    options: ['LPFM', 'LP'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.801',
    mapping: 'station_inputs.service'
  },
  {
    id: 'lpfm-eligibility',
    lms_label: 'Applicant eligibility (non-commercial educational)',
    section: 'III', subsection: '3A',
    type: 'string',
    source: 'manual-applicant',
    required: true,
    cite: '47 CFR §73.853',
    mapping: null,
    notes: 'LPFM is restricted to non-commercial educational entities, public-safety entities, or tribal entities; licensee establishes eligibility under §73.853.'
  },

  // ── 3B — Frequency / channel / power / height ──────────────
  {
    id: 'frequency-mhz',
    lms_label: 'Frequency (MHz)',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'MHz',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.801, §73.807',
    mapping: 'station_inputs.frequency'
  },
  {
    id: 'channel-number',
    lms_label: 'Channel number',
    section: 'III', subsection: '3B',
    type: 'number',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.801',
    derive: (exhibit) => {
      const f = Number(exhibit?.station_inputs?.frequency);
      if (!Number.isFinite(f) || f < 88.1 || f > 107.9) return null;
      return Math.round((f - 88.1) / 0.2) + 201;
    }
  },
  {
    id: 'erp-w',
    lms_label: 'ERP (watts) — §73.811 LPFM max 100 W',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'W',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.811',
    notes: 'LPFM ERP is capped at 100 W per §73.811; reported in watts (not kW).  Genoa converts station_inputs.erp_kw when needed.',
    derive: (exhibit) => {
      const w = firstNonEmptyPath(exhibit, [
        'station_inputs.erp_w',
        'station_inputs.power_w'
      ]);
      if (w != null) return Number(w);
      const kw = Number(exhibit?.station_inputs?.erp_kw);
      if (!Number.isFinite(kw)) return null;
      return Math.round(kw * 1000);
    }
  },
  {
    id: 'haat-m',
    lms_label: 'HAAT (m) — §73.811 LPFM max 30 m default',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'm',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.811, §73.313',
    mapping: 'station_inputs.haat_m_input',
    notes: '§73.811 sets a 30 m HAAT default for 100 W LPFM stations; lower-power tradeoffs allow higher HAAT.'
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
    lms_label: 'Antenna pattern (ND/DA)',
    section: 'III', subsection: '3B',
    type: 'enum',
    options: ['ND', 'DA'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.816',
    derive: (exhibit) => Array.isArray(exhibit?.station_inputs?.pattern) ? 'DA' : 'ND'
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

  // ── 3C — §73.807 minimum distance separations ──────────────
  {
    id: 'compliance-pass',
    lms_label: '§73.807 minimum-distance separation pass/fail',
    section: 'III', subsection: '3C',
    type: 'enum',
    options: ['PASS', 'FAIL'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.807',
    derive: (exhibit) => {
      const rc = exhibit?.regulatory_compliance;
      if (!rc) return null;
      return rc.pass === true ? 'PASS' : (rc.pass === false ? 'FAIL' : null);
    }
  },
  {
    id: 'short-spacing-pairs',
    lms_label: '§73.807 short-spacing pairs (count)',
    section: 'III', subsection: '3C',
    type: 'number',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.807',
    derive: (exhibit) => exhibit?.regulatory_compliance?.section_73_807?.violations?.length
                     ?? exhibit?.regulatory_compliance?.section_73_207?.violations?.length
                     ?? 0
  },
  {
    id: 'blanketing-interference-area',
    lms_label: '§73.825 blanketing interference area (115 dBu contour, m radius)',
    section: 'III', subsection: '3C',
    type: 'number', unit: 'm',
    source: 'manual-engineer',
    required: true,
    cite: '47 CFR §73.825',
    mapping: null,
    notes: 'LPFM is responsible for resolving §73.825 blanketing-interference complaints within the 115 dBu contour for one year after CP construction.',
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
    lms_label: 'ASR number (if applicable)',
    section: 'III', subsection: '3E',
    type: 'string',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §17.4',
    notes: 'LPFM towers often fall below §17.7 notification threshold; ASR may be N/A.',
    derive: (exhibit) => firstNonEmptyPath(exhibit, [
      'station_inputs.asr_number',
      'evidence.asr.asr_number'
    ])
  },

  // ── 3F — Exhibits ──────────────────────────────────────────
  {
    id: 'engineering-statement-exhibit',
    lms_label: 'Engineering Statement (PDF)',
    section: 'III', subsection: '3F',
    type: 'file_reference',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.870',
    notes: 'LPFM does not require a PE seal in all states; check state PE-licensure rules.',
    derive: (exhibit) => {
      const call = String(exhibit?.station_inputs?.call || 'exhibit')
                     .replace(/[^A-Za-z0-9]/g, '_');
      const ts = new Date().toISOString().slice(0, 10);
      return `genoa-engineering-statement-${call}-${ts}.pdf  (download from Exports panel)`;
    }
  }
]);

export const FORM_318_META = Object.freeze({
  form_id:      '318',
  form_title:   'Application for Construction Permit for a Low Power FM Broadcast Station',
  cite:         '47 CFR §73.870, §73.811',
  lms_revision: '2024-consolidated',
  fcc_url:      'https://www.fcc.gov/media/radio/broadcast-applications-and-forms',
  lms_portal_url: 'https://enterpriseefiling.fcc.gov/dataentry/login.html',
  lms_schedule:   'Schedule 318',
  lms_filing_path:
    'LMS → File New Application → Media Bureau (Audio) → LPFM Construction Permit → ' +
    'Schedule 318 → Section III (Engineering Data).  Filing windows are limited; check current FCC LPFM filing-window notice before assembling.',
  lms_section:  'III (Engineering Data)',
  submission_checklist: Object.freeze([
    'Engineering Statement PDF signed by a qualified broadcast engineer (LPFM applicants commonly are not engineers — engage one)',
    '§73.811 power and antenna height: ERP ≤ 100 W; HAAT presumptive 30 m (operator must meet §73.811(c) if non-standard)',
    '§73.807 minimum-distance separations satisfied for co/1st/2nd/3rd-adjacent and IF-channel full-service / NCE / translator stations (no §73.215 path)',
    '§73.853 / §73.854 eligibility: applicant is an eligible entity (educational, public-safety, or Tribal Nation) — operator certifies',
    '§73.872 / §73.872(b) point system (mutually-exclusive applications): tie-breaker certifications attached if needed',
    'OET-65 RF-exposure showing for the LPFM tx site (low-power; categorical exclusion analysis usually applies)',
    'Tower / antenna structure compliance: ASR / FAA 7460-1 if heights trigger Part 17',
    'No filing fee for LPFM (47 CFR §1.1116) — confirm before submitting',
    'Section I (Applicant), Section II (Legal) prepared by applicant / counsel — NOT in this exhibit'
  ]),
  scope_note:   'SKELETON.  LPFM engineering schema under Subpart G of Part 73.  §73.811 caps ERP at 100 W and HAAT default at 30 m; §73.807 governs minimum-distance separations (no §73.215 contour-protection path is available for LPFM).'
});
