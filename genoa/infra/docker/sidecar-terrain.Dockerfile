# genoa-terrain-sidecar — thin adapter around chelstein/splat,
# chelstein/itmlogic, chelstein/ZTRpsITS.
#
# The base image only ships the Node adapter; for the sidecar to actually
# do work, the upstream tools must be available at runtime (mounted in,
# baked in, or provided by another container).  Set TERRAIN_BACKEND=splat
# | itmlogic | ztrpsits and ensure the binary is on PATH.
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src

ENV PORT=8081
EXPOSE 8081
USER node

HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8081/health || exit 1

CMD ["node", "src/sidecars/terrain/server.js"]
