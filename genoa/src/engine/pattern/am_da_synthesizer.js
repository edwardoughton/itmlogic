// AM directional antenna pattern synthesizer — closed-form ground-wave
// horizontal pattern from a tower-array specification.
//
// SCOPE
//   Computes E(θ) at elevation = 0 (ground-wave plane), which is what
//   §73.182 groundwave protection and §73.187 nighttime skywave use.
//   For elevation-dependent patterns (e.g. skywave radiation toward
//   shielded directions) hand the same geometry to the NEC sidecar
//   (engine/pattern/am_da_nec.js, Tier-2).
//
// FORMULATION (47 CFR §73.150, IEEE Std 145, Carl Smith / Jordan & Balmain)
//
//   For an array of N vertical towers at ground level, the horizontal
//   field at azimuth θ is the phasor sum of each tower's contribution:
//
//     E(θ) = Σ_{i=1..N}  I_i · A_i(elev=0) · e^{j·(φ_i + S_i·cos(θ − β_i))}
//
//   where:
//     I_i  — drive current ratio (relative amplitude)
//     φ_i  — drive phase, radians
//     S_i  — electrical spacing of tower i from reference, radians
//            S_i = (2π · d_i) / λ
//     β_i  — bearing of tower i from reference, radians (true-N = 0,
//            clockwise per §73.150)
//     d_i  — physical distance from reference to tower i, meters
//     λ    — wavelength = c / f = 299_792_458 / (frequency_kHz · 1000)
//
//   A_i(elev=0) = vertical pattern factor at elevation 0.  For a
//   vertical monopole over a perfectly conducting ground plane:
//
//     A(elev) = (cos(g · sin(elev)) − cos(g)) / ((1 − cos(g)) · cos(elev))
//
//   At elev=0 this collapses to A = 1 for all g ∈ (0, π], so for the
//   ground-wave azimuthal pattern we drop A entirely.
//
//   Normalize so max|E(θ)| = 1.0 → f(θ) ∈ [0, 1] (the §73.150 pattern
//   data format).

const C_M_PER_S       = 299_792_458;
const NULL_THRESHOLD  = 0.10;       // f ≤ 0.10 counts as a null
const STEP_DEG        = 1;          // azimuth resolution

const RAD = Math.PI / 180;

function wavelengthM(frequency_khz){
  if (!Number.isFinite(frequency_khz) || frequency_khz <= 0){
    throw new Error(`invalid frequency_khz: ${frequency_khz}`);
  }
  return C_M_PER_S / (frequency_khz * 1000);
}

function validateTower(t, i){
  if (!t || typeof t !== 'object'){
    throw new Error(`tower[${i}] must be an object`);
  }
  const distance_m  = Number(t.distance_m  ?? 0);
  const bearing_deg = Number(t.bearing_deg ?? 0);
  const current     = Number(t.current_ratio ?? 1);
  const phase_deg   = Number(t.phase_deg     ?? 0);
  const elec_h_deg  = Number(t.electrical_height_deg ?? 90);
  if (!Number.isFinite(distance_m)  || distance_m  < 0)   throw new Error(`tower[${i}].distance_m must be ≥ 0`);
  if (!Number.isFinite(bearing_deg))                       throw new Error(`tower[${i}].bearing_deg must be finite`);
  if (!Number.isFinite(current)     || current      < 0)   throw new Error(`tower[${i}].current_ratio must be ≥ 0`);
  if (!Number.isFinite(phase_deg))                         throw new Error(`tower[${i}].phase_deg must be finite`);
  if (!Number.isFinite(elec_h_deg)  || elec_h_deg   <= 0)  throw new Error(`tower[${i}].electrical_height_deg must be > 0`);
  return { distance_m, bearing_deg, current, phase_deg, elec_h_deg, id: t.id || `T${i + 1}` };
}

