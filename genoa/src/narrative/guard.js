// Narrative safety guard.
//
// AI / templated narrative MUST NOT make engineering claims that are
// not directly supported by the structured exhibit.  The guard scans
// rendered narrative text for forbidden phrasing and either rewrites
// or annotates it.
//
// Forbidden claims (case-insensitive):
//   - "FCC approved" / "FCC certified" / "FCC compliance" without "review"
//   - "guaranteed" / "certified by AI"
//   - "validation pass" when validation.runs[].authoritative_pass is not true
//   - any "terrain source" reference without exhibit.evidence.terrain.available
//   - any "measurement evidence" reference without exhibit.evidence.measurements.available
//   - any specific population claim when population_estimate.method === 'placeholder'

const FORBIDDEN_ABSOLUTE = [
  /\bFCC\s+approved\b/i,
  /\bFCC\s+certified\b/i,
  /\bguaranteed\s+(compliance|complian[ct])/i,
  /\bcertified\s+by\s+(AI|the\s+AI)\b/i,
  /\bAI[- ]?certified\b/i
];

// Returns { text, violations: [{rule, snippet}], rewrites: number }.
// `text` is the input with violations replaced by safe disclaimers.
export function guardNarrative(text, exhibit){
  if (typeof text !== 'string') return { text: '', violations: [], rewrites: 0 };
  let out = text;
  const violations = [];
  let rewrites = 0;

  for (const re of FORBIDDEN_ABSOLUTE){
    out = out.replace(re, m => {
      violations.push({ rule: 'forbidden_absolute', snippet: m });
      rewrites += 1;
      return '[REMOVED: unsupported FCC/AI certification claim]';
    });
  }

  // Conditional: validation_pass language only if authoritative_pass=true.
  const lastVal = exhibit?.validation?.runs?.slice(-1)[0];
  const authPass = !!lastVal?.authoritative_pass;
  if (!authPass){
    out = out.replace(/\bvalidation\s+(passed|pass)\b/gi, m => {
      violations.push({ rule: 'no_validation_pass', snippet: m });
      rewrites += 1;
      return '[REMOVED: validation has not passed for this exhibit]';
    });
  }

  // Conditional: do not name a terrain source unless evidence.terrain.available.
  // Match only AFFIRMATIVE claims — phrases that ATTRIBUTE a terrain
  // source (e.g. "Driven by SRTM", "via SRTM30m", "DEM source: …").
  // Descriptive disclaimers like "no terrain evidence attached" are
  // intentionally allowed through.
  if (!exhibit?.evidence?.terrain?.available){
    out = out.replace(/\b(?:driven\s+by|via|using|sourced\s+from|terrain\s+source\s*:|DEM\s+source\s*:)\s+(SRTM\w*|DEM[A-Za-z0-9_-]*|OpenTopoData|USGS\w*|SPLAT)/gi, m => {
      violations.push({ rule: 'no_terrain_evidence', snippet: m });
      rewrites += 1;
      return '[REMOVED: no terrain source attached]';
    });
  }

  // Conditional: do not claim measurement evidence unless attached.
  // Match only AFFIRMATIVE claims (verbs of attribution / presence).
  if (!exhibit?.evidence?.measurements?.available){
    out = out.replace(/\b(?:attached|recorded|measured|confirmed|captured|verified)\s+(?:by\s+)?(SDR\s+capture|SigMF|measurement\s+evidence)/gi, m => {
      violations.push({ rule: 'no_measurement_evidence', snippet: m });
      rewrites += 1;
      return '[REMOVED: no SDR / measurement evidence attached]';
    });
    // And block direct field-strength assertions: "measured field strength = X dBu".
    out = out.replace(/\bmeasured\s+field\s+strength\s*[:=]\s*-?[\d.]+\s*dBu/gi, m => {
      violations.push({ rule: 'no_measurement_evidence', snippet: m });
      rewrites += 1;
      return '[REMOVED: no SDR / measurement evidence attached]';
    });
  }

  // Conditional: do not state a specific population number when placeholder.
  if (exhibit?.population_estimate?.method === 'placeholder'){
    // Strip "covers <number> people" / "<number> persons" forms.
    out = out.replace(/\b(covers|reaches|services?)\s+~?\d[\d,]*\s+(people|persons|listeners)\b/gi, m => {
      violations.push({ rule: 'no_real_population', snippet: m });
      rewrites += 1;
      return '[REMOVED: population estimate is a placeholder]';
    });
  }

  return { text: out, violations, rewrites };
}
