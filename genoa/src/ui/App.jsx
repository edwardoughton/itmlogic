import React, { useEffect, useMemo, useRef, useState } from 'react';
import { stripDomAndReact } from './lib/stripDomAndReact.js';
import { readJsonOrThrow }  from './lib/readJson.js';
import { useStudyMusic }    from './lib/studyMusic.js';
import AppShell      from '@components/ui/AppShell.jsx';
import RackPanel     from '@components/ui/RackPanel.jsx';
import FacilityRack  from '@components/ui/FacilityRack.jsx';
import ServiceHealthPanel from '@components/ui/ServiceHealthPanel.jsx';
import ChartScope    from '@components/ui/ChartScope.jsx';
import TelemetryRack from '@components/ui/TelemetryRack.jsx';
import TabStrip      from '@components/ui/TabStrip.jsx';
import HardwareButton from '@components/ui/HardwareButton.jsx';
import SweepPanel    from '@components/ui/SweepPanel.jsx';
import Login         from '@components/ui/Login.jsx';
import PeCertifyDialog from '@components/ui/PeCertifyDialog.jsx';
import PeSealCard     from '@components/ui/PeSealCard.jsx';
import AmDaDesigner   from '@components/ui/AmDaDesigner.jsx';
import AllotmentSearchPanel from '@components/ui/AllotmentSearchPanel.jsx';
import ComparableFacilitiesPanel from '@components/ui/ComparableFacilitiesPanel.jsx';
import ExhibitDiffPanel from '@components/ui/ExhibitDiffPanel.jsx';
import ShortSpacingShowingPanel from '@components/ui/ShortSpacingShowingPanel.jsx';
import FilingPackagePanel from '@components/ui/FilingPackagePanel.jsx';

/* =========================================================================
   App.jsx — orchestrates inputs, /api/exhibits/compute, /api/facilities/*,
   exports, history, and Leaflet rendering.  Engine is server-side; this
   component never does FCC math.
   ========================================================================= */

// Synthetic preset.  No facility_id — this is intentionally a fake
// engineering test fixture, NOT a real station that could be resolved
// against ZTR.  The orchestrator therefore won't attempt a lookup,
// won't stamp facility_lookup_source='zerotrustradio', and the
// "Resolved via …" UI banner stays empty.
const PRESET_SYNTHETIC = {
  call:'WBOB-FM (synthetic)', facility_id:'', service:'FM', fcc_class:'A',
  frequency:98.7, erp_kw:6.0, haat_m:100,
  lat:37.0902, lon:-95.7129,
  ground_sigma_mS_m: 8,
  radial_step_deg: 10,
  pattern_mode: 'ND',
  _synthetic: true
};

const PRESET_KSLX = {
  call:'KSLX-FM', facility_id:'11282', service:'FM', fcc_class:'C',
  frequency:100.7, erp_kw:100, haat_m:561,
  lat:'', lon:'',
  ground_sigma_mS_m: 8,
  radial_step_deg: 10,
  pattern_mode: 'ND',
  _resolveFacility: true
};

const TABS = [
  { id: 'fcc',        label: 'FCC method' },
  { id: 'radials',    label: 'Radials' },
  { id: 'evidence',   label: 'Evidence' },
  { id: 'validation', label: 'Validation' },
  { id: 'sweep',      label: 'Find best config' },
  { id: 'allotment',  label: 'FM channel search' },
  { id: 'comparables', label: 'Peer benchmarking' },
  { id: 'am_da',      label: 'AM DA designer' },
  { id: 'short_spacing', label: 'Short-spacing showing' },
  { id: 'diff',       label: 'Move-in / what-if diff' },
  { id: 'filing',     label: 'Filing package' },
  { id: 'provenance', label: 'Provenance' },
  { id: 'narrative',  label: 'AI narrative' },
  { id: 'exports',    label: 'Exports' },
  { id: 'history',    label: 'History' }
];

const CONTOUR_COLORS = ['#ffb347', '#d6a36a', '#6fd3ff'];

// Top-level App is just the auth gate.  All the actual workbench logic
// lives in <MainApp/> below so its useState/useEffect hooks aren't
// conditionally mounted (which would violate rules-of-hooks).
export default function App(){
  // null = probing session, true = authed, false = show <Login/>.
  // The session cookie is HttpOnly, so the only way to know auth state
  // is asking the server.  /api/auth/me is the canonical probe.
  const [authed, setAuthed] = useState(null);
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then(r => setAuthed(r.ok))
      .catch(() => setAuthed(false));
  }, []);
  async function logout(){
    try { await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }); }
    catch {}
    setAuthed(false);
  }
  if (authed === null){
    return (
      <div className="min-h-screen flex items-center justify-center bg-black font-mono text-textDim text-[12px] tracking-rack uppercase">
        Checking session…
      </div>
    );
  }
  if (authed === false){
    return <Login onSuccess={() => setAuthed(true)} />;
  }
  return <MainApp onLogout={logout} />;
}

