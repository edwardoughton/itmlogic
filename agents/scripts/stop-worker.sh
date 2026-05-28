#!/usr/bin/env bash
# stop-worker.sh — mark a worker as stopping; the worker loop in
# spawn-worker.sh exits on its next iteration.
#
# Usage:
#   stop-worker.sh <worker_id>

set -euo pipefail
WID="${1:?usage: stop-worker.sh <worker_id>}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
Q="${REPO_ROOT}/agents/runtime/job-queue.json"

TMP=$(mktemp)
jq --arg id "${WID}" --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  (.workers[] | select(.id == $id) | .status) = "stopping"
  | (.workers[] | select(.id == $id) | .stop_requested_at) = $t
' "${Q}" > "${TMP}"
mv "${TMP}" "${Q}"
echo "[stop-worker] ${WID} → stopping (worker exits on next iteration)"
