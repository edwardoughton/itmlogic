// Genoa engine — public entry.
//
// One function: compute({ inputs, evidence, options }) -> exhibit.v2

import { loadDataset, loadManifest, curveProvenance } from './curves/loader.js';
import { destPoint } from './geometry/geodesic.js';
import { fccSphericalDestPoint, FCC_ORCHESTRATION_PROVENANCE } from './curves/fcc/orchestration.mjs';
import { closeRing, ringArea_km2 } from './geometry/polygon.js';
import { contourFeature, featureCollection } from './geometry/geojson.js';
import { parsePatternTable } from './pattern/parse.js';
import { patternFactor } from './pattern/factor.js';
import { flatHaatPerRadial } from './haat/flat.js';
import { fmRadialTable, FM_DEFAULT_CONTOURS, FM_INTERP, FM_INTERP_FCC, FM_CONTOUR_METHODS, FM_ENGINE_DEFAULT } from './fm/contour.js';
import { fmInputGuards } from './fm/rules.js';
import { lpfmRadialTable, LPFM_DEFAULT_CONTOURS, LPFM_METHOD, lpfmInputGuards } from './lpfm/contour.js';
import { fxRadialTable, FX_DEFAULT_CONTOURS, FX_METHOD, FX_REGULATORY_METADATA, fxInputGuards } from './translators/contour.js';
import { amRadialTable, AM_DEFAULT_CONTOURS, amWarnings } from './am/groundwave.js';
import { FCC_AM_PROVENANCE } from './curves/fcc/index.mjs';
import crypto from 'node:crypto';
import { checkLpfmCompliance } from './regulatory/lpfm.js';
import { checkAmDaPatternCompliance } from './regulatory/section_73_150.js';
import { checkAm73_24g }              from './regulatory/section_73_24g.js';
import { checkAm73_24j }              from './regulatory/section_73_24j.js';
import { detectInternationalBorder }  from './regulatory/internationalBorderDetect.js';
import { checkTranslatorInterference } from './regulatory/translator.js';
import { checkSection73215 }            from './regulatory/section_73_215.js';
import { checkSection73207 }            from './regulatory/section_73_207.js';
import { checkSection73525 }            from './regulatory/section_73_525.js';
import { checkSection73187 }            from './regulatory/section_73_187.js';
import { checkOet65, OET65_PROVENANCE } from './regulatory/oet65.js';
import { buildInterferenceStudy }       from './regulatory/interferenceStudy.js';
import { analyzeTerrainConfidence }     from '../analysis/terrainConfidence/index.js';
import { interpretResiduals }           from '../analysis/residualInterpretation/index.js';
import { W } from '../types/warnings.js';
import { emptyExhibit } from '../types/schema.js';
import { readiness } from '../types/readiness.js';
import { ENGINE_SIGNATURE, ENGINE_VERSION as SIG_VERSION } from './signature.js';
import { buildAttestation, buildReplayToken } from './buildAttestation.js';

export const ENGINE_VERSION = SIG_VERSION;

const SOFTWARE_VERSIONS = Object.freeze({
  genoa_engine:  ENGINE_VERSION,
  node:          process.versions?.node || 'unknown',
  schema:        'genoa.exhibit.v2'
});

function methodFor(service){
  switch (service){
    case 'FM':   return { method: FM_CONTOUR_METHODS.F50_50, regs: ['§73.313', '§73.333'] };
    case 'LPFM': return { method: LPFM_METHOD,                regs: ['§73.811', '§73.333'] };
    case 'FX':   return { method: FX_METHOD,                  regs: ['§74.1204', '§73.333'] };
    case 'AM':   return { method: '47 CFR §73.183 / §73.184 groundwave', regs: ['§73.183', '§73.184'] };
    default: throw new Error(`unknown service: ${service}`);
  }
}

function radialList(step_deg){
  const out = [];
  for (let az = 0; az < 360; az += step_deg) out.push(az);
  return out;
}

