// 47 CFR Form 301-FM — declarative field schema for Section III (Engineering Data).
//
// SCOPE
//   Form 301-FM is the FCC's "Application for Construction Permit
//   for Commercial Broadcast Station" (FM service).  Filed in LMS
//   as a multi-section form; this module encodes ONLY Section III
//   (Engineering Data) — the fields a broadcast engineer fills.
//   Sections I (applicant identification), II (legal certifications),
//   and IV (ownership) are the licensee + counsel's responsibility
//   and are intentionally out of scope.
//
//   Each field carries:
//     id          stable Genoa-internal field ID (kebab-case)
//     lms_label   the label LMS shows next to the field (used to
//                 disambiguate when LMS API field IDs aren't public)
//     section     'III' for everything in this file
//     subsection  '3A' (general), '3B' (antenna), '3C' (compliance), etc.
//     type        'string' | 'number' | 'enum' | 'coords' | 'pattern_table'
//     unit        for numerics (kW, m, MHz, dBu, ...)
//     source      'genoa-auto'    — Genoa fills this from the exhibit
//                 'manual-engineer' — engineer must enter (e.g. tower lighting)
//                 'manual-applicant' — licensee/counsel (out of scope here)
//     required    true if LMS will reject without it
//     cite        the 47 CFR rule the field documents
//     mapping     dot-path into exhibit (engineering values), or null
//                 when source is manual
//     derive      OPTIONAL fn(exhibit) → value with multi-source
//                 fallback.  When present, derive() runs first and
//                 mapping is only used as a hint for resolveProvenance.
//                 Useful for fields that may live under different keys
//                 depending on which upstream populated the exhibit
//                 (FCC FMQ vs ZTR vs operator typed).
//     suggest     OPTIONAL fn(exhibit) → candidate value when source is
//                 'manual-engineer'.  When operator hasn't supplied a
//                 value AND suggest() returns one, mapping.js sets the
//                 field's status to 'suggested' — engineer must confirm
//                 before filing; never auto-certified.
//     suggest_note OPTIONAL human-readable rationale shown next to the
//                 suggested value.
//
// REFERENCES
//   FCC Form 301 (FM): https://transition.fcc.gov/Forms/Form301/301f.pdf
//   LMS user guide (engineering): https://www.fcc.gov/media/radio/lms
//   47 CFR §73.3539, §73.3540 — application requirements
//   47 CFR §73.207, §73.215, §73.313, §73.333 — engineering rules

// First-non-empty over a list of dot-paths into the exhibit.  Used by
// fields whose value can land under different keys depending on which
// upstream (FCC FMQ, ZTR, evidence.fcc_lms, operator input) populated
// the row.  Returns null if every candidate is missing/empty.
function firstNonEmptyPath(exhibit, paths){
  for (const p of paths){
    const v = p.split('.').reduce((o, k) => (o == null ? o : o[k]), exhibit);
    if (v !== undefined && v !== null && !(typeof v === 'string' && !v.trim())){
      return v;
    }
  }
  return null;
}

// §17 NOT-REQUIRED phrasing.  When the genoa-faa-airports sidecar ran
// the §17.7(c) auto-check and confirmed no public-use airport within
// the notification radius, we say so explicitly.  Otherwise we flag
// that the engineer of record must verify §17.7(c) by hand.
function notRequiredCite(compliance){
  const airportCite = (compliance?.cites || []).find(c => /17\.7\(c\)/.test(c.rule));
  if (airportCite && airportCite.triggered === false){
    return 'NOT-REQUIRED — §17.7(a) below 60.96 m AGL; §17.7(c) auto-checked (no public-use airport within notification radius)';
  }
  return 'NOT-REQUIRED — §17.7(a) below 60.96 m AGL (engineer to verify §17.7(c) airport proximity)';
}

