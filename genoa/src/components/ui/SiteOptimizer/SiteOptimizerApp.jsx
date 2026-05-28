import React, { useMemo, useState } from 'react';
import AppShell from '../AppShell.jsx';
import RackPanel from '../RackPanel.jsx';
import TopNav from '../TopNav.jsx';
import OptimizerIntroPanel from './OptimizerIntroPanel.jsx';
import OptimizerInputsPanel from './OptimizerInputsPanel.jsx';
import OptimizerMap from './OptimizerMap.jsx';
import CandidateTable from './CandidateTable.jsx';
import CandidateDetailDrawer from './CandidateDetailDrawer.jsx';
import BaselinePanel from './BaselinePanel.jsx';
import FuturePlaceholders from './FuturePlaceholders.jsx';
import ColocationDoctrineBlock from './ColocationDoctrineBlock.jsx';

// SiteOptimizerApp — the entire /am-relocation page.  Top-level for
// the new route; the existing Contour Studio is unaffected.
//
// Layout (desktop):
//   [ AppShell topbar ]
//   [ intro panel ]
//   [ baseline strip ]
//   [ map (center, big) ] [ inputs rail (left) ] — using AppShell's
//   three-column grid, but inputs on the LEFT and map dominant in
//   center.  Bottom: candidate table.  Drawer is a fixed overlay.
//
// Two backend endpoints are used:
//   /api/am/site-optimizer            — when search_mode === 'GRID'
//   /api/am/colocation-opportunities  — when search_mode is INFRASTRUCTURE
//                                       or HYBRID (default).  The latter
//                                       returns the same shape plus a
//                                       per-candidate `source`,
//                                       `infrastructure_ref`,
//                                       `colocation_analysis` and
//                                       `status_category` enum.

const DEFAULT_INPUTS = {
  callsign:         'KAZM',
  frequency_khz:    780,
  current_site:     { lat: 34.86, lon: -111.82 },
  search_radius_km: 50,
  grid_spacing_km:  2,
  tpo_kw:           5,
  pattern_mode:     'NDA',
  fcc_class:        'D',
  optimization_goals: {
    maximize_col_coverage:       true,
    maximize_population:         true,
    minimize_blanket_population: true,
    prefer_high_conductivity:    true,
    avoid_wildfire_risk:         false,
    minimize_int_treaty_zone:    false
  },
  search_mode:           'HYBRID',
  infrastructure_source: 'MANUAL',
  infrastructure_filters: {
    include_towers:     true,
    include_asr:        true,
    include_am_sites:   true,
    include_fm_sites:   true,
    include_tv_sites:   true,
    min_tower_height_m: 0,
    max_tower_height_m: 500,
    owner_contains:     ''
  },
  candidate_limit: 20
};

