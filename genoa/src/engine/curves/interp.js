// Pure 1-D / 2-D interpolation helpers.
// All FCC curves are tabulated; every contour distance comes from one of
// these calls.  Method choice (linear | log10) is recorded on every
// exhibit so the answer is reproducible against the dataset version.

export function lerp1(xs, ys, x){
  if (x <= xs[0])              return ys[0];
  if (x >= xs[xs.length - 1])  return ys[ys.length - 1];
  for (let i = 0; i < xs.length - 1; i++){
    if (x >= xs[i] && x <= xs[i+1]){
      const t = (x - xs[i]) / (xs[i+1] - xs[i]);
      return ys[i] * (1 - t) + ys[i+1] * t;
    }
  }
  return ys[ys.length - 1];
}

// Bilinear over a (rows × cols) grid.  axisRows / axisCols ascend.
// f(rowVal, colVal) -> grid[rowIdx][colIdx]
export function bilinear(axisRows, axisCols, grid, rowVal, colVal){
  const r = clampIndex(axisRows, rowVal);
  const c = clampIndex(axisCols, colVal);
  const r0 = r.lo, r1 = r.hi, tr = r.t;
  const c0 = c.lo, c1 = c.hi, tc = c.t;
  const v00 = grid[r0][c0];
  const v01 = grid[r0][c1];
  const v10 = grid[r1][c0];
  const v11 = grid[r1][c1];
  const v0  = v00 * (1 - tc) + v01 * tc;
  const v1  = v10 * (1 - tc) + v11 * tc;
  return v0 * (1 - tr) + v1 * tr;
}

function clampIndex(axis, v){
  if (v <= axis[0])              return { lo: 0, hi: 0, t: 0 };
  if (v >= axis[axis.length-1])  return { lo: axis.length-1, hi: axis.length-1, t: 0 };
  for (let i = 0; i < axis.length - 1; i++){
    if (v >= axis[i] && v <= axis[i+1]){
      return { lo: i, hi: i+1, t: (v - axis[i]) / (axis[i+1] - axis[i]) };
    }
  }
  return { lo: axis.length-1, hi: axis.length-1, t: 0 };
}

export const INTERP_METHODS = Object.freeze({
  LINEAR_LINEAR:    'linear-linear',
  LINEAR_LOG10:     'linear-log10',
  LOG10_LOG10:      'log10-log10'
});
