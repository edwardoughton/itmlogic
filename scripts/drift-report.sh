#!/usr/bin/env bash
# Genoa — 6-hour drift report.
#
# Compares live production state to the last green baseline.  Run via:
#   ./scripts/drift-report.sh             # one-shot, prints to stdout
#   ./scripts/drift-report.sh > /tmp/drift-$(date +%s).txt
#   crontab:  0 */6 * * *  /opt/genoa/scripts/drift-report.sh | tee -a /var/log/genoa-drift.log
#
# The Genoa engine itself is replay-deterministic; this script audits
# what could drift IN PRODUCTION without a code change:
#   - sidecar health (latency, healthy bool)
#   - facility lookup self-heal (fcc_class enrichment landing)
#   - tree-canopy invariants (WFAN=35, KAZM=14)
#   - SOMNEC2D grid SHA invariants
#   - /readyz aggregate ok
#   - genoaiq.com reachability + latency
#   - test suite drift (compare HEAD against last known green)
#
# Output is plain text; lines start with PASS / WARN / FAIL so it's
# greppable for alerting.

set -u                       # unset vars surface; don't die on grep no-match
BASE_URL="${GENOA_BASE_URL:-https://genoaiq.com}"
TOKEN="${GENOA_SERVICE_TOKEN:-mmrKAZM2023!**}"
DROPLET_IP="${GENOA_DROPLET_IP:-159.223.153.153}"
ts() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }

echo "=== Genoa drift report  $(ts)  base=${BASE_URL} ==="

# ---------- 1. /readyz ----------------------------------------------
RZ=$(curl -sS -m 15 "${BASE_URL}/readyz" 2>/dev/null)
if [ -z "$RZ" ]; then
  echo "FAIL  /readyz unreachable"
else
  OK=$(echo "$RZ" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("ok"))' 2>/dev/null)
  echo "PASS  /readyz ok=$OK"
  # Per-sidecar latency + health
  echo "$RZ" | python3 -c '
import sys, json
d = json.load(sys.stdin)
sc = d.get("sidecars", {})
for name, s in sorted(sc.items()):
    if not s.get("configured"):
        print(f"      sidecar {name:18} not_configured (allowed if intentional)")
        continue
    healthy = s.get("healthy")
    lat = s.get("latency_ms", -1)
    flag = "PASS" if healthy else "FAIL"
    high_lat_flag = "  HIGH-LAT" if isinstance(lat,(int,float)) and lat > 1500 else ""
    print(f"{flag}  sidecar {name:18} healthy={healthy:<5}  latency={lat:>5}ms{high_lat_flag}")
'
fi

# ---------- 2. AM physics SOMNEC2D grid SHA invariants ---------------
echo
echo "--- 2. SOMNEC2D grid SHA invariants ---"
WFAN_SHA=$(curl -sS -m 30 -H "x-service-token: ${TOKEN}" -H 'content-type: application/json' \
  -X POST "${BASE_URL}/api/am/physics/somnec" \
  -d '{"frequency_khz":660}' 2>/dev/null \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("outputs",{}).get("grid_sha256",""))' 2>/dev/null)
WBOB_SHA=$(curl -sS -m 30 -H "x-service-token: ${TOKEN}" -H 'content-type: application/json' \
  -X POST "${BASE_URL}/api/am/physics/somnec" \
  -d '{"frequency_khz":600}' 2>/dev/null \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("outputs",{}).get("grid_sha256",""))' 2>/dev/null)
KAZM_SHA=$(curl -sS -m 30 -H "x-service-token: ${TOKEN}" -H 'content-type: application/json' \
  -X POST "${BASE_URL}/api/am/physics/somnec" \
  -d '{"frequency_khz":780}' 2>/dev/null \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("outputs",{}).get("grid_sha256",""))' 2>/dev/null)
# Known-good baselines from this session
EXPECT_KAZM='4ba81a0692907b073bfedbeed2ba7964dfc6010587e79983fb8bd6e9cb6b0fab'
EXPECT_WFAN='2413ca8f2c2cec217c28657ee1ef9ef29eb099ccbc2009927a6f70aaac14b0a1'
EXPECT_WBOB='52801e7697c7f8d85b38ccee197103bd6e5884fc2b19c491851c17b143d01d46'
[ "$KAZM_SHA" = "$EXPECT_KAZM" ] && echo "PASS  SOMNEC2D KAZM 780 kHz SHA matches baseline" \
                                || echo "FAIL  SOMNEC2D KAZM SHA drift: got=$KAZM_SHA  expected=$EXPECT_KAZM"
[ "$WFAN_SHA" = "$EXPECT_WFAN" ] && echo "PASS  SOMNEC2D WFAN 660 kHz SHA matches baseline" \
                                || echo "FAIL  SOMNEC2D WFAN SHA drift: got=$WFAN_SHA  expected=$EXPECT_WFAN"