export default function SiteOptimizerApp({ onSwitchToContourStudio, onLogout, onNavigate }){
  const [inputs, setInputs]     = useState(DEFAULT_INPUTS);
  const [result, setResult]     = useState(null);     // { available, n_..., current_site_baseline, candidates }
  const [running, setRunning]   = useState(false);
  const [error, setError]       = useState('');
  const [selectedRank, setSelectedRank] = useState(null);

  function onChange(k, v){
    setInputs(s => ({ ...s, [k]: v }));
  }

  async function runSearch(){
    setError('');
    setRunning(true);
    setResult(null);
    setSelectedRank(null);
    const useColocation = inputs.search_mode !== 'GRID';
    const endpoint = useColocation
      ? '/api/am/colocation-opportunities'
      : '/api/am/site-optimizer';
    try {
      const r = await fetch(endpoint, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body:    JSON.stringify(inputs)
      });
      if (r.status === 404){
        setError(`${endpoint} is not yet deployed on this server.  Showing demo data so the UI is reviewable.`);
        setResult(useColocation ? DEMO_COLOCATION_RESULT : DEMO_RESULT);
        return;
      }
      if (!r.ok){
        const j = await r.json().catch(() => ({}));
        throw new Error(j.message || j.error || `HTTP ${r.status}`);
      }
      const j = await r.json();
      setResult(j);
      if (Array.isArray(j.candidates) && j.candidates.length > 0){
        setSelectedRank(j.candidates[0].rank);
      }
    } catch (e){
      setError(e.message || 'Search failed');
    } finally {
      setRunning(false);
    }
  }

  const selected = useMemo(() => {
    if (selectedRank == null || !result?.candidates) return null;
    return result.candidates.find(c => c.rank === selectedRank) || null;
  }, [selectedRank, result]);

  const baseline = result?.current_site_baseline || null;
  const candidates = result?.candidates || [];

  // Infrastructure-source sites drive the InfrastructureLegend layer
  // inside OptimizerMap.  GRID-source candidates remain on the regular
  // ranked-candidate layer.
  const infrastructureSites = useMemo(() => {
    return (candidates || []).filter(c => c?.source === 'INFRASTRUCTURE');
  }, [candidates]);

  const isColocationMode = inputs.search_mode !== 'GRID';

  return (
    <>
      {/* Shared top nav (Studio / Product + Sign out), matching the
          contour-studio chrome.  The Studio link replaces the old
          "← Contour Studio" button.  Falls back to onSwitchToContourStudio
          for navigation when onNavigate isn't supplied. */}
      <TopNav
        authed
        onNavigate={onNavigate || (() => onSwitchToContourStudio && onSwitchToContourStudio())}
        onLogout={onLogout}
      />
      <AppShell
        systemStatus={result ? 'nominal' : 'offline'}
        mode="AM Relocation Optimizer (beta) · screening"
        engineVersion="genoa-optimizer v0.1.0"
        readinessScore={null}
        readinessStatus={null}
        commitSha="optimizer-ui"
        left={(
          <>
            <OptimizerInputsPanel
              inputs={inputs}
              onChange={onChange}
              onRun={runSearch}
              running={running}
              error={error}
            />
            <FuturePlaceholders />
          </>
        )}
        center={(
          <>
            <OptimizerIntroPanel />
            <BaselinePanel
              callsign={inputs.callsign}
              baseline={baseline}
              comparedTo={selected?.rank}
            />
            <OptimizerMap
              currentSite={inputs.current_site}
              callsign={inputs.callsign}
              candidates={candidates}
              selectedRank={selectedRank}
              onSelectCandidate={setSelectedRank}
              searchRadiusKm={inputs.search_radius_km}
              searchMode={inputs.search_mode}
              infrastructureSites={infrastructureSites}
            />
            <CandidateTable
              candidates={candidates}
              selectedRank={selectedRank}
              onSelect={setSelectedRank}
              evaluated={result?.n_candidates_evaluated}
              returned={result?.n_candidates_returned}
            />
          </>
        )}
        right={(
          <>
            {isColocationMode ? (
              <ColocationDoctrineBlock candidates={candidates} />
            ) : (
              <RackPanel
                eyebrow="Doctrine"
                title="What this page is for"
                italicAccent="Screening, not filing."
                dense
              >
                <div className="font-mono text-[11px] text-textDim leading-relaxed space-y-2">
                  <p>
                    This is a <span className="text-cream">regional planning console</span>.  Every score
                    here is an explainable screening signal: COL coverage, blanket population,
                    conductivity, nighttime survivability proxies, optional environmental signals.
                  </p>
                  <p>
                    A <span className="text-amber">PROMISING</span> candidate is a desk-study seed —
                    not a filing.  Promote to the main Contour Studio to run the deterministic
                    §73.183 / §73.184 / §73.182 pipeline and to attach evidence + PE seal.
                  </p>
                  <p className="italic text-amberDim">
                    Status labels are explicit on every row and marker tooltip.  When a goal
                    is not yet wired (wildfire, treaty zone), the checkbox is tagged
                    "Screening only" so the operator can't be fooled.
                  </p>
                </div>
              </RackPanel>
            )}
          </>
        )}
      />
      <CandidateDetailDrawer
        candidate={selected}
        onClose={() => setSelectedRank(null)}
      />
    </>
  );
}

