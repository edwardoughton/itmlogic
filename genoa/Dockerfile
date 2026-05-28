# Top-level Dockerfile for DigitalOcean App Platform.
# Three-stage build:
#   1) sha-stage — COPY in .git, run `git rev-parse HEAD` and
#      `git describe --tags --always --dirty`, write three small
#      files (.build_sha / .build_tag / .build_time) that the
#      runtime image baked-in.  This is what makes every exhibit
#      carry an immutable build SHA + release tag instead of the
#      'uncommitted' fallback.
#   2) ui-build  — install ALL deps (incl. Vite/React/Tailwind), run
#      vite build to emit src/ui/dist/.
#   3) runtime   — production-only deps + the engine + the built UI
#      + the three .build_* files baked at /app.
#
# Build context: REPO ROOT (DO app spec source_dir = ".") so that
# .git/ is available to sha-stage.  Per-stage COPY paths are
# prefixed with `genoa/` accordingly.
#
# Sidecar / worker Dockerfiles live under infra/docker/.

FROM node:20-alpine AS sha-stage
RUN apk add --no-cache git
WORKDIR /repo
# We only need .git to extract the SHA + tag.  Copying the rest of
# the tree would just slow this stage down — but it also means there
# is no working tree to compare against, so `git describe --dirty`
# would always report "-dirty" (every tracked file appears deleted
# from the empty /repo working tree).  Omit --dirty for that reason;
# DO App Platform builds from a clean checkout, the "dirty" signal
# would be meaningless here even if the work tree were copied.
COPY .git ./.git
RUN sh -c '\
  git --git-dir=/repo/.git rev-parse HEAD                          > /repo/.build_sha  2>/dev/null || echo "uncommitted" > /repo/.build_sha; \
  git --git-dir=/repo/.git describe --tags --always                > /repo/.build_tag  2>/dev/null || echo "untagged"    > /repo/.build_tag; \
  date -u +%Y-%m-%dT%H:%M:%SZ                                      > /repo/.build_time'

FROM node:20-alpine AS ui-build
WORKDIR /app

COPY genoa/package*.json ./
RUN npm install --no-audit --no-fund

COPY genoa/vite.config.js genoa/tailwind.config.js genoa/postcss.config.js ./
COPY genoa/src ./src
COPY genoa/data ./data

RUN npm run build:ui

FROM node:20-alpine AS runtime
WORKDIR /app

COPY genoa/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY genoa/src ./src
COPY genoa/data ./data
# scripts/ contains the bake-off harnesses (itmBakeOff.js,
# itmBakeOffItwom.js) which are Useful To Run From Inside the
# Container — they hit the splat sidecar over the internal network
# (SPLAT_SIDECAR_URL=http://splat:8080) using the SPLAT_API_TOKEN
# already in env, so nobody has to know the token to validate the
# JS port against the C++ reference.
COPY genoa/scripts ./scripts
# Carry the built UI into the runtime image.
COPY --from=ui-build /app/src/ui/dist ./src/ui/dist
# Bake the immutable build identity into the runtime image so
# engine/signature.js can read it without a network round-trip and
# without needing GIT_COMMIT_SHA injected via DO env var.
COPY --from=sha-stage /repo/.build_sha  ./.build_sha
COPY --from=sha-stage /repo/.build_tag  ./.build_tag
COPY --from=sha-stage /repo/.build_time ./.build_time

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "src/api/server.js"]
