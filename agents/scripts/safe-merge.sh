#!/usr/bin/env bash
# safe-merge.sh — pre-merge gate.  Runs every test/lint/build/regression
# check the agent system requires before a PR is merged.
#
# Usage:
#   safe-merge.sh                 # run on current branch
#   safe-merge.sh <pr_number>     # checkout PR HEAD first
#
# Exits 0 only when ALL gates pass.

set -euo pipefail
trap 'echo "[safe-merge] FAILED at line $LINENO" >&2; exit 1' ERR

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${REPO_ROOT}"

echo "[safe-merge] gate 1/7: clean working tree"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "  FAIL: uncommitted changes" >&2
  exit 1
fi

echo "[safe-merge] gate 2/7: npm test (regression suite + golden curves)"
( cd genoa && npm test --silent ) | tail -10

echo "[safe-merge] gate 3/7: regulatory regression"
"${REPO_ROOT}/agents/scripts/regulatory-regression-test.sh"

echo "[safe-merge] gate 4/7: golden output compare"
"${REPO_ROOT}/agents/scripts/golden-output-compare.sh"

echo "[safe-merge] gate 5/7: build"
if ( cd genoa && grep -q '"build"' package.json ); then
  ( cd genoa && npm run build --silent ) | tail -5
else
  echo "  SKIP: no build script defined"
fi

echo "[safe-merge] gate 6/7: lint"
if ( cd genoa && grep -q '"lint"' package.json ); then
  ( cd genoa && npm run lint --silent ) | tail -5
else
  echo "  SKIP: no lint script defined"
fi

echo "[safe-merge] gate 7/7: no secrets in diff"
if git diff --cached --unified=0 | grep -E '(BEGIN [A-Z ]*PRIVATE KEY|aws_secret|password\s*=\s*["'\''][^"'\'']{8,}|_TOKEN\s*=\s*["'\''][A-Za-z0-9_-]{16,}|EV\[1:[A-Za-z0-9+/]{20,})' > /dev/null 2>&1; then
  echo "  FAIL: secret-like pattern in diff" >&2
  exit 1
fi

echo "[safe-merge] ALL GATES PASSED"
