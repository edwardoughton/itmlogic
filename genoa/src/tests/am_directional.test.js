// 47 CFR §73.62 / §73.45 directional AM pattern tests.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  directionalErpAtBearing,
  directionalErpForPair,
  AM_DIRECTIONAL_PROVENANCE
} from '../engine/pattern/am_directional.js';

import { studyContourPair } from '../engine/regulatory/_du_pair_study.js';
import { checkSection73187 } from '../engine/regulatory/section_73_187.js';

/* ---------- directionalErpAtBearing ---------- */

test('directionalErpAtBearing: null pattern → factor 1.0, ERP unchanged', () => {
  const r = directionalErpAtBearing({ erp_kw: 50, pattern_table: null, bearing_deg: 90 });
  assert.equal(r.pattern_factor, 1.0);
  assert.equal(r.erp_effective_kw, 50);
  assert.equal(r.directional, false);
  assert.equal(r.pattern_applied, false);
});

test('directionalErpAtBearing: cardioid-like pattern — null at 180° (factor 0)', () => {
  // Full-circle pattern: 1.0 at 0°, 0.5 at 90°/270°, 0.0 at 180°.
  const pattern = [[0, 1.0], [90, 0.5], [180, 0.0], [270, 0.5]];
  const front = directionalErpAtBearing({ erp_kw: 50, pattern_table: pattern, bearing_deg: 0 });
  const side  = directionalErpAtBearing({ erp_kw: 50, pattern_table: pattern, bearing_deg: 90 });
  const back  = directionalErpAtBearing({ erp_kw: 50, pattern_table: pattern, bearing_deg: 180 });
  // ERP_eff = ERP × f²
  assert.ok(Math.abs(front.erp_effective_kw - 50)    < 1e-3, `front ${front.erp_effective_kw}`);
  assert.ok(Math.abs(side.erp_effective_kw  - 12.5)  < 1e-3, `side  ${side.erp_effective_kw}`);
  assert.ok(Math.abs(back.erp_effective_kw  -  0)    < 1e-3, `back  ${back.erp_effective_kw}`);
  assert.equal(front.directional, true);
  assert.equal(front.pattern_applied, true);
});

test('directionalErpAtBearing: power scales as f² (not f)', () => {
  const pattern = [[0, 1.0], [90, 0.5], [180, 0.0], [270, 0.5]];
  // f=0.5 → ERP_eff = ERP × 0.25
  const r = directionalErpAtBearing({ erp_kw: 100, pattern_table: pattern, bearing_deg: 90 });
  assert.equal(r.pattern_factor, 0.5);
  assert.equal(r.erp_effective_kw, 25);          // 100 × 0.5² = 25
});

test('directionalErpAtBearing: linear interpolation between table rows', () => {
  const pattern = [[0, 1.0], [90, 0.5], [180, 0.0], [270, 0.5]];
  // 45° is halfway between [0, 1.0] and [90, 0.5]; expect factor 0.75
  const r = directionalErpAtBearing({ erp_kw: 100, pattern_table: pattern, bearing_deg: 45 });
  assert.ok(Math.abs(r.pattern_factor - 0.75) < 0.01, `expected ~0.75, got ${r.pattern_factor}`);
});

test('directionalErpAtBearing: bearing wraps around 360°', () => {
  const pattern = [[0, 1.0], [90, 0.5], [180, 0.0], [270, 0.5]];
  const r1 = directionalErpAtBearing({ erp_kw: 100, pattern_table: pattern, bearing_deg: 360 });
  const r2 = directionalErpAtBearing({ erp_kw: 100, pattern_table: pattern, bearing_deg: 0   });
  assert.equal(r1.pattern_factor, r2.pattern_factor);
  // Negative bearings should also wrap
  const r3 = directionalErpAtBearing({ erp_kw: 100, pattern_table: pattern, bearing_deg: -90 });
  assert.equal(r3.pattern_factor, 0.5);          // -90 ≡ 270°
});

test('directionalErpAtBearing: invalid inputs return structured failure', () => {
  const r1 = directionalErpAtBearing({ erp_kw: -1, pattern_table: null, bearing_deg: 0 });
  assert.equal(r1.erp_effective_kw, null);
  const r2 = directionalErpAtBearing({ erp_kw: 100, pattern_table: null, bearing_deg: NaN });
  assert.equal(r2.directional, false);
});

/* ---------- directionalErpForPair ---------- */

