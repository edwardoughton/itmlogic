#!/usr/bin/env bash
# run-loop.sh — long-running agent loop.  Designed for `nohup ... &` /
# a systemd unit / a docker entrypoint.  Schedule-aware: each agent
# runs at its own cadence, deduped against the last run.
#
# Schedule (UTC):
#   every 6h:  full audit (all agents)
#   daily 0600: rf engineer + fcc attorney + fcc auditor + gis + reporting
#   every 12h: devsecops
#   daily 0100 + 1300: technical-pmp + program-director (summary)
#
# Loop exits cleanly on SIGTERM (writes "loop stopped" to the runtime log).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOG="${REPO_ROOT}/agents/logs/loop.log"
mkdir -p "$(dirname "${LOG}")"

cleanup(){ echo "[loop] SIGTERM — stopping" | tee -a "${LOG}"; exit 0; }
trap cleanup SIGTERM SIGINT

POLL_INTERVAL_SEC="${POLL_INTERVAL_SEC:-300}"   # 5 min default

# Track when each schedule last fired
declare -A LAST
LAST[full_audit]=0
LAST[daily]=0
LAST[devsec]=0
LAST[summary]=0

while true; do
  NOW=$(date -u +%s)
  HOUR=$(date -u +%H)

  # Production lock check — pause loop if locked
  if ! "${REPO_ROOT}/agents/scripts/check-production-lock.sh" >/dev/null 2>&1; then
    echo "[loop] production locked — running report-only agents" | tee -a "${LOG}"
    export AGENT_DEPLOY_MODE=report_only
  fi

  # full audit every 6h
  if (( NOW - LAST[full_audit] >= 21600 )); then
    echo "[loop] $(date -u) — full audit" | tee -a "${LOG}"
    "${REPO_ROOT}/agents/scripts/run-all-agents.sh" >> "${LOG}" 2>&1 || true
    LAST[full_audit]=$NOW
  fi

  # daily 0600 UTC
  TODAY=$(date -u +%Y-%m-%d)
  if [[ "${HOUR}" == "06" && "${LAST[daily]}" != "${TODAY}" ]]; then
    echo "[loop] ${TODAY}T06:00 — daily agents" | tee -a "${LOG}"
    for A in principal-rf-engineer fcc-attorney fcc-auditor gis-terrain-scientist evidence-reporting-agent; do
      "${REPO_ROOT}/agents/scripts/run-agent.sh" "${A}" >> "${LOG}" 2>&1 || true
    done
    LAST[daily]="${TODAY}"
  fi

  # devsec every 12h (00 + 12 UTC)
  if [[ ( "${HOUR}" == "00" || "${HOUR}" == "12" ) && "${LAST[devsec]}" != "${TODAY}-${HOUR}" ]]; then
    "${REPO_ROOT}/agents/scripts/run-agent.sh" devsecops-agent >> "${LOG}" 2>&1 || true
    LAST[devsec]="${TODAY}-${HOUR}"
  fi

  # summary 0100 + 1300 UTC
  if [[ ( "${HOUR}" == "01" || "${HOUR}" == "13" ) && "${LAST[summary]}" != "${TODAY}-${HOUR}" ]]; then
    "${REPO_ROOT}/agents/scripts/run-agent.sh" technical-pmp   >> "${LOG}" 2>&1 || true
    "${REPO_ROOT}/agents/scripts/run-agent.sh" program-director >> "${LOG}" 2>&1 || true
    LAST[summary]="${TODAY}-${HOUR}"
  fi

  sleep "${POLL_INTERVAL_SEC}"
done
