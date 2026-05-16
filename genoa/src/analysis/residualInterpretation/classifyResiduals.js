// SDR residual classification + summary statistics.
//
// PURE ANALYSIS LAYER.  No FCC math, no compliance logic.
//
// Thresholds (engineering-advisory):
//   |Δ| < 6 dB           ⇒ WITHIN_EXPECTATION
//   6 dB ≤ |Δ| ≤ 10 dB   ⇒ MODERATE_DEVIATION
//   |Δ| > 10 dB           ⇒ SIGNIFICANT_DEVIATION
//
// summarizeResiduals(table) accepts an array of objects with at least a
// numeric residual (in dB) and an optional azimuth.  Recognized fields:
//   { azimuth_deg, residual_db }
//   { az,           residual_db }
//   { azimuth_deg, delta_db    }
//   { az,           delta_db    }

export const WITHIN_DB     = 6;
export const MODERATE_DB   = 10;

export const CLASS_WITHIN       = 'WITHIN_EXPECTATION';
export const CLASS_MODERATE     = 'MODERATE_DEVIATION';
export const CLASS_SIGNIFICANT  = 'SIGNIFICANT_DEVIATION';
export const CLASS_UNKNOWN      = 'UNKNOWN';

export function classifyResidual(delta_db){
  if (delta_db == null || delta_db === '') return CLASS_UNKNOWN;
  const d = Number(delta_db);
  if (!Number.isFinite(d)) return CLASS_UNKNOWN;
  const abs = Math.abs(d);
  if (abs < WITHIN_DB)        return CLASS_WITHIN;
  if (abs <= MODERATE_DB)     return CLASS_MODERATE;
  return CLASS_SIGNIFICANT;
}

export function summarizeResiduals(table){
  const rows = normalizeRows(table);
  if (!rows.length){
    return {
      available:           false,
      n_samples:           0,
      n_within:            0,
      n_moderate:          0,
      n_significant:       0,
      mean_db:             null,
      rms_db:              null,
      worst_case:          null,
      percent_significant: 0,
      percent_moderate:    0,
      percent_within:      0,
      dominant_direction:  null
    };
  }

  let sum = 0, sqSum = 0;
  let nW = 0, nM = 0, nS = 0;
  let worst = rows[0];
  for (const r of rows){
    sum   += r.residual_db;
    sqSum += r.residual_db * r.residual_db;
    const cls = classifyResidual(r.residual_db);
    if (cls === CLASS_SIGNIFICANT) nS++;
    else if (cls === CLASS_MODERATE) nM++;
    else if (cls === CLASS_WITHIN) nW++;
    if (Math.abs(r.residual_db) > Math.abs(worst.residual_db)) worst = r;
  }
  const n = rows.length;
  const mean = sum / n;
  const rms  = Math.sqrt(sqSum / n);

  // Dominant direction: circular mean of the bearings of the top-quartile
  // worst |Δ| samples (or all samples if fewer than 4).
  const dominant_direction = computeDominantDirection(rows);

  return {
    available:           true,
    n_samples:           n,
    n_within:            nW,
    n_moderate:          nM,
    n_significant:       nS,
    mean_db:             round2(mean),
    rms_db:              round2(rms),
    worst_case: {
      azimuth_deg:       Number.isFinite(worst.azimuth_deg) ? worst.azimuth_deg : null,
      residual_db:       round2(worst.residual_db),
      classification:    classifyResidual(worst.residual_db)
    },
    percent_within:       pct(nW, n),
    percent_moderate:     pct(nM, n),
    percent_significant:  pct(nS, n),
    dominant_direction
  };
}

// ─────────── helpers ───────────

function normalizeRows(table){
  if (!Array.isArray(table)) return [];
  const out = [];
  for (const t of table){
    if (!t || typeof t !== 'object') continue;
    const az = Number.isFinite(t.azimuth_deg) ? Number(t.azimuth_deg)
             : Number.isFinite(t.az)          ? Number(t.az)
             : null;
    const d  = Number.isFinite(t.residual_db) ? Number(t.residual_db)
             : Number.isFinite(t.delta_db)    ? Number(t.delta_db)
             : null;
    if (d == null) continue;
    out.push({ azimuth_deg: az, residual_db: d });
  }
  return out;
}

function computeDominantDirection(rows){
  const withAz = rows.filter(r => Number.isFinite(r.azimuth_deg));
  if (!withAz.length) return null;
  // top-quartile worst — at least 1 sample.
  const sorted = withAz.slice().sort((a, b) => Math.abs(b.residual_db) - Math.abs(a.residual_db));
  const qLen = Math.max(1, Math.ceil(sorted.length / 4));
  const top  = sorted.slice(0, qLen);
  // Circular mean (weighted by |Δ|).
  let sx = 0, sy = 0, sw = 0;
  for (const r of top){
    const w = Math.abs(r.residual_db);
    const a = r.azimuth_deg * Math.PI / 180;
    sx += w * Math.cos(a);
    sy += w * Math.sin(a);
    sw += w;
  }
  if (sw === 0) return null;
  let bearing = Math.atan2(sy, sx) * 180 / Math.PI;
  bearing = (bearing + 360) % 360;
  return {
    bearing_deg: Math.round(bearing * 10) / 10,
    compass:     toCompass(bearing),
    n_samples:   top.length
  };
}

function toCompass(deg){
  const sectors = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  // 8-sector compass; each sector = 45°, centred on the cardinal.
  const idx = Math.round(((deg % 360) / 45)) % 8;
  return sectors[idx];
}

function pct(num, den){ return den ? Math.round(1000 * num / den) / 10 : 0; }
function round2(x){ return Number.isFinite(x) ? Math.round(x * 100) / 100 : null; }
