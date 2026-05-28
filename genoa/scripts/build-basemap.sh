#!/usr/bin/env bash
#
# build-basemap.sh — produce a CONUS basemap .pmtiles and upload it to
# DigitalOcean Spaces, so Genoa's /basemap proxy can serve it same-origin
# (blocker-proof) for the Live Map.
#
# This is the "convert → upload to S3" flow from the PMTiles README,
# pinned to Genoa's needs. Run it on a machine (your laptop or the
# droplet) — NOT in the app; it needs the tools below and bandwidth.
#
# PREREQS
#   - pmtiles CLI   (go-pmtiles): https://github.com/protomaps/go-pmtiles/releases
#   - awscli        (talks to Spaces; S3-compatible)
#
# WHAT IT DOES
#   1. Extracts a bounding-box subset of a source PMTiles into a smaller
#      regional file (CONUS by default — a few GB vs ~100 GB planet).
#      `pmtiles extract` reads the source over HTTP range requests, so
#      SOURCE_PMTILES can be a remote URL (e.g. a Protomaps build).
#   2. Uploads the result to Spaces with a long cache header and
#      public-read, and prints the URL to set as BASEMAP_URL.
#
# CONFIG (env vars)
#   SOURCE_PMTILES   source archive URL or path (a Protomaps planet build,
#                    or a regional extract). REQUIRED.
#   BBOX             min_lon,min_lat,max_lon,max_lat (default: CONUS).
#   OUT              output filename (default: genoa-basemap.pmtiles).
#   SPACES_BUCKET    Spaces bucket name. REQUIRED to upload.
#   SPACES_ENDPOINT  e.g. https://nyc3.digitaloceanspaces.com. REQUIRED to upload.
#   SPACES_KEY_PATH  object key in the bucket (default: basemap/<OUT>).
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  Spaces credentials.
#
# AFTER RUNNING
#   - Set BASEMAP_URL on the Genoa app to the printed object URL
#     (the /basemap proxy then serves it at https://<host>/basemap).
#   - In maputnik (open /styles/genoa.json) swap the carto-dark raster for
#     { "type":"vector", "url":"pmtiles://https://<host>/basemap" } and
#     style the Protomaps schema layers; save back to /styles/genoa.json.

set -euo pipefail

BBOX="${BBOX:--125,24,-66.9,49.5}"     # continental US
OUT="${OUT:-genoa-basemap.pmtiles}"
SPACES_KEY_PATH="${SPACES_KEY_PATH:-basemap/${OUT}}"

if [[ -z "${SOURCE_PMTILES:-}" ]]; then
  echo "ERROR: set SOURCE_PMTILES to a source .pmtiles URL or path (e.g. a Protomaps planet build)." >&2
  exit 2
fi
command -v pmtiles >/dev/null || { echo "ERROR: pmtiles CLI not found — install go-pmtiles." >&2; exit 2; }

echo ">> Extracting ${BBOX} from ${SOURCE_PMTILES} -> ${OUT}"
pmtiles extract "${SOURCE_PMTILES}" "${OUT}" --bbox="${BBOX}"
echo ">> Built ${OUT} ($(du -h "${OUT}" | cut -f1))"

if [[ -n "${SPACES_BUCKET:-}" && -n "${SPACES_ENDPOINT:-}" ]]; then
  command -v aws >/dev/null || { echo "ERROR: awscli not found — needed to upload to Spaces." >&2; exit 2; }
  echo ">> Uploading to s3://${SPACES_BUCKET}/${SPACES_KEY_PATH}"
  aws s3 cp "${OUT}" "s3://${SPACES_BUCKET}/${SPACES_KEY_PATH}" \
    --endpoint-url "${SPACES_ENDPOINT}" \
    --acl public-read \
    --content-type application/octet-stream \
    --cache-control "public, max-age=604800"
  # Derive a public URL: https://<bucket>.<endpoint-host>/<key>
  host="${SPACES_ENDPOINT#https://}"
  echo ""
  echo ">> Done. Set BASEMAP_URL to:"
  echo "     https://${SPACES_BUCKET}.${host}/${SPACES_KEY_PATH}"
  echo "   (Genoa's /basemap proxy will serve it same-origin at https://<host>/basemap)"
else
  echo ">> Skipped upload (set SPACES_BUCKET + SPACES_ENDPOINT to enable)."
  echo "   Upload ${OUT} to Spaces, then set BASEMAP_URL to its object URL."
fi
