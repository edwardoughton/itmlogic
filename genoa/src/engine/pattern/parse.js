// Parse a directional antenna pattern table.
// Accepted line formats:
//   "azimuth, relative_field"
//   "azimuth  relative_field"
// Comments starting with '#' or '//' are ignored.
// Returns null for empty / unparseable input.  Pairs are sorted by azimuth.

export function parsePatternTable(input){
  if (input == null) return null;
  // Pre-parsed pair array from AmDaDesigner (App.jsx onApplyAmDaPattern
  // sets inputs.pattern_table = [[az, field], …] directly).  Was being
  // fed straight into String.trim and threw "txt.trim is not a function"
  // when an AM Class D station with a DA pattern hit compute.
  if (Array.isArray(input)){
    const pts = [];
    for (const row of input){
      if (!Array.isArray(row) || row.length < 2) continue;
      const az = ((Number(row[0]) % 360) + 360) % 360;
      const f  = Number(row[1]);
      if (!Number.isFinite(az) || !Number.isFinite(f)) continue;
      if (f < 0 || f > 1.5) continue;
      pts.push([az, f]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    return pts.length ? pts : null;
  }
  // Object form { az: field, … } — defensive for any caller stashing
  // a dict.  Treat keys as azimuth strings.
  if (typeof input === 'object'){
    const pts = [];
    for (const [k, v] of Object.entries(input)){
      const az = ((Number(k) % 360) + 360) % 360;
      const f  = Number(v);
      if (!Number.isFinite(az) || !Number.isFinite(f)) continue;
      if (f < 0 || f > 1.5) continue;
      pts.push([az, f]);
    }
    pts.sort((a, b) => a[0] - b[0]);
    return pts.length ? pts : null;
  }
  const txt = String(input);
  if (!txt.trim()) return null;
  const pts = [];
  for (let line of txt.split(/\r?\n/)){
    line = line.replace(/(#|\/\/).*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^(-?\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)/);
    if (!m) continue;
    const az = ((parseFloat(m[1]) % 360) + 360) % 360;
    const f  = parseFloat(m[2]);
    if (f < 0 || f > 1.5) continue;
    pts.push([az, f]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  return pts.length ? pts : null;
}
