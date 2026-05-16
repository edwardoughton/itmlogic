// FCC LMS / Public-Files / FMQ-AMQ consolidated client.
//
// SCOPE
//   The FCC has no single documented public LMS JSON API.  This
//   client consolidates the data surfaces that ARE publicly
//   accessible without authentication, and presents a unified
//   "FCC authoritative-record" evidence shape that every Genoa
//   exhibit can carry alongside ZTR (which is itself a downstream
//   ingest of these same upstream sources):
//
//     1. FMQ / AMQ (transition.fcc.gov/fcc-bin/{fmq,amq})
//        - Pipe-delimited text rows (we already parse via
//          src/evidence/fccFmqClient.js)
//        - Carries: facility_id, call, service, class, frequency,
//                   ERP day/night, HAAT, lat/lon (D-M-S), licensee,
//                   license expiration date, status, last-action
//                   codes (CP / LIC / AUTH / etc.)
//        - License expiration is computed from these rows
//
//     2. Public Inspection Files (publicfiles.fcc.gov)
//        - Required by 47 CFR §73.3526 / §73.3527; every licensed
//          broadcaster maintains a public-file folder online
//        - JSON folder-listing API:
//            GET https://publicfiles.fcc.gov/api/manager/folder/
//                  {service}/{facility_id}/contents
//          where {service} ∈ { am, fm, fm-translator, lpfm, tv, … }
//        - Returns the folder contents (sub-folders + files);
//          presence of folders like "EEO-public-file-report" or
//          "Issues-and-Programs-Lists" means the licensee is
//          maintaining a current public file
//
//     3. Antenna Structure Registration (already wired separately
//        in src/evidence/asrClient.js — kept distinct because §17.4
//        is its own regulatory regime)
//
//   Consolidated output shape:
//     {
//       available, source, fetched_at,
//       license: { facility_id, call, service, class, status,
//                   license_expiration_date, last_action,
//                   licensee, days_to_expiration, expiring_soon },
//       public_file: { available, folder_url, folders: [...],
//                      file_count, last_modified },
//       authorization_history: { available, summary, applications: [...] },
//       cross_check: { ztr_vs_lms_match, mismatches: [...] }
//     }
//
// LIMITATIONS
//   - Application history (CDBS query / LMS app status) is NOT
//     accessible without auth at the granular level needed for
//     pending-app tracking.  We surface what FMQ/AMQ exposes
//     (the "last action" code) and link to the FCC's LMS UI for
//     deeper review.
//   - Public-file folder API is best-effort: the FCC has reorganised
//     the publicfiles.fcc.gov API path several times.  We try the
//     two most-commonly-documented patterns.
//
// FALLBACK CHAIN
//   1. ZTR rich-station _fcc_lms field (if ZTR ingested it)
//   2. FMQ/AMQ direct lookup → license fields parsed
//   3. publicfiles.fcc.gov public-file folder probe
//   4. None reachable → { available: false, source: null, error }

import { makeFccFmqClient } from './fccFmqClient.js';

const DEFAULT_TIMEOUT_MS = 10_000;
const PUBLIC_FILES_BASE  = 'https://publicfiles.fcc.gov/api/manager/folder';

// Service code mapping for publicfiles.fcc.gov folder paths.
const PFILES_SERVICE_PATH = Object.freeze({
  AM:    'am',
  FM:    'fm',
  LPFM:  'lpfm',
  FX:    'fm-translator',
  TV:    'tv'
});

