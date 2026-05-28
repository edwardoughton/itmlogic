// Resolves environment-configured sidecars into ready-to-use clients.
// Missing sidecar URL → null client → engine still runs.
//
// CANONICAL FALLBACK MATRIX (probed live at /api/sources/health)
//
//   Query                Primary                 Secondary               Tertiary
//   ----------------     -----------------       ------------------      ---------------------------
//   Facility metadata    ZTR /api/broadcast      FCC FMQ/AMQ direct      n8n station/analyze
//   FCC contour          ZTR _fcc_contour        geo.fcc.gov direct      engine self-computes
//   Per-radial HAAT      FCC contour HAAT        ZTR terrain-haat        USGS + OpenMeteo + OpenTopoData
//   Population/Census    operator pop sidecar    ACS 5-year (opt-in)     geo.fcc.gov/api/census (decennial)
//   Nearby primaries     FCC FMQ direct          FCC AMQ direct          —
//   Rich station / SDR   ZTR /api/radiodns       —                       — (vendor-locked)
//   Identity / RadioDNS  identity sidecar        ZTR rich-station        — (massdns/EAS-Tools optional; ZTR is robust 2nd-tier)
//   FCC LMS / pub. file  FCC FMQ/AMQ direct      publicfiles.fcc.gov     — (license expiration + public-file folder index)
//   ASR / §17.4 tower    ZTR _tower              opendata.fcc.gov Socrata ASR_SIDECAR_URL operator proxy
//   LOS / Fresnel        ZTR /api/los/profile    —                       —
//   FAA OE/AAA           FAA_OE_SIDECAR_URL      oeaaa.faa.gov HTML      — (no public JSON API)
//
// Every tier is independent — primary failure does NOT cascade.  The
// orchestrator (exhibitService.js) walks each chain top-down and stops
// at the first tier that returns usable data.  Failed tiers are
// recorded as evidence (e.g., evidence.terrain_ztr_attempted) so the
// exhibit's provenance shows exactly which fallback won.

import { makeSplatClient }       from '../../evidence/terrain/splatClient.js';
import { makeIdentityClient }    from '../../evidence/identity/index.js';
import { makeFacilityClient }    from './facilityClient.js';
import { makePopulationClient }  from '../../evidence/populationClient.js';
import { makeAcsCensusClient }   from '../../evidence/acsCensusClient.js';
import { makeFccCensusClient }   from '../../evidence/fccCensusClient.js';
import { makeFccContoursClient } from '../../evidence/fccContoursClient.js';
import { makeNecClient }         from '../../evidence/nec/client.js';
import { makeFccLmsClient }      from '../../evidence/fccLmsClient.js';
import { makeAsrClient }         from '../../evidence/asrClient.js';
import { makeFaaOeClient }       from '../../evidence/faaOeClient.js';
import { makeAirportsClient }    from '../../evidence/airportsClient.js';
import { makeFortranFccClient }  from '../../evidence/fortranFccClient.js';
import { makeFccamClient }       from '../../evidence/fccamClient.js';
import { makeBerrySkywaveClient } from '../../evidence/berrySkywaveClient.js';
import { makeFccSunClient }      from '../../evidence/fccSunClient.js';
import { makeAmPhysicsClient }   from '../../evidence/amPhysicsClient.js';
import { makeGeoRfEvidenceClient } from '../../evidence/geoRfEvidenceClient.js';

