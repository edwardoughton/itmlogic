// Appendices — radial data, interference study, validation evidence,
// provenance, replay bundle.
//
// Each appendix is emitted as its own section so the renderer can place
// page breaks between them and renderText.js can put each on its own page.

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
    const columns = [
      { key: 'azimuth_deg', label: 'Az (°)',     width: 0.10, align: 'right' },
      { key: 'haat_m',      label: 'HAAT (m)',   width: 0.14, align: 'right' },
      { key: 'erp_kw',      label: 'ERP (kW)',   width: 0.14, align: 'right' }
    ];
    const widthPerContour = Math.max(0.08, (1 - 0.38) / Math.max(1, cidList.length));
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

    const rows = rt.map(r => {
      const az = Number.isFinite(r.azimuth_deg) ? Number(r.azimuth_deg) : null;
      const azKey = az != null ? Math.round(az) : null;
      // The FM/LPFM/FX radial builders emit per-radial rows with
      // `haat_computed_m` + `haat_input_m` (see src/engine/fm/contour.js).
      // Reading just `r.haat_m` (the operator's station-wide input)
      // misses the DEM-derived per-azimuth value the engine actually
      // used, so every row of Appendix A would print "—" even on an
      // exhibit that ran the terrain sidecar.
      const haat  = Number.isFinite(r.haat_computed_m) ? Number(r.haat_computed_m)
                  : Number.isFinite(r.haat_input_m)    ? Number(r.haat_input_m)
                  : Number.isFinite(r.haat_m)          ? Number(r.haat_m)
                  : (azKey != null && haatByAz.has(azKey) ? haatByAz.get(azKey) : null);
      const erp   = Number.isFinite(r.erp_kw) ? Number(r.erp_kw)
                  : (azKey != null && erpByAz.has(azKey) ? erpByAz.get(azKey)
                  : (Number.isFinite(stationErp) && !pattern ? stationErp : null));
      const row = {
        azimuth_deg: az != null  ? az.toFixed(1)   : '—',
        haat_m:      haat != null ? haat.toFixed(1) : '—',
        erp_kw:      erp != null  ? erp.toFixed(3)  : '—'
      };
      const cd = r.contour_distances_km || {};
      for (const id of cidList){
        row[`c_${id}`] = Number.isFinite(cd[id]) ? Number(cd[id]).toFixed(2) : '—';
      }
      return row;
    });
    sections.push({
      id:      'appendix-a',
      type:    'table',
      heading: 'APPENDIX A — RADIAL DATA',
      preface: 'Per-radial HAAT, ERP, and contour distances.  Radial step shown in METHODOLOGY.  ' +
               (pattern ? 'ERP per radial computed from filed pattern table (ERP × (relative field)² per §73.316).'
                        : 'Non-directional antenna; ERP constant across all azimuths.'),
      table:   { columns, rows }
    });
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
      ? [{ key: 'rule_187', label: '§73.187 / §73.190', width: 0.18 }]
      : isFxExhibit
      ? [{ key: 'rule_1204', label: '§74.1204', width: 0.18 }]
      : [
          { key: 'rule_207', label: '§73.207',      width: 0.09 },
          { key: 'rule_215', label: '§73.215',      width: 0.09 }
        ];
    const preface = isAmExhibit
      ? 'Per-pair nighttime skywave evaluation under 47 CFR §73.187 using the SS-1 (50%) field-strength formulation of §73.190 (Wang).'
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
    // is configured AND service ∈ { FM, LPFM, FX }.
    ['FCC FORTRAN parity',      ev.fcc_curve_parity?.available
                                  ? `${ev.fcc_curve_parity.n_ok}/${ev.fcc_curve_parity.n_requests} pairs ok; max |Δ| ${Number.isFinite(ev.fcc_curve_parity.max_abs_delta_km) ? ev.fcc_curve_parity.max_abs_delta_km.toFixed(3) + ' km' : '—'} (tolerance ${ev.fcc_curve_parity.tolerance_km} km) — ${ev.fcc_curve_parity.pass ? 'PASS' : 'FAIL'}`
                                  : ev.fcc_curve_parity?.error
                                    ? `unavailable: ${ev.fcc_curve_parity.error}`
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
  const demDataset = tNested.dataset || tNested.source || tDem.dataset || tDem.source || tDem.backend || '—';
  const demCommit  = tNested.commit  || tNested.version || tNested.build || tNested.sha
                  || tDem.commit     || tDem.version    || tDem.build    || tDem.sha
                  || tDem.dem_commit || tDem.dem_version
                  || '—';
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
  const replay = exhibit.replay_bundle || prov.replay_bundle || null;
  const inputsHash = sig.fingerprint_sha256
    ? `${String(sig.fingerprint_sha256).slice(0, 12)}…`
    : null;
  const eRows = [
    ['Determinism contract',      'same engine fingerprint + same curve dataset hash + same station_inputs → same numbers'],
    ['Engine fingerprint',        sig.fingerprint_sha256 || '—'],
    ['Curve dataset hash',        cd.meta_sha256 || '—'],
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
      // Per-azimuth NIF table.
      const azRows = (nif.contour || []).map((p) => ({
        az:            Number.isFinite(p.azimuth_deg) ? p.azimuth_deg.toFixed(1) : '—',
        distance_km:   Number.isFinite(p.distance_km) ? p.distance_km.toFixed(2) : '—',
        lat:           Number.isFinite(p.lat) ? p.lat.toFixed(4) : '—',
        lon:           Number.isFinite(p.lon) ? p.lon.toFixed(4) : '—',
        binding:       p.binding?.relation
                          ? `${p.binding.relation} ${Number.isFinite(p.binding.margin_db) ? p.binding.margin_db.toFixed(1) : '—'} dB`
                          : (p.saturated || '—'),
        iter:          Number.isFinite(p.iterations) ? p.iterations : '—'
      }));
      if (azRows.length){
        sections.push({
          id:      'appendix-f-azimuths',
          type:    'table',
          heading: 'Appendix F-1 — Per-azimuth NIF radius',
          preface: 'NIF radius per azimuth and the §73.183 protection relation that binds it ' +
                   '(margin = 20·log10(desired/required), positive = margin above protection).',
          table: {
            columns: [
              { key: 'az',          label: 'Az (°)',         width: 0.10, align: 'right' },
              { key: 'distance_km', label: 'NIF (km)',       width: 0.16, align: 'right' },
              { key: 'lat',         label: 'Lat',            width: 0.16, align: 'right' },
              { key: 'lon',         label: 'Lon',            width: 0.16, align: 'right' },
              { key: 'binding',     label: 'Binding · margin', width: 0.30 },
              { key: 'iter',        label: 'Iter',           width: 0.10, align: 'right' }
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
            columns: [
              { key: 'call',        label: 'Call',     width: 0.12 },
              { key: 'facility_id', label: 'Facility', width: 0.10, align: 'right' },
              { key: 'class',       label: 'Class',    width: 0.08 },
              { key: 'freq_khz',    label: 'kHz',      width: 0.10, align: 'right' },
              { key: 'erp_kw',      label: 'ERP (kW)', width: 0.12, align: 'right' },
              { key: 'distance_km', label: 'Dist (km)', width: 0.14, align: 'right' },
              { key: 'relation',    label: 'Relation', width: 0.22 }
            ],
            rows: intRows
          }
        });
      }
    }
  }

  return sections;
}
