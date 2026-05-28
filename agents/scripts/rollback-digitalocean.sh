#!/usr/bin/env bash
# rollback-digitalocean.sh — restore the previous deployment.
#
# Uses DO's "create deployment from previous spec" endpoint.  Reads
# last_good_deploy_id + last_good_sha from agents/state/deploy-history.json
# (written by safe-deploy-digitalocean.sh BEFORE each new deploy).
#
# Usage:
#   rollback-digitalocean.sh "<reason>"
#
# Always:
#   - records the rollback in deploy-history.json
#   - writes an incident report to agents/reports/incidents/
#   - opens a GitHub issue if GITHUB_TOKEN is set
#   - locks production writes (operator must explicitly unlock)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

REASON="${1:-rollback initiated (no reason given)}"
WHEN="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

: "${DIGITALOCEAN_ACCESS_TOKEN:?DIGITALOCEAN_ACCESS_TOKEN required}"
: "${DIGITALOCEAN_APP_ID:?DIGITALOCEAN_APP_ID required}"

DEPLOY_HISTORY="agents/state/deploy-history.json"
LAST_GOOD_SHA=$(jq -r '.last_good_sha' "${DEPLOY_HISTORY}")
LAST_GOOD_DEPLOY_ID=$(jq -r '.last_good_deploy_id' "${DEPLOY_HISTORY}")

if [[ -z "${LAST_GOOD_SHA}" || "${LAST_GOOD_SHA}" == "null" ]]; then
  echo "[rollback] no last_good_sha recorded — cannot rollback automatically" >&2
  exit 1
fi
echo "[rollback] rolling back to deploy ${LAST_GOOD_DEPLOY_ID} (sha ${LAST_GOOD_SHA:0:8})"
echo "[rollback] reason: ${REASON}"

# Trigger a new deployment from the previous spec.
# DO API: POST /v2/apps/{app_id}/deployments  with { rollback: { deployment_id } }
curl -fsS \
  -X POST \
  -H "Authorization: Bearer ${DIGITALOCEAN_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"rollback\":{\"deployment_id\":\"${LAST_GOOD_DEPLOY_ID}\"}}" \
  "https://api.digitalocean.com/v2/apps/${DIGITALOCEAN_APP_ID}/deployments" \
  > /tmp/rollback-resp.json

NEW_ROLLBACK_DEPLOY_ID=$(jq -r '.deployment.id' /tmp/rollback-resp.json)
echo "[rollback] kicked off rollback deployment ${NEW_ROLLBACK_DEPLOY_ID}"

# Wait for rollback to reach ACTIVE
DEADLINE=$(( $(date +%s) + 900 ))
while true; do
  if (( $(date +%s) > DEADLINE )); then
    echo "[rollback] rollback did not finish within 15 min" >&2
    break
  fi
  PHASE=$(curl -fsS \
    -H "Authorization: Bearer ${DIGITALOCEAN_ACCESS_TOKEN}" \
    "https://api.digitalocean.com/v2/apps/${DIGITALOCEAN_APP_ID}/deployments/${NEW_ROLLBACK_DEPLOY_ID}" \
    | jq -r '.deployment.phase')
  echo "  rollback phase=${PHASE}"
  if [[ "${PHASE}" == "ACTIVE" ]]; then
    break
  fi
  sleep 15
done

# Record in deploy-history
TMP=$(mktemp)
jq --arg t "${WHEN}" --arg s "${LAST_GOOD_SHA}" --arg id "${NEW_ROLLBACK_DEPLOY_ID}" --arg r "${REASON}" \
   '.deploys += [{at:$t, sha:$s, action:"ROLLBACK", to_deploy_id:$id, reason:$r}]' \
   "${DEPLOY_HISTORY}" > "${TMP}"
mv "${TMP}" "${DEPLOY_HISTORY}"

# Write incident report
INCIDENT_DIR="${REPO_ROOT}/agents/reports/incidents"
mkdir -p "${INCIDENT_DIR}"
INCIDENT_FILE="${INCIDENT_DIR}/incident-${WHEN//[:]/-}.md"
cat > "${INCIDENT_FILE}" <<EOF
# Production rollback — ${WHEN}

## Reason
${REASON}

## Action taken
Rolled back to DigitalOcean deployment \`${LAST_GOOD_DEPLOY_ID}\` (sha \`${LAST_GOOD_SHA}\`)
via \`/v2/apps/${DIGITALOCEAN_APP_ID}/deployments\` rollback POST.

## Rollback deployment id
\`${NEW_ROLLBACK_DEPLOY_ID}\`

## Next steps
1. Investigate the root cause of the smoke-test failure
2. Determine whether the rollback target is healthy
3. Unlock production once the bug is fixed and a fresh PR is reviewed
   - \`npm run agents:unlock-prod -- "<reason>"\`
EOF
echo "[rollback] incident report at ${INCIDENT_FILE}"

# Open a GitHub issue if we have a token
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
  curl -fsS \
    -X POST \
    -H "Authorization: token ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github.v3+json" \
    -d "$(jq -n --arg title "PROD rollback ${WHEN}" --arg body "$(cat "${INCIDENT_FILE}")" '{title:$title, body:$body, labels:["incident","auto-rollback","priority/high"]}')" \
    "https://api.github.com/repos/chelstein/itmlogic/issues" \
    > /tmp/rollback-issue.json
  ISSUE_NUMBER=$(jq -r '.number' /tmp/rollback-issue.json)
  echo "[rollback] opened GitHub issue #${ISSUE_NUMBER}"
else
  echo "[rollback] (no GITHUB_TOKEN — skipping issue creation)"
fi

# Lock production writes until human acks
"${REPO_ROOT}/agents/scripts/lock-prod.sh" "auto-locked: rollback at ${WHEN} — ${REASON}"
echo "[rollback] DONE"
