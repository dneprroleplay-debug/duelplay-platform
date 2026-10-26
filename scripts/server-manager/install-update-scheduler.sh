#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-/home/ubuntu/duelplay-app}"
UNIT_DIR="/etc/systemd/system"
TIMER_FILE="$PROJECT_DIR/scripts/server-manager/duelplay-cs2-update.timer"
UPDATE_SERVICE_FILE="$PROJECT_DIR/scripts/server-manager/duelplay-cs2-update.service"
SCHEDULER_SERVICE_FILE="$PROJECT_DIR/scripts/server-manager/duelplay-cs2-update-scheduler.service"
ENV_FILE="$PROJECT_DIR/scripts/server-manager/.env"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash scripts/server-manager/install-update-scheduler.sh"
  exit 1
fi
for file in "$TIMER_FILE" "$UPDATE_SERVICE_FILE" "$SCHEDULER_SERVICE_FILE" "$ENV_FILE"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing required scheduler file: $file"
    exit 1
  fi
done
if systemctl is-active --quiet duelplay-cs2-update.service; then
  echo "Updater service is active; refusing to replace its units."
  exit 1
fi
if pgrep -fx '/usr/local/bin/node /home/ubuntu/duelplay-app/scripts/server-manager/update-all.mjs --scheduled' >/dev/null; then
  echo "Updater process is active; refusing to replace its units."
  exit 1
fi

install -m 0644 "$TIMER_FILE" "$UNIT_DIR/duelplay-cs2-update.timer"
install -m 0644 "$UPDATE_SERVICE_FILE" "$UNIT_DIR/duelplay-cs2-update.service"
install -m 0644 "$SCHEDULER_SERVICE_FILE" "$UNIT_DIR/duelplay-cs2-update-scheduler.service"
systemctl daemon-reload
systemctl enable --now duelplay-cs2-update.timer
systemctl is-enabled duelplay-cs2-update.timer
systemctl is-active duelplay-cs2-update.timer
systemctl list-timers duelplay-cs2-update.timer --all --no-pager
