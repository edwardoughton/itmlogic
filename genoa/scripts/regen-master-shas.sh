#!/usr/bin/env bash
# Regenerate MASTER_SHA256SUMS.txt entries for the canonical raster
# layers Genoa samples.  Idempotent: existing entries for the listed
# files are replaced rather than duplicated.  Run on the droplet that
# hosts the geodata corpus (/opt/genoa).
#
#   ./regen-master-shas.sh
#   ./regen-master-shas.sh --root /custom/corpus
#
# Adding a new layer: append its corpus-relative path to RASTERS below.

set -euo pipefail

ROOT="/opt/genoa"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root) ROOT="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

# Corpus-relative paths matching genoa/src/evidence/geodata/config.js.
# Order does not matter; sha256sum output sorts deterministically per
# input order on POSIX.
RASTERS=(
  "sources/nlcd/Annual_NLCD_FctImp_2024_CU_C1V1/Annual_NLCD_FctImp_2024_CU_C1V1.tif"
  "sources/landcover/mex_land_cover_2020v2_30m_tif/MEX_NALCMS_landcover_2020v2_30m/data/MEX_NALCMS_landcover_2020v2_30m.tif"
  "sources/vegetation/2024_perennial_herbaceous_departure/2024_perennial_herbaceous_departure_20250608.tif"
)

# Directory layers (kind: json_dir).  We compute a deterministic
# "sha-of-shas" rollup by hashing every regular file under the dir,
# sorting the per-file sha lines, then hashing that.  The resulting
# single sha is filed under the dir's corpus-relative path so the
# Genoa side can look it up with the same shaFor() lookup as rasters.
DIRS=(
  "live-data/fcc-contours/tests"
)

cd "$ROOT"
MASTER="MASTER_SHA256SUMS.txt"
touch "$MASTER"

# Compute fresh sha256s for present files; warn on missing.
tmp_new="$(mktemp)"
trap 'rm -f "$tmp_new"' EXIT
present=()
for rel in "${RASTERS[@]}"; do
  if [[ -f "$rel" ]]; then
    present+=("$rel")
  else
    echo "warn: missing $ROOT/$rel — skipping" >&2
  fi
done
if [[ ${#present[@]} -gt 0 ]]; then
  sha256sum "${present[@]}" > "$tmp_new"
fi

# Directory rollups.
dirs_present=()
for rel in "${DIRS[@]}"; do
  if [[ -d "$rel" ]]; then
    dirs_present+=("$rel")
    # find -> stable order via LC_ALL=C sort of file paths
    rollup="$( \
      (cd "$rel" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum) \
        | sha256sum | awk '{print $1}' \
    )"
    printf '%s  %s\n' "$rollup" "$rel" >> "$tmp_new"
  else
    echo "warn: missing $ROOT/$rel — skipping dir rollup" >&2
  fi
done

# Strip any existing lines for the items we just hashed, then
# append the fresh entries.  Match on suffix " <relpath>" so the
# inevitable double-space sha256sum format collides cleanly.
tmp_merged="$(mktemp)"
trap 'rm -f "$tmp_new" "$tmp_merged"' EXIT
cp "$MASTER" "$tmp_merged"
for rel in "${present[@]}" "${dirs_present[@]}"; do
  # shellcheck disable=SC2001
  esc="$(echo "$rel" | sed 's/[][\.*^$/]/\\&/g')"
  sed -i "/  ${esc}\$/d" "$tmp_merged"
done
cat "$tmp_new" >> "$tmp_merged"

mv "$tmp_merged" "$MASTER"

echo "regenerated entries for ${#present[@]} raster(s) + ${#dirs_present[@]} dir rollup(s):"
for rel in "${present[@]}" "${dirs_present[@]}"; do
  grep -F "  $rel" "$MASTER" | sed 's/^/  /'
done
echo
echo "$MASTER total lines: $(wc -l <"$MASTER")"
