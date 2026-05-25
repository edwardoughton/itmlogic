# Genoa map sidecar — headless Chromium + Leaflet contour-map renderer.
#
# WHY THIS LIVES IN ITS OWN CONTAINER
#   Chromium (the binary the headless renderer drives) ships ~250 MB of
#   shared objects, fonts, and a sandbox helper.  Putting it in the
#   Genoa API image would bloat every API rollout to no benefit on
#   nodes that never render a map.  This sidecar runs only when a
#   compute is requested with `options.map_render: true` (or the
#   engineering-statement PDF asks for an embedded contour map).
#
# WHY DEBIAN BOOKWORM
#   apt's `chromium` package is current (Stable channel ~120+); there
#   is no Snap or other indirection (which would fail headless).  Node
#   20 is available via NodeSource — the Bookworm `nodejs` package is
#   stuck at v18 which is fine but we keep parity with the API.
#
# RENDER PIPELINE (server.js)
#   POST /render { exhibit, options? }  →  PNG body
#     1. Inject the exhibit JSON into a Leaflet HTML template.
#     2. Open the page in a warm headless Chromium tab.
#     3. Wait for tile load + layer ready signals.
#     4. Screenshot the body at 1500 × 1000 px (≈150 dpi when scaled
#        to a 7.4″ × 5.4″ PDF placement).
#     5. Stream the PNG back to the API.
#   Health: GET /health  →  { ok: true, browser_pid, render_count }.

FROM debian:bookworm-slim AS runtime
ENV DEBIAN_FRONTEND=noninteractive

# Chromium runtime deps + Node 20 from NodeSource.  `chromium-sandbox`
# is required for the setuid sandbox; without it Chromium refuses to
# launch as non-root and headless mode fails with "Failed to move to
# new namespace".
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg \
        chromium chromium-sandbox \
        fonts-liberation fonts-dejavu-core \
        libnss3 libxss1 libgbm1 libasound2 libatk1.0-0 libatk-bridge2.0-0 \
        libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
        libxrandr2 libpango-1.0-0 libpangocairo-1.0-0 \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json /app/package.json
COPY server.js    /app/server.js
COPY render.html  /app/render.html

RUN npm install --omit=dev \
 && node -e "import('puppeteer-core').then(()=>console.log('puppeteer-core OK'))"

# A non-root user is mandatory; Chromium will refuse the sandbox if
# launched as root unless --no-sandbox is set, and --no-sandbox is a
# security regression we don't accept here.
RUN useradd --system --create-home --shell /usr/sbin/nologin renderer \
 && chown -R renderer:renderer /app
USER renderer

ENV SIDECAR_PORT=8086 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    RENDER_WIDTH_PX=1500 \
    RENDER_HEIGHT_PX=1000 \
    RENDER_TIMEOUT_MS=20000

EXPOSE 8086

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:8086/health | grep -q '"ok":true' || exit 1

CMD ["node", "/app/server.js"]
