// Plain-English educational sub-sections for AM exhibits — written
// for non-engineer readers (GM, station owner, city planning department,
// land-use board).  Real-world reference: Hatfield & Dawson Mercer
// Slough Report (Nov 2002) pages 7-16, which devote nine short
// chapters to teaching the reader before the technical body lands.
//
// Five mini-chapters here, all sourced verbatim or paraphrased from
// the Mercer Slough text + the cited FCC Standards of Good
// Engineering Practice Concerning Standard Broadcast Stations (1939):
//
//   1. MW Radio Propagation — groundwave vs skywave, why σ matters
//   2. Soil-conductivity reference (FCC 1939 Table B verbatim)
//   3. Blanketing Contours — what §73.24(g) is for
//   4. Ground System — why 120 buried radials at quarter-wavelength
//   5. Maintenance Recommendations — for existing_facility_review intent
//
// All rendered as PARAGRAPHS sections (no schema change required) so
// the existing PDF renderer handles them with the same logic that
// handles METHODOLOGY paragraphs.  Each section's `id` carries the
// chapter slug so renderers / readers can cross-reference.

// FCC 1939 Standards of Good Engineering Practice — Table B
// (verbatim, adapted for modern SI).  Sourced from the Bellevue
// Mercer Slough Report (Hatfield & Dawson, Nov 2002, page 10),
// which cites: FCC, Standards of Good Engineering Practice
// Concerning Standard Broadcast Stations (550-1600 kc.) 1939.
// United States Government Printing Office, Washington: 1944,
// Table B.  Adopted into the FCC rules in 1956; portions
// incorporated into the modern Rules in the mid-1980s.
export const FCC_1939_CONDUCTIVITY_TABLE = Object.freeze([
  ['Sea Water',                                              '5000 mS/m'],
  ['Pastoral Land, Rich Soils, River Bottoms, Low Hills',   '30 mS/m – 10 mS/m'],
  ['Pastoral Land, Densely Wooded',                          '8 mS/m – 2 mS/m'],
  ['Pastoral Land, Medium Hills, Medium Forestation, Clay Soil', '6 mS/m – 1 mS/m'],
  ['Rocky Soil, Steep Hills, Sandy Soil',                    '2 mS/m – 0.1 mS/m'],
  ['City Industrial Areas – Average Attenuation',            '1 mS/m'],
  ['City Industrial Areas – Maximum Attenuation',            '0.1 mS/m']
]);

