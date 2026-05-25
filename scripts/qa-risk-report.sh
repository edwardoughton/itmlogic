#!/usr/bin/env bash
# Genoa QA risk report — runs the invariance + contradiction +
# determinism + sample-artifact suites and ranks the residual risks.
#
# Usage:
#   ./scripts/qa-risk-report.sh           # plain text, exit 0/1
#   ./scripts/qa-risk-report.sh > /tmp/qa-risk-$(date +%s).txt
#
# Output is plain text; lines start with PASS / WARN / FAIL so it's
# greppable for alerting.  Exit code is non-zero iff any suite has a
# failing assertion.
#
# Risk rank (highest → lowest):
#   1. findingContradictions       — wrong verdict cited on a filing
#   2. regressionInvariance        — silent drift across sidecar toggle
#   3. replayDeterminism            — exhibit is no longer reproducible
#   4. serviceWordingLeak           — wrong-service rule citation
#   5. sampleArtifactsSmoke         — pipeline failure on canonical inputs

set -u
cd "$(dirname "$0")/.." 2>/dev/null || true

ts() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }
echo "=== Genoa QA risk report  $(ts) ==="
echo

# Suites in risk-rank order.  The labels are intentionally identical
# to the test file basename so a grep on the output trivially locates
# the source file.
declare -a SUITES=(
  "findingContradictions:HIGH:Wrong verdict cited on a filing"
  "regressionInvariance:HIGH:Silent drift across sidecar toggle"
  "replayDeterminism:HIGH:Exhibit is no longer reproducible"
  "serviceWordingLeak:MED:Wrong-service rule citation leaks"
  "sampleArtifactsSmoke:MED:Pipeline failure on canonical inputs"
)

OVERALL_FAIL=0
TOTAL_PASS=0
TOTAL_FAIL=0
declare -a FAILED_SUITES=()

for entry in "${SUITES[@]}"; do
  IFS=':' read -r suite severity desc <<< "$entry"
  file="genoa/src/tests/${suite}.test.js"
  if [ ! -f "$file" ]; then
    echo "FAIL  [${severity}] ${suite} — test file missing: ${file}"
    OVERALL_FAIL=1
    FAILED_SUITES+=("${suite} (missing)")
    continue
  fi

  out=$(node --test "$file" 2>&1)
  pass=$(echo "$out" | grep -E '^# pass'     | tail -1 | awk '{print $NF}')
  fail=$(echo "$out" | grep -E '^# fail'     | tail -1 | awk '{print $NF}')
  total=$(echo "$out" | grep -E '^# tests'   | tail -1 | awk '{print $NF}')
  : "${pass:=0}"
  : "${fail:=0}"
  : "${total:=0}"
  TOTAL_PASS=$((TOTAL_PASS + pass))
  TOTAL_FAIL=$((TOTAL_FAIL + fail))

  if [ "${fail}" = "0" ]; then
    printf 'PASS  [%-4s] %-26s  %3s/%-3s  %s\n' \
      "$severity" "$suite" "$pass" "$total" "$desc"
  else
    printf 'FAIL  [%-4s] %-26s  %3s/%-3s  %s\n' \
      "$severity" "$suite" "$pass" "$total" "$desc"
    OVERALL_FAIL=1
    FAILED_SUITES+=("${suite}")
    # Bubble up the failing subtests for the operator.
    echo "$out" | grep -E '^not ok|^  error:' | sed 's/^/        /'
  fi
done

echo
echo "--- Risk summary ---"
printf 'Total passing assertions : %s\n' "$TOTAL_PASS"
printf 'Total failing assertions : %s\n' "$TOTAL_FAIL"
if [ "$OVERALL_FAIL" -eq 0 ]; then
  echo "PASS  QA invariance surface clean."
else
  echo "FAIL  QA invariance surface degraded — review:"
  for s in "${FAILED_SUITES[@]}"; do
    echo "        - ${s}"
  done
fi

echo
echo "=== qa-risk-report complete  $(ts) ==="
exit "$OVERALL_FAIL"
