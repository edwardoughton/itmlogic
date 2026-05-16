// Population methodology section.
//
// Population numbers in §73.x filings are INFORMATIONAL ONLY — FCC
// compliance is determined by distance and field-strength tests, not
// population counts.  H&D-style exhibits nonetheless dedicate a brief
// methodology page so the licensee can understand provenance, dataset
// vintage, and the contour-weighting rule applied.  Without this, a
// reviewer is left wondering whether the persons-served figure came
// from the Census API, an internal estimate, or a placeholder.

export function buildPopulationMethodologySection(exhibit){
  const pop = exhibit?.population_estimate;
  if (!pop){
    return null;   // skip — nothing to typeset and Population is informational
  }

  const isPlaceholder = !pop.source && !pop.vintage;
  const isFailed      = pop.attempt_status === 'failed';

  if (isPlaceholder){
    return {
      id:      'population-methodology',
      type:    'paragraphs',
      heading: 'Population Methodology (Informational)',
      paragraphs: [
        'No population estimate is attached to this exhibit.  Population is informational under 47 CFR §73.x — FCC compliance is determined by distance and field-strength tests, not population counts — and is therefore not required for filing.',
        'If the licensee elects to include a persons-served figure in the filing narrative, the Genoa orchestrator can compute one via the FCC Census Block API once the exhibit carries valid lat/lon coordinates.'
      ]
    };
  }

  if (isFailed){
    return {
      id:      'population-methodology',
      type:    'paragraphs',
      heading: 'Population Methodology (Informational)',
      paragraphs: [
        `An attempt to compute a population estimate via ${pop.attempted_source || 'the configured upstream'} failed during compute (${pop.attempt_error || 'cause unspecified'}).  No persons-served figure is reported in this exhibit.`,
        'Population is informational under 47 CFR §73.x — its absence does not affect filing readiness — but the licensee may re-run the compute with a reachable upstream if a persons-served figure is desired in the filing narrative.'
      ]
    };
  }

  const rows = [
    ['Persons served',         pop.primary != null ? Number(pop.primary).toLocaleString() : '—'],
    ['Bounding contour',       pop.contour_label || '—'],
    ['Source',                 pop.source || '—'],
    ['Dataset',                pop.dataset || '—'],
    ['Vintage',                String(pop.vintage ?? '—')],
    ['Method',                 pop.method  || '—'],
    ['Endpoint',               pop.endpoint || '—'],
    ['Dataset SHA256',         (pop.sha256 || '').slice(0, 12) + (pop.sha256 ? '…' : '—')],
    ['Fetched at',             pop.fetched_at || '—'],
    ['Compliance role',        'INFORMATIONAL ONLY — §73.x compliance is field-strength-based, not population-based']
  ];

  const paragraphs = [
    `Population served within the bounding contour is sourced from ${pop.source}${pop.dataset ? ` (${pop.dataset}` : ''}${pop.vintage ? `, vintage ${pop.vintage}` : ''}${pop.dataset ? ')' : ''}.  Block-level population was retrieved live from the upstream endpoint at compute time; the dataset SHA256 in the table below pins the exact dataset payload returned.`,
    `Aggregation rule: ${pop.method || 'centroid-in-polygon'}.  A Census block is included if its centroid falls inside the closed contour ring; partial-block weighting is not applied.  The choice of bounding contour (${pop.contour_label || '—'}) follows the standard §73.333 city-grade convention for the subject service.`,
    'Population is reported here for informational reference only.  Under 47 CFR §73.x the regulatory tests are distance- and field-strength-based.  This figure is not used by the engine in any pass/fail determination, nor should it be relied upon by the FCC reviewer as a compliance metric.'
  ];

  return {
    id:      'population-methodology',
    type:    'paragraphs-with-kv',
    heading: 'Population Methodology (Informational)',
    paragraphs,
    rows
  };
}
