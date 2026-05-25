import React from 'react';
import RackPanel from '../RackPanel.jsx';

// OptimizerIntroPanel — landing copy at the top of the /am-relocation
// route.  Pure presentational; explains the screening scope so the
// engineer knows this is *not* a final-grade allocation study.

export default function OptimizerIntroPanel(){
  return (
    <RackPanel
      eyebrow="Regional Planning Console"
      title="AM Relocation Optimizer"
      italicAccent="Find optimal AM relocation sites within a regional radius using FCC screening, conductivity, environmental resilience, and nighttime survivability modeling."
      tone="amber"
      dense
    >
      <div className="font-mono text-[11px] text-textDim leading-relaxed">
        SCREENING-ONLY workflow.  Every candidate here is a desk-study seed —
        not a filing.  Promote a candidate to the main Contour Studio to
        compute its §73.183 / §73.184 / §73.182 exhibits, run §73.215
        short-spacing showings, and pull SDR/measurement evidence.
      </div>
    </RackPanel>
  );
}
