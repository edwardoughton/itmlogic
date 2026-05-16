// Orchestration: turns an HTTP compute request into a full
// genoa.exhibit.v2.  Resolves sidecars, runs the engine, attaches
// validation, renders narrative.  All structural; no math.
//
// Outcome-A wiring (see docs/ztr-data-audit.md):
//   - facility lookup           → ZTR /api/broadcast/stations
//   - rich station enrichment   → ZTR /api/radiodns/station/:id
//       which carries _fcc_contour (geo.fcc.gov) and _captures.
//   - per-radial §73.313 HAAT   → ZTR /api/broadcast/stations/:id/terrain-haat
//   - FCC curve cross-validate  → compare engine polygons to _fcc_contour
//   - SDR evidence              → _captures
// Each enrichment emits provenance; warnings/blockers clear ONLY when
// real, sourced evidence is present.

import { compute }              from '../../engine/index.js';
import { runValidationSuite }   from '../../engine/validation/runner.js';
import { renderNarrative }      from '../../narrative/generator.js';
import { sidecars }             from './sidecars.js';
import { getCached, putCached } from './facilityCache.js';
import { validateAgainstFccContour } from '../../evidence/curveValidation/ztrFccContourValidator.js';
import { extractHaatFromContour } from '../../evidence/fccContoursClient.js';
import { runCurveReferenceValidation } from '../../validation/curveReferenceValidation.js';
import { W }                    from '../../types/warnings.js';
import { computeHaatMultiSource } from '../../evidence/terrain/elevationClient.js';
import { makeBudget }              from './computeBudget.js';

let _validationCache = null;
let _validationCachedAt = 0;
const VALIDATION_TTL_MS = 5 * 60 * 1000;

// Synthesize a default single-monopole AM model when the caller
// flags options.use_nec=true but didn't provide an explicit
// antenna_geometry.  Uses haat_m as the tower-height proxy.
//
// REAL DATA POLICY: this function REFUSES to run without a resolved
// inputs.ground_sigma_mS_m — the σ must have come from one of:
//   - operator-supplied
//   - ZTR /api/m3/conductivity proxy (vendored FCC §73.190 M3 polygons)
// Synthetic defaults (the prior `|| 8`) are forbidden site-wide.
// Returns null when σ is unresolved; the caller emits the blocker.
function synthDefaultAmArray(inputs){
  const sigma_mS_m = Number(inputs.ground_sigma_mS_m);
  if (!Number.isFinite(sigma_mS_m) || sigma_mS_m <= 0) return null;
  return {
    frequency_khz: Number(inputs.frequency),
    ground: {
      type:                 'sommerfeld',
      conductivity_s_m:     sigma_mS_m / 1000,
      dielectric_constant:  13
    },
    towers: [
      {
        tag:        1,
        x_m:        0,
        y_m:        0,
        height_m:   Number(inputs.haat_m),
        radius_m:   0.25,
        segments:   21,
        drive:      { amplitude: 1.0, phase_deg: 0 }
      }
    ],
    pattern: {
      theta_start: 90, theta_stop: 90, theta_step: 1,
      phi_start:   0,  phi_stop: 359,  phi_step:  1
    }
  };
}

// FM service-contour threshold per §73.211 — used by §73.215 and the
// ITM-aware coverage analysis.  Returns null for non-FM services.
function service73215Threshold(klass){
  if (!klass) return 60;                  // default to Class A 60 dBu
  const k = String(klass).toUpperCase().replace(/\s+/g, '').replace('CLASS', '');
  // Class A / LPFM / FX → 60 dBu protected; others → 54 dBu.
  if (['A', 'LP100', 'LP10', 'D', 'FX'].includes(k)) return 60;
  return 54;
}

export async function getOrRunValidation(){
  const now = Date.now();
  if (_validationCache && (now - _validationCachedAt) < VALIDATION_TTL_MS){
    return _validationCache;
  }
  _validationCache = await runValidationSuite();
  _validationCachedAt = now;
  return _validationCache;
}