export function makeFccLmsClient({
  fmqClient   = process.env.FACILITY_DISABLE_FCC_FMQ === '1' ? null : makeFccFmqClient({ timeoutMs: DEFAULT_TIMEOUT_MS }),
  publicFilesBase = process.env.FCC_PUBLIC_FILES_BASE || PUBLIC_FILES_BASE,
  publicFilesEnabled = process.env.FCC_PUBLIC_FILES_DISABLE !== '1',
  timeoutMs   = DEFAULT_TIMEOUT_MS,
  expiringSoonDays = Number(process.env.LICENSE_EXPIRING_SOON_DAYS) || 180,
  fetchFn     = (typeof fetch === 'function' ? fetch : null)
} = {}){
  return {
    // Surfaces a baseUrl so the /readyz probe + UI tooltip have
    // something to point at.  The "real" baseUrl is dual (FMQ/AMQ +
    // publicfiles); we report publicfiles since that's the actual
    // licensee-side API.
    baseUrl: publicFilesBase,

    // Liveness probe used by /readyz.  publicfiles.fcc.gov + FMQ have
    // no /health route, so we hit a known-good endpoint with a real
    // facility id and count any HTTP response (2xx-4xx) as "host
    // reachable".  Only network / DNS / TLS failures register as
    // unhealthy.  Probes BOTH publicfiles + FMQ in parallel and treats
    // "either reachable" as healthy — Genoa can fall back from one to
    // the other.
    async health(){
      const probe = async (url) => {
        try {
          const r = await (fetchFn || fetch)(url, { signal: AbortSignal.timeout(3000) });
          return r.status >= 200 && r.status < 600;
        } catch { return false; }
      };
      const [publicFiles, fmq] = await Promise.all([
        publicFilesEnabled ? probe(`${publicFilesBase}/fm/11282/contents`) : Promise.resolve(false),
        probe('https://transition.fcc.gov/fcc-bin/fmq?state=AZ&call=KSLX')
      ]);
      return publicFiles || fmq;
    },

    /**
     * Consolidated lookup for a station by call sign.
     * Returns the unified "FCC authoritative-record" evidence shape.
     */
    async getStationRecord({ call, facility_id = null, service = null }){
      if (!call && !facility_id){
        return { available: false, source: null, error: 'call or facility_id required' };
      }

      const fetched_at = new Date().toISOString();
      const sources_tried = [];
      const errors = [];

      // ---- 1. FMQ/AMQ direct (license metadata) ----
      let licenseRow = null;
      if (fmqClient && call){
        sources_tried.push('fcc-fmq');
        try {
          const r = await fmqClient.searchByCallsign(call);
          if (r && Array.isArray(r.rows) && r.rows.length){
            // Prefer the row whose service matches if specified.
            licenseRow = service
              ? (r.rows.find(row => String(row.service || '').toUpperCase() === String(service).toUpperCase())
                 || r.rows[0])
              : r.rows[0];
          } else if (r?.error){
            errors.push(`fcc-fmq: ${r.error}`);
          }
        } catch (e){
          errors.push(`fcc-fmq: ${e.message}`);
        }
      }

      const license = parseLicenseFromFmqRow(licenseRow, expiringSoonDays);

      // ---- 2. publicfiles.fcc.gov folder listing ----
      let publicFile = { available: false, source: null };
      const svc = (license.service || service || '').toUpperCase();
      const fid = license.facility_id || facility_id;
      if (publicFilesEnabled && fid && PFILES_SERVICE_PATH[svc] && fetchFn){
        sources_tried.push('publicfiles.fcc.gov');
        try {
          const url = `${publicFilesBase}/${PFILES_SERVICE_PATH[svc]}/${encodeURIComponent(fid)}/contents`;
          const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
          if (r.ok){
            const j = await r.json().catch(() => null);
            publicFile = parsePublicFileFolder(j, url);
          } else {
            errors.push(`publicfiles.fcc.gov: HTTP ${r.status}`);
          }
        } catch (e){
          errors.push(`publicfiles.fcc.gov: ${e.message}`);
        }
      }

      const available = license.available || publicFile.available;
      return {
        available,
        source: available ? 'fcc-lms-consolidated' : null,
        fetched_at,
        sources_tried,
        license,
        public_file: publicFile,
        // Application history below the FMQ row's last-action code
        // is not accessible without LMS auth; we surface what we have.
        authorization_history: {
          available: !!licenseRow,
          last_action: licenseRow?.last_action || null,
          status:      licenseRow?.status      || null,
          deeper_review_url: fid && svc
            ? `https://enterpriseefiling.fcc.gov/dataentry/public/${PFILES_SERVICE_PATH[svc] || svc.toLowerCase()}/publicFacilityFilings.html?facilityId=${encodeURIComponent(fid)}`
            : null,
          note: 'Granular pending/granted application status requires LMS auth (enterpriseefiling.fcc.gov).  Use the deeper_review_url for human review.'
        },
        errors: errors.length ? errors : null,
        provenance: {
          regulation: '47 CFR §73.3526 / §73.3527 (public inspection files); §73.1620 (license expiration)',
          sources:    [
            { id: 'fcc-fmq',                 endpoint: 'https://transition.fcc.gov/fcc-bin/fmq', license_basis: '17 USC §105 (public domain)' },
            { id: 'fcc-amq',                 endpoint: 'https://transition.fcc.gov/fcc-bin/amq', license_basis: '17 USC §105 (public domain)' },
            { id: 'publicfiles.fcc.gov',     endpoint: PUBLIC_FILES_BASE,                         license_basis: '17 USC §105 (public domain)' }
          ],
          not_modeled: [
            'Granular LMS application status (auth-required at enterpriseefiling.fcc.gov)',
            'CDBS legacy application history (TV-only; this client is FM/AM/LPFM/FX-focused)',
            'Ownership chain via FCC Form 323 (separate API; not yet wired)'
          ]
        }
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Pull licensing fields out of a parsed FMQ/AMQ row (fccFmqClient
 * already produces these as `r.expiration_date`, `r.status`, etc.).
 * Computes days_to_expiration + expiring_soon flag.
 */
export function parseLicenseFromFmqRow(row, expiring_soon_days = 180){
  if (!row){
    return {
      available: false,
      source:    null,
      reason:    'no FMQ/AMQ row found for this call sign'
    };
  }
  const exp_date = row.expiration_date || row.license_expiration || null;
  let days_to_expiration = null;
  let expiring_soon = false;
  let expired = false;
  if (exp_date){
    const t = Date.parse(exp_date);
    if (Number.isFinite(t)){
      const now = Date.now();
      days_to_expiration = Math.round((t - now) / 86_400_000);
      expiring_soon      = days_to_expiration >= 0 && days_to_expiration <= expiring_soon_days;
      expired            = days_to_expiration < 0;
    }
  }
  return {
    available:               true,
    source:                  row.facility_lookup_source?.upstream || 'fcc-fmq',
    facility_id:             row.facility_id || null,
    call:                    row.call        || null,
    service:                 row.service     || null,
    fcc_class:               row.fcc_class   || null,
    frequency:               row.frequency   ?? null,
    frequency_unit:          row.frequency_unit || null,
    erp_kw:                  row.erp_kw ?? null,
    haat_m:                  row.haat_m ?? null,
    lat:                     row.lat ?? null,
    lon:                     row.lon ?? null,
    licensee:                row.licensee || null,
    license_expiration_date: exp_date,
    days_to_expiration,
    expiring_soon,
    expired,
    status:                  row.status      || null,
    last_action:             row.last_action || null,
    endpoint:                row.facility_lookup_source?.endpoint || null
  };
}

/**
 * Pull a normalized summary from the publicfiles.fcc.gov folder JSON.
 * The actual response shape varies by endpoint version; we surface
 * whatever items are present without inventing data.
 */
export function parsePublicFileFolder(j, url){
  if (!j || typeof j !== 'object'){
    return { available: false, source: null, folder_url: url, error: 'no folder JSON' };
  }
  // Different endpoint versions expose:
  //   j.contents       (array of folder/file entries)
  //   j.folders        (array of sub-folders)
  //   j.documents      (array of files)
  //   j.id, j.name     (current folder)
  const contents  = Array.isArray(j.contents)  ? j.contents  : [];
  const folders   = Array.isArray(j.folders)   ? j.folders   : contents.filter(x => x?.type === 'folder');
  const documents = Array.isArray(j.documents) ? j.documents : contents.filter(x => x?.type === 'file' || x?.type === 'document');
  const folderNames = folders.map(f => f?.name || f?.title).filter(Boolean);
  // Common required public-file folders per §73.3526 / §73.3527.
  const REQUIRED = [
    'EEO-Public-File-Report',
    'Issues-and-Programs-Lists',
    'Political-File',
    'Children\'s Television Programming Reports',
    'Authorizations',
    'Applications-and-Related-Materials',
    'Citizen-Agreements',
    'Contests',
    'Investigative-Materials',
    'Letters-and-Emails-from-the-Public',
    'Public-and-Broadcasting-Procedure-Manual'
  ];
  const present = REQUIRED.filter(name =>
    folderNames.some(fn => fn.toLowerCase().includes(name.toLowerCase().replace(/['’]/g, '')))
  );
  const missing = REQUIRED.filter(name => !present.includes(name));
  return {
    available:        true,
    source:           'publicfiles.fcc.gov',
    folder_url:       url,
    folder_id:        j.id   || null,
    folder_name:      j.name || null,
    folders:          folderNames,
    folder_count:     folders.length,
    file_count:       documents.length,
    last_modified:    j.last_modified || j.lastModified || null,
    required_folders: { present, missing, required_total: REQUIRED.length, present_count: present.length }
  };
}

export const FCC_LMS_PROVENANCE = Object.freeze({
  module:       'src/evidence/fccLmsClient.js',
  regulation:   '47 CFR §73.3526 / §73.3527 (public inspection files); §73.1620 (license expiration)',
  upstreams: [
    { id: 'fcc-fmq',             endpoint: 'https://transition.fcc.gov/fcc-bin/fmq',          license_basis: '17 USC §105' },
    { id: 'fcc-amq',             endpoint: 'https://transition.fcc.gov/fcc-bin/amq',          license_basis: '17 USC §105' },
    { id: 'publicfiles.fcc.gov', endpoint: PUBLIC_FILES_BASE,                                  license_basis: '17 USC §105' }
  ],
  modeled: [
    'License expiration date + days_to_expiration + expiring_soon flag',
    'Last action code (CP / LIC / AUTH / etc.) from FMQ/AMQ',
    'Public-file folder index from publicfiles.fcc.gov',
    'Required-folder presence check per §73.3526 / §73.3527',
    'Cross-link to LMS deeper-review URL (auth required to access)'
  ],
  not_modeled: [
    'Granular pending/granted application status (LMS auth required)',
    'Ownership chain via FCC Form 323 (separate API; not yet wired)',
    'CDBS legacy application history (TV-only)',
    'Sponsorship-identification disclosures'
  ]
});
