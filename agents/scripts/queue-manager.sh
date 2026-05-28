#!/usr/bin/env bash
# queue-manager.sh — manage agents/runtime/job-queue.json.
#
# Subcommands:
#   enqueue <agent> <priority> <payload-json>   add a job
#   list                                         show pending jobs
#   dequeue                                      pop highest-priority pending job
#   complete <job_id>                            mark done
#   fail <job_id> <reason>                       mark failed (retry-eligible)
#   sweep                                        clear stale workers (no heartbeat > 15min)
#
# Priorities: low | normal | high | critical (sorted in that order, FIFO within tier).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
Q="${REPO_ROOT}/agents/runtime/job-queue.json"

SUBCMD="${1:-}"
shift || true

case "${SUBCMD}" in
  enqueue)
    AGENT="${1:?agent name required}"
    PRIO="${2:-normal}"
    PAYLOAD="${3:-{}}"
    TMP=$(mktemp)
    jq --arg a "${AGENT}" --arg p "${PRIO}" --argjson pl "${PAYLOAD}" --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
      .next_job_id as $id
      | .jobs += [{
          id: $id, agent: $a, priority: $p, payload: $pl,
          status: "pending", enqueued_at: $t, attempts: 0
        }]
      | .next_job_id = ($id + 1)
    ' "${Q}" > "${TMP}"
    mv "${TMP}" "${Q}"
    echo "[queue] enqueued ${AGENT} (priority=${PRIO})"
    ;;

  list)
    jq '.jobs | map(select(.status == "pending"))' "${Q}"
    ;;

  dequeue)
    NEXT=$(jq -r '
      .jobs
      | map(select(.status == "pending"))
      | sort_by([
          (if .priority == "critical" then 0
           elif .priority == "high" then 1
           elif .priority == "normal" then 2
           else 3 end),
          .enqueued_at
        ])
      | .[0] // empty
    ' "${Q}")
    if [[ -z "${NEXT}" ]]; then
      echo "(queue empty)"
      exit 0
    fi
    JOB_ID=$(echo "${NEXT}" | jq -r '.id')
    TMP=$(mktemp)
    jq --arg id "${JOB_ID}" --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
      (.jobs[] | select(.id == ($id|tonumber)) | .status) = "running"
      | (.jobs[] | select(.id == ($id|tonumber)) | .started_at) = $t
      | (.jobs[] | select(.id == ($id|tonumber)) | .attempts) += 1
    ' "${Q}" > "${TMP}"
    mv "${TMP}" "${Q}"
    echo "${NEXT}"
    ;;

  complete)
    JOB_ID="${1:?job id required}"
    TMP=$(mktemp)
    jq --arg id "${JOB_ID}" --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '
      (.jobs[] | select(.id == ($id|tonumber)) | .status) = "done"
      | (.jobs[] | select(.id == ($id|tonumber)) | .completed_at) = $t
    ' "${Q}" > "${TMP}"
    mv "${TMP}" "${Q}"
    ;;

  fail)
    JOB_ID="${1:?job id required}"
    REASON="${2:-(no reason)}"
    TMP=$(mktemp)
    jq --arg id "${JOB_ID}" --arg t "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg r "${REASON}" '
      (.jobs[] | select(.id == ($id|tonumber)) | .status) = "failed"
      | (.jobs[] | select(.id == ($id|tonumber)) | .failed_at) = $t
      | (.jobs[] | select(.id == ($id|tonumber)) | .last_error) = $r
    ' "${Q}" > "${TMP}"
    mv "${TMP}" "${Q}"
    ;;

  sweep)
    NOW=$(date -u +%s)
    STALE_AFTER=$(jq '.safety_caps.stale_worker_cleanup_after_seconds' "${REPO_ROOT}/agents/runtime/compute-budget.json")
    TMP=$(mktemp)
    jq --argjson now "${NOW}" --argjson stale "${STALE_AFTER}" '
      .workers = (.workers // [] | map(
        if (.last_heartbeat | sub("Z$"; "") | strptime("%Y-%m-%dT%H:%M:%S") | mktime) < ($now - $stale)
        then . + { status: "stale" }
        else .
        end))
      | .last_swept_at = (now | strftime("%Y-%m-%dT%H:%M:%SZ"))
    ' "${Q}" > "${TMP}"
    mv "${TMP}" "${Q}"
    echo "[queue] swept; stale workers marked"
    ;;

  *)
    echo "usage: queue-manager.sh {enqueue|list|dequeue|complete|fail|sweep} ..." >&2
    exit 2
    ;;
esac
