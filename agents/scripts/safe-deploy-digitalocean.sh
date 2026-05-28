#!/usr/bin/env bash
# safe-deploy-digitalocean.sh — production deploy with full gate chain.
#
# Required env:
#   DIGITALOCEAN_ACCESS_TOKEN   doctl PAT with app read/write
#   DIGITALOCEAN_APP_ID         the dolphin-app UUID
#   AGENT_DEPLOY_MODE           must be 'safe_prod_write' to actually deploy
#   PRODUCTION_URL              e.g. https://genoaiq.com
#
# Optional env:
#   AGENT_MAX_DEPLOYS_PER_DAY              default 2
#   AGENT_ALLOWED_DEPLOY_WINDOW_START      UTC hour [0-23], default 13 (9am ET)
#   AGENT_ALLOWED_DEPLOY_WINDOW_END        UTC hour [0-23], default 22 (5pm ET)
#   AGENT_REQUIRE_MULTI_AGENT_APPROVAL     default true
#
# Flow:
#   1. Check production-lock.  Locked → abort.
#   2. Check AGENT_DEPLOY_MODE.  Only 'safe_prod_write' may push to prod.
#   3. Run safe-merge.sh (all pre-merge gates).
#   4. Check deploy budget (per-day cap + UTC window).
#   5. Check multi-agent approval if required (RF/regulatory changes).
#   6. Record last_good_sha + last_good_deploy_id.
#   7. Push to the deploy branch (DO auto-deploys on push).
#   8. Wait for the new deployment to reach ACTIVE.
#   9. Run post-deploy-smoke-test.sh.
#  10. On smoke failure → rollback-digitalocean.sh + lock-prod.sh.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

: "${DIGITALOCEAN_ACCESS_TOKEN:?DIGITALOCEAN_ACCESS_TOKEN required}"
: "${DIGITALOCEAN_APP_ID:?DIGITALOCEAN_APP_ID required}"
: "${PRODUCTION_URL:?PRODUCTION_URL required}"
AGENT_DEPLOY_MODE="${AGENT_DEPLOY_MODE:-pr_only}"
MAX_DEPLOYS_PER_DAY="${AGENT_MAX_DEPLOYS_PER_DAY:-2}"
WIN_START="${AGENT_ALLOWED_DEPLOY_WINDOW_START:-13}"
WIN_END="${AGENT_ALLOWED_DEPLOY_WINDOW_END:-22}"
REQUIRE_APPROVAL="${AGENT_REQUIRE_MULTI_AGENT_APPROVAL:-true}"

DEPLOY_HISTORY="agents/state/deploy-history.json"

echo "[safe-deploy] mode: ${AGENT_DEPLOY_MODE}"

# Gate 1 — production lock
"${REPO_ROOT}/agents/scripts/check-production-lock.sh"

# Gate 2 — mode
if [[ "${AGENT_DEPLOY_MODE}" != "safe_prod_write" ]]; then
  echo "[safe-deploy] AGENT_DEPLOY_MODE=${AGENT_DEPLOY_MODE} — refusing to deploy."
  echo "  set AGENT_DEPLOY_MODE=safe_prod_write to enable production writes."
  exit 0
fi

# Gate 3 — pre-merge gates
"${REPO_ROOT}/agents/scripts/safe-merge.sh"