// Population evidence priority:
//   1. POPULATION_EVIDENCE_URL — operator-managed sidecar (any source).
//   2. ACS 5-year (opt-in via POPULATION_USE_ACS=1)
//      — most recent demographics, more API calls.
//   3. FCC Census Block API decennial — default fallback,
//      single API per sample, no key required
//      (disable with POPULATION_DISABLE_FCC_CENSUS=1).
//   4. null — POPULATION_PLACEHOLDER warning persists.
function buildPopulationClient(){
  const sidecar = makePopulationClient();
  if (sidecar) return sidecar;
  if (process.env.POPULATION_USE_ACS === '1'){
    const acs = makeAcsCensusClient({
      acsYear:     Number(process.env.POPULATION_ACS_VINTAGE) || undefined,
      samples:     Number(process.env.POPULATION_SAMPLES)     || undefined,
      concurrency: Number(process.env.POPULATION_CONCURRENCY) || undefined
    });
    if (acs) return acs;
  }
  if (process.env.POPULATION_DISABLE_FCC_CENSUS === '1') return null;
  return makeFccCensusClient({
    censusYear:  Number(process.env.POPULATION_CENSUS_YEAR) || 2020,
    samples:     Number(process.env.POPULATION_SAMPLES)     || undefined,
    concurrency: Number(process.env.POPULATION_CONCURRENCY) || undefined
  });
}

