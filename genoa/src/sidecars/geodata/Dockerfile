# Genoa geodata sidecar — runs on the droplet next to the FORTRAN
# sidecar; gives the App Platform Genoa container HTTP access to
# /opt/genoa rasters via gdallocationinfo.
#
# The /opt/genoa corpus is expected to be bind-mounted into the
# container at run time:
#   docker run -d --name genoa-geodata \
#     -p 8089:8089 \
#     -e GEODATA_SIDECAR_TOKEN="$(openssl rand -hex 32)" \
#     -v /opt/genoa:/opt/genoa:ro \
#     genoa-geodata:latest
#
# Container is read-only against the corpus.

FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive

# gdal-bin gives us gdallocationinfo + gdalinfo.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl \
        nodejs npm \
        gdal-bin \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json /app/package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY server.js /app/server.js

ENV PORT=8089
ENV GEODATA_ROOT=/opt/genoa
EXPOSE 8089

# Anyone curling the container should get a healthz response.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/healthz || exit 1

CMD ["node", "server.js"]
