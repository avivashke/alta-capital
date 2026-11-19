#!/usr/bin/env bash
# Installs Alta Capital Base Server as a macOS LaunchAgent (auto-starts on login & stays alive 24/7).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node)"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/com.altacapital.baseserver.plist"
LOG_OUT="$REPO_DIR/data/launchd-out.log"
LOG_ERR="$REPO_DIR/data/launchd-err.log"

mkdir -p "$PLIST_DIR" "$REPO_DIR/data"

if [ ! -f "$REPO_DIR/.env" ] && [ -f "$REPO_DIR/.env.example" ]; then
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
  echo "Created $REPO_DIR/.env from .env.example — edit it to add SUPABASE_ANON_KEY / CLOUD_API_URL."
fi

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.altacapital.baseserver</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE_BIN}</string>
    <string>${REPO_DIR}/server.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${REPO_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${LOG_OUT}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_ERR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ALTA_BASE_SERVER</key>
    <string>1</string>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
  </dict>
</dict>
</plist>
EOF

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load -w "$PLIST_PATH"

echo ""
echo "✅ Alta Capital Base Server installed and running on macOS!"
echo "   URL: http://localhost:8181"
echo "   Health: http://localhost:8181/api/health"
echo "   Logs: $LOG_OUT"
echo "   To stop/remove: launchctl unload -w $PLIST_PATH && rm $PLIST_PATH"