function MainApp({ onLogout }) {
  const [inputs, setInputs] = useState(PRESET_SYNTHETIC);
  const [exhibit, setExhibit] = useState(null);
  const [computing, setComputing] = useState(false);
  const [busy, setBusy]           = useState(false);
  const [renderingPdf, setRenderingPdf] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Ready · click Compute exhibit');
  // Bobby Caldwell — each track plays ONLY while its action is
  // processing.  Stops the moment that action returns.
  //
  //   • Open Your Eyes          — while /api/facilities/:id is
  //                               loading station data (~12-30 s)
  //   • My Flame                — while exhibit compute is running
  //                               (~1:40)
  //   • Down for the Third Time — while PDF / TXT render is running
  //                               (~2-4 min)
  //
  // Phase precedence: pdf > compute > welcome > silence.
  const [muted, setMuted]                       = useState(false);
  const [lookingUpStation, setLookingUpStation] = useState(false);
  const musicPhase = renderingPdf     ? 'pdf'
                   : computing        ? 'compute'
                   : lookingUpStation ? 'welcome'
                   : null;
  const { currentTrack, armed, arm } = useStudyMusic({ phase: musicPhase, muted });
  const [facilitySource, setFacilitySource] = useState('');
  const [activeTab, setActiveTab] = useState('fcc');
  const [history, setHistory]     = useState([]);
  // Station search (call-sign / partial / facility ID).  Driven by the
  // /api/facilities/search endpoint — same upstream as the Lookup
  // button, just a multi-result interactive picker instead of a single
  // facility_id resolve.
  const [stationQuery,    setStationQuery]    = useState('');
  const [stationResults,  setStationResults]  = useState([]);
  const [stationSearching, setStationSearching] = useState(false);
  const [stationError,    setStationError]    = useState('');
  // True when a search has completed at least once for the current
  // query — drives the "no matches" hint in the dropdown.
  const [stationSearched, setStationSearched] = useState(false);
  const stationDebounceRef = useRef(null);
  // PE certification dialog state.  Stamps land on `exhibit.pe_certification`.
  const [peDialogOpen, setPeDialogOpen] = useState(false);

  const onChange = (k, v) => setInputs(s => ({ ...s, [k]: v }));

  /* ---------------- FACILITY LOOKUP ---------------- */

  // Merge an upstream facility row into a base inputs object, only
  // filling fields the caller hasn't already set.  Pure: returns the
  // merged inputs without touching React state.
  function mergeFacility(base, f){
    if (!f) return base;
    const fill = (k, v) => (base[k] === undefined || base[k] === '' || base[k] === null) ? v : base[k];
    return {
      ...base,
      call:         fill('call',         f.call),
      facility_id:  fill('facility_id',  f.facility_id),
      service:      fill('service',      f.service),
      fcc_class:    fill('fcc_class',    f.fcc_class),
      frequency:    fill('frequency',    f.frequency),
      erp_kw:       fill('erp_kw',       f.erp_kw),
      haat_m:       fill('haat_m',       f.haat_m),
      lat:          fill('lat',          f.lat),
      lon:          fill('lon',          f.lon),
      // Pattern is only filled when the upstream row carries it.
      // FCC FMQ (and Radio-Locator-style scrapes) report 'DA' / 'ND' in
      // col 5 of the pipe-delim row; ZTR's broadcast_stations doesn't
      // carry pattern today, so this stays at the user's prior choice
      // when picking a ZTR result.
      pattern_mode: f.pattern_mode ? fill('pattern_mode', f.pattern_mode) : base.pattern_mode
    };
  }

  // Returns { facility, source, cached } on success, null on any
  // failure.  ALSO updates React state + facility-source banner so the
  // form visibly fills.  Callers that need to chain a compute() right
  // after should use the merged inputs returned by mergeFacility (to
  // dodge the React stale-closure on `inputs`).
  async function lookupFacility(id, baseInputs = null){
    if (!id){ setFacilitySource('Enter a Facility ID first.'); return null; }
    setFacilitySource('Looking up…');
    setLookingUpStation(true);     // arms "Open Your Eyes" for the call
    try {
      const r = await fetch(`/api/facilities/${encodeURIComponent(id)}`);
      if (r.status === 503){
        const j = await r.json().catch(() => ({}));
        setFacilitySource(`FACILITY_LOOKUP_UNAVAILABLE — ${j.warning?.detail || 'no upstream configured'}`);
        return null;
      }
      if (r.status === 404){
        setFacilitySource(`Facility ${id} not found in upstream.`);
        return null;
      }
      if (!r.ok){
        const j = await r.json().catch(() => ({}));
        setFacilitySource(`Lookup failed (${r.status}): ${j.message || j.error || ''}`);
        return null;
      }
      const j = await r.json();
      const f = j.facility || {};
      // Apply only to missing fields — never overwrite caller input.
      // Use the functional form so React batched updates compose.
      setInputs(prev => mergeFacility(baseInputs || prev, f));
      const cacheTag = j.cached ? ' (cached)' : '';
      setFacilitySource(`Resolved via ${j.source}${cacheTag}`);
      return { facility: f, source: j.source, cached: j.cached };
    } catch (e){
      setFacilitySource(`Lookup failed: ${e.message}`);
      return null;
    } finally {
      setLookingUpStation(false);  // station data returned → OYE stops
    }
  }

  /* ---------------- COMPUTE ---------------- */

  // `overrideInputs` lets preset loaders pass freshly-merged inputs
  // directly without depending on React state having flushed.
  // Run an async export job: POST → poll every 2 s → return the
  // completed job view.  Throws with the actual job error on failure
  // (no more naked HTTP 504 from the proxy).  onProgress(message) lets
  // the caller stream progress strings into the status line.
  async function runJobAndWait(kind, { input, options } = {}, onProgress){
    const post = await fetch('/api/exhibit/jobs', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ kind, input: input || {}, options: options || {} })
    });
    if (!post.ok){
      const txt = await post.text().catch(() => '');
      throw new Error(`Job submission failed: HTTP ${post.status}${txt ? ' — ' + txt.slice(0, 200) : ''}`);
    }
    const { job_id } = await post.json();
    if (!job_id) throw new Error('Job submission returned no job_id');

    // Continuous progress feedback per operator requirement: "as long
    // as we get periodic updates it's still working".  Even when the
    // server hasn't pushed a new progress_message in a while (slow
    // FCC LMS pull, cold map sidecar, etc.), the elapsed-time ticker
    // shows the user that things are alive and not frozen.  Engine
    // pipelines can run as long as needed — there is no client-side
    // poll-loop deadline.
    const startedAt = Date.now();
    let lastServerMessage = null;
    while (true){
      await new Promise(r => setTimeout(r, 2000));
      const r = await fetch(`/api/exhibit/jobs/${job_id}`);
      if (!r.ok){
        throw new Error(`Job poll failed: HTTP ${r.status}`);
      }
      const view = await r.json();
      if (view.progress_message) lastServerMessage = view.progress_message;
      if (typeof onProgress === 'function'){
        const elapsedS = Math.round((Date.now() - startedAt) / 1000);
        const baseMsg = lastServerMessage || `Working on ${kind.replace(/_/g, ' ')}…`;
        const elapsedTag = elapsedS < 60
          ? `${elapsedS} s elapsed`
          : `${Math.floor(elapsedS / 60)} m ${elapsedS % 60} s elapsed`;
        onProgress(`${baseMsg}  ·  ${elapsedTag}`);
      }
      if (view.status === 'complete') return view;
      if (view.status === 'failed'){
        const e = view.error || {};
        throw new Error(e.message || e.code || 'Job failed');
      }
    }
  }

  async function compute(overrideInputs = null){
    // Defense: a careless `onClick={compute}` would pass a React
    // SyntheticEvent here.  The wrapper bindings below already shield
    // against that, but if any future callsite regresses we drop the
    // event here so it cannot land in the payload.
    if (overrideInputs && typeof overrideInputs === 'object'
        && (overrideInputs.nativeEvent || overrideInputs.currentTarget || overrideInputs.target || overrideInputs._reactName)){
      overrideInputs = null;
    }
    const i = overrideInputs || inputs;
    setComputing(true);
    setStatusMsg('Computing exhibit…');
    try {
      const payload = {
        inputs: {
          ...i,
          // Drop UI-only flags before sending to the API.
          _synthetic:       undefined,
          _resolveFacility: undefined,
          // Re-cast string inputs to numbers where the engine expects them.
          frequency:         num(i.frequency),
          erp_kw:            num(i.erp_kw),
          haat_m:            num(i.haat_m),
          lat:               num(i.lat),
          lon:               num(i.lon),
          ground_sigma_mS_m: num(i.ground_sigma_mS_m),
          radial_step_deg:   num(i.radial_step_deg) || 10,
          // Pass DA pattern only when the user toggled it on.
          pattern_table: i.pattern_mode === 'DA' ? i.pattern_table : null
        },
        options: {
          use_terrain: !!i.use_terrain,
          use_itm:     !!i.use_itm
        }
      };
      // Belt-and-suspenders: strip any DOM/React refs that could have
      // snuck into the payload (would crash JSON.stringify with
      // "Converting circular structure to JSON ... HTMLButtonElement").
      const cleanPayload = stripDomAndReact(payload);

      // Async job — the proxy used to 504 here when DEM fetch ran cold.
      const view = await runJobAndWait(
        'exhibit',
        { input: cleanPayload.inputs, options: cleanPayload.options },
        (msg) => setStatusMsg(msg)
      );
      const j = view.result?.exhibit;
      if (!j) throw new Error('Job completed without exhibit payload');
      setExhibit(j);
      const fr = j.filing_readiness || {};
      setStatusMsg(j.degraded_mode
        ? `Computed in degraded mode · ${fr.score}/100 (${fr.status}) · ${j.warnings.length} warning(s), ${j.blockers.length} blocker(s).`
        : `Computed cleanly · ${fr.score}/100 (${fr.status}).`);
    } catch (e){
      setStatusMsg(`Compute failed: ${e.message}`);
    } finally { setComputing(false); }
  }

  /* ---------------- PRESETS ---------------- */

  // Load KSLX-FM, resolve via ZTR, compute against the resolved row.
  // We thread the merged inputs through compute() to dodge React's
  // stale-closure on `inputs` — setInputs queues a render but compute
  // would otherwise still see the previous state.
  async function loadKslx(){
    setInputs(PRESET_KSLX);
    setFacilitySource('Looking up KSLX-FM (facility 11282)…');
    let merged = PRESET_KSLX;
    if (PRESET_KSLX._resolveFacility){
      const r = await lookupFacility(PRESET_KSLX.facility_id, PRESET_KSLX);
      if (r?.facility){
        merged = mergeFacility(PRESET_KSLX, r.facility);
        setInputs(merged);
      }
    }
    // Thread the merged inputs into compute() directly so the request
    // body matches what the user just loaded — no React render delay.
    await compute(merged);
  }

  /* ---------------- STATION SEARCH ---------------- */

  // Debounced search against /api/facilities/search.  Returns up to 10
  // matches.  No business logic in the UI — just hit the endpoint and
  // render the rows.
  async function searchStations(q){
    const qs = String(q || '').trim();
    if (qs.length < 2){
      setStationResults([]); setStationError(''); setStationSearched(false);
      return;
    }
    setStationSearching(true);
    setStationError('');
    setStationSearched(false);
    try {
      const r = await fetch(`/api/facilities/search?q=${encodeURIComponent(qs)}&limit=10`);
      if (r.status === 503){
        const j = await r.json().catch(() => ({}));
        setStationError(j.warning?.detail || 'facility lookup unavailable');
        setStationResults([]);
        return;
      }
      if (!r.ok){
        setStationError(`Search failed (${r.status})`);
        setStationResults([]);
        return;
      }
      const j = await r.json();
      setStationResults(j.rows || []);
      setStationSearched(true);
    } catch (e){
      setStationError(`Search failed: ${e.message}`);
      setStationResults([]);
    } finally {
      setStationSearching(false);
    }
  }

  function onStationQueryChange(q){
    setStationQuery(q);
    setStationSearched(false);
    if (stationDebounceRef.current) clearTimeout(stationDebounceRef.current);
    stationDebounceRef.current = setTimeout(() => searchStations(q), 250);
  }

  // Click handler for a station search result.  Fills inputs from the
  // row, clears the search, then computes — same threading trick as
  // loadKslx so the compute body matches what just got loaded.
  async function loadStationRow(row){
    if (!row) return;
    // Build a clean base where every FCC-sourced field is empty so
    // mergeFacility's "fill if empty" actually fills from the row.
    // Operator-only UI choices (radial step, terrain toggle) carry
    // forward; engineering inputs (call/service/freq/erp/haat/lat/lon/
    // class/pattern) are reset.  Without this reset, picking a new
    // station leaves the previous lat/lon, ERP, HAAT, etc. visible
    // because mergeFacility is conservative ("fill if empty").
    const base = {
      ...PRESET_SYNTHETIC,
      _synthetic: false,
      radial_step_deg: inputs.radial_step_deg || 10,
      use_terrain:     !!inputs.use_terrain,
      use_itm:         !!inputs.use_itm,
      // Engineering fields — reset so the row's values show through.
      lat: '', lon: '',
      facility_id: '', call: '',
      service:    '', fcc_class: '',
      frequency:  '', erp_kw: '', haat_m: '',
      pattern_mode: ''                      // mergeFacility falls back to
                                            // base when row.pattern_mode is null
    };
    const merged = mergeFacility(base, row);
    // mergeFacility leaves pattern_mode='' (from base) when the row
    // doesn't carry pattern (e.g. ZTR rows) — coerce that to 'ND' so
    // the dropdown shows a sensible default.
    if (!merged.pattern_mode) merged.pattern_mode = 'ND';
    setInputs(merged);
    setFacilitySource(`Loaded ${row.call || row.facility_id || 'station'} via ${row.facility_lookup_source?.upstream || 'upstream'}`);
    setStationQuery('');
    setStationResults([]);
    // Refresh the canonical /api/facilities/:id row in the background
    // so the "Open Your Eyes" station-loading phase has a real
    // processing window (~12-30 s).  Without this the dropdown-pick
    // path skips straight to compute and OYE never gets a chance to
    // play.  The lookup also enriches fields the search-row may not
    // carry (canonical call, fcc_class, licensee, etc.).
    let refreshed = merged;
    if (merged.facility_id){
      const r = await lookupFacility(merged.facility_id, merged);
      if (r?.facility) refreshed = mergeFacility(merged, r.facility);
    }
    await compute(refreshed);
  }
  function loadSynthetic(){
    setInputs(PRESET_SYNTHETIC);
    setFacilitySource('');
    // Synthetic carries no facility_id; fine to compute via state.
    setTimeout(() => compute(PRESET_SYNTHETIC), 0);
  }
  function reset(){
    setInputs(PRESET_SYNTHETIC);
    setExhibit(null);
    setFacilitySource('');
    setStatusMsg('Reset.');
  }

  /* ---------------- SAVE / EXPORT ---------------- */

  async function save(){
    if (!exhibit){ setStatusMsg('Run a compute first.'); return; }
    setBusy(true);
    const cleanedExhibit = stripDomAndReact(exhibit);
    const body = JSON.stringify(cleanedExhibit);

    // Try the persisted-save endpoint first.  When persistence is
    // unavailable (no DATABASE_URL on the deploy, App Platform error
    // page, proxy 502 → HTML body), fall back to /api/exhibits/save
    // (ephemeral; never crashes on missing DB), then to a local file
    // download — never let the UI surface a JSON-parse crash.
    const tryPost = async (url) => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body
      });
      // readJsonOrThrow surfaces HTML / non-JSON / non-2xx as a
      // structured Error instead of crashing inside response.json().
      return readJsonOrThrow(r);
    };

    try {
      try {
        const j = await tryPost('/api/exhibits');
        setExhibit(prev => ({ ...prev, id: j.id }));
        setStatusMsg(`Saved exhibit #${j.id}`);
        return;
      } catch (e){ console.warn('[save] persistent save failed:', e.message); }

      try {
        const j = await tryPost('/api/exhibits/save');
        const tag = j.id ? `exhibit #${j.id}` : (j.mode === 'ephemeral' ? 'ephemeral session' : 'session');
        setStatusMsg(`Save unavailable on server — held in ${tag}.  Use JSON / TXT / GeoJSON to export locally.`);
        if (j.id) setExhibit(prev => ({ ...prev, id: j.id }));
        return;
      } catch (e){ console.warn('[save] ephemeral save failed:', e.message); }

      // Final fallback: synthesize a downloadable JSON file in-browser.
      const blob = new Blob([JSON.stringify(cleanedExhibit, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(cleanedExhibit.station_inputs?.call || 'exhibit').replace(/[^A-Z0-9]/gi,'_')}_genoa_exhibit.json`;
      a.click();
      setStatusMsg('Save unavailable on server — exhibit downloaded locally as JSON.');
    } catch (e){
      setStatusMsg(`Save failed: ${e.message}`);
    } finally { setBusy(false); }
  }

  function downloadExport(format){
    if (!exhibit){ setStatusMsg('Run a compute first.'); return; }
    if (format === 'engineering-txt' || format === 'engineering-pdf'){
      const ext = format === 'engineering-txt' ? 'txt' : 'pdf';
      statelessEngineeringReportDownload(exhibit, ext).catch(e =>
        setStatusMsg(`Engineering Statement export failed: ${e.message || e}`));
      return;
    }
    if (!exhibit.id){
      // stateless mode: synthesize JSON / GeoJSON in-browser; PDF needs
      // server-side rendering, so POST the exhibit to the stateless
      // /api/exhibits/export/pdf route which returns the PDF body.
      const map = {
        json:    () => [JSON.stringify(exhibit, null, 2),         'application/json',     'exhibit.json'],
        geojson: () => [JSON.stringify(exhibit.geojson, null, 2), 'application/geo+json', 'contours.geojson']
      };
      if (format === 'pdf'){
        statelessPdfDownload(exhibit).catch(e =>
          setStatusMsg(`PDF export failed: ${e.message || e}`));
        return;
      }
      const fn = map[format];
      if (!fn){ setStatusMsg('TXT export requires a saved exhibit; click Save first.'); return; }
      const [body, type, suffix] = fn();
      const blob = new Blob([body], { type });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${(exhibit.station_inputs?.call || 'exhibit').replace(/[^A-Z0-9]/gi,'_')}_${suffix}`;
      a.click();
      return;
    }
    window.location = `/api/exhibits/${exhibit.id}/export/${format}`;
  }

  async function statelessEngineeringReportDownload(ex, ext){
    const kind = ext === 'pdf' ? 'engineering_report_pdf' : 'engineering_report_txt';
    setStatusMsg(`Submitting Engineering Statement ${ext.toUpperCase()} job…`);
    setRenderingPdf(true);
    const cleaned = stripDomAndReact(ex);
    try {
      const view = await runJobAndWait(
        kind,
        { input: { exhibit: cleaned } },
        (msg) => setStatusMsg(msg)
      );
    if (!view.artifact_url) throw new Error('Job completed without artifact');
    setStatusMsg(`Downloading ${ext.toUpperCase()} artifact…`);
    // Per the operator's standing rule: each downstream step's clock
    // starts only after upstream actually finishes; correctness over
    // latency.  The artifact-retry clock starts AFTER the job poll
    // saw status='complete'.  We retry on 409 / 404 with backoff up to
    // ~7 minutes total — the artifact upload can sit behind a slow
    // disk write on a cold container, behind a finalising Chromium
    // render in the map sidecar, etc.  Showing per-attempt elapsed
    // time keeps the operator oriented while they wait.
    const ARTIFACT_RETRY_BACKOFF_MS = [
      1000, 2000, 3000, 5000, 7000, 10000, 15000, 20000,
      30000, 30000, 30000, 30000, 60000, 60000, 60000, 60000
    ];
    const retryStartedAt = Date.now();
    let ar = null;
    for (let attempt = 0; attempt <= ARTIFACT_RETRY_BACKOFF_MS.length; attempt++){
      ar = await fetch(view.artifact_url);
      if (ar.ok) break;
      if (ar.status !== 409 && ar.status !== 404){
        const txt = await ar.text().catch(() => '');
        throw new Error(`Artifact fetch failed: HTTP ${ar.status}${txt ? ' — ' + txt.slice(0, 120) : ''}`);
      }
      if (attempt === ARTIFACT_RETRY_BACKOFF_MS.length){
        // Out of retries.  Surface the latest body so the engineer can
        // see what state the job is stuck in.
        const txt = await ar.text().catch(() => '');
        throw new Error(`Artifact still not ready after ~7 min of retries.  Last response: HTTP ${ar.status}${txt ? ' — ' + txt.slice(0, 120) : ''}`);
      }
      const delay = ARTIFACT_RETRY_BACKOFF_MS[attempt];
      const waitedS = Math.round((Date.now() - retryStartedAt) / 1000);
      const waitedTag = waitedS < 60
        ? `${waitedS} s waited`
        : `${Math.floor(waitedS / 60)} m ${waitedS % 60} s waited`;
      setStatusMsg(`Artifact not ready yet (HTTP ${ar.status}) · ${waitedTag} · retrying in ${Math.round(delay / 1000)} s…`);
      await new Promise(r => setTimeout(r, delay));
    }
    const blob = await ar.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const call = (ex.station_inputs?.call || 'exhibit').replace(/[^A-Z0-9]/gi,'_');
    const ts   = new Date().toISOString().slice(0, 10);
    a.download = `genoa-engineering-statement-${call}-${ts}.${ext}`;
    a.click();
    setStatusMsg(`Engineering Statement ${ext.toUpperCase()} downloaded.`);
    } finally {
      setRenderingPdf(false);
    }
  }

  async function statelessPdfDownload(ex){
    setStatusMsg('Rendering PDF…');
    const cleaned = stripDomAndReact(ex);
    const r = await fetch('/api/exhibits/export/pdf', {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ exhibit: cleaned })
    });
    if (!r.ok){
      const txt = await r.text().catch(() => '');
      throw new Error(`HTTP ${r.status}${txt ? ' — ' + txt.slice(0, 120) : ''}`);
    }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(ex.station_inputs?.call || 'exhibit').replace(/[^A-Z0-9]/gi,'_')}_exhibit.pdf`;
    a.click();
    setStatusMsg('PDF downloaded.');
  }

  /* ---------------- HISTORY ---------------- */

  async function loadHistory(){
    try {
      const r = await fetch('/api/exhibits');
      if (!r.ok){ setHistory([]); return; }
      const rows = await readJsonOrThrow(r);
      setHistory(Array.isArray(rows) ? rows : []);
    } catch { setHistory([]); }
  }
  useEffect(() => {
    if (activeTab === 'history') loadHistory();
  }, [activeTab]);

  /* ---------------- LEAFLET MAP ---------------- */
  const mapEl   = useRef(null);
  const mapRef  = useRef({ map: null, layers: [], txMarker: null });
  useEffect(() => { return () => { try { mapRef.current.map?.remove(); } catch {} }; }, []);
  useEffect(() => {
    if (!exhibit) return;
    if (typeof window.L === 'undefined') return;
    const s = exhibit.station_inputs || {};
    const lat = Number(s.lat);
    const lon = Number(s.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const L = window.L;
    if (!mapRef.current.map){
      mapRef.current.map = L.map(mapEl.current, { zoomControl: true, attributionControl: true })
        .setView([lat, lon], 8);
      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap · © CARTO · DEM via SPLAT/itmlogic'
      }).addTo(mapRef.current.map);
    }
    const map = mapRef.current.map;

    // clear previous polygons + tx marker
    for (const l of mapRef.current.layers) map.removeLayer(l);
    mapRef.current.layers = [];
    if (mapRef.current.txMarker) map.removeLayer(mapRef.current.txMarker);

    mapRef.current.txMarker = L.circleMarker([lat, lon], {
      radius: 6, color: '#ffb347', weight: 2, fillColor: '#ff7a2f', fillOpacity: 0.95
    }).bindPopup(`<b>${escapeHtml(s.call || '—')}</b><br/>${escapeHtml(s.service || '')} · ${s.frequency ?? '—'} ${escapeHtml(s.frequency_unit || '')}<br/>ERP ${s.erp_kw ?? '—'} kW · HAAT ${s.haat_m_input ?? '—'} m`).addTo(map);

    const polys = (exhibit.polygons || []).filter(p => p.closed && p.ring_latlng?.length);
    polys.forEach((p, i) => {
      const color = CONTOUR_COLORS[i] || '#9fdcb1';
      const layer = L.polygon(p.ring_latlng, {
        color, weight: i === 0 ? 2.5 : 1.5, opacity: 0.92,
        fillColor: color, fillOpacity: i === 0 ? 0.14 : 0.06,
        dashArray: i > 0 ? '4,5' : null
      }).bindPopup(`<b>${escapeHtml(p.label || '')}</b><br/>${p.field_strength?.value ?? '—'} ${escapeHtml(p.field_strength?.unit || '')}<br/>mean radial ${(p.mean_radial_km || 0).toFixed(1)} km`);
      layer.addTo(map);
      mapRef.current.layers.push(layer);
    });
    // ITM terrain-aware coverage as a supplementary contour (cyan dashed
    // ring).  §73.333 polygons stay the compliance reference; this layer
    // visualises §73.314 evidence for how actual coverage shapes around
    // terrain.  Hidden when no ITM evidence is attached.
    const itmPolys = (exhibit.itm_polygons || []).filter(p => p.closed && p.ring_latlng?.length);
    itmPolys.forEach((p) => {
      const layer = L.polygon(p.ring_latlng, {
        color:       '#6fd3ff',
        weight:      2.0,
        opacity:     0.85,
        fillColor:   '#6fd3ff',
        fillOpacity: 0.05,
        dashArray:   '6,4'
      }).bindPopup(
        `<b>${escapeHtml(p.label || 'ITM coverage')}</b><br/>` +
        `terrain mean radial ${p.mean_radial_km != null ? p.mean_radial_km.toFixed(1) : '—'} km<br/>` +
        `§73.333 mean ${p.fcc_mean_km != null ? p.fcc_mean_km.toFixed(1) : '—'} km<br/>` +
        `Δ ${p.delta_mean_km != null ? (p.delta_mean_km >= 0 ? '+' : '') + p.delta_mean_km.toFixed(1) : '—'} km` +
        (p.n_blocked_radials ? `<br/>${p.n_blocked_radials} blocked radial(s)` : '') +
        (p.engine ? `<br/><i>${escapeHtml(p.engine)}${p.tier ? ' · ' + escapeHtml(p.tier) : ''}</i>` : '')
      );
      layer.addTo(map);
      mapRef.current.layers.push(layer);
    });
    const allPts = [...polys, ...itmPolys].flatMap(p => p.ring_latlng || []);
    if (allPts.length) map.fitBounds(L.latLngBounds(allPts).pad(0.15));
    map.invalidateSize();
  }, [exhibit]);

  /* ---------------- RENDER ---------------- */

  const fr        = exhibit?.filing_readiness;
  const sysStatus = !exhibit ? 'offline'
                  : (exhibit.blockers?.length ? 'blocked'
                  : (exhibit.degraded_mode    ? 'degraded' : 'nominal'));

  const legend = [
    ...(exhibit?.polygons || []).map((p, i) => ({
      color: CONTOUR_COLORS[i] || '#9fdcb1',
      label: p.label
    })),
    ...((exhibit?.itm_polygons || []).filter(p => p.closed).map(p => ({
      color: '#6fd3ff',
      label: `${p.label}${p.delta_mean_km != null ? `  (Δ ${p.delta_mean_km >= 0 ? '+' : ''}${p.delta_mean_km.toFixed(1)} km)` : ''}`,
      dashed: true
    })))
  ];

  const mapCaption = (() => {
    const s = exhibit?.station_inputs;
    if (!s) return 'Compute an exhibit to project contours.';
    if (s.lat == null || s.lon == null){
      return 'Map unavailable — facility coordinates missing. Radial table is still computed; see the Radials tab.';
    }
    return 'Deterministic FCC contour map. Contour fills warm → cool from city grade to protected.';
  })();

  return (
    <>
    <button
      onClick={onLogout}
      title="Sign out"
      className="fixed top-3 right-4 z-40 font-mono text-[10px] tracking-rack uppercase text-textDim hover:text-cream border border-rule hover:border-gold/50 rounded px-2.5 py-1 bg-black/60 backdrop-blur-sm transition-colors"
    >
      Sign&nbsp;out
    </button>
    <div
      className="fixed top-3 right-28 z-40 flex items-center gap-2 font-mono text-[10px] tracking-rack uppercase text-textDim border border-rule rounded px-2.5 py-1 bg-black/60 backdrop-blur-sm"
      title={currentTrack
        ? `Now playing: "${currentTrack.title}" — ${currentTrack.artist}`
        : 'Bobby Caldwell — music plays during compute / PDF render'}
    >
      <button
        onClick={() => { arm(); setMuted(m => !m); }}
        className="hover:text-cream"
        title={muted ? 'Unmute' : 'Mute'}
      >
        {muted ? '🔇' : '♪'}
      </button>
      <span className="text-cream/80 normal-case tracking-normal">
        {!armed
          ? <span className="text-textDim">click ♪ to arm music</span>
          : currentTrack
            ? <>“{currentTrack.title}” — {currentTrack.artist}</>
            : <span className="text-textDim">idle</span>}
      </span>
    </div>
    <AppShell
      systemStatus={sysStatus}
      mode={exhibit?.calculation_method?.name || '47 CFR §73.333 F(50,50)'}
      engineVersion={`genoa-engine v${exhibit?.engine_signature?.version || '2.0.0'}`}
      readinessScore={fr?.score ?? null}
      readinessStatus={fr?.status || null}
      commitSha={exhibit?.engine_signature?.hash || 'uncommitted'}
      left={(<>
        <FacilityRack
          inputs={inputs}
          onChange={onChange}
          // Wrap every callback so React's SyntheticEvent never lands
          // as the first argument of compute/save/etc — it would be
          // mistaken for an `overrideInputs` object and crash
          // JSON.stringify on circular DOM refs (target/currentTarget/
          // nativeEvent/_react*).  The sanitizer in compute() is a
          // belt-and-suspenders defense; this is the seatbelt.
          onCompute={() => compute()}
          onReset={() => reset()}
          onSave={() => save()}
          onExport={(format) => downloadExport(format)}
          onLookupFid={() => lookupFacility(inputs.facility_id)}
          onLoadKslx={() => loadKslx()}
          onLoadSynthetic={() => loadSynthetic()}
          facilitySource={facilitySource}
          stationQuery={stationQuery}
          stationResults={stationResults}
          stationSearching={stationSearching}
          stationSearched={stationSearched}
          stationError={stationError}
          onStationQueryChange={onStationQueryChange}
          onStationPick={loadStationRow}
          computing={computing}
          busy={busy}
        />
        <ServiceHealthPanel />
      </>)}
      center={(
        <>
          <ChartScope
            mode={exhibit?.calculation_method?.name || '47 CFR §73.333 F(50,50)'}
            status={statusMsg}
            caption={mapCaption}
            legend={legend}
          >
            <div ref={mapEl} className="absolute inset-0 rounded-md" />
          </ChartScope>

          <RackPanel eyebrow="Workbench" title="Exhibit detail" italicAccent="The numbers come from the engine.">
            <TabStrip tabs={TABS} activeId={activeTab} onChange={setActiveTab} />
            <div className="pt-4">
              <TabBody
                id={activeTab}
                exhibit={exhibit}
                history={history}
                onPickHistory={pickHistory}
                getBaseInputs={() => sanitizeBaseInputs(inputs)}
                inputs={inputs}
                onApplyCombo={(combo) => setInputs(s => ({
                  ...s,
                  erp_kw: combo.erp_kw,
                  haat_m: combo.haat_m,
                  ...(combo.pattern_table ? { pattern_mode: 'DA', pattern_table: combo.pattern_table } : {})
                }))}
                onApplyAmDaPattern={(pattern_table) => setInputs(s => ({
                  ...s,
                  pattern_mode:  'DA',
                  pattern_table
                }))}
              />
            </div>
          </RackPanel>
        </>
      )}
      right={(
        <>
          <PeSealCard
            exhibit={exhibit}
            onCertify={() => setPeDialogOpen(true)}
            onClear={() => setExhibit(prev => prev ? { ...prev, pe_certification: undefined } : prev)}
          />
          <TelemetryRack exhibit={exhibit} />
        </>
      )}
    />
    {peDialogOpen ? (
      <PeCertifyDialog
        exhibit={exhibit}
        onClose={() => setPeDialogOpen(false)}
        onSealed={(sealed) => setExhibit(sealed)}
      />
    ) : null}
    </>
  );

  async function pickHistory(id){
    try {
      const r = await fetch(`/api/exhibits/${id}`);
      const x = await readJsonOrThrow(r);
      setExhibit(x.payload);
      const s = x.payload.station_inputs || {};
      setInputs(prev => ({ ...prev, ...s, pattern_mode: Array.isArray(s.pattern) ? 'DA' : 'ND' }));
      setStatusMsg(`Loaded exhibit #${id}`);
    } catch (e){ setStatusMsg(`Load failed: ${e.message}`); }
  }
}