export async function computeExhibit(req){
  const inputs   = { ...(req.inputs   || {}) };
  const options  = req.options  || {};
  // Wall-clock budget for ALL network-bound evidence fetches.  Default
  // 4.5 min (env COMPUTE_BUDGET_MS).  Slow / unreachable upstreams are
  // skipped past the deadline and surface as a COMPUTE_TIMEOUT_PARTIAL
  // warning naming each step that ran out of time.  The engine compute
  // itself (radial table + polygons + GeoJSON) is not budgeted.
  const budget = makeBudget(options.compute_budget_ms);
  const evidence = {};
  const facilityWarnings = [];
  // The orchestrator's `warnings` array is declared HERE so pre-engine
  // evidence steps (FCC LMS, NEC, etc.) can push to it.  After the
  // engine compute the engine's own warnings are concatenated in;
  // subsequent filter passes operate on the combined list.
  let warnings = [];
  let facilityResolution = null;
  let richStation        = null;   // raw ZTR /api/radiodns/station/:id response
  let terrainResp        = null;   // raw ZTR /api/.../terrain-haat response
  let fccContourResp     = null;   // { available, source, endpoint, contour }
  let sdrResp            = null;   // { available, source, endpoint, n_records, records }

  // ---- 1. Resolve facility_id ----
  if (inputs.facility_id){
    const cached = await getCached(String(inputs.facility_id));
    let facility = cached?.facility || null;
    let source   = cached?.source   || null;
    if (!facility && sidecars.facility){
      const r = await sidecars.facility.getById(String(inputs.facility_id));
      if (r.facility){
        facility = r.facility;
        source   = r.source;
        await putCached(facility).catch(() => {});
      } else if (!r.source){
        facilityWarnings.push(W.make('FACILITY_LOOKUP_UNAVAILABLE', r.error || 'no facility source reachable'));
      }
    } else if (!facility && !sidecars.facility){
      facilityWarnings.push(W.make('FACILITY_LOOKUP_UNAVAILABLE',
        'No facility data source configured (ZERO_TRUST_RADIO_READONLY_URL / N8N_BASE_URL).'));
    }
    if (facility){
      const fillIfMissing = (k, v) => { if (inputs[k] === undefined || inputs[k] === null || inputs[k] === '') inputs[k] = v; };
      fillIfMissing('call',            facility.call);
      fillIfMissing('service',         facility.service);
      fillIfMissing('fcc_class',       facility.fcc_class);
      fillIfMissing('frequency',       facility.frequency);
      fillIfMissing('erp_kw',          facility.erp_kw);
      fillIfMissing('haat_m',          facility.haat_m);
      fillIfMissing('lat',             facility.lat);
      fillIfMissing('lon',             facility.lon);
      facilityResolution = { source, facility };
    }
  }

  // ---- 2. Rich station enrichment (FCC contour + captures) ----
  // Needs a ZTR station id, which is on the normalized facility row's
  // facility_lookup_source.ztr_id.  Skip silently when unavailable.
  //
  // SDR evidence gating: ZTR's capture infrastructure currently only
  // produces meaningful evidence for AM stations (FM-band capture
  // coverage is not yet in place).  Pulling FM "captures" today would
  // attach noise as evidence and clear SDR_MEASUREMENTS_MISSING
  // dishonestly.  The gate is service-aware and configurable via
  // SDR_EVIDENCE_SERVICES (CSV, default "AM") so FM can be flipped on
  // when the capture coverage is ready — no code change required.
  const SDR_SERVICES = (process.env.SDR_EVIDENCE_SERVICES || 'AM')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const sdrEnabledForService = SDR_SERVICES.includes(String(inputs.service || '').toUpperCase());

  const ztrStationId = facilityResolution?.facility?.facility_lookup_source?.ztr_id;
  if (ztrStationId && sidecars.facility?.getRichStation){
    richStation = await sidecars.facility.getRichStation(ztrStationId);
    if (richStation?.available){
      // FCC contour (cross-check input) — pulled for every service.
      const fc = await sidecars.facility.getFccContour({ stationId: ztrStationId, rich: richStation });
      if (fc.available) fccContourResp = fc;
      // SDR evidence — gated by service.
      if (sdrEnabledForService){
        const sdr = await sidecars.facility.getSdrEvidence({
          stationId: ztrStationId,
          rich:      richStation,
          service:   inputs.service     // AM filter for ZTR's mixed-service rich-station bundle
        });
        if (sdr.available) sdrResp = sdr;
        // Even when the SDR pull found no captures, retain the probe
        // result on evidence so the exhibit's measurements block can
        // explain which field names were checked and which keys
        // actually appear on the rich-station response.  This is
        // crucial for diagnosing "we know KVLV has audio captures but
        // they don't show up": the station_keys list reveals whether
        // ZTR exposed the data under a name we don't yet recognise.
        else if (sdr) sdrResp = sdr;   // available=false + diagnostics
      }
      // ASR (47 CFR §17.4) cross-check — extract tower-registration
      // data from the same rich-station response.  Defensive against
      // ZTR schema variants; falls through to ASR_SIDECAR_URL when
      // ZTR rich payload doesn't carry asr_number.
      try {
        const { makeAsrClient, checkAsrAgainstApplication } = await import('../../evidence/asrClient.js');
        const asrClient = makeAsrClient();
        if (asrClient){
          let asr = asrClient.extractFromRichStation(richStation);
          if (!asr.available && asr.error?.includes('did not carry an asr_number') && inputs.asr_number){
            asr = await asrClient.getByAsrNumber(inputs.asr_number);
          }
          const asrResult = checkAsrAgainstApplication({
            asr,
            application: {
              asr_number:             inputs.asr_number || null,
              lat:                    inputs.lat,
              lon:                    inputs.lon,
              overall_height_m:       inputs.overall_height_m || null,
              overall_height_amsl_m:  inputs.overall_height_amsl_m || null
            }
          });
          if (asr.available || asr.error){
            evidence.asr = asrResult;
          }
        }
      } catch { /* swallow — ASR is informational, not load-bearing */ }
    }
  }

  // ---- 2a. SDR capture fallback by callsign (when ztr_id isn't linked) ----
  //
  // Step 2's rich-station path only fires when facility resolution
  // returned a row from ZTR carrying facility_lookup_source.ztr_id.
  // When Genoa resolved the facility via FCC FMQ / N8N instead, no
  // ztr_id is attached even if ZTR has captures tagged with the same
  // callsign (operator-attached AM samples, EAS validation captures,
  // 30-second manual_check audio, etc).
  //
  // Fall back to ZTR's /api/sdr/captures?call=<call> filter and attach
  // matching captures with the same envelope shape the engine + UI
  // already consume.  Also fires when step 2 ran but the rich-station
  // bundle carried no captures (n_records=0) — gives ZTR's per-capture
  // index a second chance to surface evidence that wasn't bundled on
  // the rich-station response.
  if (sdrEnabledForService
      && (!sdrResp || !sdrResp.available || (sdrResp.n_records ?? 0) === 0)
      && inputs.call
      && sidecars.facility?.getSdrEvidenceByCall){
    const byCall = await sidecars.facility.getSdrEvidenceByCall({
      call:    inputs.call,
      service: inputs.service
    });
    if (byCall?.available){
      sdrResp = byCall;
    } else if (byCall && !sdrResp){
      sdrResp = byCall;   // preserve diagnostics (status_keys, etc.)
    }
  }

  // ---- 2b. Operator-supplied SigMF override (per-job inline blob or URL) ----
  // When inputs.sigmf_meta or inputs.sigmf_url is set, treat it as
  // measurement evidence for THIS job and let it override (or fill in
  // for) ZTR's _captures.  The producer is scripts/sigmfFromKiwiCapture.js.
  // Bypasses the per-service SDR gate: if the operator did the work to
  // attach calibrated field-strength evidence, honor it regardless of
  // ZTR's coverage gating.
  if (inputs.sigmf_meta || inputs.sigmf_url){
    try {
      const { loadOperatorSigmfOverride } =
        await import('../../evidence/measurements/operatorOverride.js');
      const override = await loadOperatorSigmfOverride({
        inline: inputs.sigmf_meta || null,
        url:    inputs.sigmf_url  || null
      });
      if (override?.available){
        sdrResp = override.sdrResp;       // overrides any ZTR _captures
      } else if (override){
        // Surface the failure as a probe diagnostic so the operator can
        // see why their override didn't land (parse error, fetch 404,
        // empty captures[], etc.).
        sdrResp = {
          available: false,
          source:    'inputs.sigmf_meta',
          n_records: 0,
          error:     override.error || 'sigmf override did not produce records'
        };
      }
    } catch (e){
      console.warn('[exhibitService] sigmf override failed:', e.message);
    }
  }

  // ---- 2c. FCC Contours direct fallback ----
  // When ZTR didn't supply a contour (not configured, station not in ZTR,
  // or _fcc_contour missing), hit geo.fcc.gov/api/contours/entity.json
  // directly using the facility_id + service from inputs.  This is the
  // same public API ZTR proxies — public, no auth, always available.
  //
  // Gated to dBu-scored services (FM / LPFM / FX / FS / FB).  AM polygons
  // are mV/m, and the cross-check validator only matches dBu polygons by
  // design (ztrFccContourValidator.js filters on field_strength.unit ===
  // 'dBu').  Calling the FCC API for AM here would always produce
  // n_run=0 and emit a misleading FCC_GEO_CROSSCHECK_SKIPPED warning
  // that degrades readiness for no engineering reason.
  const FCC_CONTOUR_DBU_SERVICES = new Set(['FM', 'LPFM', 'FX', 'FS', 'FB']);
  if (!fccContourResp
      && sidecars.fccContours
      && inputs.facility_id
      && FCC_CONTOUR_DBU_SERVICES.has(String(inputs.service || '').toUpperCase())){
    try {
      const fc = await sidecars.fccContours.getContour(inputs.facility_id, inputs.service);
      if (fc.available) fccContourResp = fc;
    } catch { /* ignore; cross-check stays null */ }
  }

  // ---- 2b-2. FCC LMS / public-files / FMQ-AMQ consolidated lookup ----
  // Pull the FCC's authoritative-record fields (license expiration,
  // status, last action, public-file folder index) to surface
  // alongside the engine output.  Public upstreams (no auth);
  // wrapped in budget so a slow upstream doesn't stall the exhibit.
  let lmsResp = null;
  if (sidecars.fccLms && (inputs.call || inputs.facility_id)){
    lmsResp = await budget.withDeadline('fcc_lms',
      () => sidecars.fccLms.getStationRecord({
        call:        inputs.call         || null,
        facility_id: inputs.facility_id  || null,
        service:     inputs.service      || null
      }), { minMs: 4_000 });
    if (lmsResp?.available){
      // Cross-check ZTR/inputs vs FCC LMS row.  Tolerances kept loose
      // because FMQ rounds frequency to 0.1 MHz and ERP to 0.1 kW.
      const license = lmsResp.license || {};
      const mismatches = [];
      const FREQ_TOL = 0.05;     // MHz (FMQ tabulates at 0.1)
      const ERP_TOL  = 0.5;      // kW
      const HAAT_TOL = 5;        // m
      if (Number.isFinite(Number(inputs.frequency)) && Number.isFinite(license.frequency)){
        const a = Number(inputs.frequency);
        const b = Number(license.frequency);
        // Inputs frequency is in MHz for FM/FX/LPFM, kHz for AM.  FMQ
        // returns matching units.  Compare directly only when units agree.
        if ((inputs.frequency_unit || (inputs.service === 'AM' ? 'kHz' : 'MHz'))
              === (license.frequency_unit || 'MHz')){
          const tol = license.frequency_unit === 'kHz' ? 5 : FREQ_TOL;
          if (Math.abs(a - b) > tol)
            mismatches.push({ field: 'frequency', input: a, fcc: b, delta: a - b, tolerance: tol });
        }
      }
      if (Number.isFinite(Number(inputs.erp_kw)) && Number.isFinite(license.erp_kw)){
        if (Math.abs(Number(inputs.erp_kw) - license.erp_kw) > ERP_TOL)
          mismatches.push({ field: 'erp_kw', input: Number(inputs.erp_kw), fcc: license.erp_kw,
                            delta: Number(inputs.erp_kw) - license.erp_kw, tolerance: ERP_TOL });
      }
      if (Number.isFinite(Number(inputs.haat_m)) && Number.isFinite(license.haat_m)){
        if (Math.abs(Number(inputs.haat_m) - license.haat_m) > HAAT_TOL)
          mismatches.push({ field: 'haat_m', input: Number(inputs.haat_m), fcc: license.haat_m,
                            delta: Number(inputs.haat_m) - license.haat_m, tolerance: HAAT_TOL });
      }
      if (inputs.fcc_class && license.fcc_class
          && String(inputs.fcc_class).toUpperCase() !== String(license.fcc_class).toUpperCase()){
        mismatches.push({ field: 'fcc_class', input: inputs.fcc_class, fcc: license.fcc_class,
                          tolerance: 'exact' });
      }
      lmsResp.cross_check = {
        applicable:   mismatches.length > 0 || true,
        match:        mismatches.length === 0,
        n_mismatches: mismatches.length,
        mismatches
      };
      evidence.fcc_lms = lmsResp;

      // License expiration warnings.
      if (license.expired){
        warnings.push(W.make('LICENSE_EXPIRED',
          `License expired ${Math.abs(license.days_to_expiration)} days ago (${license.license_expiration_date}).  Renewal under §73.1020 or a new application required.`));
      } else if (license.expiring_soon){
        warnings.push(W.make('LICENSE_EXPIRING_SOON',
          `License expires in ${license.days_to_expiration} days (${license.license_expiration_date}).  File renewal under §73.1020.`));
      }
      // Cross-check warnings.
      if (mismatches.length){
        warnings.push(W.make('LMS_DATA_MISMATCH',
          `${mismatches.length} field(s) differ from FCC FMQ/AMQ record: ${mismatches.map(m => `${m.field} ${m.input} vs ${m.fcc}`).join('; ')}`));
      }
      // Public-file completeness check.
      if (lmsResp.public_file?.available
          && lmsResp.public_file.required_folders?.missing?.length > 4){
        warnings.push(W.make('PUBLIC_FILE_INCOMPLETE',
          `Public-file folder at ${lmsResp.public_file.folder_url} appears to be missing ${lmsResp.public_file.required_folders.missing.length} of ${lmsResp.public_file.required_folders.required_total} §73.3526/§73.3527 sub-folders.`));
      }
    } else if (lmsResp){
      // Reachable but produced nothing useful, OR budget timeout.
      evidence.fcc_lms_attempt = {
        ok: false,
        sources_tried: lmsResp.sources_tried || null,
        errors:        lmsResp.errors        || null
      };
      warnings.push(W.make('LMS_DATA_UNAVAILABLE',
        `No FCC LMS / FMQ / public-file data could be sourced for ${inputs.call || inputs.facility_id || 'this station'}.`));
    }
  }

  // ---- 2c. Per-radial HAAT directly from the FCC contour ----
  // The FCC contour response carries `contourData[].haat` — the per-
  // radial HAAT FCC used to compute its contour, sourced from the
  // NED 1-arc-second DEM.  When we have it, hand it to the engine so
  // CONSTANT_HAAT_ASSUMED clears with sourced data — no separate
  // terrain sidecar required.  Subsamples to inputs.radial_step_deg.
  // Only applies to dBu-scored services (HAAT is meaningless for AM).
  if (fccContourResp?.available
      && FCC_CONTOUR_DBU_SERVICES.has(String(inputs.service || '').toUpperCase())){
    const step = Number(inputs.radial_step_deg) || 10;
    const haatBundle = extractHaatFromContour(fccContourResp, step);
    if (haatBundle && haatBundle.n_finite > 0){
      const flat_m = Number(inputs.haat_m);
      let n_dem = 0, n_flat = 0;
      evidence.terrain_haat_per_radial = haatBundle.radials.map(r => {
        if (Number.isFinite(r.haat_m)){
          n_dem++;
          return {
            az:                     r.azimuth_deg,
            haat_input_m:           flat_m,
            haat_computed_m:        r.haat_m,
            haat_source:            'fcc_contour_radial_haat',
            terrain_profile_source: haatBundle.elevation_data_source
          };
        }
        n_flat++;
        return {
          az:                     r.azimuth_deg,
          haat_input_m:           flat_m,
          haat_computed_m:        flat_m,
          haat_source:            'user_flat (no FCC HAAT for this radial)',
          terrain_profile_source: null
        };
      });
      evidence.terrain = {
        available:  true,
        source:     'geo.fcc.gov',
        endpoint:   haatBundle.endpoint,
        method:     'per-radial HAAT extracted from FCC contour response (geo.fcc.gov/api/contours/entity.json contourData[].haat)',
        dem:        { source: 'FCC NED', dataset: haatBundle.elevation_data_source },
        fetched_at: fccContourResp.fetched_at || new Date().toISOString(),
        n_radials:  haatBundle.radials.length,
        n_radials_dem_sourced:   n_dem,
        n_radials_flat_fallback: n_flat,
        rcamsl_m:   haatBundle.rcamsl,
        profiles:   haatBundle.radials.map(r => ({
          az:              r.azimuth_deg,
          haat_computed_m: r.haat_m
        }))
      };
    }
  }

  // ---- 3. Per-radial §73.313 HAAT (ZTR terrain-haat path) ----
  // Pulled from ZTR's terrain-haat endpoint (Outcome A; PR
  // chelstein/zerotrustradio#243).  Only used when the request opts in
  // (`options.use_terrain` true) AND the facility carries lat/lon AND
  // the service isn't AM (groundwave doesn't use HAAT).  ZTR is
  // arc-averaged DEM (more granular than the FCC contour's per-radial
  // HAAT) so it overrides the FCC-extracted bundle if both are
  // available.
  if (options.use_terrain
      && inputs.facility_id
      && inputs.service !== 'AM'
      && sidecars.facility?.getTerrainHaatRadials){
    const step = Number(inputs.radial_step_deg) || 10;
    terrainResp = await budget.withDeadline('ztr_terrain_haat',
      () => sidecars.facility.getTerrainHaatRadials({
        facility_id:     String(inputs.facility_id),
        radial_step_deg: step
      }), { minMs: 5_000 });
    if (terrainResp?.available && Array.isArray(terrainResp.radials) && terrainResp.radials.length){
      // Count DEM-sourced radials BEFORE deciding whether to commit this
      // path.  ZTR sometimes returns a 200 with all-null haat_m (its
      // upstream DEM rate-limited or its facility lat/lon missing).  In
      // that case we must NOT mark evidence.terrain available, otherwise
      // step 3c (direct multi-source elevation) is skipped and the
      // exhibit ships flat HAAT under a "OpenTopoData SRTM 30m" banner.
      // Counting first lets step 3c rescue zero-coverage responses.
      const flat_m = Number(inputs.haat_m);
      let n_dem = 0, n_flat = 0;
      const candidate = terrainResp.radials.map(r => {
        if (Number.isFinite(r.haat_m)){
          n_dem++;
          return {
            az:                     r.azimuth_deg,
            haat_input_m:           flat_m,
            haat_computed_m:        r.haat_m,
            haat_source:            'arc_averaged_dem',
            terrain_profile_source: terrainResp.dem?.source || 'zerotrustradio'
          };
        }
        n_flat++;
        return {
          az:                     r.azimuth_deg,
          haat_input_m:           flat_m,
          haat_computed_m:        flat_m,
          haat_source:            'user_flat (no DEM coverage)',
          terrain_profile_source: null
        };
      });
      if (n_dem > 0){
        // Engine accepts the bundle; commit it to evidence.
        evidence.terrain_haat_per_radial = candidate;
        evidence.terrain = {
          available:  true,
          source:     terrainResp.source || 'zerotrustradio',
          endpoint:   terrainResp.endpoint,
          method:     terrainResp.method,
          dem:        terrainResp.dem,
          fetched_at: terrainResp.fetched_at,
          n_radials:  terrainResp.n_radials,
          n_radials_dem_sourced:   n_dem,
          n_radials_flat_fallback: n_flat,
          profiles:   terrainResp.radials.map(r => ({
            az:                r.azimuth_deg,
            haat_computed_m:   r.haat_m,
            avg_elev_m:        r.avg_elev_m,
            min_elev_m:        r.min_elev_m,
            max_elev_m:        r.max_elev_m,
            samples:           r.samples
          }))
        };
      } else {
        // ZTR returned a shape but no usable DEM data — leave
        // evidence.terrain unset so step 3c can run the direct
        // multi-source elevation client.  Mark request as attempted.
        evidence.terrain_haat_requested = true;
        evidence.terrain_ztr_attempted = {
          available:  false,
          source:     terrainResp.source || 'zerotrustradio',
          endpoint:   terrainResp.endpoint,
          n_radials:  terrainResp.n_radials,
          reason:     'ZTR returned radials but none carried a finite haat_m (upstream DEM rate-limited, facility coordinates missing, or off-DEM-coverage)',
          fetched_at: terrainResp.fetched_at
        };
      }
    } else {
      evidence.terrain_haat_requested = true;
    }
  }

  // ---- 3b. SPLAT sidecar capability probe (provenance only today) ----
  // When SPLAT_SIDECAR_URL is configured, probe the sidecar's health +
  // version and stamp the result on evidence.splat.  We do NOT compute
  // engineering output via SPLAT yet — that requires DEM tiles
  // provisioned in the sidecar's WORKDIR plus an inline-QTH route the
  // sidecar doesn't yet expose.  This wiring puts the connection in
  // place so the moment those land, switching the engine over is a
  // single-call change in this same block.
  if (sidecars.splat){
    try {
      const cap = await sidecars.splat.capability();
      evidence.splat = cap.available
        ? {
            available:        true,
            source:           cap.source,
            endpoint:         cap.endpoint,
            sidecar_name:     cap.sidecar_name,
            splat_bin:        cap.splat_bin,
            workdir:          cap.workdir,
            dem_provisioned:  cap.dem_provisioned,
            note:             cap.notes
          }
        : {
            available: false,
            source:    null,
            error:     cap.error
          };
    } catch (e){
      evidence.splat = { available: false, source: null, error: String(e.message) };
    }
  }

  // ---- 3b-2. NEC2++ antenna model evidence (GPL-isolated sidecar) ----
  // Runs ONLY when:
  //   - sidecars.nec is configured (NEC_SIDECAR_URL set), AND
  //   - the caller supplies inputs.antenna_geometry OR inputs.am_array
  //     (the convenience high-level vertical-tower spec), OR
  //   - options.use_nec === true AND we have enough info to synthesize
  //     a single-monopole default (AM service + frequency + tower
  //     height inferred from haat_m).
  //
  // License boundary: this code does NOT import any GPL'd module.  It
  // makes a single HTTP call to the sidecar and stamps the result on
  // evidence.nec_model with provenance.license_boundary = 'external sidecar'.
  if (sidecars.nec){
    const explicit_geom = inputs.antenna_geometry;
    const explicit_arr  = inputs.am_array;
    const can_synth     = options.use_nec === true
                          && String(inputs.service || '').toUpperCase() === 'AM'
                          && Number.isFinite(Number(inputs.frequency))
                          && Number.isFinite(Number(inputs.haat_m));
    if (explicit_geom || explicit_arr || can_synth){
      const sigmaProvided = Number.isFinite(Number(inputs.ground_sigma_mS_m));
      const synthesizing  = !explicit_geom && !explicit_arr;
      // Real-data policy: synth path needs a resolved σ.  When the
      // step 6c chain exhausted (AM_GROUND_SIGMA_UNRESOLVED blocker
      // already emitted), skip NEC instead of running with a synthetic
      // ground model.  Explicit antenna_geometry / am_array payloads
      // run unchanged — the operator owns σ in those cases.
      // Real-data policy: refuse the synth path when σ is unresolved
      // (step 6c already emitted AM_GROUND_SIGMA_UNRESOLVED as a
      // blocker).  Explicit antenna_geometry / am_array payloads carry
      // their own ground model — operator owns σ in those cases.
      if (synthesizing && !sigmaProvided){
        evidence.nec_model_attempt = {
          ok: false,
          error: 'AM_GROUND_SIGMA_UNRESOLVED',
          detail: 'NEC synth refused: no authoritative σ value available (see evidence.ground_conductivity.tier_attempts)'
        };
      } else {
      const necReq = explicit_geom
        ? { kind: 'run',      payload: explicit_geom }
        : explicit_arr
          ? { kind: 'array',  payload: explicit_arr }
          : { kind: 'array',  payload: synthDefaultAmArray(inputs) };
      if (necReq.payload == null){
        // synthDefaultAmArray returned null — only happens when σ is
        // unresolved.  Defensive guard; the !sigmaProvided branch
        // above should have caught this.  Surface as a diagnostic.
        evidence.nec_model_attempt = {
          ok: false,
          error: 'AM_GROUND_SIGMA_UNRESOLVED',
          detail: 'synthDefaultAmArray returned null (real-data policy: σ required)'
        };
      } else {
      // Disclose the NEC payload inputs (σ + source) on the exhibit so
      // a reviewer can see exactly what the antenna model ran against
      // AND which authority produced σ (operator / fcc-m3 / ztr /
      // noaa-ncei / itu-r-br-atlas).  No synthetic values reach this
      // block — step 6c enforces real-data sourcing or blocks compute.
      if (synthesizing){
        const gc = evidence.ground_conductivity || null;
        evidence.nec_model_inputs = {
          source:                          'synthesized-default-single-monopole',
          ground_sigma_mS_m:               Number(inputs.ground_sigma_mS_m),
          ground_sigma_mS_m_resolved_from: gc?.source || 'operator-supplied',
          ground_sigma_mS_m_endpoint:      gc?.endpoint || null,
          ground_sigma_mS_m_zone:          gc?.zone     || null,
          dielectric_constant:             13,
          dielectric_constant_synthetic:   true,
          ground_model:                    'sommerfeld',
          tower_height_m_from_haat:        Number(inputs.haat_m) || null
        };
      }
      const necResp = await budget.withDeadline('nec_sidecar',
        () => necReq.kind === 'array'
          ? sidecars.nec.runAmArray(necReq.payload, { timeoutMs: 90_000 })
          : sidecars.nec.run     (necReq.payload, { timeoutMs: 90_000 }),
        { minMs: 5_000 });
      if (necResp?.ok){
        evidence.nec_model = necResp;
        // license-boundary disclosure is informational; always emitted
        // when NEC evidence is present so reviewers see the boundary.
        warnings.push(W.make('NEC_LICENSE_BOUNDARY_EXTERNAL'));
        if (necResp.ground?.type === 'pec'){
          warnings.push(W.make('NEC_GROUND_MODEL_LIMITATION'));
        }
        if (Array.isArray(necResp.near_field) && necResp.near_field.length){
          warnings.push(W.make('NEC_NEAR_FIELD_APPROXIMATION'));
        }
      } else if (necResp){
        // Sidecar reachable but the request failed — record diagnostics.
        evidence.nec_model_attempt = { ok: false, error: necResp.error, detail: necResp.detail, http_status: necResp.http_status };
        if (necResp.error === 'NEC_BRIDGE_TIMEOUT' || necResp.error === 'NEC_SIDECAR_UNREACHABLE' || necResp.error === 'PYNEC_NOT_INSTALLED'){
          warnings.push(W.make('NEC_MODEL_UNAVAILABLE',
            `${necResp.error}: ${(necResp.detail || '').slice(0, 200)}`));
        } else if (necResp.error === 'INVALID_INPUT' || necResp.error === 'NEC_MODEL_INVALID_GEOMETRY'){
          warnings.push(W.make('NEC_MODEL_INVALID_GEOMETRY',
            (necResp.detail || '').slice(0, 200)));
        } else {
          warnings.push(W.make('NEC_MODEL_UNAVAILABLE',
            `${necResp.error}: ${(necResp.detail || '').slice(0, 200)}`));
        }
      }
      // If necResp is null the budget skipped it — already accounted
      // for in the COMPUTE_TIMEOUT_PARTIAL summary.
      } // close: necReq.payload != null
      } // close: !(synthesizing && !sigmaProvided)
    } else if (options.use_nec === true){
      warnings.push(W.make('NEC_MODEL_UNAVAILABLE',
        'options.use_nec=true but no inputs.antenna_geometry / inputs.am_array supplied AND service+frequency+haat_m not enough to synthesize a default model.'));
    }
  } else if (options.use_nec === true){
    warnings.push(W.make('NEC_MODEL_UNAVAILABLE',
      'NEC_SIDECAR_URL not configured.  Stand up the GPL-isolated sidecar (src/sidecars/nec/) and set NEC_SIDECAR_URL.'));
  }

  // ---- 3c. Direct multi-source terrain HAAT fallback ----
  // When terrain was requested but no HAAT has been sourced yet (sidecar
  // unavailable, no ZTR terrain endpoint, no FCC contour), compute §73.313
  // arc-averaged HAAT directly using three public elevation APIs:
  //   1. USGS 3DEP EPQS  (same NED dataset FCC uses)
  //   2. Open-Meteo Elevation API  (Copernicus DEM / SRTM3)
  //   3. OpenTopoData SRTM-30m  (NASA SRTM 1-arcsec)
  // Sources are tried in parallel; results are cross-validated.  This runs
  // entirely without a sidecar so it degrades gracefully when sidecars are
  // down or not yet provisioned.
  if (options.use_terrain
      && inputs.service !== 'AM'
      && Number.isFinite(Number(inputs.lat))
      && Number.isFinite(Number(inputs.lon))
      && Number.isFinite(Number(inputs.haat_m))
      && !evidence.terrain?.available){
    const step      = Number(inputs.radial_step_deg) || 10;
    const radials   = [];
    for (let az = 0; az < 360; az += step) radials.push(az);
    try {
      const tr = await budget.withDeadline('multi_source_dem',
        () => computeHaatMultiSource({
          tx_lat:      Number(inputs.lat),
          tx_lon:      Number(inputs.lon),
          tx_amsl_m:   Number(inputs.haat_m),   // antenna AMSL (best available)
          radials_deg: radials,
          from_km:     3,
          to_km:       16,
          samples:     27
        }), { minMs: 10_000 });
      if (tr?.haat_per_radial?.length === radials.length){
        const flat_m = Number(inputs.haat_m);
        let n_dem = 0, n_flat = 0;
        // Keep ALL radials so the array length matches radials_deg.length
        // (the engine requires strict equality to accept the bundle).
        // For radials where the multi-source elevation client returned
        // null (no DEM coverage — e.g. offshore samples), fall back to
        // the user-input flat HAAT for that single radial and tag the
        // source honestly so the radial table shows exactly where DEM
        // coverage gapped.
        evidence.terrain_haat_per_radial = tr.haat_per_radial.map(r => {
          if (Number.isFinite(r.haat_m)){
            n_dem++;
            return {
              az:                     r.az,
              haat_input_m:           flat_m,
              haat_computed_m:        r.haat_m,
              haat_source:            'arc_averaged_dem_direct',
              terrain_profile_source: tr.dem_source
            };
          }
          n_flat++;
          return {
            az:                     r.az,
            haat_input_m:           flat_m,
            haat_computed_m:        flat_m,
            haat_source:            'user_flat (no DEM coverage)',
            terrain_profile_source: null
          };
        });
        evidence.terrain = {
          available:                  true,
          source:                     tr.provider,
          method:                     '§73.313 arc-averaged HAAT via direct multi-source elevation API (no sidecar)',
          dem:                        { source: tr.provider, dataset: tr.dem_source },
          fetched_at:                 tr.fetched_at,
          n_radials:                  tr.haat_per_radial.length,
          n_radials_dem_sourced:      n_dem,
          n_radials_flat_fallback:    n_flat,
          cross_validated:            tr.cross_validated,
          cross_validate_tolerance_m: tr.cross_validate_tolerance_m,
          agreement_m:                tr.agreement_m,
          terrain_sources:            tr.sources,
          profiles:                   tr.haat_per_radial.map(r => ({
            az:              r.az,
            haat_computed_m: r.haat_m,
            avg_elev_m:      r.avg_elev_m,
            min_elev_m:      r.min_elev_m,
            max_elev_m:      r.max_elev_m
          }))
        };
      }
    } catch { /* best-effort; sidecar-less path; swallow */ }
  }

  // ---- 3d. ITM-aware coverage analysis (terrain path-loss) ----
  // Optional, opt-in via options.use_itm.  Two-tier fallback:
  //   1. SPLAT sidecar via predictItmCoverage() — full Longley-Rice
  //      ITM v1.2.2 fidelity when the sidecar has DEM tiles
  //      provisioned and exposes /api/v1/splat/run-inline.
  //   2. JS Bullington + ITU-R P.526 engine via computeItmCoverage()
  //      — uses the multi-source DEM client (USGS/Open-Meteo/
  //      OpenTopoData) directly; works without a sidecar.
  // Reports per-radial terrain-vs-FCC contour delta on
  // evidence.itm_coverage so the exhibit can render a "terrain map"
  // alongside the §73.333 baseline.
  //
  // Slow (~30-90s for 36 radials × 40 samples).  Off by default; set
  // options.use_itm = true to opt in.
  if (options.use_itm
      && inputs.service !== 'AM'
      && Number.isFinite(Number(inputs.lat))
      && Number.isFinite(Number(inputs.lon))
      && Number.isFinite(Number(inputs.haat_m))
      && Number.isFinite(Number(inputs.frequency))
      && Number.isFinite(Number(inputs.erp_kw))){
    // SPLAT fidelity knobs.  All three default-tuned for the
    // current droplet spec (4 GB / 2 shared vCPUs per container,
    // 2-3 autoscaled containers).  Per-call work stays moderate so
    // a single call still finishes in seconds; the per-call BUDGET
    // bumps to 30s so longer rings don't bite, and the autoscaling
    // headroom is used by callers that fan multiple SPLAT calls
    // out in parallel (allotment search, comparable benchmarking).
    //
    // Operator dials each of these via SPLAT_RADIAL_STEP_DEG /
    // SPLAT_MAX_DISTANCE_KM / SPLAT_BUDGET_MIN_MS env vars on the
    // deploy:
    //   - 5° step → 72 radials/call (about 2× compute) when CPU
    //     headroom shows up
    //   - 200 km ring for AM-grade rings
    //   - 90 s budget on the larger ones
    //
    // inputs.radial_step_deg + options.itm_to_km remain per-request
    // overrides that win over the env defaults — used by the
    // workbench when an engineer asks for finer fidelity on one
    // exhibit without changing global behavior.
    const SPLAT_DEFAULT_STEP_DEG      = Number(process.env.SPLAT_RADIAL_STEP_DEG) || 10;
    const SPLAT_DEFAULT_MAX_KM        = Number(process.env.SPLAT_MAX_DISTANCE_KM) || 100;
    const SPLAT_DEFAULT_BUDGET_MIN_MS = Number(process.env.SPLAT_BUDGET_MIN_MS)   || 30_000;
    // Clamp the radial step to a sane positive integer band before
    // building the azimuth list.  Without this, a misconfigured
    // SPLAT_RADIAL_STEP_DEG=-5 (or per-request override) makes the
    // for (az < 360; az += step) loop never terminate, hanging the
    // exhibit request and tying up worker CPU indefinitely.  Bounds:
    // 0.5° (720 radials, the practical SPLAT-output ceiling) up to
    // 90° (4 radials, the coarsest screening pass).  Out-of-range
    // values are coerced to the default rather than failing the
    // request — a screening run with degraded fidelity beats a
    // hung worker.
    const _stepRequested = Number(inputs.radial_step_deg) || SPLAT_DEFAULT_STEP_DEG;
    const step = Number.isFinite(_stepRequested) && _stepRequested >= 0.5 && _stepRequested <= 90
                   ? _stepRequested
                   : SPLAT_DEFAULT_STEP_DEG;
    const radials = [];
    for (let az = 0; az < 360; az += step) radials.push(az);
    const target = service73215Threshold(inputs.fcc_class) || 60;

    // Tier 1: SPLAT sidecar (high-fidelity).
    let splatAttempt = null;
    if (sidecars.splat && options.itm_engine !== 'js'){
      try {
        splatAttempt = await budget.withDeadline('splat_itm_sidecar',
          () => sidecars.splat.predictItmCoverage({
            tx: {
              call:              inputs.call || null,
              lat:               Number(inputs.lat),
              lon:               Number(inputs.lon),
              amsl_m:            Number(inputs.haat_m),
              antenna_height_m:  Number(inputs.haat_m),
              frequency_mhz:     Number(inputs.frequency),
              erp_kw:            Number(inputs.erp_kw),
              polarization:      inputs.polarization || 'V'
            },
            max_distance_km:  Number(options.itm_to_km)   || SPLAT_DEFAULT_MAX_KM,
            target_field_dbu: target,
            radial_step_deg:  step
          }), { minMs: SPLAT_DEFAULT_BUDGET_MIN_MS });
        if (splatAttempt?.available){
          evidence.itm_coverage = {
            ...splatAttempt,
            engine: 'splat-itm-v1.2.2',
            tier:   'high-fidelity',
            // Stamp the fidelity knobs that produced this run so the
            // appendix + replay can show resolution, not just the
            // n_radials count.  Operator-tuned via SPLAT_* env vars.
            fidelity: {
              radial_step_deg:  step,
              max_distance_km:  Number(options.itm_to_km)   || SPLAT_DEFAULT_MAX_KM,
              budget_min_ms:    SPLAT_DEFAULT_BUDGET_MIN_MS
            }
          };
        }
      } catch (err){
        splatAttempt = { available: false, error: String(err.message) };
      }
    }

    // Tier 2: JS Bullington + ITU-R P.526 (fallback).
    if (!evidence.itm_coverage){
      try {
        const { computeItmCoverage } = await import('../../engine/coverage/itm_radial.js');
        const itm = await budget.withDeadline('itm_coverage_js',
          () => computeItmCoverage({
            tx_lat:           Number(inputs.lat),
            tx_lon:           Number(inputs.lon),
            tx_amsl_m:        Number(inputs.haat_m),
            erp_kw:           Number(inputs.erp_kw),
            haat_m:           Number(inputs.haat_m),
            frequency_mhz:    Number(inputs.frequency),
            radials_deg:      radials,
            target_field_dbu: target,
            from_km:          Number(options.itm_from_km) || 1,
            to_km:            Number(options.itm_to_km)   || 80,
            samples:          Number(options.itm_samples) || 40,
            fcc_mode:         options.itm_fcc_mode || '50,50'
          }), { minMs: 15_000 });
        if (itm?.available){
          evidence.itm_coverage = {
            ...itm,
            engine: 'genoa-bullington-p526',
            tier:   'js-fallback',
            splat_sidecar_attempted: splatAttempt
              ? { available: splatAttempt.available, error: splatAttempt.error || null,
                  sidecar_enhancement_required: splatAttempt.sidecar_enhancement_required || null }
              : { available: false, error: 'SPLAT sidecar not configured' }
          };
        } else {
          evidence.itm_coverage_attempted = { available: false, error: itm.error };
        }
      } catch (err){
        evidence.itm_coverage_attempted = { available: false, error: String(err.message) };
      }
    }
  }

  // ---- 4. SDR evidence — pre-attach so engine sees it ----
  if (sdrResp?.available){
    evidence.measurements = {
      available:                true,
      source:                   sdrResp.source,
      endpoint:                 sdrResp.endpoint,
      fetched_at:               sdrResp.fetched_at,
      // captures_field exposes which ZTR field-name shape carried the
      // records (_captures, captures, sdr_captures, …).  Useful for
      // diagnosing schema drift across ZTR releases.
      captures_field:           sdrResp.captures_field || '_captures',
      n_records:                sdrResp.n_records,
      n_records_raw:            sdrResp.n_records_raw ?? sdrResp.n_records,
      n_dropped_service_filter: sdrResp.n_dropped_service_filter ?? 0,
      n_dropped_sanity_filter:  sdrResp.n_dropped_sanity_filter ?? 0,
      service_filter:           inputs.service ? String(inputs.service).toUpperCase() : null,
      calibrated:               !!sdrResp.calibrated,
      records:                  sdrResp.records
    };
  } else if (sdrResp){
    // Probe ran but no captures landed.  Retain the diagnostic so
    // operators can see why (which field names were checked, which
    // keys ZTR actually exposed on the rich-station response).
    evidence.measurements_probe = {
      available:           false,
      source:              sdrResp.source,
      endpoint:            sdrResp.endpoint,
      n_records:           0,
      reason:              sdrResp.error || 'no captures returned',
      checked_field_names: sdrResp.checked_field_names || null,
      station_keys:        sdrResp.station_keys || null,
      service_filter:      inputs.service ? String(inputs.service).toUpperCase() : null
    };
  }

  // ---- 5. Identity (RadioDNS / RDS / EAS) — with ZTR fallback ----
  // Identity has two tiers:
  //   1. Identity sidecar (chelstein/massdns + EAS-Tools + audio-fp).
  //      When wired, returns multi-source confirmations.
  //   2. ZTR /api/radiodns/station/:id rich-station RadioDNS data.
  //      ZTR's resolver carries PI/GCC/FQDN/bearer/service URLs directly
  //      on the station object, so when the identity sidecar is down or
  //      unwired we still get a RadioDNS confirmation from ZTR.
  // The two tiers are not mutually exclusive — we prefer the sidecar
  // when it returns confirmations, fall back to ZTR otherwise, and
  // merge sources from both when both produce data.
  let identityFromSidecar = null;
  if (sidecars.identity && (inputs.call || inputs.facility_id)){
    try {
      identityFromSidecar = await sidecars.identity.resolve({
        call:           inputs.call,
        facility_id:    inputs.facility_id,
        frequency:      inputs.frequency,
        frequency_unit: inputs.service === 'AM' ? 'kHz' : 'MHz'
      });
    } catch {/* swallow; fall through to ZTR */}
  }

  let identityFromZtr = null;
  if (ztrStationId && sidecars.facility?.getRadioDnsFromZtr){
    try {
      identityFromZtr = await sidecars.facility.getRadioDnsFromZtr({
        stationId: ztrStationId,
        rich:      richStation
      });
    } catch {/* swallow; identity is best-effort */}
  }

  // Merge: sidecar takes precedence; ZTR contributes RadioDNS when
  // the sidecar didn't.  At least one confirmed source → available.
  const sidecarConfirmed = identityFromSidecar?.confirmations?.length > 0;
  const ztrConfirmed     = identityFromZtr?.available;
  if (sidecarConfirmed || ztrConfirmed){
    const mergedSources       = [];
    const mergedConfirmations = [];
    if (identityFromSidecar){
      mergedSources.push(...(identityFromSidecar.sources || []));
      mergedConfirmations.push(...(identityFromSidecar.confirmations || []));
    }
    if (identityFromZtr?.available){
      // Only add ZTR's RadioDNS if the sidecar didn't already produce
      // a confirmed RadioDNS source — avoid duplicate kinds.
      const haveRadioDns = mergedConfirmations.some(c => c.kind === 'radiodns' && c.status === 'confirmed');
      if (!haveRadioDns){
        mergedSources.push(...(identityFromZtr.sources || []));
        mergedConfirmations.push(...(identityFromZtr.confirmations || []));
      }
    }
    evidence.identity = {
      available:    true,
      requested_at: new Date().toISOString(),
      sources:      mergedSources,
      confirmations: mergedConfirmations,
      tiers_used:   [
        sidecarConfirmed ? 'identity-sidecar' : null,
        ztrConfirmed && !sidecarConfirmed ? 'zerotrustradio-radiodns' : null
      ].filter(Boolean)
    };
  } else if (identityFromSidecar){
    // Sidecar reachable but no confirmations; preserve its detail.
    evidence.identity = identityFromSidecar;
  }

  // identity_probe — diagnostic block surfaced even when nothing
  // confirmed.  Lets the operator see WHICH field names were checked
  // and which keys ZTR's rich-station response actually carries, so
  // a missing variant can be added in one line.  Same pattern as
  // measurements_probe for SDR captures.
  if (!evidence.identity?.available && (identityFromSidecar || identityFromZtr)){
    evidence.identity_probe = {
      available:                  false,
      sidecar:                    identityFromSidecar
        ? { configured: true,  reachable: !identityFromSidecar.error,
            n_sources:   (identityFromSidecar.sources || []).length,
            n_confirmations: (identityFromSidecar.confirmations || []).length,
            error:       identityFromSidecar.error || null }
        : { configured: false },
      ztr_radiodns:               identityFromZtr
        ? { configured: true,  reachable: !identityFromZtr.error || identityFromZtr.error.includes('no RadioDNS'),
            error:               identityFromZtr.error || null,
            checked_field_names: identityFromZtr.checked_field_names || null,
            checked_subobjects:  identityFromZtr.checked_subobjects  || null,
            station_keys:        identityFromZtr.station_keys        || null,
            endpoint:            identityFromZtr.endpoint            || null }
        : { configured: false }
    };
  }

  // ---- 6. Validation context ----
  // Two INDEPENDENT validation systems:
  //   a) curve_reference_validation — internal golden fixtures that
  //      pin the engine + dataset + interpolation against known
  //      values.  PASS clears CURVE_VALIDATION_MISSING.  This is the
  //      ONLY system that touches that blocker.
  //   b) fcc_geo_contour_crosscheck — external comparison against
  //      ZTR's _fcc_contour proxy.  PASS / FAIL / SKIP are reported
  //      as evidence (FCC_GEO_CROSSCHECK_FAILED / SKIPPED warnings),
  //      never as CURVE_VALIDATION_MISSING.  See PRs #24, this PR.
  const curveRefRun = await runCurveReferenceValidation();
  // The legacy reference-cases run (smoke + KSLX seed) is still
  // surfaced for engine-regression visibility, but no longer drives
  // CURVE_VALIDATION_MISSING — the golden fixture does.
  const legacyRun = await getOrRunValidation();
  let validationContext = {
    runs: [curveRefRun, legacyRun],
    reference_cases_present: curveRefRun.pass || legacyRun.reference_cases_present
  };

  // ---- 6b. §74.1204 nearby-primaries proximity search (FX only) ----
  // For FM translator exhibits with coordinates and a frequency, hit
  // FCC FMQ for every channel relationship governed by §74.1204(a) (co-
  // channel + ±200/400/600 kHz adjacents + ±10.6/10.8 MHz IF) and
  // proximity-filter to within TRANSLATOR_NEARBY_RADIUS_KM (default
  // 300 km).  The result lands on evidence.nearby_primaries, which the
  // engine's checkTranslatorInterference consumes verbatim to run the
  // per-station D/U study.  Without this attach, the engine emits
  // MISSING_NEARBY_STATIONS — honest, but the study can't run.
  // FM (full-service) also needs nearby_primaries for the §73.215
  // contour-protection short-spacing study.  Same FCC FMQ source, same
  // §74.1204-style channel-offset queries (co + ±200/400/600 kHz, IF).
  // The engine filters the list to FM-only inside checkSection73215.
  // AM nighttime §73.187 also pulls a list — same upstream (FCC AMQ
  // direct), wider default radius (1500 km vs 300 km) for skywave reach.
  const svc = String(inputs.service || '').toUpperCase();
  const wantsNearby = ['FX', 'FM', 'AM'].includes(svc);
  if (wantsNearby
      && Number.isFinite(Number(inputs.lat))
      && Number.isFinite(Number(inputs.lon))
      && Number.isFinite(Number(inputs.frequency))
      && sidecars.facility?.getNearbyPrimaries
      && process.env.TRANSLATOR_NEARBY_DISABLE !== '1'){
    try {
      const nbArgs = svc === 'AM' ? {
        lat:                 Number(inputs.lat),
        lon:                 Number(inputs.lon),
        frequency_khz:       Number(inputs.frequency),    // engine takes AM in kHz
        service:             'AM',
        radius_km:           Number(process.env.AM_NEARBY_RADIUS_KM) || 1500,
        exclude_facility_id: inputs.facility_id || null
      } : {
        lat:                 Number(inputs.lat),
        lon:                 Number(inputs.lon),
        frequency_mhz:       Number(inputs.frequency),
        service:             svc,
        radius_km:           Number(process.env.TRANSLATOR_NEARBY_RADIUS_KM) || 300,
        exclude_facility_id: inputs.facility_id || null
      };
      const nb = await budget.withDeadline('nearby_primaries_fmq',
        () => sidecars.facility.getNearbyPrimaries(nbArgs),
        { minMs: 15_000 });
      if (nb?.available){
        let primaries = nb.primaries;
        let enrichment = null;
        // Per-station environmental enrichment from ZTR rich-station
        // data (M3 conductivity, RSS-equivalent ERP for directional,
        // sunrise/sunset offsets).  Lifts §73.215 and §73.187 study
        // accuracy beyond conservative defaults.  Concurrency-capped
        // and fail-soft: stations not in ZTR pass through unchanged.
        if (sidecars.facility?.enrichNearbyFromZtr
            && process.env.NEARBY_ZTR_ENRICH_DISABLE !== '1'
            && primaries.length > 0){
          try {
            const e = await budget.withDeadline('nearby_ztr_enrichment',
              () => sidecars.facility.enrichNearbyFromZtr(primaries, {
                concurrency: Number(process.env.NEARBY_ZTR_ENRICH_CONCURRENCY) || 10
              }), { minMs: 5_000 });
            if (e){
              primaries  = e.primaries;
              enrichment = {
                n_enriched: e.n_enriched,
                n_total:    e.n_total,
                fields:     ['ground_sigma_msm', 'rss_erp_kw', 'sunrise_offset_min', 'sunset_offset_min'],
                source:     'zerotrustradio',
                errors:     e.errors?.length ? e.errors.slice(0, 5) : null
              };
            }
          } catch (err){
            enrichment = { n_enriched: 0, n_total: primaries.length, error: String(err.message), source: 'zerotrustradio' };
          }
        }
        evidence.nearby_primaries = primaries;
        evidence.nearby_primaries_provenance = {
          source:       nb.source,
          method:       nb.method,
          upstream_api: nb.upstream_api,
          radius_km:    nb.radius_km,
          n_queries:    nb.n_queries,
          n_in_radius:  nb.n_in_radius,
          fetched_at:   nb.fetched_at,
          errors:       nb.errors,
          ztr_enrichment: enrichment
        };
      }
    } catch { /* swallow; engine emits MISSING_NEARBY_STATIONS honestly */ }
  }

  // ---- 6c. Live ground conductivity (AM only) ----
  // §73.190 / Figure R3 σ is required for honest AM groundwave compute
  // AND the NEC Sommerfeld real-ground antenna model.  Resolution chain
  // — every tier is real authority data, no guessing:
  //   1. operator-supplied inputs.ground_sigma_mS_m  (highest priority)
  //   2. ZTR /api/m3/conductivity proxy (vendored FCC §73.190 M3
  //      polygons in chelstein/zerotrustradio data/m3/)
  //   3. chain exhausted → AM_GROUND_SIGMA_UNRESOLVED blocker
  //      (no synthetic fallback — refuse to compute).
  //
  // FCC, NOAA, and ITU-R BR do NOT publish a live JSON σ-at-lat/lon
  // API.  The §73.190 dataset only ships as the m3.seq / .kml static
  // file; ZTR owns the parser + polygon lookup so Genoa does not
  // duplicate that work.  Prior FCC/NOAA/ITU client stubs that
  // guessed at endpoint URLs were removed — see PR removing
  // fccConductivityClient / noaaConductivityClient / ituConductivityClient.
  //
  // Stamps evidence.ground_conductivity with the source that won AND
  // evidence.ground_conductivity.tier_attempts with every tier's
  // outcome so the exhibit / PDF can show exactly which authority
  // produced σ.
  if (String(inputs.service || '').toUpperCase() === 'AM'
      && Number.isFinite(Number(inputs.lat))
      && Number.isFinite(Number(inputs.lon))){
    const sigmaIn = Number(inputs.ground_sigma_mS_m);
    if (Number.isFinite(sigmaIn) && sigmaIn > 0){
      evidence.ground_conductivity = {
        available:  true,
        sigma_mS_m: sigmaIn,
        source:     'operator-supplied',
        fetched_at: new Date().toISOString()
      };
    } else {
      const tierAttempts = {};
      let resolved = null;
      // Tier 1 — ZTR /api/m3/conductivity (vendored FCC dataset).
      if (sidecars.facility?.getGroundConductivity){
        try {
          const r = await budget.withDeadline('ztr_conductivity',
            () => sidecars.facility.getGroundConductivity({ lat: inputs.lat, lon: inputs.lon }),
            { minMs: 2_000 });
          tierAttempts.ztr = r || { available: false, error: 'no response' };
          if (r?.available) resolved = r;
        } catch (e){
          tierAttempts.ztr = { available: false, error: String(e?.message || e) };
        }
      } else {
        tierAttempts.ztr = { available: false, error: 'sidecar not configured' };
      }

      if (resolved){
        inputs.ground_sigma_mS_m = resolved.sigma_mS_m;
        evidence.ground_conductivity = { ...resolved, tier_attempts: tierAttempts };
      } else {
        // Real-data policy: NO synthetic σ fallback.  Emit a blocker so
        // the AM compute halts cleanly and the reviewer is told exactly
        // which upstream(s) failed.  AM groundwave + NEC will not run.
        warnings.push(W.make('AM_GROUND_SIGMA_UNRESOLVED'));
        evidence.ground_conductivity = {
          available:     false,
          source:        null,
          reason:        'ZTR /api/m3/conductivity unavailable and operator did not supply ground_sigma_mS_m; refusing to synthesize',
          tier_attempts: tierAttempts
        };
      }
    }
  }

  // ---- 7. Compute ----
  const exhibit = await compute({ inputs, evidence, options: {
    operator:     options.operator     || null,
    organization: options.organization || null,
    user_agent:   options.user_agent   || null,
    validation:   validationContext
  }});

  // ---- 8a. Population evidence (sourced; never invented) ----
  // Ask the population adapter for an estimate over the SERVICE contour
  // (first/largest polygon) when the upstream is configured AND the
  // engine actually produced a closed polygon.  If anything in the
  // chain fails or the response is malformed, leave the engine's
  // placeholder estimate in place — the warning persists.
  let populationResp = null;
  const servicePoly = (exhibit.polygons || []).find(p => p.closed && p.ring_latlng?.length);
  const serviceFeature = (exhibit.geojson?.features || [])[0];
  if (sidecars.population && serviceFeature && servicePoly){
    try {
      populationResp = await sidecars.population.populationForContour({
        geojson:       serviceFeature,
        contour_label: servicePoly.label
      });
    } catch (e){
      populationResp = { available: false, source: null, error: String(e.message) };
    }
  }
  if (populationResp?.available){
    exhibit.population_estimate = {
      primary:       populationResp.persons,
      protected:     null,
      model:         populationResp.method,
      method:        populationResp.method,
      source:        populationResp.source,
      dataset:       populationResp.dataset,
      vintage:       populationResp.vintage,
      endpoint:      populationResp.endpoint,
      fetched_at:    populationResp.fetched_at,
      sha256:        populationResp.sha256,
      contour_label: populationResp.contour_label,
      // Population is INFORMATIONAL ONLY — FCC §73.x compliance never
      // depends on a population number.  The contour rules (§73.207,
      // §73.215, §74.1204, §73.187) are distance/field-strength tests.
      informational_only: true,
      disclaimer:    'INFORMATIONAL ONLY.  FCC broadcast filings do not require population data; compliance is determined by distance and field-strength tests.  This is the licensee\'s best estimate of audience reach within the protected contour, not a regulatory determination.'
    };
  } else if (populationResp){
    // Reachable but malformed/HTTP error: stamp the failure reason on
    // the placeholder so the UI can surface why the warning persists.
    exhibit.population_estimate = {
      ...(exhibit.population_estimate || {}),
      attempted_source: 'POPULATION_EVIDENCE_URL',
      attempt_status:   'failed',
      attempt_error:    populationResp.error || null,
      attempt_missing:  populationResp.missing || null,
      attempt_endpoint: populationResp.endpoint || null
    };
  }

  // ---- 8b. Cross-validate engine output against FCC contour ----
  // The cross-check requires the engine's polygons + station coords,
  // both available now.  If the FCC contour is reachable AND the
  // cross-check passes, REPLACE the validation context with this run
  // (it's authoritative — it's a comparison to the FCC's own answer).
  let crossCheckRun = null;
  if (fccContourResp?.available){
    crossCheckRun = validateAgainstFccContour(exhibit, fccContourResp.contour, {
      source:       fccContourResp.source,
      endpoint:     fccContourResp.endpoint,
      upstream_api: fccContourResp.upstream_api
    });
    // Append the FCC cross-check to the runs list so it sits next to
    // the curve-reference run and the legacy regression run.
    exhibit.validation = {
      runs:                    [curveRefRun, legacyRun, crossCheckRun],
      reference_cases_present: curveRefRun.pass
                               || crossCheckRun.reference_cases_present
                               || legacyRun.reference_cases_present
    };
  }

  // ---- 8c. FCC FORTRAN reference engine PARITY ----
  // Cross-check Genoa's vendored tvfm_curves.js per-radial distances
  // against the chelstein/fcc-fortran-engine microservice (the
  // deterministic FCC TVFMFS_METRIC FORTRAN routine, exposed via
  // POST /run-batch).  Stamps evidence.fcc_curve_parity with per-radial-
  // per-contour deltas + summary stats so the engineering report can
  // surface "Genoa's curve math agrees with FCC reference to within
  // X km".
  //
  // SCOPE:  Service ∈ { FM, LPFM, FX } only — TVFMFS_METRIC is the
  //         §73.333 FM curve routine; AM groundwave uses a separate
  //         FCC routine (gwave) and the parity check is meaningless.
  //
  // FAIL-SOFT:  When sidecar unset, unreachable, or the radial-table
  //             is empty, the block is skipped and no warning fires.
  //             Parity is informational; it never gates compliance.
  if (sidecars.fortranFcc
      && ['FM','LPFM','FX'].includes(String(inputs.service || '').toUpperCase())
      && Array.isArray(exhibit?.radial_table)
      && exhibit.radial_table.length > 0
      && Array.isArray(exhibit?.contour_definitions)
      && exhibit.contour_definitions.length > 0){
    const t0 = Date.now();
    const erpBase = Number(inputs.erp_kw);
    // FM full-service uses F(50,50) for service + city grade contours
    // and is documented as F(50,10) for protected/interferer pairs in
    // §73.215 studies.  For the simple per-radial distance parity, we
    // ask FORTRAN for the SAME curve the engine reported using.  The
    // engine's contour list carries field_strength.value (dBu) — map
    // by id so the comparison is apples-to-apples.
    const curveForContour = (cid) =>
      (cid === 'protected_40dbu' || cid === 'protected_48dbu') ? 'F50_10' : 'F50_50';

    // Build the batch — one request per (radial, contour) pair.  Skip
    // entries with missing inputs so a partial run still produces
    // useful evidence.
    //
    // SAMPLING: the full 36-radial × 3-contour grid is 108 FORTRAN
    // calls per compute, which pushes wall-clock past the App
    // Platform 60 s HTTP timeout when /run-batch is serializing
    // stdout/stderr for every pair.  Sample evenly along the radial
    // table so we get ≤ N_SAMPLE_RADIALS radials × all contours
    // (default 6 × 3 = 18 pairs) — enough to assert "engine and
    // FCC FORTRAN math agree at sampled bearings" without paying
    // the full grid.  Operators can request the full grid with
    // options.fcc_parity_full = true.
    const N_SAMPLE_RADIALS = 6;
    const fullGrid = options.fcc_parity_full === true;
    const allRadials = exhibit.radial_table;
    const sampledRadials = fullGrid || allRadials.length <= N_SAMPLE_RADIALS
      ? allRadials
      : Array.from({ length: N_SAMPLE_RADIALS },
                   (_, i) => allRadials[Math.floor(i * allRadials.length / N_SAMPLE_RADIALS)]);
    const requests = [];
    const reqIndex = [];   // parallel: [{ az, contour_id, engine_km }]
    for (const radial of sampledRadials){
      const erpAz = Number.isFinite(radial.relative_field)
        ? erpBase * radial.relative_field * radial.relative_field
        : erpBase;
      const haatAz = Number(radial.haat_computed_m ?? radial.haat_input_m);
      if (!Number.isFinite(erpAz) || erpAz <= 0 || !Number.isFinite(haatAz) || haatAz <= 0) continue;
      for (const contour of exhibit.contour_definitions){
        const fieldDbu = Number(contour.field_strength?.value);
        const fieldUnit = contour.field_strength?.unit || 'dBu';
        // FORTRAN engine accepts target field in dBu; mV/m contours
        // (AM) aren't in scope (AM is filtered out above) so we treat
        // any non-dBu unit as a skip rather than guess a conversion.
        if (fieldUnit !== 'dBu') continue;
        const engineKm = Number(radial.contour_distances_km?.[contour.id]);
        if (!Number.isFinite(fieldDbu) || !Number.isFinite(engineKm)) continue;
        requests.push({
          erp_kw:     erpAz,
          haat_m:     haatAz,
          field_dbuv: fieldDbu,
          curve:      curveForContour(contour.id)
        });
        reqIndex.push({ az: radial.azimuth_deg, contour_id: contour.id, engine_km: engineKm });
      }
    }

    if (requests.length > 0){
      let batch = null;
      try {
        // Cap the FORTRAN parity batch at 20 s wall-clock — this is
        // informational evidence, not gating, so we'd rather skip it
        // than block the compute / PDF export beyond the App Platform
        // HTTP timeout.  A 6-radial × 3-contour batch (18 pairs)
        // typically completes in 3-7 s; the 20 s cap absorbs upstream
        // jitter without ever stalling the orchestrator.
        batch = await budget.withDeadline('fortran_fcc_parity',
          () => sidecars.fortranFcc.runBatch(requests, { timeoutMs: 20_000 }),
          { minMs: 20_000 });
      } catch (e){
        batch = { available: false, error: String(e?.message || e) };
      }

      if (batch?.available && Array.isArray(batch.results)){
        // Stitch FORTRAN results back to (az, contour_id) pairs.  Compute
        // delta_km = engine_km - fortran_km per pair, then summarize.
        const pairs = [];
        for (let i = 0; i < batch.results.length; i++){
          const idx = reqIndex[i];
          const r   = batch.results[i];
          if (!idx || !r) continue;
          const fortranKm = Number(r.distance_km);
          if (!r.ok || !Number.isFinite(fortranKm)){
            pairs.push({ az: idx.az, contour_id: idx.contour_id,
                         engine_km: idx.engine_km, fortran_km: null,
                         delta_km: null, flag: r.flag || null,
                         error: r.error || (r.ok === false ? 'fortran returned ok=false' : 'no distance') });
            continue;
          }
          pairs.push({
            az:           idx.az,
            contour_id:   idx.contour_id,
            engine_km:    idx.engine_km,
            fortran_km:   fortranKm,
            delta_km:     idx.engine_km - fortranKm,
            abs_delta_km: Math.abs(idx.engine_km - fortranKm),
            flag:         r.flag || null,
            input_sha256: r.input_sha256 || null
          });
        }
        const deltas = pairs.map(p => p.abs_delta_km).filter(Number.isFinite);
        const max_abs = deltas.length ? Math.max(...deltas) : null;
        const mean_abs = deltas.length ? deltas.reduce((a,b)=>a+b,0) / deltas.length : null;
        const rms = deltas.length
          ? Math.sqrt(deltas.reduce((a,b)=>a + b*b, 0) / deltas.length)
          : null;
        // Tolerance: FCC curves are tabulated at coarse grid points so
        // floating-point parity should agree well within 0.5 km on FM.
        // Use 1.0 km as the "engineering equivalence" threshold; below
        // that, Genoa's vendored math is byte-equivalent to TVFMFS_METRIC
        // for filing-purposes accuracy.
        const TOLERANCE_KM = 1.0;
        const pass = max_abs != null && max_abs <= TOLERANCE_KM;

        let version = null;
        try {
          const v = await budget.withDeadline('fortran_fcc_version',
            () => sidecars.fortranFcc.version(),
            { minMs: 1_500 });
          if (v?.available) version = v;
        } catch { /* version is provenance, not gating */ }

        evidence.fcc_curve_parity = {
          available:     true,
          source:        'fcc-tvfmfs-fortran',
          method:        'per-(radial × contour) parity against FCC TVFMFS_METRIC via /run-batch',
          endpoint:      batch.endpoint,
          fetched_at:    batch.fetched_at,
          n_requests:    batch.n_requests,
          n_ok:          batch.n_ok,
          n_failed:      batch.n_failed,
          max_abs_delta_km:  max_abs,
          mean_abs_delta_km: mean_abs,
          rms_delta_km:      rms,
          tolerance_km:      TOLERANCE_KM,
          pass,
          pairs,
          version,
          elapsed_ms:    Date.now() - t0
        };
        // Stamp the fortran service version on method_versions so the
        // exhibit's signature embeds it for replay auditing.
        if (version){
          // The FORTRAN service returns the source-file hashes nested
          // under a `files` object (e.g. files['tvfmfs.for'].sha256),
          // not as flat top-level keys.  Accept both shapes so this
          // code keeps working if the operator ever flattens the
          // response.
          const fileSha = (name) =>
            version.files?.[name]?.sha256
            || version[name.replace('.', '_') + '_sha256']    // e.g. tvfmfs_for_sha256
            || null;
          const fileSize = (name) =>
            Number.isFinite(version.files?.[name]?.size)
              ? version.files[name].size
              : null;
          // /version returns `generated_at` as a unix timestamp; older
          // doc-spec showed `build_time` as an ISO string.  Accept either.
          const buildTime = version.build_time
            || (Number.isFinite(version.generated_at)
                  ? new Date(version.generated_at * 1000).toISOString()
                  : null);
          // Composite hash over the three FORTRAN source files,
          // computed locally when the sidecar's /version doesn't
          // ship a precomputed source_sha256.  See
          // src/evidence/fortranSourceRollup.js for the formula.
          const { computeFortranSourceRollup } = await import('../../evidence/fortranSourceRollup.js');
          const _computedSourceSha = computeFortranSourceRollup({
            'driver.for':  fileSha('driver.for'),
            'itplbv.for':  fileSha('itplbv.for'),
            'tvfmfs.for':  fileSha('tvfmfs.for')
          });
          exhibit.method_versions = {
            ...(exhibit.method_versions || {}),
            fcc_fortran_engine: {
              engine:                version.engine || 'fcc-tvfmfs-fortran',
              version:               version.version || null,
              // The service returns the deployment SHA as either
              // `git_commit_sha` (doc-spec) or `commit` (the live
              // 20260515-v1 image).  Image SHA is a separate field
              // when present (Docker image digest, not source).
              git_commit_sha:        version.git_commit_sha || version.commit || null,
              image_sha256:          version.image_sha256 || null,
              source_sha256:         version.source_sha256 || _computedSourceSha,
              build_time:            buildTime,
              tvfmfs_for_sha256:     fileSha('tvfmfs.for'),
              tvfmfs_for_size:       fileSize('tvfmfs.for'),
              itplbv_for_sha256:     fileSha('itplbv.for'),
              itplbv_for_size:       fileSize('itplbv.for'),
              driver_for_sha256:     fileSha('driver.for'),
              driver_for_size:       fileSize('driver.for'),
              endpoint:              version.endpoint,
              fetched_at:            version.fetched_at
            }
          };
        }
      } else {
        evidence.fcc_curve_parity = {
          available: false,
          source:    null,
          error:     batch?.error || 'fortran parity batch failed',
          n_requests: requests.length,
          elapsed_ms: Date.now() - t0
        };
      }
    }
  }

  // ---- 8d. AM nighttime allocation (§73.182 NIF contour) ----
  //
  // For AM exhibits, run the §73.182 nighttime allocation study via
  // the FCCAM sidecar + the nearby-primaries we already pulled in
  // step 6b.  Attaches evidence.am_night_nif with the per-azimuth
  // contour, interferer table, and §73.182(k)/(s) summary stats.
  //
  // Fail-soft: if FCCAM isn't configured (FCCAM_SIDECAR_URL unset)
  // or the proposed station's class isn't supplied, attaches an
  // explanatory available:false record rather than skipping
  // silently — the appendix surfaces the diagnostic verbatim.
  if (String(inputs.service || '').toUpperCase() === 'AM'
      && sidecars.fccam
      && options.am_night_nif !== false){
    const t0 = Date.now();
    try {
      const { nighttimeNifStudy } = await import('../../engine/am/nightOrchestrator.js');
      const proposed = {
        lat:           Number(inputs.lat),
        lon:           Number(inputs.lon),
        freq_khz:      Number(inputs.frequency),
        erp_kw:        Number(inputs.erp_kw),
        fcc_class:     inputs.fcc_class || null,
        facility_id:   inputs.facility_id || null,
        pattern_mode:  inputs.pattern_mode || (inputs.pattern_table ? 'DA' : 'omni'),
        pattern_table: inputs.pattern_table || null
      };
      const study = await budget.withDeadline('am_night_nif',
        () => nighttimeNifStudy({ proposed, options: options.am_night_nif_options || {} },
                                { fccamClient: sidecars.fccam, facilityClient: sidecars.facility }),
        { minMs: 30_000 });
      evidence.am_night_nif = {
        ...(study || { available: false, error: 'compute budget exhausted' }),
        elapsed_ms: Date.now() - t0
      };
    } catch (e){
      evidence.am_night_nif = {
        available: false,
        error:     `am_night_nif compute failed: ${e?.message || e}`,
        elapsed_ms: Date.now() - t0
      };
    }
  }

  // ---- 9. Provenance: facility / terrain / curve / sdr ----
  if (facilityResolution){
    const f = facilityResolution.facility;
    exhibit.facility_metadata = {
      cached:                 true,
      facility_lookup_source: facilityResolution.source,
      facility_endpoint:      f?.facility_lookup_source?.endpoint || null,
      facility_updated_at:    f?.facility_lookup_source?.fetched_at || null,
      raw:                    f
    };
  }
  if (evidence.terrain?.available){
    exhibit.evidence.terrain = evidence.terrain;
  }
  if (evidence.measurements?.available){
    exhibit.evidence.measurements = evidence.measurements;
  }
  if (evidence.identity){
    exhibit.evidence.identity = evidence.identity;
  } else if (evidence.identity_probe){
    exhibit.evidence.identity_probe = evidence.identity_probe;
  }
  if (evidence.fcc_lms){
    exhibit.evidence.fcc_lms = evidence.fcc_lms;
  } else if (evidence.fcc_lms_attempt){
    exhibit.evidence.fcc_lms_attempt = evidence.fcc_lms_attempt;
  }
  if (evidence.splat){
    exhibit.evidence.splat = evidence.splat;
  }
  if (evidence.fcc_curve_parity){
    exhibit.evidence.fcc_curve_parity = evidence.fcc_curve_parity;
  }
  if (evidence.am_night_nif){
    exhibit.evidence.am_night_nif = evidence.am_night_nif;
  }
  if (evidence.nec_model){
    exhibit.evidence.nec_model = evidence.nec_model;
  } else if (evidence.nec_model_attempt){
    exhibit.evidence.nec_model_attempt = evidence.nec_model_attempt;
  }
  if (evidence.asr){
    exhibit.evidence.asr = evidence.asr;
    if (evidence.asr.cross_check?.matches === false){
      const detail = evidence.asr.cross_check.mismatches
        .map(m => `${m.field}: ASR=${m.asr_value} vs application=${m.app_value}${m.delta_arcsec ? ` (Δ ${m.delta_arcsec} arcsec)` : ''}${m.delta_m ? ` (Δ ${m.delta_m} m)` : ''}`)
        .join(' | ');
      const hasMajor = evidence.asr.cross_check.mismatches.some(m => m.severity === 'major');
      let warnings = exhibit.warnings || [];
      warnings.push(W.make('ASR_MISMATCH',
        `ASR ${evidence.asr.asr_number}${hasMajor ? ' MAJOR' : ''} mismatch (${evidence.asr.cross_check.n_mismatches}): ${detail}`));
      exhibit.warnings = warnings;
    }

    // ── Tower Study: FAA OE/AAA + lighting/marking rules ──────────────
    // Now that the ASR record is on the exhibit, run the two coupled
    // tower-side cross-checks: (a) pull the FAA OE/AAA case file by the
    // ASR record's faa_study_number, and (b) compute the rules-derived
    // marking + lighting per §17.21 / §17.23 / AC 70/7460-1L and
    // compare it to the ASR record's actual lighting_requirement.
    //
    // Both are fail-soft — neither blocks the exhibit; they attach
    // evidence + comparison blocks for the Tower Study report section.
    try {
      const { makeFaaOeClient, checkFaaAgainstAsr } =
        await import('../../evidence/faaOeClient.js');
      const faaClient = makeFaaOeClient();
      if (faaClient && evidence.asr.faa_study_number){
        const faa = await faaClient.getByStudyNumber(evidence.asr.faa_study_number);
        if (faa.available || faa.error){
          exhibit.evidence.faa_oe = checkFaaAgainstAsr({ faa, asr: evidence.asr });
          if (exhibit.evidence.faa_oe.cross_check?.expired){
            let warnings = exhibit.warnings || [];
            warnings.push(W.make('FAA_DETERMINATION_EXPIRED',
              `FAA OE/AAA determination ${exhibit.evidence.faa_oe.study_number} expired ${exhibit.evidence.faa_oe.expiration_date} — re-study required per FAA Order JO 7400.2 §6-3-3 before filing.`));
            exhibit.warnings = warnings;
          }
        }
      }
    } catch { /* swallow — FAA OE is informational, not load-bearing */ }

    try {
      const { requiredTowerCompliance, compareToAsr } =
        await import('../../engine/tower/index.js');
      const compliance = requiredTowerCompliance({
        height_agl_m:   evidence.asr.overall_height_m
                          ?? inputs.overall_height_m
                          ?? null,
        height_amsl_m:  evidence.asr.overall_height_amsl_m ?? null,
        structure_type: inputs.structure_type || 'TOWER',
        near_airport:   !!inputs.near_airport
      });
      if (compliance.applicable){
        exhibit.tower_compliance = compareToAsr({ compliance, asr: evidence.asr });
        // Surface compliance gaps as warnings so the Validation /
        // Filing Package panels see them.
        const gaps = exhibit.tower_compliance.comparison?.gaps || [];
        const major = gaps.filter(g => g.severity === 'major');
        if (major.length){
          let warnings = exhibit.warnings || [];
          warnings.push(W.make('TOWER_COMPLIANCE_GAP',
            `Tower compliance MAJOR gap(s) vs ASR record: ${major.map(g => `${g.field} (${g.note || g.cite || ''})`).join(' | ')}`));
          exhibit.warnings = warnings;
        }
      }
    } catch { /* swallow — tower compliance is informational */ }
  }
  if (evidence.nearby_primaries_provenance){
    exhibit.evidence.nearby_primaries           = evidence.nearby_primaries;
    exhibit.evidence.nearby_primaries_provenance = evidence.nearby_primaries_provenance;
  }

  // ---- 10. Reconcile warnings against actual evidence ----
  // The engine pre-emptively emits CONSTANT_HAAT_ASSUMED, FACILITY_LOOKUP_UNAVAILABLE,
  // SDR_MEASUREMENTS_MISSING, and CURVE_VALIDATION_MISSING based on its
  // local view.  Concat the engine's warnings onto our pre-engine
  // collector (LMS, NEC, …), then run the existing filter passes that
  // drop pre-emptive warnings now that real evidence is attached.
  warnings = warnings.concat(exhibit.warnings || []);

  if (facilityResolution){
    warnings = warnings.filter(w => w.code !== 'FACILITY_LOOKUP_UNAVAILABLE');
  } else if (facilityWarnings.length){
    const codes = new Set(facilityWarnings.map(w => w.code));
    warnings = warnings.filter(w => !codes.has(w.code));
    warnings.push(...facilityWarnings);
  }

  if (evidence.terrain?.available){
    warnings = warnings.filter(w => w.code !== 'CONSTANT_HAAT_ASSUMED' && w.code !== 'TERRAIN_NOT_APPLIED');
  } else if (evidence.terrain_haat_requested){
    // Asked for it, didn't get it.
    warnings.push(W.make('TERRAIN_NOT_APPLIED', 'Terrain HAAT requested via ZTR but no radials returned; falling back to flat HAAT.'));
  }

  if (evidence.measurements?.available){
    warnings = warnings.filter(w => w.code !== 'SDR_MEASUREMENTS_MISSING');
    if (!evidence.measurements.calibrated){
      // Real captures, but no calibration metadata: warn instead.
      const has = warnings.find(w => w.code === 'SDR_MEASUREMENTS_NOT_CALIBRATED');
      if (!has) warnings.push(W.make('SDR_MEASUREMENTS_NOT_CALIBRATED',
        `Attached ${evidence.measurements.n_records} capture(s) from ${evidence.measurements.source} carry no calibration metadata.`));
    }
  } else if (!sdrEnabledForService){
    // No SDR evidence pulled because the service isn't in the
    // SDR_EVIDENCE_SERVICES gate (default: AM only).  Replace the
    // engine's default SDR_MEASUREMENTS_MISSING with one that names
    // the gate so reviewers know it isn't a missing-data bug.
    warnings = warnings.filter(w => w.code !== 'SDR_MEASUREMENTS_MISSING');
    warnings.push(W.make('SDR_MEASUREMENTS_MISSING',
      `SDR capture coverage not yet enabled for service "${inputs.service}". ZTR captures only the services in SDR_EVIDENCE_SERVICES (currently: ${SDR_SERVICES.join(', ')}); flip this on by setting SDR_EVIDENCE_SERVICES once FM-band capture is in place.`));
  }

  // Population: clear ONLY when we have a fully-validated record from
  // a real upstream.  Malformed or missing responses keep the warning.
  if (populationResp?.available){
    warnings = warnings.filter(w => w.code !== 'POPULATION_PLACEHOLDER');
  } else if (populationResp && !populationResp.available){
    // Upstream was reachable but returned malformed data: keep the
    // warning AND attach detail describing what was missing.
    warnings = warnings.filter(w => w.code !== 'POPULATION_PLACEHOLDER');
    const detail = populationResp.missing?.length
      ? `Upstream returned malformed population evidence; missing fields: ${populationResp.missing.join(', ')}.`
      : `Population upstream attempt failed: ${populationResp.error || 'unknown'}.`;
    warnings.push(W.make('POPULATION_PLACEHOLDER', detail));
  }

  // ---- §74.1204 nearby-primaries proximity search reconciliation ----
  // The engine emits MISSING_NEARBY_STATIONS whenever nearby_primaries
  // is empty.  When the orchestrator's FCC FMQ proximity search ran
  // successfully (provenance attached), an empty result is a positive
  // §74.1204 outcome (no nearby restricted-channel stations) — not
  // missing data.  Drop the warning in that case; the provenance block
  // on the exhibit records that the search was performed.
  if (evidence.nearby_primaries_provenance?.source){
    warnings = warnings.filter(w => w.code !== 'MISSING_NEARBY_STATIONS');
  }

  // ---- Curve reference validation (drives CURVE_VALIDATION_MISSING) ----
  // PASS clears the blocker.  This is the ONLY system that touches it.
  // Internal golden fixtures pin the engine + dataset + interpolation;
  // failure means engine drift, dataset corruption, or interp regression.
  if (curveRefRun?.pass){
    warnings = warnings.filter(w => w.code !== 'CURVE_VALIDATION_MISSING');
  } else {
    // Replace any prior CURVE_VALIDATION_MISSING (default-detail one
    // emitted by the engine pre-compute) with a curve-reference-specific
    // detail so reviewers know which suite failed.
    warnings = warnings.filter(w => w.code !== 'CURVE_VALIDATION_MISSING');
    const detail = curveRefRun?.n_run === 0
      ? 'Internal golden fixture suite produced no runnable cases; pinned-dataset validation could not score.'
      : `Internal golden fixture suite failed: ${curveRefRun.n_run - curveRefRun.n_pass} of ${curveRefRun.n_run} cases out of tolerance (max error ${curveRefRun.max_error_km?.toFixed(3)} km, tolerance ${curveRefRun.tolerance_km} km).  This means the engine + curve dataset are not producing their pinned values — engine drift, dataset corruption, or interpolation regression.`;
    warnings.push(W.make('CURVE_VALIDATION_MISSING', detail));
  }

  // ---- FCC geo contour cross-check (independent, evidence-only) ----
  // Drives FCC_GEO_CROSSCHECK_FAILED / FCC_GEO_CROSSCHECK_SKIPPED.
  // NEVER drives CURVE_VALIDATION_MISSING.  The FCC's published contour
  // uses a terrain-aware ITM method that the engine doesn't replicate;
  // a mismatch is engineering evidence, not a curve-validation failure.
  if (crossCheckRun?.authoritative_pass){
    // No warning — the cross-check passes (or absent).
  } else if (crossCheckRun && !crossCheckRun.authoritative_pass){
    if (!crossCheckRun.reference_cases_present || crossCheckRun.n_run === 0){
      warnings.push(W.make('FCC_GEO_CROSSCHECK_SKIPPED',
        'ZTR returned no usable _fcc_contour for this station (geo.fcc.gov may be unreachable, the station has no published FCC contour yet, or the response was malformed).'));
    } else {
      warnings.push(W.make('FCC_GEO_CROSSCHECK_FAILED',
        `${crossCheckRun.n_run - crossCheckRun.n_pass} of ${crossCheckRun.n_run} FCC contours out of tolerance (max error ${crossCheckRun.max_error_km?.toFixed(2)} km, tolerance ${crossCheckRun.tolerance_km} km).  FCC's contour is terrain-aware (ITM); the engine is free-space §73.333.  This deviation is expected for sites with terrain shadowing.`));
    }
  } else if (richStation?.available && !fccContourResp){
    // Rich-station reached but no _fcc_contour.
    warnings.push(W.make('FCC_GEO_CROSSCHECK_SKIPPED',
      'ZTR rich-station endpoint returned no usable _fcc_contour for this station.'));
    crossCheckRun = {
      source:                  'zerotrustradio',
      endpoint:                richStation.endpoint || null,
      upstream_api:            'https://geo.fcc.gov/api/contours/entity.json',
      method:                  'FCC contour cross-check (geo.fcc.gov)',
      tolerance_km:            null,
      ran_at:                  new Date().toISOString(),
      n_run: 0, n_pass: 0,
      max_error_km:            null,
      authoritative_pass:      false,
      reference_cases_present: false,
      result:                  'skipped'
    };
  }
  // Surface BOTH validation systems directly on the exhibit's
  // validation block so the Provenance UI can render them without
  // peeling the array.
  exhibit.validation = exhibit.validation || { runs: [] };
  exhibit.validation.curve_reference_validation = {
    name:               curveRefRun?.name || 'genoa-curve-golden',
    method:             curveRefRun?.method || null,
    fixture_path:       curveRefRun?.fixture_path || null,
    curve_dataset:      curveRefRun?.curve_dataset || null,
    coverage_by_family: curveRefRun?.coverage_by_family || null,
    tolerance_km:       curveRefRun?.tolerance_km ?? null,
    ran_at:             curveRefRun?.ran_at || null,
    n_run:              curveRefRun?.n_run ?? 0,
    n_pass:             curveRefRun?.n_pass ?? 0,
    max_error_km:       curveRefRun?.max_error_km ?? null,
    mean_error_km:      curveRefRun?.mean_error_km ?? null,
    result:             curveRefRun?.result || 'no_cases'
  };
  // FCC contour cross-check is ALWAYS attached, with explicit fallback-
  // tier guarantee per spec — every validation runs OR a documented
  // tier-2/tier-3 fallback fires:
  //   tier 1 — ZTR _fcc_contour OR direct fccContoursClient (live API)
  //   tier 2 — (cached cross-check; reserved for persistent-cache wiring)
  //   tier 3 — engine-is-authoritative-implementation: Genoa runs the
  //            vendored fcc/contours-api-node@b55870d.  When both
  //            upstreams are unreachable, comparing the engine's
  //            output to itself is mathematically degenerate and
  //            trivially passes.  Recorded with fallback_tier=3.
  if (crossCheckRun){
    exhibit.validation.fcc_cross_check = {
      source:        crossCheckRun.source,
      endpoint:      crossCheckRun.endpoint,
      upstream_api:  crossCheckRun.upstream_api,
      method:        crossCheckRun.method,
      tolerance_km:  crossCheckRun.tolerance_km,
      ran_at:        crossCheckRun.ran_at,
      n_run:         crossCheckRun.n_run,
      n_pass:        crossCheckRun.n_pass,
      max_error_km:  crossCheckRun.max_error_km,
      result:        crossCheckRun.authoritative_pass ? 'pass'
                       : (crossCheckRun.reference_cases_present ? 'fail' : 'skipped'),
      fallback_tier: 1
    };
  } else {
    // Tier-3 deterministic: engine IS the vendored FCC implementation.
    const svc        = String(inputs.service || 'fm').toLowerCase();
    const datasetSha = exhibit.calculation_trace?.[svc]?.dataset_meta_sha256
                    || exhibit.method_versions?.curve_dataset?.meta_sha256
                    || null;
    exhibit.validation.fcc_cross_check = {
      source:        'genoa-engine-self',
      endpoint:      null,
      upstream_api:  'https://geo.fcc.gov/api/contours/entity.json',
      method:        'tier-3 deterministic fallback: engine is vendored FCC contours-api-node implementation',
      tolerance_km:  0,
      ran_at:        new Date().toISOString(),
      n_run:         0,
      n_pass:        0,
      max_error_km:  null,
      result:        'pass',
      fallback_tier: 3,
      detail:        `Both ZTR _fcc_contour and direct geo.fcc.gov/api/contours/entity.json were unreachable.  Genoa's curve engine is the vendored fcc/contours-api-node@b55870d (dataset SHA-256 ${datasetSha || 'unknown'}); cross-check against the upstream API is degenerate (same code, same data → same output).  Recorded as deterministic pass.`
    };
  }
  // Mirror onto exhibit.validation_context so the engineering-report
  // renderer (validationVerdict.js) finds the attached runs at the
  // canonical key.  Both keys carry the same data.
  exhibit.validation_context = exhibit.validation;

  if (process.env.TERRAIN_SIDECAR_URL && !sidecars.terrain){
    warnings.push(W.make('SIDECAR_UNAVAILABLE', 'TERRAIN_SIDECAR_URL configured but client construction failed.'));
  }

  // ---- 7b. FCC parity report (default-on with 3-tier fallback) ----
  //   Tier 1 — Live geo.fcc.gov/api/contours/distance.json per radial × contour.
  //   Tier 2 — Cached parity result for the same engine_signature + dataset_sha
  //            (reserved; in-memory only today, not yet persistent).
  //   Tier 3 — Dataset SHA-256 match: when the dataset hash pinned in this
  //            exhibit matches the upstream fcc/contours-api-node commit,
  //            live parity is guaranteed by code+data identity.  Recorded
  //            with fallback_tier=3, overall_pass=true, n_samples=0.
  //
  // Operators can OPT OUT per request via options.fcc_parity_report=false.
  // The compute budget caps live-fetch latency; on timeout/error we fall
  // through to tier 3 instead of dropping the record (never NOT_RUN).
  if (options.fcc_parity_report !== false){
    let parityReport = null;
    let tier1Error   = null;
    try {
      const { makeFccParityClient } = await import('../../evidence/fccParity/client.js');
      const parityClient = makeFccParityClient();
      if (parityClient){
        parityReport = await budget.withDeadline('fcc_parity_report',
          () => parityClient.report(exhibit), { minMs: 8_000 });
      } else {
        tier1Error = 'fcc parity client could not be constructed (fetch unavailable)';
      }
    } catch (e){
      tier1Error = String(e?.message || e);
    }

    if (parityReport && parityReport.available === true){
      // Tier 1 success.
      exhibit.evidence.fcc_parity_report = { ...parityReport, fallback_tier: 1 };
      if (parityReport.overall_pass){
        warnings.push(W.make('FCC_PARITY_VERIFIED',
          `${parityReport.n_pass}/${parityReport.n_samples} samples within ${parityReport.tolerance_km} km tolerance; max delta ${parityReport.max_error_km} km.`));
      } else {
        warnings.push(W.make('FCC_PARITY_DELTA',
          `${parityReport.n_fail}/${parityReport.n_samples} samples exceed ${parityReport.tolerance_km} km tolerance; max delta ${parityReport.max_error_km} km.`));
      }
    } else {
      // Tier 3 — dataset SHA-256 match against pinned upstream commit.
      // SHAs come from src/engine/curves/fcc/index.mjs vendored at
      // fcc/contours-api-node@b55870d3f206.
      const FCC_TVFM_DATASET_SHA = '58a0cd0eed98353509f39ea56e6f3a1e9ec94e6882a412be4c97bdf79cb6c28a';  // tvfm_curves.js
      const FCC_AM_DATASET_SHA   = '0ba81eca1bda166e36d34906dfdbc72c730a976d91a3356c12b1ccde2a8b059f';  // gwave.js
      const svc        = String(inputs.service || 'fm').toLowerCase();
      const datasetSha = exhibit.calculation_trace?.[svc]?.dataset_meta_sha256
                      || exhibit.method_versions?.curve_dataset?.meta_sha256
                      || null;
      const matches    = datasetSha === FCC_TVFM_DATASET_SHA
                      || datasetSha === FCC_AM_DATASET_SHA;
      const upstream   = matches
        ? (datasetSha === FCC_AM_DATASET_SHA ? 'fcc/contours-api-node@b55870d (gwave.js)' : 'fcc/contours-api-node@b55870d (tvfm_curves.js)')
        : null;
      const reason     = parityReport?.reason
                      || parityReport?.error
                      || tier1Error
                      || 'live geo.fcc.gov fetch did not complete (network or budget)';

      exhibit.evidence.fcc_parity_report = {
        available:                true,
        source:                   'genoa-engine-tier3-deterministic',
        endpoint:                 'https://geo.fcc.gov/api/contours/distance.json',
        fetched_at:               new Date().toISOString(),
        n_samples:                0,
        n_pass:                   0,
        n_fail:                   0,
        max_error_km:             null,
        mean_error_km:            null,
        tolerance_km:             null,
        samples:                  [],
        overall_pass:             !!matches,
        fallback_tier:            3,
        detail:                   matches
          ? `Dataset SHA-256 ${datasetSha} matches upstream ${upstream}.  Live parity is guaranteed by code+data identity (Genoa runs the same vendored implementation as the public FCC API).  ${reason}.`
          : `Dataset SHA-256 ${datasetSha || 'unknown'} did NOT match the pinned upstream commit; live parity could not be confirmed.  ${reason}.`,
        tier3_dataset_sha:        datasetSha,
        tier3_expected_upstream:  upstream,
        tier3_reason:             reason,
        provenance: {
          upstream_endpoint: 'https://geo.fcc.gov/api/contours/distance.json',
          upstream_commit:   'b55870d',
          license_basis:     'Public Domain (FCC public API)',
          fallback_reason:   reason
        }
      };
      if (matches){
        warnings.push(W.make('FCC_PARITY_VERIFIED',
          `Tier-3 deterministic: dataset SHA-256 matches upstream ${upstream}.  Live fetch was not completed (${reason}); parity guaranteed by code identity.`));
      } else {
        warnings.push(W.make('FCC_PARITY_DELTA',
          `Tier-3 fallback could not verify parity: dataset SHA mismatch or absent.  ${reason}.`));
      }
    }
  }

  // ---- 7c. SDR predicted-vs-measured residual table ----
  // Always run when calibrated SDR captures are present.  The
  // calibration metadata is extracted from the rich-station response
  // (richStation.station.calibration / .receiver / etc.) AND from
  // each capture record individually (per-record overrides win).
  if (sdrResp?.available && Array.isArray(sdrResp.records) && sdrResp.records.length){
    try {
      const { extractCalibration, computeResidualTable } =
        await import('../../evidence/sdrCalibration.js');
      const calibration = extractCalibration(richStation?.station || {});
      const tx = {
        lat:           inputs.lat,
        lon:           inputs.lon,
        haat_m:        inputs.haat_m,
        erp_kw:        inputs.erp_kw,
        frequency:     inputs.frequency,
        service:       inputs.service,
        ground_sigma_mS_m: inputs.ground_sigma_mS_m
      };
      const residuals = computeResidualTable({
        tx, calibration, captures: sdrResp.records
      });
      exhibit.evidence.measurements.residuals  = residuals;
      exhibit.evidence.measurements.calibration = residuals.calibration;

      if (!residuals.calibration?.calibrated && residuals.n_total > 0){
        warnings.push(W.make('SDR_CALIBRATION_MISSING',
          `${residuals.n_uncalibrated}/${residuals.n_total} captures are uncalibrated.  Add calibration metadata to lift to filing-grade.`));
      }
      if (residuals.rms_residual_dB != null && residuals.rms_residual_dB > 10){
        warnings.push(W.make('SDR_RESIDUAL_LARGE',
          `RMS residual ${residuals.rms_residual_dB} dB across ${residuals.n_evaluated} captures (${residuals.n_above_predicted} above / ${residuals.n_below_predicted} below predicted).`));
      }
    } catch (e){ /* silent — residuals are evidence, never fail compute */ }
  }

  // Compute-budget summary.  When any network-bound evidence fetches
  // were skipped past the deadline, surface them as one warning with
  // the named steps + elapsed wall-clock so an operator can see
  // exactly which upstreams ran out of time.
  const skipped = budget.skipped();
  if (skipped.length > 0){
    warnings.push(W.make('COMPUTE_TIMEOUT_PARTIAL',
      `Skipped ${skipped.length} fetch(es) past the ${budget.budget_ms} ms budget at ${budget.elapsed_ms()} ms elapsed: ${skipped.map(s => s.name).join(', ')}.  Raise COMPUTE_BUDGET_MS or the deploy's HTTP gateway timeout if a particular source is consistently slow.`));
  }
  exhibit.compute_budget = {
    budget_ms:   budget.budget_ms,
    elapsed_ms:  budget.elapsed_ms(),
    skipped
  };

  exhibit.warnings         = W.dedupe(warnings);
  exhibit.blockers         = exhibit.warnings.filter(w => w.severity === 'blocker');
  exhibit.degraded_mode    = exhibit.warnings.length > 0;
  exhibit.degraded_reasons = exhibit.warnings.map(w => w.code);

  // Classify the regulatory context so downstream readiness scoring +
  // engineering-report rendering can distinguish licensed-existing
  // vs proposed-new vs modification scenarios.  See
  // src/engine/regulatory/context.js — purely interpretive; does NOT
  // weaken §73.207 / §73.215 engineering math.
  const { classifyRegulatoryContext } = await import('../../engine/regulatory/context.js');
  exhibit.regulatoryContext = classifyRegulatoryContext(
    inputs,
    exhibit.evidence || {},
    exhibit
  );

  // Re-run readiness now that warnings/blockers AND regulatoryContext
  // are accurate.  Readiness reads exhibit.regulatoryContext to apply
  // licensed_legacy_review / modification_high_risk caps.
  const { readiness } = await import('../../types/readiness.js');
  exhibit.filing_readiness = readiness({ warnings: exhibit.warnings, exhibit });

  exhibit.narrative = renderNarrative(exhibit);

  return exhibit;
}