// Inline demo payload — shown only when the back-end endpoint returns
// 404 so the UI can be reviewed end-to-end before the parallel agent
// finishes the route.  Shape matches the documented response.
const DEMO_RESULT = {
  available: true,
  n_candidates_evaluated: 234,
  n_candidates_returned:  4,
  current_site_baseline: {
    score: 62.4,
    col_coverage_pct: 0.85,
    blanket_population_pct: 0.6,
    ground_sigma_mS_m: 8
  },
  candidates: [
    {
      rank: 1, lat: 34.91, lon: -111.79,
      distance_from_current_km: 6.2, score: 91.3,
      col_coverage_pct: 0.97, nif_status: 'PROMISING',
      daytime_reach_km: 34.1, blanket_population_pct: 0.4,
      ground_sigma_mS_m: 8, treaty_zone: null, fuel_risk: 'NOT-EVALUATED',
      notes: '97% city-coverage, σ=8 mS/m, 0.4% blanket pop, 6 km from current.',
      explanation: {
        score_breakdown: { col_coverage: 35, population: 28, blanket: 14, conductivity: 10, wildfire: 0, treaty_zone: 4 },
        ranking_rationale: 'Highest COL coverage and population in pool; conductivity 8 mS/m is M3-zone max for region.'
      },
      status_labels: ['PROMISING', 'ENGINEER REVIEW REQUIRED'],
      status_category: 'PROMISING',
      source: 'GRID',
      infrastructure_ref: null,
      colocation_analysis: null,
      limitations: ['Wildfire scoring not yet wired', 'Parcel availability not checked', 'NIF status is SCREENING-grade only']
    },
    {
      rank: 2, lat: 34.83, lon: -111.74,
      distance_from_current_km: 7.8, score: 84.0,
      col_coverage_pct: 0.91, nif_status: 'REVIEW',
      daytime_reach_km: 31.2, blanket_population_pct: 0.7,
      ground_sigma_mS_m: 6, treaty_zone: null, fuel_risk: 'LOW',
      notes: '91% city-coverage; ground σ slightly lower; daytime reach acceptable.',
      explanation: {
        score_breakdown: { col_coverage: 31, population: 24, blanket: 13, conductivity: 8, wildfire: 5, treaty_zone: 3 },
        ranking_rationale: 'Strong overall — second only on COL coverage; fuel-risk score positive.'
      },
      status_labels: ['PROMISING', 'REVIEW REQUIRED'],
      status_category: 'REVIEW_REQUIRED',
      source: 'GRID',
      infrastructure_ref: null,
      colocation_analysis: null,
      limitations: ['NIF status REVIEW — engineering DA pattern may be required']
    },
    {
      rank: 3, lat: 34.95, lon: -111.92,
      distance_from_current_km: 12.5, score: 71.8,
      col_coverage_pct: 0.78, nif_status: 'PROMISING',
      daytime_reach_km: 28.4, blanket_population_pct: 0.3,
      ground_sigma_mS_m: 10, treaty_zone: null, fuel_risk: 'MODERATE',
      notes: 'Lower COL but excellent conductivity and minimal blanket exposure.',
      explanation: {
        score_breakdown: { col_coverage: 24, population: 18, blanket: 16, conductivity: 12, wildfire: -2, treaty_zone: 4 },
        ranking_rationale: 'Conductivity wins offset lower coverage; wildfire flag pulled the score down.'
      },
      status_labels: ['ENGINEER REVIEW REQUIRED'],
      status_category: 'REVIEW_REQUIRED',
      source: 'GRID',
      infrastructure_ref: null,
      colocation_analysis: null,
      limitations: ['Moderate wildfire exposure — manual review of fuel maps required']
    },
    {
      rank: 4, lat: 34.78, lon: -111.95,
      distance_from_current_km: 15.0, score: 58.5,
      col_coverage_pct: 0.62, nif_status: 'FAIL',
      daytime_reach_km: 22.5, blanket_population_pct: 1.1,
      ground_sigma_mS_m: 4, treaty_zone: 'US-MX advisory',
      fuel_risk: 'LOW',
      notes: 'Coverage gap on east side of COL; treaty advisory zone.',
      explanation: {
        score_breakdown: { col_coverage: 18, population: 14, blanket: 6, conductivity: 4, wildfire: 4, treaty_zone: -8 },
        ranking_rationale: 'NIF fails screening + advisory treaty zone — kept for completeness only.'
      },
      status_labels: ['NON-COMPLIANT'],
      status_category: 'NON_COMPLIANT',
      source: 'GRID',
      infrastructure_ref: null,
      colocation_analysis: null,
      limitations: ['§73.182 NIF projected to fail', 'US/MX treaty advisory in scope']
    }
  ]
};