# Gate 4 — per-day cap + UTC window
NOW_HOUR=$(date -u +%H)
if (( 10#$NOW_HOUR < 10#$WIN_START || 10#$NOW_HOUR >= 10#$WIN_END )); then
  echo "[safe-deploy] outside deploy window (UTC ${NOW_HOUR}, allowed ${WIN_START}-${WIN_END}); aborting" >&2
  exit 1
fi
TODAY=$(date -u +%Y-%m-%d)
DEPLOYS_TODAY=$(jq --arg d "${TODAY}" '[.deploys[] | select(.at | startswith($d))] | length' "${DEPLOY_HISTORY}")
if (( DEPLOYS_TODAY >= MAX_DEPLOYS_PER_DAY )); then
  echo "[safe-deploy] daily cap reached (${DEPLOYS_TODAY}/${MAX_DEPLOYS_PER_DAY})" >&2
  exit 1
fi

# Gate 5 — multi-agent approval (required when RF/regulatory paths changed)
RF_CHANGED=$(git diff --name-only HEAD~1 HEAD 2>/dev/null | grep -E '^genoa/src/engine/(fm|am|haat|curves|coverage)/' || true)
if [[ -n "${RF_CHANGED}" && "${REQUIRE_APPROVAL}" == "true" ]]; then
  APPROVALS_FILE="agents/state/deploy-approvals.json"
  if [[ ! -f "${APPROVALS_FILE}" ]]; then
    echo "[safe-deploy] RF paths changed but no approvals file at ${APPROVALS_FILE}" >&2
    exit 1
  fi
  HEAD_SHA=$(git rev-parse HEAD)
  REQUIRED=(principal-rf-engineer fcc-auditor program-director)
  for AGENT in "${REQUIRED[@]}"; do
    OK=$(jq --arg s "${HEAD_SHA}" --arg a "${AGENT}" \
      '[.approvals[]? | select(.change_sha == $s and .agent == $a and .approved == true)] | length' \
      "${APPROVALS_FILE}")
    if [[ "${OK}" != "1" ]]; then
      echo "[safe-deploy] missing approval from ${AGENT} for ${HEAD_SHA}" >&2
      exit 1
    fi
  done
  echo "[safe-deploy] multi-agent RF approval confirmed: ${REQUIRED[*]}"
fi

# Gate 6 — record last_good_sha BEFORE deploy
LAST_GOOD_DEPLOY_ID=$(curl -fsS \
  -H "Authorization: Bearer ${DIGITALOCEAN_ACCESS_TOKEN}" \
  "https://api.digitalocean.com/v2/apps/${DIGITALOCEAN_APP_ID}/deployments?per_page=1" \
  | jq -r '.deployments[0].id')
LAST_GOOD_SHA=$(curl -fsS \
  -H "Authorization: Bearer ${DIGITALOCEAN_ACCESS_TOKEN}" \
  "https://api.digitalocean.com/v2/apps/${DIGITALOCEAN_APP_ID}/deployments/${LAST_GOOD_DEPLOY_ID}" \
  | jq -r '.deployment.services[] | select(.name=="itmlogic-genoa") | .source_commit_hash')

TMP=$(mktemp)
jq --arg s "${LAST_GOOD_SHA}" --arg d "${LAST_GOOD_DEPLOY_ID}" \
   '.last_good_sha = $s | .last_good_deploy_id = $d' \
   "${DEPLOY_HISTORY}" > "${TMP}"
mv "${TMP}" "${DEPLOY_HISTORY}"
echo "[safe-deploy] last_good_sha = ${LAST_GOOD_SHA}"

# Gate 7 — push (DO auto-deploys on push to the configured branch)
CUR_BRANCH=$(git rev-parse --abbrev-ref HEAD)
ALLOWED_BRANCHES="master claude/genoa-rearchitecture-MPxd7"
if ! grep -q -w "${CUR_BRANCH}" <<< "${ALLOWED_BRANCHES}"; then
  echo "[safe-deploy] branch '${CUR_BRANCH}' not in allowed deploy branches: ${ALLOWED_BRANCHES}" >&2
  exit 1
fi
echo "[safe-deploy] pushing ${CUR_BRANCH}…"
git push origin "${CUR_BRANCH}"
NEW_SHA=$(git rev-parse HEAD)

# Gate 8 — wait for the new deployment to land
echo "[safe-deploy] waiting for new deployment to become ACTIVE…"
DEADLINE=$(( $(date +%s) + 900 ))
while true; do
  if (( $(date +%s) > DEADLINE )); then
    echo "[safe-deploy] deploy did not reach ACTIVE within 15 min" >&2
    exit 1
  fi
  STATUS=$(curl -fsS \
    -H "Authorization: Bearer ${DIGITALOCEAN_ACCESS_TOKEN}" \
    "https://api.digitalocean.com/v2/apps/${DIGITALOCEAN_APP_ID}" \
    | jq -r '.app.active_deployment.phase // "PENDING"')
  CUR_SHA=$(curl -fsS \
    -H "Authorization: Bearer ${DIGITALOCEAN_ACCESS_TOKEN}" \
    "https://api.digitalocean.com/v2/apps/${DIGITALOCEAN_APP_ID}" \
    | jq -r '.app.active_deployment.services[]? | select(.name=="itmlogic-genoa") | .source_commit_hash')
  echo "  status: phase=${STATUS}  sha=${CUR_SHA:0:8}"
  if [[ "${STATUS}" == "ACTIVE" && "${CUR_SHA}" == "${NEW_SHA}" ]]; then
    break
  fi
  sleep 15
done
echo "[safe-deploy] new deployment ACTIVE"

# Gate 9 — post-deploy smoke
if "${REPO_ROOT}/agents/scripts/post-deploy-smoke-test.sh"; then
  # Append success
  WHEN="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  TMP=$(mktemp)
  jq --arg s "${NEW_SHA}" --arg t "${WHEN}" --arg prev "${LAST_GOOD_SHA}" \
     '.deploys += [{at:$t, sha:$s, previous:$prev, smoke:"PASS"}]' \
     "${DEPLOY_HISTORY}" > "${TMP}"
  mv "${TMP}" "${DEPLOY_HISTORY}"
  echo "[safe-deploy] DEPLOY ${NEW_SHA:0:8} OK — smoke passed"
else
  # Gate 10 — automatic rollback
  echo "[safe-deploy] smoke FAILED — rolling back…" >&2
  "${REPO_ROOT}/agents/scripts/rollback-digitalocean.sh" "post-deploy smoke failed for ${NEW_SHA:0:8}"
  "${REPO_ROOT}/agents/scripts/lock-prod.sh" "auto-locked: smoke test failed after deploy ${NEW_SHA:0:8}"
  exit 1
fi
