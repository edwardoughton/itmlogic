-- Genoa FAA-airports sidecar — Postgres schema.
--
-- One denormalised table per public-use facility (airport / heliport /
-- balloonport when in scope).  We collapse OurAirports.com's airports
-- and runways CSVs into a single row per airport with the longest
-- runway length pre-computed, because the §17.7(c) radius branch
-- depends only on (longest_runway_ft >= 3200) — we don't need to
-- store every runway.
--
-- Sized for the US: ~20k public-use entries after filtering (small +
-- medium + large airports + heliports, scheduled_service-flagged or
-- iso_country='US' & type ∉ {closed, seaplane_base, balloonport}).
-- ~5 MB on disk; trivial.
--
-- Indexed on (lat, lon) so the proximity SELECT (haversine inside a
-- bounding-box prefilter) is sub-millisecond.

CREATE TABLE IF NOT EXISTS faa_airports (
  airport_id        TEXT PRIMARY KEY,        -- OurAirports `id` (stable)
  ident             TEXT,                    -- ICAO ident (KSEA, PAJN, …) or local code
  iata_code         TEXT,
  local_code        TEXT,                    -- FAA local code (SEA, JNU, …)
  gps_code          TEXT,
  type              TEXT,                    -- small_airport | medium_airport | large_airport | heliport
  name              TEXT,
  latitude_deg      DOUBLE PRECISION,
  longitude_deg     DOUBLE PRECISION,
  elevation_ft      DOUBLE PRECISION,
  iso_country       TEXT,
  iso_region        TEXT,
  municipality      TEXT,
  scheduled_service TEXT,                    -- 'yes' | 'no'
  longest_runway_ft DOUBLE PRECISION,        -- pre-computed across all surface runways
  longest_runway_m  DOUBLE PRECISION,
  has_lighted_rwy   BOOLEAN,
  source_csv_date   DATE,                    -- snapshot date of the CSV we loaded from
  loaded_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS faa_airports_latlon_idx
  ON faa_airports (latitude_deg, longitude_deg);

CREATE INDEX IF NOT EXISTS faa_airports_type_idx
  ON faa_airports (type);

CREATE INDEX IF NOT EXISTS faa_airports_country_idx
  ON faa_airports (iso_country);

-- Bulk-load state — single-row health snapshot, mirrors asr_load_state.
CREATE TABLE IF NOT EXISTS faa_airports_load_state (
  id                INT PRIMARY KEY DEFAULT 1,
  records_total     BIGINT,
  records_us        BIGINT,
  records_heliport  BIGINT,
  last_loaded_at    TIMESTAMPTZ,
  last_source_url   TEXT,
  last_etag         TEXT,
  load_duration_seconds DOUBLE PRECISION,
  load_error        TEXT,
  CONSTRAINT faa_airports_load_state_singleton CHECK (id = 1)
);

INSERT INTO faa_airports_load_state (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

-- Rolling 4-week archive of the raw airports.csv + runways.csv blobs
-- so the operator can diff "what FAA-via-OurAirports published this
-- week vs last week" if a §17.7(c) determination changes.  Mirrors
-- asr_zip_archive's rotation policy (oldest aged off after 28 days).
CREATE TABLE IF NOT EXISTS faa_airports_archive (
  snapshot_date     DATE PRIMARY KEY,
  source_url        TEXT,
  source_etag       TEXT,
  airports_csv      BYTEA,
  runways_csv       BYTEA,
  size_bytes        BIGINT,
  sha256            TEXT,
  archived_at       TIMESTAMPTZ DEFAULT NOW()
);
