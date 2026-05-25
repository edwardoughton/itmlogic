// Measurement ingestion — converts a drive-test / field-survey log
// into per-azimuth residuals (measured field strength minus predicted)
// that the engineering-confidence layer already knows how to read.
//
// Real-world reference: Hatfield & Dawson Mercer Slough Report (Nov
// 2002) "Tools of the trade — typical equipment setup for mobile FM
// field strength measurements" (Figure 1, p. 17).  Same flow we're
// implementing here: drive a calibrated receiver around the licensed
// service area; record (timestamp, lat, lon, freq, measured_field);
// compare to the curve prediction at each receive point; tabulate
// the residuals by azimuth.
//
// PIPELINE (this module = pure function; no IO):
//   1. Input: { tx: {lat, lon}, contour_distances_km: {city_5mvm:..,
//      primary_2mvm:..,...}, reference_field_mVm_at_1km: <RMS@1km>,
//      pattern: {<az>: <relative_field>} or null,
//      sigma_mS_m: <ground σ>, points: [<measurement>, ...] }
//   2. For each measurement point:
//        bearing      = great-circle bearing from tx to point
//        distance_km  = great-circle distance from tx to point
//        predicted    = field-at-distance from the contour curve set
//                       INTERPOLATED LOG-LINEARLY along distance
//        residual_db  = 20*log10(measured / predicted)
//   3. Bin by azimuth at the exhibit's radial step (default 10°).
//   4. Per bin: aggregate residual statistics (n, mean, stddev,
//      min, max, p10, p90).
//   5. Return rows in the shape evidence.sdr_calibration.residuals
//      expects:
//        [{ azimuth_deg, n, residual_db (= mean), stddev_db,
//           min_db, max_db, p10_db, p90_db, predicted_field_mvm_avg }]
//
// Failure modes are explicit in the return shape:
//   - point dropped because measured / predicted invalid → counted
//     in dropped_points with a reason code
//   - bin with < MIN_POINTS_PER_BIN points → flagged as
//     'sparse_sample' but the residual is still reported
//   - all-bin sparse → caller can decide whether to attach at all

const FIELD_FLOOR_MVM = 1e-6;   // 1e-6 mV/m floor for log10 safety
const MIN_POINTS_PER_BIN_DEFAULT = 3;

/**
 * @param {object}  args
 * @param {object}  args.tx                  { lat, lon }   (transmitter site)
 * @param {object[]} args.contour_set        [{id, field_mvm, mean_radius_km},...]
 *                                           sorted by field_mvm DESCENDING
 *                                           (city_5mvm, primary_2mvm, ...).
 *                                           Used to log-linearly interpolate
 *                                           predicted field at any distance.
 * @param {number}  args.reference_field_mVm_at_1km     RMS field at 1 km
 * @param {object[]} args.points             [{ lat, lon, measured_mVm,
 *                                              freq_khz?, t_iso? }, ...]
 * @param {number}  [args.radial_step_deg=10]
 * @param {number}  [args.min_points_per_bin=3]
 */
