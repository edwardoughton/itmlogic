-- Genoa ASR sidecar — Postgres schema.
--
-- Two tables:
--
--   asr_towers — current-week tower records (denormalised RA + CO + EN
--   joined by USI on load).  Each weekly load TRUNCATEs and reloads.
--   Holds the freshest snapshot at all times; size ~1 row per tower
--   (~1.7M rows, ~850 MB on disk).
--
--   asr_zip_archive — last 4 weekly downloads of the raw FCC ULS
--   r_tower.zip kept as bytea blobs.  ~37 MB per blob × 4 = ~150 MB.
--   Used for diff queries / replay / audit when an operator wants to
--   compare what FCC published this week vs prior weeks.  After each
--   successful weekly load, the loader DELETEs entries with
--   archived_at < (now() - 28 days) — rolling 4-week window with
--   oldest aging off.
--
-- Idempotent: every CREATE uses IF NOT EXISTS so the sidecar can run
-- this on every boot without conflicting with prior loads.

CREATE TABLE IF NOT EXISTS asr_towers (
  asr_number              TEXT PRIMARY KEY,
  unique_system_id        BIGINT,
  status                  TEXT,
  registration_purpose    TEXT,
  date_issued             TIMESTAMPTZ,
  date_constructed        TIMESTAMPTZ,
  date_action             TIMESTAMPTZ,

  -- coordinates (decoded from CO.dat deg/min/sec)
  latitude_deg            DOUBLE PRECISION,
  longitude_deg           DOUBLE PRECISION,

  -- heights (ULS publishes feet; we convert to metres on load)
  height_of_structure_m   DOUBLE PRECISION,
  ground_elevation_m      DOUBLE PRECISION,
  overall_height_agl_m    DOUBLE PRECISION,
  overall_height_amsl_m   DOUBLE PRECISION,

  structure_type          TEXT,                -- TOWER, BLDG, MAST, ANTENNA, …
  faa_study_number        TEXT,
  faa_circular_number     TEXT,
  faa_emi_flag            TEXT,
  nepa_flag               TEXT,
  date_faa_determination  TIMESTAMPTZ,

  -- paint/light codes (FCC numeric paint_light + descriptive
  -- mark_light_code from ULS).  Genoa cross-references against the
  -- §17.21 / §17.23 / AC 70/7460-1L style table at lookup time.
  painting_lighting       TEXT,
  mark_light_code         TEXT,

  -- structure address (informational; not load-bearing for §17 cross-check)
  structure_address       TEXT,
  structure_city          TEXT,
  structure_state         TEXT,

  -- owner (joined from EN.dat by USI; entity_type 'RB' Registered Business)
  owner_name              TEXT,
  owner_frn               TEXT,

  loaded_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spatial index for /asr/by-location radius queries.  Using a B-tree
-- on (lat, lon) is good enough at the typical tower density (~1.7M
-- records, sparse over the continental US); a PostGIS index would be
-- ideal but adds an extension dependency to genoadb.  The radius
-- filter happens in SQL via a haversine on the candidate set this
-- index narrows.
CREATE INDEX IF NOT EXISTS asr_towers_lat_lon_idx
  ON asr_towers (latitude_deg, longitude_deg);

CREATE INDEX IF NOT EXISTS asr_towers_status_idx
  ON asr_towers (status);

-- Rolling 4-week archive of the raw r_tower.zip downloads.  Each
-- weekly load INSERTs the freshly-downloaded zip here and then
-- DELETEs anything older than 28 days.  Operators can pull a past
-- zip via /asr/archive/:snapshot_date for diff/audit.
CREATE TABLE IF NOT EXISTS asr_zip_archive (
  snapshot_date           DATE        PRIMARY KEY,
  source_url              TEXT        NOT NULL,
  source_etag             TEXT,
  source_last_modified    TIMESTAMPTZ,
  size_bytes              BIGINT      NOT NULL,
  sha256                  TEXT        NOT NULL,
  zip_data                BYTEA       NOT NULL,
  archived_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Loader state: one row, updated on each successful weekly bulk load.
CREATE TABLE IF NOT EXISTS asr_load_state (
  id                      INTEGER PRIMARY KEY DEFAULT 1
                          CHECK (id = 1),
  last_loaded_at          TIMESTAMPTZ,
  last_source_url         TEXT,
  last_source_etag        TEXT,
  last_source_last_modified TIMESTAMPTZ,
  records_total           BIGINT,
  records_with_coords     BIGINT,
  records_with_owner      BIGINT,
  load_duration_seconds   INTEGER,
  load_error              TEXT
);

