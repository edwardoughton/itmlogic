// Parse a directional antenna pattern table.
// Accepted line formats:
//   "azimuth, relative_field"
//   "azimuth  relative_field"
// Comments starting with '#' or '//' are ignored.
// Returns null for empty / unparseable input.  Pairs are sorted by azimuth.

export function parsePatternTable(txt){
  if (!txt || !txt.trim()) return null;
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
