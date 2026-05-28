#!/usr/bin/env bash
# unlock-prod.sh — restore agent-initiated deploy authority.
#
# Usage:
#   unlock-prod.sh "<reason>"
#   npm run agents:unlock-prod -- "<reason>"
#
# REQUIRES a reason (so the audit log is meaningful).

set -euo pipefail

REASON="${1:-}"
if [[ -z "${REASON}" ]]; then
  echo "ERROR: reason required.  Usage: unlock-prod.sh \"<reason>\"" >&2
  exit 2
fi

WHO="${USER:-unknown}@$(hostname 2>/dev/null || echo unknown)"
WHEN="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCK_FILE="${REPO_ROOT}/agents/state/production-lock.json"

TMP=$(mktemp)
jq --arg w "${WHO}" --arg t "${WHEN}" --arg r "${REASON}" '
  .locked        = false      |
  .locked_at     = null       |
  .locked_by     = null       |
  .locked_reason = null       |
  .audit_log    += [{action: "UNLOCK", at: $t, by: $w, reason: $r}]
' "${LOCK_FILE}" > "${TMP}"
mv "${TMP}" "${LOCK_FILE}"

echo "UNLOCKED: ${REASON}"
echo "  by: ${WHO}"
echo "  at: ${WHEN}"