export function ingestMeasurementsToResiduals({
  tx,
  contour_set,
  reference_field_mVm_at_1km,
  points,
  radial_step_deg = 10,
  min_points_per_bin = MIN_POINTS_PER_BIN_DEFAULT
} = {}){
  const result = {
    available: false,
    method:    'per-azimuth residual aggregation from drive-test points',
    radial_step_deg,
    n_points_total:    Array.isArray(points) ? points.length : 0,
    n_points_used:     0,
    n_points_dropped:  0,
    dropped_points:    [],
    rows:              [],
    summary:           null,
    fetched_at:        new Date().toISOString()
  };

  if (!tx || !Number.isFinite(Number(tx.lat)) || !Number.isFinite(Number(tx.lon))){
    return { ...result, reason: 'tx { lat, lon } required' };
  }
  if (!Array.isArray(points) || points.length === 0){
    return { ...result, reason: 'points array empty or not supplied' };
  }
  if (!Array.isArray(contour_set) || contour_set.length === 0){
    return { ...result, reason: 'contour_set empty — need at least one (field_mvm, mean_radius_km) row for the prediction inverse' };
  }

  // Pre-sort contour_set descending field_mvm + ascending mean_radius_km
  // (a city-grade contour at 5 mV/m sits at a smaller radius than the
  // night-intf at 0.025 mV/m).  Filter out rows that don't carry both
  // field and radius — incomplete entries can't anchor an interpolator.
  const ladder = contour_set
    .filter((c) => Number.isFinite(Number(c.field_mvm)) && Number.isFinite(Number(c.mean_radius_km)))
    .map((c) => ({ field_mvm: Number(c.field_mvm), km: Number(c.mean_radius_km) }))
    .sort((a, b) => a.km - b.km);
  if (ladder.length === 0){
    return { ...result, reason: 'no usable (field, radius) pairs in contour_set' };
  }
  // Anchor inverse-distance reference at 1 km if RMS supplied.  This
  // gives the interpolator a near-tx anchor independent of the contour
  // set — without it we'd extrapolate poorly inside the smallest contour.
  if (Number.isFinite(Number(reference_field_mVm_at_1km)) && Number(reference_field_mVm_at_1km) > 0){
    ladder.unshift({ field_mvm: Number(reference_field_mVm_at_1km), km: 1.0 });
  }
  // Final sort + dedupe by km — multiple anchors at the same distance
  // collapse to the highest field (most conservative prediction).
  ladder.sort((a, b) => a.km - b.km);
  for (let i = 1; i < ladder.length; i++){
    if (Math.abs(ladder[i].km - ladder[i-1].km) < 1e-9){
      if (ladder[i].field_mvm < ladder[i-1].field_mvm){ ladder.splice(i, 1); i--; }
      else                                            { ladder.splice(i-1, 1); i--; }
    }
  }

  // Build per-azimuth bins.  Bin centers at 0, radial_step, 2*radial_step…
  const nBins = Math.max(1, Math.round(360 / radial_step_deg));
  const bins = Array.from({ length: nBins }, (_, i) => ({
    azimuth_deg: i * radial_step_deg,
    points:      [],
    predicted_field_mvm_avg: 0
  }));

  for (const p of points){
    const lat = Number(p?.lat); const lon = Number(p?.lon);
    const measured = Number(p?.measured_mVm);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)){
      result.dropped_points.push({ point: p, reason: 'invalid_lat_lon' });
      continue;
    }
    if (!Number.isFinite(measured) || measured <= 0){
      result.dropped_points.push({ point: p, reason: 'measured_mvm_invalid' });
      continue;
    }
    const bearing = greatCircleBearingDeg(Number(tx.lat), Number(tx.lon), lat, lon);
    const dKm     = greatCircleKm(Number(tx.lat), Number(tx.lon), lat, lon);
    const predicted = interpolatePredictedFieldMvm(dKm, ladder);
    if (!Number.isFinite(predicted) || predicted <= 0){
      result.dropped_points.push({ point: p, reason: 'no_predicted_field_at_distance', distance_km: dKm });
      continue;
    }
    const residual_db = 20 * Math.log10(Math.max(measured, FIELD_FLOOR_MVM)
                                      / Math.max(predicted, FIELD_FLOOR_MVM));
    const binIdx = Math.round(bearing / radial_step_deg) % nBins;
    bins[binIdx].points.push({
      bearing_deg: bearing,
      distance_km: dKm,
      measured_mVm: measured,
      predicted_mVm: predicted,
      residual_db
    });
    result.n_points_used += 1;
  }
  result.n_points_dropped = result.dropped_points.length;

  // Aggregate per bin.
  for (const bin of bins){
    if (bin.points.length === 0){
      result.rows.push({
        azimuth_deg:        bin.azimuth_deg,
        n:                  0,
        residual_db:        null,
        stddev_db:          null,
        min_db:             null,
        max_db:             null,
        p10_db:             null,
        p90_db:             null,
        predicted_field_mvm_avg: null,
        status:             'no_points'
      });
      continue;
    }
    const residuals  = bin.points.map((q) => q.residual_db);
    const predicteds = bin.points.map((q) => q.predicted_mVm);
    const mean = residuals.reduce((s, v) => s + v, 0) / residuals.length;
    const variance = residuals.reduce((s, v) => s + (v - mean) ** 2, 0) / residuals.length;
    const stddev = Math.sqrt(variance);
    residuals.sort((a, b) => a - b);
    // Linear-interpolated percentile.  Audit fix — prior Math.floor
    // approach made p10 the minimum for n ≤ 9, which is wrong for
    // small bins.  At n=5: position 0.4 between residuals[0] and
    // residuals[1] yields a real 10th-percentile estimate.
    const p10 = percentileInterp(residuals, 0.10);
    const p90 = percentileInterp(residuals, 0.90);
    result.rows.push({
      azimuth_deg:        bin.azimuth_deg,
      n:                  bin.points.length,
      residual_db:        round2(mean),
      stddev_db:          round2(stddev),
      min_db:             round2(Math.min(...residuals)),
      max_db:             round2(Math.max(...residuals)),
      p10_db:             round2(p10),
      p90_db:             round2(p90),
      predicted_field_mvm_avg: round3(predicteds.reduce((s, v) => s + v, 0) / predicteds.length),
      status:             bin.points.length >= min_points_per_bin ? 'measured' : 'sparse_sample'
    });
  }

  // Whole-exhibit summary stats.
  const usedRows = result.rows.filter((r) => r.n > 0 && Number.isFinite(r.residual_db));
  if (usedRows.length > 0){
    const allResiduals = bins.flatMap((b) => b.points.map((q) => q.residual_db));
    const sqSum = allResiduals.reduce((s, v) => s + v * v, 0);
    const rms_residual_db = Math.sqrt(sqSum / allResiduals.length);
    result.summary = {
      n_azimuths_measured: usedRows.length,
      n_azimuths_total:    nBins,
      rms_residual_db:     round2(rms_residual_db),
      mean_residual_db:    round2(allResiduals.reduce((s, v) => s + v, 0) / allResiduals.length),
      max_abs_residual_db: round2(Math.max(...allResiduals.map(Math.abs)))
    };
    result.available = true;
  }
  return result;
}

