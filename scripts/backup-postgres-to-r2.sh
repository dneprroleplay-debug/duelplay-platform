#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_ENDPOINT:?R2_ENDPOINT is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
BACKUP_PREFIX="${R2_BACKUP_PREFIX:-postgres}"
RETENTION_DAYS="${R2_BACKUP_RETENTION_DAYS:-30}"
LOCK_FILE="${R2_BACKUP_LOCK_FILE:-/var/lock/duelplay-postgres-backup.lock}"
mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "Backup already running" >&2; exit 2; }
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
FILE="$TMP_DIR/duelplay-${STAMP}.dump.gz"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$FILE"
zcat "$FILE" | pg_restore --list >/dev/null
AWS_EC2_METADATA_DISABLED=true aws --endpoint-url "$R2_ENDPOINT" s3 cp "$FILE" "s3://${R2_BUCKET}/${BACKUP_PREFIX}/$(basename "$FILE")"
CUTOFF="$(date -u -d "-${RETENTION_DAYS} days" +%s)"
while IFS= read -r key; do
  [ -n "$key" ] || continue
  ts="$(basename "$key" | sed -n 's/^duelplay-\([0-9T]*Z\)\.dump\.gz$/\1/p')"
  [ -n "$ts" ] || continue
  epoch="$(date -u -d "$ts" +%s 2>/dev/null || echo 0)"
  if [ "$epoch" -gt 0 ] && [ "$epoch" -lt "$CUTOFF" ]; then AWS_EC2_METADATA_DISABLED=true aws --endpoint-url "$R2_ENDPOINT" s3 rm "s3://${R2_BUCKET}/${key}"; fi
done < <(AWS_EC2_METADATA_DISABLED=true aws --endpoint-url "$R2_ENDPOINT" s3api list-objects-v2 --bucket "$R2_BUCKET" --prefix "$BACKUP_PREFIX/" --query 'Contents[].Key' --output text | tr '\t' '\n')
echo "Backup uploaded: ${BACKUP_PREFIX}/$(basename "$FILE")"