export const sidecars = Object.freeze({
  // SPLAT sidecar (chelstein/splat — Genoa Flask sidecar).  When set,
  // Genoa probes its capability and surfaces SPLAT availability /
  // DEM-provisioning state as evidence provenance.
  splat:       makeSplatClient   ({ baseUrl: process.env.SPLAT_SIDECAR_URL    }),
  identity:    makeIdentityClient({ baseUrl: process.env.IDENTITY_SIDECAR_URL }),
  // Map sidecar is consumed via fetchMapRender() in sidecars/mapClient.js,
  // not through this registry — no sidecars.map property needed.
  // Facility lookup is not a sidecar in the propagation sense — it's a
  // read-only adapter into chelstein/zerotrustradio (and optionally the
  // n8n station/analyze webhook).  Lives here so the same /readyz block
  // can report all upstreams.
  facility:    makeFacilityClient(),
  // Population evidence: operator sidecar first, ACS 5-year (opt-in),
  // FCC Census Block API decennial fallback (default).
  population:  buildPopulationClient(),
  // FCC Contours direct fallback: used when ZTR doesn't have _fcc_contour
  // or ZTR is not configured.  Always on (geo.fcc.gov is public / no auth).
  // Disable with FCC_CONTOURS_DISABLE=1.
  fccContours: process.env.FCC_CONTOURS_DISABLE === '1' ? null : makeFccContoursClient(),
  // §73.190 / Figure R3 ground-conductivity lookup.  Sourced via ZTR's
  // /api/m3/conductivity endpoint (chelstein/zerotrustradio); operator-
  // supplied inputs.ground_sigma_mS_m always wins over the lookup.
  // No separate sidecar is registered because no public JSON authority
  // endpoint exists for σ at lat/lon — FCC, NOAA NCEI, and ITU-R BR
  // all publish the data only as static files, not live APIs.  Prior
  // FCC/NOAA/ITU client stubs that guessed at endpoint URLs were
  // removed in this PR to comply with the no-guessing rule.
  // NEC2++ / PyNEC antenna-modeling sidecar.  GPL v2 isolated in a
  // separate process; Genoa only talks to it over HTTP.  Set
  // NEC_SIDECAR_URL on the deploy to enable; Genoa works without it.
  nec:         makeNecClient({ baseUrl: process.env.NEC_SIDECAR_URL || null }),
  // FCC LMS / public-files / FMQ-AMQ consolidated client.  Public
  // upstreams (no auth required); always on unless explicitly disabled.
  fccLms:      process.env.FCC_LMS_DISABLE === '1' ? null : makeFccLmsClient(),
  // FCC ASR / opendata.fcc.gov Socrata client (47 CFR §17.4 antenna
  // structure registration cross-check).  Default upstream is the
  // public Socrata dataset; no auth required.  Disable with
  // ASR_SOCRATA_DISABLE=1.
  asr:         makeAsrClient(),
  // FAA OE/AAA client — Form 7460-1 obstruction-evaluation
  // determinations.  Cross-references the asr.faa_study_number to
  // pull the FAA's verbatim determination + lighting/marking
  // FAA OE/AAA support: makeFaaOeClient() is imported on-demand by
  // exhibitService.js (see checkFaaAgainstAsr).  Registry row for the
  // /api/sidecars/probe panel is kept below; no sidecars.faaOe needed.
  airports:    makeAirportsClient(),
  // FCC FORTRAN reference engine (chelstein/fcc-fortran-engine — a
  // microservice that links and calls the FCC/REC TVFMFS_METRIC routine
  // directly).  Used as a deterministic PARITY reference against
  // Genoa's own vendored tvfm_curves.js engine.  Opt-in via
  // FORTRAN_FCC_SIDECAR_URL on the deploy; Genoa runs untouched on
  // the vendored curves dataset when unset.  See
  // src/evidence/fortranFccClient.js for the contract.
  fortranFcc:  makeFortranFccClient(),
  // FCCAM (AM skywave) reference engine — FastAPI wrapper around the
  // FCC's public-domain Fccam.for (Wang 1985 skywave model permitted
  // under 47 CFR §73.190(c)).  Authoritative 50% skywave field-strength
  // source for §73.182 AM nighttime allocation analysis.  Opt-in via
  // FCCAM_SIDECAR_URL on the deploy; when unset, AM-night analysis
  // degrades explicitly rather than substituting a different engine.
  // See genoa/src/sidecars/fccam/ for the sidecar code + deploy doc
  // and src/evidence/fccamClient.js for the contract.
  // FCCAM is the primary AM skywave engine.  When FCCAM_SIDECAR_URL
  // is unset the registry falls through to the Berry analytical
  // implementation (47 CFR §73.190(c) explicitly permits it),
  // labeled as SCREENING-grade so reviewers can tell at a glance
  // which engine produced the §73.182 NIF numbers.  Operator can
  // disable the Berry fallback entirely with
  // GENOA_BERRY_SKYWAVE_FALLBACK=false (then AM-night degrades to
  // the existing "FCCAM not configured" diagnostic instead).
  fccam:       makeFccamClient() || makeBerrySkywaveClient(),

  // FCC Sunrise/Sunset Authority (SRSSTIME) sidecar.  Opt-in via
  // FCC_SUN_SIDECAR_URL on the deploy (+ FCC_SUN_API_TOKEN for
  // bearer auth).  Used by the AM Sunrise / Sunset Authority panel
  // and the (forthcoming) §73.99 PSRA / PSSA reduced-power calc.
  // When unset the panel renders the "sidecar unavailable" warning
  // and the study still ships — no block.
  sun:         makeFccSunClient(),

  // AM Physics (SOMNEC2D) sidecar — NEC-family FORTRAN ground-field
  // solver that numerically evaluates modified Sommerfeld integrals
  // to produce the SOM2D.NEC interpolation grid used by NEC-2 /
  // NEC2++ for AM directional-array near-field / far-field analysis
  // over lossy ground.  ADVISORY ONLY — never modifies §73.184 contour
  // distances, §73.183 allocation results, or any filing-controlling
  // rule math.  Opt-in via AM_PHYSICS_SIDECAR_URL on the deploy; when
  // unset the AM exhibit attaches evidence.am_physics =
  // { status:'not_configured' } and the study still ships.
  amPhysics:   makeAmPhysicsClient(),

  // Geo-RF Evidence sidecar — environmental geospatial datasets used for
  // advisory confidence-scoring and observed-vs-predicted residual
  // support.  Wraps a microservice that surfaces:
  //   - USFS Tree Canopy Cover (CONUS) per-point sample
  //   - tau_statistic_for_rf_models artifact availability
  //   - NRCan Canada landcover availability (for cross-border studies)
  // ADVISORY ONLY — never modifies §73.184 / §73.182 / §73.190 / §73.313
  // / §73.207 / §73.215 contour or allocation math.  Opt-in via
  // GEO_RF_EVIDENCE_SIDECAR_URL on the deploy; when unset the exhibit
  // attaches evidence.geo_rf_evidence = { status:'not_configured' } and
  // ships unchanged.
  geoRfEvidence: makeGeoRfEvidenceClient()
});

