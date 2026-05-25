// Cross-section identity helpers — community-of-license and station class.
//
// WHY
//   Two sections quote the operator-facing identity of the station: the
//   cover page (`cover.js`) and the executive summary (`executiveSummary.js`).
//   Real exhibits stash the same facts under many keys, depending on which
//   upstream enrichment ran — operator-typed `station_inputs`, FCC LMS
//   pulls (`evidence.fcc_lms.license`, `evidence.fcc_lms.raw`), the broader
//   `facility_metadata` block (incl. `facility_metadata.raw`), and the
//   `licensing` block.  When the two sections walk different fallback
//   chains, the cover reads "CASAS ADOBES" and the exec summary reads
//   "— (community-of-license not stated)" on the same exhibit (KAZM,
//   engine 0e9ce1b).
//
// SHAPE
//   Both helpers walk the *union* of every key path either section
//   previously consulted, in the order most-explicit → least-explicit.
//   Returns the first non-empty string, or `null`.

function pick(...vals){
  for (const v of vals){
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (s) return s;
  }
  return null;
}

export function resolveCommunity(exhibit){
  const s      = exhibit?.station_inputs              || {};
  const lic    = exhibit?.licensing                   || {};
  const fm     = exhibit?.facility_metadata           || {};
  const lmsLic = exhibit?.evidence?.fcc_lms?.license  || {};
  const fmRaw  = exhibit?.facility_metadata?.raw      || {};
  const lmsRaw = exhibit?.evidence?.fcc_lms?.raw      || {};
  return pick(
    s.community, s.community_of_license, s.city, s.licensing_community,
    lic.community, lic.community_of_license, lic.city, lic.licensing_community,
    lmsLic.community, lmsLic.community_of_license, lmsLic.city, lmsLic.licensing_community,
    fm.community, fm.community_of_license, fm.city,
    fmRaw.community, fmRaw.community_of_license, fmRaw.city, fmRaw.licensing_community,
    lmsRaw.community, lmsRaw.community_of_license, lmsRaw.city
  );
}

export function resolveClass(exhibit){
  const s      = exhibit?.station_inputs              || {};
  const lic    = exhibit?.licensing                   || {};
  const fm     = exhibit?.facility_metadata           || {};
  const lmsLic = exhibit?.evidence?.fcc_lms?.license  || {};
  const fmRaw  = exhibit?.facility_metadata?.raw      || {};
  const lmsRaw = exhibit?.evidence?.fcc_lms?.raw      || {};
  return pick(
    s.fcc_class, s.class, s.station_class,
    lic.fcc_class, lic.station_class, lic.class,
    lmsLic.fcc_class, lmsLic.station_class, lmsLic.class,
    fm.fcc_class, fm.station_class, fm.class,
    fmRaw.fcc_class, fmRaw.station_class, fmRaw.class,
    lmsRaw.fcc_class, lmsRaw.station_class, lmsRaw.class
  );
}
