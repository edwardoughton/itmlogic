#!/usr/bin/env bash
# test-run-agent-postcondition.sh — proves the run-agent.sh fail-loud
# post-conditions PD-003 / PMP-001 land correctly.  Three scenarios:
#
#   1. last-findings.json MISSING               → exit 3
#   2. last-findings.json present but STALE     → exit 3 (head_sha != HEAD)
#   3. last-findings.json present and CURRENT   → exit 0
#
# Builds a throwaway agents/ layout under a tempdir, drops in a stub
# agent.md so the directory looks like a real agent, points run-agent.sh
# at a fake REPO_ROOT, and exercises the post-condition logic.  Does
# NOT invoke claude --print (AGENT_RUNNER is left unset so the script
# skips the LLM call and runs the post-condition immediately).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUN_AGENT="${SCRIPTS_DIR}/run-agent.sh"

PASS=0
FAIL=0
pass(){ echo "  PASS  $1"; PASS=$((PASS + 1)); }
fail(){ echo "  FAIL  $1"; FAIL=$((FAIL + 1)); }

# Build the throwaway repo layout.  run-agent.sh resolves REPO_ROOT
# relative to its own location, so we have to copy the script (and
# validate-findings-json.js) into the temp tree.
WORK=$(mktemp -d)
trap 'rm -rf "${WORK}"' EXIT
mkdir -p "${WORK}/agents/scripts" "${WORK}/agents/fixture-agent"
cp "${RUN_AGENT}" "${WORK}/agents/scripts/"
cp "${SCRIPTS_DIR}/validate-findings-json.js" "${WORK}/agents/scripts/"
cp "${SCRIPTS_DIR}/check-production-lock.sh" "${WORK}/agents/scripts/" 2>/dev/null || \
  cat > "${WORK}/agents/scripts/check-production-lock.sh" <<'STUB'
#!/usr/bin/env bash
# stub for the postcondition test — production lock isn't relevant here.
exit 0
STUB
chmod +x "${WORK}/agents/scripts/run-agent.sh" "${WORK}/agents/scripts/check-production-lock.sh"

# Minimum agent.md so the script accepts the directory.
cat > "${WORK}/agents/fixture-agent/agent.md" <<'MD'
# fixture-agent
Stub used by test-run-agent-postcondition.sh.
MD

# Make WORK a git repo so run-agent.sh can call `git rev-parse HEAD`.
(
  cd "${WORK}"
  git init -q
  git -c user.email=test@example.com -c user.name=test config commit.gpgsign false
  git add agents
  git -c user.email=test@example.com -c user.name=test commit -q -m init
)
HEAD_SHA=$(git -C "${WORK}" rev-parse HEAD)

# Scenario 1 — last-findings.json missing.
rm -f "${WORK}/agents/fixture-agent/last-findings.json"
if ( cd "${WORK}" && bash agents/scripts/run-agent.sh fixture-agent >/dev/null 2>&1 ); then
  fail "scenario 1: missing last-findings.json was accepted (run-agent exited 0)"
else
  ec=$?
  if [[ "${ec}" == "3" ]]; then
    pass "scenario 1: missing last-findings.json -> exit 3"
  else
    fail "scenario 1: expected exit 3, got ${ec}"
  fi
fi

# Scenario 2 — last-findings.json present but stale head_sha.
cat > "${WORK}/agents/fixture-agent/last-findings.json" <<JSON
{
  "agent": "fixture-agent",
  "timestamp_utc": "2026-01-01T00:00:00Z",
  "head_sha": "0000000000000000000000000000000000000000",
  "branch": "test",
  "summary": "stale fixture",
  "deploy_recommendation": "NO_OP",
  "readiness_score": null,
  "findings": []
}
JSON
# Reset the .last-run-sha so the "no commits since last run" short-circuit
# doesn't preempt the post-condition.
rm -f "${WORK}/agents/fixture-agent/.last-run-sha"
if ( cd "${WORK}" && bash agents/scripts/run-agent.sh fixture-agent >/dev/null 2>&1 ); then
  fail "scenario 2: stale head_sha was accepted (run-agent exited 0)"
else
  ec=$?
  if [[ "${ec}" == "3" ]]; then
    pass "scenario 2: stale head_sha -> exit 3"
  else
    fail "scenario 2: expected exit 3, got ${ec}"
  fi
fi

# Scenario 3 — last-findings.json present and head_sha matches HEAD.
cat > "${WORK}/agents/fixture-agent/last-findings.json" <<JSON
{
  "agent": "fixture-agent",
  "timestamp_utc": "2026-01-01T00:00:00Z",
  "head_sha": "${HEAD_SHA}",
  "branch": "test",
  "summary": "current fixture",
  "deploy_recommendation": "NO_OP",
  "readiness_score": null,
  "findings": []
}
JSON
rm -f "${WORK}/agents/fixture-agent/.last-run-sha"
if ( cd "${WORK}" && bash agents/scripts/run-agent.sh fixture-agent >/dev/null 2>&1 ); then
  pass "scenario 3: current head_sha -> exit 0"
else
  ec=$?
  fail "scenario 3: expected exit 0, got ${ec}"
fi

# Scenario 4 — AGENT_POSTCOND_SOFT=1 downgrades fail to warn.
rm -f "${WORK}/agents/fixture-agent/last-findings.json" "${WORK}/agents/fixture-agent/.last-run-sha"
if ( cd "${WORK}" && AGENT_POSTCOND_SOFT=1 bash agents/scripts/run-agent.sh fixture-agent >/dev/null 2>&1 ); then
  pass "scenario 4: soft mode (missing JSON + AGENT_POSTCOND_SOFT=1) -> exit 0"
else
  fail "scenario 4: soft mode should not exit non-zero on missing JSON"
fi

echo "[test] summary: ${PASS} passed, ${FAIL} failed"
if [[ ${FAIL} -gt 0 ]]; then
  exit 1
fi