export async function compute({ inputs, evidence = {}, options = {} } = {}){
  if (!inputs || typeof inputs !== 'object'){
    const e = new Error('INVALID_INPUTS: compute(inputs, ...) requires an object');
    e.code = 'INVALID_INPUTS';
    throw e;
  }
  if (!options || !options.validation){
    const e = new Error('VALIDATION_CONTEXT_REQUIRED: compute() requires options.validation (the result of runValidationSuite()). Pass {runs: [...], reference_cases_present: bool}.');
    e.code = 'VALIDATION_CONTEXT_REQUIRED';
    throw e;
  }

  const warnings = [];

  const service = String(inputs.service || 'FM').toUpperCase();
  const erp_kW  = Number(inputs.erp_kw);
  const haat_m  = Number(inputs.haat_m);
  const lat     = (inputs.lat === null || inputs.lat === undefined || inputs.lat === '') ? NaN : Number(inputs.lat);
  const lon     = (inputs.lon === null || inputs.lon === undefined || inputs.lon === '') ? NaN : Number(inputs.lon);
  const freq    = Number(inputs.frequency);
  const step    = Number(inputs.radial_step_deg) || 1;
  const sigma   = Number(inputs.ground_sigma_mS_m);
  const pattern_text = inputs.pattern_table || null;
  const pattern = pattern_text ? parsePatternTable(pattern_text) : null;
  const facility_id  = inputs.facility_id ? String(inputs.facility_id) : null;

  if (!facility_id || facility_id === '—'){
    warnings.push(W.make('FACILITY_ID_MISSING'));
  }

  const hasCoords = Number.isFinite(lat) && Number.isFinite(lon);
  if (!hasCoords){
    warnings.push(W.make('FACILITY_COORDINATES_MISSING'));
  }

  const { method, regs } = methodFor(service);

  const radials_deg = radialList(step);
  let haatPerRadial;
  if (service === 'AM'){
    haatPerRadial = radials_deg.map(az => ({
      az,
      haat_input_m:           null,
      haat_computed_m:        null,
      haat_source:            'n/a (AM groundwave)',
      terrain_profile_source: null
    }));
  } else if (evidence.terrain_haat_per_radial && evidence.terrain_haat_per_radial.length === radials_deg.length){
    haatPerRadial = evidence.terrain_haat_per_radial;
  } else {
    haatPerRadial = flatHaatPerRadial(radials_deg, haat_m);
    warnings.push(W.make('CONSTANT_HAAT_ASSUMED'));
    if (evidence.terrain_haat_requested){
      warnings.push(W.make('TERRAIN_NOT_APPLIED', 'Per-radial terrain HAAT was requested but the terrain sidecar did not return data.'));
      warnings.push(W.make('SIDECAR_UNAVAILABLE', 'terrain sidecar unavailable; falling back to flat HAAT.'));
    }
  }

  if (service === 'FM') {
    warnings.push(...fmInputGuards({ erp_kW, haat_m, frequency_mhz: freq }));
  } else if (service === 'LPFM') {
    warnings.push(...lpfmInputGuards({ erp_kW }));
    warnings.push(...fmInputGuards({ erp_kW, haat_m, frequency_mhz: freq }));
  } else if (service === 'FX') {
    warnings.push(...fxInputGuards({ erp_kW }));
    warnings.push(...fmInputGuards({ erp_kW, haat_m, frequency_mhz: freq }));
  } else if (service === 'AM') {
    warnings.push(...amWarnings({
      frequency_khz:    Number(freq),
      conductivity_msm: Number(sigma),
      erp_kw:           erp_kW
    }));
    if (!Number.isFinite(sigma) || sigma <= 0){
      warnings.push(W.make('FCC_METHOD_MISSING', 'Ground conductivity (M3) is required for any AM groundwave run.'));
    }
  }

  const factorFn = az => patternFactor(pattern, az);
  let contours, radial_table;
  const fmEngine = options.engine || FM_ENGINE_DEFAULT;

  switch (service){
    case 'FM':
      contours     = FM_DEFAULT_CONTOURS;
      radial_table = await fmRadialTable({
        datasetByName: loadDataset, mode: '50,50', contours,
        erp_kW, patternFactorFn: factorFn, haatPerRadial,
        frequency_mhz: freq, engine: fmEngine
      });
      break;
    case 'LPFM':
      contours     = LPFM_DEFAULT_CONTOURS;
      radial_table = await lpfmRadialTable({
        datasetByName: loadDataset, mode: '50,50', contours,
        erp_kW, patternFactorFn: factorFn, haatPerRadial,
        frequency_mhz: freq, engine: fmEngine
      });
      break;
    case 'FX':
      contours     = FX_DEFAULT_CONTOURS;
      radial_table = await fxRadialTable({
        datasetByName: loadDataset, mode: '50,50', contours,
        erp_kW, patternFactorFn: factorFn, haatPerRadial,
        frequency_mhz: freq, engine: fmEngine
      });
      break;
    case 'AM':
      contours     = AM_DEFAULT_CONTOURS;
      radial_table = amRadialTable({
        erp_kW,
        frequency_khz:    Number(freq),
        conductivity_msm: Number(sigma),
        // Per-radial M3 conductivity segments — orchestrator passes
        // this when the operator hasn't disabled segmentation AND the
        // geodata sidecar returned crossings for the radials.  Engine
        // falls back to uniform σ per-radial when missing/empty.  See
        // groundwave.js#pathWeightedSigma for the stage-2 approximation.
        sigmaSegmentsByRadial: inputs.sigma_segments_by_radial || null,
        patternFactorFn:  factorFn,
        radials_deg,
        contours
      });
      break;
  }

  let regulatory_compliance = null;
  if (service === 'LPFM'){
    regulatory_compliance = await checkLpfmCompliance({
      erp_kw:        erp_kW,
      haat_m,
      frequency_mhz: freq,
      fcc_class:     inputs.fcc_class || 'LP100'
    });
    if (regulatory_compliance.pass === false){
      warnings.push(W.make('LPFM_RULE_VIOLATION',
        regulatory_compliance.violations.map(v => `${v.cite}: ${v.message}`).join(' | ')));
    }
  } else if (service === 'FX'){
    const primaries = Array.isArray(evidence.nearby_primaries) ? evidence.nearby_primaries : [];
    regulatory_compliance = checkTranslatorInterference({
      translator: {
        erp_kw: erp_kW, haat_m, frequency_mhz: freq, lat, lon,
        call: inputs.call || null, facility_id
      },
      primaries
    });
    regulatory_compliance.regulatory_metadata = FX_REGULATORY_METADATA;
    if (regulatory_compliance.missing_nearby_stations){
      warnings.push(W.make('MISSING_NEARBY_STATIONS'));
    } else if (regulatory_compliance.pass === false){
      warnings.push(W.make('TRANSLATOR_INTERFERENCE',
        regulatory_compliance.violations.map(v => `${v.cite}: ${v.message}`).join(' | ')));
    }
  } else if (service === 'FM'){
    const allNearby = Array.isArray(evidence.nearby_primaries) ? evidence.nearby_primaries : [];
    const nearbyStations = allNearby.filter(p => {
      const svc = String(p?.service || '').toUpperCase();
      return svc === 'FM' || svc === '';
    });
    regulatory_compliance = checkSection73215({
      subject: {
        erp_kw: erp_kW, haat_m, frequency_mhz: freq, lat, lon,
        fcc_class: inputs.fcc_class || null,
        call: inputs.call || null, facility_id
      },
      nearbyStations
    });
    if (regulatory_compliance.missing_nearby_stations){
      warnings.push(W.make('MISSING_NEARBY_STATIONS'));
    } else if (regulatory_compliance.pass === false){
      warnings.push(W.make('FM_CONTOUR_PROTECTION_VIOLATION',
        regulatory_compliance.violations.map(v => `${v.cite}: ${v.message}`).join(' | ')));
    }
    const sep73_207 = checkSection73207({
      subject: { lat, lon, fcc_class: inputs.fcc_class || null, frequency_mhz: freq,
                 call: inputs.call || null, facility_id },
      nearbyStations
    });
    regulatory_compliance.section_73_207 = sep73_207;
    if (sep73_207.pass === false){
      const sec73_215_pass = regulatory_compliance.pass === true;
      warnings.push(W.make('FM_MINIMUM_SEPARATION_VIOLATION',
        sec73_215_pass
          ? `Station fails §73.207(b) minimum-distance separation but qualifies via §73.215 contour protection.  Filing must cite §73.215.  Failed pairs: ${sep73_207.violations.length}.`
          : `Station fails BOTH §73.207(b) minimum-distance separation (${sep73_207.violations.length} pair(s)) AND §73.215 contour protection.  Filing requires either rule to clear.`));
    }
    const ch6Stations = Array.isArray(evidence.tv_ch6_stations) ? evidence.tv_ch6_stations : [];
    const sec73_525 = checkSection73525({
      subject: { erp_kw: erp_kW, haat_m, frequency_mhz: freq, lat, lon,
                 fcc_class: inputs.fcc_class || null,
                 call: inputs.call || null, facility_id },
      tvCh6Stations: ch6Stations
    });
    regulatory_compliance.section_73_525 = sec73_525;
    if (sec73_525.pass === false){
      warnings.push(W.make('FM_TV_CH6_PROTECTION_VIOLATION',
        sec73_525.violations.map(v => `${v.cite}: ${v.message}`).join(' | ')));
    }
  } else if (service === 'AM'){
    const allNearby = Array.isArray(evidence.nearby_primaries) ? evidence.nearby_primaries : [];
    const nearbyAm = allNearby.filter(p => {
      const svc = String(p?.service || '').toUpperCase();
      return svc === 'AM' || svc === '';
    });
    regulatory_compliance = checkSection73187({
      subject: {
        erp_kw:           erp_kW,
        frequency_khz:    Number(freq),
        lat, lon,
        fcc_class:        inputs.fcc_class || null,
        ground_sigma_msm: Number(inputs.ground_sigma_mS_m) || Number(sigma) || null,
        rss_erp_kw:       Number(inputs.rss_erp_kw) || null,
        call:             inputs.call || null,
        facility_id
      },
      nearbyStations: nearbyAm
    });
    if (regulatory_compliance.missing_nearby_stations){
      warnings.push(W.make('MISSING_NEARBY_STATIONS'));
    } else if (regulatory_compliance.pass === false){
      warnings.push(W.make('AM_NIGHTTIME_PROTECTION_VIOLATION',
        regulatory_compliance.violations.map(v => `${v.cite}: ${v.message}`).join(' | ')));
    }
  }

  let oet65 = null;
  const freq_mhz_for_oet65 = service === 'AM' ? Number(freq) / 1000 : Number(freq);
  if (Number.isFinite(erp_kW) && erp_kW > 0
      && Number.isFinite(freq_mhz_for_oet65) && freq_mhz_for_oet65 > 0){
    oet65 = checkOet65({
      erp_kw:           erp_kW,
      frequency_mhz:    freq_mhz_for_oet65,
      service,
      pattern_factor:   Number.isFinite(Number(inputs.oet65_pattern_factor))
                          ? Number(inputs.oet65_pattern_factor) : 1.0,
      ground_reflection: !!inputs.oet65_ground_reflection,
      site_boundary_m:   Number.isFinite(Number(inputs.site_boundary_m))
                          ? Number(inputs.site_boundary_m) : null,
      site_height_m:     Number.isFinite(Number(inputs.site_height_m))
                          ? Number(inputs.site_height_m)   : null
    });
    if (oet65.near_field?.required_for_filing){
      warnings.push(W.make('OET65_NEAR_FIELD_REQUIRED',
        `Far-field compliance distance ${oet65.compliance.uncontrolled.distance_m} m at ${freq_mhz_for_oet65.toFixed(3)} MHz is inside the near-field boundary λ/(2π) = ${oet65.near_field.boundary_m} m.  OET-65 §3.B near-field analysis required for filing-grade compliance.`));
    }
    if (oet65.compliance?.boundary_check?.pass === false){
      warnings.push(W.make('OET65_BOUNDARY_VIOLATION',
        `Power density ${oet65.compliance.boundary_check.power_density_mw_cm2} mW/cm² at site boundary (slant ${oet65.compliance.boundary_check.slant_distance_m} m) exceeds §1.1310 uncontrolled MPE ${oet65.compliance.boundary_check.mpe_uncontrolled_mw_cm2} mW/cm².  Public access must be restricted out to ${oet65.compliance.uncontrolled.distance_m} m or pattern downtilt / ground-reflection assumptions revisited.`));
    }
  } else {
    oet65 = {
      cite:    '47 CFR §1.1310',
      pass:    null,
      study_inputs: { erp_kw: erp_kW, frequency_mhz: freq_mhz_for_oet65 },
      notes:   ['OET-65 study skipped: erp_kw and frequency required.']
    };
  }

  // ---- Polygons + GeoJSON ------------------------------------------
  const projection =
    options.projection === 'fcc-spherical'  ? 'fcc-spherical' :
    options.projection === 'wgs84-vincenty' ? 'wgs84-karney'  :
                                              'wgs84-karney';
  const projectVertex = projection === 'fcc-spherical'
    ? (lt, ln, az, d) => fccSphericalDestPoint(lt, ln, az, d)
    : (lt, ln, az, d) => destPoint(lt, ln, az, d);
  const polygons = [];
  const features = [];
  for (const c of contours){
    const dists = radial_table.map(r => r.contour_distances_km?.[c.id]).filter(Number.isFinite);
    const mean_radial_km = dists.length ? dists.reduce((a,b)=>a+b,0) / dists.length : null;
    let closed = [];
    let area_km2 = null;
    if (hasCoords){
      const ring = [];
      for (const r of radial_table){
        const d = r.contour_distances_km?.[c.id];
        if (!Number.isFinite(d) || d <= 0) continue;
        ring.push(projectVertex(lat, lon, r.azimuth_deg, d));
      }
      closed = closeRing(ring);
      area_km2 = closed.length >= 4 ? ringArea_km2(closed) : null;
    }
    polygons.push({
      contour_id:        c.id,
      label:             c.label,
      field_strength:    c.field_dBu ? { value: c.field_dBu, unit: 'dBu' } : { value: c.field_mvm, unit: 'mV/m' },
      ring_latlng:       closed,
      mean_radial_km,
      area_km2,
      method,
      vertex_count:      closed.length,
      closed:            closed.length >= 4,
      polygon_unavailable_reason: hasCoords ? null : 'facility coordinates missing'
    });
    if (hasCoords && closed.length >= 4){
      features.push(contourFeature(closed, {
        contour_id:    c.id,
        label:         c.label,
        field_strength_dbu: c.field_dBu ?? null,
        field_strength_mvm: c.field_mvm ?? null,
        method,
        mean_radial_km,
        area_km2,
        call:          inputs.call || null,
        facility_id:   facility_id || null
      }));
    }
  }
  const geojson = featureCollection(features);

  // ---- ITM terrain-aware coverage polygon ---------------------------
  const itm_polygons = [];
  const itm = evidence.itm_coverage;
  if (hasCoords && itm?.available && Array.isArray(itm.radials) && itm.radials.length){
    const ring = [];
    let n_blocked = 0;
    for (const r of itm.radials){
      const d = r.terrain_distance_km;
      if (!Number.isFinite(d) || d <= 0){
        n_blocked++;
        continue;
      }
      ring.push(projectVertex(lat, lon, r.az, d));
    }
    const closed = closeRing(ring);
    const area_km2 = closed.length >= 4 ? ringArea_km2(closed) : null;
    if (closed.length >= 4){
      const dists = itm.radials.map(r => r.terrain_distance_km).filter(Number.isFinite);
      const mean_radial_km = dists.length ? dists.reduce((a, b) => a + b, 0) / dists.length : null;
      const fcc_dists  = itm.radials.map(r => r.fcc_distance_km).filter(Number.isFinite);
      const fcc_mean   = fcc_dists.length ? fcc_dists.reduce((a, b) => a + b, 0) / fcc_dists.length : null;
      itm_polygons.push({
        contour_id:        'itm_service',
        label:             'Terrain-aware service coverage (ITM)',
        field_strength:    { value: itm.arc?.target_field_dbu ?? null, unit: 'dBu' },
        ring_latlng:       closed,
        mean_radial_km:    mean_radial_km != null ? +mean_radial_km.toFixed(2) : null,
        fcc_mean_km:       fcc_mean != null ? +fcc_mean.toFixed(2) : null,
        delta_mean_km:     (mean_radial_km != null && fcc_mean != null)
                              ? +(mean_radial_km - fcc_mean).toFixed(2)
                              : null,
        area_km2,
        method:            itm.method || '47 CFR §73.314 supplementary terrain study (Bullington / ITU-R P.526)',
        cite:              itm.cite || '47 CFR §73.314',
        engine:            itm.engine || null,
        tier:              itm.tier   || null,
        dem_source:        itm.dem_source || null,
        n_radials:         closed.length - 1,
        n_blocked_radials: n_blocked,
        vertex_count:      closed.length,
        closed:            true
      });
    }
  }

  const population_estimate = {
    primary:           null,
    protected:         null,
    model:             null,
    method:            'placeholder',
    source:            null,
    informational_only: true,
    disclaimer:        'INFORMATIONAL ONLY.  FCC broadcast filings (§73.207, §73.215, §74.1204, §73.187, §73.811) do not require population data; compliance is determined by distance and field-strength tests.  Where a Census/ACS dispatch is supplied, the persons figure is the licensee\'s best estimate of audience reach within the protected contour and is not a regulatory determination.'
  };
  warnings.push(W.make('POPULATION_PLACEHOLDER'));

  const validation = options.validation || { runs: [], reference_cases_present: false };
  const passing = (validation.runs || []).some(r =>
    r && (r.pass === true || r.authoritative_pass === true));
  if (!passing){
    warnings.push(W.make('CURVE_VALIDATION_MISSING'));
  }

  // Surface σ resolution metadata (input vs. used vs. clamp/rounding
  // direction) on AM exhibits.  This is the audit fix for gwave MAJOR 1:
  // operators previously could not see whether the FCC M3 integer-grid
  // lookup had rounded their typed σ to a neighbor or clamped it to the
  // 1..8 mS/m boundary.  When the rounding/clamp is non-zero we emit
  // a SIGMA_CLAMP warning so the exhibit narrative + readiness scoring
  // surfaces it; |rounding|=0 (e.g. typed σ=4) stays silent.
  const groundConstants = (service === 'AM' && radial_table && radial_table._ground_constants)
    ? radial_table._ground_constants
    : null;
  if (groundConstants && Number.isFinite(groundConstants.sigma_rounding)
      && Math.abs(groundConstants.sigma_rounding) > 0){
    const dir = groundConstants.sigma_clamp
      ? `${groundConstants.sigma_clamp}-clamped`
      : 'rounded';
    warnings.push(W.make('SIGMA_CLAMP',
      `AM σ input ${groundConstants.sigma_input} mS/m → FCC M3 grid σ ${groundConstants.sigma_used} mS/m (${dir}; Δ=${groundConstants.sigma_rounding} mS/m).  Distances reflect the boundary curve, not the typed σ.`));
  }

  const evidenceBlock = {
    terrain:      evidence.terrain      || { available: false, source: null, profiles: [] },
    measurements: evidence.measurements || { available: false, source: null, calibrated: false, records: [] },
    identity:     evidence.identity     || { available: false, sources: [], confirmations: [] },
    itm_coverage: evidence.itm_coverage || null,
    uncertainty:  evidence.uncertainty  || null,
    ground_constants: groundConstants
  };
  if (!evidenceBlock.measurements.available){
    warnings.push(W.make('SDR_MEASUREMENTS_MISSING'));
  } else if (!evidenceBlock.measurements.calibrated){
    warnings.push(W.make('SDR_MEASUREMENTS_NOT_CALIBRATED'));
  }

  await loadManifest();
  const curve_prov = await curveProvenance();

  const exhibit = emptyExhibit();
  exhibit.generated_at      = new Date().toISOString();
  exhibit.engine_signature  = ENGINE_SIGNATURE;
  exhibit.software_versions = SOFTWARE_VERSIONS;
  // AM groundwave runs through src/engine/am/groundwave.js, which
  // reads the vendored FCC gwave.js grid keyed on (σ × distance per
  // §73.184 Figure M3).  The prior label "(engine NOT IMPLEMENTED)"
  // was stale — left over from a pre-2.0 scaffolding branch — and is
  // a P1 misleading-metadata bug in the engineering statement.
  const interpBlock = (service === 'AM')
    ? { along_field: 'σ × distance grid',
        along_haat:  'n/a',
        source:      '47 CFR §73.184 groundwave (vendored gwave.js; bivariate over σ × distance per Figure M3)' }
    : (fmEngine === 'fcc-canonical' ? FM_INTERP_FCC : FM_INTERP);

  // AM exhibits MUST stamp the AM curve_dataset provenance (gwave.js
  // SHA + data/gwave_field.json SHA from FCC_AM_PROVENANCE), NOT the
  // FM/TV f5050/f5010 manifest SHAs.  Prior bug: AM service inherited
  // FM curve_prov here, producing exhibits whose curve_dataset SHA did
  // not reflect the code that actually computed the AM contour.  See
  // gwave audit MAJOR 2.
  const curveDatasetBlock = service === 'AM'
    ? {
        curve_version:   'fcc-contours-api-node@' + FCC_AM_PROVENANCE.commit.slice(0, 10),
        meta_sha256:     null,
        dataset_sha256:  FCC_AM_PROVENANCE.files.reduce((acc, f) => {
          // gwave.js -> 'gwave_js', data/gwave_field.json -> 'gwave_field_json'
          const key = f.path.split('/').pop().replace(/\./g, '_');
          acc[key] = f.sha256;
          return acc;
        }, {}),
        source_dir:      'src/engine/curves/fcc',
        upstream:        FCC_AM_PROVENANCE
      }
    : curve_prov;
  exhibit.method_versions   = {
    method,
    regulations:    regs,
    curve_dataset:  curveDatasetBlock,
    curve_engine:   service === 'AM' ? null : fmEngine,
    interp:         interpBlock,
    projection,
    fcc_orchestration: FCC_ORCHESTRATION_PROVENANCE
  };
  exhibit.operator_metadata = {
    operator:       options.operator    || null,
    organization:   options.organization || null,
    user_agent:     options.user_agent  || null
  };
  exhibit.station_inputs    = {
    call:           inputs.call || null,
    facility_id:    facility_id,
    service,
    fcc_class:      inputs.fcc_class || null,
    frequency:      freq,
    frequency_unit: service === 'AM' ? 'kHz' : 'MHz',
    erp_kw:         erp_kW,
    haat_m_input:   service === 'AM' ? null : haat_m,
    lat, lon,
    ground_sigma_mS_m: service === 'AM' ? sigma : null,
    pattern:        pattern || 'ND',
    radial_step_deg: step,
    // Tower height fields — propagated through to enrichTowerEvidence
    // so the §17.21/§17.23 rules engine can derive painting + lighting
    // even when no ASR record is found.  Operator-typed value wins;
    // ZTR rich-station fallback runs upstream in exhibitService.js.
    overall_height_m:      Number.isFinite(Number(inputs.overall_height_m))
                            ? Number(inputs.overall_height_m) : null,
    overall_height_amsl_m: Number.isFinite(Number(inputs.overall_height_amsl_m))
                            ? Number(inputs.overall_height_amsl_m) : null,
    asr_number:            inputs.asr_number || null,
    structure_type:        inputs.structure_type || null,
    near_airport:          !!inputs.near_airport
  };
  exhibit.facility_metadata = {
    cached:         false,
    facility_lookup_source: null,
    raw:            null
  };
  if (!exhibit.facility_metadata.cached){
    warnings.push(W.make('FACILITY_LOOKUP_UNAVAILABLE'));
  }
  exhibit.calculation_method = {
    name:           method,
    regulations:    regs,
    engine_module:  service === 'AM' ? 'src/engine/am/groundwave.js' :
                    service === 'LPFM' ? 'src/engine/lpfm/contour.js' :
                    service === 'FX'   ? 'src/engine/translators/contour.js' :
                                          'src/engine/fm/contour.js',
    engine_version: ENGINE_VERSION
  };
  exhibit.interpolation = interpBlock;
  exhibit.calculation_trace = {
    [service.toLowerCase()]: {
      mode:           service === 'AM' ? 'groundwave' : 'F(50,50)',
      contours:       contours.map(c => ({
        id:           c.id,
        target_dBu:   c.field_dBu ?? null,
        target_mvm:   c.field_mvm ?? null
      })),
      erp_kw:         erp_kW,
      haat_m:         haat_m ?? null,
      haat_source:    haatPerRadial[0]?.haat_source || 'unknown',
      pattern_factor_applied: !!pattern,
      curve_engine:   service === 'AM' ? 'fcc-canonical' : fmEngine,
      interpolation:  service === 'AM'
        ? 'FCC groundwave field-grid lookup (Sommerfeld-Norton) — discrete σ {1..8} mS/m × 10 kHz frequency steps; no interpolation across σ'
        : (fmEngine === 'fcc-canonical'
            ? 'FCC bivariate cubic surface fit (ITPLBV) — vendored from contours-api-node'
            : 'log10-distance vs ascending field; linear along HAAT'),
      dataset:        service === 'AM'
        ? 'fcc/contours-api-node@b55870d (gwave.js + data/gwave_field.json)'
        : (fmEngine === 'fcc-canonical'
            ? 'fcc/contours-api-node@b55870d (tvfm_curves.js)'
            : curve_prov.curve_version),
      dataset_meta_sha256: service === 'AM'
        ? '0ba81eca1bda166e36d34906dfdbc72c730a976d91a3356c12b1ccde2a8b059f'
        : (fmEngine === 'fcc-canonical'
            ? '58a0cd0eed98353509f39ea56e6f3a1e9ec94e6882a412be4c97bdf79cb6c28a'
            : curve_prov.meta_sha256),
      engine_module:  service === 'AM' ? 'src/engine/am/groundwave.js' :
                      service === 'LPFM' ? 'src/engine/lpfm/contour.js' :
                      service === 'FX'   ? 'src/engine/translators/contour.js' :
                                            'src/engine/fm/contour.js',
      formula_summary: service === 'AM'
        ? 'FCC amDistance(sigma, dielectric, freq_kHz, target_mV/m, fs1km) — vendored Sommerfeld-Norton groundwave from contours-api-node@b55870d (gwave.js); fs1km = 100·sqrt(P_kW) mV/m at 1 km; identical output to geo.fcc.gov/api/contours/amDistance.json.'
        : (fmEngine === 'fcc-canonical'
            ? 'FCC tvfmfs_metric(erp, haat, channel, target_dBu, fs_or_dist=2, curve) — vendored bivariate cubic surface fit over the FCC §73.333 tabulation; identical output to geo.fcc.gov/api/contours/distance.json.'
            : 'effective_dBu = target_dBu − 10·log10(ERP_kW); look up log10(distance) vs effective field at each HAAT row, then interpolate the per-row distances along the HAAT axis.')
    }
  };
  exhibit.contour_definitions = contours.map(c => ({
    id:    c.id,
    label: c.label,
    field_strength: c.field_dBu ? { value: c.field_dBu, unit: 'dBu' }
                                 : { value: c.field_mvm, unit: 'mV/m' }
  }));
  exhibit.radial_table = radial_table;
  exhibit.polygons     = polygons;
  exhibit.itm_polygons = itm_polygons;
  exhibit.geojson      = geojson;
  exhibit.evidence     = evidenceBlock;
  exhibit.validation   = validation;
  exhibit.uncertainty  = evidenceBlock.uncertainty;
  exhibit.population_estimate = population_estimate;
  exhibit.warnings     = W.dedupe(warnings);
  exhibit.blockers         = exhibit.warnings.filter(w => w.severity === 'blocker');
  exhibit.degraded_mode    = exhibit.warnings.length > 0;
  exhibit.degraded_reasons = exhibit.warnings.map(w => w.code);
  exhibit.filing_readiness = readiness({ warnings: exhibit.warnings, exhibit });
  exhibit.regulatory_compliance = regulatory_compliance;

  // §73.150 AM DA pattern-shape compliance — smoothness, max:min,
  // RMS minimum.  Runs only when an AM exhibit has a DA pattern
  // attached; surfaces as a separate evidence block (does NOT modify
  // the contour math; the engine already used the filed pattern).
  if (service === 'AM' && Array.isArray(pattern) && pattern.length >= 2){
    exhibit.am_da_pattern_compliance = checkAmDaPatternCompliance({
      pattern_table:            pattern,
      authorized_pattern_table: inputs.authorized_pattern_table || null
    });
  }

  // §73.24(g) blanket-interference compliance (AM).  Reads the
  // 1000 mV/m and 25 mV/m contours from the radial table plus any
  // attached per-contour population data.  Runs unconditionally for
  // AM so the verdict always reports a status (PASS / FAIL / null when
  // population data unavailable).
  if (service === 'AM'){
    exhibit.am_blanket_compliance = checkAm73_24g({ exhibit });
    exhibit.am_city_coverage_compliance = checkAm73_24j({ exhibit });
    // International border auto-detect — surfaces US/MX and US/CA
    // AM treaty obligations when the site is inside either bilateral
    // zone.  Cf. Mullaney KELP 1989: site 0 km from US/Mexico border,
    // had to protect XEJPV per the US/Mexico AM Agreement.
    if (Number.isFinite(lat) && Number.isFinite(lon)){
      exhibit.international_border = detectInternationalBorder({ lat, lon });
    }
  }

  exhibit.interference_study = buildInterferenceStudy({
    subject: {
      call:           inputs.call,
      facility_id,
      fcc_class:      inputs.fcc_class,
      frequency_mhz:  service === 'AM' ? null : Number(freq),
      frequency_khz:  service === 'AM' ? Number(freq) : null,
      erp_kw:         erp_kW,
      haat_m,
      lat, lon
    },
    regulatory_compliance,
    service
  });

  exhibit.oet65 = oet65;
  exhibit.engineering_confidence = analyzeTerrainConfidence(exhibit);
  exhibit.residual_interpretation = interpretResiduals(exhibit);
  exhibit.exports      = {
    json:        'pending',
    txt:         'pending',
    geojson:     'pending',
    pdf:         'pending',
    generated_at: null
  };
  exhibit.narrative    = null;

  // Build attestation + replay token.  Every exhibit ships with an
  // HMAC-signed proof of WHICH build of the engine produced it
  // (immutable git SHA, release tag, build time, node version,
  // canonical fingerprint hash) AND a base64url replay token over
  // the exhibit's content hash + canonical inputs/evidence hashes.
  // Verify via POST /api/exhibits/verify-build.
  exhibit.build_attestation = buildAttestation();
  // ---- Curve-dataset SHA folded into build_fingerprint -------------
  // The base buildAttestation() is module-level and does NOT include the
  // curve dataset SHA (it can't — the curve set is loaded at runtime).
  // For audit-replay parity, an exhibit produced against a different
  // curve dataset MUST have a different fingerprint, even if the engine
  // SHA is identical.  We compose a per-exhibit curve_aware_fingerprint
  // = sha256(base_fingerprint || canonical(curve_dataset)) and stamp it
  // alongside the original.  See audit fix DB M1.
  const _curveSha = JSON.stringify({
    curve_dataset: exhibit.method_versions.curve_dataset || null,
    service
  });
  const _composedFp = crypto.createHash('sha256')
    .update(String(exhibit.build_attestation.fingerprint_sha256 || '') + '|' + _curveSha, 'utf8')
    .digest('hex');
  exhibit.build_attestation = {
    ...exhibit.build_attestation,
    curve_dataset_fingerprint_sha256: _composedFp,
    curve_dataset_fingerprint_inputs: [
      'base=' + (exhibit.build_attestation.fingerprint_sha256 || ''),
      'curve_dataset=' + _curveSha
    ]
  };
  const _replay = buildReplayToken(exhibit, {
    inputs:   exhibit.station_inputs,
    evidence: evidenceBlock
  });
  exhibit.replay_token  = _replay.token;
  exhibit.replay_digest = {
    exhibit_sha256:  _replay.exhibit_sha256,
    inputs_sha256:   _replay.inputs_sha256,
    evidence_sha256: _replay.evidence_sha256
  };
  return exhibit;
}
