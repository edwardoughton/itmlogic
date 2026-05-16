-- Genoa schema v2.  Idempotent; safe on every boot.
-- Tables namespaced with `genoa_` so multi-tenant Postgres clusters
-- don't collide with other apps.

CREATE TABLE IF NOT EXISTS genoa_exhibit (
  id              BIGSERIAL PRIMARY KEY,
  call_sign       TEXT,
  facility_id     TEXT,
  service         TEXT,
  frequency       NUMERIC,
  erp_kw          NUMERIC,
  haat_m          NUMERIC,
  lat             NUMERIC,
  lon             NUMERIC,
  method          TEXT,
  schema_name     TEXT,
  schema_version  INTEGER,
  filing_score    INTEGER,
  filing_status   TEXT,
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS genoa_exhibit_created_at_idx ON genoa_exhibit (created_at DESC);
CREATE INDEX IF NOT EXISTS genoa_exhibit_service_idx    ON genoa_exhibit (service);
CREATE INDEX IF NOT EXISTS genoa_exhibit_call_idx       ON genoa_exhibit (call_sign);
CREATE INDEX IF NOT EXISTS genoa_exhibit_facility_idx   ON genoa_exhibit (facility_id);

-- Versioning: every save creates a new immutable version row.  The
-- top-level genoa_exhibit row tracks the latest payload for fast list
-- queries; full history lives here.
CREATE TABLE IF NOT EXISTS genoa_exhibit_version (
  id              BIGSERIAL PRIMARY KEY,
  exhibit_id      BIGINT NOT NULL REFERENCES genoa_exhibit(id) ON DELETE CASCADE,
  version_no      INTEGER NOT NULL,
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exhibit_id, version_no)
);

-- Validation runs are stored separately so they can be re-executed
-- without rewriting the exhibit, and so an exhibit can carry the
-- pointer to a specific validation run by id.
CREATE TABLE IF NOT EXISTS genoa_validation_run (
  id              BIGSERIAL PRIMARY KEY,
  curve_version   TEXT,
  ran_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  n_cases         INTEGER,
  n_run           INTEGER,
  n_pass          INTEGER,
  n_authoritative_run  INTEGER,
  n_authoritative_pass INTEGER,
  authoritative_pass   BOOLEAN,
  payload         JSONB NOT NULL
);

-- Read-only facility cache.  Rows are upserted from the upstream
-- zerotrustradio facility DB; Genoa never writes back to that source.
CREATE TABLE IF NOT EXISTS genoa_facility_cache (
  facility_id     TEXT PRIMARY KEY,
  call_sign       TEXT,
  service         TEXT,
  frequency       NUMERIC,
  raw             JSONB NOT NULL,
  source          TEXT,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Evidence records — one row per attached SigMF capture / terrain
-- profile / identity confirmation.  payload carries the canonical
-- structured record; `kind` partitions the table.
CREATE TABLE IF NOT EXISTS genoa_evidence_record (
  id              BIGSERIAL PRIMARY KEY,
  exhibit_id      BIGINT REFERENCES genoa_exhibit(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL,            -- 'terrain' | 'measurement' | 'identity'
  source          TEXT,
  calibrated      BOOLEAN,
  payload         JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS genoa_evidence_exhibit_idx ON genoa_evidence_record (exhibit_id);
CREATE INDEX IF NOT EXISTS genoa_evidence_kind_idx    ON genoa_evidence_record (kind);

-- Export artifacts.  When an exporter writes a file to object storage,
-- the Spaces key is recorded here keyed by exhibit + format.
CREATE TABLE IF NOT EXISTS genoa_export_artifact (
  id              BIGSERIAL PRIMARY KEY,
  exhibit_id      BIGINT NOT NULL REFERENCES genoa_exhibit(id) ON DELETE CASCADE,
  format          TEXT NOT NULL,            -- 'json' | 'txt' | 'geojson' | 'pdf'
  storage_key     TEXT,
  content_type    TEXT,
  size_bytes      BIGINT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exhibit_id, format)
);

-- Warning event log — audit trail of every typed warning emitted on
-- compute / export.  Useful for filing readiness reviews and for
-- spotting curve-dataset regressions across many exhibits.
CREATE TABLE IF NOT EXISTS genoa_warning_event (
  id              BIGSERIAL PRIMARY KEY,
  exhibit_id      BIGINT REFERENCES genoa_exhibit(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,
  severity        TEXT NOT NULL,
  phase           TEXT,
  detail          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS genoa_warning_event_code_idx     ON genoa_warning_event (code);
CREATE INDEX IF NOT EXISTS genoa_warning_event_exhibit_idx  ON genoa_warning_event (exhibit_id);
