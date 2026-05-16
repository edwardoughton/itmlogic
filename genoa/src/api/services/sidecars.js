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

import { makeTerrainClient }     from '../../evidence/terrain/client.js';
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
import { makeLosClient }         from '../../evidence/losClient.js';
import { makeFaaOeClient }       from '../../evidence/faaOeClient.js';
import { makeFortranFccClient }  from '../../evidence/fortranFccClient.js';
import { makeFccamClient }       from '../../evidence/fccamClient.js';

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
  terrain:     makeTerrainClient ({ baseUrl: process.env.TERRAIN_SIDECAR_URL  }),
  // SPLAT sidecar (chelstein/splat — Genoa Flask sidecar).  When set,
  // Genoa probes its capability and surfaces SPLAT availability /
  // DEM-provisioning state as evidence provenance.
  splat:       makeSplatClient   ({ baseUrl: process.env.SPLAT_SIDECAR_URL    }),
  identity:    makeIdentityClient({ baseUrl: process.env.IDENTITY_SIDECAR_URL }),
  measurement: process.env.MEASUREMENT_SIDECAR_URL ? { baseUrl: process.env.MEASUREMENT_SIDECAR_URL } : null,
  // Map sidecar (chelstein/itmlogic — genoa/src/sidecars/map).  Headless
  // Chromium that renders the §73.333 contour-map exhibit page.  Fail-soft:
  // when unset, the engineering-statement PDF emits the deferred-to-engineer
  // placeholder for the map page instead of failing.
  map:         process.env.MAP_SIDECAR_URL         ? { baseUrl: process.env.MAP_SIDECAR_URL         } : null,
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
  // ZTR LOS profile client — point-to-point line-of-sight + Fresnel
  // clearance via ZTR's /api/los/profile.  Same upstream as Facility,
  // separate row so the panel surfaces ZTR's LOS capability
  // distinctly from the broadcast-stations endpoint.
  los:         makeLosClient(),
  // FAA OE/AAA client — Form 7460-1 obstruction-evaluation
  // determinations.  Cross-references the asr.faa_study_number to
  // pull the FAA's verbatim determination + lighting/marking
  // conditions for the Tower Study exhibit.  Default upstream is
  // oeaaa.faa.gov (host-reachable check only); set FAA_OE_SIDECAR_URL
  // for an operator proxy that returns clean JSON, or
  // FAA_OE_HTML_FALLBACK=1 to opt into the HTML scrape (unimplemented
  // in this build).
  faaOe:       makeFaaOeClient(),
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
  fccam:       makeFccamClient()
});

// Probe one sidecar.  Health() if the client provides it; otherwise GET
// /health on the baseUrl with a 3-s timeout.  Each probe also returns
// the elapsed time so the UI can surface "slow but reachable" states.
async function probeOne(name, c){
  if (!c) return [name, { configured: false, healthy: false }];
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
    latency_ms: Date.now() - t0
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