// SIDECAR_REGISTRY — additive metadata describing each sidecar's role,
// filing effect, and which broadcast services rely on it.  Used by
// /readyz to annotate the per-sidecar status block and by docs/exhibits
// to surface "which engine produced this number".  This registry does
// NOT change runtime selection — the `sidecars` map above is the source
// of truth for client wiring; this registry is descriptive metadata only.
//
// filing_effect semantics:
//   'authoritative' — output feeds §73.* rule math directly (contours,
//                     allocation, allotment, NIF, sunrise/sunset).
//   'none'          — advisory / observability only; cannot move a
//                     contour or change an allocation outcome.
//
// role taxonomy:
//   'fcc'                — FCC-authored or FCC-data reference engine.
//   'advisory_physics'   — physics solver attached as evidence only.
//   'environmental'      — environmental / geospatial evidence dataset.
//   'identity'           — station-identity / RadioDNS / EAS lookups.
//   'rendering'          — exhibit page rendering (headless browser).
//   'reference_engine'   — non-FCC vendored engine kept for parity.
//   'observability'      — measurement / telemetry collection.
export const SIDECAR_REGISTRY = Object.freeze([
  {
    name: 'fortranFcc',
    url_env_var: 'FORTRAN_FCC_SIDECAR_URL',
    role: 'fcc',
    filing_effect: 'authoritative',
    required_for: ['FM','LPFM','FX','TV'],
    current_url: process.env.FORTRAN_FCC_SIDECAR_URL || null
  },
  {
    name: 'fccam',
    url_env_var: 'FCCAM_SIDECAR_URL',
    role: 'fcc',
    filing_effect: 'authoritative',
    required_for: ['AM'],
    current_url: process.env.FCCAM_SIDECAR_URL || null
  },
  {
    name: 'sun',
    url_env_var: 'FCC_SUN_SIDECAR_URL',
    role: 'fcc',
    filing_effect: 'authoritative',
    required_for: ['AM'],
    current_url: process.env.FCC_SUN_SIDECAR_URL || null
  },
  {
    name: 'fccContours',
    url_env_var: 'FCC_CONTOURS_URL',
    role: 'fcc',
    filing_effect: 'authoritative',
    required_for: ['FM','LPFM','FX','TV','AM'],
    current_url: process.env.FCC_CONTOURS_URL || null
  },
  {
    name: 'fccLms',
    url_env_var: 'FCC_LMS_URL',
    role: 'fcc',
    filing_effect: 'authoritative',
    required_for: ['AM','FM','LPFM','FX','TV'],
    current_url: process.env.FCC_LMS_URL || null
  },
  {
    name: 'asr',
    url_env_var: 'ASR_SIDECAR_URL',
    role: 'fcc',
    filing_effect: 'authoritative',
    required_for: ['AM','FM','LPFM','FX','TV'],
    current_url: process.env.ASR_SIDECAR_URL || null
  },
  {
    name: 'faaOe',
    url_env_var: 'FAA_OE_SIDECAR_URL',
    role: 'fcc',
    filing_effect: 'authoritative',
    required_for: ['AM','FM','LPFM','FX','TV'],
    current_url: process.env.FAA_OE_SIDECAR_URL || null
  },
  {
    name: 'amPhysics',
    url_env_var: 'AM_PHYSICS_SIDECAR_URL',
    role: 'advisory_physics',
    filing_effect: 'none',
    required_for: ['AM'],
    current_url: process.env.AM_PHYSICS_SIDECAR_URL || null
  },
  {
    name: 'nec',
    url_env_var: 'NEC_SIDECAR_URL',
    role: 'advisory_physics',
    filing_effect: 'none',
    required_for: ['AM','FM','LPFM','FX','TV'],
    current_url: process.env.NEC_SIDECAR_URL || null
  },
  {
    name: 'geoRfEvidence',
    url_env_var: 'GEO_RF_EVIDENCE_SIDECAR_URL',
    role: 'environmental',
    filing_effect: 'none',
    required_for: ['AM','FM','LPFM','FX','TV'],
    current_url: process.env.GEO_RF_EVIDENCE_SIDECAR_URL || null
  },
  {
    name: 'splat',
    url_env_var: 'SPLAT_SIDECAR_URL',
    role: 'reference_engine',
    filing_effect: 'none',
    required_for: ['FM','LPFM','FX','TV'],
    current_url: process.env.SPLAT_SIDECAR_URL || null
  },
  {
    name: 'identity',
    url_env_var: 'IDENTITY_SIDECAR_URL',
    role: 'identity',
    filing_effect: 'none',
    required_for: ['AM','FM','LPFM','FX','TV'],
    current_url: process.env.IDENTITY_SIDECAR_URL || null
  },
  {
    name: 'map',
    url_env_var: 'MAP_SIDECAR_URL',
    role: 'rendering',
    filing_effect: 'none',
    required_for: ['FM','LPFM','FX','TV','AM'],
    current_url: process.env.MAP_SIDECAR_URL || null
  },
  {
    name: 'population',
    url_env_var: 'POPULATION_EVIDENCE_URL',
    role: 'reference_engine',
    filing_effect: 'authoritative',
    required_for: ['FM','LPFM','FX','TV','AM'],
    current_url: process.env.POPULATION_EVIDENCE_URL || null
  },
  {
    name: 'facility',
    url_env_var: 'ZTR_BASE_URL',
    role: 'reference_engine',
    filing_effect: 'none',
    required_for: ['AM','FM','LPFM','FX','TV'],
    current_url: process.env.ZTR_BASE_URL || null
  },
  {
    name: 'los',
    url_env_var: 'ZTR_BASE_URL',
    role: 'reference_engine',
    filing_effect: 'none',
    required_for: ['FM','LPFM','FX','TV'],
    current_url: process.env.ZTR_BASE_URL || null
  }
]);

