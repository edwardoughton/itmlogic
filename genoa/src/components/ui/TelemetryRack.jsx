import React from 'react';
import RackPanel             from './RackPanel.jsx';
import FilingReadinessGauge  from './FilingReadinessGauge.jsx';
import WarningConsole        from './WarningConsole.jsx';
import ContourResults        from './ContourResults.jsx';
import EngineProvenance      from './EngineProvenance.jsx';
import MetricReadout         from './MetricReadout.jsx';
import RegulatoryContextCard from './RegulatoryContextCard.jsx';

export default function TelemetryRack({ exhibit }) {
  const fr   = exhibit?.filing_readiness || {};
  const polys = exhibit?.polygons || [];
  const s     = exhibit?.station_inputs || {};
  const pop  = exhibit?.population_estimate || {};
  // Regulatory-context classifier output (see src/engine/regulatory/
  // context.js).  When present, it drives a new card and is forwarded
  // to WarningConsole so protection-warning display text can be
  // softened on existing licensed facilities (warningsToDowngrade).
  const regCtx = exhibit?.regulatoryContext || null;
  // Tone the regulatory-context panel by the classifier's filing risk
  // so the rack matches the rest of the UI's color taxonomy.
  const regTone = regCtx?.filingRisk === 'high'   ? 'danger'
                : regCtx?.filingRisk === 'medium' ? 'amber'
                : regCtx?.filingRisk === 'low'    ? 'cyan'
                : 'default';

  return (
    <div className="space-y-4">

      <RackPanel eyebrow="Channel A" title="Filing Readiness" tone="amber">
        <FilingReadinessGauge
          score={fr.score ?? 0}
          mode={fr.status || 'demo'}
          blockersCount={(exhibit?.blockers || []).length}
          warningsCount={(exhibit?.warnings || []).filter(w => w.severity !== 'blocker').length}
        />
        {fr.recommendations && fr.recommendations.length > 0 && (
          <ul className="mt-3 space-y-1">
            {fr.recommendations.map((r, i) => (
              <li key={i} className="font-mono text-[11px] text-cyan">
                <span className="text-textDim mr-2">[{String(i + 1).padStart(2, '0')}]</span>{r}
              </li>
            ))}
          </ul>
        )}
      </RackPanel>

      {regCtx && (
        <RackPanel eyebrow="Channel A2" title="Regulatory Context" tone={regTone}>
          <RegulatoryContextCard ctx={regCtx} />
        </RackPanel>
      )}

      <RackPanel eyebrow="Channel B" title="Telemetry" dense>
        <MetricReadout label="Call"        value={s.call || '—'}        led={exhibit ? 'amber' : null} />
        <MetricReadout label="Facility"    value={s.facility_id || '—'} />
        <MetricReadout label="Service"     value={`${s.service || '—'} ${s.fcc_class || ''}`.trim()} />
        <MetricReadout label="Frequency"   value={s.frequency ?? '—'}   unit={s.frequency_unit || ''} tone="gold" />
        <MetricReadout label="ERP"         value={s.erp_kw ?? '—'}      unit="kW" tone="gold" />
        <MetricReadout label="HAAT"        value={s.haat_m_input ?? '—'} unit="m" tone="gold" />
        <MetricReadout label="Lat / Lon"   value={s.lat != null && s.lon != null ? `${Number(s.lat).toFixed(4)}, ${Number(s.lon).toFixed(4)}` : '—'} />
        <MetricReadout label="Radials"     value={(exhibit?.radial_table || []).length || '—'} />
      </RackPanel>

      <RackPanel eyebrow="Channel C" title="Contour Results" tone="amber">
        <ContourResults polygons={polys} />
      </RackPanel>

      <RackPanel eyebrow="Channel D" title="Population Estimate" tone={pop.source ? 'cyan' : 'default'}>
        {pop.source ? (
          <div className="space-y-0.5">
            <MetricReadout
              label="Persons"
              value={Number(pop.primary).toLocaleString()}
              unit=""
              tone="gold"
              led="amber"
            />
            <MetricReadout label="Source"  value="US Census 2020" />
            <MetricReadout label="Dataset" value={pop.dataset || '—'} />
            <MetricReadout label="Contour" value={pop.contour_label || '—'} />
            <MetricReadout label="Method"  value={pop.method ? pop.method.split('(')[0].trim() : '—'} />
          </div>
        ) : (
          <div className="font-mono text-[11px] text-textDim italic">
            {pop.attempt_status === 'failed'
              ? `Census API failed: ${pop.attempt_error || 'unknown'}`
              : 'Placeholder — computing exhibit will fetch real Census data'}
          </div>
        )}
      </RackPanel>

      <RackPanel eyebrow="Console / 02" title="Warnings" tone="danger">
        <WarningConsole
          blockers={exhibit?.blockers || []}
          warnings={exhibit?.warnings || []}
          recommendations={fr.recommendations || []}
          warningsToDowngrade={regCtx?.warningsToDowngrade || []}
          regulatoryContext={regCtx}
        />
      </RackPanel>

      <RackPanel eyebrow="Provenance" title="Deterministic FCC engine" tone="cyan">
        <EngineProvenance exhibit={exhibit} />
      </RackPanel>

    </div>
  );
}
