// References appendix.
//
// Bibliography of the regulations, datasets, standards, and tooling
// cited or relied upon by the engine.  H&D-style exhibits always close
// with a numbered references list — without one, the reader has no path
// to verify the citations elsewhere in the document.
//
// Most entries are static (47 CFR sections don't change between filings),
// but the dataset SHAs / engine versions are pulled live from the exhibit
// so the reference list ties to the same compute the rest of the report
// describes.  Entries appear only when the corresponding evidence exists
// (e.g. the OET-65 line is present only if exhibit.oet65 exists).

export function buildReferencesSection(exhibit){
  const mv  = exhibit?.method_versions    || {};
  const t   = exhibit?.evidence?.terrain  || {};
  const pop = exhibit?.population_estimate|| {};
  const oet = exhibit?.oet65;
  const ba  = exhibit?.build_attestation;

  const refs = [];
  let n = 1;
  const cite = (label, detail) => refs.push({ n: n++, label, detail });

  // ── 47 CFR rules — always cited
  cite('47 CFR §73.207',
       'Minimum-distance separation requirements (Class-by-Class table).  Source: Code of Federal Regulations, Title 47, Part 73 (current edition).');
  cite('47 CFR §73.208',
       'Reference points and distance computations.  Great-circle distances per the Karney 2013 WGS-84 geodesic implementation.');
  cite('47 CFR §73.211',
       'Power and antenna height requirements (Class-by-Class).');
  cite('47 CFR §73.215',
       'Contour-protection alternative to minimum-distance separation.');
  cite('47 CFR §73.313',
       'HAAT (Height Above Average Terrain) computation methodology.');
  cite('47 CFR §73.316',
       'FM transmitting antenna systems; directional antenna pattern requirements.');
  cite('47 CFR §73.333',
       'Engineering charts and related formulas.  F(50,50) and F(50,10) propagation charts; primary basis for service / interfering contour distances.');

  if (exhibit?.regulatory_compliance?.section_73_207?.evaluated){
    cite('FCC Form 301-FM',
         'Application for Construction Permit for Commercial Broadcast Station — FM service.  Section III (Engineering Data) field schema referenced by Genoa\'s LMS filing-package generator.');
  }

  if (oet){
    cite('47 CFR §1.1307, §1.1310',
         'Categorical and routine evaluation of routine RF exposure for broadcast stations; maximum permissible exposure (MPE) limits, controlled vs uncontrolled environments.');
    cite('OET Bulletin 65 (Edition 97-01) Supplement A',
         'Federal Communications Commission, Office of Engineering and Technology, Evaluating Compliance with FCC Guidelines for Human Exposure to Radiofrequency Electromagnetic Fields, August 1997.  Simplified far-field equations used by the Genoa OET-65 engine.');
  }

  // ── Datasets — cited only if attached
  if (mv.dataset){
    cite(`FCC propagation charts — ${mv.dataset}`,
         `Curve table dataset (SHA256 ${(mv.dataset_meta_sha256 || '').slice(0, 16)}…) digitized from §73.333 Figures 1A–1B (F(50,50)) and 1A2–1B2 (F(50,10)).  Bit-exact replay verified against FCC distance.json reference samples.`);
  }
  if (t.available && t.dem){
    cite(`${t.dem.source || 'DEM'} ${t.dem.dataset || ''}`.trim(),
         `Digital elevation model used for §73.313 per-radial HAAT.  Method: ${t.method || 'fcc-hd-radials'}.  Sampled along ${(t.profiles || []).length || 8} cardinal radials.`);
  }
  if (pop?.source && pop?.dataset){
    cite(`${pop.source} — ${pop.dataset} (vintage ${pop.vintage || '—'})`,
         `Population dataset.  Aggregation rule: ${pop.method || 'centroid-in-polygon'}.  Dataset SHA256 ${(pop.sha256 || '').slice(0, 16)}${pop.sha256 ? '…' : ''}.  Informational only; not a compliance input under §73.x.`);
  }

  // ── Standards
  cite('Karney, C. F. F. (2013)',
       '"Algorithms for geodesics."  Journal of Geodesy 87 (1): 43–55.  doi:10.1007/s00190-012-0578-z.  Used by Genoa for all WGS-84 great-circle distance and azimuth computations.');
  cite('IEEE Std 211-2018',
       'IEEE Standard Definitions of Terms for Radio Wave Propagation.  Used for terminology consistency (HAAT, ERP, F(50,50), service contour).');
  if (oet){
    cite('IEEE Std C95.1-2019',
         'IEEE Standard for Safety Levels with Respect to Human Exposure to Electric, Magnetic, and Electromagnetic Fields, 0 Hz to 300 GHz.  Reference for MPE-limit cross-checks.');
  }
  if (exhibit?.evidence?.itm_coverage){
    cite('ITU-R P.526',
         'Propagation by diffraction.  Knife-edge / cylinder diffraction reference used by the Genoa ITM tier for terrain-aware coverage shaping.');
    cite('Bullington, K. (1947)',
         '"Radio propagation at frequencies above 30 megacycles."  Proceedings of the IRE 35 (10): 1122–1136.  Smooth-earth diffraction model used by ITM tier 1.');
  }

  // ── Tooling provenance — replay-token / build attestation
  if (ba){
    cite('Genoa FCC Propagation Studio',
         `Engine build attestation: SHA ${(ba.sha || '').slice(0, 12)}, release ${ba.release_tag || '—'}, fingerprint ${(ba.fingerprint_hash || '').slice(0, 16)}.  HMAC-signed under the deploy's BUILD_SIGNING_SECRET.  Replay verifiable via POST /api/exhibits/verify-replay-token.  Engine version ${mv.engine_version || 'genoa-2.0'}.`);
  } else {
    cite('Genoa FCC Propagation Studio',
         `Engine version ${mv.engine_version || 'genoa-2.0'}.  This compute was produced without a build attestation block; the licensee should re-run on a deploy that emits exhibit.build_attestation before filing if reproducibility is at issue.`);
  }

  const tableRows = refs.map(r => ({
    n:      `[${r.n}]`,
    label:  r.label,
    detail: r.detail
  }));

  return {
    id:      'references',
    type:    'table',
    heading: 'References',
    preface: 'Bibliography of regulations, datasets, standards, and tooling cited or relied upon in the preparation of this exhibit.  Citations are stable (47 CFR rules, IEEE standards) where possible and pinned to dataset SHAs where the underlying data may evolve.',
    table: {
      columns: [
        { key: 'n',      label: '#',         width: 0.06, align: 'right' },
        { key: 'label',  label: 'Reference', width: 0.36 },
        { key: 'detail', label: 'Detail',    width: 0.58 }
      ],
      rows: tableRows
    }
  };
}
