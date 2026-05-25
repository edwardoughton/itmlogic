#!/usr/bin/env bash
# worker-heartbeat.sh — update a worker's last_heartbeat timestamp.
# Called from spawn-worker.sh after each job; safe to call externally
# (e.g. from a wrapper that does long compute).

set -euo pipefail

WID="${1:?usage: worker-heartbeat.sh <worker_id>}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
Q="${REPO_ROOT}/agents/runtime/job-queue.json"

TMP=$(mktemp)
jq --arg id "${WID}" --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  (.workers[] | select(.id == $id) | .last_heartbeat) = $t
' "${Q}" > "${TMP}"
mv "${TMP}" "${Q}"
