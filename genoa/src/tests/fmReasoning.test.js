// _fmReasoning helper — verifies pass/fail narrative composition for
// §73.207, §73.215, and §74.1204 pairs, including:
//   - binding-constraint selection (failing rules beat passing rules)
//   - alternate-route detection (§73.215 rescues §73.207 short spacing)
//   - §74.1204(f) cite for third-adjacent translator pairs
//   - structural fields per the agent-4 spec
//
// Also smoke-tests the FORTRAN-parity wording helper to ensure honest
// language: "verified against FCC TVFMFS_METRIC" appears ONLY when the
// parity sweep ran AND passed.

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildFmReasoning }
  from '../exports/engineeringReport/sections/_fmReasoning.js';
import { summarizeFortranParity }
  from '../evidence/fortranFccClient.js';
import {
  verifyThirdAdjacent_741204f,
  checkTranslatorInterference
} from '../engine/regulatory/translator.js';
import { LPFM_DEFAULT_CONTOURS } from '../engine/lpfm/contour.js';

// ── Fixture builders ────────────────────────────────────────────────────────

function makeInterferenceStudy({ stations }){
  return {
    cite:               ['47 CFR §73.215'],
    subject:            { call: 'KSUB', frequency_mhz: 100.7 },
    rules_evaluated:    ['§73.207(b) Table A', '§73.215'],
    n_stations:         stations.length,
    n_pass:             stations.filter(s => s.pass_overall === true).length,
    n_fail:             stations.filter(s => s.pass_overall === false).length,
    blocking_rule:      null,
    filing_qualifies:   stations.every(s => s.pass_overall !== false),
    stations,
    provenance:         {}
  };
}

// ── §73.207 spacing ─────────────────────────────────────────────────────────

test('§73.207 spacing PASS — reasoning carries positive km margin', () => {
  const study = makeInterferenceStudy({
    stations: [{
      call: 'KNEAR', facility_id: '1', fcc_class: 'A',
      frequency_mhz: 100.7, channel_relationship: 'co-channel',
      distance_km: 300,
      rules: {
        section_73_207: {
          cite: '47 CFR §73.207(b) Table A',
          required_separation_km: 241, actual_separation_km: 300,
          margin_km: 59, pass: true, skipped: false
        }
      },
      pass_overall: true, qualified_via: ['§73.207(b)'], failed_rules: []
    }]
  });
  const r = buildFmReasoning(study);
  assert.equal(r.pairs.length, 1);
  const p = r.pairs[0];
  assert.equal(p.station.call, 'KNEAR');
  assert.equal(p.rule, '§73.207(b)');
  assert.equal(p.gap_or_margin_km, 59);
  assert.equal(p.pass, true);
  assert.match(p.binding_constraint, /satisfied/);
  assert.match(p.narrative, /KNEAR/);
});

test('§73.207 FAIL — reasoning narrative includes shortfall and blocks filing', () => {
  const study = makeInterferenceStudy({
    stations: [{
      call: 'KSHORT', facility_id: '2', fcc_class: 'A',
      frequency_mhz: 100.7, channel_relationship: 'co-channel',
      distance_km: 200,
      rules: {
        section_73_207: {
          cite: '47 CFR §73.207(b) Table A',
          required_separation_km: 241, actual_separation_km: 200,
          margin_km: -41, pass: false, skipped: false
        }
      },
      pass_overall: false, qualified_via: [], failed_rules: ['§73.207(b)']
    }]
  });
  const r = buildFmReasoning(study);
  const p = r.pairs[0];
  assert.equal(p.pass, false);
  assert.equal(p.gap_or_margin_km, -41);
  assert.equal(p.alternate_route_available, false);
  assert.match(p.binding_constraint, /requires.*km/);
  assert.match(p.narrative, /No alternate qualifying rule/);
  assert.equal(r.n_blocking, 1);
});

// ── §73.215 contour protection ──────────────────────────────────────────────

test('§73.215 rescues a §73.207 shortfall — alternate_route_available=true', () => {
  const study = makeInterferenceStudy({
    stations: [{
      call: 'KCLO', facility_id: '3', fcc_class: 'B',
      frequency_mhz: 100.7, channel_relationship: 'co-channel',
      distance_km: 220,
      rules: {
        section_73_207: {
          cite: '47 CFR §73.207(b) Table A',
          required_separation_km: 241, actual_separation_km: 220,
          margin_km: -21, pass: false
        },
        section_73_215: {
          cite: '47 CFR §73.215',
          du_required_db: 20,
          du_actual_db_forward: 25, du_actual_db_reverse: 27,
          polygon_pass: true, pass: true
        }
      },
      pass_overall: true, qualified_via: ['§73.215'], failed_rules: ['§73.207(b)']
    }]
  });
  const r = buildFmReasoning(study);
  const p = r.pairs[0];
  // Binding rule is the failing §73.207 entry; alternate is §73.215.
  assert.equal(p.rule, '§73.207(b)');
  assert.equal(p.pass, false);
  assert.equal(p.alternate_route_available, true);
  assert.match(p.narrative, /alternate route/);
  assert.match(p.narrative, /§73\.215/);
  assert.equal(r.n_blocking, 0, 'pair has an alternate so should not block filing');
});

