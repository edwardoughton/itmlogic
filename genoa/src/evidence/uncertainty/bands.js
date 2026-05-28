// Uncertainty-band helpers.  Genoa records uncertainty as an explicit
// block; it never silently widens or narrows engineering numbers.
//
// For FM F(50,50) → F(50,10) the canonical "interference contour"
// margin is roughly +6..+10 dB on the field; this module produces an
// ADVISORY band derived from the dataset axes only, never from the
// final reported contour distance.

export function fmFieldUncertaintyBand({ method }){
  // Advisory only; not a calibrated CI.  Engineering review required.
  return {
    method,
    type:                'advisory',
    field_dB_plus_minus: 6,
    notes: 'Advisory ±6 dB band reflects the gap between FCC F(50,50) and F(50,10) statistical curves. Not a calibrated confidence interval. Replace with measurement-derived uncertainty when SDR evidence is attached.',
    source: '47 CFR §73.333 statistical interpretation'
  };
}
