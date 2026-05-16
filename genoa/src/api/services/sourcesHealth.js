// Per-source health probes for the data-source fallback chains.
//
// Genoa orchestrates seven independent external data flows; each one has
// a primary upstream plus one or two fallbacks.  This module probes each
// source independently so operators can see at runtime which fallback
// the next exhibit will hit.
//
// FALLBACK MATRIX
//
//   Query                   Primary                   Secondary                Tertiary
//   ---------------------   -----------------------   ---------------------    ----------------------
//   Facility metadata       ZTR /api/broadcast        FCC FMQ/AMQ direct       n8n station/analyze
//   FCC contour             ZTR _fcc_contour          geo.fcc.gov direct       engine self-computes
//   Per-radial HAAT         FCC contour HAAT          ZTR terrain-haat         USGS+OpenMeteo+OpenTopoData
//   Population/Census       operator pop sidecar      geo.fcc.gov/api/census   — (api.census.gov probed; not wired)
//   Nearby primaries        FCC FMQ direct            FCC AMQ direct           — (parallel sources)
//   Rich station / SDR      ZTR /api/radiodns         —                         — (vendor-locked)
//   Identity / RadioDNS     identity sidecar          ZTR rich-station          — (RadioDNS resolver record)
//   Antenna modeling        NEC sidecar               —                         — (GPL-isolated; NEC2++/PyNEC)
//
// Each probe is fire-and-forget, capped at 3-5s, and reports:
//   { configured: bool, reachable: bool, endpoint, latency_ms, error? }
//
// `configured: false` means the source is intentionally not enabled
// (env var unset).  `reachable: false` with `configured: true` is the
// real failure mode that operators want to see in /readyz.

const PROBE_TIMEOUT_MS = 3500;

async function probe(url, opts = {}){
  if (!url) return { configured: false, reachable: false };
  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    const r = await fetch(url, {
      method:  opts.method || 'HEAD',
      signal:  ctrl.signal,
      headers: opts.headers || {},
      ...(opts.body ? { body: opts.body } : {})
    });
    clearTimeout(t);
    return {
      configured: true,
      reachable:  r.ok || r.status === 405,   // 405 = HEAD not allowed; upstream is alive
      endpoint:   url,
      latency_ms: Date.now() - t0,
      http_status: r.status
    };
  } catch (e){
    return {
      configured: true,
      reachable:  false,
      endpoint:   url,
      latency_ms: Date.now() - t0,
      error:      String(e.message)
    };
  }
}

