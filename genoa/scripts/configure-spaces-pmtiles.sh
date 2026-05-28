#!/usr/bin/env bash
#
# configure-spaces-pmtiles.sh — set up a DigitalOcean Spaces bucket to
# serve a PMTiles basemap to the browser (per docs.protomaps.com cloud
# storage: HTTP Range + CORS).
#
# PMTiles reads the archive with HTTP Range requests. If the browser hits
# Spaces DIRECTLY (pmtiles://https://<bucket>.<region>.digitaloceanspaces.com/...),
# Spaces must (a) allow public reads of the object and (b) return CORS
# headers for genoaiq.com — that's what this applies.
#
# NOTE: if you instead serve via Genoa's same-origin /basemap proxy
# (BASEMAP_URL), CORS is NOT required (the browser never talks to Spaces);
# you only need the object readable by the proxy. This script is for the
# direct-from-Spaces path.
#
# PREREQS: awscli configured with your Spaces key/secret.
#
# CONFIG (env)
#   SPACES_BUCKET     bucket name (REQUIRED)
#   SPACES_ENDPOINT   e.g. https://nyc3.digitaloceanspaces.com (REQUIRED)
#   PUBLIC_PREFIX     key prefix to expose public-read (default: basemap/)

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLIC_PREFIX="${PUBLIC_PREFIX:-basemap/}"

: "${SPACES_BUCKET:?set SPACES_BUCKET}"
: "${SPACES_ENDPOINT:?set SPACES_ENDPOINT (e.g. https://nyc3.digitaloceanspaces.com)}"
command -v aws >/dev/null || { echo "ERROR: awscli not found." >&2; exit 2; }

echo ">> Applying CORS (range + etag) for genoaiq.com to ${SPACES_BUCKET}"
aws s3api put-bucket-cors \
  --endpoint-url "${SPACES_ENDPOINT}" \
  --bucket "${SPACES_BUCKET}" \
  --cors-configuration "file://${HERE}/spaces-cors.json"

echo ">> Granting public-read to objects under ${PUBLIC_PREFIX}"
aws s3api put-bucket-policy \
  --endpoint-url "${SPACES_ENDPOINT}" \
  --bucket "${SPACES_BUCKET}" \
  --policy "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadBasemap",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::${SPACES_BUCKET}/${PUBLIC_PREFIX}*"
    }
  ]
}
JSON
)"

echo ""
echo ">> Verify CORS:"
echo "   aws s3api get-bucket-cors --endpoint-url ${SPACES_ENDPOINT} --bucket ${SPACES_BUCKET}"
echo ">> Done. The basemap .pmtiles under ${PUBLIC_PREFIX} is now public + CORS-enabled."
echo "   Direct use in the style:  pmtiles://${SPACES_ENDPOINT%/}/${SPACES_BUCKET}/${PUBLIC_PREFIX}<file>.pmtiles"
echo "   (DO Spaces is HTTP/1.1 only; for HTTP/2 + same-origin, keep the /basemap proxy.)"
