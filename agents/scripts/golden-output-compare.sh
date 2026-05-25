#!/usr/bin/env bash
# golden-output-compare.sh — diffs current exhibit JSON output vs locked
# golden snapshots.  Catches silent regressions where the engine produces
# numerically different contour distances for a known reference station.
#
# Snapshots live at agents/golden/<call>.json — they are the EXPECTED
# JSON output of buildExhibit() for that station.  Refresh manually
# with: npm run agents:refresh-golden -- --confirm "<reason>"

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GOLDEN_DIR="${REPO_ROOT}/agents/golden"
mkdir -p "${GOLDEN_DIR}"

# If no snapshots locked yet, this is a green pass (the agent system
# bootstraps without golden until refreshed).
if ! ls "${GOLDEN_DIR}"/*.json >/dev/null 2>&1; then
  echo "[golden] no snapshots locked yet — pass (bootstrap)"
  exit 0
fi

cd "${REPO_ROOT}/genoa"

FAIL=0
for SNAP in "${GOLDEN_DIR}"/*.json; do
  CALL=$(basename "${SNAP}" .json)
  TMP=$(mktemp)
  # Re-compute the exhibit from the same input the snapshot was taken at
  node -e "
    import('./src/engine/index.js').then(async (m) => {
      const inputs = $(jq -c '.station_inputs' "${SNAP}");
      const out = await m.buildExhibit({ inputs, options: $(jq -c '.options // {}' "${SNAP}") });
      console.log(JSON.stringify({
        polygons: out.polygons,
        radial_table: out.radial_table,
        method_versions: out.method_versions
      }, Object.keys({}).sort()));
    });
  " > "${TMP}"

  EXPECTED=$(jq -c '{polygons: .polygons, radial_table: .radial_table, method_versions: .method_versions}' "${SNAP}")
  ACTUAL=$(cat "${TMP}")
  if [[ "${EXPECTED}" != "${ACTUAL}" ]]; then
    echo "[golden] DIVERGED: ${CALL}"
    diff <(echo "${EXPECTED}" | jq .) <(echo "${ACTUAL}" | jq .) | head -40
    FAIL=$((FAIL + 1))
  else
    echo "[golden] ${CALL} match"
  fi
done

if (( FAIL > 0 )); then
  echo "[golden] FAIL: ${FAIL} snapshots diverged" >&2
  exit 1
fi
echo "[golden] OK: all snapshots match"