test('§73.215 binding pass — margin = min(forward, reverse) D/U', () => {
  const study = makeInterferenceStudy({
    stations: [{
      call: 'KOK', facility_id: '4', fcc_class: 'B',
      frequency_mhz: 100.7, channel_relationship: 'co-channel',
      distance_km: 250,
      rules: {
        section_73_215: {
          cite: '47 CFR §73.215',
          du_required_db: 20,
          du_actual_db_forward: 22, du_actual_db_reverse: 30,
          polygon_pass: true, pass: true
        }
      },
      pass_overall: true, qualified_via: ['§73.215'], failed_rules: []
    }]
  });
  const p = buildFmReasoning(study).pairs[0];
  assert.equal(p.rule, '§73.215');
  // min(22-20, 30-20) = 2
  assert.equal(p.gap_or_margin_db, 2);
  assert.equal(p.pass, true);
});

// ── §74.1204 translator ─────────────────────────────────────────────────────

test('§74.1204(f) cite is used for third-adjacent translator pairs', () => {
  const study = makeInterferenceStudy({
    stations: [{
      call: 'WPRI', facility_id: '5', fcc_class: 'A',
      frequency_mhz: 100.7, channel_relationship: '3rd-adjacent',
      distance_km: 8,
      rules: {
        section_74_1204: {
          cite: '47 CFR §74.1204(a)+(c)',
          du_required_db: -40,
          du_actual_db: -42,
          pass: false, skipped: false
        }
      },
      pass_overall: false, qualified_via: [], failed_rules: ['§74.1204']
    }]
  });
  const p = buildFmReasoning(study).pairs[0];
  // §74.1204(f) governs third-adjacent — cite must reflect that.
  assert.equal(p.rule, '§74.1204(f)');
  assert.equal(p.pass, false);
  assert.equal(p.gap_or_margin_db, -2);
});

test('§74.1204(a) cite for co-channel translator pairs', () => {
  const study = makeInterferenceStudy({
    stations: [{
      call: 'WCO', facility_id: '6', fcc_class: 'A',
      frequency_mhz: 100.1, channel_relationship: 'co-channel',
      distance_km: 50,
      rules: {
        section_74_1204: {
          cite: '47 CFR §74.1204(a)+(c)',
          du_required_db: 20, du_actual_db: 25,
          pass: true, skipped: false
        }
      },
      pass_overall: true, qualified_via: ['§74.1204'], failed_rules: []
    }]
  });
  const p = buildFmReasoning(study).pairs[0];
  assert.equal(p.rule, '§74.1204(a)');
  assert.equal(p.gap_or_margin_db, 5);
});

// ── verifyThirdAdjacent_741204f ─────────────────────────────────────────────

test('verifyThirdAdjacent_741204f — returns not-applicable when no third-adj pairs', () => {
  const r = verifyThirdAdjacent_741204f({
    cite: '47 CFR §74.1204', pass: true,
    studies: [
      { relationship: 'co-channel', pass: true, du_actual_db: 25, du_threshold_db: 20 }
    ]
  });
  assert.equal(r.cite, '47 CFR §74.1204(f)');
  assert.equal(r.applicable, false);
  assert.equal(r.n_pairs, 0);
});

test('verifyThirdAdjacent_741204f — surfaces third-adjacent pairs with their gate margin', () => {
  const r = verifyThirdAdjacent_741204f({
    cite: '47 CFR §74.1204',
    studies: [
      { relationship: '3rd-adjacent', delta_khz: 600,
        primary_call: 'WTA', primary_class: 'A',
        du_actual_db: -35, du_threshold_db: -40, pass: true, skipped: false },
      { relationship: '3rd-adjacent', delta_khz: -600,
        primary_call: 'WTB', primary_class: 'B',
        du_actual_db: -45, du_threshold_db: -40, pass: false, skipped: false }
    ]
  });
  assert.equal(r.applicable, true);
  assert.equal(r.n_pairs, 2);
  assert.equal(r.pass, false);
  assert.equal(r.pairs[0].primary_call, 'WTA');
  assert.match(r.pairs[0].narrative, /§74\.1204\(f\)/);
  assert.match(r.pairs[1].narrative, /fails the §74\.1204\(f\) gate/);
});