export const FORM_301_FM_FIELDS = Object.freeze([
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
    notes: 'Driven by the licensee\'s filing intent; Genoa cannot infer.'
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
      'station_inputs.licensing_community',
      'station_inputs.city',
      'evidence.fcc_lms.license.community',
      'evidence.fcc_lms.license.community_of_license',
      'evidence.fcc_lms.license.city',
      'facility_metadata.community',
      'facility_metadata.community_of_license',
      'facility_metadata.city'
    ])
  },
  {
    id: 'service',
    lms_label: 'Service (FM full-service / FM translator / LPFM)',
    section: 'III', subsection: '3A',
    type: 'enum',
    options: ['FM', 'FX', 'LPFM'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.3539',
    mapping: 'station_inputs.service'
  },
  {
    id: 'fcc-class',
    lms_label: 'FCC class',
    section: 'III', subsection: '3A',
    type: 'enum',
    options: ['A', 'B1', 'B', 'C3', 'C2', 'C1', 'C0', 'C', 'D'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.211',
    mapping: 'station_inputs.fcc_class',
    derive: (exhibit) => firstNonEmptyPath(exhibit, [
      'station_inputs.fcc_class',
      'station_inputs.class',
      'station_inputs.station_class',
      'evidence.fcc_lms.license.fcc_class',
      'evidence.fcc_lms.license.station_class',
      'evidence.fcc_lms.license.class',
      'facility_metadata.fcc_class',
      'facility_metadata.class',
      'facility_metadata.station_class'
    ])
  },

  // ── 3B — Frequency / channel / power / height ────────────────────
  {
    id: 'frequency-mhz',
    lms_label: 'Frequency (MHz)',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'MHz',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.201',
    mapping: 'station_inputs.frequency'
  },
  {
    id: 'channel-number',
    lms_label: 'Channel number',
    section: 'III', subsection: '3B',
    type: 'number',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.201',
    derive: (exhibit) => {
      const f = Number(exhibit?.station_inputs?.frequency);
      if (!Number.isFinite(f) || f < 88.1 || f > 107.9) return null;
      return Math.round((f - 88.1) / 0.2) + 201;
    }
  },
  {
    id: 'erp-kw-horizontal',
    lms_label: 'ERP horizontal (kW)',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'kW',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.211',
    mapping: 'station_inputs.erp_kw'
  },
  {
    id: 'erp-kw-vertical',
    lms_label: 'ERP vertical (kW)',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'kW',
    source: 'manual-engineer',
    required: false,
    cite: '47 CFR §73.211',
    mapping: null,
    notes: 'Most FM stations file ERP-H = ERP-V; field becomes mandatory only when patterns differ.',
    suggest: (exhibit) => {
      const s = exhibit?.station_inputs || {};
      const isDirectional = Array.isArray(s.pattern) && s.pattern.length > 0;
      if (isDirectional) return null;
      if (s.erp_v_kw != null && Number.isFinite(Number(s.erp_v_kw))) return null;
      const erpH = Number(s.erp_kw);
      if (!Number.isFinite(erpH) || erpH <= 0) return null;
      return erpH;
    },
    suggest_note: 'ND antenna with no separate ERP-V on file — suggest ERP-V = ERP-H per §73.211 convention; engineer of record must confirm before filing.'
  },
  {
    id: 'haat-m',
    lms_label: 'HAAT (m) — average across 8 cardinal radials, §73.313',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'm',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.313',
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
    id: 'rcagl-m',
    lms_label: 'Radiation center AGL (m)',
    section: 'III', subsection: '3B',
    type: 'number', unit: 'm',
    source: 'manual-engineer',
    required: true,
    cite: '47 CFR §17',
    mapping: null,
    notes: 'Tower height + antenna mounting offset; not derivable from compute().'
  },

  // ── 3B (cont.) — Antenna & coordinates ──────────────────────
  {
    id: 'antenna-pattern',
    lms_label: 'Antenna pattern',
    section: 'III', subsection: '3B',
    type: 'enum',
    options: ['ND', 'DA'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.316',
    derive: (exhibit) =>
      Array.isArray(exhibit?.station_inputs?.pattern) ? 'DA' : 'ND'
  },
  {
    id: 'antenna-pattern-table',
    lms_label: 'Antenna pattern table (azimuth × relative-field)',
    section: 'III', subsection: '3B',
    type: 'pattern_table',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §73.316',
    mapping: 'station_inputs.pattern',
    notes: 'Required only when antenna_pattern = DA.  Format: [[az_deg, f(az)], ...]'
  },
  {
    id: 'coordinates-nad83',
    lms_label: 'Antenna coordinates (NAD83 decimal degrees)',
    section: 'III', subsection: '3B',
    type: 'coords',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.207, §73.208',
    derive: (exhibit) => {
      const lat = exhibit?.station_inputs?.lat;
      const lon = exhibit?.station_inputs?.lon;
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return { lat, lon, datum: 'NAD83' };
    }
  },
  {
    id: 'antenna-make-model',
    lms_label: 'Antenna manufacturer + model',
    section: 'III', subsection: '3B',
    type: 'string',
    source: 'manual-engineer',
    required: true,
    cite: '47 CFR §73.316',
    mapping: null
  },
  {
    id: 'antenna-elevation-pattern',
    lms_label: 'Antenna elevation pattern (vertical pattern reference)',
    section: 'III', subsection: '3B',
    type: 'string',
    source: 'manual-engineer',
    required: false,
    cite: '47 CFR §73.316',
    mapping: null,
    notes: 'Manufacturer pattern reference; used for §73.316(c) electrical beam tilt declarations.'
  },

  // ── 3C — Distance / contour-protection compliance ────────────────────
  {
    id: 'compliance-rule-path',
    lms_label: 'Compliance basis (§73.207 minimum-distance OR §73.215 contour-protection)',
    section: 'III', subsection: '3C',
    type: 'enum',
    options: ['§73.207', '§73.215', '§73.207-and-§73.215'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.207, §73.215',
    derive: (exhibit) => {
      const rc = exhibit?.regulatory_compliance;
      if (!rc) return null;
      const p207 = rc.section_73_207?.pass === true;
      const p215 = rc.cite && /73\.215/.test(rc.cite) && rc.pass === true;
      if (p207 && p215) return '§73.207-and-§73.215';
      if (p215) return '§73.215';
      if (p207) return '§73.207';
      return null;
    }
  },
  {
    id: 'compliance-pass',
    lms_label: 'Engineering compliance pass/fail',
    section: 'III', subsection: '3C',
    type: 'enum',
    options: ['PASS', 'FAIL', 'PASS-via-73.215'],
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.207, §73.215',
    derive: (exhibit) => {
      const rc = exhibit?.regulatory_compliance;
      if (!rc) return null;
      if (rc.pass === true)  return 'PASS';
      if (rc.section_73_207?.pass === false && rc.pass === true) return 'PASS-via-73.215';
      return 'FAIL';
    }
  },
  {
    id: 'service-contour-distance-mean-km',
    lms_label: 'Service contour mean radial (km, 60 dBu)',
    section: 'III', subsection: '3C',
    type: 'number', unit: 'km',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.333',
    derive: (exhibit) => {
      const p = (exhibit?.polygons || []).find(x => /service|60/i.test(x.contour_id || x.label || ''));
      return p?.mean_radial_km ?? null;
    }
  },
  {
    id: 'protected-contour-distance-mean-km',
    lms_label: 'Protected contour mean radial (km, 40 dBu)',
    section: 'III', subsection: '3C',
    type: 'number', unit: 'km',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.333',
    derive: (exhibit) => {
      const p = (exhibit?.polygons || []).find(x => /protected|40/i.test(x.contour_id || x.label || ''));
      return p?.mean_radial_km ?? null;
    }
  },
  {
    id: 'interfering-contour-distance-mean-km',
    lms_label: 'Interfering contour mean radial (km, F(50,10))',
    section: 'III', subsection: '3C',
    type: 'number', unit: 'km',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §73.333',
    derive: (exhibit) => {
      const p = (exhibit?.polygons || []).find(x => /interf|f5010/i.test(x.contour_id || x.label || ''));
      return p?.mean_radial_km ?? null;
    }
  },
  {
    id: 'short-spacing-pairs',
    lms_label: '§73.207 short-spacing pairs (count)',
    section: 'III', subsection: '3C',
    type: 'number',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.207',
    derive: (exhibit) => exhibit?.regulatory_compliance?.section_73_207?.violations?.length ?? 0
  },
  {
    id: 'short-spacing-resolution',
    lms_label: '§73.215 contour-protection resolution (when §73.207 fails)',
    section: 'III', subsection: '3C',
    type: 'string',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §73.215',
    derive: (exhibit) => {
      const rc = exhibit?.regulatory_compliance;
      if (rc?.section_73_207?.pass === false && rc?.pass === true){
        return 'Station fails §73.207(b) but qualifies via §73.215 contour protection (no overlap of subject F(50,10) with nearby F(50,50) and reciprocal).';
      }
      return null;
    }
  },

  // ── 3D — Population & RF safety ────────────────────────────
  {
    id: 'population-served',
    lms_label: 'Population served (within 60 dBu, INFORMATIONAL)',
    section: 'III', subsection: '3D',
    type: 'number',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §73.x informational only',
    mapping: 'population_estimate.primary',
    notes: 'FCC §73.x rules are distance/field-strength tests, NOT population.  Provided for completeness.'
  },
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
      if (oet.compliance?.boundary_check?.pass === true) return 'PASS';
      if (oet.compliance?.boundary_check?.pass === false) return 'FAIL';
      return 'SKIPPED';
    }
  },
  {
    id: 'oet-65-controlled-distance-m',
    lms_label: 'OET-65 controlled MPE compliance distance (m)',
    section: 'III', subsection: '3D',
    type: 'number', unit: 'm',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §1.1310',
    mapping: 'oet65.compliance.controlled.distance_m'
  },
  {
    id: 'oet-65-uncontrolled-distance-m',
    lms_label: 'OET-65 uncontrolled MPE compliance distance (m)',
    section: 'III', subsection: '3D',
    type: 'number', unit: 'm',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §1.1310',
    mapping: 'oet65.compliance.uncontrolled.distance_m'
  },

  // ── 3E — Tower / structure (FAA / Part 17) ──────────────────────
  // Auto-filled from evidence.asr (ASR record), evidence.faa_oe (FAA
  // OE/AAA Form 7460-2), and exhibit.tower_compliance (rules-derived
  // §17.21/§17.23/AC 70/7460-1L).  Status is 'suggested' on derived
  // values — the engineer of record must confirm before filing.
  {
    id: 'asr-number',
    lms_label: 'Antenna structure registration (ASR) number',
    section: 'III', subsection: '3E',
    type: 'string',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §17.4',
    derive: (exhibit) => {
      const asrFromInput = firstNonEmptyPath(exhibit, [
        'station_inputs.asr_number',
        'evidence.asr.asr_number'
      ]);
      if (asrFromInput) return asrFromInput;
      const cmpl = exhibit?.tower_compliance;
      if (cmpl?.applicable && cmpl.notification_required === false){
        return notRequiredCite(cmpl);
      }
      return null;
    }
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
        if (/DNH|NO\s*HAZARD/.test(d))      return 'NO-HAZARD';
        if (/CONDITION/.test(d))            return 'CONDITIONED';
        if (/HAZARD/.test(d))               return 'HAZARD';
        if (/WITHDRAWN|PENDING/.test(d))    return null;
        return d;
      }
      const cmpl = exhibit?.tower_compliance;
      if (cmpl?.applicable && !cmpl.notification_required) return 'NOT-REQUIRED';
      return null;
    }
  },
  {
    id: 'tower-painting',
    lms_label: 'Tower painting / marking specification',
    section: 'III', subsection: '3E',
    type: 'string',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §17.21, AC 70/7460-1L',
    derive: (exhibit) => {
      const fromAsr = firstNonEmptyPath(exhibit, [
        'evidence.asr.painting_requirement'
      ]);
      if (fromAsr) return fromAsr;
      const cmpl = exhibit?.tower_compliance;
      if (!cmpl?.applicable) return null;
      if (cmpl.notification_required === false){
        return notRequiredCite(cmpl);
      }
      if (cmpl.marking?.required) return cmpl.marking.style;
      return 'lighting-in-lieu-of-paint';
    }
  },
  {
    id: 'tower-lighting',
    lms_label: 'Tower obstruction lighting style',
    section: 'III', subsection: '3E',
    type: 'string',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §17.23, AC 70/7460-1L',
    derive: (exhibit) => {
      const fromAsr = firstNonEmptyPath(exhibit, [
        'evidence.asr.lighting_requirement'
      ]);
      if (fromAsr) return fromAsr;
      const cmpl = exhibit?.tower_compliance;
      if (!cmpl?.applicable) return null;
      if (cmpl.notification_required === false){
        return notRequiredCite(cmpl);
      }
      if (cmpl.lighting?.required) return cmpl.lighting.style;
      return null;
    }
  },

  // ── 3F — Reference exhibits attached to LMS ──────────────────────
  {
    id: 'engineering-statement-exhibit',
    lms_label: 'Engineering Statement (PDF, signed by PE)',
    section: 'III', subsection: '3F',
    type: 'file_reference',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.3539',
    notes: 'Generated by Genoa Engineering Statement export (PDF) + PE seal stamp.  Click "Engineering statement (PDF)" in the workbench Exports panel.',
    derive: (exhibit) => {
      const call = String(exhibit?.station_inputs?.call || 'exhibit')
                     .toString().replace(/[^A-Za-z0-9]/g, '_');
      const ts   = new Date().toISOString().slice(0, 10);
      return `genoa-engineering-statement-${call}-${ts}.pdf  (download from Exports panel)`;
    }
  },
  {
    id: 'contour-map-exhibit',
    lms_label: 'Contour map (PDF showing 60/54/40 dBu contours)',
    section: 'III', subsection: '3F',
    type: 'file_reference',
    source: 'genoa-auto',
    required: true,
    cite: '47 CFR §73.333',
    notes: 'The contour map ships embedded in the Engineering Statement PDF as a numbered exhibit page (Map Package).  No separate file required for filing.',
    derive: (exhibit) => {
      const call = String(exhibit?.station_inputs?.call || 'exhibit')
                     .toString().replace(/[^A-Za-z0-9]/g, '_');
      return `embedded in Engineering Statement PDF · ${call} contour map page`;
    }
  },
  {
    id: 'section-73-215-study-exhibit',
    lms_label: '§73.215 contour-protection study (when filing on contour-protection basis)',
    section: 'III', subsection: '3F',
    type: 'file_reference',
    source: 'genoa-auto',
    required: false,
    cite: '47 CFR §73.215',
    notes: 'Required only when compliance-rule-path includes §73.215.  Genoa generates this from regulatory_compliance.violations.',
    derive: (exhibit) => {
      const rc = exhibit?.regulatory_compliance;
      const filing215 = rc && /73\.215/.test(rc.cite || '');
      if (!filing215) return 'not applicable (filing under §73.207 minimum-distance)';
      const call = String(exhibit?.station_inputs?.call || 'exhibit')
                     .toString().replace(/[^A-Za-z0-9]/g, '_');
      return `embedded in Engineering Statement PDF · ${call} §73.215 study section`;
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
    notes: 'The OET-65 §1.1310 compliance section is rendered as a numbered exhibit inside the Engineering Statement PDF.  No separate file required.',
    derive: (exhibit) => {
      const call = String(exhibit?.station_inputs?.call || 'exhibit')
                     .toString().replace(/[^A-Za-z0-9]/g, '_');
      return `embedded in Engineering Statement PDF · ${call} RF exposure section`;
    }
  }
]);

export function fieldsAsMarkdownTable(fields = FORM_301_FM_FIELDS){
  const rows = [
    '| Sub | Field | Required | Source | Cite |',
    '|-----|-------|----------|--------|------|'
  ];
  for (const f of fields){
    const sub = f.subsection || f.section || '';
    const req = f.required ? 'Y' : '';
    rows.push(`| ${sub} | ${f.lms_label} | ${req} | ${f.source} | ${f.cite || ''} |`);
  }
  return rows.join('\n');
}

export const FORM_301_FM_META = Object.freeze({
  form_id:     '301-FM',
  form_title:  'Application for Construction Permit for Commercial Broadcast Station — FM',
  cite:        '47 CFR §73.3539, §73.3540',
  fcc_url:     'https://transition.fcc.gov/Forms/Form301/301f.pdf',
  lms_section: 'III (Engineering Data)',
  scope_note:  'Genoa fills Section III (engineering).  Sections I (applicant), II (legal), and IV (ownership) are the licensee\'s and counsel\'s responsibility and are intentionally out of scope here.'
});
