#!/usr/bin/env bash
# check-production-lock.sh — exit 0 if production writes are allowed, 1 if locked.
#
# Reads agents/state/production-lock.json.  Used as a precondition by
# every other script that mutates production (safe-deploy, rollback).
#
# Usage:
#   check-production-lock.sh           # silent on unlocked, prints reason on locked
#   check-production-lock.sh --verbose # always print state

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LOCK_FILE="${REPO_ROOT}/agents/state/production-lock.json"

if [[ ! -f "${LOCK_FILE}" ]]; then
  echo "ERROR: lock file missing at ${LOCK_FILE}" >&2
  exit 2
fi

LOCKED=$(jq -r '.locked' "${LOCK_FILE}")

if [[ "${LOCKED}" == "true" ]]; then
  REASON=$(jq -r '.locked_reason // "(no reason given)"' "${LOCK_FILE}")
  WHO=$(jq -r '.locked_by // "(unknown)"' "${LOCK_FILE}")
  WHEN=$(jq -r '.locked_at // "(unknown)"' "${LOCK_FILE}")
  echo "PRODUCTION LOCKED" >&2
  echo "  by:     ${WHO}" >&2
  echo "  at:     ${WHEN}" >&2
  echo "  reason: ${REASON}" >&2
  echo "" >&2
  echo "  unlock with: npm run agents:unlock-prod -- '<reason>'" >&2
  exit 1
fi

if [[ "${1:-}" == "--verbose" ]]; then
  echo "production-lock: UNLOCKED"
fi
exit 0
