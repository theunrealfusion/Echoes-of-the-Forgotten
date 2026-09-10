#!/bin/bash
# ==============================================================================
# generate_assets.sh — Full Tripo V3 asset generation pipeline
# ==============================================================================
# Usage: ./scripts/generate_assets.sh [--dry-run] [--zone <zone_id>]
#   --dry-run   Validate prompts and config without calling the API
#   --zone      Only generate assets for a specific zone (e.g. sunken_library)
# ==============================================================================

set -euo pipefail

DRY_RUN=""
ZONE_FILTER=""

# Parse optional arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN="--dry-run"
      shift
      ;;
    --zone)
      ZONE_FILTER="--zone $2"
      shift 2
      ;;
    *)
      echo "⚠️  Unknown argument: $1"
      shift
      ;;
  esac
done

echo ""
echo "🎨  Tripo V3 Asset Generation Pipeline"
echo "======================================="
echo ""

# Ensure we're running from the project root
if [ ! -f "requirements.txt" ]; then
  echo "❌  Error: Run this script from the project root."
  exit 1
fi

# Verify .env exists and has a real API key
if [ ! -f .env ]; then
  echo "❌  .env file not found."
  echo "   Run: cp .env.example .env"
  echo "   Then add your TRIPO_API_KEY."
  exit 1
fi

TRIPO_KEY=$(grep -E '^TRIPO_API_KEY=' .env | cut -d '=' -f2 | tr -d '[:space:]')
if [ -z "${TRIPO_KEY}" ] || [ "${TRIPO_KEY}" = "your_tripo_api_key_here" ]; then
  echo "❌  TRIPO_API_KEY is not set in .env."
  echo "   Get your key at: https://developers.tripo3d.ai"
  exit 1
fi

# Step 1: Validate API connectivity
echo "🔌  Step 1/2 — Testing Tripo API connection..."
python3 pipeline/batch_runner.py test-connection

echo ""
echo "🏗️   Step 2/2 — Generating all assets..."
# shellcheck disable=SC2086
python3 pipeline/batch_runner.py generate-all ${DRY_RUN} ${ZONE_FILTER}

OUTPUT_DIR=$(grep -E '^ASSET_OUTPUT_DIR=' .env 2>/dev/null | cut -d '=' -f2 | tr -d '[:space:]' || echo 'assets/models')

echo ""
echo "✅  Asset generation complete!"
echo "   Models saved to: ${OUTPUT_DIR}"
echo ""
echo "🎮  Open the game:"
echo "   Option A (quick):       open game/index.html"
echo "   Option B (recommended): ./scripts/serve.sh"
echo ""
