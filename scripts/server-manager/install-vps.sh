#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/ubuntu/duelplay-app}"
SERVICE_FILE="$PROJECT_DIR/scripts/server-manager/duelplay-cs2-manager.service"
ENV_FILE="$PROJECT_DIR/scripts/server-manager/.env"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/server-manager/install-vps.sh"
  exit 1
fi
if [[ ! -f "$SERVICE_FILE" ]]; then
  echo "Missing $SERVICE_FILE"
  exit 1
fi
if [[ ! -f "$ENV_FILE" ]]; then
  echo "Create $ENV_FILE from .env.example first."
  exit 1
fi
if [[ ! -x /usr/bin/node ]]; then
  echo "Node.js is required. Install Node.js 20+ before enabling the manager."
  exit 1
fi

install -m 0644 "$SERVICE_FILE" /etc/systemd/system/duelplay-cs2-manager.service
systemctl daemon-reload
systemctl enable duelplay-cs2-manager
systemctl restart duelplay-cs2-manager
systemctl --no-pager --full status duelplay-cs2-manager
