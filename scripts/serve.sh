#!/bin/bash
# ==============================================================================
# serve.sh — Local development server for A Gift for the Forgotten City
# ==============================================================================
# Usage: ./scripts/serve.sh [PORT]
#   PORT defaults to 8080 (or $PORT from .env if present)
# ==============================================================================

set -euo pipefail

# Load PORT from .env if present (avoids exposing API secrets)
if [ -f .env ]; then
  _ENV_PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d '=' -f2 | tr -d '[:space:]') || true
fi

# Priority: CLI arg > .env value > default 8080
PORT="${1:-${_ENV_PORT:-8080}}"

echo ""
echo "🌌  A Gift for the Forgotten City — Local Dev Server"
echo "======================================================"
echo "   Serving: ./game/"
echo "   URL:      http://localhost:${PORT}"
echo "   Stop:     Ctrl + C"
echo ""

if [ ! -d "game" ]; then
  echo "❌  Error: 'game/' directory not found."
  echo "   Run this script from the project root."
  exit 1
fi

cd game
exec python3 -m http.server "${PORT}"
