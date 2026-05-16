// Tower Study section.
//
// New numbered exhibit that consolidates everything an FCC reviewer
// would want about the structure on which the licensed antenna is
// mounted: the §17.4 Antenna Structure Registration record, the
// FAA OE/AAA Form 7460-2 determination (when present), and the
// rules-derived marking + lighting recommendation per §17.21 / §17.23
// + AC 70/7460-1L.  This is the H&D-style "Tower Study" deliverable
// that consultants charge several hours to assemble — Genoa folds it
// into the engineering exhibit automatically when the upstream
// evidence is attached.
//
// Inputs (all sourced from prior compute steps):
//   exhibit.evidence.asr           — ASR record (asrClient output)
//   exhibit.evidence.faa_oe        — FAA OE/AAA case-file record (faaOeClient)
//   exhibit.tower_compliance       — rules-derived marking + lighting + ASR cmp
//
// When none are attached, emits a deferred-to-engineer note rather
// than dropping the section.

export function buildTowerStudySection(exhibit){
  const asr      = exhibit?.evidence?.asr;
  const faa      = exhibit?.evidence?.faa_oe;
  const cmpl     = exhibit?.tower_compliance;

  // No evidence at all → deferred-to-engineer placeholder.  Still
  // emits a numbered exhibit so reviewers see "Tower Study — deferred
  // to engineer of record" instead of an absent section.
  if (!asr?.available && !cmpl?.applicable){
    return {
      id:      'tower-study',
      type:    'paragraphs',
      heading: 'Tower Study',
      paragraphs: [
        'No Antenna Structure Registration (ASR) record is attached to this exhibit.  47 CFR §17.4 requires registration of any antenna structure subject to FAA notification under §17.7 (typically structures > 200 ft AGL or near a public-use airport).  When an ASR number is supplied with the application, Genoa cross-checks the registered tower data against the application and surfaces any mismatch.',
        'For a complete Tower Study, supply station_inputs.asr_number and re-run the compute with ASR_SOCRATA_URL (default opendata.fcc.gov), ASR_SIDECAR_URL, or a ZTR rich-station response that carries _tower / asr_number.  The Tower Study section will then quote the ASR record, the FAA OE/AAA Form 7460-2 determination (when faa_study_number is on file), and the rules-derived §17.21 / §17.23 marking + lighting recommendation.'
      ]
    };
  }

  /* -------- Build the consolidated KV table -------- */
  // Single rows array keeps the existing 'paragraphs-with-kv' shape;
  // sub-section dividers are emitted as label-only rows for visual
  // grouping in both the TXT and PDF renderers.
  const rows = [];
  const divider = (title) => rows.push(['— —', `— ${title} —`]);

  /* §17.4 ASR record */
  if (asr?.available){
    divider('47 CFR §17.4 — Antenna Structure Registration');
    rows.push(
      ['ASR registration #',   asr.asr_number || '—'],
      ['Source',               sourceLabel(asr.source)],
      ['Owner',                asr.owner || '—'],
      ['Status',               asr.status || '—'],
      ['Latitude',             fmtCoord(asr.latitude_deg, 'N', 'S')],
      ['Longitude',            fmtCoord(asr.longitude_deg, 'E', 'W')],
      ['Overall height AGL',   fmtMeters(asr.overall_height_m)],
      ['Overall height AMSL',  fmtMeters(asr.overall_height_amsl_m)],
      ['Ground elevation',     fmtMeters(asr.ground_elevation_m)],
      ['FAA lighting code',    asr.lighting_requirement || '—'],
      ['FAA painting code',    asr.painting_requirement || '—'],
      ['FAA study number',     asr.faa_study_number     || '—'],
      ['Endpoint',             asr.endpoint             || '—'],
      ['Fetched at',           asr.fetched_at           || '—']
    );
  } else if (asr && asr.error){
    divider('§17.4 ASR — lookup attempted');
    rows.push(['Status', `${asr.error}`]);
  }

  /* FAA OE/AAA determination */
  if (faa && faa.available){
    divider('FAA OE/AAA — Form 7460-2 determination');
    rows.push(
      ['Aeronautical Study #', faa.study_number       || '—'],
      ['Determination',        faa.determination      || '—'],
      ['Determination date',   faa.determination_date || '—'],
      ['Expiration date',      faa.expiration_date    || '—'],
      ['Expired now?',         faa.cross_check?.expired === true ? 'YES — re-study required (FAA Order JO 7400.2 §6-3-3)' :
                               faa.cross_check?.expired === false ? 'No (current)' : '—'],
      ['Structure type',       faa.structure_type     || '—'],
      ['FAA latitude',         fmtCoord(faa.latitude_deg, 'N', 'S')],
      ['FAA longitude',        fmtCoord(faa.longitude_deg, 'E', 'W')],
      ['FAA height AGL',       fmtMeters(faa.height_agl_m)],
      ['FAA height AMSL',      fmtMeters(faa.height_amsl_m)],
      ['FAA conditions',       Array.isArray(faa.conditions) && faa.conditions.length
                                  ? faa.conditions.join('; ')
                                  : '— (none recorded; verify FAA letter)'],
      ['Endpoint',             faa.endpoint           || '—'],
      ['Fetched at',           faa.fetched_at         || '—']
    );
  } else if (asr?.faa_study_number){
    divider('FAA OE/AAA — lookup deferred');
    rows.push(
      ['Aeronautical Study #', asr.faa_study_number],
      ['Status',               'No FAA OE record attached.  Set FAA_OE_SIDECAR_URL on the deploy (operator-managed proxy) and re-run the compute, or consult oeaaa.faa.gov directly for the determination + conditions.']
    );
  }

  /* Rules-derived marking + lighting recommendation */
  if (cmpl?.applicable){
    divider('§17.21 / §17.23 + FAA AC 70/7460-1L — rules-derived recommendation');
    rows.push(
      ['Notification required (§17.7)', cmpl.notification_required ? 'YES — structure > 200 ft AGL or near airport' : 'No (under threshold)'],
      ['Structure type',                cmpl.structure_type      || 'TOWER'],
      ['Height AGL',                    `${fmtMeters(cmpl.height_agl_m)} (${cmpl.height_agl_ft || '—'} ft)`],
      ['Required marking',              cmpl.marking?.required  ? styleLabel(cmpl.marking.style)  : 'Not required'],
      ['Required lighting',             cmpl.lighting?.required ? styleLabel(cmpl.lighting.style) : 'Not required'],
      ['Marking authority',             (cmpl.marking?.cites  || []).map(c => c.rule).join(' · ') || '—'],
      ['Lighting authority',            (cmpl.lighting?.cites || []).map(c => c.rule).join(' · ') || '—']
    );
  }

  /* Rules ↔ ASR comparison */
  if (cmpl?.comparison?.applicable){
    divider('Rules-derived vs ASR record — comparison');
    rows.push(
      ['Match',              cmpl.comparison.matches ? 'YES — recommendation aligns with ASR' : `NO — ${cmpl.comparison.n_gaps} gap(s)`],
      ['ASR lighting code',  cmpl.comparison.asr_lighting || '—'],
      ['ASR lighting family', cmpl.comparison.asr_family || '—'],
      ['ASR painting code',  cmpl.comparison.asr_painting || '—']
    );
    if (Array.isArray(cmpl.comparison.gaps)){
      cmpl.comparison.gaps.forEach((g, i) => {
        rows.push([
          `Gap ${i + 1} (${g.severity})`,
          `${g.field} — rules=${describe(g.rules_value)} vs ASR=${describe(g.asr_value)}${g.cite ? ' · ' + g.cite : ''}${g.note ? ' · ' + g.note : ''}`
        ]);
      });
    }
  }

  /* -------- Section assembly -------- */

  const preface =
    'This section consolidates the Antenna Structure Registration (ASR) record on file with the FCC, the FAA OE/AAA Form 7460-2 determination (when an Aeronautical Study Number is referenced), and the rules-derived marking + lighting recommendation that Genoa computes from §17.21, §17.23, and FAA AC 70/7460-1L.  A complete Tower Study is filing-grade evidence that the antenna structure has been registered, that the FAA has reviewed the structure for navigable-airspace impact, and that the marking + lighting in place agrees with the FAA-issued requirement.';

  const summaryParts = [];
  if (asr?.available){
    summaryParts.push(`ASR ${asr.asr_number || ''} sourced from ${sourceLabel(asr.source)}`);
  }
  if (faa?.available){
    summaryParts.push(`FAA OE study ${faa.study_number || ''} (${faa.determination || 'pending'})`);
  } else if (asr?.faa_study_number){
    summaryParts.push(`FAA OE study ${asr.faa_study_number} referenced on the ASR but no determination is attached (set FAA_OE_SIDECAR_URL to enable lookup)`);
  }
  if (cmpl?.applicable){
    summaryParts.push(`rules-derived ${styleLabel(cmpl.lighting.style)} (per ${(cmpl.lighting.cites?.[0]?.rule) || 'AC 70/7460-1L'})`);
  }
  const summary = summaryParts.length
    ? `${summaryParts.join(' · ')}.  ${cmpl?.comparison?.matches === false
        ? `Tower compliance comparison flagged ${cmpl.comparison.n_gaps} gap(s) — see the comparison rows below.  An FAA-issued case-specific letter typically explains a benign mismatch; verify the letter is on file before filing.`
        : 'Comparison shows the rules-derived recommendation aligns with the ASR record.'}`
    : 'Partial Tower Study — see deferred-to-engineer note above.';

  return {
    id:         'tower-study',
    type:       'paragraphs-with-kv',
    heading:    'Tower Study',
    paragraphs: [preface, summary],
    rows
  };
}

