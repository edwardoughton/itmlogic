// Appendices — radial data, interference study, validation evidence,
// provenance, replay bundle.
//
// Each appendix is emitted as its own section so the renderer can place
// page breaks between them and renderText.js can put each on its own page.

import { buildAmNightNarrative } from './amNightNarrative.js';
import {
  validatePhysicsEvidence,
  PHYSICS_EVIDENCE_SCHEMA_NAME,
  PHYSICS_EVIDENCE_SCHEMA_VERSION
} from '../../../types/physicsEvidence.schema.js';

export function buildAppendixSections(exhibit){
  const sections = [];

  // ── Appendix A — Radial data table ─────────────────────────────────
  const rt = Array.isArray(exhibit.radial_table) ? exhibit.radial_table : [];
  if (rt.length){
    const contourIds = new Set();
    for (const r of rt){
      const cd = r.contour_distances_km || {};
      for (const id of Object.keys(cd)) contourIds.add(id);
    }
    const cidList = Array.from(contourIds);

    // AM vs FM/TV radial schema — these are physically different
    // allocations and the operator-facing columns differ.  AM uses
    // §73.184 groundwave (TPO + σ + inverse-distance field at 1 km);
    // FM/TV uses §73.313 HAAT + ERP.  Showing HAAT/ERP for an AM
    // exhibit reads as FM architecture leaked into an AM filing —
    // exactly the credibility hit an AM engineer flags.
    const svc = String(exhibit.station_inputs?.service || '').toUpperCase();
    const isAm = svc === 'AM';
    const hasDaPattern = Array.isArray(exhibit.station_inputs?.pattern)
                        && exhibit.station_inputs.pattern.length > 0;
    const anySigmaPath = isAm && rt.some((r) => r?.sigma_path);

    let columns;
    if (isAm){
      // AM-native columns.  Pattern factor column is only meaningful
      // for DA; suppressed for NDA so the table doesn't show "1.000"
      // 36 times.  σ-used column always present so the operator can
      // see whether per-radial segmentation engaged on this azimuth.
      columns = [
        { key: 'azimuth_deg',  label: 'Az (°)',                 width: 0.09, align: 'right' },
        { key: 'sigma_msm',    label: 'σ used (mS/m)',          width: 0.13, align: 'right' },
        { key: 'ref_field',    label: 'E @ 1 km (mV/m)',        width: 0.14, align: 'right' }
      ];
      if (hasDaPattern){
        columns.splice(1, 0, { key: 'pat_factor', label: 'Pattern f', width: 0.10, align: 'right' });
      }
    } else {
      columns = [
        { key: 'azimuth_deg', label: 'Az (°)',     width: 0.10, align: 'right' },
        { key: 'haat_m',      label: 'HAAT (m)',   width: 0.14, align: 'right' },
        { key: 'erp_kw',      label: 'ERP (kW)',   width: 0.14, align: 'right' }
      ];
    }
    const used = columns.reduce((a, c) => a + c.width, 0);
    const widthPerContour = Math.max(0.08, (1 - used) / Math.max(1, cidList.length));
    for (const id of cidList){
      columns.push({ key: `c_${id}`, label: `${id} (km)`, width: widthPerContour, align: 'right' });
    }

    // Build a per-azimuth HAAT lookup from evidence.terrain_haat_per_radial.
    // The engine emits the radial_table with azimuth_deg + contour_distances_km
    // but doesn't always echo HAAT/ERP per-radial.  We can recover both:
    //   - HAAT: from the terrain compute (per-radial DEM sampling, §73.313)
    //   - ERP: station-wide ERP for ND antennas, or ERP × (rel_field)² for DA
    //          (the antenna pattern table is keyed by azimuth degree).
    const perRadialHaat = Array.isArray(exhibit.evidence?.terrain_haat_per_radial)
      ? exhibit.evidence.terrain_haat_per_radial
      : [];
    const haatByAz = new Map();
    for (const r of perRadialHaat){
      const az = Number(r?.az ?? r?.azimuth_deg);
      const h  = Number(r?.haat_computed_m ?? r?.haat_m);
      if (Number.isFinite(az) && Number.isFinite(h)) haatByAz.set(Math.round(az), h);
    }
    const stationErp = Number(exhibit.station_inputs?.erp_kw);
    const pattern = Array.isArray(exhibit.station_inputs?.pattern)
      ? exhibit.station_inputs.pattern
      : null;
    const erpByAz = new Map();
    if (pattern && Number.isFinite(stationErp)){
      for (const [az, relField] of pattern){
        const a = Math.round(Number(az));
        const f = Number(relField);
        if (Number.isFinite(a) && Number.isFinite(f)) erpByAz.set(a, stationErp * f * f);
      }
    }
    // Uniform-σ fallback for AM rows when per-radial segmentation isn't active.
    const uniformSigma = isAm
      ? (Number.isFinite(Number(exhibit.station_inputs?.ground_sigma_mS_m))
         ? Number(exhibit.station_inputs.ground_sigma_mS_m)
         : (Number.isFinite(Number(exhibit.station_inputs?.ground_sigma_ms_m))
            ? Number(exhibit.station_inputs.ground_sigma_ms_m) : null))
      : null;

    const rows = rt.map(r => {
      const az = Number.isFinite(r.azimuth_deg) ? Number(r.azimuth_deg) : null;
      const azKey = az != null ? Math.round(az) : null;
      let row;
      if (isAm){
        // σ for THIS azimuth — segmented value if step 6d found
        // crossings, otherwise the operator's uniform σ.
        const sigmaUsed = Number.isFinite(r?.sigma_path?.sigma_used_mS_m)
                          ? Number(r.sigma_path.sigma_used_mS_m)
                          : uniformSigma;
        const refField  = Number.isFinite(r?.reference_field_mVm_at_1km)
                          ? Number(r.reference_field_mVm_at_1km)
                          : null;
        row = {
          azimuth_deg: az != null ? az.toFixed(1) : '—',
          sigma_msm:   sigmaUsed != null ? sigmaUsed.toFixed(2) : '—',
          ref_field:   refField != null ? refField.toFixed(1) : '—'
        };
        if (hasDaPattern){
          const f = Number.isFinite(r?.relative_field) ? Number(r.relative_field) : null;
          row.pat_factor = f != null ? f.toFixed(3) : '—';
        }
      } else {
        // The FM/LPFM/FX radial builders emit per-radial rows with
        // `haat_computed_m` + `haat_input_m` (see src/engine/fm/contour.js).
        // Reading just `r.haat_m` (the operator's station-wide input)
        // misses the DEM-derived per-azimuth value the engine actually
        // used, so every row of Appendix A would print "—" even on an
        // exhibit that ran the terrain sidecar.
        // HAAT display policy: always include a value when one is
        // available.  When the validator suppresses per-radial
        // terrain output (no terrain basis attached, INVALID, etc.)
        // we DON'T render "UNAVAILABLE" — we fall back to the
        // operator-supplied HAAT (haat_input_m or station-level
        // haat_m), which is the same value the FCC §73.333 curve
        // interpolation uses, and is authoritative for the
        // contour-distance column.  The structured footnote below
        // tells the reader the column is flat across azimuths
        // because no terrain DEM was applied.  "UNAVAILABLE" is
        // reserved for the degenerate case where no HAAT was
        // supplied at all.
        const haatSuppressed = exhibit?.haat_validation?.display_suppressed === true;
        const stationHaat = Number.isFinite(Number(exhibit?.station_inputs?.haat_m))
                              ? Number(exhibit.station_inputs.haat_m)
                              : null;
        let haat;
        if (haatSuppressed){
          // Terrain compute couldn't add per-azimuth detail — use
          // operator HAAT uniformly.  Same value the curve engine
          // uses for contour distances.
          haat = Number.isFinite(r.haat_input_m) ? Number(r.haat_input_m) : stationHaat;
        } else {
          haat = Number.isFinite(r.haat_computed_m) ? Number(r.haat_computed_m)
               : Number.isFinite(r.haat_input_m)    ? Number(r.haat_input_m)
               : Number.isFinite(r.haat_m)          ? Number(r.haat_m)
               : (azKey != null && haatByAz.has(azKey) ? haatByAz.get(azKey) : null);
        }
        const erp   = Number.isFinite(r.erp_kw) ? Number(r.erp_kw)
                    : (azKey != null && erpByAz.has(azKey) ? erpByAz.get(azKey)
                    : (Number.isFinite(stationErp) && !pattern ? stationErp : null));
        row = {
          azimuth_deg: az != null  ? az.toFixed(1)   : '—',
          haat_m:      haat != null ? haat.toFixed(1) : 'UNAVAILABLE',  // only when no HAAT at all
          erp_kw:      erp != null  ? erp.toFixed(3)  : '—'
        };
      }
      const cd = r.contour_distances_km || {};
      for (const id of cidList){
        row[`c_${id}`] = Number.isFinite(cd[id]) ? Number(cd[id]).toFixed(2) : '—';
      }
      return row;
    });
    // HAAT validation footnote — structured output (req #4).  When
    // the validator suppressed the column we tell the reader exactly
    // why and what the fallback posture is, instead of a single line
    // that could be read as "everything is fine."  The block is
    // built as a small multi-line string so the PDF renderer's
    // paragraph wrap keeps it readable.
    const haatV = exhibit?.haat_validation;
    let haatFootnote = '';
    if (haatV && !isAm){
      const basisLabel = {
        operator_supplied: 'operator-supplied (inputs.overall_height_amsl_m)',
        terrain_derived:   `terrain-derived (ground at tx + haat_m via ${haatV.tx_amsl_resolved?.elevation_source || 'multi-source DEM'})`,
        flat:              'flat-earth fallback (no terrain DEM)',
        unknown:           'unresolved'
      }[haatV.basis] || haatV.basis;
      const s = haatV.stats || {};
      const lines = [];
      lines.push('');
      lines.push('');
      lines.push(`HAAT Validation Status: ${haatV.status}`);
      lines.push(`Basis: ${basisLabel}`);

      if (haatV.status === 'INVALID' || haatV.status === 'FALLBACK_ONLY' || haatV.status === 'NOT_RUN'){
        // Suppression posture (req #4 + #5)
        lines.push('');
        lines.push('Reason:');
        if (haatV.issues && haatV.issues.length){
          for (const i of haatV.issues) lines.push(`  - ${i.code} (${i.severity}): ${i.detail}`);
        } else if (haatV.status === 'NOT_RUN'){
          lines.push('  Terrain DEM unavailable; per-radial HAAT computation disabled to avoid invalid engineering output.');
        }
        lines.push('');
        lines.push('Fallback posture:');
        lines.push(`  Contour distances computed under 47 CFR §73.333 curves using operator HAAT (${s.operator_m ?? '—'} m).`);
        lines.push(`  HAAT column shows operator value uniformly across all azimuths — terrain DEM was not applied to vary it per radial.`);
        if (exhibit.terrain_limited){
          lines.push('  Exhibit marked TERRAIN_LIMITED — per-radial terrain severity scoring and engineering-confidence terrain inputs are unavailable for this run.');
        }
      } else if (haatV.status === 'PASS'){
        lines.push('');
        lines.push(`Per-radial range [${s.min_m}, ${s.max_m}] m, mean ${s.mean_m} m`);
        lines.push(`(operator ${s.operator_m ?? '—'} m, Δ ${s.delta_mean_vs_operator_m ?? '—'} m).`);
        if (haatV.issues && haatV.issues.length){
          lines.push('');
          lines.push('Issues:');
          for (const i of haatV.issues) lines.push(`  - ${i.code} (${i.severity})`);
        }
      } else if (haatV.status === 'SUSPECT'){
        lines.push('');
        lines.push(`Per-radial range [${s.min_m}, ${s.max_m}] m, mean ${s.mean_m} m (operator ${s.operator_m ?? '—'} m).`);
        lines.push('');
        lines.push('Outliers present — engineer of record should confirm:');
        for (const i of (haatV.issues || [])) lines.push(`  - ${i.code} (${i.severity}): ${i.detail}`);
      }
      haatFootnote = lines.join('\n');
    }
    sections.push({
      id:      'appendix-a',
      type:    'table',
      heading: 'APPENDIX A — RADIAL DATA',
      preface: (isAm
        ? `Per-radial conductivity (σ), inverse-distance field at 1 km, and §73.184 groundwave contour distances.  Radial step shown in METHODOLOGY.  ${anySigmaPath
            ? 'σ varies by azimuth where step 6d found M3 boundary crossings (path-length-weighted; stage-3 Millington pending).  Full per-azimuth (σ, cumulative km) tabulation in Appendix A-1.'
            : 'σ is uniform across all azimuths — per-radial M3 segmentation either found no crossings or was unavailable (see Appendix D).'}  ${hasDaPattern
            ? 'Pattern factor f is the §73.150 relative field; field at azimuth scales as f × E₁ₖₘ.'
            : 'Non-directional antenna (NDA); pattern factor is 1.0 at every azimuth.'}`
        : 'Per-radial HAAT, ERP, and contour distances.  Radial step shown in METHODOLOGY.  ' +
          (pattern ? 'ERP per radial computed from filed pattern table (ERP × (relative field)² per §73.316).'
                   : 'Non-directional antenna; ERP constant across all azimuths.')
      ) + haatFootnote,
      table:   { columns, rows }
    });

    // ── Appendix A-1 — M-3 Conductivity Tabulation (AM with crossings) ──
    // Mullaney KELP 1989 Table 1 format: per-azimuth, list every
    // constant-σ segment along the radial as (σ_mS/m, cumulative_km).
    // This is the consultant-grade output an AM engineer expects to
    // see when per-radial M3 segmentation actually engaged.  Only
    // surfaces when at least one radial has sigma_path with segments
    // (i.e. step 6d found crossings).
    if (isAm && anySigmaPath){
      const a1Rows = [];
      for (const r of rt){
        const az = Number.isFinite(r.azimuth_deg) ? Number(r.azimuth_deg) : null;
        if (az == null) continue;
        const segs = Array.isArray(r?.sigma_path?.segments) ? r.sigma_path.segments : null;
        const refField = Number.isFinite(r?.reference_field_mVm_at_1km)
                         ? Number(r.reference_field_mVm_at_1km) : null;
        if (!segs || segs.length === 0){
          // Uniform-σ radial — single-row entry so the azimuth is
          // still listed and the reader can see which radials had
          // no crossings vs which had several.
          a1Rows.push({
            azimuth_deg: az.toFixed(1),
            radiation:   refField != null ? refField.toFixed(1) : '—',
            seg_index:   '1',
            sigma_msm:   Number.isFinite(Number(r?.sigma_path?.sigma_uniform_mS_m))
                          ? Number(r.sigma_path.sigma_uniform_mS_m).toFixed(1)
                          : (Number.isFinite(uniformSigma) ? uniformSigma.toFixed(1) : '—'),
            cum_km:      'uniform across radial'
          });
          continue;
        }
        for (let i = 0; i < segs.length; i++){
          const s = segs[i];
          a1Rows.push({
            azimuth_deg: i === 0 ? az.toFixed(1) : '',
            radiation:   i === 0 && refField != null ? refField.toFixed(1) : '',
            seg_index:   String(i + 1),
            sigma_msm:   Number.isFinite(Number(s.sigma_mS_m)) ? Number(s.sigma_mS_m).toFixed(1) : '—',
            cum_km:      Number.isFinite(Number(s.to_km)) ? Number(s.to_km).toFixed(1) : '—'
          });
        }
      }
      sections.push({
        id:      'appendix-a-1',
        type:    'table',
        heading: 'APPENDIX A-1 — M-3 CONDUCTIVITY TABULATION',
        preface: 'Per-azimuth listing of constant-σ segments along each radial, in the Mullaney KELP 1989 Table 1 format.  Distance is CUMULATIVE from the transmitter; the entry "8.0 mS/m | 13.3 km" means σ=8 from 0 km to 13.3 km along that bearing.  Source: geodata sidecar /api/geodata/conductivity/radial (FCC §73.190 Figure M3 boundary linestrings, PostGIS).  Segmented σ is the path-length-weighted average used by the groundwave engine (stage-2 approximation; Millington integration pending stage-3).',
        table: {
          columns: [
            { key: 'azimuth_deg', label: 'Az (°)',         width: 0.10, align: 'right' },
            { key: 'radiation',   label: 'E @ 1 km (mV/m)', width: 0.16, align: 'right' },
            { key: 'seg_index',   label: 'Seg',            width: 0.08, align: 'right' },
            { key: 'sigma_msm',   label: 'σ (mS/m)',       width: 0.14, align: 'right' },
            { key: 'cum_km',      label: 'Cumulative km',  width: 0.20, align: 'right' }
          ],
          rows: a1Rows
        }
      });
    }
  }

  // ── Appendix B — Interference study ─────────────────────────────────────
  const isr = exhibit.interference_study;
  if (isr && Array.isArray(isr.stations)){
    // Lookup index for nearby_primaries (orchestrator side) so we can
    // fill Class + Freq + station-meta even when the engine's
    // interference_study.stations row only carries call/facility_id.
    // Indexed by both call and facility_id; either key resolves.
    const nearby = Array.isArray(exhibit.evidence?.nearby_primaries)
      ? exhibit.evidence.nearby_primaries : [];
    const byCall = new Map();
    const byFid  = new Map();
    for (const n of nearby){
      if (n?.call)        byCall.set(String(n.call).toUpperCase(), n);
      if (n?.facility_id) byFid.set(String(n.facility_id), n);
    }
    const lookupNearby = (s) => {
      if (s?.call && byCall.has(String(s.call).toUpperCase())) return byCall.get(String(s.call).toUpperCase());
      if (s?.facility_id && byFid.has(String(s.facility_id)))  return byFid.get(String(s.facility_id));
      return null;
    };
    const svc = String(exhibit.station_inputs?.service || '').toUpperCase();
    const isAmExhibit = svc === 'AM';
    const isFxExhibit = svc === 'FX';
    const passLabel = (v) => v === true ? 'PASS' : v === false ? 'FAIL' : null;
    const ruleCell = (rule, passKey = 'pass') => {
      if (!rule) return '—';
      const p = passLabel(rule[passKey]);
      if (p) return p;
      if (rule.skipped) return 'skip';
      return '—';
    };
    const rows = isr.stations.map(s => {
      const n = lookupNearby(s) || {};
      const fccClass = s.class || s.fcc_class || s.station_class
                    || n.class || n.fcc_class || n.station_class
                    || n.facility_class || null;
      // Frequency — AM rows carry kHz, FM/FX carry MHz.  Mis-picking the
      // unit would print "1240.0 MHz" for a 1240 kHz AM station.
      const freqStr = isAmExhibit
        ? (() => {
            const k = Number.isFinite(s.frequency_khz) ? Number(s.frequency_khz)
                   : Number.isFinite(n.frequency_khz)  ? Number(n.frequency_khz)
                   : Number.isFinite(n.frequency)      ? Number(n.frequency)
                   : null;
            return k != null ? String(Math.round(k)) : '—';
          })()
        : (() => {
            const m = Number.isFinite(s.frequency_mhz) ? Number(s.frequency_mhz)
                   : Number.isFinite(s.frequency)      ? Number(s.frequency)
                   : Number.isFinite(n.frequency_mhz)  ? Number(n.frequency_mhz)
                   : Number.isFinite(n.frequency)      ? Number(n.frequency)
                   : null;
            return m != null ? m.toFixed(1) : '—';
          })();
      // Distance — engine consolidated row uses channel_relationship +
      // distance_km; fall back to nearby_primaries' Karney-inverse
      // distance when the per-rule study didn't emit a separation.
      const distKm = Number.isFinite(s.distance_km) ? Number(s.distance_km)
                   : Number.isFinite(n.distance_km) ? Number(n.distance_km)
                   : null;
      // Relationship — blankStation emits channel_relationship; legacy
      // shapes emitted relationship.  Accept either.
      const rel = s.channel_relationship || s.relationship
                || n.channel_relationship || n.relationship || '—';
      const r = s.rules || {};
      const row = {
        call:               s.call || n.call || s.facility_id || '—',
        facility_id:        s.facility_id || n.facility_id || '—',
        fcc_class:          fccClass || '—',
        frequency:          freqStr,
        relationship:       rel,
        distance_km:        distKm != null ? distKm.toFixed(2) : '—',
        // Pair = overall pass across all applicable rules.  blankStation
        // stores this as pass_overall after rule consolidation.
        pair_pass:          passLabel(s.pass_overall) ?? passLabel(s.pair_pass) ?? '—'
      };
      if (isAmExhibit){
        row.rule_187 = ruleCell(r.section_73_187);
      } else if (isFxExhibit){
        row.rule_1204 = ruleCell(r.section_74_1204);
      } else {
        row.rule_207 = ruleCell(r.section_73_207);
        row.rule_215 = ruleCell(r.section_73_215);
      }
      return row;
    });
    const baseCols = [
      { key: 'call',           label: 'Call',         width: 0.10 },
      { key: 'facility_id',    label: 'Facility ID',  width: 0.10 },
      { key: 'fcc_class',      label: 'Class',        width: 0.07 },
      { key: 'frequency',      label: isAmExhibit ? 'Freq (kHz)' : 'Freq (MHz)', width: 0.10, align: 'right' },
      { key: 'relationship',   label: 'Relationship', width: 0.15 },
      { key: 'distance_km',    label: 'Dist (km)',    width: 0.10, align: 'right' }
    ];
    const ruleCols = isAmExhibit
      ? [{ key: 'rule_187', label: '§73.182(k) / §73.190', width: 0.18 }]
      : isFxExhibit
      ? [{ key: 'rule_1204', label: '§74.1204', width: 0.18 }]
      : [
          { key: 'rule_207', label: '§73.207',      width: 0.09 },
          { key: 'rule_215', label: '§73.215',      width: 0.09 }
        ];
    const preface = isAmExhibit
      ? 'Per-pair nighttime skywave evaluation under 47 CFR §73.182(k) (nighttime interference-free service; RSS combination per §73.185) using the SS-1 (50%) field-strength formulation of §73.190 (Wang).'
      : isFxExhibit
      ? 'Per-pair translator interference evaluation under 47 CFR §74.1204(a)+(c).'
      : 'Consolidated per-pair evaluation under 47 CFR §73.207 (Table A distance spacing) and §73.215 (contour-protection).';
    sections.push({
      id:      'appendix-b',
      type:    'table-with-summary',
      heading: 'APPENDIX B — INTERFERENCE STUDY',
      preface,
      table: {
        columns: [...baseCols, ...ruleCols, { key: 'pair_pass', label: 'Pair', width: 0.10 }],
        rows
      },
      summary: `Filing qualifies: ${isr.filing_qualifies === true ? 'YES'
                : isr.filing_qualifies === false ? 'NO' : 'INDETERMINATE'} ` +
               `(${isr.n_pass || 0} pass / ${isr.n_fail || 0} fail of ${isr.n_stations || rows.length} stations evaluated).`
    });
  }

  // ── Appendix C — Validation evidence ───────────────────────────────────
  // The engine populates method_versions.curve_dataset with the shape
  //   { curve_version, meta_sha256, dataset_sha256, source_dir }
  // (see src/engine/curves/loader.js#curveProvenance).  Prior versions
  // of this appendix were reading the older flat `dataset` /
  // `dataset_meta_sha256` keys and rendering "—" for every row.
  const v   = exhibit.validation_context || {};
  const ev  = exhibit.evidence || {};
  const mv  = exhibit.method_versions || {};
  const cd  = mv.curve_dataset || {};
  const svc_c = String(exhibit.station_inputs?.service || '').toUpperCase();
  const datasetLabel = mv.dataset
    || cd.label
    || cd.name
    || (svc_c === 'AM' ? `FCC §73.184 groundwave (vendored gwave.js v${cd.curve_version || '?'})`
                       : `FCC tvfm_curves.js (vendored, fcc/contours-api-node v${cd.curve_version || '?'})`);
  const cRows = [
    ['Curve dataset',           datasetLabel],
    ['Curve dataset SHA-256',   cd.meta_sha256 || mv.dataset_meta_sha256 || '—'],
    ['Curve engine',            mv.curve_engine
                                  || (svc_c === 'AM' ? 'gwave.js (vendored FCC §73.184 grid)' : '—')],
    ['FCC orchestration commit', mv.fcc_orchestration?.commit || '—'],
    ['Curve validation',        v.curve_reference_validation
                                  ? `${v.curve_reference_validation.n_pass || 0}/${v.curve_reference_validation.n_run || 0} cases pass`
                                  : 'not run'],
    ['FCC contour cross-check', v.fcc_cross_check
                                  ? (v.fcc_cross_check.detail || v.fcc_cross_check.message
                                      || `${v.fcc_cross_check.n_pass || 0}/${v.fcc_cross_check.n_run || 0} radials within tolerance`)
                                  : 'not attached'],
    ['FCC parity (live)',       ev.fcc_parity_report?.available
                                  ? `${ev.fcc_parity_report.n_pass}/${ev.fcc_parity_report.n_samples} samples within tolerance`
                                  : 'opt-in (not requested)'],
    // FORTRAN reference-engine parity (per-radial × per-contour).
    // Stamped on evidence.fcc_curve_parity when FORTRAN_FCC_SIDECAR_URL
    // is configured AND service ∈ { FM, LPFM, FX }.  The FCC FORTRAN
    // TVFMFS_METRIC routine implements §73.333 FM/TV curves only; it
    // has no AM groundwave capability, so for AM exhibits the parity
    // sweep is correctly skipped at the orchestrator (no missing
    // sidecar — not applicable to the service).
    ['FCC FORTRAN parity',      ev.fcc_curve_parity?.available
                                  ? `${ev.fcc_curve_parity.n_ok}/${ev.fcc_curve_parity.n_requests} pairs ok; max |Δ| ${Number.isFinite(ev.fcc_curve_parity.max_abs_delta_km) ? ev.fcc_curve_parity.max_abs_delta_km.toFixed(3) + ' km' : '—'} (tolerance ${ev.fcc_curve_parity.tolerance_km} km) — ${ev.fcc_curve_parity.pass ? 'PASS' : 'FAIL'}`
                                  : ev.fcc_curve_parity?.error
                                    ? `unavailable: ${ev.fcc_curve_parity.error}`
                                    : svc_c === 'AM'
                                      ? 'not applicable to AM (FCC TVFMFS_METRIC is §73.333 FM/TV curves only; §73.184 AM groundwave uses the vendored gwave.js engine reported above)'
                                      : 'not configured (FORTRAN_FCC_SIDECAR_URL unset)']
  ];
  sections.push({
    id:      'appendix-c',
    type:    'kv',
    heading: 'APPENDIX C — VALIDATION EVIDENCE',
    rows:    cRows
  });

  // ── Appendix D — Provenance ──────────────────────────────────────────────
  // engine_signature is populated by every compute() call; nothing
  // writes exhibit.provenance, so the prior "prov.engine_version || …"
  // chain rendered "—" for every row.  Read engine_signature directly.
  const sig  = exhibit.engine_signature || {};
  const prov = exhibit.provenance || {};
  // DEM provenance — the terrain sidecar attaches commit/build info to
  // evidence.terrain (top-level) on USGS-EPQS / SRTM responses, but
  // older responses nested it under .dem.  Read both shapes plus the
  // explicit dem_commit / dem_version fields some sidecars emit.
  const tDem    = ev.terrain || {};
  const tNested = ev.terrain?.dem || {};
  // For AM exhibits, §73.184 groundwave does not consume a DEM at all —
  // contour distances are derived from the FCC curve over assumed
  // ground conductivity (§73.183 / §73.190 Fig. M3/R3).  Print the
  // regulatory rationale rather than a misleading em-dash that would
  // suggest a missing data source.
  const demNotApplicable = svc_c === 'AM' && !tDem.available;
  const demDataset = demNotApplicable
    ? 'n/a — §73.184 AM groundwave does not use DEM'
    : (tNested.dataset || tNested.source || tDem.dataset || tDem.source || tDem.backend || '—');
  const demCommit  = demNotApplicable
    ? 'n/a — AM exhibits do not sample terrain'
    : (tNested.commit  || tNested.version || tNested.build || tNested.sha
        || tDem.commit     || tDem.version    || tDem.build    || tDem.sha
        || tDem.dem_commit || tDem.dem_version
        || '—');
  // FORTRAN reference-engine source-file provenance (when configured).
  // Stamped on method_versions.fcc_fortran_engine by exhibitService.js
  // step 8c from GET /version on the fcc-fortran-engine microservice.
  const ffe = mv.fcc_fortran_engine || null;
  const dRows = [
    ['Engine version',     sig.version || prov.engine_version || prov.version || '—'],
    ['Engine commit',      sig.hash || prov.git_commit || prov.commit || '—'],
    ['Release tag',        sig.release_tag || '—'],
    ['Build timestamp',    sig.build_time || prov.build_time || prov.built_at || '—'],
    ['Compute timestamp',  exhibit.generated_at || exhibit.computed_at || prov.computed_at || '—'],
    ['Build fingerprint',  sig.fingerprint_sha256 || prov.exhibit_hash || '—'],
    ['Node runtime',       sig.node || '—'],
    ['DEM dataset',        demDataset],
    ['DEM commit',         demCommit]
  ];
  if (ffe){
    // "tvfmfs.for" + size in bytes if known: "tvfmfs.for SHA-256 (35,906 B)"
    const srcLabel = (fname, size) =>
      Number.isFinite(size)
        ? `${fname} SHA-256 (${size.toLocaleString('en-US')} B)`
        : `${fname} SHA-256`;
    dRows.push(
      ['FCC FORTRAN engine',         ffe.engine || 'fcc-tvfmfs-fortran'],
      ['FCC FORTRAN version',        ffe.version        || '—'],
      ['FCC FORTRAN commit',         ffe.git_commit_sha || '—'],
      ['FCC FORTRAN image SHA-256',  ffe.image_sha256   || '—'],
      // Composite "did the math change" hash over the 3 source files.
      ['FCC FORTRAN source SHA-256', ffe.source_sha256  || '—'],
      ['FCC FORTRAN build',          ffe.build_time     || '—'],
      [srcLabel('tvfmfs.for', ffe.tvfmfs_for_size), ffe.tvfmfs_for_sha256 || '—'],
      [srcLabel('itplbv.for', ffe.itplbv_for_size), ffe.itplbv_for_sha256 || '—'],
      [srcLabel('driver.for', ffe.driver_for_size), ffe.driver_for_sha256 || '—']
    );
  }
  // Per-radial M3 conductivity segmentation status — surfaces what
  // step 6d (per-radial M3 fan-out) actually returned for this exhibit.
  // When the engine ran uniform-σ (no segments, sparse corpus, sidecar
  // down) the appendix says so explicitly instead of leaving the
  // operator to wonder why every radial returned the same distance.
  // For AM exhibits we ALWAYS surface a row — if the evidence block is
  // missing entirely, that's a step-6d-didn't-execute diagnostic and we
  // print it explicitly rather than silently omitting (which made the
  // KDUS 2026-05-17 PDF impossible to debug remotely).
  const gcr = exhibit.evidence?.ground_conductivity_per_radial;
  const svc_for_m3_diag = String(exhibit.station_inputs?.service || '').toUpperCase();
  if (!gcr && svc_for_m3_diag === 'AM'){
    dRows.push(
      ['σ per-radial status',  'NOT RECORDED — step 6d did not populate evidence.ground_conductivity_per_radial; check orchestrator wiring (gsvc not bound, service mismatch, or early throw before step 6d)'],
      ['σ per-radial fallback', 'engine ran uniform-σ path (single value across all azimuths)']
    );
  }
  if (gcr){
    if (gcr.available){
      dRows.push(
        ['σ per-radial method',     gcr.method || '—'],
        ['σ per-radial radials',    `${gcr.radials_segmented ?? '—'} of ${gcr.radials_total ?? '—'} azimuths segmented`],
        ['σ per-radial crossings',  `${gcr.radials_with_crossings ?? 0} radial(s) crossed at least one M3 boundary`],
        ['σ per-radial max range',  Number.isFinite(gcr.max_km) ? `${gcr.max_km} km` : '—'],
        ['σ per-radial fallback σ', Number.isFinite(gcr.site_sigma_mS_m) ? `${gcr.site_sigma_mS_m} mS/m (operator site value)` : '—'],
        ['σ per-radial source',     gcr.data_source || 'geodata sidecar /api/geodata/conductivity/radial'],
        ['σ per-radial regulation', gcr.regulation || '47 CFR §73.184 mixed-conductivity path']
      );
    } else {
      dRows.push(
        ['σ per-radial status',     `NOT applied — ${gcr.reason || 'reason not recorded'}`],
        ['σ per-radial fallback',   'engine ran uniform-σ path (single value across all azimuths)'],
        ['σ per-radial source',     gcr.data_source || 'geodata sidecar /api/geodata/conductivity/radial']
      );
    }
  }

  sections.push({
    id:      'appendix-d',
    type:    'kv',
    heading: 'APPENDIX D — PROVENANCE',
    rows:    dRows
  });

  // ── Appendix E — Replay determinism ───────────────────────────────────
  // No literal replay_bundle file is generated yet, but the determinism
  // contract rests on (engine fingerprint + curve dataset hash + inputs).
  // Surface those directly so the appendix is honest about what makes
  // the exhibit reproducible — same engine + same inputs → same numbers.
  //
  // The HMAC-signed replay token also lives in Build Attestation
  // (sections/buildAttestation.js); it is mirrored here because the
  // evidence-reporting checklist item 7 asks for the replay token on
  // Appendix E specifically.
  const replay = exhibit.replay_bundle || prov.replay_bundle || null;
  const inputsHash = sig.fingerprint_sha256
    ? `${String(sig.fingerprint_sha256).slice(0, 12)}…`
    : null;
  const replayToken = exhibit.replay_token;
  const eRows = [
    ['Determinism contract',      'same engine fingerprint + same curve dataset hash + same station_inputs → same numbers'],
    ['Engine fingerprint',        sig.fingerprint_sha256 || '—'],
    ['Curve dataset hash',        cd.meta_sha256 || '—'],
    ['Replay token (HMAC-signed)', replayToken
                                      ? `${String(replayToken).slice(0, 32)}…`
                                      : '(not attached)'],
    ['Replay token verifier',     'POST /api/exhibits/verify-replay-token'],
    ['Replay digest — exhibit',   exhibit.replay_digest?.exhibit_sha256  || '—'],
    ['Replay digest — inputs',    exhibit.replay_digest?.inputs_sha256   || '—'],
    ['Replay digest — evidence',  exhibit.replay_digest?.evidence_sha256 || '—'],
    ['Replay bundle (offline)',   replay ? 'attached' : 'not attached'],
    ['Bundle hash',               prov.replay_bundle_hash || (replay && replay.hash) || '—'],
    ['Reproduction',              inputsHash
                                    ? `genoa replay --engine ${inputsHash} --inputs station_inputs.json`
                                    : 'genoa replay <bundle.json>  (deterministic; same inputs → same outputs)']
  ];
  sections.push({
    id:      'appendix-e',
    type:    'kv',
    heading: 'APPENDIX E — REPLAY DETERMINISM',
    rows:    eRows
  });

  // ── Appendix F — AM nighttime allocation (§73.182) ────────────────────
  // Populated by exhibitService step 8d when service=AM and the
  // FCCAM sidecar is reachable.  Three blocks: summary KV,
  // per-azimuth NIF table, and the interferer table that fed the
  // RSS sum.  Falls back to a single "unavailable / reason" line
  // when the study didn't complete.
  const nif = exhibit.evidence?.am_night_nif;
  const svc_f = String(exhibit.station_inputs?.service || '').toUpperCase();
  if (svc_f === 'AM' && nif){
    if (!nif.available){
      sections.push({
        id:      'appendix-f',
        type:    'kv',
        heading: 'APPENDIX F — AM NIGHTTIME ALLOCATION (§73.182)',
        preface: 'Nighttime NIF contour analysis per 47 CFR §73.182 + §73.190(c).',
        rows: [
          ['Status',     'NOT RUN'],
          ['Reason',     nif.error || 'unavailable'],
          ['Regulation', '47 CFR §73.182 / §73.183 / §73.190(c)']
        ]
      });
    } else {
      const s = nif.summary || {};
      const fmtKm   = (v) => Number.isFinite(v) ? `${v.toFixed(1)} km` : '—';
      const fmtDb   = (v) => Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(2)} dB` : '—';
      const fmtN    = (v) => Number.isFinite(v) ? String(v) : '—';
      const fSummary = [
        ['Source',                  nif.source || 'fccam'],
        ['Fetched at',              nif.fetched_at || '—'],
        ['Azimuths evaluated',      fmtN(s.n_azimuths)],
        ['Failing azimuths',        fmtN(s.n_failing_azimuths)],
        ['No-service azimuths',     fmtN(s.n_no_service_azimuths)],
        ['Unbounded azimuths',      fmtN(s.n_unbounded_azimuths)],
        ['Mean NIF radius',         fmtKm(s.mean_radius_km)],
        ['Min NIF radius',          fmtKm(s.min_radius_km)],
        ['Max NIF radius',          fmtKm(s.max_radius_km)],
        ['Worst binding margin',    fmtDb(s.worst_margin_db)],
        ['Interferers used',        fmtN(s.n_interferers_used)],
        ['Interferers seen',        fmtN(s.n_interferers_seen)],
        ['Interferer cap applied',  nif.interferer_cap_applied ? 'yes' : 'no'],
        ['D/U applied (co-channel)',     fmtN(nif.du_db_by_relation?.co_channel)],
        ['D/U applied (1st-adjacent)',   fmtN(nif.du_db_by_relation?.first_adjacent)],
        ['D/U applied (2nd-adjacent)',   fmtN(nif.du_db_by_relation?.second_adjacent)],
        ['Regulation',              nif.regulation || '47 CFR §73.182 / §73.183 / §73.190(c)'],
        ['Upstream engine',         nif.provenance?.upstream_skywave || 'FCCAM (Fccam.for)']
      ];
      sections.push({
        id:      'appendix-f',
        type:    'kv',
        heading: 'APPENDIX F — AM NIGHTTIME ALLOCATION (§73.182)',
        preface: 'Nighttime Interference-Free (NIF) contour analysis per 47 CFR §73.182.  ' +
                 'Per-azimuth bisection of the boundary where the proposed station\'s 50% ' +
                 'skywave equals the §73.182(k) RSS-aggregated interference (25% exclusion ' +
                 'applied per FCC rule) at the §73.183 protection ratio for the proposed class.  ' +
                 'Skywave fields computed via Wang 1985 model (FCCAM); ' +
                 'NIF math vendored in Genoa.',
        rows: fSummary
      });

      // Auto-narrative — engineer-grade prose composed from the
      // structured §73.182 study fields.  Rendered as a paragraphs
      // section between the summary KV and the per-azimuth table so
      // the reviewer reads "what this means" before "the per-azimuth
      // numbers".  Falls back silently when the study didn't run.
      const narrative = buildAmNightNarrative(exhibit);
      if (narrative.ok && narrative.paragraphs.length){
        sections.push({
          id:         'appendix-f-narrative',
          type:       'paragraphs',
          heading:    'Appendix F — Engineering interpretation',
          paragraphs: narrative.paragraphs
        });
      }

      // Per-azimuth NIF table.  binding_interferer column carries
      // call + facility_id + relation + contributed_field at this
      // receiver, so the reviewer can attribute each azimuth's
      // binding constraint to a specific station without cross-
      // referencing Appendix F-2.
      const fmtBindingInterferer = (bi) => {
        if (!bi) return '—';
        const call = bi.call || '—';
        const fid  = bi.facility_id ? `#${bi.facility_id}` : '';
        const rel  = bi.relation || '—';
        const fld  = Number.isFinite(bi.contributed_uv_m)
          ? `${bi.contributed_uv_m.toFixed(2)} µV/m` : '—';
        return `${call}${fid ? ' ' + fid : ''} · ${rel} · ${fld}`;
      };
      const azRows = (nif.contour || []).map((p) => ({
        az:            Number.isFinite(p.azimuth_deg) ? p.azimuth_deg.toFixed(1) : '—',
        distance_km:   Number.isFinite(p.distance_km) ? p.distance_km.toFixed(2) : '—',
        lat:           Number.isFinite(p.lat) ? p.lat.toFixed(4) : '—',
        lon:           Number.isFinite(p.lon) ? p.lon.toFixed(4) : '—',
        binding:       p.binding?.relation
                          ? `${p.binding.relation} ${Number.isFinite(p.binding.margin_db) ? p.binding.margin_db.toFixed(1) : '—'} dB`
                          : (p.saturated || '—'),
        binding_interferer: fmtBindingInterferer(p.binding?.binding_interferer),
        iter:          Number.isFinite(p.iterations) ? p.iterations : '—'
      }));
      if (azRows.length){
        sections.push({
          id:      'appendix-f-azimuths',
          type:    'table',
          heading: 'Appendix F-1 — Per-azimuth NIF radius',
          preface: 'NIF radius per azimuth, the §73.183 protection relation that binds it ' +
                   '(margin = 20·log10(desired/required), positive = margin above protection), ' +
                   'and the single dominant interferer in that azimuth\'s §73.182(k) RSS sum.',
          table: {
            columns: [
              { key: 'az',                 label: 'Az (°)',             width: 0.07, align: 'right' },
              { key: 'distance_km',        label: 'NIF (km)',           width: 0.10, align: 'right' },
              { key: 'lat',                label: 'Lat',                width: 0.10, align: 'right' },
              { key: 'lon',                label: 'Lon',                width: 0.10, align: 'right' },
              { key: 'binding',            label: 'Binding · margin',   width: 0.18 },
              { key: 'binding_interferer', label: 'Binding interferer', width: 0.35 },
              { key: 'iter',               label: 'Iter',               width: 0.07, align: 'right' }
            ],
            rows: azRows
          }
        });
      }
      // Interferer table (sorted by RSS contribution where known,
      // otherwise by distance).  Limited to 25 rows by orchestrator cap.
      const ints = (nif.interferers || []).slice();
      if (ints.length){
        const intRows = ints.map((s_) => ({
          call:          s_.call         || '—',
          facility_id:   s_.station_id   || '—',
          class:         s_.fcc_class    || '—',
          freq_khz:      Number.isFinite(s_.freq_khz) ? s_.freq_khz : '—',
          erp_kw:        Number.isFinite(s_.erp_kw) ? s_.erp_kw.toFixed(2) : '—',
          distance_km:   Number.isFinite(s_.distance_km) ? s_.distance_km.toFixed(1) : '—',
          relation:      s_.relation || '—'
        }));
        sections.push({
          id:      'appendix-f-interferers',
          type:    'table',
          heading: 'Appendix F-2 — Interferer pool (§73.182(k) RSS input)',
          preface: 'Nearby co- and adjacent-channel AMs pulled from FCC AM Query within ' +
                   '~1500 km.  All passed §73.182(k)\'s field-presence test before RSS; ' +
                   'the 25% exclusion is applied per-receiver, not per-station, so a row ' +
                   'may contribute at some azimuths and not others.',
          table: {
            // The interferer pool is exclusively AM stations (§73.182(k)
            // is an AM-only RSS sum), so the power column is TPO, not
            // ERP — the field name on the row stays erp_kw to avoid
            // breaking the upstream FCCAM-fed row shape, but the label
            // surfaced to the engineer is AM-correct.
            columns: [
              { key: 'call',        label: 'Call',     width: 0.12 },
              { key: 'facility_id', label: 'Facility', width: 0.10, align: 'right' },
              { key: 'class',       label: 'Class',    width: 0.08 },
              { key: 'freq_khz',    label: 'kHz',      width: 0.10, align: 'right' },
              { key: 'erp_kw',      label: 'TPO (kW)', width: 0.12, align: 'right' },
              { key: 'distance_km', label: 'Dist (km)', width: 0.14, align: 'right' },
              { key: 'relation',    label: 'Relation', width: 0.22 }
            ],
            rows: intRows
          }
        });
      }
    }
  }

  // ── Appendix G — AM §73.99(b)(1)/(2) PSRA/PSSA reduced-power ─────────
  // Populated by exhibitService step 8e when service=AM.  Three blocks:
  //   - summary KV (PSSA + PSRA reduced powers, ceiling flags, binding)
  //   - §73.99 local-time window schedule (per-month sunrise/sunset)
  //   - per-pool protected-pair tables with allowed power + scale_factor
  const psra = exhibit.evidence?.am_psra_pssa;
  const svc_g = String(exhibit.station_inputs?.service || '').toUpperCase();
  if (svc_g === 'AM' && psra){
    if (!psra.available){
      sections.push({
        id:      'appendix-g',
        type:    'kv',
        heading: 'APPENDIX G — §73.99 PSRA/PSSA REDUCED POWER',
        preface: 'Pre-sunrise / Post-sunset reduced-power exhibit per 47 CFR §73.99(b)(1)/(2).',
        rows: [
          ['Status',     'NOT RUN'],
          ['Reason',     psra.error || 'unavailable'],
          ['Regulation', '47 CFR §73.99(b)(1) / §73.99(b)(2) / §73.182(k) / §73.190(c)']
        ]
      });
    } else {
      const pssa = psra.power?.pssa || {};
      const psraPool = psra.power?.psra || {};
      const ceiling = psra.power?.ceiling_w ?? 500;
      const fmtW = (v) => Number.isFinite(v) ? `${Number(v).toFixed(v >= 100 ? 0 : 1)} W` : '—';
      const bindLabel = (b) => b
        ? `${b.call || b.facility_id || 'unknown'} (${b.relation || 'co_channel'})`
        : '— (ceiling-only)';

      const gSummary = [
        ['§73.99(b)(1) ceiling',     `${ceiling} W`],
        ['PSSA reduced power',       fmtW(pssa.p_reduced_w) + (pssa.ceiling_applied ? '  (ceiling clipped)' : '')],
        ['PSSA binding pair',        bindLabel(pssa.binding)],
        ['PSSA pool available',      pssa.available === false ? 'NO — all pairs NaN' : 'yes'],
        ['PSRA reduced power',       fmtW(psraPool.p_reduced_w) + (psraPool.ceiling_applied ? '  (ceiling clipped)' : '')],
        ['PSRA binding pair',        bindLabel(psraPool.binding)],
        ['PSRA pool available',      psraPool.available === false ? 'NO — all pairs NaN' : 'yes'],
        ['Skywave engine',           psra.provenance?.skywave_engine || 'unconfigured'],
        ['Sun authority',            psra.sun?.source || 'unavailable'],
        ['Regulation',               psra.regulation || '47 CFR §73.99(b)(1) / §73.99(b)(2)']
      ];
      sections.push({
        id:      'appendix-g',
        type:    'kv',
        heading: 'APPENDIX G — §73.99 PSRA/PSSA REDUCED POWER',
        preface: 'Pre-sunrise / Post-sunset reduced-power exhibit per 47 CFR §73.99(b)(1)/(2).  ' +
                 'PSSA uses 50% (SS-1) skywave; PSRA uses 10% (SS-2) per §73.190.  ' +
                 'Per-pair allowed power P = P_daytime · (E_max_allowed / E_actual)² ' +
                 'with E_max_allowed embedding the §73.182(k) RSS share.  ' +
                 'The §73.99(b)(1) 500 W ceiling clips any binding pair that allows more.',
        rows: gSummary
      });

      // Window schedule (per-month local-time sunrise/sunset bracket
      // the PSRA/PSSA windows; FCC convention is 6 AM local for PSRA
      // start and 6 PM local for PSSA end, both anchored to the
      // resolved timezone).
      const wins = psra.windows?.windows;
      if (wins && (wins.psra || wins.pssa)){
        sections.push({
          id:      'appendix-g-windows',
          type:    'kv',
          heading: 'Appendix G-1 — §73.99 windows (local time)',
          preface: 'PSRA = pre-sunrise authority window; PSSA = post-sunset authority window.  ' +
                   'Hours per the FCC sunrise/sunset table for the resolved time zone.',
          rows: [
            ['PSRA start',    wins.psra?.start || '—'],
            ['PSRA end',      wins.psra?.end   || '—'],
            ['PSSA start',    wins.pssa?.start || '—'],
            ['PSSA end',      wins.pssa?.end   || '—'],
            ['Timezone',      psra.sun?.timezone_label || psra.sun?.timezone_code || '—']
          ]
        });
      }

      // Per-pair table — PSSA (50% SS-1)
      const pssaPairs = Array.isArray(pssa.per_pair) ? pssa.per_pair : [];
      if (pssaPairs.length){
        const rows = pssaPairs.map((p) => ({
          call:                p.call || '—',
          facility_id:         p.facility_id || '—',
          fcc_class:           p.fcc_class || '—',
          relation:            p.relation || '—',
          e_actual_uv_m:       Number.isFinite(p.e_actual_uv_m)      ? Number(p.e_actual_uv_m).toFixed(2)      : '—',
          e_max_allowed_uv_m:  Number.isFinite(p.e_max_allowed_uv_m) ? Number(p.e_max_allowed_uv_m).toFixed(2) : '—',
          scale_factor:        Number.isFinite(p.scale_factor) ? Number(p.scale_factor).toFixed(4) : '—',
          p_allowed_w:         Number.isFinite(p.p_allowed_w) ? Number(p.p_allowed_w).toFixed(p.p_allowed_w >= 100 ? 0 : 1) : '—'
        }));
        sections.push({
          id:      'appendix-g-pssa-pairs',
          type:    'table',
          heading: 'Appendix G-2 — PSSA (50% SS-1) per-pair allowed power',
          preface: 'P_allowed per protected pair at the §73.99(b)(1) closed-form scaling.  ' +
                   'Smallest p_allowed_w is the binding pair; result is clipped to the 500 W ceiling.',
          table: {
            columns: [
              { key: 'call',               label: 'Call',         width: 0.10 },
              { key: 'facility_id',        label: 'Facility',     width: 0.10, align: 'right' },
              { key: 'fcc_class',          label: 'Class',        width: 0.07 },
              { key: 'relation',           label: 'Relation',     width: 0.13 },
              { key: 'e_actual_uv_m',      label: 'E_actual (µV/m)',  width: 0.13, align: 'right' },
              { key: 'e_max_allowed_uv_m', label: 'E_max (µV/m)',     width: 0.13, align: 'right' },
              { key: 'scale_factor',       label: '(E_max/E_act)²',   width: 0.14, align: 'right' },
              { key: 'p_allowed_w',        label: 'P_allowed (W)',    width: 0.13, align: 'right' }
            ],
            rows
          }
        });
      }

      // Per-pair table — PSRA (10% SS-2)
      const psraPairs = Array.isArray(psraPool.per_pair) ? psraPool.per_pair : [];
      if (psraPairs.length){
        const rows = psraPairs.map((p) => ({
          call:                p.call || '—',
          facility_id:         p.facility_id || '—',
          fcc_class:           p.fcc_class || '—',
          relation:            p.relation || '—',
          e_actual_uv_m:       Number.isFinite(p.e_actual_uv_m)      ? Number(p.e_actual_uv_m).toFixed(2)      : '—',
          e_max_allowed_uv_m:  Number.isFinite(p.e_max_allowed_uv_m) ? Number(p.e_max_allowed_uv_m).toFixed(2) : '—',
          scale_factor:        Number.isFinite(p.scale_factor) ? Number(p.scale_factor).toFixed(4) : '—',
          p_allowed_w:         Number.isFinite(p.p_allowed_w) ? Number(p.p_allowed_w).toFixed(p.p_allowed_w >= 100 ? 0 : 1) : '—'
        }));
        sections.push({
          id:      'appendix-g-psra-pairs',
          type:    'table',
          heading: 'Appendix G-3 — PSRA (10% SS-2) per-pair allowed power',
          preface: 'PSRA evaluation uses the 10% (SS-2) skywave field per §73.99(b)(2).  ' +
                   'Same closed-form scaling and 500 W ceiling as PSSA.',
          table: {
            columns: [
              { key: 'call',               label: 'Call',         width: 0.10 },
              { key: 'facility_id',        label: 'Facility',     width: 0.10, align: 'right' },
              { key: 'fcc_class',          label: 'Class',        width: 0.07 },
              { key: 'relation',           label: 'Relation',     width: 0.13 },
              { key: 'e_actual_uv_m',      label: 'E_actual (µV/m)',  width: 0.13, align: 'right' },
              { key: 'e_max_allowed_uv_m', label: 'E_max (µV/m)',     width: 0.13, align: 'right' },
              { key: 'scale_factor',       label: '(E_max/E_act)²',   width: 0.14, align: 'right' },
              { key: 'p_allowed_w',        label: 'P_allowed (W)',    width: 0.13, align: 'right' }
            ],
            rows
          }
        });
      }
    }
  }

  // ── Appendix H — Independent AM Physics Evidence (advisory) ──────────
  // Populated by exhibitService step 8e for AM exhibits when the
  // operator-hosted SOMNEC2D sidecar is configured (AM_PHYSICS_SIDECAR_URL).
  // ADVISORY ONLY: independent NEC-family FORTRAN ground-field solver
  // (modified Sommerfeld integral evaluation producing the SOM2D.NEC
  // interpolation grid).  Does NOT modify FCC §73.184 curve-derived
  // contour distances, §73.183 allocation results, or any filing-
  // controlling rule math — those remain authoritative as reported in
  // the body of this engineering statement and in Appendices A–G.
  const physics = exhibit.evidence?.am_physics;
  const svc_h   = String(exhibit.station_inputs?.service || '').toUpperCase();
  if (svc_h === 'AM' && physics){
    const schemaCheck   = validatePhysicsEvidence(physics);
    const schemaConform = schemaCheck.ok
      ? `${PHYSICS_EVIDENCE_SCHEMA_NAME} v${PHYSICS_EVIDENCE_SCHEMA_VERSION} — PASS`
      : `${PHYSICS_EVIDENCE_SCHEMA_NAME} v${PHYSICS_EVIDENCE_SCHEMA_VERSION} — FAIL: ${(schemaCheck.errors || []).join('; ')}`;
    const inp = physics.inputs  || {};
    const out = physics.outputs || {};
    const sum = physics.stdout_summary || {};
    const advisoryPreface =
      'INDEPENDENT PHYSICS EVIDENCE — ADVISORY ONLY.  This appendix surfaces ' +
      'the output of the operator-hosted SOMNEC2D sidecar, an independent ' +
      'NEC-family FORTRAN solver that numerically evaluates modified ' +
      'Sommerfeld integrals to produce the SOM2D.NEC ground-field ' +
      'interpolation grid consumed by NEC-2 / NEC2++.  Genoa does not ' +
      'replace FCC allocation rules with NEC-family physics output.  ' +
      'Genoa uses SOMNEC2D as an independent physics engine beside ' +
      'deterministic FCC §73.183 / §73.184 / §73.190 / §73.182 rule ' +
      'calculations.  Filing-controlling math is reported elsewhere in ' +
      'this statement and is unaffected by anything in this appendix.';

    if (physics.status !== 'run'){
      const reason = physics.status === 'not_configured'
        ? 'AM_PHYSICS_SIDECAR_URL unset — sidecar not invoked.'
        : (physics.warning || physics.error || 'unavailable');
      sections.push({
        id:      'appendix-h',
        type:    'kv',
        heading: 'APPENDIX H — INDEPENDENT AM PHYSICS EVIDENCE (ADVISORY)',
        preface: advisoryPreface,
        rows: [
          ['Status',        String(physics.status || 'unknown').toUpperCase()],
          ['Engine',        physics.engine || 'somnec2d'],
          ['Reason',        reason],
          ['Schema',        schemaConform],
          ['Filing effect', 'NONE (advisory only)'],
          ['Posture',       'Does not modify §73.184 contour distances or any filing-controlling rule math.']
        ]
      });
    } else {
      const fmtNum = (v, dp = 6) =>
        Number.isFinite(Number(v)) ? Number(v).toFixed(dp) : '—';
      const sigmaSrc = inp.sigma_source === 'default' ? '  (default per §73.190 Fig. R3)' : '';
      const eprSrc   = inp.epr_source   === 'default' ? '  (default — NEC average soil)' : '';
      const timeSec  = Number.isFinite(Number(sum.time_seconds))
        ? `${Number(sum.time_seconds).toFixed(4)} s` : '—';

      sections.push({
        id:      'appendix-h',
        type:    'kv',
        heading: 'APPENDIX H — INDEPENDENT AM PHYSICS EVIDENCE (ADVISORY)',
        preface: advisoryPreface,
        rows: [
          ['Engine',                physics.engine || 'somnec2d'],
          ['Method',                physics.method || 'Modified Sommerfeld integral evaluation (NEC-family ground-field solver)'],
          ['Dielectric constant',   `${fmtNum(inp.epr, 3)} (NEC EPR)${eprSrc}`],
          ['Conductivity',          `${fmtNum(inp.sig_s_m, 6)} S/m  (${fmtNum(inp.sigma_ms_m, 2)} mS/m)${sigmaSrc}`],
          ['Frequency',             `${fmtNum(inp.frequency_mhz, 6)} MHz`],
          ['Grid file',             out.grid_file || '—'],
          ['Grid SHA-256',          out.grid_sha256 || '—'],
          ['Grid created',          out.grid_created === false ? 'NO' : 'yes'],
          ['Solver runtime',        timeSec],
          ['Diagnostic (EPSCF)',    sum.epscf || '—'],
          ['Diagnostic (AR1[1,1,1])', sum.ar1_1_1 || '—'],
          ['Sidecar fetched at',    physics.fetched_at || '—'],
          ['Schema',                schemaConform],
          ['Filing effect',         'NONE (advisory only)'],
          ['Posture',               'Does not modify §73.184 contour distances or any filing-controlling rule math.'],
          ['Regulation',            '47 CFR §73.190 (input conventions) — informational; this appendix establishes no rule compliance.']
        ]
      });
    }
  }

  // ── Appendix I — Environmental RF Evidence (advisory) ────────────────
  // Populated by exhibitService step 8g for both AM and FM exhibits when
  // the operator-hosted Geo-RF Evidence sidecar is configured
  // (GEO_RF_EVIDENCE_SIDECAR_URL).  ADVISORY ONLY: environmental
  // geospatial datasets (USFS tree canopy, landcover, RF/environment
  // statistical model artifacts) sampled at the transmitter coordinates.
  // Does NOT modify FCC §73.184 / §73.182 / §73.190 / §73.313 / §73.207
  // / §73.215 contour or allocation math.
  const geoRf = exhibit.evidence?.geo_rf_evidence;
  if (geoRf){
    const inp = geoRf.inputs || {};
    const ds  = geoRf.datasets || {};
    // Prefer canonical `tree_canopy`; fall back to legacy
    // `tree_canopy_conus` so older sidecar contracts still render.
    const tc  = (ds.tree_canopy && ds.tree_canopy.available)
                  ? ds.tree_canopy
                  : (ds.tree_canopy_conus || {});
    const lc  = ds.landcover                         || ds.canada_landcover || {};
    const tau = ds.tau_rf_models                     || {};
    const m3  = ds.fcc_m3_conductivity_availability  || {};
    const wp  = ds.water_proximity                   || {};
    const cp  = ds.climate_projection_availability   || {};
    const rs  = ds.sdr_residual_support              || {};
    const mm  = geoRf.map_marker                     || null;
    const csx = geoRf.confidence_scoring_context     || {};
    const rsx = geoRf.residual_support               || {};

    const advisoryPreface =
      'Environmental RF evidence was sampled from advisory geospatial ' +
      'datasets including tree-canopy density, landcover, FCC M3 ' +
      'conductivity-coverage flags, water proximity, climate-projection ' +
      'availability, and RF/environment statistical artifacts.  These ' +
      'data provide CONFIDENCE-SCORING CONTEXT and OBSERVED-VS-PREDICTED ' +
      'RESIDUAL SUPPORT for the engineering narrative; they do not ' +
      'modify FCC contour distances, AM nighttime allocation, skywave ' +
      'results, spacing determinations, or any filing-controlling rule ' +
      'calculation.  FILING EFFECT: NONE.';

    const fmtCoord = (v) => Number.isFinite(Number(v)) ? Number(v).toFixed(6) : '—';
    const status   = String(geoRf.status || 'unknown').toUpperCase();
    const yesNo    = (b) => b ? 'available' : 'unavailable';

    // Optional canopy-rose summary — min / max / mean over the available
    // azimuth samples.  Surfaces directional canopy heterogeneity without
    // re-emitting the full per-sample table (which lives in the JSON).
    const rose = tc?.rose && Array.isArray(tc.rose.samples) ? tc.rose : null;
    let roseSummary = null;
    if (rose){
      const vals = rose.samples
        .map(s => Number(s.value_numeric))
        .filter(Number.isFinite);
      if (vals.length){
        const min  = Math.min(...vals);
        const max  = Math.max(...vals);
        const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
        roseSummary = `${rose.n_azimuths} az @ ${rose.distance_km} km — ` +
                      `min ${min}, max ${max}, mean ${mean.toFixed(1)} ` +
                      `(${vals.length}/${rose.samples.length} samples in coverage)`;
      } else {
        roseSummary = `${rose.n_azimuths} az @ ${rose.distance_km} km — no samples in canopy coverage`;
      }
    }

    const rows = [
      // ── Prominent filing-effect lock at the top ──────────────────────
      ['Filing effect',                'NONE (advisory only)'],
      ['Advisory',                     'Yes'],
      ['Status',                       status],
      ['Latitude',                     fmtCoord(inp.lat)],
      ['Longitude',                    fmtCoord(inp.lon)]
    ];

    // Confidence-scoring context — only surface when the sidecar attached
    // a role.  An empty stub line ("advisory inputs only — narrative
    // context") added no information and read as noise on review.
    if (csx.role){
      rows.push(['Confidence scoring context',
        `${csx.role} — contributes to ${(csx.contributes_to || []).join(', ') || 'narrative only'}`]);
    }

    // Observed-vs-predicted residual support — only surface when SDR
    // residuals are actually attached.  Skip the row entirely when not.
    if (rsx.available || rs.available){
      rows.push(['Observed-vs-predicted residual support',
        'available — cross-references evidence.sdr_residuals (advisory)']);
    }

    // Tree canopy — always show when sampled; skip rows when no value.
    if (tc.dataset || tc.value_numeric != null || tc.value_raw){
      rows.push(['Tree canopy dataset', tc.dataset || '(unspecified)']);
      if (tc.value_numeric != null){
        rows.push(['Tree canopy value',
          `${tc.value_numeric}${tc.interpretation ? `  (${tc.interpretation})` : ''}`]);
      } else if (tc.value_raw){
        rows.push(['Tree canopy value', tc.value_raw]);
      }
    }
    if (roseSummary){
      rows.push(['Tree canopy rose',   roseSummary]);
    }
    // Auxiliary dataset slots — only list datasets that actually have
    // data attached.  Listing every queryable layer as "unavailable"
    // surfaced as noise on the engineering review; the absence of a row
    // already communicates "not sampled on this exhibit".
    if (lc.available)  rows.push(['Landcover',                    lc.dataset || 'available']);
    if (tau.available) rows.push(['Tau RF model artifacts',       tau.dataset || 'available']);
    if (m3.available)  rows.push(['FCC M3 conductivity coverage', m3.dataset || 'available']);
    if (wp.available)  rows.push(['Water proximity',              wp.dataset || 'available']);
    if (cp.available)  rows.push(['Climate projection coverage',  cp.dataset || 'available']);
    if (rs.available)  rows.push(['SDR residual support',         rs.dataset || 'available']);

    // ── Provenance ───────────────────────────────────────────────────
    rows.push(
      ['Sidecar service',              geoRf.sidecar_service || 'genoa-geo-rf-evidence'],
      ['Fetched at',                   geoRf.fetched_at || '—']
    );
    if (mm){
      rows.push(['Map marker',
        `(${fmtCoord(mm.lat)}, ${fmtCoord(mm.lon)})  "${mm.label}"`]);
    }
    rows.push(
      ['Posture',                      'Does not modify FCC rule outputs; informational context only.']
    );

    if (geoRf.error){
      rows.splice(3, 0, ['Note', geoRf.error]);
    }
    sections.push({
      id:      'appendix-i',
      type:    'kv',
      heading: 'APPENDIX I — ENVIRONMENTAL RF EVIDENCE (ADVISORY)',
      preface: advisoryPreface,
      rows
    });
  }

  // ── Appendix J — Other Services within 8 km (Mullaney KELP Table 3) ──
  // Site-survey context: every broadcast / tower / airport within
  // 8 km of the proposed site.  Standard consultant-grade output
  // because Part 17 co-location, blanketing interference, RF
  // intermodulation, and antenna-coupling effects all start at this
  // proximity.  Surfaces only when at least one category has data.
  const ss = exhibit.evidence?.site_survey_8km;
  if (ss && (ss.towers?.n > 0 || ss.airports?.n > 0
             || ss.towers?.error || ss.airports?.error)){
    const surveyRows = [];
    // Broadcast facilities — pulled from nearby_primaries (already
    // computed for §73.207 / §73.182(k)) filtered to ≤8 km.
    const nearby = Array.isArray(exhibit.evidence?.nearby_primaries)
      ? exhibit.evidence.nearby_primaries
      : [];
    for (const p of nearby){
      const d = Number(p?.distance_km);
      if (!Number.isFinite(d) || d > ss.radius_km) continue;
      surveyRows.push({
        type:        (p.service || 'AM').toUpperCase(),
        ident:       p.call || p.facility_id || '—',
        name_or_class: p.fcc_class ? `Class ${p.fcc_class}` : '—',
        freq_or_alt: Number.isFinite(Number(p.freq_khz))
                      ? `${p.freq_khz} kHz`
                      : (Number.isFinite(Number(p.frequency)) ? `${p.frequency}` : '—'),
        city_state:  [p.city, p.state].filter(Boolean).join(', ') || '—',
        bearing_deg: Number.isFinite(Number(p.bearing_deg)) ? Number(p.bearing_deg).toFixed(1) + '°' : '—',
        distance_km: d.toFixed(2)
      });
    }
    // Towers — ASR records.
    for (const t of (ss.towers?.records || [])){
      const distKm = Number.isFinite(Number(t?.distance_m)) ? Number(t.distance_m) / 1000 : null;
      if (distKm != null && distKm > ss.radius_km) continue;
      surveyRows.push({
        type:        'TW',
        ident:       t?.asr_number ? `ASR ${t.asr_number}` : (t?.registration_number || '—'),
        name_or_class: t?.structure_type || t?.owner || '—',
        freq_or_alt: Number.isFinite(Number(t?.overall_height_m))
                      ? `${Number(t.overall_height_m).toFixed(0)} m AGL`
                      : '—',
        city_state:  [t?.city, t?.state].filter(Boolean).join(', ') || '—',
        bearing_deg: Number.isFinite(Number(t?.bearing_deg)) ? Number(t.bearing_deg).toFixed(1) + '°' : '—',
        distance_km: distKm != null ? distKm.toFixed(2) : '—'
      });
    }
    // Airports / heliports — FAA records.
    for (const a of (ss.airports?.records || [])){
      const distKm = Number.isFinite(Number(a?.distance_km)) ? Number(a.distance_km) : null;
      if (distKm != null && distKm > ss.radius_km) continue;
      const t = String(a?.type || a?.facility_use || '').toUpperCase();
      const typeCode = t.includes('HELI') ? 'HP'
                     : t.includes('SEA')  ? 'SP'
                     : t.includes('BAL')  ? 'BL'
                     : 'AP';
      surveyRows.push({
        type:        typeCode,
        ident:       a?.ident || a?.icao || '—',
        name_or_class: a?.name || '—',
        freq_or_alt: Number.isFinite(Number(a?.elevation_ft))
                      ? `${Math.round(Number(a.elevation_ft) * 0.3048)} m AMSL`
                      : '—',
        city_state:  [a?.city, a?.state].filter(Boolean).join(', ') || '—',
        bearing_deg: Number.isFinite(Number(a?.bearing_deg)) ? Number(a.bearing_deg).toFixed(1) + '°' : '—',
        distance_km: distKm != null ? distKm.toFixed(2) : '—'
      });
    }
    // Sort by distance ascending for consultant-grade readability.
    surveyRows.sort((a, b) => Number(a.distance_km) - Number(b.distance_km));

    let surveyPreface =
      `Other broadcast facilities, registered antenna structures, and airports / heliports within ${ss.radius_km} km of the proposed site.  Mirrors the standard consulting-engineer site survey (cf. Mullaney KELP 1989 Engineering Statement, Table 3).  Type codes: AM/FM/TV = broadcast service; TW = registered tower (FCC ASR); AP = airport, HP = heliport, SP = seaplane base, BL = balloon port (FAA NASR).`;
    if (ss.towers?.error){
      surveyPreface += `  Tower lookup: ${ss.towers.error}.`;
    }
    if (ss.airports?.error){
      surveyPreface += `  Airport lookup: ${ss.airports.error}.`;
    }

    sections.push({
      id:      'appendix-j',
      type:    'table',
      heading: 'APPENDIX J — OTHER SERVICES WITHIN 8 km',
      preface: surveyPreface,
      table: {
        columns: [
          { key: 'type',        label: 'Type',     width: 0.06 },
          { key: 'ident',       label: 'Ident',    width: 0.14 },
          { key: 'name_or_class', label: 'Name / Class', width: 0.22 },
          { key: 'freq_or_alt', label: 'Freq / Height', width: 0.14 },
          { key: 'city_state',  label: 'City, State', width: 0.18 },
          { key: 'bearing_deg', label: 'Bear (°)', width: 0.10, align: 'right' },
          { key: 'distance_km', label: 'Dist (km)', width: 0.10, align: 'right' }
        ],
        rows: surveyRows
      }
    });
  }

  return sections;
}
