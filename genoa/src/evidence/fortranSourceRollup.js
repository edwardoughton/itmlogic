// Composite hash over the three FCC TVFMFS_METRIC FORTRAN source
// files — single-string "did the math change" boolean for reviewers
// who don't want to diff three SHAs.  Computed deterministically
// from the per-file SHAs the FORTRAN sidecar returns under /version,
// so reviewers can recompute it themselves without trusting either
// Genoa or the sidecar.
//
// Convention matches genoa/scripts/regen-master-shas.sh:
//   sha256 over the sorted-by-name "<sha>  <name>\n" lines
//   (final newline included; alphabetical by basename).

import crypto from 'node:crypto';

const FORTRAN_SOURCE_FILES = Object.freeze(['driver.for', 'itplbv.for', 'tvfmfs.for']);

/**
 * @param {{[file:string]: string|null|undefined}} fileShas
 *        Map basename → sha256 hex.  Missing or non-hex entries cause
 *        the rollup to be skipped (returns null), since a partial
 *        rollup would be misleading.
 * @returns {string|null}  sha256 hex, or null when any input is missing/invalid.
 */
export function computeFortranSourceRollup(fileShas){
  if (!fileShas || typeof fileShas !== 'object') return null;
  const entries = FORTRAN_SOURCE_FILES.map((name) => [name, fileShas[name]]);
  if (!entries.every(([, sha]) => typeof sha === 'string' && /^[a-f0-9]{64}$/i.test(sha))){
    return null;
  }
  const lines = entries
    .slice()
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, sha]) => `${sha.toLowerCase()}  ${name}`)
    .join('\n') + '\n';
  return crypto.createHash('sha256').update(lines).digest('hex');
}

export { FORTRAN_SOURCE_FILES };
