#!/usr/bin/env bash
# lock-prod.sh — block any further agent-initiated deploys.
#
# Usage:
#   lock-prod.sh "<reason>"
#   npm run agents:lock-prod -- "<reason>"
#
# Appends an audit entry; multiple locks are safe (idempotent).

set -euo pipefail

REASON="${1:-locked by operator (no reason given)}"
WHO="${USER:-unknown}@$(hostname 2>/dev/null || echo unknown)"
WHEN="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCK_FILE="${REPO_ROOT}/agents/state/production-lock.json"

TMP=$(mktemp)
jq --arg w "${WHO}" --arg t "${WHEN}" --arg r "${REASON}" '
  .locked        = true       |
  .locked_at     = $t         |
  .locked_by     = $w         |
  .locked_reason = $r         |
  .audit_log    += [{action: "LOCK", at: $t, by: $w, reason: $r}]
' "${LOCK_FILE}" > "${TMP}"
mv "${TMP}" "${LOCK_FILE}"

echo "LOCKED: ${REASON}"
echo "  by:   ${WHO}"
echo "  at:   ${WHEN}"
echo "  file: ${LOCK_FILE}"
