// Purpose of study — applicable rules + Genoa reproducibility statement.

export function buildPurposeSection(exhibit){
  const svc = String(exhibit.station_inputs?.service || '').toUpperCase();
  const ruleSet = applicableRules(svc);
  return {
    id:      'purpose',
    type:    'paragraphs',
    heading: 'PURPOSE OF STUDY',
    paragraphs: [
      'This engineering exhibit has been prepared to evaluate compliance with the Commission\'s technical rules for the referenced ' + serviceWords(svc) + ' broadcast facility.'
    ],
    list: ruleSet,
    list_label: 'Applicable rules:',
    closing_paragraph:
      'All results are deterministically reproducible from the normalized input record, terrain source, curve dataset, and engine version identified in this report.'
  };
}

function serviceWords(svc){
  switch (svc){
    case 'FM':   return 'FM';
    case 'AM':   return 'AM';
    case 'LPFM': return 'LPFM';
    case 'FX':   return 'FM translator';
    default:     return '';
  }
}

function applicableRules(svc){
  if (svc === 'FM' || svc === 'LPFM'){
    return [
      '47 CFR §73.207 — Minimum distance separation requirements',
      '47 CFR §73.215 — Contour protection',
      '47 CFR §73.313 — Height Above Average Terrain (HAAT)',
      '47 CFR §73.333 — FM propagation curves'
    ];
  }
  if (svc === 'FX'){
    return [
      '47 CFR §74.1204 — FM translator interference protection',
      '47 CFR §74.1235 — FM translator service contour',
      '47 CFR §73.313 — Height Above Average Terrain (HAAT)',
      '47 CFR §73.333 — FM propagation curves'
    ];
  }
  if (svc === 'AM'){
    return [
      '47 CFR §73.182 — AM service contour standards',
      '47 CFR §73.183 — Engineering standards of allocation',
      '47 CFR §73.184 — Groundwave field strength curves',
      '47 CFR §73.187 — Limitations on daytime radiation',
      '47 CFR §73.190 — Engineering charts and related formulas (skywave)'
    ];
  }
  return [];
}
