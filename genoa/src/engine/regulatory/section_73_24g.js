// 47 CFR §73.24(g) — AM blanket-interference compliance.
//
// The rule: if the population residing within an AM station's 1000 mV/m
// blanket-interference contour exceeds 1.0% of the population residing
// within its 25 mV/m groundwave contour, the licensee is obligated to
// remediate complaints from those residents (re-tune affected consumer
// electronics, replace damaged devices, etc.).  Real-world reference:
// Mullaney KELP 1989 Engineering Statement, Section II.E "Blanketing
// Interference" — "The population within the 1000 mV/m daytime blanket
// contour is 4,146 people; the population within the 25 mV/m contour
// is 284,773 people.  This figure is slightly above the 1.0 percentage
// specified by Section 73.24(g) of the Commission's rules."
//
// This module computes the §73.24(g) compliance status from whatever
// population data is attached to the exhibit.  Failures gate the
// filing decision via the verdict; they do NOT modify the contour
// math.
//
// Inputs (read from the exhibit object):
//   - polygons (or contour radii) for blanket_1000mvm and
//     international_25mvm contour IDs
//   - population_by_contour: optional map from contour_id → persons
//     (the population sidecar must be called per-contour; when only
//     one contour was populated the rule reports as PARTIAL)
//
// Output: { applicable, regulation, findings, overall_pass, summary }
// with the same shape as section_73_150 so the verdict surface can
// render both compliance components uniformly.

const RATIO_LIMIT = 0.01;   // 1% per §73.24(g)
const RULE_CITE   = '47 CFR §73.24(g)';

/**
 * @param {object} args
 * @param {object} args.exhibit  the exhibit object (read-only)
 */
