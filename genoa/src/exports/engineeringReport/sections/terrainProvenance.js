// Terrain provenance section.
//
// Dedicated section that consolidates everything an FCC reviewer would
// want to know about the DEM source and HAAT methodology behind the
// per-radial heights used in §73.313 / §73.333 calculations.  H&D-style
// exhibits ALWAYS state DEM source, dataset version, sampling method,
// radial spacing, and fetch timestamp — without it the contour
// distances are unverifiable.  The data is already attached to
// exhibit.evidence.terrain at compute time; this section just typesets
// it as a numbered exhibit (Roman) instead of letting it sit only in
// the JSON dump.

export function buildTerrainProvenanceSection(exhibit){
  const t = exhibit?.evidence?.terrain;
  if (!t || !t.available){
    return {
      id:      'terrain-provenance',
      type:    'paragraphs',
      heading: 'Terrain Provenance',
      paragraphs: [
        'No per-radial terrain evidence is attached to this exhibit.  HAAT was treated as the filed value (CONSTANT_HAAT_ASSUMED warning attached at compute time, if present); the engineer of record must confirm the filed HAAT was derived per 47 CFR §73.313 from a recognized DEM source before filing.',
        'For full filing-grade provenance, re-run the compute with the terrain sidecar configured (TERRAIN_SIDECAR_URL set, USGS EPQS or equivalent reachable).  Genoa will then attach exhibit.evidence.terrain with DEM source, dataset version, sampling method, radial count, and fetch timestamp.'
      ]
    };
  }

  const dem      = t.dem || {};
  const radials  = (t.profiles || []).length;
  const samplePt = t.profiles?.[0]?.samples?.length;
  const radialKm = t.radial_extent_km ?? t.profile_extent_km ?? null;

  const rows = [
    ['DEM source',          dem.source || t.source || '—'],
    ['DEM dataset',         dem.dataset || '—'],
    ['DEM version / vintage', dem.version || dem.vintage || '—'],
    ['Sampling method',     t.method || 'fcc-hd-radials (47 CFR §73.313)'],
    ['Radial count',        radials ? `${radials} cardinal radials` : '—'],
    ['Samples per radial',  samplePt != null ? String(samplePt) : '—'],
    ['Radial extent',       radialKm != null ? `${radialKm} km` : '—'],
    ['HAAT averaging band', t.averaging_band_km || '3.2–16.1 km per §73.313(d)'],
    ['Interpolation',       t.interpolation || 'bilinear DEM lookup at sample lat/lon'],
    ['Cache provenance',    t.cache_source || (t.cached ? 'sidecar cache' : 'live fetch')],
    ['Sidecar source',      t.source || '—'],
    ['Sidecar endpoint',    t.endpoint || '—'],
    ['Fetched at',          t.fetched_at || '—']
  ];

  const preface =
    'The per-radial Height Above Average Terrain (HAAT) values used to compute the §73.333 / §73.313 contour distances reported in this exhibit were derived from the digital elevation model (DEM) and methodology recorded below.  Provenance is included so that any FCC reviewer or independent engineer can replay the DEM lookups under the same conditions.';

  const summary =
    `${radials || 0} radials sampled${dem.source ? ` from ${dem.source}` : ''}${dem.dataset ? ` (${dem.dataset})` : ''} via ${t.method || 'fcc-hd-radials'}.  Sidecar timestamp ${t.fetched_at || 'not recorded'}.  Re-running the same compute against the same DEM dataset version reproduces these heights to within the DEM's published vertical accuracy.`;

  return {
    id:      'terrain-provenance',
    type:    'paragraphs-with-kv',
    heading: 'Terrain Provenance',
    paragraphs: [preface, summary],
    rows
  };
}