// O(1) metadata lookup keyed by sidecar name.  Used by sidecarStatus()
// to annotate /readyz entries and by getSidecarMeta() for external
// callers (docs generator, exhibit provenance).
const REGISTRY_BY_NAME = Object.freeze(
  Object.fromEntries(SIDECAR_REGISTRY.map(r => [r.name, r]))
);

// Resolve role + filing_effect metadata for a given sidecar key.
// Returns null for keys not present in SIDECAR_REGISTRY so callers
// degrade gracefully without crashing.
export function getSidecarMeta(name){
  return REGISTRY_BY_NAME[name] || null;
}

// Probe one sidecar.  Health() if the client provides it; otherwise GET
// /health on the baseUrl with a 3-s timeout.  Each probe also returns
// the elapsed time so the UI can surface "slow but reachable" states.
async function probeOne(name, c){
  const meta = REGISTRY_BY_NAME[name];
  if (!c) return [name, {
    configured: false,
    healthy:    false,
    role:           meta ? meta.role          : null,
    filing_effect:  meta ? meta.filing_effect : null
  }];
  const t0 = Date.now();
  let healthy = false;
  try {
    if (typeof c.health === 'function'){
      healthy = !!(await c.health());
    } else if (c.baseUrl){
      const r = await fetch(c.baseUrl.replace(/\/$/, '') + '/health', { signal: AbortSignal.timeout(3000) });
      healthy = r.ok;
    }
  } catch { healthy = false; }
  return [name, {
    configured: true,
    healthy,
    baseUrl:    c.baseUrl || null,
    latency_ms: Date.now() - t0,
    role:           meta ? meta.role          : null,
    filing_effect:  meta ? meta.filing_effect : null
  }];
}

// Probe every configured sidecar in parallel so a single slow upstream
// doesn't block the readiness response.  Worst case is the timeout of
// the slowest probe (3 s), not Σ (timeouts).
export async function sidecarStatus(){
  const entries = await Promise.all(
    Object.entries(sidecars).map(([name, c]) => probeOne(name, c))
  );
  return Object.fromEntries(entries);
}
