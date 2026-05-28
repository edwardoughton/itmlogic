// RF Exposure section — 47 CFR §1.1307, §1.1310 (OET-65).
//
// FCC §1.1310 requires categorical evaluation of MPE for broadcast
// transmitters above 1 kW ERP.  H&D-style exhibits typically dedicate
// a one-page Section 7 to this with controlled / uncontrolled distance
// limits and a near-field flag.  Genoa's compute attaches an `oet65`
// block — this section typesets it; if the block is missing, the
// section emits a structured "deferred to engineer of record" note
// rather than silently dropping (which would let a non-compliant
// filing slip through).

export function buildRfExposureSection(exhibit){
  const oet = exhibit?.oet65;
  if (!oet){
    return {
      id:      'rf-exposure',
      type:    'paragraphs',
      heading: 'Radiofrequency Exposure (OET-65 / §1.1310)',
      paragraphs: [
        'Per 47 CFR §1.1307(b)(1), the subject facility falls within the categorical evaluation thresholds of §1.1310 for routine RF-exposure compliance.  An OET-65 evaluation is required prior to filing.',
        'No OET-65 evaluation block is attached to this exhibit (exhibit.oet65 is absent).  The engineer of record must perform a controlled / uncontrolled-environment MPE assessment per OET Bulletin 65 (1997) Supplement A — including controlled compliance distance, uncontrolled compliance distance, and a near-field reactive-region check at antenna mounting heights below 10 m AGL — and attach that as a separate exhibit to the LMS application.'
      ]
    };
  }

  const c   = oet.compliance || {};
  const ctl = c.controlled   || {};
  const unc = c.uncontrolled || {};
  const nf  = oet.near_field  || {};
  const bc  = c.boundary_check || {};

  // Fallbacks for fields that older engine versions don't echo on the
  // top-level oet block.  The compute had these values (the distance
  // calc requires them); we just need to surface them here even if
  // the engine forgot to copy them up.  Pull from the exhibit's
  // station_inputs as the authoritative operator-supplied source,
  // and from the OET-65 sub-blocks where the engine sometimes stashes
  // the working values.
  const s = exhibit.station_inputs || {};
  const freqMHz = oet.frequency_mhz ?? c.frequency_mhz ?? s.frequency ?? null;
  const erpKw   = oet.erp_kw       ?? c.erp_kw        ?? s.erp_kw    ?? null;
  // FCC §1.1310 Table 1 values — controlled = 1.0 mW/cm², uncontrolled
  // = 0.2 mW/cm² for the FM band (30 MHz – 300 MHz, occupational vs
  // general-public).  These are the regulatory limits the compliance
  // distances were derived from; if the engine doesn't echo them we
  // can render the table values from the rule itself.
  const ctlMpe = ctl.mpe_limit_mw_cm2 ?? (Number.isFinite(Number(freqMHz)) && Number(freqMHz) >= 30 && Number(freqMHz) <= 300 ? 1.0 : null);
  const uncMpe = unc.mpe_limit_mw_cm2 ?? (Number.isFinite(Number(freqMHz)) && Number(freqMHz) >= 30 && Number(freqMHz) <= 300 ? 0.2 : null);

  // Status label: when a boundary check ran, report PASS/FAIL.  When
  // the antenna geometry forces near-field modeling, say so.  When
  // controlled / uncontrolled MPE distances ARE computed but the
  // boundary check was skipped (typical: operator didn't supply
  // lot/property-line dimensions), say "DISTANCES COMPUTED · BOUNDARY
  // DEFERRED" rather than "NOT EVALUATED" — the prior label was
  // misleading because the distances on this page are real outputs
  // of the §1.1310 categorical evaluation, not placeholders.
  const haveDistances = Number.isFinite(Number(ctl.distance_m)) || Number.isFinite(Number(unc.distance_m));
  const passLabel = bc.pass === true  ? 'PASS — boundary clears uncontrolled MPE'
                  : bc.pass === false ? 'FAIL — uncontrolled MPE exceeded at boundary'
                  : nf.required_for_filing ? 'NEAR-FIELD MODELING REQUIRED — antenna mounting height below the OET-65 simplified-equation validity range'
                  : haveDistances ? 'DISTANCES COMPUTED · BOUNDARY CHECK DEFERRED — supply lot/property-line dimensions to complete §1.1307(b) categorical evaluation'
                  : 'NOT EVALUATED';

  const rows = [
    ['Status',                    passLabel],
    ['Method',                    oet.method || 'OET-65 simplified-equation (far-field, omni)'],
    ['Frequency',                 freqMHz != null ? `${freqMHz} MHz` : '—'],
    ['ERP (peak, controlling)',   erpKw != null ? `${erpKw} kW` : '—'],
    ['Controlled MPE limit',      ctlMpe != null ? `${ctlMpe} mW/cm² (47 CFR §1.1310 Table 1, occupational/controlled)` : '—'],
    ['Controlled compliance distance', ctl.distance_m != null ? `${ctl.distance_m.toFixed?.(2) ?? ctl.distance_m} m` : '—'],
    ['Uncontrolled MPE limit',    uncMpe != null ? `${uncMpe} mW/cm² (47 CFR §1.1310 Table 1, general public/uncontrolled)` : '—'],
    ['Uncontrolled compliance distance', unc.distance_m != null ? `${unc.distance_m.toFixed?.(2) ?? unc.distance_m} m` : '—'],
    ['Boundary check distance',   bc.boundary_distance_m != null ? `${bc.boundary_distance_m} m (per filed lot/property line or fence)` : 'DEFERRED — operator must supply lot/property-line dimensions'],
    ['Boundary power density',    bc.power_density_mw_cm2 != null ? `${bc.power_density_mw_cm2.toFixed?.(4) ?? bc.power_density_mw_cm2} mW/cm²` : 'DEFERRED — depends on boundary distance above'],
    ['Near-field required',       nf.required_for_filing ? `YES — antenna RC AGL ${nf.rcagl_m ?? '—'} m is below the OET-65 simplified-equation lower bound; full NEC near-field modeling required` : 'no'],
    ['Engine module',             oet.engine_module || 'genoa.regulatory.oet65'],
    ['Bulletin',                  'OET-65 Bulletin (Edition 97-01) Supplement A · 47 CFR §1.1310 Table 1']
  ];

  // Auto-generated filing-ready narrative — standard consulting voice
  // pulled live from the exhibit's oet65 block so numbers track the
  // table.  Conservative phrasing; mirrors the opening of an H&D /
  // Cavell-Mertz Section 7 RF exposure exhibit.
  const fmtMHz = oet.frequency_mhz != null ? `${oet.frequency_mhz} MHz` : 'the filed operating frequency';
  const fmtErp = oet.erp_kw != null ? `${oet.erp_kw} kW` : 'the filed ERP';
  const ctlD = ctl.distance_m != null ? `${ctl.distance_m.toFixed?.(2) ?? ctl.distance_m} m` : 'the calculated controlled-environment distance';
  const uncD = unc.distance_m != null ? `${unc.distance_m.toFixed?.(2) ?? unc.distance_m} m` : 'the calculated uncontrolled-environment distance';
  const preface =
    'A radiofrequency exposure analysis was performed pursuant to OET Bulletin 65 ' +
    `(Edition 97-01) Supplement A using the simplified far-field methodology applicable to FM broadcast facilities.  At ${fmtMHz} and ${fmtErp}, the controlled-environment maximum permissible exposure (MPE) compliance distance is ${ctlD}, and the corresponding uncontrolled-environment compliance distance is ${uncD}.  ` +
    (bc.boundary_distance_m != null
      ? `The closest property-line / publicly accessible boundary is ${bc.boundary_distance_m} m from the antenna.  Boundary power density is ${bc.power_density_mw_cm2 != null ? `${bc.power_density_mw_cm2.toFixed?.(4) ?? bc.power_density_mw_cm2} mW/cm²` : 'as tabulated below'}, ` +
        (bc.pass === true
          ? 'which clears the §1.1310 uncontrolled-environment limit; the facility therefore qualifies for routine categorical evaluation under §1.1307(b).  '
          : bc.pass === false
            ? 'which does NOT clear the §1.1310 uncontrolled-environment limit.  Operational mitigation (signage, fencing, controlled-access designation, or feed-power adjustment) is required prior to construction in order to qualify under §1.1307(b).  '
            : '')
      : '') +
    (nf.required_for_filing
      ? 'Because the antenna radiation center AGL is below the validity range of the OET-65 simplified far-field equation, full near-field reactive-region modeling (NEC) is REQUIRED before filing.  '
      : '') +
    'Compliance limits are taken from 47 CFR §1.1310 Table 1; controlled-environment limits apply to occupational personnel with awareness training, and uncontrolled-environment limits apply to the general public.';

  const summary = nf.required_for_filing
    ? 'NEAR-FIELD MODELING REQUIRED.  The antenna RC AGL falls below the validity range of the OET-65 simplified far-field equation; the engineer of record must perform an NEC reactive-region near-field study and attach it as a separate exhibit before filing.'
    : (bc.pass === true
        ? 'The categorical evaluation indicates the controlling boundary distance clears the uncontrolled-environment MPE limit; no further mitigation is identified by this study.'
        : bc.pass === false
          ? 'The categorical evaluation indicates the controlling boundary distance does NOT clear the uncontrolled-environment MPE limit.  Operational mitigation (signage, fencing, controlled-access designation, or feed-power adjustment) is required before construction.'
          : 'Result is indeterminate; engineer of record must verify boundary geometry and re-run with the as-built lot/property line dimensions.');

  return {
    id:      'rf-exposure',
    type:    'paragraphs-with-kv',
    heading: 'Radiofrequency Exposure (OET-65 / §1.1310)',
    paragraphs: [preface, summary],
    rows
  };
}
