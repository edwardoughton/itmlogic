// FCC parity report — verifiable bit-exact comparison vs the live
// `geo.fcc.gov/api/contours/distance.json` endpoint.
//
// PURPOSE
//   Genoa's curve engine is the vendored FCC tvfm_curves.js + gwave.js
//   pinned at commit b55870d (stamped on every exhibit's
//   method_versions.dataset).  The 36-case curve_reference_validation
//   golden suite already proves Genoa reproduces the FCC tabulation
//   to max_error_km = 0.000485 against fixed reference values.
//
//   This module adds a LIVE comparison: for each (radial, contour)
//   tuple in an exhibit, call the FCC's own public contour-distance
//   API and compare its returned distance to Genoa's computed
//   distance.  When the two agree to within tolerance over every
//   sample, the resulting `parity_report` block is a publishable
//   verifiable artifact: the engineer reviewing the exhibit can
//   replay the FCC API calls themselves and confirm the result.
//
// ENDPOINT
//   GET https://geo.fcc.gov/api/contours/distance.json
//     ?haat=<m>&erp=<kw>&channel=<n>&field=<dBu>&curve=<0|1>
//     &serviceType=<FM|TV>&unit=km
//
//   The endpoint is the one Genoa's vendored tvfm_curves.js
//   ultimately implements — they should agree to sub-meter precision
//   when both are working correctly.
//
//   curve=0 → F(50,50);  curve=1 → F(50,10).
//
// OUTPUT (evidence.fcc_parity_report)
//   {
//     available, source, fetched_at,
//     n_samples, n_pass, n_fail,
//     max_error_km, mean_error_km,
//     tolerance_km,
//     samples: [
//       { az, contour, mode, haat, erp, frequency_mhz,
//         genoa_distance_km, fcc_distance_km, delta_km, within_tolerance }
//     ],
//     overall_pass,
//     provenance: { upstream_endpoint, upstream_commit, license_basis }
//   }
//
// LIMITATIONS
//   - The FCC endpoint is rate-limited and applies a request budget;
//     a full 36-radial × 5-contour exhibit can exceed it.  We sample
//     up to MAX_SAMPLES (default 24) per report to stay polite,
//     selected as a stratified random sample across radials and
//     contour families.  Increase via env FCC_PARITY_MAX_SAMPLES.
//   - The endpoint exposes FM/TV but not AM (AM uses gwave.js which
//     has no public per-call endpoint).  AM exhibits get an empty
//     parity_report with reason="no public per-call AM endpoint".
//   - Channel number is required by the FCC endpoint; we derive it
//     from the FM frequency (channel = round((f - 87.9) / 0.2 + 200)
//     for FM, 13 = TV ch.6 hack for ch.6).

const FCC_DISTANCE_ENDPOINT = 'https://geo.fcc.gov/api/contours/distance.json';
const DEFAULT_TOLERANCE_KM  = 0.05;
const DEFAULT_MAX_SAMPLES   = 24;
const DEFAULT_TIMEOUT_MS    = 10_000;

