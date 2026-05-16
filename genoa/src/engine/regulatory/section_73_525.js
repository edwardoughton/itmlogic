// 47 CFR §73.525 — TV Channel 6 protection of non-commercial FM stations
//                   in the 88.1–91.9 MHz band edge.
//
// REGULATION
//   The reserved educational FM band (88.1–91.9 MHz) is the lower
//   first-adjacent of legacy NTSC TV Channel 6 (82–88 MHz visual /
//   sound).  When NTSC ch.6 was active, §73.525 required reserved-
//   band FMs proposing ANY change in the 88.1–91.9 MHz subset to
//   demonstrate that their interfering contour would not overlap any
//   ch.6 station's Grade B protected contour.
//
//   POST-DTV TRANSITION (June 2009): the FCC repacked all full-power
//   ch.6 stations to higher channels, and §73.525 became dormant for
//   most filings.  HOWEVER:
//
//     - LPTV / Class A TV stations on ch.6 ("Franken FMs") still
//       transmit analogue audio at 87.75 MHz (their NTSC sound
//       carrier).  §73.525 protections apply against these residual
//       ch.6 emitters as long as they exist.
//
//     - Pre-2009 reserved-band FMs are sometimes grandfathered with
//       reduced power against ch.6 contours that no longer exist.
//       A modification application can recover the lost ERP only
//       after demonstrating no ch.6 protection remains required.
//
// METHODOLOGY
//   §73.525 publishes a contour-protection methodology analogous to
//   §73.215 / §74.1204:
//
//     1. Compute the proposed FM's F(50,10) interfering contour at the
//        47/40 dBu threshold (§73.525(b) Table I — depends on the FM's
//        channel within the reserved band).
//
//     2. Compute the ch.6 station's Grade B protected contour
//        (§73.683 — TV Grade B is 47 dBu / 64 dBu for VHF/UHF; ch.6
//        is low-VHF so 47 dBu).
//
//     3. Pass if the FM's interfering contour does not overlap the
//        ch.6 protected contour.
//
//   §73.525(b) D/U gates by FM channel:
//
//     FM channel \ ch.6 sound (87.75 MHz)
//       201–203  (88.1–88.5)  : DU = -45 dB  (most stringent)
//       204–207  (88.7–89.3)  : DU = -55 dB
//       208–215  (89.5–91.1)  : DU = -65 dB
//       216–220  (91.3–91.9)  : DU = -75 dB
//
//   Many filings SKIP §73.525 entirely because no ch.6 station
//   protected contour reaches the proposed FM site.  We enable the
//   evaluation when the orchestrator supplies `evidence.tv_ch6_stations`
//   (a list of nearby active ch.6 LPTV / Class A or grandfathered
//   full-power ch.6 stations).  Without that list, we emit
//   MISSING_CH6_STATIONS as a hint — same convention as
//   MISSING_NEARBY_STATIONS.
//
// LIMITATIONS
//   - We compute the §73.525 contour-overlap pair-wise along the
//     inter-station bearing (worst case for any FM pattern).  Same
//     simplification used in §73.215 / §74.1204 / §73.187.
//   - The TV ch.6 Grade B protected-contour distance lookup uses the
//     FCC's vendored §73.699 F(50,50) curves — same engine that
//     produces FM contours.  ch.6 is in the same Low-VHF curve
//     family (channels 2-6) as FM, so the curve table is shared.

import { studyContourPair, classifyFmOffsetKhz } from './_du_pair_study.js';

// FM reserved-band channel → §73.525(b) D/U gate (dB).
// FM channels are numbered 200 (87.9 MHz) through 220 (91.9 MHz);
// channel n corresponds to 87.7 + 0.2·(n - 200) MHz.
function frequencyToFmChannel(frequency_mhz){
  const f = Number(frequency_mhz);
  if (!Number.isFinite(f)) return null;
  // FM channel grid: ch200 = 87.9, step 0.2 MHz.
  const ch = Math.round((f - 87.9) / 0.2 + 200);
  return Number.isInteger(ch) && ch >= 200 && ch <= 300 ? ch : null;
}