export async function probeAllSources(){
  const ztrUrl       = process.env.ZERO_TRUST_RADIO_READONLY_URL || null;
  const n8nUrl       = process.env.N8N_BASE_URL                  || null;
  const popUrl       = process.env.POPULATION_EVIDENCE_URL       || null;
  const terrainUrl   = process.env.TERRAIN_SIDECAR_URL           || null;
  const splatUrl     = process.env.SPLAT_SIDECAR_URL             || null;
  const identityUrl  = process.env.IDENTITY_SIDECAR_URL          || null;
  const necUrl       = process.env.NEC_SIDECAR_URL               || null;
  const fortranUrl   = process.env.FORTRAN_FCC_SIDECAR_URL       || null;

  // Probe each independently and in parallel.
  const [
    ztrHealth, n8nHealth, popSidecar, terrainSidecar, splatSidecar, identitySidecar,
    necSidecar, fortranFccSidecar,
    fccFmq, fccAmq, fccContours, fccCensus,
    publicFiles,
    usgsEpqs, openMeteo, openTopoData,
    censusBureau
  ] = await Promise.all([
    probe(ztrUrl       ? ztrUrl       + '/healthz' : null),
    probe(n8nUrl       ? n8nUrl       + '/healthz' : null),
    probe(popUrl       ? popUrl       + '/health'  : null),
    probe(terrainUrl   ? terrainUrl   + '/health'  : null),
    probe(splatUrl     ? splatUrl     + '/healthz' : null),
    probe(identityUrl  ? identityUrl  + '/health'  : null),
    // NEC sidecar /health must be GET (not HEAD) because the body
    // carries the actionable pynec_available + pynec_version fields.
    probe(necUrl       ? necUrl       + '/health'  : null, { method: 'GET' }),
    // FORTRAN FCC reference engine — fcc-fortran-engine microservice
    // wrapping TVFMFS_METRIC.  Health endpoint is /healthz (text "ok").
    probe(fortranUrl   ? fortranUrl   + '/healthz' : null),
    // Always-on public upstreams (no env gate).  HEAD on the index host.
    probe('https://transition.fcc.gov/fcc-bin/fmq?list=4&service=FM&call=KSLX'),
    probe('https://transition.fcc.gov/fcc-bin/amq?list=4&call=KSLX'),
    probe('https://geo.fcc.gov/api/contours/entity.json?facilityId=53996&serviceType=FM&unit=km', { method: 'GET' }),
    probe('https://geo.fcc.gov/api/census/area?lat=33.33&lon=-112.06&censusYear=2020&format=json', { method: 'GET' }),
    probe('https://publicfiles.fcc.gov/api/manager/folder/fm/53996/contents', { method: 'GET' }),
    probe('https://epqs.nationalmap.gov/v1/json?x=-112.06&y=33.33&wkid=4326&units=Meters', { method: 'GET' }),
    probe('https://api.open-meteo.com/v1/elevation?latitude=33.33&longitude=-112.06', { method: 'GET' }),
    probe('https://api.opentopodata.org/v1/srtm30m?locations=33.33,-112.06', { method: 'GET' }),
    probe('https://api.census.gov/data/2020/dec/pl?get=NAME&for=state:04', { method: 'GET' })
  ]);

  // Build the per-query fallback report.  Each query reports:
  //   primary / secondary / tertiary, with the first reachable one marked.
  const chains = {
    facility_metadata: pickFirst([
      { tier: 'primary',   id: 'zerotrustradio',  health: ztrHealth },
      { tier: 'secondary', id: 'fcc-fmq-direct',  health: fccFmq    },
      { tier: 'tertiary',  id: 'n8n-webhook',     health: n8nHealth }
    ]),
    fcc_contour: pickFirst([
      { tier: 'primary',   id: 'zerotrustradio',     health: ztrHealth },
      { tier: 'secondary', id: 'geo-fcc-contours',   health: fccContours },
      { tier: 'tertiary',  id: 'engine-self-compute', health: { configured: true, reachable: true, endpoint: 'engine/curves/fcc/tvfm_curves.js (vendored)' } }
    ]),
    // §73.333 F(50,50) / F(50,10) distance math — where does the actual
    // FCC curve solver run.  Primary = the FORTRAN reference engine
    // (chelstein/fcc-fortran-engine wrapping TVFMFS_METRIC) when
    // configured; secondary = Genoa's in-process vendored tvfm_curves.js
    // dataset.  Not marked critical because the secondary is always
    // available (it ships in-tree).
    fcc_curve_engine: pickFirst([
      { tier: 'primary',   id: 'fcc-tvfmfs-fortran',  health: fortranFccSidecar },
      { tier: 'secondary', id: 'engine-self-compute', health: { configured: true, reachable: true, endpoint: 'engine/curves/fcc/tvfm_curves.js (vendored)' } }
    ], fortranUrl ? null : 'FORTRAN_FCC_SIDECAR_URL not set; engine runs on vendored tvfm_curves.js only'),
    terrain_haat: pickFirst([
      { tier: 'primary',   id: 'fcc-contour-haat',     health: fccContours },
      { tier: 'secondary', id: 'ztr-terrain-haat',     health: ztrHealth   },
      { tier: 'tertiary',  id: 'multi-source-elev',    health: bestOf([usgsEpqs, openMeteo, openTopoData]) }
    ]),
    elevation_sources: {
      usgs_epqs:        usgsEpqs,
      open_meteo:       openMeteo,
      opentopodata:     openTopoData
    },
    population_census: pickFirst([
      { tier: 'primary',   id: 'operator-pop-sidecar', health: popSidecar },
      { tier: 'secondary', id: 'geo-fcc-census',       health: fccCensus  }
    ], censusBureau.reachable
      ? 'api.census.gov reachable but not yet wired as 3rd-tier client'
      : null),
    nearby_primaries: pickFirst([
      { tier: 'primary',   id: 'fcc-fmq-direct', health: fccFmq },
      { tier: 'secondary', id: 'fcc-amq-direct', health: fccAmq }
    ]),
    rich_station_sdr: pickFirst([
      { tier: 'primary',   id: 'zerotrustradio',  health: ztrHealth }
    ], 'vendor-locked: SDR captures have no public alternative'),
    identity_radiodns: pickFirst([
      { tier: 'primary',   id: 'identity-sidecar',          health: identitySidecar },
      { tier: 'secondary', id: 'zerotrustradio-radiodns',   health: ztrHealth }
    ], 'ZTR /api/radiodns/station/:id carries PI/GCC/FQDN/bearer/service URLs as a 2nd-tier RadioDNS source'),
    antenna_modeling: pickFirst([
      { tier: 'primary', id: 'nec-sidecar (NEC2++/PyNEC, GPL-isolated)', health: necSidecar }
    ], 'NEC2++ is GPL v2 — isolated as external sidecar; Genoa never links it.  Set NEC_SIDECAR_URL on the deploy to enable.'),
    fcc_lms: pickFirst([
      { tier: 'primary',   id: 'fcc-fmq-amq',         health: bestOf([fccFmq, fccAmq]) },
      { tier: 'secondary', id: 'publicfiles.fcc.gov', health: publicFiles }
    ], 'FCC LMS authoritative-record cross-reference: license expiration / status / public-file folder.  No auth required; degraded but not broken when either upstream is rate-limited.')
  };

  // Surface ANY-CRITICAL — does every query have at least one reachable source?
  const critical = ['facility_metadata', 'fcc_contour', 'terrain_haat', 'population_census', 'nearby_primaries'];
  const all_critical_have_a_reachable_source = critical.every(k =>
    chains[k]?.tiers?.some(t => t.health.reachable));

  return {
    fallback_matrix_version: 1,
    probed_at:               new Date().toISOString(),
    timeout_ms:              PROBE_TIMEOUT_MS,
    all_critical_have_a_reachable_source,
    chains,
    raw_probes: {
      ztr: ztrHealth, n8n: n8nHealth, population_sidecar: popSidecar,
      terrain_sidecar: terrainSidecar, splat_sidecar: splatSidecar, identity_sidecar: identitySidecar,
      nec_sidecar: necSidecar,
      fortran_fcc_sidecar: fortranFccSidecar,
      fcc_fmq: fccFmq, fcc_amq: fccAmq, fcc_contours: fccContours, fcc_census: fccCensus,
      publicfiles_fcc_gov: publicFiles,
      usgs_epqs: usgsEpqs, open_meteo: openMeteo, opentopodata: openTopoData,
      us_census_bureau: censusBureau
    }
  };
}

function pickFirst(tiers, vendorNote = null){
  // Mark the first reachable source as the active one.
  let active = null;
  for (const t of tiers){
    if (t.health.reachable && !active) active = t.id;
  }
  return {
    active_source:  active,
    n_tiers:        tiers.length,
    n_reachable:    tiers.filter(t => t.health.reachable).length,
    vendor_note:    vendorNote,
    tiers
  };
}

function bestOf(probes){
  // For an OR-relationship cluster, the cluster is healthy if ANY member is.
  const reachable = probes.find(p => p.reachable);
  if (reachable) return reachable;
  return probes[0] || { configured: false, reachable: false };
}