export function synthesizeAmDaPattern({ frequency_khz, towers } = {}){
  if (!Array.isArray(towers) || towers.length === 0){
    throw new Error('towers must be a non-empty array');
  }
  if (towers.length > 12){
    throw new Error('towers.length > 12 is not supported (max array size)');
  }
  const lambda = wavelengthM(frequency_khz);
  const tw = towers.map(validateTower);

  const consts = tw.map(t => ({
    I:    t.current,
    phi:  t.phase_deg * RAD,
    S:    (2 * Math.PI * t.distance_m) / lambda,
    beta: t.bearing_deg * RAD
  }));

  const table = [];
  let maxAbs = 0, minAbs = Infinity, maxAz = 0, minAz = 0;
  const absSeries = new Array(360 / STEP_DEG);

  for (let az = 0, k = 0; az < 360; az += STEP_DEG, k++){
    const theta = az * RAD;
    let re = 0, im = 0;
    for (const c of consts){
      const ang = c.phi + c.S * Math.cos(theta - c.beta);
      re += c.I * Math.cos(ang);
      im += c.I * Math.sin(ang);
    }
    const mag = Math.hypot(re, im);
    absSeries[k] = mag;
    if (mag > maxAbs){ maxAbs = mag; maxAz = az; }
    if (mag < minAbs){ minAbs = mag; minAz = az; }
  }

  if (maxAbs <= 0){
    throw new Error('synthesizeAmDaPattern: pattern is identically zero (check current ratios)');
  }

  let sumF = 0;
  const nulls = [];
  for (let az = 0, k = 0; az < 360; az += STEP_DEG, k++){
    const f = absSeries[k] / maxAbs;
    table.push([az, +f.toFixed(5)]);
    sumF += f;
    if (f <= NULL_THRESHOLD) nulls.push(az);
  }

  return {
    pattern_table:        table,
    max_field:            +maxAbs.toFixed(5),
    max_az_deg:           maxAz,
    min_field:            +minAbs.toFixed(5),
    min_az_deg:           minAz,
    null_directions_deg:  collapseRuns(nulls, STEP_DEG),
    mean_factor:          +(sumF / table.length).toFixed(4),
    wavelength_m:         +lambda.toFixed(3),
    n_towers:             towers.length,
    method:               'CARL_SMITH_GROUNDWAVE',
    method_reference:     '47 CFR §73.150 / IEEE Std 145 — phasor sum at elev=0',
    notes:                'Closed-form ground-wave horizontal pattern.  For full elevation pattern (skywave / NIF), use the NEC sidecar.'
  };
}

function collapseRuns(nulls, step){
  if (!nulls.length) return [];
  const out = [];
  let runStart = nulls[0], prev = nulls[0];
  for (let i = 1; i <= nulls.length; i++){
    const cur = nulls[i];
    const broke = cur === undefined || (cur - prev) > step;
    if (broke){
      out.push(+(((runStart + prev) / 2).toFixed(1)));
      runStart = cur;
    }
    prev = cur;
  }
  return out;
}

// Re-phase the array so a null lands at target_az_deg by adjusting the
// drive phase of one tower.  Greedy single-tower optimizer; for true
// multi-null protection you want a multi-variable solver, but this is
// the right MVP for "put a null at the bearing of a co-channel station".
export function nudgeNullToAzimuth(spec, target_az_deg, options = {}){
  const tower_index = Math.max(0, Math.min(spec.towers.length - 1, options.tower_index ?? 1));
  const step_deg    = options.phase_step_deg || 1;
  const span_deg    = options.search_span_deg || 360;
  const startPhase  = Number(spec.towers[tower_index].phase_deg) || 0;
  let bestPhase = startPhase;
  let bestNullDb = 0;
  for (let off = -span_deg / 2; off <= span_deg / 2; off += step_deg){
    const trial = {
      ...spec,
      towers: spec.towers.map((t, i) =>
        i === tower_index ? { ...t, phase_deg: startPhase + off } : t)
    };
    const r = synthesizeAmDaPattern(trial);
    const azIdx = Math.round(target_az_deg) % 360;
    const f = r.pattern_table[azIdx][1];
    const dbDown = f > 0 ? -20 * Math.log10(f) : 200;
    if (dbDown > bestNullDb){ bestNullDb = dbDown; bestPhase = startPhase + off; }
  }
  const adjusted_towers = spec.towers.map((t, i) =>
    i === tower_index ? { ...t, phase_deg: +(((bestPhase % 360) + 540) % 360 - 180).toFixed(2) } : t);
  return {
    adjusted_towers,
    achieved_null_db: +bestNullDb.toFixed(1),
    adjusted_tower_index: tower_index
  };
}
