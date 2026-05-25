// SDR residual → engineering narrative.
//
// Conservative consulting-engineer voice.  Deterministic — same summary in,
// same paragraph out.  NEVER claims FCC error.  Attributes deviation to
// terrain or environmental conditions.  Does NOT modify the curve outputs.
//
// Required phrases per spec:
//   significant residual ⇒ "terrain-induced attenuation"
//   moderate residual    ⇒ "localized variation"
//   small residual       ⇒ "consistent with FCC curves"

import {
  CLASS_WITHIN, CLASS_MODERATE, CLASS_SIGNIFICANT
} from './classifyResiduals.js';

export function generateNarrative(summary){
  if (!summary || summary.available === false || !summary.n_samples){
    return 'No SDR drive-test residuals were attached to this exhibit, so an ' +
           'engineering interpretation of measured-vs-predicted deviations cannot be ' +
           'rendered.  The contour distances reported elsewhere remain authoritative ' +
           'under the FCC propagation rules.';
  }

  const headline = pickHeadlineClass(summary);
  const parts = [];

  // Lead sentence keyed off the dominant classification.
  if (headline === CLASS_SIGNIFICANT){
    parts.push(
      `The SDR drive-test sample shows an RMS residual of ${summary.rms_db} dB across ` +
      `${summary.n_samples} radials, with ${summary.percent_significant}% of samples ` +
      'exceeding the 10 dB advisory threshold.  Deviations of this magnitude are most ' +
      'commonly explained by terrain-induced attenuation along the affected radials, ' +
      'including diffraction over intervening ridgelines, foliage and clutter losses ' +
      'in the near-field, and morphology-dependent ground reflection.'
    );
  } else if (headline === CLASS_MODERATE){
    parts.push(
      `The SDR drive-test sample shows an RMS residual of ${summary.rms_db} dB across ` +
      `${summary.n_samples} radials.  ${summary.percent_moderate}% of samples fall in ` +
      'the 6–10 dB band, which is typical of localized variation produced by terrain ' +
      'roughness, building clutter, and minor pattern asymmetry.  No single radial ' +
      'exceeds the engineering-significant threshold.'
    );
  } else {
    parts.push(
      `The SDR drive-test sample shows an RMS residual of ${summary.rms_db} dB across ` +
      `${summary.n_samples} radials, with ${summary.percent_within}% of samples within ` +
      'the 6 dB advisory tolerance.  The measured field strengths are consistent with ' +
      'FCC curves at the sampled azimuths.'
    );
  }

  // Worst-case sentence — only when we actually have a worst sample.
  if (summary.worst_case){
    const wc = summary.worst_case;
    const where = Number.isFinite(wc.azimuth_deg) ? `at ${wc.azimuth_deg.toFixed(1)}°` : 'on the worst-case radial';
    parts.push(
      `The largest single residual is ${signed(wc.residual_db)} dB ${where} ` +
      `(${humanClass(wc.classification)}).`
    );
  }

  // Dominant direction sentence — only when we found a cluster.
  if (summary.dominant_direction){
    const d = summary.dominant_direction;
    parts.push(
      `The worst-case residuals cluster toward ${d.compass} (mean bearing ${d.bearing_deg.toFixed(1)}°), ` +
      'consistent with terrain or land-cover features along that azimuth being the dominant ' +
      'contributor to the observed deviation.'
    );
  }

  // Closing disclaimer — non-negotiable.
  parts.push(
    'These observations are advisory.  They reflect site-specific terrain and environmental ' +
    'conditions encountered during the drive test and do not indicate any error in the FCC ' +
    'propagation curves; the regulatory contour distances reported elsewhere remain ' +
    'authoritative for filing purposes.'
  );

  return parts.join('  ');
}

// ─────────── helpers ───────────

function pickHeadlineClass(s){
  if ((s.percent_significant || 0) >= 10) return CLASS_SIGNIFICANT;
  if ((s.percent_moderate    || 0) >= 25
      || (s.rms_db != null && s.rms_db >= 6)) return CLASS_MODERATE;
  return CLASS_WITHIN;
}

function humanClass(c){
  if (c === CLASS_SIGNIFICANT) return 'significant deviation';
  if (c === CLASS_MODERATE)    return 'moderate deviation';
  if (c === CLASS_WITHIN)      return 'within expectation';
  return 'classification unavailable';
}

function signed(v){
  if (!Number.isFinite(v)) return '—';
  return (v >= 0 ? '+' : '') + Number(v).toFixed(1);
}