/* ---------------- Tab body content ---------------- */

function TabBody({ id, exhibit, history, onPickHistory, getBaseInputs, inputs, onApplyCombo, onApplyAmDaPattern }){
  if (id === 'fcc'){
    return <PaneFcc exhibit={exhibit} />;
  }
  if (id === 'radials'){
    return <PaneRadials exhibit={exhibit} />;
  }
  if (id === 'evidence'){
    return <PaneEvidence exhibit={exhibit} />;
  }
  if (id === 'validation'){
    return <PaneValidation exhibit={exhibit} />;
  }
  if (id === 'sweep'){
    return <SweepPanel getBaseInputs={getBaseInputs} onApplyCombo={onApplyCombo} />;
  }
  if (id === 'am_da'){
    return <AmDaDesigner baseInputs={inputs} onApplyPattern={onApplyAmDaPattern} />;
  }
  if (id === 'allotment'){
    return <AllotmentSearchPanel baseInputs={inputs} onPickChannel={(ch) => {
      // Picking a channel pushes its frequency into the FacilityRack
      // so the operator can re-compute the exhibit on the new
      // allotment without re-typing.  FM is always in MHz.
      onApplyCombo?.({ frequency: ch.frequency_mhz });
    }} />;
  }
  if (id === 'comparables'){
    return <ComparableFacilitiesPanel baseInputs={inputs} />;
  }
  if (id === 'short_spacing'){
    return <ShortSpacingShowingPanel exhibit={exhibit} />;
  }
  if (id === 'diff'){
    return <ExhibitDiffPanel afterExhibit={exhibit} history={history} />;
  }
  if (id === 'filing'){
    return <FilingPackagePanel exhibit={exhibit} />;
  }
  if (id === 'narrative'){
    return <PaneNarrative exhibit={exhibit} />;
  }
  if (id === 'provenance'){
    return <PaneProvenance exhibit={exhibit} />;
  }
  if (id === 'exports'){
    return <PaneExports exhibit={exhibit} />;
  }
  if (id === 'history'){
    return <PaneHistory rows={history} onPick={onPickHistory} />;
  }
  return null;
}

