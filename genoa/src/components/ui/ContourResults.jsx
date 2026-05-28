import React from 'react';
import MetricReadout from './MetricReadout.jsx';

// Compact contour table — pulled directly from exhibit.polygons[].
// Tone keys read: amber for service contour, gold for city, cyan for protected.

const TONE_BY_INDEX = ['amber', 'gold', 'cyan'];
const LED_BY_INDEX  = ['amber', 'amber', 'cyan'];

export default function ContourResults({ polygons = [] }) {
  if (!polygons.length){
    return <div className="font-mono text-[12px] text-textDim italic">— compute an exhibit —</div>;
  }
  return (
    <div className="space-y-0.5">
      {polygons.map((p, i) => {
        const fs = p.field_strength || {};
        const label = `${fs.value ?? '—'} ${fs.unit ?? ''}`.trim();
        const sub = p.area_km2 ? `area ${Math.round(p.area_km2).toLocaleString()} km²` : null;
        return (
          <MetricReadout
            key={p.contour_id || i}
            label={label}
            value={p.mean_radial_km != null ? p.mean_radial_km.toFixed(2) : '—'}
            unit="km mean"
            tone={TONE_BY_INDEX[i] || 'default'}
            led={LED_BY_INDEX[i] || null}
            subvalue={sub}
          />
        );
      })}
    </div>
  );
}
