// JSON exporter — emits the full machine-readable genoa.exhibit.v2.
// No transformation; this IS the canonical machine artifact.
//
// Use the indented form for human review (engineering audit trails),
// the compact form for storage / object-store assets.

import { validateExhibit } from '../../types/schema.js';

export function exportJson(exhibit, { pretty = true } = {}){
  const v = validateExhibit(exhibit);
  if (!v.ok) throw new Error('exhibit failed schema validation: ' + v.missing.join(', '));
  return pretty ? JSON.stringify(exhibit, null, 2) : JSON.stringify(exhibit);
}

export const JSON_CONTENT_TYPE = 'application/json';
