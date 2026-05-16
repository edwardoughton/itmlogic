// Per-layer samplers + interpreters.
//
// Each `sample()` returns the canonical geodata response shape:
//   { lat, lon, layer, source:{path,sha256,crs,dataset_class},
//     value, value_kind, interpretation, warnings[], replay, sampled_at }
//
// All samplers are pure with respect to the injected adapters
// (rasterSampler / pgPool) so tests can substitute fixtures without
// touching disk or the database.

// ── NLCD impervious surface (CONUS, 30 m, EPSG:5070) ─────────────
//
// Pixel range: 0-100 = % impervious surface.  Values 101-255 are
// special codes used in the CONUS product for water / nodata; we
// surface them as raw with a warning rather than guessing.
export async function sampleNlcdImpervious({ lat, lon, layerCfg, sha256, raster, now }){
  const r = await raster({ tif: layerCfg.path, lon, lat });
  return wrapRasterResult({
    layer: 'nlcd_impervious_2024',
    lat, lon, layerCfg, sha256, r, now,
    value_kind: 'pixel_pct_impervious',
    interpret: (v) => {
      if (v == null) return 'no value at this location';
      if (v >= 0 && v <= 100) return `${v}% impervious surface (urbanization proxy)`;
      return `raw pixel value ${v} (outside 0-100 % impervious range — likely water/nodata sentinel)`;
    }
  });
}

// ── Mexico NALCMS land cover (Mexico, 30 m, EPSG:6362) ───────────
//
// 19-class scheme per the North American Land Change Monitoring
// System v2 product spec.  We only carry the class name — downstream
// callers decide RF clutter behavior.
const NALCMS_CLASSES = {
  1: 'Temperate or sub-polar needleleaf forest',
  2: 'Sub-polar taiga needleleaf forest',
  3: 'Tropical or sub-tropical broadleaf evergreen forest',
  4: 'Tropical or sub-tropical broadleaf deciduous forest',
  5: 'Temperate or sub-polar broadleaf deciduous forest',
  6: 'Mixed forest',
  7: 'Tropical or sub-tropical shrubland',
  8: 'Temperate or sub-polar shrubland',
  9: 'Tropical or sub-tropical grassland',
  10: 'Temperate or sub-polar grassland',
  11: 'Sub-polar or polar shrubland-lichen-moss',
  12: 'Sub-polar or polar grassland-lichen-moss',
  13: 'Sub-polar or polar barren-lichen-moss',
  14: 'Wetland',
  15: 'Cropland',
  16: 'Barren land',
  17: 'Urban and built-up',
  18: 'Water',
  19: 'Snow and ice'
};

export async function sampleNalcmsMexico({ lat, lon, layerCfg, sha256, raster, now }){
  const r = await raster({ tif: layerCfg.path, lon, lat });
  return wrapRasterResult({
    layer: 'nalcms_mexico_2020v2',
    lat, lon, layerCfg, sha256, r, now,
    value_kind: 'class_code',
    interpret: (v) => {
      if (v == null) return 'no value at this location';
      const name = NALCMS_CLASSES[v];
      return name ? `class ${v}: ${name}` : `class code ${v} (unknown class)`;
    },
    extra_warnings: (r) =>
      r?.outside_extent
        ? ['Point is outside the Mexico NALCMS raster extent — use NLCD for US locations']
        : []
  });
}

// ── Perennial herbaceous departure (CONUS, EPSG:5070) ────────────
//
// Continuous departure index — interpretation kept generic since the
// product's per-pixel meaning depends on the operator's downstream
// use (fuel load, vegetation change, RF clutter proxy).
export async function sampleVegetationDeparture({ lat, lon, layerCfg, sha256, raster, now }){
  const r = await raster({ tif: layerCfg.path, lon, lat });
  return wrapRasterResult({
    layer: 'vegetation_perennial_herbaceous_2024',
    lat, lon, layerCfg, sha256, r, now,
    value_kind: 'departure_index',
    interpret: (v) => (v == null
      ? 'no value at this location'
      : `perennial-herbaceous departure index ${v}`)
  });
}