/* -------------------- formatters -------------------- */

function fmtCoord(deg, posSuffix, negSuffix){
  if (!Number.isFinite(deg)) return '—';
  const a = Math.abs(deg);
  const dir = deg >= 0 ? posSuffix : negSuffix;
  return `${a.toFixed(6)}° ${dir}`;
}

function fmtMeters(m){
  if (!Number.isFinite(m)) return '—';
  const ft = m / 0.3048;
  return `${m.toFixed(1)} m (${ft.toFixed(1)} ft)`;
}

function sourceLabel(src){
  if (!src) return '—';
  return ({
    'zerotrustradio':       'ZTR rich-station _tower / asr_number',
    'fcc-opendata-socrata': 'opendata.fcc.gov Socrata (FCC ASR DB)',
    'asr-sidecar':          'operator-managed ASR_SIDECAR_URL proxy',
    'fcc-uls-html':         'FCC ULS HTML (legacy fallback)'
  })[src] || src;
}

function styleLabel(style){
  if (!style) return '—';
  return ({
    'none':                              'None',
    'aviation-orange-and-white-bands':   'Aviation Orange + White paint bands (AC Ch 3)',
    'lighting-in-lieu-of-paint':         'Lighting in lieu of paint (§17.23(c))',
    'red-obstruction-type-a':            'Red Obstruction Type A — L-864 + L-810 (AC Ch 4)',
    'medium-intensity-dual-red-white':   'Medium-Intensity Dual L-864/L-865 (AC Ch 6)',
    'high-intensity-flashing-white':     'High-Intensity Flashing White L-856 (AC Ch 7)',
    'high-intensity-case-specific':      'High-Intensity + FAA case-specific letter (AC Ch 7)'
  })[style] || style;
}

function describe(v){
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v || '—';
  if (typeof v === 'number') return String(v);
  return JSON.stringify(v);
}
