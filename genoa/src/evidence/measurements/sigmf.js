// SigMF capture handling — parses a sigmf-meta JSON document and folds
// per-capture geolocation + annotated dBu labels into the measurement
// evidence block.  Calibration metadata is required for the record to
// be marked `calibrated: true`.
//
// This module is pure (no I/O).  The measurement sidecar (or the worker)
// is responsible for fetching the SigMF object from object storage and
// passing the parsed JSON in.

export function parseSigmfMeta(meta, { source = 'unknown' } = {}){
  const g = meta.global || {};
  const captures    = meta.captures    || [];
  const annotations = meta.annotations || [];

  const calibrated = !!(
    g['core:hw'] &&
    g['core:sample_rate'] &&
    g['genoa:calibration_dB'] !== undefined
  );

  const records = captures.map((c, i) => {
    const lat = c['core:geolocation']?.coordinates?.[1] ?? null;
    const lon = c['core:geolocation']?.coordinates?.[0] ?? null;
    const ts  = c['core:datetime'] || null;
    const annLabel = annotations[i]?.['core:label'] || '';
    const m = annLabel.match(/(-?\d+(?:\.\d+)?)\s*dBu/i);
    const measured_dBu = m ? parseFloat(m[1]) : null;
    return {
      index: i,
      lat, lon, timestamp: ts,
      measured_dBu,
      label: annLabel || null,
      raw: c
    };
  });

  return {
    available:       true,
    source,
    calibrated,
    calibration_dB:  calibrated ? g['genoa:calibration_dB'] : null,
    hw:              g['core:hw'] || null,
    sample_rate:     g['core:sample_rate'] || null,
    author:          g['core:author'] || null,
    n_records:       records.length,
    records
  };
}
