import React from 'react';

// Bloomberg-style provenance table.  Every row pins the deterministic
// contract: method + regulations + engine module + version + curve
// dataset + sha256 + interpolation rule.

function fmtSha(s){ return s ? `${s.slice(0,12)}…` : '—'; }

export default function EngineProvenance({ exhibit }) {
  if (!exhibit){
    return <div className="font-mono text-[12px] text-textDim italic">— compute an exhibit —</div>;
  }
  const m  = exhibit.calculation_method || {};
  const ip = exhibit.interpolation || {};
  const mv = exhibit.method_versions || {};
  const cd = mv.curve_dataset || {};
  const sig = exhibit.engine_signature || {};
  const rows = [
    ['Method',         m.name],
    ['Regulations',    (m.regulations || []).join(', ')],
    ['Engine module',  m.engine_module],
    ['Engine version', m.engine_version || sig.version],
    ['Engine SHA',     fmtSha(sig.hash)],
    ['Curve dataset',  cd.curve_version],
    ['Curve meta',     fmtSha(cd.meta_sha256)],
    ['Interp · field', ip.along_field],
    ['Interp · HAAT',  ip.along_haat]
  ];
  return (
    <table className="telemetry">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th className="w-[40%]">{k}</th>
            <td className="text-right text-cream">{v || <span className="text-textDim">—</span>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
