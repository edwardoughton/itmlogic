#!/usr/bin/env bash
# run-all-agents.sh — invoke every agent in the order defined by
# agents/runtime/compute-budget.json parallelism_rules.
#
# Concurrent groups run in parallel; serialized agents wait for all
# parallel groups to drain before starting.
#
# Each agent invocation runs with AGENT_POSTCOND_SOFT=1 so a single
# stalled agent does not abort the rest of the loop; the script ends
# with an explicit per-agent post-condition audit so the operator sees
# exactly which agents failed to persist canonical JSON.
#
# Usage:
#   run-all-agents.sh                       # one full pass
#   run-all-agents.sh --since-deploy        # only agents that depend on prod state

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="${REPO_ROOT}/agents/scripts/run-agent.sh"
RULES="${REPO_ROOT}/agents/runtime/compute-budget.json"
export AGENT_POSTCOND_SOFT=1

# Parallel groups
GROUPS_COUNT=$(jq '.parallelism_rules.concurrent_groups | length' "${RULES}")
echo "[run-all] ${GROUPS_COUNT} concurrent groups + serialized tail"

for ((G=0; G<GROUPS_COUNT; G++)); do
  GROUP=$(jq -r ".parallelism_rules.concurrent_groups[$G][]" "${RULES}")
  echo "[run-all] group $((G+1))/${GROUPS_COUNT}: ${GROUP//$'\n'/ }"
  PIDS=()
  for AGENT in ${GROUP}; do
    "${RUNNER}" "${AGENT}" &
    PIDS+=($!)
  done
  # Wait for the group to drain before moving to the next group
  EXIT=0
  for PID in "${PIDS[@]}"; do
    wait "${PID}" || EXIT=$?
  done
  if (( EXIT != 0 )); then
    echo "[run-all] group $((G+1)) had failures (exit ${EXIT}) — continuing to next group"
  fi
done

# Serialized tail (technical-pmp, program-director)
TAIL=$(jq -r '.parallelism_rules.serialized_after_all[]' "${RULES}")
for AGENT in ${TAIL}; do
  echo "[run-all] serialized: ${AGENT}"
  "${RUNNER}" "${AGENT}"
done

# Persistence audit — explicit per-agent status so the operator sees
# which agents (if any) failed to persist canonical JSON at HEAD.  Same
# checks the per-agent post-condition runs in hard mode, just rolled up
# at the end so a single agent's failure doesn't stop the loop.
HEAD_SHA=$(git -C "${REPO_ROOT}" rev-parse HEAD)
echo
echo "[run-all] persistence audit at HEAD ${HEAD_SHA:0:8}:"
STALE_COUNT=0
MISSING_COUNT=0
for AGENT_DIR in "${REPO_ROOT}/agents"/*/; do
  AGENT_NAME="$(basename "${AGENT_DIR}")"
  case "${AGENT_NAME}" in
    scripts|state|logs|reports|runtime) continue ;;
  esac
  [[ -f "${AGENT_DIR}/agent.md" ]] || continue
  FINDINGS="${AGENT_DIR}/last-findings.json"
  if [[ ! -f "${FINDINGS}" ]]; then
    echo "  MISSING  ${AGENT_NAME}/last-findings.json"
    MISSING_COUNT=$((MISSING_COUNT + 1))
    continue
  fi
  if ! node "${REPO_ROOT}/agents/scripts/validate-findings-json.js" "${FINDINGS}" >/dev/null 2>&1; then
    echo "  INVALID  ${AGENT_NAME}/last-findings.json"
    MISSING_COUNT=$((MISSING_COUNT + 1))
    continue
  fi
  FILE_SHA=$(node -e "
    const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));
    process.stdout.write(d.head_sha||'');
  " "${FINDINGS}")
  if [[ "${FILE_SHA}" != "${HEAD_SHA}" ]]; then
    echo "  STALE    ${AGENT_NAME}/last-findings.json (head_sha=${FILE_SHA:0:8} != HEAD ${HEAD_SHA:0:8})"
    STALE_COUNT=$((STALE_COUNT + 1))
  else
    echo "  OK       ${AGENT_NAME}/last-findings.json"
  fi
done
echo "[run-all] persistence audit: missing=${MISSING_COUNT} stale=${STALE_COUNT}"

# After all agents, dedupe + file issues
"${REPO_ROOT}/agents/scripts/create-issues-from-findings.sh"
echo "[run-all] full agent pass complete"

# Exit non-zero when the post-conditions surfaced a problem so CI / a
# wrapper can react.  The dedup + issue-filing step above still ran so
# the operator gets a partial result even on failure.
if (( MISSING_COUNT > 0 || STALE_COUNT > 0 )); then
  echo "[run-all] persistence audit failed (missing=${MISSING_COUNT} stale=${STALE_COUNT}) — see agents/<agent>/last-report.md narratives" >&2
  exit 3
fi
