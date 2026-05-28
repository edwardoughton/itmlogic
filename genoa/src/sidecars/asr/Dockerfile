# Genoa ASR sidecar — FCC Antenna Structure Registration lookups.
#
# Tier hierarchy (operator-locked policy — FCC ALWAYS tier 1):
#   Tier 1: Postgres-backed bulk DB (FCC ULS r_tower.zip weekly) ← official FCC
#   Tier 2: reserved for future independent ASR mirror (TBD)
#   Tier 3: ZTR rich-station passthrough (handled in main API; documented here)
#   Tier 4: Python cloudscraper bridge → REC Networks → radio-locator
#
# Architecturally mirrors the NEC sidecar (genoa/src/sidecars/nec/):
# Node Express server + Python subprocess bridge.  Single Dockerfile,
# single CMD, multi-language runtime.
#
# Why Python for tier 4?  Cloudflare/Akamai-protected pages (recnet.com,
# wireless2.fcc.gov) return 503 to naive Node fetch.  Python's
# `cloudscraper` mimics a real browser's TLS fingerprint + JS challenge
# handling and gets through.  Same rationale as nec_bridge.py — use the
# right tool per task.
#
# Final image is ~250 MB (Node 20 + Python 3.11 + npm deps + pip deps).

FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl wget \
        nodejs npm \
        python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# ── Node deps (Express, pg, unzipper for r_tower.zip stream-parse) ──
COPY package.json /app/package.json
RUN npm install --omit=dev \
 && node -e "import('express').then(()=>console.log('express OK'))" \
 && node -e "import('pg').then(()=>console.log('pg OK'))" \
 && node -e "import('unzipper').then(()=>console.log('unzipper OK'))"

# ── Python deps for tier-3 HTML bridge ──
# cloudscraper defeats Akamai's 503 wall on wireless2.fcc.gov;
# beautifulsoup4 parses the JSP-rendered detail page.
RUN pip3 install --no-cache-dir --break-system-packages \
        cloudscraper==1.2.71 \
        beautifulsoup4==4.12.3 \
 && python3 -c "import cloudscraper, bs4; print('cloudscraper', cloudscraper.__version__, 'bs4', bs4.__version__)"

# ── Sidecar source ──
COPY server.js          /app/server.js
COPY ulsBulkLoader.js   /app/ulsBulkLoader.js
COPY schema.sql         /app/schema.sql
COPY asr_html_bridge.py /app/asr_html_bridge.py
RUN chmod +x /app/asr_html_bridge.py

ENV SIDECAR_PORT=8087 \
    PYNEC_PYTHON_BIN=python3 \
    ASR_LOAD_REFRESH_DAYS=7 \
    ASR_HTML_BRIDGE_TIMEOUT_MS=15000

EXPOSE 8087

# Healthcheck verifies the Node server is listening AND the schema is
# applied.  /healthz reports loader_running / records_total separately
# so a slow first-load doesn't fail the healthcheck during startup.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO - http://localhost:8087/healthz | grep -q '"ok":true' \
   || exit 1

CMD ["node", "/app/server.js"]
