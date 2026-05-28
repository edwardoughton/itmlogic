#!/bin/bash
# SessionStart hook — installs Genoa's npm dependencies so tests/scripts
# work in remote (Claude Code on the web) sessions.  No-op locally.
#
# The Genoa app source lives in $CLAUDE_PROJECT_DIR/genoa/ (Node ≥20).
# This script is idempotent: re-running it is a fast npm-install no-op
# when the lockfile + node_modules already match.

set -euo pipefail

# Only run in remote (web) sessions.  Local devs already have their own
# environment configured.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
GENOA_DIR="$PROJECT_DIR/genoa"

if [ ! -f "$GENOA_DIR/package.json" ]; then
  echo "[session-start] $GENOA_DIR/package.json not found; nothing to install" >&2
  exit 0
fi

echo "[session-start] installing genoa npm dependencies in $GENOA_DIR"
cd "$GENOA_DIR"

# `npm install` (not `ci`) so subsequent runs in a cached container can
# fast-path when the lockfile is already satisfied.  --no-audit /
# --no-fund / --loglevel=error keep the output quiet and non-interactive.
npm install --no-audit --no-fund --loglevel=error

echo "[session-start] done; node_modules ready at $GENOA_DIR/node_modules"
