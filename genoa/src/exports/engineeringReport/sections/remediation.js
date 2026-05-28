// Path to Compliance (§73.215 / §73.207) — advisory remediation.
//
// Renders the result of the bounded ERP × HAAT remediation sweep
// (src/engine/parameterSweep/remediation.js) when an export attaches it
// via options.remediation (or exhibit.remediation).  STRICTLY ADVISORY:
// it surfaces an engineering path to compliance; it does not change the
// §73.207/§73.215 determination or the engineering conclusion.  Returns
// null when no remediation is attached, so exhibits render unchanged.

const DISCLAIMER =
  'The subject facility does not qualify under the distance/contour-protection rules as ' +
  'proposed.  The following is an advisory, automatically-computed engineering path to ' +
  'compliance from a bounded ERP/HAAT parameter sweep.  It does NOT change the §73.207/§73.215 ' +
  'determination or conclusion above, and is not a filing recommendation — the engineer ' +
  'of record evaluates the trade-offs.';

// Render the named binding constraints (most-deficient first) into a
// leading sentence, so a none_found result explains WHICH facilities and
// by HOW MUCH the facility falls short — e.g. an IF pair ~89 dB short is
// far beyond any power/height/pattern remedy, vs. a 1st-adjacent a few dB
// short.  Returns '' when no constraints are attached (older payloads).
function describeConstraints(list){
  if (!Array.isArray(list) || !list.length) return '';
  const items = list.slice(0, 4).map(c => {
    const rel = c.relationship ? ` (${c.relationship})` : '';
    let why;
    if (c.beyond_curve_range){
      // The protected contour is engulfed; the D/U is a free-space
      // extrapolation, so report the geometry, not a bogus dB shortfall.
      why = c.overlap_km2
        ? `interfering contour engulfs the protected contour (${c.overlap_km2} km² overlap; D/U beyond §73.333 curve range)`
        : 'interfering contour engulfs the protected contour (D/U beyond §73.333 curve range)';
    } else if (c.shortfall_db != null && c.shortfall_db > 0 && c.actual_db != null && c.required_db != null){
      why = `D/U ${c.actual_db} vs ${c.required_db} dB required, ~${Math.round(c.shortfall_db)} dB short`;
    } else if (c.overlap_km2){
      why = `interfering contour overlaps the protected contour by ${c.overlap_km2} km²`;
    } else {
      why = 'contour-protection conflict';
    }
    return `${c.call}${rel} — ${why}`;
  });
  return `  The binding constraint(s): ${items.join('; ')}.`;
}

export function buildRemediationSection(exhibit, opt){
  const rem = opt?.remediation || exhibit?.remediation;
  if (!rem || rem.available !== true) return null;

  const paragraphs = [DISCLAIMER];

  if (rem.none_found){
    const why = describeConstraints(rem.binding_constraints);
    const triedDirectional = Array.isArray(rem.binding_bearings_deg) && rem.binding_bearings_deg.length;
    if (triedDirectional){
      const brg = rem.binding_bearings_deg.map(b => `${b}°`).join(', ');
      paragraphs.push(
        `No configuration within the searched envelope — power/height reduction, nor a ` +
        `directional null (to -20 dB) toward the binding bearing(s) ${brg} — brings the ` +
        `facility into compliance against all protected facilities.${why}  Deeper or custom ` +
        `directional pattern shaping, a transmitter-site relocation, a negotiated §73.215 ` +
        `consent, or a rule waiver would be required.`
      );
    } else {
      paragraphs.push(
        `No ERP or HAAT reduction within the searched envelope brings the facility into ` +
        `compliance against all protected stations.${why}  A directional antenna notched toward ` +
        `the binding facility, a transmitter-site relocation, a negotiated §73.215 consent, ` +
        `or a rule waiver would be required.`
      );
    }
  } else {
    const r = rem.recommended || {};
    const parts = [];
    if (r.erp_kw  != null) parts.push(`ERP ${r.erp_kw} kW`);
    if (r.haat_m  != null) parts.push(`HAAT ${r.haat_m} m`);
    const cfg = parts.join(', ') || 'a reduced configuration';
    const svc = r.service_km2 != null ? ` (≈${Math.round(r.service_km2)} km² service contour)` : '';
    if (r.directional){
      const brg = Array.isArray(r.notch_bearings_deg) && r.notch_bearings_deg.length
        ? r.notch_bearings_deg.map(b => `${b}°`).join(', ')
        : 'the binding facilities';
      const depth = r.notch_depth_db != null ? ` (≈${Math.abs(r.notch_depth_db)} dB null depth)` : '';
      paragraphs.push(
        `A compliant configuration exists using a DIRECTIONAL antenna: a pattern with ` +
        `null(s) toward bearing(s) ${brg}${depth} at ${cfg} satisfies ${r.compliance_path || '§73.215'}` +
        `${svc}.  A directional notch toward the binding station(s) preserves more service ` +
        `coverage than an omnidirectional power/height reduction; the engineer of record ` +
        `must design a §73.316-compliant pattern realizing the required suppression.`
      );
    } else {
      paragraphs.push(
        `A compliant configuration exists within the searched envelope: ${cfg} satisfies ` +
        `${r.compliance_path || '§73.215'}${svc}.  Reducing power and/or height shrinks the ` +
        `interfering contour and recovers the required D/U margin; a directional pattern ` +
        `toward the binding station is an alternative that can preserve more coverage.`
      );
    }
  }

  const axis = (Array.isArray(rem.binding_bearings_deg) && rem.binding_bearings_deg.length)
    ? 'ERP/HAAT/directional-pattern' : 'ERP/HAAT';
  paragraphs.push(
    `(Advisory remediation — searched ${rem.evaluated ?? '?'} ${axis} configurations, ` +
    `free-space §73.333; does not modify the compliance determination.)`
  );

  return {
    id:       'remediation',
    type:     'paragraphs',
    heading:  'PATH TO COMPLIANCE (ADVISORY)',
    advisory: true,
    paragraphs
  };
}