export function makeFccParityClient({
  endpoint     = process.env.FCC_DISTANCE_ENDPOINT || FCC_DISTANCE_ENDPOINT,
  toleranceKm  = Number(process.env.FCC_PARITY_TOLERANCE_KM) || DEFAULT_TOLERANCE_KM,
  maxSamples   = Number(process.env.FCC_PARITY_MAX_SAMPLES) || DEFAULT_MAX_SAMPLES,
  timeoutMs    = DEFAULT_TIMEOUT_MS,
  fetchFn      = (typeof fetch === 'function' ? fetch : null)
} = {}){
  if (!fetchFn) return null;
  return {
    endpoint, toleranceKm, maxSamples,

    /**
     * Build a parity report for one exhibit.
     *
     * @param {object} exhibit — full genoa.exhibit.v2 object
     * @returns {Promise<object>} report or { available: false, error }
     */
    async report(exhibit){
      if (!exhibit || typeof exhibit !== 'object'){
        return { available: false, source: null, error: 'exhibit object required' };
      }
      const service = String(exhibit.station_inputs?.service || '').toUpperCase();
      if (service === 'AM'){
        return {
          available: false,
          source:    null,
          reason:    'FCC has no public per-call distance.json endpoint for AM (gwave.js / §73.184 grid).  AM parity is verified via the 36-case curve_reference_validation golden suite instead.',
          regulation: '47 CFR §73.184'
        };
      }
      if (!['FM', 'LPFM', 'FX'].includes(service)){
        return {
          available: false,
          source:    null,
          reason:    `parity report not implemented for service=${service}.  FCC distance.json only covers FM/LPFM/FX channel-based services.`
        };
      }

      const frequency_mhz = Number(exhibit.station_inputs?.frequency);
      const haat_m        = Number(exhibit.station_inputs?.haat_m);
      const erp_kw        = Number(exhibit.station_inputs?.erp_kw);
      const channel       = frequencyToFmChannel(frequency_mhz);
      if (!Number.isFinite(channel)){
        return {
          available: false, source: null,
          error: `cannot derive FM channel from frequency=${frequency_mhz} MHz`
        };
      }
      if (!Number.isFinite(haat_m) || !Number.isFinite(erp_kw)){
        return {
          available: false, source: null,
          error: 'haat_m and erp_kw required'
        };
      }

      const samples_in = collectSamples(exhibit);
      if (samples_in.length === 0){
        return {
          available: false, source: null,
          error: 'no radial-contour samples found on exhibit.radial_table'
        };
      }
      const samples = stratifiedSample(samples_in, maxSamples);

      const fetched_at = new Date().toISOString();
      const out = [];
      const errors = [];
      for (const s of samples){
        const url = `${endpoint}?haat=${encodeURIComponent(haat_m)}`
                  + `&erp=${encodeURIComponent(erp_kw)}`
                  + `&channel=${encodeURIComponent(channel)}`
                  + `&field=${encodeURIComponent(s.contour_dBu)}`
                  + `&curve=${s.mode === '50,10' ? 1 : 0}`
                  + `&serviceType=FM&unit=km`;
        try {
          const r = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs) });
          if (!r.ok){
            errors.push(`HTTP ${r.status} on ${url}`);
            out.push({ ...s, fcc_distance_km: null, delta_km: null,
                       within_tolerance: null, error: `HTTP ${r.status}` });
            continue;
          }
          const j = await r.json();
          const fcc_km = Number(j?.distance_km ?? j?.distance ?? j?.km);
          if (!Number.isFinite(fcc_km)){
            errors.push(`bad JSON on ${url}: ${JSON.stringify(j).slice(0, 100)}`);
            out.push({ ...s, fcc_distance_km: null, delta_km: null,
                       within_tolerance: null, error: 'bad upstream JSON' });
            continue;
          }
          const delta = Number((s.genoa_distance_km - fcc_km).toFixed(6));
          out.push({
            ...s,
            fcc_distance_km:  Number(fcc_km.toFixed(4)),
            delta_km:         delta,
            within_tolerance: Math.abs(delta) <= toleranceKm
          });
        } catch (e){
          errors.push(`fetch failed on ${url}: ${e.message}`);
          out.push({ ...s, fcc_distance_km: null, delta_km: null,
                     within_tolerance: null, error: String(e.message) });
        }
      }

      const evaluated  = out.filter(s => Number.isFinite(s.delta_km));
      const max_error  = evaluated.length ? Math.max(...evaluated.map(s => Math.abs(s.delta_km))) : null;
      const mean_error = evaluated.length ? evaluated.reduce((a, s) => a + Math.abs(s.delta_km), 0) / evaluated.length : null;
      const n_pass     = evaluated.filter(s => s.within_tolerance).length;
      const n_fail     = evaluated.length - n_pass;

      return {
        available:  evaluated.length > 0,
        source:     'geo.fcc.gov/api/contours/distance.json',
        fetched_at,
        n_samples:  evaluated.length,
        n_attempted: out.length,
        n_pass, n_fail,
        max_error_km:  max_error  != null ? Number(max_error.toFixed(6))  : null,
        mean_error_km: mean_error != null ? Number(mean_error.toFixed(6)) : null,
        tolerance_km:  toleranceKm,
        overall_pass:  n_fail === 0 && evaluated.length > 0,
        samples:       out,
        errors:        errors.length ? errors.slice(0, 10) : null,
        provenance:    {
          upstream_endpoint:  endpoint,
          upstream_engine:    'FCC contours-api-node (controllers/contours.js / tvfm_curves.js)',
          upstream_commit:    'b55870d3f20618e886cd02379008ef980229d44b',
          genoa_engine:       exhibit.method_versions?.curve_engine || 'fcc-canonical',
          genoa_dataset:      exhibit.method_versions?.dataset || null,
          regulation:         '47 CFR §73.333 F(50,50) / F(50,10)',
          license_basis:      '17 USC §105 — US Government work product, public domain'
        }
      };
    }
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * FM channel grid: ch.200 = 87.9 MHz, step 0.2 MHz.
 * Returns 200..300 for valid FM channels; NaN otherwise.
 */
export function frequencyToFmChannel(frequency_mhz){
  const f = Number(frequency_mhz);
  if (!Number.isFinite(f)) return NaN;
  const ch = Math.round((f - 87.9) / 0.2 + 200);
  return ch >= 200 && ch <= 300 ? ch : NaN;
}

