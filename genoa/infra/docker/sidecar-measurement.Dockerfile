# genoa-measurement-sidecar — thin adapter around chelstein/SigMF,
# chelstein/EAS-Tools, chelstein/EAS_Listener.
FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src

ENV PORT=8082
EXPOSE 8082
USER node

HEALTHCHECK --interval=30s --timeout=5s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8082/health || exit 1

CMD ["node", "src/sidecars/measurement/server.js"]