function PaneFcc({ exhibit }){
  if (!exhibit) return <Empty/>;
  const s   = exhibit.station_inputs || {};
  const m   = exhibit.calculation_method || {};
  const ip  = exhibit.interpolation || {};
  const tr  = exhibit.calculation_trace || {};
  const trS = tr[Object.keys(tr)[0]] || {};
  const rows = [
    ['Method',          m.name],
    ['Regulations',     (m.regulations || []).join(', ')],
    ['Engine module',   m.engine_module],
    ['Engine version', m.engine_version],
    ['Interp · field',  ip.along_field],
    ['Interp · HAAT',   ip.along_haat],
    ['Curve dataset',   trS.dataset],
    ['Curve meta',      (trS.dataset_meta_sha256 || '').slice(0,12) + '…'],
    ['Pattern factor',  trS.pattern_factor_applied ? 'applied' : 'non-directional'],
    ['Formula',         trS.formula_summary]
  ];
  const isr = exhibit.interference_study;
  return (
    <div className="space-y-3">
      <table className="telemetry">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th className="w-[35%]">{k}</th>
              <td className="text-right text-cream">{v || <span className="text-textDim">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {isr ? <InterferenceStudyTable study={isr} /> : null}
    </div>
  );
}

function InterferenceStudyTable({ study }){
  const stations = study.stations || [];
  return (
    <div className="rounded-md border border-rule">
      <div className="bg-cream/5 px-3 py-2 font-mono text-[11px]">
        <div className="text-cream">
          Interference Study — {(study.rules_evaluated || []).join(' · ')}
        </div>
        <div className="text-textDim">
          {study.n_stations} station(s); {study.n_pass} pass / {study.n_fail} fail ·{' '}
          filing_qualifies =
          <span className={
            study.filing_qualifies === true  ? ' text-green'  :
            study.filing_qualifies === false ? ' text-red'    : ' text-amber'}>
            {' '}{String(study.filing_qualifies)}
          </span>
          {study.blocking_rule ? <span className="text-amber"> · blocked by {study.blocking_rule}</span> : null}
        </div>
      </div>
      {stations.length === 0
        ? <div className="px-3 py-3 font-mono text-[11px] text-textDim">No nearby stations evaluated (no nearby_primaries attached).</div>
        : (
          <div className="overflow-auto max-h-[420px]">
            <table className="telemetry">
              <thead>
                <tr>
                  <th>Call</th>
                  <th>Class</th>
                  <th>Δf kHz</th>
                  <th>Rel.</th>
                  <th className="text-right">Dist km</th>
                  <th className="text-right">§73.207 req</th>
                  <th className="text-right">§73.215 D/U</th>
                  <th>Polygon</th>
                  <th>Pass</th>
                  <th>Via</th>
                </tr>
              </thead>
              <tbody>
                {stations.map((s, i) => {
                  const r207 = s.rules.section_73_207;
                  const r215 = s.rules.section_73_215;
                  const r1204 = s.rules.section_74_1204;
                  const r187  = s.rules.section_73_187;
                  const polygon = r215
                    ? (r215.polygon_pass === true  ? 'no overlap'
                       : r215.polygon_pass === false ? 'OVERLAP' : '—')
                    : '—';
                  return (
                    <tr key={s.facility_id || s.call || i}
                        className={s.pass_overall === false ? 'bg-red/10' : undefined}>
                      <td>{s.call || s.facility_id || '—'}</td>
                      <td>{s.fcc_class || '—'}</td>
                      <td className="text-right">{s.frequency_offset_khz ?? '—'}</td>
                      <td>{s.channel_relationship || '—'}</td>
                      <td className="text-right">{s.distance_km != null ? s.distance_km.toFixed(2) : '—'}</td>
                      <td className="text-right">
                        {r207
                          ? <span className={r207.pass === true ? 'text-green' : r207.pass === false ? 'text-red' : ''}>
                              {r207.required_separation_km}/{r207.actual_separation_km}
                            </span>
                          : '—'}
                      </td>
                      <td className="text-right">
                        {r215 && r215.du_required_db != null
                          ? <span className={r215.du_pass === true ? 'text-green' : r215.du_pass === false ? 'text-red' : ''}>
                              {r215.du_required_db}/{r215.du_actual_db_forward?.toFixed?.(1) ?? '—'}
                            </span>
                          : r1204 || r187 ? '—'
                          : '—'}
                      </td>
                      <td className={polygon === 'OVERLAP' ? 'text-red' : polygon === 'no overlap' ? 'text-green' : ''}>{polygon}</td>
                      <td className={
                        s.pass_overall === true  ? 'text-green' :
                        s.pass_overall === false ? 'text-red'   : 'text-amber'
                      }>{s.pass_overall === true ? 'PASS' : s.pass_overall === false ? 'FAIL' : '—'}</td>
                      <td className="text-textDim">{(s.qualified_via || []).join(', ')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      <div className="px-3 py-2 font-mono text-[10px] text-textDim border-t border-rule">
        Distance per §73.208 (great-circle, WGS-84 Karney). Polygon overlap via Sutherland-Hodgman + Karney WGS-84 PolygonArea.
        A station qualifies if AT LEAST ONE applicable rule passes (e.g., §73.215 contour protection clears a §73.207 short-spacing).
      </div>
    </div>
  );
}

function PaneRadials({ exhibit }){
  const rt   = exhibit?.radial_table || [];
  const cdef = exhibit?.contour_definitions || [];
  if (!rt.length) return <Empty/>;
  const t = exhibit?.evidence?.terrain;
  const haatBadge = t?.available
    ? <span className="text-green">per-radial · {t.method} · {t.dem?.source} {t.dem?.dataset}</span>
    : <span className="text-amber">flat HAAT (CONSTANT_HAAT_ASSUMED) — toggle "Request per-radial §73.313 HAAT" to use ZTR terrain</span>;
  return (
    <>
      <div className="font-mono text-[11px] mb-2">{haatBadge}</div>
      <div className="overflow-auto max-h-[520px] rounded-md border border-rule">
        <table className="telemetry">
          <thead>
            <tr>
              <th>Az (°)</th><th>F·rel</th><th>HAAT (m)</th><th>Source</th>
              {cdef.map(c => <th key={c.id}>{c.label || c.id}</th>)}
            </tr>
          </thead>
          <tbody>
            {rt.map((r, i) => (
              <tr key={i}>
                <td className="text-cream">{Number(r.azimuth_deg).toFixed(1)}</td>
                <td>{Number(r.relative_field).toFixed(3)}</td>
                <td>{r.haat_computed_m ?? r.haat_input_m ?? '—'}</td>
                <td className="text-textDim">{r.haat_source || '—'}</td>
                {cdef.map(c => (
                  <td key={c.id} className="text-right">
                    {r.contour_distances_km?.[c.id] != null
                      ? Number(r.contour_distances_km[c.id]).toFixed(2)
                      : '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PaneEvidence({ exhibit }){
  if (!exhibit) return <Empty/>;
  const ev  = exhibit.evidence || {};
  const pop = exhibit.population_estimate || {};
  return (
    <div className="space-y-3">
      <SubHead title="Terrain" />
      <SubKv kv={ev.terrain?.available
        ? [
            ['Source',     ev.terrain.source],
            ['Endpoint',   ev.terrain.endpoint || '—'],
            ['Method',     ev.terrain.method],
            ['DEM',        `${ev.terrain.dem?.source || '—'} ${ev.terrain.dem?.dataset || ''}`.trim()],
            ['Profiles',   (ev.terrain.profiles || []).length + ' radials'],
            ['Fetched at', ev.terrain.fetched_at || '—']
          ]
        : [['Status', 'No terrain evidence attached. Engine ran with flat HAAT (or n/a for AM).']]} />
      <SubHead title="Population (INFORMATIONAL ONLY — not used for §73.x compliance)" />
      <SubKv kv={pop.source && pop.vintage
        ? [
            ['Disclaimer', 'INFORMATIONAL ONLY. FCC §73.x compliance is determined by distance and field-strength tests, not population.'],
            ['Persons',    Number(pop.primary).toLocaleString()],
            ['Contour',    pop.contour_label || '—'],
            ['Source',     pop.source],
            ['Dataset',    pop.dataset || '—'],
            ['Vintage',    String(pop.vintage)],
            ['Method',     pop.method || '—'],
            ['Endpoint',   pop.endpoint || '—'],
            ['Fetched at', pop.fetched_at || '—']
          ]
        : pop.attempt_status === 'failed'
          ? [
              ['Status',   'Census API call failed — placeholder retained'],
              ['Error',    pop.attempt_error || '—'],
              ['Endpoint', pop.attempt_endpoint || '—']
            ]
          : [['Status', 'Placeholder — real Census data will populate once an exhibit is computed with lat/lon coordinates.']]} />
      <SubHead title="Measurements (SDR captures via ZTR)" />
      <SubKv kv={ev.measurements?.available
        ? [
            ['Source',     ev.measurements.source || '—'],
            ['Endpoint',   ev.measurements.endpoint || '—'],
            ['Records',    ev.measurements.n_records ?? (ev.measurements.records || []).length],
            ['Calibrated', ev.measurements.calibrated
              ? 'yes'
              : 'no — raw indications only (SDR_MEASUREMENTS_NOT_CALIBRATED)'],
            ['Fetched at', ev.measurements.fetched_at || '—']
          ]
        : [['Status', 'No SDR / measurement records attached. Either no captures exist for this station in ZTR, or the rich-station endpoint was unreachable.']]} />
      {ev.measurements?.available && (ev.measurements.records || []).length > 0 && (
        <CaptureTable records={ev.measurements.records} />
      )}
      <SubHead title="FCC Parity Report (live geo.fcc.gov bit-exact comparison)" />
      <SubKv kv={ev.fcc_parity_report?.available
        ? [
            ['Available',     'yes'],
            ['Source',        ev.fcc_parity_report.source || '—'],
            ['Samples',       `${ev.fcc_parity_report.n_pass}/${ev.fcc_parity_report.n_samples} within ${ev.fcc_parity_report.tolerance_km} km`],
            ['Max delta',     `${ev.fcc_parity_report.max_error_km ?? '—'} km`],
            ['Mean delta',    `${ev.fcc_parity_report.mean_error_km ?? '—'} km`],
            ['Overall pass',  ev.fcc_parity_report.overall_pass === true ? 'YES' : ev.fcc_parity_report.overall_pass === false ? 'NO' : '—'],
            ['FCC commit',    (ev.fcc_parity_report.provenance?.upstream_commit || '').slice(0, 16)],
            ['Genoa engine',  ev.fcc_parity_report.provenance?.genoa_engine || '—']
          ]
        : ev.fcc_parity_report?.reason
          ? [['Status', ev.fcc_parity_report.reason]]
          : [['Status', 'Parity report not run.  Set options.fcc_parity_report=true to enable a live bit-exact comparison vs FCC distance.json.']]} />

      <SubHead title="SDR Residuals (predicted vs measured, 47 CFR §73.314 / §73.186)" />
      <SubKv kv={ev.measurements?.residuals
        ? [
            ['Captures',       ev.measurements.residuals.n_total],
            ['Evaluated',      ev.measurements.residuals.n_evaluated],
            ['Calibrated',     `${ev.measurements.residuals.n_calibrated}/${ev.measurements.residuals.n_total}`],
            ['RMS residual',   `${ev.measurements.residuals.rms_residual_dB ?? '—'} dB`],
            ['Mean residual',  `${ev.measurements.residuals.mean_residual_dB ?? '—'} dB`],
            ['Above predicted',ev.measurements.residuals.n_above_predicted],
            ['Below predicted',ev.measurements.residuals.n_below_predicted],
            ['Calibration',    ev.measurements.calibration?.calibrated ? 'YES' : 'NO'],
            ['Cal date',       ev.measurements.calibration?.last_calibration_date || '—'],
            ['Cal method',     ev.measurements.calibration?.calibration_method    || '—'],
            ['Antenna gain',   `${ev.measurements.calibration?.antenna_gain_dbi ?? '—'} dBi`],
            ['Cable loss',     `${ev.measurements.calibration?.cable_loss_db    ?? '—'} dB`],
            ['LNA gain',       `${ev.measurements.calibration?.lna_gain_db      ?? '—'} dB`]
          ]
        : ev.measurements?.available
          ? [['Status', 'SDR captures present but no residual table computed (no tx geometry?).']]
          : [['Status', 'No SDR captures attached.  See evidence.measurements_probe for diagnostics.']]} />

      <SubHead title="FCC LMS / Public-File (47 CFR §73.3526 / §73.1620)" />
      <SubKv kv={ev.fcc_lms?.available
        ? [
            ['Available',     'yes'],
            ['Source',        ev.fcc_lms.source || '—'],
            ['Sources tried', (ev.fcc_lms.sources_tried || []).join(', ') || '—'],
            ['Call',          ev.fcc_lms.license?.call         || '—'],
            ['Service',       ev.fcc_lms.license?.service      || '—'],
            ['Class',         ev.fcc_lms.license?.fcc_class    || '—'],
            ['Status',        ev.fcc_lms.license?.status       || '—'],
            ['Last action',   ev.fcc_lms.license?.last_action  || '—'],
            ['Licensee',      ev.fcc_lms.license?.licensee     || '—'],
            ['Expiration',    ev.fcc_lms.license?.license_expiration_date
                                ? `${ev.fcc_lms.license.license_expiration_date}  (${ev.fcc_lms.license.expired ? 'EXPIRED' : ev.fcc_lms.license.expiring_soon ? 'EXPIRING SOON' : 'current'}; ${ev.fcc_lms.license.days_to_expiration} days)`
                                : '—'],
            ['Cross-check',   ev.fcc_lms.cross_check?.match
                                ? 'matches FCC FMQ/AMQ record'
                                : `${ev.fcc_lms.cross_check?.n_mismatches ?? 0} mismatch(es) — see evidence.fcc_lms.cross_check`],
            ['Public file',   ev.fcc_lms.public_file?.available
                                ? `${ev.fcc_lms.public_file.required_folders?.present_count ?? 0} of ${ev.fcc_lms.public_file.required_folders?.required_total ?? 0} required folders present  ·  ${ev.fcc_lms.public_file.file_count ?? '—'} files`
                                : 'not reachable'],
            ['Public-file URL', ev.fcc_lms.public_file?.folder_url || '—'],
            ['LMS deeper review', ev.fcc_lms.authorization_history?.deeper_review_url || '—']
          ]
        : ev.fcc_lms_attempt
          ? [
              ['Status', 'FCC LMS / public-file lookup ran but returned no usable record.'],
              ['Sources tried', (ev.fcc_lms_attempt.sources_tried || []).join(', ') || '—'],
              ['Errors',        (ev.fcc_lms_attempt.errors || []).slice(0, 3).join('; ') || '—']
            ]
          : [['Status', 'FCC LMS lookup not run (no call/facility_id supplied or FCC_LMS_DISABLE=1).']]} />
      <SubHead title="NEC Model (NEC2++ via GPL-isolated sidecar)" />
      <SubKv kv={ev.nec_model?.ok
        ? [
            ['Available',     'yes'],
            ['Engine',        ev.nec_model.provenance?.engine || 'necpp/PyNEC'],
            ['License boundary', ev.nec_model.provenance?.license_boundary || 'external sidecar'],
            ['Frequency',     (ev.nec_model.frequency_mhz ?? '—') + ' MHz'],
            ['Ground',        ev.nec_model.ground?.type || '—'],
            ['Wires',         ev.nec_model.geometry?.n_wires ?? '—'],
            ['Total length',  (ev.nec_model.geometry?.total_length_m ?? '—') + ' m'],
            ['Feedpoint Z',   ev.nec_model.feedpoint
                                ? `${ev.nec_model.feedpoint.r_ohm} + j${ev.nec_model.feedpoint.x_ohm} Ω  (VSWR50 ${ev.nec_model.feedpoint.vswr_50 ?? '—'})`
                                : '—'],
            ['Pattern samples', ev.nec_model.pattern
                                ? `${(ev.nec_model.pattern.theta_deg || []).length} θ × ${(ev.nec_model.pattern.phi_deg || []).length} φ`
                                : '—'],
            ['Near-field samples', (ev.nec_model.near_field || []).length],
            ['Warnings',      (ev.nec_model.warnings || []).length],
            ['Model hash',    ev.nec_model.provenance?.model_hash?.slice(0, 16) || '—'],
            ['Generated',     ev.nec_model.provenance?.generated_at || '—']
          ]
        : ev.nec_model_attempt
          ? [
              ['Status',  'NEC sidecar reachable but request failed.'],
              ['Error',   ev.nec_model_attempt.error || '—'],
              ['Detail',  (ev.nec_model_attempt.detail || '—').slice(0, 120)]
            ]
          : [['Status', 'NEC sidecar not configured (set NEC_SIDECAR_URL) or no antenna geometry supplied.']]} />
      <SubHead title="Identity (RDS / RadioDNS / EAS / audio)" />
      <SubKv kv={ev.identity?.available
        ? [
            ['Available',     'yes'],
            ['Tiers used',    (ev.identity.tiers_used || []).join(', ') || '—'],
            ['Confirmations', (ev.identity.confirmations || []).length],
            ['Sources',       (ev.identity.sources || []).map(s => s.kind + ':' + s.status).join(', ')]
          ]
        : ev.identity_probe
          ? [
              ['Status', 'No identity confirmations attached. ZTR rich-station response was probed but carried no RadioDNS resolver fields and no station_record fields.'],
              ['Sidecar configured',     ev.identity_probe.sidecar?.configured ? 'yes' : 'no'],
              ['ZTR endpoint probed',    ev.identity_probe.ztr_radiodns?.endpoint || '—'],
              ['ZTR station_keys (first 10)', (ev.identity_probe.ztr_radiodns?.station_keys || []).slice(0, 10).join(', ') || '—'],
              ['Diagnostic',             'evidence.identity_probe carries the full list of checked field names and the actual ZTR station keys, so a missing variant can be added in one line.']
            ]
          : [['Status', 'Identity sidecar not attached and ZTR rich-station unavailable.']]} />
    </div>
  );
}

function PaneProvenance({ exhibit }){
  if (!exhibit) return <Empty/>;
  const fm  = exhibit.facility_metadata || {};
  const ev  = exhibit.evidence || {};
  const sig = exhibit.engine_signature || {};
  return (
    <div className="space-y-3">
      <SubHead title="Engine signature" />
      <SubKv kv={[
        ['Module',  sig.module || '—'],
        ['Version', sig.version || '—'],
        ['Build',   sig.hash || '—'],
        ['Node',    sig.node || '—']
      ]} />
      <SubHead title="Facility source" />
      <SubKv kv={[
        ['Upstream',   fm.facility_lookup_source || '—'],
        ['Endpoint',   fm.facility_endpoint || '—'],
        ['Updated at', fm.facility_updated_at || '—']
      ]} />
      <SubHead title="Terrain source" />
      <SubKv kv={ev.terrain?.available ? [
        ['Upstream', ev.terrain.source || '—'],
        ['Endpoint', ev.terrain.endpoint || '—'],
        ['Method',   ev.terrain.method   || '—'],
        ['DEM',      `${ev.terrain.dem?.source || '—'} ${ev.terrain.dem?.dataset || ''}`.trim()],
        ['Fetched at', ev.terrain.fetched_at || '—']
      ] : [['Status', 'no terrain source attached']]} />
      <SubHead title="Curve reference validation (internal golden fixtures)" />
      <SubKv kv={(() => {
        const cr = exhibit.validation?.curve_reference_validation;
        if (!cr) return [['Status', 'no curve-reference run attached']];
        const passLabel =
          cr.result === 'pass'  ? 'PASS — clears CURVE_VALIDATION_MISSING'
        : cr.result === 'fail'  ? 'FAIL — engine + dataset drift detected'
        : 'NO CASES RUN';
        return [
          ['Fixture',      cr.name || '—'],
          ['Method',       cr.method || '—'],
          ['Path',         cr.fixture_path || '—'],
          ['Curve dataset', cr.curve_dataset?.version || '—'],
          ['Tolerance',    cr.tolerance_km != null ? cr.tolerance_km + ' km' : '—'],
          ['Cases',        cr.n_run != null ? `${cr.n_pass ?? 0}/${cr.n_run} pass` : '—'],
          ['Max error',    cr.max_error_km != null ? cr.max_error_km.toFixed(3) + ' km' : '—'],
          ['Ran at',       cr.ran_at || '—'],
          ['Result',       passLabel]
        ];
      })()} />
      <SubHead title="FCC geo contour cross-check (external evidence)" />
      <SubKv kv={(() => {
        const cc = exhibit.validation?.fcc_cross_check;
        if (!cc) return [['Status', 'SKIPPED — ZTR not configured or no facility_id resolved (cross-check requires ZTR rich-station endpoint)']];
        const src = cc;
        const passLabel =
          src.result === 'pass'    ? 'PASS — engine matches FCC geo contour'
        : src.result === 'fail'    ? 'FAIL — engine differs from FCC geo contour (warning, not blocker)'
        : src.result === 'skipped' ? 'SKIPPED — no usable _fcc_contour returned by ZTR for this station'
        : (src.authoritative_pass  ? 'PASS' : 'SKIPPED — 0 cross-check cases ran');
        return [
          ['Method',       src.method   || 'FCC contour cross-check'],
          ['Source',       src.source   || 'zerotrustradio'],
          ['Field',        '_fcc_contour'],
          ['Endpoint',     src.endpoint || '—'],
          ['Upstream API', src.upstream_api || 'https://geo.fcc.gov/api/contours/entity.json'],
          ['Tolerance',    src.tolerance_km != null ? src.tolerance_km + ' km' : '—'],
          ['Cases',        src.n_run != null ? `${src.n_pass ?? 0}/${src.n_run} pass` : '—'],
          ['Max error',    src.max_error_km != null ? src.max_error_km.toFixed(2) + ' km' : '—'],
          ['Ran at',       src.ran_at || '—'],
          ['Result',       passLabel],
          ['Note',         'External evidence only.  FCC uses terrain-aware ITM; engine is free-space §73.333.  This does NOT drive CURVE_VALIDATION_MISSING.']
        ];
      })()} />
      <SubHead title="Measurement source" />
      <SubKv kv={ev.measurements?.available ? [
        ['Upstream', ev.measurements.source || '—'],
        ['Endpoint', ev.measurements.endpoint || '—'],
        ['Records',  ev.measurements.n_records ?? (ev.measurements.records || []).length],
        ['Calibrated', ev.measurements.calibrated ? 'yes' : 'no'],
        ['Fetched at', ev.measurements.fetched_at || '—']
      ] : [['Status', 'no SDR evidence attached']]} />
      <SubHead title="SPLAT sidecar (terrain-aware contour, future)" />
      <SubKv kv={(() => {
        const sp = exhibit.evidence?.splat;
        if (!sp) return [['Status', 'not configured (SPLAT_SIDECAR_URL unset)']];
        if (!sp.available) return [
          ['Status',  'sidecar unreachable'],
          ['Source',  sp.source || '—'],
          ['Error',   sp.error  || '—']
        ];
        return [
          ['Status',          'reachable'],
          ['Source',          sp.source],
          ['Endpoint',        sp.endpoint || '—'],
          ['Sidecar',         sp.sidecar_name || '—'],
          ['SPLAT bin',       sp.splat_bin || '—'],
          ['Workdir',         sp.workdir || '—'],
          ['DEM provisioned', sp.dem_provisioned === true ? 'yes' : (sp.dem_provisioned === false ? 'no' : 'unknown')],
          ['Note',            sp.note || '—']
        ];
      })()} />
      <SubHead title="Population source" />
      <SubKv kv={(() => {
        const pop = exhibit.population_estimate || {};
        if (pop.source && pop.vintage && pop.method && pop.fetched_at){
          return [
            ['Source',     pop.source],
            ['Dataset',    pop.dataset || '—'],
            ['Vintage',    String(pop.vintage)],
            ['Method',     pop.method],
            ['Endpoint',   pop.endpoint || '—'],
            ['SHA256',     (pop.sha256 || '').slice(0, 12) + (pop.sha256 ? '…' : '—'),],
            ['Fetched at', pop.fetched_at],
            ['Persons',    Number(pop.primary).toLocaleString()],
            ['Contour',    pop.contour_label || '—']
          ];
        }
        if (pop.attempt_status === 'failed'){
          return [
            ['Status',          'population API call failed — POPULATION_PLACEHOLDER stays'],
            ['Attempted source', pop.attempted_source || '—'],
            ['Endpoint',         pop.attempt_endpoint || '—'],
            ['Error',            pop.attempt_error    || '—'],
            ['Missing fields',   (pop.attempt_missing || []).join(', ') || '—']
          ];
        }
        return [['Status', 'placeholder — exhibit needs lat/lon coordinates for FCC Census Block API lookup']];
      })()} />
    </div>
  );
}

function PaneValidation({ exhibit }){
  const v = exhibit?.validation || {};
  const last = v.runs?.[v.runs.length - 1] || null;
  if (!last) return <Empty/>;
  const kv = [
    ['Curve dataset',          last.curve_version],
    ['Authoritative cases',    `${last.n_run} run / ${last.n_pass} pass`],
    ['Authoritative pass',     last.authoritative_pass ? 'yes' : 'no — CURVE_VALIDATION_MISSING blocker stays'],
    ['Regression cases',       `${last.n_regression_run} run / ${last.n_regression_pass} pass`],
    ['Mean error (km)',        last.mean_error_km ?? '—'],
    ['Max error (km)',         last.max_error_km  ?? '—'],
    ['Reference cases present', last.reference_cases_present ? 'yes' : 'no']
  ];
  return (
    <>
      <SubKv kv={kv} />
      <SubHead title="Cases" />
      <div className="overflow-auto max-h-[340px] rounded-md border border-rule">
        <table className="telemetry">
          <thead><tr><th>Case</th><th>Role</th><th>Auth?</th><th>Status</th></tr></thead>
          <tbody>
            {(last.results || []).map((r, i) => (
              <tr key={i}>
                <td className="text-cream">{r.case || '—'}</td>
                <td>{r.role || '—'}</td>
                <td>{r.authoritative === true ? 'yes' : (r.authoritative === false ? 'no' : '—')}</td>
                <td className={r.status === 'pass' ? 'text-green' : (r.status === 'fail' ? 'text-red' : 'text-amber')}>{r.status || '—'}</td>
              </tr>
            ))}
            {!(last.results || []).length && <tr><td colSpan={4} className="text-textDim italic">no cases run.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function PaneNarrative({ exhibit }){
  if (!exhibit) return <Empty/>;
  return (
    <pre className="font-mono text-[12px] text-text whitespace-pre-wrap break-words bg-black/40 border border-rule rounded-md p-4 max-h-[540px] overflow-auto">
      {exhibit.narrative?.text || '— no narrative attached —'}
    </pre>
  );
}

function PaneExports({ exhibit }){
  if (!exhibit) return <Empty/>;
  const ex = exhibit.exports || {};
  const kv = [
    ['JSON',          ex.json    || 'pending'],
    ['TXT',           ex.txt     || 'pending'],
    ['GeoJSON',       ex.geojson || 'pending'],
    ['PDF',           ex.pdf     || 'not_implemented'],
    ['Generated at',  ex.generated_at || '—']
  ];
  return (
    <>
      <SubKv kv={kv} />
      <SubHead title="Reproducibility package (JSON)" />
      <pre className="font-mono text-[11px] text-text whitespace-pre-wrap break-words bg-black/40 border border-rule rounded-md p-4 max-h-[540px] overflow-auto">
        {JSON.stringify(exhibit, null, 2)}
      </pre>
    </>
  );
}

function PaneHistory({ rows, onPick }){
  if (!rows || !rows.length){
    return <div className="font-mono text-[12px] text-textDim italic">No saved exhibits — connect Postgres and click Save.</div>;
  }
  return (
    <div className="overflow-auto max-h-[420px] rounded-md border border-rule">
      <table className="telemetry">
        <thead><tr><th>ID</th><th>Call</th><th>Service</th><th>Freq</th><th>Score</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>
          {rows.map(x => (
            <tr key={x.id} style={{ cursor: 'pointer' }} onClick={() => onPick(x.id)}>
              <td>#{x.id}</td>
              <td className="text-cream">{x.call_sign || '—'}</td>
              <td>{x.service || '—'}</td>
              <td>{x.frequency ?? '—'}</td>
              <td>{x.filing_score ?? '—'}</td>
              <td>{x.filing_status || '—'}</td>
              <td>{new Date(x.created_at).toISOString().slice(0,16).replace('T',' ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------- helpers ---------------- */

function Empty(){
  return <div className="font-mono text-[12px] text-textDim italic">— compute an exhibit —</div>;
}
function SubHead({ title }){
  return <div className="rack-eyebrow mt-3 mb-1">{title}</div>;
}
function SubKv({ kv }){
  return (
    <div className="grid grid-cols-[160px_1fr] gap-y-1 gap-x-3 font-mono text-[12px]">
      {kv.map(([k, v]) => (
        <React.Fragment key={k}>
          <div className="text-textDim text-[10px] tracking-rack uppercase">{k}</div>
          <div className="text-cream">{v ?? <span className="text-textDim">—</span>}</div>
        </React.Fragment>
      ))}
    </div>
  );
}

// Resolve the per-capture audio URL.  Prefers explicit fields supplied
// by ZTR / the SigMF builder; falls back to the genoa proxy path when
// we only know the capture id.  Returns null when no playable URL can
// be derived.  The proxy route lives at src/api/routes/captures.js and
// attaches the ZTR_API_TOKEN server-side so the browser never sees it.
function captureAudioUrl(r){
  if (!r) return null;
  // Explicit override (operator-supplied SigMF or ZTR rich-station record).
  if (typeof r.audio_url     === 'string' && r.audio_url)     return r.audio_url;
  if (typeof r.audio_proxy   === 'string' && r.audio_proxy)   return r.audio_proxy;
  // ZTR rich-station / SigMF builder both stamp the capture id under
  // one of several names.  Route through the genoa proxy so the
  // browser doesn't cross-origin to ZTR + the API token stays server-side.
  const id = r.ztr_capture_id ?? r.capture_id ?? r.id ?? null;
  if (id !== null && id !== undefined && /^[0-9]+$/.test(String(id))){
    return `/api/captures/${id}/audio`;
  }
  return null;
}

function captureTimestamp(r){
  return r?.timestamp ?? r?.['core:datetime'] ?? r?.captured_at ?? r?.created_at ?? null;
}
function captureLat(r){
  if (Number.isFinite(Number(r?.lat)))      return Number(r.lat);
  if (Number.isFinite(Number(r?.latitude))) return Number(r.latitude);
  const c = r?.['core:geolocation']?.coordinates;
  if (Array.isArray(c) && Number.isFinite(Number(c[1]))) return Number(c[1]);
  return null;
}
function captureLon(r){
  if (Number.isFinite(Number(r?.lon)))       return Number(r.lon);
  if (Number.isFinite(Number(r?.longitude))) return Number(r.longitude);
  const c = r?.['core:geolocation']?.coordinates;
  if (Array.isArray(c) && Number.isFinite(Number(c[0]))) return Number(c[0]);
  return null;
}
function captureFieldDisplay(r){
  if (Number.isFinite(Number(r?.field_dBu ?? r?.dbu)))
    return `${Number(r.field_dBu ?? r.dbu).toFixed(2)} dBu`;
  if (Number.isFinite(Number(r?.field_mvm ?? r?.mvm)))
    return `${Number(r.field_mvm ?? r.mvm).toFixed(3)} mV/m`;
  if (Number.isFinite(Number(r?.rssi_dbm ?? r?.signal_dbm ?? r?.power_dbm)))
    return `${Number(r.rssi_dbm ?? r.signal_dbm ?? r.power_dbm).toFixed(2)} dBm (raw)`;
  return null;
}

function CaptureTable({ records }){
  return (
    <div className="mt-2 font-mono text-[11px]">
      <div className="text-textDim text-[10px] tracking-rack uppercase mb-1">
        Captures ({records.length})
      </div>
      <table className="telemetry w-full">
        <thead>
          <tr>
            <th className="text-left pr-2">#</th>
            <th className="text-left pr-2">ID</th>
            <th className="text-left pr-2">Captured</th>
            <th className="text-left pr-2">RX (lat, lon)</th>
            <th className="text-left pr-2">Field</th>
            <th className="text-left">Audio</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r, i) => {
            const url   = captureAudioUrl(r);
            const id    = r?.ztr_capture_id ?? r?.capture_id ?? r?.id ?? '—';
            const ts    = captureTimestamp(r);
            const lat   = captureLat(r);
            const lon   = captureLon(r);
            const field = captureFieldDisplay(r);
            return (
              <tr key={i} className="align-top">
                <td className="pr-2 text-textDim">{i + 1}</td>
                <td className="pr-2 text-cream">{String(id)}</td>
                <td className="pr-2 text-cream">{ts || <span className="text-textDim">—</span>}</td>
                <td className="pr-2 text-cream">
                  {Number.isFinite(lat) && Number.isFinite(lon)
                    ? `${lat.toFixed(5)}, ${lon.toFixed(5)}`
                    : <span className="text-textDim">—</span>}
                </td>
                <td className="pr-2 text-cream">{field || <span className="text-textDim">—</span>}</td>
                <td className="pr-2">
                  {url
                    ? <audio controls preload="none" src={url} style={{ height: 28, width: 260 }} />
                    : <span className="text-textDim">no audio URL</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
// Sanitize the FacilityRack inputs into the shape /api/exhibits/sweep
// (and the engine) expects: number-cast numeric fields, drop UI-only
// flags, pass DA pattern only when toggled on.  Mirrors the cleaning
// done inline in compute(); shared so the sweep route sees identical
// base inputs.
function sanitizeBaseInputs(i){
  if (!i) return {};
  return {
    ...i,
    _synthetic:       undefined,
    _resolveFacility: undefined,
    frequency:         num(i.frequency),
    erp_kw:            num(i.erp_kw),
    haat_m:            num(i.haat_m),
    lat:               num(i.lat),
    lon:               num(i.lon),
    ground_sigma_mS_m: num(i.ground_sigma_mS_m),
    radial_step_deg:   num(i.radial_step_deg) || 10,
    pattern_table:     i.pattern_mode === 'DA' ? i.pattern_table : null
  };
}
function num(s){
  if (s === null || s === undefined || s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
function escapeHtml(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
