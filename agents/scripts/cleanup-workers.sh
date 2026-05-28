#!/usr/bin/env bash
# cleanup-workers.sh — remove exited/stale workers from the queue file.
# Idempotent.  Run hourly via cron or the long-running loop.

set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
"${REPO_ROOT}/agents/scripts/queue-manager.sh" sweep

Q="${REPO_ROOT}/agents/runtime/job-queue.json"
TMP=$(mktemp)
jq '.workers = (.workers // [] | map(select(.status != "exited" and .status != "stale")))' "${Q}" > "${TMP}"
mv "${TMP}" "${Q}"

# Prune completed/failed jobs older than 7 days
TMP=$(mktemp)
jq --arg cutoff "$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)" '
  .jobs = (.jobs | map(
    select(.status == "pending" or .status == "running" or
           (.completed_at // .failed_at // .enqueued_at) > $cutoff)
  ))
' "${Q}" > "${TMP}"
mv "${TMP}" "${Q}"
echo "[cleanup-workers] done"