export function checkAm73_24g({ exhibit } = {}){
  const result = {
    applicable: false,
    regulation: RULE_CITE,
    findings: [],
    overall_pass: null
  };

  const service = String(exhibit?.station_inputs?.service || '').toUpperCase();
  if (service !== 'AM'){
    return { ...result, reason: 'rule applies only to AM service' };
  }
  result.applicable = true;

  // Pull the blanket + 25 mV/m polygon mean radii (km) from the
  // computed contour set.  exhibit.polygons is the per-contour assembled
  // polygon list; mean radius is a stand-in for area when polygon area
  // isn't already computed.  Distances also live in radial_table per
  // contour_id; either source is fine.
  const blanketKm    = contourMeanRadiusKm(exhibit, 'blanket_1000mvm');
  // §73.24(g) compares blanket pop vs SERVICE 25 mV/m pop (not the
  // international-protection 25 mV/m which only exists for border
  // sites).  Audit caught the prior semantic muddle.  Fall back to
  // international_25mvm only when service_25mvm is missing (older
  // exhibits without the new contour id).
  const service25Km  = contourMeanRadiusKm(exhibit, 'service_25mvm')
                     ?? contourMeanRadiusKm(exhibit, 'international_25mvm');
  const blanketPop   = populationFor(exhibit, 'blanket_1000mvm');
  const intl25Pop    = populationFor(exhibit, 'service_25mvm')
                     ?? populationFor(exhibit, 'international_25mvm');

  // Finding 1 — the blanket contour itself must be computable.
  result.findings.push({
    rule:      'blanket_contour_present',
    citation:  `${RULE_CITE} — 1000 mV/m blanket contour must be defined for the proposed facility`,
    observed:  blanketKm != null
                ? `1000 mV/m blanket contour mean radius ${blanketKm.toFixed(2)} km`
                : '1000 mV/m blanket contour not present in computed contour set',
    pass:      blanketKm != null,
    detail:    blanketKm != null
                ? 'Blanket contour computed; population check requires the population sidecar to be configured per-contour.'
                : 'Blanket contour missing — add `blanket_1000mvm` to AM_DEFAULT_CONTOURS (engine/am/groundwave.js) and recompute.'
  });

  // Finding 2 — population ratio.  Decisive only when BOTH populations
  // are attached.  When the population sidecar only ran on the primary/
  // service contour (the common case), this finding is informational
  // and the overall_pass remains null.
  if (Number.isFinite(blanketPop) && Number.isFinite(intl25Pop) && intl25Pop > 0){
    const ratio = blanketPop / intl25Pop;
    const ratioPass = ratio <= RATIO_LIMIT;
    result.findings.push({
      rule:      'blanket_population_ratio',
      citation:  `${RULE_CITE} — population within 1000 mV/m blanket contour must not exceed 1.0% of population within 25 mV/m contour`,
      limit:     `${(RATIO_LIMIT * 100).toFixed(1)}%`,
      observed:  `${(ratio * 100).toFixed(2)}% (blanket=${blanketPop.toLocaleString('en-US')} of intl-25=${intl25Pop.toLocaleString('en-US')} persons)`,
      pass:      ratioPass,
      detail:    ratioPass
        ? 'Blanket population is within the §73.24(g) 1% threshold.  Licensee remains responsible for remediating individual complaints per §73.318(b) but is not subject to the pre-construction Section 73.24(g) showing.'
        : 'Blanket population EXCEEDS the §73.24(g) 1% threshold.  Licensee must submit a §73.318(b) blanketing-interference remediation plan with the application; many filings of this kind disclose the percentage and commit to receiver-treatment funds.'
    });
  } else {
    result.findings.push({
      rule:      'blanket_population_ratio',
      citation:  `${RULE_CITE} — population within 1000 mV/m blanket contour must not exceed 1.0% of population within 25 mV/m contour`,
      limit:     `${(RATIO_LIMIT * 100).toFixed(1)}%`,
      observed:  populationObservedSummary(blanketPop, intl25Pop),
      pass:      null,
      detail:    'Not measured — the population sidecar was only invoked on the primary/service contour for this exhibit.  Request per-contour population for blanket_1000mvm and international_25mvm to enable the §73.24(g) ratio check.'
    });
  }

  // Overall: every decisive finding must pass.
  const decisive = result.findings.filter((f) => f.pass !== null);
  result.overall_pass = decisive.length > 0 && decisive.every((f) => f.pass === true);
  result.summary = result.overall_pass
    ? '§73.24(g) blanket-interference check passes (or all decisive sub-checks pass).'
    : decisive.some((f) => f.pass === false)
      ? '§73.24(g) blanket-interference check FAILED — see findings.'
      : '§73.24(g) blanket-interference check incomplete — population data not attached for both contours.';

  return result;
}

// ─────────── helpers ───────────

function contourMeanRadiusKm(exhibit, contourId){
  const rt = Array.isArray(exhibit?.radial_table) ? exhibit.radial_table : [];
  if (!rt.length) return null;
  const vals = [];
  for (const r of rt){
    const cd = r?.contour_distances_km || {};
    const v = Number(cd[contourId]);
    if (Number.isFinite(v)) vals.push(v);
  }
  if (!vals.length) return null;
  return vals.reduce((s, v) => s + v, 0) / vals.length;
}

function populationFor(exhibit, contourId){
  const pe = exhibit?.population_estimate;
  if (!pe) return null;
  // Either a per-contour map or a single-contour field; check both.
  const byContour = pe.by_contour && typeof pe.by_contour === 'object'
                      ? pe.by_contour[contourId]
                      : null;
  if (Number.isFinite(byContour)) return byContour;
  if (Number.isFinite(byContour?.persons)) return byContour.persons;
  // Single-population case: trust only when the contour_label matches.
  if (pe.contour_label === contourId && Number.isFinite(pe.primary)){
    return pe.primary;
  }
  return null;
}

function populationObservedSummary(blanketPop, intl25Pop){
  const parts = [];
  parts.push(Number.isFinite(blanketPop)
    ? `blanket=${blanketPop.toLocaleString('en-US')} persons`
    : 'blanket population: not computed');
  parts.push(Number.isFinite(intl25Pop)
    ? `intl-25=${intl25Pop.toLocaleString('en-US')} persons`
    : 'intl-25 population: not computed');
  return parts.join('; ');
}