// Log-linear interpolation of predicted field along distance using the
// (field, km) ladder.  At the inner anchor (1 km, ref field) and outer
// anchor (last contour), the interpolation is exact.  Between anchors,
// log10(field) is linear in log10(km) — the standard FCC curve form.
function interpolatePredictedFieldMvm(km, ladder){
  if (km <= ladder[0].km) return ladder[0].field_mvm;
  for (let i = 1; i < ladder.length; i++){
    if (km <= ladder[i].km){
      const k0 = ladder[i-1], k1 = ladder[i];
      const logKmRatio = Math.log10(Math.max(km, 1e-6) / Math.max(k0.km, 1e-6));
      const logKmSpan  = Math.log10(Math.max(k1.km, 1e-6) / Math.max(k0.km, 1e-6));
      const t = logKmSpan > 0 ? logKmRatio / logKmSpan : 0;
      const logFieldSpan = Math.log10(Math.max(k1.field_mvm, FIELD_FLOOR_MVM)
                                    / Math.max(k0.field_mvm, FIELD_FLOOR_MVM));
      return Math.max(k0.field_mvm, FIELD_FLOOR_MVM) * Math.pow(10, t * logFieldSpan);
    }
  }
  return ladder[ladder.length - 1].field_mvm;
}

function greatCircleKm(lat1, lon1, lat2, lon2){
  const R = 6371.0088;
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(Δφ/2)**2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function greatCircleBearingDeg(lat1, lon1, lat2, lon2){
  const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
  const Δλ = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}
function round2(x){ return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; }
function round3(x){ return Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null; }

// Linear-interpolated percentile over a sorted ascending array.  At
// p=0 returns the min, at p=1 returns the max, between returns a
// linear blend between the two surrounding order statistics.
function percentileInterp(sorted, p){
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * Math.max(0, Math.min(1, p));
  const i   = Math.floor(pos);
  const f   = pos - i;
  return i + 1 < sorted.length ? sorted[i] * (1 - f) + sorted[i + 1] * f : sorted[i];
}
