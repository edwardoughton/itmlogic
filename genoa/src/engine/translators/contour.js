// FM translator / booster service + interfering contours.
//
// 47 CFR §74.1204 (FM translator interference) is structured around two
// curve families:
//
//   (a) F(50,50) — service contour of every FM/LPFM/translator station.
//       The translator's protected service contour is 60 dBu (1 mV/m)
//       per §74.1235.  The protected contours of nearby PRIMARY stations
//       are class-dependent (60 dBu for Class A, LPFM, and translators;
//       54 dBu for Class B, B1, C0/C1/C2/C3/C).
//
//   (b) F(50,10) — interfering contour.  §74.1204(a)+(c) prohibits any
//       authorization where the proposed translator's F(50,10) field
//       strength `U` would, at the protected-contour edge of any nearby
//       station, fail the D/U gate for the channel relationship:
//
//         Co-channel (Δf =       0 kHz): D/U ≥  20 dB
//         1st-adj    (Δf = ±  200 kHz): D/U ≥   6 dB
//         2nd-adj    (Δf = ±  400 kHz): D/U ≥ -40 dB
//         3rd-adj    (Δf = ±  600 kHz): D/U ≥ -40 dB
//         IF         (Δf = ±10.6/10.8 MHz): D/U ≥ -40 dB
//
//       Equivalently: the translator's F(50,10) interfering contour at
//       U_threshold = D - DU_gate is the locus of points where, if any
//       other station's protected contour edge falls inside, §74.1204(a)
//       is violated.  This file emits those interfering contours so an
//       engineer can SEE the geographic exclusion zones on the same map
//       as the service contour.  The actual per-station D/U comparison
//       (which requires a list of nearby primaries) is performed by
//       src/engine/regulatory/translator.js.
//
// SERVICE CONTOURS EMITTED
//   service_60dbu        F(50,50) 60 dBu  — translator's own protected
//                                            service contour (§74.1235).
//
// INTERFERING CONTOURS EMITTED (F(50,10), per §74.1204(a)+(c))
//   interfering_40dbu    co-channel    vs 60 dBu protected (D=60, G=20)
//   interfering_34dbu    co-channel    vs 54 dBu protected (D=54, G=20)
//   interfering_54dbu    1st-adjacent  vs 60 dBu protected (D=60, G= 6)
//   interfering_48dbu    1st-adjacent  vs 54 dBu protected (D=54, G= 6)
//
// IF, 2nd-, and 3rd-adjacent gates (D/U ≥ -40 dB) yield U thresholds at
// 94 / 100 dBu — those contours collapse to the immediate vicinity of
// the transmitter site for any realistic translator ERP and are
// suppressed here.  The §74.1204 study in regulatory/translator.js still
// evaluates them per-station when nearby primaries are supplied.

import { fmRadialTable } from '../fm/contour.js';
import { TRANSLATOR_DU_GATES } from '../regulatory/translator.js';
import { W } from '../../types/warnings.js';

export const FX_METHOD =
  '47 CFR §74.1204 / §73.333 — FM translator service contour (F(50,50)) + interfering contours (F(50,10)) at §74.1204(a)+(c) D/U-derived thresholds';

// Each contour entry carries `mode` so fmRadialTable evaluates the right
// curve family per-contour.  `derivation` records the §74.1204 cite for
// reproducibility / review.
export const FX_DEFAULT_CONTOURS = Object.freeze([
  { id: 'service_60dbu',
    label:      '60 dBu F(50,50) — translator service / protected (§74.1235)',
    field_dBu:  60,
    mode:       '50,50',
    cite:       '47 CFR §74.1235',
    role:       'service' },

  { id: 'interfering_40dbu',
    label:      '40 dBu F(50,10) — co-channel interference vs 60 dBu protected',
    field_dBu:  40,
    mode:       '50,10',
    cite:       '47 CFR §74.1204(a)+(c)',
    role:       'interfering',
    derivation: { protected_dBu: 60, channel_relationship: 'co-channel',    du_gate_db: 20 } },

  { id: 'interfering_34dbu',
    label:      '34 dBu F(50,10) — co-channel interference vs 54 dBu protected',
    field_dBu:  34,
    mode:       '50,10',
    cite:       '47 CFR §74.1204(a)+(c)',
    role:       'interfering',
    derivation: { protected_dBu: 54, channel_relationship: 'co-channel',    du_gate_db: 20 } },

  { id: 'interfering_54dbu',
    label:      '54 dBu F(50,10) — 1st-adjacent interference vs 60 dBu protected',
    field_dBu:  54,
    mode:       '50,10',
    cite:       '47 CFR §74.1204(a)+(c)',
    role:       'interfering',
    derivation: { protected_dBu: 60, channel_relationship: '1st-adjacent', du_gate_db: 6 } },

  { id: 'interfering_48dbu',
    label:      '48 dBu F(50,10) — 1st-adjacent interference vs 54 dBu protected',
    field_dBu:  48,
    mode:       '50,10',
    cite:       '47 CFR §74.1204(a)+(c)',
    role:       'interfering',
    derivation: { protected_dBu: 54, channel_relationship: '1st-adjacent', du_gate_db: 6 } }
]);

// Regulatory metadata surfaced on the exhibit alongside the radial table
// so reviewers can verify each contour's derivation against §74.1204.
export const FX_REGULATORY_METADATA = Object.freeze({
  cite: '47 CFR §74.1204',
  curves: {
    service:     { mode: '50,50', source: '47 CFR §73.333 F(50,50)' },
    interfering: { mode: '50,10', source: '47 CFR §73.333 F(50,10)' }
  },
  du_gates_db: TRANSLATOR_DU_GATES,
  protected_field_thresholds_dbu: {
    A:  60,  B:  54,  B1: 54,
    C:  54,  C0: 54,  C1: 54,  C2: 54,  C3: 54,
    LP100: 60,  LP10: 60,
    D:  60,  FX: 60
  },
  notes: [
    'IF (±10.6/10.8 MHz), 2nd-adjacent (±400 kHz), and 3rd-adjacent (±600 kHz) D/U gates of -40 dB yield U thresholds of 94 / 100 dBu — geographically tiny contours immediately around the transmitter that are evaluated per-station by the §74.1204 D/U study, not as standalone polygons.',
    'Per-station overlap geometry and D/U comparison run when evidence.nearby_primaries is supplied; without it MISSING_NEARBY_STATIONS is emitted.'
  ]
});

export function fxInputGuards({ erp_kW }){
  const warnings = [];
  if (erp_kW > 0.25){
    warnings.push(W.make('FCC_METHOD_MISSING',
      `FM translator ERP ${erp_kW} kW exceeds the 250 W §74.1235 reference; confirm class.`));
  }
  return warnings;
}

export async function fxRadialTable(args){
  return fmRadialTable(args);
}
