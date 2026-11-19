#!/usr/bin/env bash
# Installs Alta Capital Base Server as a Linux systemd user service (auto-starts & restarts 24/7).
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node)"
SERVICE_DIR="$HOME/.config/systemd/user"
SERVICE_PATH="$SERVICE_DIR/alta-capital-base.service"

mkdir -p "$SERVICE_DIR" "$REPO_DIR/data"

if [ ! -f "$REPO_DIR/.env" ] && [ -f "$REPO_DIR/.env.example" ]; then
  cp "$REPO_DIR/.env.example" "$REPO_DIR/.env"
  echo "Created $REPO_DIR/.env from .env.example — edit it to add SUPABASE_ANON_KEY / CLOUD_API_URL."
fi

cat > "$SERVICE_PATH" <<EOF
[Unit]
Description=Alta Capital Always-On Base Server + Cloud Sync
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}
ExecStart=${NODE_BIN} ${REPO_DIR}/server.mjs
Restart=always
RestartSec=5
Environment=ALTA_BASE_SERVER=1

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now alta-capital-base.service

echo ""
echo "✅ Alta Capital Base Server installed and running via systemd!"
echo "   URL: http://localhost:8181"
echo "   Status: systemctl --user status alta-capital-base.service"
echo "   Tip for keeping running after logout: sudo loginctl enable-linger $USER"
