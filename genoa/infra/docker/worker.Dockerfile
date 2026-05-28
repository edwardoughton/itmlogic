# genoa-worker — async job processor.
FROM node:20-alpine
WORKDIR /app

ARG GIT_COMMIT_SHA=uncommitted
ENV GIT_COMMIT_SHA=${GIT_COMMIT_SHA}

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src
COPY data ./data

ENV NODE_ENV=production
USER node
CMD ["node", "src/workers/index.js"]
