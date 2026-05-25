# genoa-identity-sidecar — thin adapter around chelstein/massdns,
# chelstein/EAS-Tools, chelstein/zerotrustradio (read-only).
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src

ENV PORT=8083
EXPOSE 8083
USER node

HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8083/health || exit 1

CMD ["node", "src/sidecars/identity/server.js"]
