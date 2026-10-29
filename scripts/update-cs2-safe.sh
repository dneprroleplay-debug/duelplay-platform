#!/usr/bin/env bash
set -u

CS2_ROOT="/home/ubuntu/cs2"
STEAMCMD="/usr/games/steamcmd"
HEALTH_URL="http://127.0.0.1:3010/health"
LOG="/home/ubuntu/duelplay-app/logs/cs2-updater.log"
LOCK="/tmp/duelplay-cs2-maintenance.lock"
MIN_FREE_GB=12

mkdir -p "$(dirname "$LOG")"

log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG"
}

if ! mkdir "$LOCK" 2>/dev/null; then
    OWNER_PID=""
    if [ -f "$LOCK/owner.pid" ]; then
        OWNER_PID="$(cat "$LOCK/owner.pid" 2>/dev/null || true)"
    fi

    if [ -n "$OWNER_PID" ] && kill -0 "$OWNER_PID" 2>/dev/null; then
        log "SKIP: CS2 maintenance lock is held by PID $OWNER_PID"
        exit 0
    fi

    log "INFO: removing stale CS2 maintenance lock"
    rm -rf "$LOCK"
    mkdir "$LOCK" || {
        log "SKIP: could not acquire CS2 maintenance lock"
        exit 0
    }
fi

echo "$$" > "$LOCK/owner.pid"

cleanup_lock() {
    rm -rf "$LOCK"
}
trap cleanup_lock EXIT

log "CHECK: starting safe CS2 update check"

if ! systemctl is-active --quiet duelplay-cs2-manager.service; then
    log "SKIP: DuelPlay manager is not active"
    exit 0
fi

HEALTH="$(curl -fsS --max-time 5 "$HEALTH_URL" 2>/dev/null || true)"

if [ -z "$HEALTH" ]; then
    log "SKIP: manager health unavailable"
    exit 0
fi

log "HEALTH: $HEALTH"

if ! printf '%s' "$HEALTH" | grep -q '"ok":true'; then
    log "SKIP: manager health is not OK"
    exit 0
fi

if ! printf '%s' "$HEALTH" | grep -q '"matchId":null'; then
    log "SKIP: active DuelPlay match detected"
    exit 0
fi

if pgrep -x cs2 >/dev/null 2>&1; then
    log "SKIP: CS2 process is currently running"
    exit 0
fi

FREE_GB="$(df -BG "$CS2_ROOT" | awk 'NR==2 {gsub("G","",$4); print $4}')"

if ! [[ "$FREE_GB" =~ ^[0-9]+$ ]]; then
    log "SKIP: could not determine free disk space"
    exit 0
fi

if [ "$FREE_GB" -lt "$MIN_FREE_GB" ]; then
    log "SKIP: only ${FREE_GB}GB free, minimum is ${MIN_FREE_GB}GB"
    exit 0
fi

log "UPDATE: starting SteamCMD CS2 update"

if "$STEAMCMD" \
    +force_install_dir "$CS2_ROOT" \
    +login anonymous \
    +app_update 730 \
    +quit >> "$LOG" 2>&1; then

    log "SUCCESS: CS2 update completed"

    BUILD="$(grep -E '"buildid"' "$CS2_ROOT/steamapps/appmanifest_730.acf" 2>/dev/null | head -1 | tr -d '[:space:]' || true)"
    log "BUILD: $BUILD"

    exit 0
else
    CODE=$?
    log "ERROR: SteamCMD update failed with exit code $CODE"
    exit "$CODE"
fi
