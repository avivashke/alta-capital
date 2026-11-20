#!/usr/bin/env bash
# Alta Capital — Local X (Twitter) Browser Fundamental Research Agent Setup (macOS / Linux)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=============================================================="
echo "  Alta Capital - X Browser Fundamental Agent Setup (Roni)"
echo "=============================================================="

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js (>=20) is required." >&2
  exit 1
fi

echo "[1/3] Installing playwright-core locally (--no-save)..."
npm install --no-save playwright-core
mkdir -p "$ROOT/data/x-browser-profile"

echo "[2/3] Checking installed browsers (Chrome / Edge / Chromium)..."
FOUND=""
for p in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "/usr/bin/google-chrome" \
  "/usr/bin/google-chrome-stable" \
  "/usr/bin/chromium" \
  "/usr/bin/chromium-browser" \
  "/usr/bin/microsoft-edge"; do
  if [ -x "$p" ]; then
    FOUND="$p"
    break
  fi
done

if [ -n "$FOUND" ]; then
  echo "  Found system browser: $FOUND (skipping Chromium download)"
else
  echo "  Installing Playwright Chromium..."
  npx playwright-core install chromium
fi

echo "[3/3] Verifying X Browser Agent status..."
node scripts/x-browser-agent.mjs --status

echo ""
echo "Ready! Open http://localhost:8181/#/fundamentals and click Login to X (or run: npm run x-agent:login)."
