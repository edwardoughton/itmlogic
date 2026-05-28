#!/usr/bin/env bash
# spawn-worker.sh — register a worker in the job queue.
#
# Workers loop: dequeue → run → heartbeat → complete.  When COMPUTE_MODE
# allows burst workers, this can be invoked multiple times on the same
# host (concurrency-limited by compute-budget.json max_workers).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPUTE="${REPO_ROOT}/agents/runtime/compute-budget.json"
Q="${REPO_ROOT}/agents/runtime/job-queue.json"

MODE="${COMPUTE_MODE:-parallel_agents}"
MAX_WORKERS=$(jq -r ".modes.${MODE}.max_workers" "${COMPUTE}")
CUR_WORKERS=$(jq '[.workers[] | select(.status == "running")] | length' "${Q}")
if (( CUR_WORKERS >= MAX_WORKERS )); then
  echo "[spawn-worker] at cap (${CUR_WORKERS}/${MAX_WORKERS}) for mode=${MODE} — not spawning"
  exit 0
fi

WID="worker-$(date -u +%s)-$$"
HOST="$(hostname 2>/dev/null || echo unknown)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
TMP=$(mktemp)
jq --arg id "${WID}" --arg h "${HOST}" --arg t "${NOW}" --arg m "${MODE}" '
  .workers += [{id:$id, host:$h, started_at:$t, last_heartbeat:$t, status:"running", compute_mode:$m}]
' "${Q}" > "${TMP}"
mv "${TMP}" "${Q}"
echo "${WID}"

# Run loop: drain queue while there's work + production isn't locked
MAX_RUNTIME=$(jq -r '.safety_caps.worker_max_runtime_seconds' "${COMPUTE}")
DEADLINE=$(( $(date +%s) + MAX_RUNTIME ))

while true; do
  if (( $(date +%s) > DEADLINE )); then break; fi
  "${REPO_ROOT}/agents/scripts/check-production-lock.sh" >/dev/null 2>&1 || {
    # locked → idle
    sleep 30
    continue
  }
  JOB=$("${REPO_ROOT}/agents/scripts/queue-manager.sh" dequeue)
  if [[ "${JOB}" == "(queue empty)" || -z "${JOB}" ]]; then
    sleep 10
    continue
  fi
  JOB_ID=$(echo "${JOB}" | jq -r '.id')
  AGENT=$(echo "${JOB}" | jq -r '.agent')
  echo "[worker ${WID}] picked job ${JOB_ID} (${AGENT})"
  if "${REPO_ROOT}/agents/scripts/run-agent.sh" "${AGENT}"; then
    "${REPO_ROOT}/agents/scripts/queue-manager.sh" complete "${JOB_ID}"
  else
    "${REPO_ROOT}/agents/scripts/queue-manager.sh" fail "${JOB_ID}" "run-agent.sh exit $?"
  fi
  # heartbeat
  "${REPO_ROOT}/agents/scripts/worker-heartbeat.sh" "${WID}"
done

# Clean exit
TMP=$(mktemp)
jq --arg id "${WID}" --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
  (.workers[] | select(.id == $id) | .status) = "exited"
  | (.workers[] | select(.id == $id) | .exited_at) = $t
' "${Q}" > "${TMP}"
mv "${TMP}" "${Q}"
echo "[worker ${WID}] exited cleanly"