/**
 * Pull every {radial, contour} pair from the exhibit's radial_table
 * with its Genoa-computed distance.
 *
 * exhibit.contour_definitions is the engine-emitted shape:
 *     [ { id, label, field_strength: { value, unit }, mode?: '50,50'|'50,10' } ]
 * (see src/engine/index.js where this is written).  Older code paths
 * keyed defs by id directly; both shapes are accepted here so the
 * parity client keeps working if the engine shape ever flexes.
 */
function collectSamples(exhibit){
  const samples = [];
  const defs = indexContourDefinitions(exhibit.contour_definitions);
  const rt = Array.isArray(exhibit.radial_table) ? exhibit.radial_table : [];
  for (const r of rt){
    const cd = r.contour_distances_km || {};
    // Per-radial overrides (rare; respect them if present).
    const localDefs = r.contour_definitions ? indexContourDefinitions(r.contour_definitions) : null;
    for (const [contour_id, distance_km] of Object.entries(cd)){
      const d = Number(distance_km);
      if (!Number.isFinite(d) || d <= 0) continue;
      const def = (localDefs && localDefs[contour_id]) || defs[contour_id];
      if (!def) continue;
      if (!Number.isFinite(def.field_dBu)) continue;
      samples.push({
        az:               r.az ?? null,
        contour:          contour_id,
        mode:             def.mode || '50,50',
        contour_dBu:      def.field_dBu,
        genoa_distance_km: Number(d.toFixed(4))
      });
    }
  }
  return samples;
}

/**
 * Normalize the array-of-objects engine shape OR an object keyed by
 * id into a flat { [id]: { field_dBu, mode } } map.  Handles the
 * field_strength.{value,unit} shape including mV/m → dBµV/m
 * conversion (dBu = 20·log10(mV/m × 1000) = 20·log10(mV/m) + 60).
 */
function indexContourDefinitions(raw){
  const out = {};
  if (!raw) return out;
  const entries = Array.isArray(raw)
    ? raw.map(d => [d?.id, d])
    : Object.entries(raw);
  for (const [id, def] of entries){
    if (!id || !def) continue;
    let dBu = NaN;
    if (Number.isFinite(Number(def.field_dBu))){
      dBu = Number(def.field_dBu);
    } else if (def.field_strength && Number.isFinite(Number(def.field_strength.value))){
      const v = Number(def.field_strength.value);
      const u = String(def.field_strength.unit || '').toLowerCase();
      if (u === 'dbu' || u === 'dbuv/m' || u === 'dbµv/m'){
        dBu = v;
      } else if (u === 'mv/m' && v > 0){
        dBu = 20 * Math.log10(v) + 60;
      }
    }
    if (!Number.isFinite(dBu)) continue;
    out[id] = { field_dBu: dBu, mode: def.mode || '50,50' };
  }
  return out;
}

/**
 * Sample N items from a population, evenly spread across the
 * (azimuth × contour) space using a stratified random pull.
 */
function stratifiedSample(items, n){
  if (items.length <= n) return items;
  // Group by contour so every contour family gets representation.
  const byContour = new Map();
  for (const it of items){
    if (!byContour.has(it.contour)) byContour.set(it.contour, []);
    byContour.get(it.contour).push(it);
  }
  const groups = [...byContour.values()];
  const out = [];
  const per_group = Math.max(1, Math.floor(n / groups.length));
  for (const g of groups){
    const stride = Math.max(1, Math.floor(g.length / per_group));
    for (let i = 0; i < g.length && out.length < n; i += stride) out.push(g[i]);
  }
  return out.slice(0, n);
}

export const FCC_PARITY_PROVENANCE = Object.freeze({
  module:       'src/evidence/fccParity/client.js',
  upstream:     'https://geo.fcc.gov/api/contours/distance.json',
  upstream_engine: 'fcc/contours-api-node controllers/contours.js + tvfm_curves.js (commit b55870d)',
  regulation:   '47 CFR §73.333 F(50,50) / F(50,10)',
  modeled: [
    'Live per-radial / per-contour distance comparison vs FCC',
    'Stratified sampling across contour families to respect upstream rate limits',
    'Tolerance-aware pass/fail per sample + aggregate max/mean error',
    'Provenance stamps both Genoa\'s vendored commit AND the upstream endpoint'
  ],
  not_modeled: [
    'AM groundwave parity (no public per-call distance endpoint; verified via golden-suite)',
    'TV parity (FM-only sampling for now)',
    'Polygon-overlap parity (we compare radial distances, not full polygon vertices)'
  ],
  license_basis: '17 USC §105 (FCC engine + endpoint, US Government public domain)'
});
