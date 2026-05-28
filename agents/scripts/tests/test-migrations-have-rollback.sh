#!/usr/bin/env bash
# test-migrations-have-rollback.sh — devsecops DSO-002 gate.  Every
# *.sql under genoa/src/db/migrations/ must either:
#
#   (a) contain a `-- ROLLBACK:` comment block describing the inverse
#       statement, OR
#   (b) have a companion `*_down.sql` file in the same directory.
#
# Agent.md checklist item 6 (every migration MUST have a rollback) is
# unambiguous.  Without this the operator has to reconstruct the down-
# path under pressure during an emergency revert — exactly the kind of
# thing that goes wrong at 3 AM.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
MIG_DIR="${REPO_ROOT}/genoa/src/db/migrations"

PASS=0
FAIL=0
pass(){ echo "  PASS  $1"; PASS=$((PASS + 1)); }
fail(){ echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }

if [[ ! -d "${MIG_DIR}" ]]; then
  echo "[test] migrations dir ${MIG_DIR} does not exist — skipping"
  exit 0
fi

shopt -s nullglob
MIGRATIONS=("${MIG_DIR}"/[0-9]*.sql)
if [[ ${#MIGRATIONS[@]} -eq 0 ]]; then
  echo "[test] no numbered migration files found in ${MIG_DIR} — skipping"
  exit 0
fi

# Exclude any *_down.sql from the set we're auditing; those ARE the
# rollbacks for sibling files.
for mig in "${MIGRATIONS[@]}"; do
  base="$(basename "${mig}")"
  case "${base}" in
    *_down.sql) continue ;;
  esac
  stem="${base%.sql}"
  companion="${MIG_DIR}/${stem}_down.sql"
  if [[ -f "${companion}" ]]; then
    pass "${base}: paired ${stem}_down.sql exists"
    continue
  fi
  # Case-insensitive `-- ROLLBACK:` comment.  Allow leading whitespace
  # so future migrations can indent the block.
  if grep -qE '^[[:space:]]*--[[:space:]]*ROLLBACK:' "${mig}"; then
    pass "${base}: -- ROLLBACK: comment block present"
  else
    fail "${base}: no -- ROLLBACK: comment block and no companion ${stem}_down.sql"
  fi
done

echo "[test] summary: ${PASS} passed, ${FAIL} failed"
if [[ ${FAIL} -gt 0 ]]; then
  exit 1
fi
