import test from 'node:test';
import assert from 'node:assert/strict';
import { ingestMeasurementsToResiduals } from '../evidence/measurementIngest.js';

const R_EARTH = 6371.0088;

function destLatLon(lat, lon, azDeg, km){
  const br = azDeg * Math.PI / 180;
  const d  = km / R_EARTH;
  const φ1 = lat * Math.PI / 180;
  const λ1 = lon * Math.PI / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(d) + Math.cos(φ1) * Math.sin(d) * Math.cos(br));
  const λ2 = λ1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(φ1),
                             Math.cos(d) - Math.sin(φ1) * Math.sin(φ2));
  return [φ2 * 180 / Math.PI, λ2 * 180 / Math.PI];
}

// Synthetic 4 points-per-azimuth × 5 distances × 2 azimuths drive log.
function buildDriveLog(tx, refField, ladder, azs, distances, residualDbPerAz){
  const points = [];
  for (const az of azs){
    for (const km of distances){
      const [lat, lon] = destLatLon(tx.lat, tx.lon, az, km);
      // Predict via the same log-linear ladder the module uses.
      const predicted = predictField(km, [{ km: 1, field_mvm: refField }].concat(
        ladder.map((l) => ({ km: l.mean_radius_km, field_mvm: l.field_mvm }))
      ).sort((a, b) => a.km - b.km));
      const measured = predicted * Math.pow(10, residualDbPerAz[az] / 20);
      for (let i = 0; i < 4; i++) points.push({ lat, lon, measured_mVm: measured });
    }
  }
  return points;
}
function predictField(km, anchors){
  if (km <= anchors[0].km) return anchors[0].field_mvm;
  for (let i = 1; i < anchors.length; i++){
    if (km <= anchors[i].km){
      const k0 = anchors[i-1], k1 = anchors[i];
      const t = Math.log10(km / k0.km) / Math.log10(k1.km / k0.km);
      return k0.field_mvm * Math.pow(10, t * Math.log10(k1.field_mvm / k0.field_mvm));
    }
  }
  return anchors[anchors.length-1].field_mvm;
}

test('measurement ingest — synthetic + drive log produces exact residual per azimuth', () => {
  const tx = { lat: 34.8606, lon: -111.8206 };
  const ladder = [
    { id: 'city_5mvm', field_mvm: 5,    mean_radius_km: 13 },
    { id: 'primary_2mvm', field_mvm: 2, mean_radius_km: 24 },
    { id: 'secondary_05mvm', field_mvm: 0.5, mean_radius_km: 53 }
  ];
  const points = buildDriveLog(tx, 224, ladder, [0, 90], [5, 10, 20, 30, 50], { 0: -2, 90: +1 });
  const out = ingestMeasurementsToResiduals({
    tx, contour_set: ladder, reference_field_mVm_at_1km: 224, points
  });
  assert.equal(out.available, true);
  const az0 = out.rows.find((r) => r.azimuth_deg === 0);
  const az90 = out.rows.find((r) => r.azimuth_deg === 90);
  assert.equal(az0.residual_db, -2);
  assert.equal(az90.residual_db, 1);
});

test('measurement ingest — RMS summary blends both bins correctly', () => {
  const tx = { lat: 34.86, lon: -111.82 };
  const ladder = [{ id: 'city_5mvm', field_mvm: 5, mean_radius_km: 13 }];
  const points = buildDriveLog(tx, 224, ladder, [0, 90], [5, 10], { 0: -2, 90: +1 });
  const out = ingestMeasurementsToResiduals({
    tx, contour_set: ladder, reference_field_mVm_at_1km: 224, points
  });
  // RMS over residuals [+1, +1, +1, +1, +1, +1, +1, +1] east-bin and
  // [-2, -2, ...] north-bin = sqrt((8 + 32) / 16) = sqrt(2.5) ≈ 1.58
  assert.ok(Math.abs(out.summary.rms_residual_db - 1.58) < 0.05);
});

test('measurement ingest — invalid points are dropped with reason codes', () => {
  const tx = { lat: 34.86, lon: -111.82 };
  const ladder = [{ id: 'city_5mvm', field_mvm: 5, mean_radius_km: 13 }];
  const out = ingestMeasurementsToResiduals({
    tx, contour_set: ladder, reference_field_mVm_at_1km: 224,
    points: [
      { lat: 'foo', lon: -111.5, measured_mVm: 10 },
      { lat: 34.9, lon: -111.5, measured_mVm: -3 },
      { lat: 34.9, lon: -111.5, measured_mVm: 0 }
    ]
  });
  assert.equal(out.n_points_used, 0);
  assert.equal(out.n_points_dropped, 3);
  assert.equal(out.dropped_points[0].reason, 'invalid_lat_lon');
  assert.equal(out.dropped_points[1].reason, 'measured_mvm_invalid');
});

test('measurement ingest — empty inputs return available:false with reason', () => {
  const out = ingestMeasurementsToResiduals({
    tx: { lat: 34, lon: -111 }, contour_set: [], reference_field_mVm_at_1km: 224, points: []
  });
  assert.equal(out.available, false);
  assert.ok(out.reason);
});

test('measurement ingest — small-bin p10/p90 interpolation (not Math.floor min/max)', () => {
  // Force a 5-point bin with residuals [-2, -1, 0, +1, +2].
  // p10 should be ~ -1.6 (between -2 and -1 at 10th percentile of n=5).
  // Pre-fix: p10 was -2 (Math.floor returned index 0).
  const tx = { lat: 34.86, lon: -111.82 };
  const ladder = [{ id: 'city_5mvm', field_mvm: 5, mean_radius_km: 13 }];
  const ref = 224;
  const km = 5;
  const predicted = predictField(km, [{ km: 1, field_mvm: ref }, { km: 13, field_mvm: 5 }]);
  const [lat, lon] = destLatLon(tx.lat, tx.lon, 0, km);
  const residuals_db = [-2, -1, 0, 1, 2];
  const points = residuals_db.map((db) => ({
    lat, lon, measured_mVm: predicted * Math.pow(10, db / 20)
  }));
  const out = ingestMeasurementsToResiduals({
    tx, contour_set: ladder, reference_field_mVm_at_1km: ref, points
  });
  const bin = out.rows.find((r) => r.azimuth_deg === 0);
  // Linear interp: position 0.4 between sorted[0]=-2 and sorted[1]=-1
  // gives -1.6.  Min must be exactly -2 (extreme).
  assert.equal(bin.min_db, -2);
  assert.ok(bin.p10_db > -2 && bin.p10_db <= -1, `p10 ${bin.p10_db} should be in (-2, -1]`);
});
