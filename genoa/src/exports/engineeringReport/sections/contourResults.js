// Contour results — mean / min / max radial + area per contour family.
//
// Reads from exhibit.polygons (ring + contour metadata) and the
// per-radial contour_distances_km grid.

export function buildContourResultsSection(exhibit){
  const polys = Array.isArray(exhibit.polygons) ? exhibit.polygons : [];
  const rt    = Array.isArray(exhibit.radial_table) ? exhibit.radial_table : [];

  if (!polys.length && !rt.length){
    return null;
  }

  // Pull per-radial distances grouped by contour id.  Both the
  // exhibit.contour_definitions and exhibit.polygons[].field_strength
  // carry the dBu/threshold; we build rows from whichever is richest.
  const grouped = new Map();   // contour_id → { dBu/mvm label, radials_km: [] }
  for (const r of rt){
    const cd = r.contour_distances_km || {};
    for (const [id, km] of Object.entries(cd)){
      if (!Number.isFinite(km)) continue;
      if (!grouped.has(id)) grouped.set(id, { id, label: null, distances: [] });
      grouped.get(id).distances.push(km);
    }
  }
  // Augment with polygon metadata (label, area, mean radial).
  for (const p of polys){
    const id = p.contour_id || p.id;
    if (!grouped.has(id)) grouped.set(id, { id, label: null, distances: [] });
    const g = grouped.get(id);
    g.label  = p.label || (p.field_strength ? `${p.field_strength.value} ${p.field_strength.unit}` : id);
    g.area_km2 = Number.isFinite(p.area_km2) ? p.area_km2 : null;
    g.mean_radial_km = Number.isFinite(p.mean_radial_km) ? p.mean_radial_km : null;
  }

  const rows = [];
  for (const g of grouped.values()){
    const ds = g.distances.filter(Number.isFinite);
    if (!ds.length && g.area_km2 == null) continue;
    const mean = ds.length
      ? Number((ds.reduce((a, b) => a + b, 0) / ds.length).toFixed(2))
      : (g.mean_radial_km != null ? Number(g.mean_radial_km.toFixed(2)) : null);
    const min = ds.length ? Number(Math.min(...ds).toFixed(2)) : null;
    const max = ds.length ? Number(Math.max(...ds).toFixed(2)) : null;
    rows.push({
      contour:       g.label || g.id,
      description:   g.id,
      mean_radial_km: mean,
      min_radial_km:  min,
      max_radial_km:  max,
      area_km2:      Number.isFinite(g.area_km2) ? Number(g.area_km2.toFixed(2)) : null
    });
  }

  if (!rows.length) return null;

  return {
    id:      'contour-results',
    type:    'table',
    heading: 'CONTOUR RESULTS',
    table: {
      columns: [
        { key: 'contour',         label: 'Contour',         width: 0.20 },
        { key: 'description',     label: 'ID',              width: 0.15 },
        { key: 'mean_radial_km',  label: 'Mean (km)',       width: 0.15, align: 'right' },
        { key: 'min_radial_km',   label: 'Min (km)',        width: 0.15, align: 'right' },
        { key: 'max_radial_km',   label: 'Max (km)',        width: 0.15, align: 'right' },
        { key: 'area_km2',        label: 'Area (km²)',      width: 0.20, align: 'right' }
      ],
      rows
    }
  };
}