// Co-location demo payload — used when the colocation endpoint is not
// yet deployed.  Builds on DEMO_RESULT and appends two infrastructure-
// source rows demonstrating the new shape (`source`, `infrastructure_ref`,
// `colocation_analysis`, `status_category`).
const DEMO_COLOCATION_RESULT = {
  ...DEMO_RESULT,
  n_candidates_evaluated: 312,
  n_candidates_returned:  6,
  candidates: [
    ...DEMO_RESULT.candidates,
    {
      rank: 5, lat: 34.88, lon: -111.85,
      distance_from_current_km: 3.4, score: 88.7,
      col_coverage_pct: 0.94, nif_status: 'PROMISING',
      daytime_reach_km: 33.0, blanket_population_pct: 0.5,
      ground_sigma_mS_m: 7, treaty_zone: null, fuel_risk: 'LOW',
      notes: 'Existing 122 m guyed tower — shared-lease advantage; same-band caution.',
      explanation: {
        score_breakdown: { col_coverage: 32, population: 26, blanket: 13, conductivity: 9, wildfire: 3, treaty_zone: 4 },
        ranking_rationale: 'Strong COL coverage with parcel + ASR + grounding already in place.'
      },
      status_labels: ['PROMISING', 'REVIEW REQUIRED'],
      status_category: 'RECOVERABLE_WITH_DA',
      source: 'INFRASTRUCTURE',
      infrastructure_ref: {
        id: 'ASR-1062845',
        kind: 'TOWER',
        name: 'Sedona Ridge Tower 4',
        owner: 'Verde Broadcasting LLC',
        lat: 34.88, lon: -111.85,
        height_m: 122,
        structure_type: 'GUYED',
        asr_number: '1062845',
        frequency_khz: null,
        station_call: null
      },
      colocation_analysis: {
        distance_to_host_m: 0,
        host_kind: 'TOWER',
        host_owner: 'Verde Broadcasting LLC',
        host_height_m: 122,
        tower_loading_advisory: 'Loading study required — antenna mass + wind area must be re-computed for the added array.',
        same_band_interference_risk: 'MEDIUM',
        structural_engineering_required: true,
        shared_lease_advantage: true,
        diplexing_required: false,
        regulatory_notes: [
          'ASR registered — FAA/FCC notification of structure change may apply.',
          'RF MPE must be re-evaluated with all existing tenants in place.'
        ]
      },
      limitations: ['Shared-lease only; site not owned outright.']
    },
    {
      rank: 6, lat: 34.81, lon: -111.78,
      distance_from_current_km: 6.0, score: 76.1,
      col_coverage_pct: 0.86, nif_status: 'REVIEW',
      daytime_reach_km: 29.4, blanket_population_pct: 0.9,
      ground_sigma_mS_m: 6, treaty_zone: null, fuel_risk: 'LOW',
      notes: 'Co-located on existing AM site — diplexing required, same-band HIGH.',
      explanation: {
        score_breakdown: { col_coverage: 28, population: 22, blanket: 10, conductivity: 7, wildfire: 5, treaty_zone: 4 },
        ranking_rationale: 'Existing AM facility already authorized — diplexing path well-trodden.'
      },
      status_labels: ['REVIEW REQUIRED'],
      status_category: 'RECOVERABLE_WITH_DA',
      source: 'INFRASTRUCTURE',
      infrastructure_ref: {
        id: 'AM-KVRD-790',
        kind: 'AM_SITE',
        name: 'KVRD 790 kHz transmitter',
        owner: 'Red Rock Radio Group',
        lat: 34.81, lon: -111.78,
        height_m: 90,
        structure_type: 'SERIES_FED',
        asr_number: null,
        frequency_khz: 790,
        station_call: 'KVRD'
      },
      colocation_analysis: {
        distance_to_host_m: 0,
        host_kind: 'AM_SITE',
        host_owner: 'Red Rock Radio Group',
        host_height_m: 90,
        tower_loading_advisory: 'Series-fed tower — diplexer + isolator engineering required.',
        same_band_interference_risk: 'HIGH',
        structural_engineering_required: true,
        shared_lease_advantage: true,
        diplexing_required: true,
        regulatory_notes: [
          'Co-channel adjacency — full §73.182 NIF re-projection with host pattern required.',
          'Diplexer specification and re-grounding plan must accompany the filing.'
        ]
      },
      limitations: ['Host carrier at 790 kHz — only 10 kHz spacing from proposed 780 kHz.']
    }
  ]
};