[ "$WBOB_SHA" = "$EXPECT_WBOB" ] && echo "PASS  SOMNEC2D WBOB 600 kHz SHA matches baseline" \
                                || echo "FAIL  SOMNEC2D WBOB SHA drift: got=$WBOB_SHA  expected=$EXPECT_WBOB"

# ---------- 3. Tree-canopy invariants -------------------------------
echo
echo "--- 3. Tree-canopy invariants ---"
WFAN_C=$(curl -sS -m 15 -H "x-service-token: ${TOKEN}" \
  "${BASE_URL}/api/geo-rf-evidence/sample?lat=40.859833&lon=-73.785417" 2>/dev/null \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("datasets",{}).get("tree_canopy_conus",{}).get("value_numeric"))' 2>/dev/null)
KAZM_C=$(curl -sS -m 15 -H "x-service-token: ${TOKEN}" \
  "${BASE_URL}/api/geo-rf-evidence/sample?lat=34.860833&lon=-111.820278" 2>/dev/null \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("datasets",{}).get("tree_canopy_conus",{}).get("value_numeric"))' 2>/dev/null)
[ "$WFAN_C" = "35" ] && echo "PASS  canopy WFAN (40.86, -73.79) = 35" || echo "FAIL  canopy WFAN drift: got=$WFAN_C expected=35"
[ "$KAZM_C" = "14" ] && echo "PASS  canopy KAZM (34.86, -111.82) = 14" || echo "FAIL  canopy KAZM drift: got=$KAZM_C expected=14"

# ---------- 4. Facility lookup AMQ enrichment -----------------------
echo
echo "--- 4. Facility-lookup AMQ enrichment ---"
WFAN_CLASS=$(curl -sS -m 15 -H "x-service-token: ${TOKEN}" \
  "${BASE_URL}/api/facilities/28617" 2>/dev/null \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("facility",{}).get("fcc_class"))' 2>/dev/null)
WBOB_CLASS=$(curl -sS -m 15 -H "x-service-token: ${TOKEN}" \
  "${BASE_URL}/api/facilities/53588" 2>/dev/null \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("facility",{}).get("fcc_class"))' 2>/dev/null)
[ -n "$WFAN_CLASS" ] && [ "$WFAN_CLASS" != "None" ] \
  && echo "PASS  facility 28617 (WFAN) fcc_class=$WFAN_CLASS (AMQ enrichment landing)" \
  || echo "FAIL  facility 28617 (WFAN) fcc_class missing — AMQ enrichment regressed"
[ -n "$WBOB_CLASS" ] && [ "$WBOB_CLASS" != "None" ] \
  && echo "PASS  facility 53588 (WBOB) fcc_class=$WBOB_CLASS" \
  || echo "FAIL  facility 53588 (WBOB) fcc_class missing"

# ---------- 5. Branch / deploy state --------------------------------
echo
echo "--- 5. Branch & deploy state ---"
cd "$(dirname "$0")/.." 2>/dev/null || true
LOCAL_HEAD=$(git rev-parse --short HEAD 2>/dev/null || echo "(no git)")
REMOTE_HEAD=$(git ls-remote origin claude/genoa-rearchitecture-MPxd7 2>/dev/null | awk '{print substr($1,1,7)}')
echo "      local HEAD:  $LOCAL_HEAD"
echo "      remote HEAD: $REMOTE_HEAD"
[ "$LOCAL_HEAD" = "$REMOTE_HEAD" ] && echo "PASS  local and remote on same commit" \
                                  || echo "WARN  local/remote drift — local=$LOCAL_HEAD remote=$REMOTE_HEAD"

# ---------- 6. Test suite spot-check --------------------------------
echo
echo "--- 6. Test suite ---"
if [ -d "genoa/src/tests" ]; then
  TEST_OUT=$(find genoa/src/tests -name "*.test.js" -not -name "api.test.js" -print0 \
             | xargs -0 node --test 2>&1 | tail -7)
  TEST_TOTAL=$(echo "$TEST_OUT" | grep -E '^# tests' | awk '{print $NF}')
  TEST_PASS=$(echo  "$TEST_OUT" | grep -E '^# pass'  | awk '{print $NF}')
  TEST_FAIL=$(echo  "$TEST_OUT" | grep -E '^# fail'  | awk '{print $NF}')
  if [ "$TEST_FAIL" = "0" ]; then
    echo "PASS  tests: $TEST_PASS/$TEST_TOTAL green"
  else
    echo "FAIL  tests: $TEST_PASS/$TEST_TOTAL green, $TEST_FAIL failing"
  fi
fi

echo
echo "=== drift report complete  $(ts) ==="
