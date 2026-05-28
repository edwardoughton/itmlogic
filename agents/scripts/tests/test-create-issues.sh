#!/usr/bin/env bash
# test-create-issues.sh — proves the canonical findings pipeline handles
# all three input shapes cleanly:
#
#   1. valid              — last-findings.json present and conformant
#   2. markdown-fallback  — only last-report.md, but it embeds a valid JSON block
#   3. malformed          — neither path has parseable JSON
#
# Builds a throwaway agents/ layout under a tempdir, runs the validator
# and create-issues-from-findings.sh against it in --dry-run, and
# asserts the expected behavior.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
FIXTURES="${SCRIPT_DIR}/fixtures"

PASS=0
FAIL=0

pass() { echo "  PASS  $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }

echo "[test] validator: valid fixture should pass"
if node "${SCRIPTS_DIR}/validate-findings-json.js" "${FIXTURES}/valid/last-findings.json" >/dev/null; then
  pass "valid/last-findings.json accepted"
else
  fail "valid/last-findings.json rejected"
fi

echo "[test] validator: malformed input should fail with a clear error"
TMP_BAD=$(mktemp)
printf '{"agent": "x"}' > "${TMP_BAD}"
if node "${SCRIPTS_DIR}/validate-findings-json.js" "${TMP_BAD}" 2>/dev/null; then
  fail "incomplete JSON was accepted (bug)"
else
  pass "incomplete JSON rejected"
fi
rm -f "${TMP_BAD}"

echo "[test] validator: bad severity enum should fail"
TMP_ENUM=$(mktemp)
cat >"${TMP_ENUM}" <<'JSON'
{
  "agent": "x", "timestamp_utc": "2026-01-01T00:00:00Z", "head_sha": "abc",
  "branch": "main", "summary": "s", "deploy_recommendation": "NO_OP",
  "readiness_score": null,
  "findings": [{
    "finding_id": "X", "title": "t", "severity": "CRITICAL", "confidence": 0.1,
    "category": "c", "affected_files": [], "regulatory_scope": [],
    "recommended_fix": "f", "tests_required": [], "deployment_risk": "low",
    "human_review_required": false, "reproducibility_notes": "r"
  }]
}
JSON
if node "${SCRIPTS_DIR}/validate-findings-json.js" "${TMP_ENUM}" 2>/dev/null; then
  fail "bad severity enum accepted (bug)"
else
  pass "bad severity enum rejected"
fi
rm -f "${TMP_ENUM}"

echo "[test] end-to-end: dry-run over a synthetic agents/ tree"
WORK=$(mktemp -d)
trap 'rm -rf "${WORK}"' EXIT
mkdir -p "${WORK}/agents/state" "${WORK}/agents/scripts" \
         "${WORK}/agents/valid-agent" "${WORK}/agents/fallback-agent" "${WORK}/agents/malformed-agent"

cp "${SCRIPTS_DIR}/create-issues-from-findings.sh" "${WORK}/agents/scripts/"
cp "${SCRIPTS_DIR}/validate-findings-json.js"     "${WORK}/agents/scripts/"
cp "${FIXTURES}/valid/last-findings.json"             "${WORK}/agents/valid-agent/last-findings.json"
cp "${FIXTURES}/markdown-fallback/last-report.md"     "${WORK}/agents/fallback-agent/last-report.md"
cp "${FIXTURES}/malformed/last-report.md"             "${WORK}/agents/malformed-agent/last-report.md"
printf '{"_comment":"test","findings":{}}\n' > "${WORK}/agents/state/findings-dedup.json"

LOG=$(mktemp)
if "${WORK}/agents/scripts/create-issues-from-findings.sh" --dry-run > "${LOG}" 2>&1; then
  pass "dry-run exited 0 even with malformed agent"
else
  fail "dry-run exited nonzero (script must not crash)"
fi

if grep -q "valid-agent: 1 finding" "${LOG}"; then
  pass "valid-agent surfaced via canonical JSON path"
else
  fail "valid-agent not detected"; cat "${LOG}"
fi
if grep -q "fallback-agent: 1 finding" "${LOG}"; then
  pass "fallback-agent surfaced via markdown JSON block"
else
  fail "fallback-agent not detected"; cat "${LOG}"
fi
if grep -q "malformed-agent" "${LOG}" && grep -q "skipping" "${LOG}"; then
  pass "malformed-agent skipped with warning, not a crash"
else
  fail "malformed-agent not properly skipped"; cat "${LOG}"
fi
rm -f "${LOG}"

echo "[test] summary: ${PASS} passed, ${FAIL} failed"
if [[ ${FAIL} -gt 0 ]]; then
  exit 1
fi