export function buildMwEducationalSections(exhibit){
  const s = exhibit?.station_inputs || {};
  const svc = String(s.service || '').toUpperCase();
  const isAm = svc === 'AM' || svc === 'AX';
  if (!isAm) return [];   // FM/TV exhibits don't need MW educational content

  const sections = [];
  const intent = s.study_intent || '';

  // ── 1. MW Radio Propagation ────────────────────────────────────────
  // Paraphrased from Hatfield & Dawson Mercer Slough page 7 "MW Radio
  // Propagation" chapter.  Keeps the plain-English voice that makes
  // the section accessible to a city planning board.
  sections.push({
    id:      'edu-mw-propagation',
    type:    'paragraphs',
    heading: 'BACKGROUND — MW RADIO PROPAGATION',
    paragraphs: [
      'Medium-wave (AM broadcast, 530-1700 kHz) signals propagate differently from VHF radio (FM, TV).  FM and TV signals travel by line-of-sight and require elevated antennas; AM signals travel by GROUNDWAVE during daytime, following the curvature of the Earth along the soil surface.  Signal strength and distance traveled are directly dependent on the electrical conductivity of the soil along that path — higher-conductivity soil allows the signal to travel farther.',
      'After sundown, AM signals also travel by SKYWAVE — radio waves reflected back to Earth by the ionosphere (30-250 miles above the surface).  Skywave signals can travel much farther than groundwaves; tuning across the AM band at night, distant stations from hundreds of miles away are routinely receivable.  The propagation change between daytime and nighttime is why most AM facilities use different antenna configurations or power levels day vs. night — to minimize interference with co-channel and adjacent-channel stations.',
      'For best groundwave performance, the transmitter must be sited in an area of good ground conductivity.  Higher-conductivity surface material lets the MW signal travel farther.  River-bottom soil (silt) is a better conductor than gravel or glacial hardpan, due to silt\'s ability to retain water.  Broadcasters prefer the highest conductivity soil available, which is why the overwhelming majority of MW stations are sited within 2,000 feet of large bodies of water or river-bottom environments.'
    ]
  });

  // ── 2. FCC 1939 Conductivity Table (Hatfield & Dawson Table 1) ─────
  // Verbatim from the 1939 Standards of Good Engineering Practice,
  // cited in Mercer Slough page 10.  Modern AM allocations still rely
  // on the §73.190 Figure M3 derivative of this table — surfacing the
  // original 1939 table makes the regulatory lineage explicit.
  sections.push({
    id:      'edu-conductivity-table',
    type:    'paragraphs-with-kv',
    heading: 'BACKGROUND — TYPICAL GROUND CONDUCTIVITY',
    paragraphs: [
      'The FCC compiled measured ground conductivities for typical surface materials into a reference table that has been the basis for MW allocation planning since the 1950s.  Source: Federal Communications Commission, Standards of Good Engineering Practice Concerning Standard Broadcast Stations (550-1600 kc.) 1939, USGPO Washington 1944, Table B.  This information was incorporated into the FCC rules in 1956 and is the foundation under the §73.190 Figure M3 conductivity map used for modern allocation studies.',
      'Cf. Hatfield & Dawson Bellevue Mercer Slough Report (Nov 2002) Table 1 — the same reference table that consulting engineers cite when explaining ground-conductivity assumptions to non-engineer reviewers.'
    ],
    rows: FCC_1939_CONDUCTIVITY_TABLE
  });

  // ── 3. Blanketing Contours ─────────────────────────────────────────
  sections.push({
    id:      'edu-blanketing-contours',
    type:    'paragraphs',
    heading: 'BACKGROUND — BLANKETING CONTOURS',
    paragraphs: [
      'When an AM signal reaches a consumer-electronic device with enough field strength, it can overload the device\'s input circuits and corrupt the signal the device is trying to receive — radios, televisions, computer audio, garage-door openers, baby monitors.  The FCC defines the BLANKETING CONTOUR as the locus where the AM signal is at or above 1 V/m (1000 mV/m, also written 115.6 dBu).',
      'Under 47 CFR §73.24(g), if the population residing within the 1000 mV/m blanket contour exceeds 1.0% of the population residing within the 25 mV/m groundwave contour, the licensee is obligated to remediate complaints from those residents — re-tuning affected consumer electronics, replacing damaged devices, or in some cases relocating the consumer\'s antenna.  The Appendix J 8 km site survey and the §73.24(g) compliance component in the validation verdict together surface every constraint the licensee may be required to address.'
    ]
  });

  // ── 4. Ground System ───────────────────────────────────────────────
  sections.push({
    id:      'edu-ground-system',
    type:    'paragraphs',
    heading: 'BACKGROUND — GROUND SYSTEM',
    paragraphs: [
      'AM broadcast antennas radiate as VERTICAL MONOPOLES — the tower itself is the antenna, and the radiated field is referenced against an idealized perfect-ground image plane.  Real soil is imperfect, so every authorized AM facility includes a GROUND SYSTEM — buried copper radials that extend the conducting plane outward and approximate the ideal image.  The FCC standard is 120 equally-spaced radials, each at least a quarter-wavelength long (75-145 m depending on frequency).',
      'A poorly-maintained or partially-removed ground system reduces the antenna\'s effective height, lowering the inverse-distance field at 1 km (RMS) below the authorized value.  §73.150 requires the as-built RMS to be at least 85% of the authorized RMS; a non-compliant ground system is the most common cause of falling below that threshold.  The §73.150 DA pattern compliance component in the validation verdict captures this when an authorized_pattern_table is attached for comparison.'
    ]
  });

  // ── 5. Maintenance Recommendations ─────────────────────────────────
  // Only renders for existing-facility-review intent (where the
  // licensee asked for an operational review, not a filing-grade
  // engineering study).  Cf. Mercer Slough page 21 "Maintenance
  // Recommendations" chapter.
  if (intent === 'existing_facility_review'){
    sections.push({
      id:      'maintenance-recommendations',
      type:    'paragraphs',
      heading: 'MAINTENANCE RECOMMENDATIONS',
      paragraphs: [
        'For continued operation at licensed performance, an AM transmitting facility requires regular inspection and maintenance of three independent systems: (a) the antenna tower(s) and structural members, (b) the radial ground system, and (c) the transmitter / phasor / antenna-tuning equipment.',
        'TOWER inspection should be performed at least annually by a Registered Professional Engineer qualified to render opinions on guyed communications towers.  The inspection covers structural members, foundation, guy anchors, painting / lighting per FAA Part 17, and the base insulator (for series-fed towers) or unipole feed point (for folded-unipole towers).  Any structural deficiency that affects the radiation pattern or RMS field strength must be reported and corrected before next license renewal.',
        'GROUND SYSTEM inspection should be performed every 2-3 years.  Standard practice is to verify radial continuity with a low-frequency conductivity bridge at multiple azimuths; broken or oxidized radials reduce as-built RMS below the §73.150 85% minimum.  Where radials have been buried for many decades and surface conditions changed (wetland fill, parking-lot pavement, etc.) re-installation per the FCC standard pattern may be warranted.',
        'TRANSMITTER and antenna-tuning equipment should be exercised and measured on the schedule recommended by the equipment manufacturer (typically monthly remote-meter readings and annual proof-of-performance measurements).  Common-point impedance and base-current readings should be logged and compared to the licensed values; significant deviation usually indicates an antenna-tuning unit (ATU) drift or a damaged sample loop.',
        'In addition to the routine inspections above, every site must have VEHICLE ACCESS for equipment loading / generator fueling and EMERGENCY-VEHICLE ACCESS for fire / medical aid.  The transmitter site should be maintained so that brush and vegetation do not encroach on antenna structures or ground-system radials.  Cf. Hatfield & Dawson Bellevue Mercer Slough Report (Nov 2002), Maintenance Recommendations chapter, page 21.'
      ]
    });
  }

  return sections;
}