export function section73525DuGateDb(frequency_mhz){
  const ch = frequencyToFmChannel(frequency_mhz);
  if (ch == null) return null;
  if (ch >= 201 && ch <= 203)  return -45;     // 88.1–88.5 MHz
  if (ch >= 204 && ch <= 207)  return -55;     // 88.7–89.3 MHz
  if (ch >= 208 && ch <= 215)  return -65;     // 89.5–91.1 MHz
  if (ch >= 216 && ch <= 220)  return -75;     // 91.3–91.9 MHz
  return null;                                  // > 91.9 MHz: §73.525 does not apply
}

const TV_CH6_GRADE_B_DBU = 47;        // §73.683 Low-VHF Grade B

/**
 * Run a §73.525 contour-protection study against a list of nearby
 * active TV channel 6 stations.
 *
 * @param {object} args
 * @param {object} args.subject              proposed reserved-band FM:
 *                                            { erp_kw, haat_m, frequency_mhz, lat, lon, fcc_class, call?, facility_id? }
 * @param {Array<object>} args.tvCh6Stations  nearby active ch.6 stations:
 *                                            { call, facility_id, fcc_class, erp_kw, haat_m, lat, lon }
 *                                            (frequency assumed 83.25 MHz visual / 87.75 MHz aural — ch.6)
 * @returns {{
 *   cite, applicable, pass, subject, studies, violations, notes, method,
 *   missing_ch6_stations?
 * }}
 */
export function checkSection73525({ subject, tvCh6Stations = [] } = {}){
  const violations = [];
  const notes      = [];
  const studies    = [];

  if (!subject || typeof subject !== 'object'){
    return {
      cite: '47 CFR §73.525',
      applicable: false,
      pass: false,
      subject: null,
      studies, violations: [{
        cite:    '47 CFR §73.525(a)',
        message: 'Subject FM station inputs missing — TV ch.6 contour-protection study cannot be run.'
      }], notes,
      method: 'FCC tvfm_curves.js F(50,10) ↔ §73.683 Grade B (47 dBu) contour-pair study (vendored canonical)'
    };
  }

  const fm_freq = Number(subject.frequency_mhz);
  const du_gate_db = section73525DuGateDb(fm_freq);
  if (du_gate_db == null){
    return {
      cite: '47 CFR §73.525',
      applicable: false,
      pass: true,
      subject: subjectShape(subject),
      studies, violations, notes: [`FM frequency ${fm_freq} MHz is not in the §73.525 reserved-band range (88.1–91.9 MHz); §73.525 does not apply.`],
      method: 'FCC tvfm_curves.js F(50,10) ↔ §73.683 Grade B (47 dBu) contour-pair study (vendored canonical)'
    };
  }

  if (!Array.isArray(tvCh6Stations) || tvCh6Stations.length === 0){
    notes.push('No active TV channel 6 stations supplied.  §73.525 study cannot run; reviewer must verify no ch.6 protected contours reach the proposed site (typically clear post-DTV-transition; LPTV / Class A ch.6 "Franken FM" residuals may still apply).');
    return {
      cite: '47 CFR §73.525',
      applicable: true,
      pass: true,                  // pass-by-default when no ch.6 nearby
      subject: subjectShape(subject),
      studies, violations, notes,
      method: 'FCC tvfm_curves.js F(50,10) ↔ §73.683 Grade B (47 dBu) contour-pair study (vendored canonical)',
      du_gate_db,
      missing_ch6_stations: true
    };
  }

  // For each ch.6 station, run a contour-pair study where:
  //   U = subject (F(50,10) at ch.6's 47 dBu protected edge)
  //   D = ch.6 station with 47 dBu protected field
  // The §73.525 D/U gate is far more stringent than §74.1204(c) — at
  // -45 to -75 dB, it protects ch.6 from co-channel-image FM
  // emissions in the 88-92 MHz band.
  for (const ch6 of tvCh6Stations){
    // Use the ch.6 station's effective channel — assume ch.6 (83.25 MHz
    // visual / 87.75 MHz aural).  We treat the relationship as "first-
    // adjacent-image" and apply the §73.525 D/U gate directly.
    const ch6_freq_mhz = Number(ch6.frequency_mhz) || 83.25;
    const fwd = studyContourPair(subject, { ...ch6, frequency_mhz: ch6_freq_mhz }, {
      relationship:        '§73.525 reserved-band ↔ TV ch.6',
      du_threshold_db:     du_gate_db,
      protected_field_dbu: TV_CH6_GRADE_B_DBU,
      // Ch.6 is in the Low-VHF curve family — same as FM channels.
      protected_mode:      '50,50',
      interfering_mode:    '50,10'
    });

    const study = {
      ch6_call:               ch6.call         || null,
      ch6_facility_id:        ch6.facility_id  || null,
      ch6_class:              ch6.fcc_class    || null,
      ch6_frequency_mhz:      ch6_freq_mhz,
      fm_channel:             frequencyToFmChannel(fm_freq),
      du_gate_db,
      ch6_protected_field_dbu: TV_CH6_GRADE_B_DBU,
      study_pair:             fwd,
      pair_pass:              fwd.pass !== false
    };
    studies.push(study);

    if (fwd.pass === false){
      violations.push({
        cite:    '47 CFR §73.525(b)',
        message: `Reserved-band FM (channel ${study.fm_channel}, ${fm_freq} MHz) F(50,10) field at TV ch.6 ${ch6.call || ch6.facility_id || 'station'} Grade B (47 dBu) protected edge: D/U ${fwd.du_actual_db?.toFixed?.(1)} dB fails the ${du_gate_db} dB §73.525(b) gate.`,
        detail:  study
      });
    }
  }

  return {
    cite:    '47 CFR §73.525',
    applicable: true,
    pass:    violations.length === 0,
    subject: subjectShape(subject),
    studies, violations, notes,
    method:  'FCC tvfm_curves.js F(50,10) ↔ §73.683 Grade B (47 dBu) contour-pair study (vendored canonical)',
    du_gate_db,
    fm_channel: frequencyToFmChannel(fm_freq),
    ch6_protected_field_dbu: TV_CH6_GRADE_B_DBU
  };
}

