// HAAT source: user-entered flat HAAT (m).  No terrain sampling.
// Every radial reports the same value; haat_source = 'user_flat'.

export function flatHaatPerRadial(radials_deg, haat_m){
  return radials_deg.map(az => ({
    az,
    haat_input_m:           haat_m,
    haat_computed_m:        haat_m,
    haat_source:            'user_flat',
    terrain_profile_source: null
  }));
}
