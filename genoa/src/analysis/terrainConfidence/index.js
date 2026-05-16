// Terrain-aware confidence analysis — pipeline entry point.
//
// PURE ANALYSIS LAYER.  Reads from a computed exhibit; produces a
// summary object that callers may attach as
//   exhibit.engineering_confidence = analyzeTerrainConfidence(exhibit)
// without modifying any FCC curve, contour, distance, or compliance
// output already on the exhibit.
//
// This module never mutates the exhibit it reads.

import { computeTerrainMetrics }          from './terrainMetrics.js';
import { computeCurveDeviation }          from './curveDeviation.js';
import { radialConfidence }               from './radialConfidence.js';
import { aggregateEngineeringConfidence } from './confidenceScoring.js';

export {
  computeTerrainMetrics,
  computeCurveDeviation,
  radialConfidence,
  aggregateEngineeringConfidence
};

export function analyzeTerrainConfidence(exhibit){
  if (!exhibit || typeof exhibit !== 'object'){
    return aggregateEngineeringConfidence([]);
  }
  const radials = Array.isArray(exhibit.radial_table) ? exhibit.radial_table : [];
  const sdrByAz = indexSdrResidualsByAzimuth(exhibit);
  const itmByAz = indexItmDeltasByAzimuth(exhibit);

  const per_radial = radials.map(r => {
    const terrain = computeTerrainMetrics(r);
    const az = Number.isFinite(r.azimuth_deg) ? r.azimuth_deg : null;
    return radialConfidence({
      terrain,
      sdr_residual_db: sdrByAz.get(az) ?? null,
      itm_delta_db:    itmByAz.get(az) ?? null,
      azimuth_deg:     az
    });
  });

  return aggregateEngineeringConfidence(per_radial);
}

function indexSdrResidualsByAzimuth(exhibit){
  const map = new Map();
  const cal = exhibit?.evidence?.sdr_calibration;
  const rows = cal && Array.isArray(cal.residuals) ? cal.residuals
             : Array.isArray(exhibit?.evidence?.sdr_residuals) ? exhibit.evidence.sdr_residuals
             : [];
  for (const row of rows){
    const az = Number.isFinite(row?.azimuth_deg) ? row.azimuth_deg : null;
    const d  = Number.isFinite(row?.residual_db) ? row.residual_db
             : Number.isFinite(row?.delta_db)    ? row.delta_db
             : null;
    if (az != null && d != null) map.set(az, d);
  }
  return map;
}

function indexItmDeltasByAzimuth(exhibit){
  const map = new Map();
  const rows = Array.isArray(exhibit?.coverage?.itm_radials) ? exhibit.coverage.itm_radials
             : Array.isArray(exhibit?.itm_cross_check?.radials) ? exhibit.itm_cross_check.radials
             : [];
  for (const row of rows){
    const az = Number.isFinite(row?.azimuth_deg) ? row.azimuth_deg
             : Number.isFinite(row?.az)          ? row.az
             : null;
    let d = null;
    if (Number.isFinite(row?.delta_db)) d = row.delta_db;
    else if (Number.isFinite(row?.fcc_field_dbu) && Number.isFinite(row?.itm_field_dbu)){
      d = row.itm_field_dbu - row.fcc_field_dbu;
    }
    if (az != null && d != null) map.set(az, d);
  }
  return map;
}
