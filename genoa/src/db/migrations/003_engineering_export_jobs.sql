-- Engineering export job queue (asynchronous compute / report rendering).
-- See src/api/services/jobStore.js.
--
-- Rows mirror the in-process job map; artifact bodies (PDF / TXT) live
-- in-process and are not stored here.  artifact_url points at the
-- streaming endpoint that reads from the in-process map.

CREATE TABLE IF NOT EXISTS engineering_export_jobs (
  id                UUID         PRIMARY KEY,
  kind              TEXT         NOT NULL,                    -- exhibit | engineering_report_txt | engineering_report_pdf
  status            TEXT         NOT NULL,                    -- queued | running | complete | failed
  progress_message  TEXT,
  input_json        JSONB        NOT NULL DEFAULT '{}'::jsonb,
  options_json      JSONB        NOT NULL DEFAULT '{}'::jsonb,
  result_json       JSONB,
  artifact_url      TEXT,
  error_json        JSONB,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS engineering_export_jobs_status_idx
  ON engineering_export_jobs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS engineering_export_jobs_created_idx
  ON engineering_export_jobs (created_at DESC);
