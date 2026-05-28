import React, { useMemo } from 'react';
import RackPanel from '../RackPanel.jsx';

// ColocationDoctrineBlock — right-rail doctrine block shown when the
// operator runs the page in INFRASTRUCTURE or HYBRID search mode.
// Explains explicitly that screening != permission to build, and lists
// the parallel approvals required to actually co-locate.  When any
// returned candidate carries a HIGH same-band interference risk the
// block surfaces a red warning callout.

export default function ColocationDoctrineBlock({ candidates }){
  const highInterferenceCount = useMemo(() => {
    if (!Array.isArray(candidates)) return 0;
    return candidates.filter(c => c?.colocation_analysis?.same_band_interference_risk === 'HIGH').length;
  }, [candidates]);

  return (
    <RackPanel
      eyebrow="Co-Location Doctrine"
      title="Screening, not authorization"
      italicAccent="The map shows opportunities.  Owners, the FCC and a PE issue authority."
      tone="cyan"
      dense
    >
      <div className="font-mono text-[11px] text-textDim leading-relaxed space-y-2">
        <p>
          This view enumerates <span className="text-cream">candidate hosts</span> from existing
          infrastructure.  A high score is not a permit — it is a starting point for a deal,
          an engineering study, and a regulatory filing.
        </p>
        <p>
          Before any candidate becomes a buildable site you must obtain:
        </p>
        <ul className="list-disc list-inside space-y-0.5 pl-1">
          <li><span className="text-cream">Tower-owner approval</span> and a signed lease.</li>
          <li><span className="text-cream">FCC ASR notification</span> if structure is registered.</li>
          <li><span className="text-cream">Structural engineering review</span> and tower-loading study.</li>
          <li><span className="text-cream">RF safety analysis</span> (MPE) including all co-tenants.</li>
          <li><span className="text-cream">Local zoning / land-use</span> clearance.</li>
        </ul>
        <p className="italic text-amberDim">
          Same-band co-tenancy adds intermodulation and blanket-area risk.  Always confirm with
          the host operator before promoting a candidate.
        </p>
      </div>

      {highInterferenceCount > 0 && (
        <div
          role="alert"
          className="mt-3 border border-red/50 bg-red/10 rounded-sm px-3 py-2 font-mono text-[11px] text-red leading-relaxed"
        >
          <div className="uppercase tracking-rack text-[10px] mb-1">
            ⚠ Same-band interference risk
          </div>
          <div>
            {highInterferenceCount} candidate{highInterferenceCount === 1 ? '' : 's'} carry a{' '}
            <span className="font-semibold">HIGH</span> same-band interference flag.  Manual
            review of host frequency separation and antenna isolation is required before any
            of these are promoted.
          </div>
        </div>
      )}
    </RackPanel>
  );
}