test('directionalErpForPair: applies each station\'s pattern at its OWN outbound bearing', () => {
  // U nulls toward D (bearing 90°);  D nulls toward U (bearing 270°).
  const pattern_U = [[0, 1.0], [90, 0.0], [180, 1.0], [270, 0.0]];
  const pattern_D = [[0, 1.0], [90, 1.0], [180, 1.0], [270, 0.0]];
  const r = directionalErpForPair({
    U: { erp_kw: 100, pattern_table: pattern_U, lat: 0, lon: 0 },
    D: { erp_kw: 100, pattern_table: pattern_D, lat: 0, lon: 0 },
    bearings: { u_to_d_deg: 90, d_to_u_deg: 270 }
  });
  // U's pattern at bearing-to-D (90°) = 0 → ERP_eff_U = 0
  assert.ok(r.u_toward_d.erp_effective_kw < 1e-6);
  // D's pattern at bearing-to-U (270°) = 0 → ERP_eff_D = 0
  assert.ok(r.d_toward_u.erp_effective_kw < 1e-6);
  assert.equal(r.any_directional, true);
});

/* ---------- §73.215 / §74.1204 integration via studyContourPair ---------- */

test('studyContourPair: directional pattern reduces U\'s field and improves D/U', () => {
  // Subject FM Class A with a pattern that nulls toward the nearby station.
  const subject = {
    call: 'KSUB-FM', frequency_mhz: 100.7, erp_kw: 6, haat_m: 100,
    lat: 40.0, lon: -100.0, fcc_class: 'A',
    pattern_table: [[0, 1.0], [180, 0.0], [359, 1.0]]   // null toward south (180°)
  };
  // Place "nearby" 40 km south — bearing from subject toward nearby is 180°.
  const nearby = {
    call: 'KNRB-FM', frequency_mhz: 100.7, erp_kw: 50, haat_m: 150,
    lat: 39.64, lon: -100.0, fcc_class: 'B'
  };
  const omni = studyContourPair(
    { ...subject, pattern_table: null }, nearby,
    { relationship: 'co-channel', du_threshold_db: 20, protected_field_dbu: 54 }
  );
  const dir = studyContourPair(
    subject, nearby,
    { relationship: 'co-channel', du_threshold_db: 20, protected_field_dbu: 54 }
  );
  // The directional pair should produce a smaller U field and therefore
  // a higher D/U margin.
  assert.equal(dir.directional_pattern_applied, true);
  assert.equal(omni.directional_pattern_applied, false);
  if (dir.pass !== null && omni.pass !== null){
    assert.ok(dir.du_actual_db > omni.du_actual_db,
      `directional D/U ${dir.du_actual_db} should exceed omni D/U ${omni.du_actual_db}`);
  }
});

/* ---------- §73.187 integration ---------- */

test('§73.187: directional pattern_table on subject reduces forward-leg skywave field', () => {
  const SUBJECT = {
    call: 'KAM', facility_id: 's-am', fcc_class: 'B',
    frequency_khz: 1240, erp_kw: 1.0, ground_sigma_msm: 8,
    lat: 33.45, lon: -112.07
  };
  const N_omni = {
    call: 'KNRB-AM', facility_id: 'n-am-1', fcc_class: 'B',
    frequency_khz: 1240, erp_kw: 5, ground_sigma_msm: 8,
    lat: 38.0, lon: -112.07
  };
  const omni = checkSection73187({ subject: SUBJECT, nearbyStations: [N_omni] });
  // Add a pattern_table to the SUBJECT that nulls toward the bearing
  // to N (≈ 0° / due-north); the forward-leg skywave field should drop.
  const SUBJECT_DA = { ...SUBJECT, pattern_table: [[0, 0.1], [90, 1.0], [180, 1.0], [270, 1.0]] };
  const da = checkSection73187({ subject: SUBJECT_DA, nearbyStations: [N_omni] });
  const omni_fwd = omni.studies[0].forward;
  const da_fwd   = da.studies[0].forward;
  // Both legs ran (relationship is restricted) — DA forward should
  // produce a smaller skywave field than omni forward.
  if (omni_fwd.skywave_field_mvm != null && da_fwd.skywave_field_mvm != null){
    assert.ok(da_fwd.skywave_field_mvm < omni_fwd.skywave_field_mvm,
      `DA forward skywave ${da_fwd.skywave_field_mvm} should be < omni forward ${omni_fwd.skywave_field_mvm}`);
    assert.equal(da_fwd.directional_pattern_applied, true);
    assert.equal(omni_fwd.directional_pattern_applied, false);
  }
});

/* ---------- provenance ---------- */

test('AM_DIRECTIONAL_PROVENANCE names §73.62, §73.45, §73.150, license', () => {
  assert.match(AM_DIRECTIONAL_PROVENANCE.regulation, /73\.62/);
  assert.match(AM_DIRECTIONAL_PROVENANCE.regulation, /73\.45/);
  assert.match(AM_DIRECTIONAL_PROVENANCE.regulation, /73\.150/);
  assert.match(AM_DIRECTIONAL_PROVENANCE.power_scaling, /f\(az\)²/);
  assert.match(AM_DIRECTIONAL_PROVENANCE.license_basis, /17 U\.S\.C\. § 105/);
});
