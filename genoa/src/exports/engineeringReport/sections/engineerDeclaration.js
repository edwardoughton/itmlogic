// Engineer Declaration — sworn / declared statement that sits at the
// VERY FRONT of the exhibit, before the technical body.  Real-world
// reference: Mullaney KELP 1989 page 4 — "R. Morgan Burrow, Jr.,
// declares and states that he is a radio engineer whose qualifications
// are known to the Federal Communications Commission, and that he is
// an associate engineer in the firm of Mullaney Engineering, Inc...."
//
// This is DIFFERENT from the post-technical-body Certification block
// (which is the signed-and-sealed page that ships with FCC filings).
// The Declaration is a sworn preamble — a consultant-grade convention
// that establishes the engineer's qualifications and the scope of
// what they personally prepared or supervised before the reviewer
// reads any numbers.
//
// Only renders when an engineer_of_record is attached to the exhibit
// or supplied via options.  Skipped silently otherwise (keeps the
// unsealed exhibit format clean).

export function buildEngineerDeclarationSection(exhibit, options){
  const opt = options || {};
  const eng = opt.engineer_of_record
           || exhibit?.station_inputs?.engineer_of_record
           || exhibit?.pe_certification?.engineer
           || null;

  if (!eng || typeof eng !== 'object') return null;
  if (!eng.name && !eng.firm) return null;

  const name        = eng.name        || '— (engineer name not supplied)';
  const firm        = eng.firm        || null;
  const license     = eng.license || eng.license_no || null;
  const state       = eng.license_state || null;
  const jurisdictions = Array.isArray(eng.jurisdictions) ? eng.jurisdictions : (state ? [state] : []);
  const licensee    = exhibit?.facility_metadata?.licensee
                   || exhibit?.station_inputs?.licensee
                   || '— (licensee not stated on this exhibit)';
  const callsign    = exhibit?.station_inputs?.call    || '— (call sign not stated)';
  const facility_id = exhibit?.station_inputs?.facility_id;
  const community   = exhibit?.station_inputs?.community_of_license
                   || exhibit?.facility_metadata?.community_of_license
                   || null;

  // The Mullaney boilerplate, parameterized for the current exhibit.
  // Wording mirrors the KELP 1989 declaration verbatim where the
  // semantics carry over (qualifications, scope, supervision, perjury
  // attestation).  Any field not supplied surfaces as an em-dash so
  // the reviewer can see what's missing.
  //
  // AUDIT FIX (2026-05-18): previous wording used `name.endsWith('.')`
  // as a he/she-vs-they heuristic, producing the ungrammatical
  // "they ... holds professional engineer license" because the verb
  // remained third-person-singular regardless.  Rewritten to use
  // "the declarant" throughout — grammatical, gender-neutral, and
  // matches consulting-firm convention.
  const para1 =
    `${name}, ${license ? `professional engineer license No. ${license}${state ? ` (${state})` : ''}` : 'a qualified radio engineer'}` +
    `${firm ? `, associated with ${firm}` : ''}` +
    `, declares and states that the declarant has been retained by ${licensee} ` +
    `to prepare this engineering exhibit in support of Radio Station ${callsign}` +
    `${facility_id ? ` (Facility ID ${facility_id})` : ''}` +
    `${community ? `, ${community}` : ''}.`;

  const para2 =
    `The calculations, contour analyses, allocation studies, and supporting evidence ` +
    `set forth in this exhibit were prepared by the declarant personally or by others ` +
    `under the declarant's direct supervision.` +
    `${jurisdictions.length ? `  The declarant is licensed as a professional engineer in: ${jurisdictions.join(', ')}.` : ''}`;

  const para3 =
    `The declarant further states that all facts contained herein are true of ` +
    `the declarant's own knowledge, except where stated to be on information or ` +
    `belief, and as to those facts, the declarant believes them to be true.  ` +
    `The declarant declares under penalty of perjury that the foregoing is true ` +
    `and correct.`;

  return {
    id:      'engineer-declaration',
    type:    'declaration',
    heading: 'DECLARATION OF ENGINEER',
    // The PDF renderer for 'declaration' falls back to 'paragraphs-with-kv'
    // gracefully when the dedicated renderer isn't wired — keeps the
    // section non-blocking on older renderer paths.
    paragraphs: [para1, para2, para3],
    rows: [
      ['Engineer',          name],
      ['Firm',              firm || '—'],
      ['License No.',       license ? `${license}${state ? ` (${state})` : ''}` : '—'],
      ['Other jurisdictions', jurisdictions.length ? jurisdictions.join(', ') : '—'],
      ['Executed on (UTC)', eng.declaration_date || new Date().toISOString().split('T')[0]],
      ['Signature',         '']
    ],
    sealed: false
  };
}
