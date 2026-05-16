# Genoa FAA-airports sidecar — public-use airport / heliport proximity
# lookups for the §17.7(c) notification-to-FAA gate.
#
# Data source: OurAirports.com — free, daily-updated CSV redistribution
# of FAA NASR + ICAO airport datasets.  We bulk-load it weekly, filter
# to US public-use facilities (excluding closed/seaplane/balloonport),
# and serve a /airports/near?lat&lon&radius_nm endpoint that the
# tower-compliance engine consults whenever it needs to decide whether
# §17.7(c) applies.
#
# Architecture mirrors the asr sidecar: Node 20 + Express + Postgres,
# weekly bulk-load, rolling 4-week archive of the raw CSV.

FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl wget \
        nodejs npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json /app/package.json
RUN npm install --omit=dev \
 && node -e "import('express').then(()=>console.log('express OK'))" \
 && node -e "import('pg').then(()=>console.log('pg OK'))"

COPY server.js          /app/server.js
COPY airportsLoader.js  /app/airportsLoader.js
COPY schema.sql         /app/schema.sql

ENV SIDECAR_PORT=8088 \
    AIRPORTS_LOAD_REFRESH_DAYS=7

EXPOSE 8088

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO - http://localhost:8088/healthz | grep -q '"ok":true' \
   || exit 1

CMD ["node", "/app/server.js"]
