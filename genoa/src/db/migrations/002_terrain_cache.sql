-- Terrain DEM cache.  Lat/lon are quantized to 4 decimals (~10 m).
-- The terrain sidecar reads & write-throughs this cache so repeated
-- compute runs near the same site avoid hitting the DEM provider.

CREATE TABLE IF NOT EXISTS genoa_terrain_cache (
  lat_q4       NUMERIC(8,4) NOT NULL,
  lon_q4       NUMERIC(9,4) NOT NULL,
  elev_m       NUMERIC      NOT NULL,
  source       TEXT,
  fetched_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (lat_q4, lon_q4)
);
CREATE INDEX IF NOT EXISTS genoa_terrain_cache_fetched_at_idx ON genoa_terrain_cache (fetched_at);
