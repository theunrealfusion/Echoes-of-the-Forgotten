#!/bin/bash
# ==============================================================================
# setup.sh — One-shot project setup for A Gift for the Forgotten City
# ==============================================================================
# Usage: ./scripts/setup.sh
# Run once after cloning the repository.
# ==============================================================================

set -euo pipefail

echo ""
echo "🌌  A Gift for the Forgotten City — Project Setup"
echo "==================================================="
echo ""

# Ensure we're running from the project root
if [ ! -f "requirements.txt" ]; then
  echo "❌  Error: Run this script from the project root directory."
  exit 1
fi

# Step 1: Create .env from template (idempotent — skips if already exists)
if [ -f .env ]; then
  echo "ℹ️   .env already exists — skipping copy."
else
  cp .env.example .env
  echo "✅  Created .env from .env.example"
fi

# Step 2: Install Python dependencies
echo ""
echo "📦  Installing Python dependencies..."
if command -v pip3 &>/dev/null; then
  pip3 install -r requirements.txt
elif command -v pip &>/dev/null; then
  pip install -r requirements.txt
else
  echo "⚠️  pip not found. Install Python 3.9+ and try again."
  echo "   https://www.python.org/downloads/"
fi

# Step 3: Create required output directories
echo ""
echo "📁  Creating output directories..."
mkdir -p \
  assets/models \
  assets/concepts \
  assets/exports \
  assets/manifests

echo "   assets/models      — Generated .glb files"
echo "   assets/concepts    — Concept art images"
echo "   assets/exports     — Packaged build artifacts"
echo "   assets/manifests   — Zone and asset manifests"

# Step 4: Make all scripts executable
echo ""
echo "🔐  Setting script permissions..."
chmod +x scripts/*.sh
echo "   scripts/*.sh → executable"

# Done!
echo ""
echo "=================================================="
echo "✅  Setup complete!"
echo ""
echo "👉  Next steps:"
echo "   1. Edit .env and add your TRIPO_API_KEY"
echo "      https://developers.tripo3d.ai"
echo ""
echo "   2. Test your connection:"
echo "      python3 pipeline/batch_runner.py test-connection"
echo ""
echo "   3. Generate all 3D assets:"
echo "      ./scripts/generate_assets.sh"
echo ""
echo "   4. Launch the game:"
echo "      ./scripts/serve.sh"
echo "=================================================="
echo ""