function subjectShape(s){
  return {
    call:           s.call || null,
    facility_id:    s.facility_id || null,
    fcc_class:      s.fcc_class || null,
    frequency_mhz:  Number(s.frequency_mhz),
    erp_kw:         Number(s.erp_kw),
    haat_m:         Number(s.haat_m),
    lat:            Number(s.lat),
    lon:            Number(s.lon)
  };
}

export const SECTION_73_525_PROVENANCE = Object.freeze({
  regulation:        '47 CFR §73.525 — TV ch.6 protection of reserved-band FM',
  related_regulations: ['47 CFR §73.683 (TV Grade B 47 dBu)', '47 CFR §73.699 (TV propagation curves — same Low-VHF family as FM)'],
  du_gates_db: {
    'channel 201–203 (88.1–88.5 MHz)': -45,
    'channel 204–207 (88.7–89.3 MHz)': -55,
    'channel 208–215 (89.5–91.1 MHz)': -65,
    'channel 216–220 (91.3–91.9 MHz)': -75
  },
  ch6_protected_field_dbu: TV_CH6_GRADE_B_DBU,
  post_dtv_status: 'Most full-power ch.6 stations were repacked to higher channels in the 2009 DTV transition.  §73.525 still applies against any active LPTV / Class A "Franken FM" emitters on ch.6 (audio carrier 87.75 MHz).  When no ch.6 stations are supplied, the study reports applicable=true / pass=true / missing_ch6_stations=true so reviewers can confirm no ch.6 protection remains required.',
  license_basis:     '17 U.S.C. § 105 — gates and methodology from §73.525 / §73.683, US Government public domain'
});

export { TV_CH6_GRADE_B_DBU, frequencyToFmChannel };
