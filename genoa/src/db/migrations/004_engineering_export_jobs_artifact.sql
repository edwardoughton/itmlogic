-- engineering_export_jobs — store artifact bytes so cross-instance
-- /artifact requests work behind a load balancer.  Without this, the
-- in-memory artifact body lives only on the instance that ran the job,
-- and a poll/artifact request routed to a sibling instance gets 404.
--
-- Sizes: TXT artifacts are tiny (~5–20 KB), PDF artifacts ~50–200 KB.
-- Postgres TOAST handles BYTEA up to 1 GB; well within budget.

ALTER TABLE engineering_export_jobs
  ADD COLUMN IF NOT EXISTS artifact_body          BYTEA,
  ADD COLUMN IF NOT EXISTS artifact_content_type  TEXT,
  ADD COLUMN IF NOT EXISTS artifact_filename      TEXT;