// Shared response builder for raster-backed layers.
function wrapRasterResult({ layer, lat, lon, layerCfg, sha256, r, now,
                            value_kind, interpret, extra_warnings }){
  const warnings = [];
  let value = null;
  if (!r?.available){
    warnings.push(`sampler unavailable: ${r?.reason || 'unknown'}`);
  } else if (r.outside_extent){
    warnings.push('point is outside the raster extent');
  } else if (r.nodata){
    warnings.push('pixel is NoData');
  } else {
    value = r.value;
  }
  if (extra_warnings){
    for (const w of extra_warnings(r) || []) warnings.push(w);
  }
  return {
    lat, lon, layer,
    source: {
      path:          layerCfg.path,
      sha256:        sha256 || null,
      crs:           layerCfg.crs,
      dataset_class: layerCfg.dataset_class
    },
    value,
    value_kind,
    interpretation: interpret(value),
    warnings,
    replay:    r?.replay || null,
    sampled_at: (now || new Date()).toISOString()
  };
}

// ── M3 ground conductivity (PostGIS, EPSG:4326) ──────────────────
//
// The current corpus imports AM_m3.geojson as LINESTRING boundary
// segments only — there are no conductivity polygons yet, so this
// sampler explicitly warns and returns the nearest boundary line's
// conductivity attribute (if any) as a best-available proxy.  When
// the polygon reconstruction lands, swap the query to ST_Within
// against polygons and drop the warning.
export async function sampleM3Conductivity({ lat, lon, layerCfg, query, now }){
  const sql = `
    SELECT
      m3_value,
      ST_AsText(geom)                                AS nearest_segment_wkt,
      ST_Distance(
        geom::geography,
        ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography
      )                                              AS distance_m
    FROM ${layerCfg.table}
    ORDER BY geom <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)
    LIMIT 1
  `;
  const replay =
    `psql -c "SELECT m3_value, ST_AsText(geom), ` +
    `ST_Distance(geom::geography, ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography) ` +
    `FROM ${layerCfg.table} ORDER BY geom <-> ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326) LIMIT 1;"`;

  const warnings = [
    'M3 corpus is currently boundary LINESTRINGs only — true conductivity polygons not yet reconstructed',
    'Returned m3_value is from the nearest boundary segment, not from a containing zone'
  ];
  let value = null;
  let extra = {};
  let available = true;
  try {
    const r = await query(sql, [lon, lat]);
    const row = r?.rows?.[0];
    if (row){
      value = row.m3_value ?? null;
      extra = {
        nearest_segment_distance_m: Number(row.distance_m) || null,
        nearest_segment_wkt_preview: row.nearest_segment_wkt
          ? String(row.nearest_segment_wkt).slice(0, 120) + '…'
          : null
      };
    } else {
      warnings.push('no rows in m3_conductivity table (corpus not yet imported?)');
    }
  } catch (e){
    available = false;
    warnings.push(`postgis query failed: ${String(e?.message || e)}`);
  }
  return {
    lat, lon, layer: 'm3_conductivity_postgis',
    source: {
      path:           layerCfg.geojson_source,
      table:          layerCfg.table,
      sha256:         null,  // PostGIS table — sha tracked on the source geojson, populated by manifest assembly
      crs:            layerCfg.crs,
      dataset_class:  layerCfg.dataset_class
    },
    value,
    value_kind:     'm3_S_per_m_nearest_boundary',
    interpretation: available
      ? (value == null
          ? 'no M3 value on nearest boundary segment'
          : `nearest-boundary M3 ground conductivity = ${value} (NOT zone-resolved; see warnings)`)
      : 'sampler unavailable',
    warnings,
    extra,
    replay,
    sampled_at: (now || new Date()).toISOString()
  };
}

// ── GLOBE terrain status (no sampling yet) ───────────────────────
//
// GLOBE tiles are present on disk but georeferencing has not been
// wired — bounds are pending.  This endpoint reports readiness for
// the deploy pipeline; do NOT return elevations until tile bounds
// are attested in the manifest.
export async function reportTerrainStatus({ layerCfg, listDir }){
  const warnings = [
    'GLOBE tile bounds are not yet attested — terrain sampling is intentionally disabled'
  ];
  let tile_count = null;
  let available = true;
  try {
    const entries = await listDir(layerCfg.dir);
    tile_count = entries.filter((e) => /\.(bil|hdr|dem|tif)$/i.test(e)).length;
  } catch (e){
    available = false;
    warnings.unshift(`tile directory not readable: ${String(e?.message || e)}`);
  }
  return {
    layer: 'terrain_globe',
    status: available ? 'pending_georef' : 'unavailable',
    source: {
      dir:           layerCfg.dir,
      crs:           layerCfg.crs,
      dataset_class: layerCfg.dataset_class
    },
    tile_count,
    warnings,
    sampled_at: new Date().toISOString()
  };
}