test('checkTranslatorInterference tags rule_cite=§74.1204(f) on third-adjacent studies', () => {
  const translator = {
    erp_kw: 0.25, haat_m: 30, frequency_mhz: 100.1,
    lat: 37.0902, lon: -95.7129
  };
  // 100.7 = +600 kHz from 100.1 → third-adjacent
  const primary = {
    call: 'WTHIRD', fcc_class: 'A', frequency_mhz: 100.7,
    erp_kw: 6, haat_m: 100, lat: 37.0902, lon: -98.0
  };
  const r = checkTranslatorInterference({ translator, primaries: [primary] });
  assert.equal(r.studies.length, 1);
  const s = r.studies[0];
  assert.equal(s.relationship, '3rd-adjacent');
  assert.equal(s.rule_cite, '47 CFR §74.1204(f)');
  assert.equal(s.relationship_key, 'third_adjacent');
});

// ── LPFM contour fix ────────────────────────────────────────────────────────

test('LPFM_DEFAULT_CONTOURS is exactly the 60 dBu service contour (§73.811)', () => {
  assert.equal(LPFM_DEFAULT_CONTOURS.length, 1,
    'LPFM has exactly ONE protected contour per §73.811(a); city/protected contours do not apply');
  const c = LPFM_DEFAULT_CONTOURS[0];
  assert.equal(c.id, 'service_60dbu');
  assert.equal(c.field_dBu, 60);
  assert.equal(c.mode, '50,50');
  assert.match(c.cite, /73\.811/);
});

// ── FORTRAN parity wording ──────────────────────────────────────────────────

test('summarizeFortranParity: AM exhibits report not_applicable, never "verified"', () => {
  const r = summarizeFortranParity({}, 'AM');
  assert.equal(r.status, 'not_applicable');
  assert.doesNotMatch(r.wording, /verified against FCC TVFMFS_METRIC/);
  assert.match(r.wording, /not applicable to AM/);
});

test('summarizeFortranParity: FM with no evidence reports not_configured', () => {
  const r = summarizeFortranParity({}, 'FM');
  assert.equal(r.status, 'not_configured');
  assert.doesNotMatch(r.wording, /verified against FCC TVFMFS_METRIC/);
  assert.match(r.wording, /not configured/);
});

test('summarizeFortranParity: passing sweep emits "verified against FCC TVFMFS_METRIC"', () => {
  const r = summarizeFortranParity({
    fcc_curve_parity: {
      available: true, pass: true,
      n_ok: 108, n_requests: 108, max_abs_delta_km: 0.012, tolerance_km: 0.05
    }
  }, 'FM');
  assert.equal(r.status, 'verified');
  assert.match(r.wording, /verified against FCC TVFMFS_METRIC/);
  assert.match(r.wording, /108\/108/);
});

test('summarizeFortranParity: failing sweep does NOT claim "verified"', () => {
  const r = summarizeFortranParity({
    fcc_curve_parity: {
      available: true, pass: false,
      n_ok: 90, n_requests: 108, max_abs_delta_km: 0.3, tolerance_km: 0.05
    }
  }, 'FM');
  assert.equal(r.status, 'failed');
  assert.doesNotMatch(r.wording, /verified against FCC TVFMFS_METRIC/);
  assert.match(r.wording, /did not pass/);
});

test('summarizeFortranParity: unavailable engine surfaces error', () => {
  const r = summarizeFortranParity({
    fcc_curve_parity: { available: false, error: 'HTTP 500' }
  }, 'FM');
  assert.equal(r.status, 'unavailable');
  assert.match(r.wording, /HTTP 500/);
  assert.doesNotMatch(r.wording, /verified against FCC TVFMFS_METRIC/);
});

// ── Empty input safety ──────────────────────────────────────────────────────

test('buildFmReasoning: tolerates missing interference_study', () => {
  const r = buildFmReasoning(null);
  assert.equal(r.n_pairs, 0);
  assert.equal(r.n_blocking, 0);
  assert.deepEqual(r.pairs, []);
});

test('buildFmReasoning: station with no evaluated rules → null rule + helpful narrative', () => {
  const r = buildFmReasoning(makeInterferenceStudy({
    stations: [{
      call: 'KFAR', fcc_class: 'A', frequency_mhz: 95.5,
      channel_relationship: 'non-restricted', distance_km: 600,
      rules: {}, pass_overall: null
    }]
  }));
  const p = r.pairs[0];
  assert.equal(p.rule, null);
  assert.equal(p.pass, null);
  assert.match(p.binding_constraint, /no restricted relationship/);
});
