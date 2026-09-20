#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL must point to a disposable PostgreSQL database}"
: "${R2_BUCKET:?R2_BUCKET is required}"
: "${R2_ENDPOINT:?R2_ENDPOINT is required}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required}"
BACKUP_PREFIX="${R2_BACKUP_PREFIX:-postgres}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
FILE="$TMP_DIR/latest.dump.gz"
KEY="$(AWS_EC2_METADATA_DISABLED=true aws --endpoint-url "$R2_ENDPOINT" s3api list-objects-v2 --bucket "$R2_BUCKET" --prefix "$BACKUP_PREFIX/" --query 'sort_by(Contents,&LastModified)[-1].Key' --output text)"
[ -n "$KEY" ] && [ "$KEY" != "None" ] || { echo "No backup found" >&2; exit 1; }
AWS_EC2_METADATA_DISABLED=true aws --endpoint-url "$R2_ENDPOINT" s3 cp "s3://${R2_BUCKET}/${KEY}" "$FILE"
zcat "$FILE" | pg_restore --exit-on-error --clean --if-exists --no-owner --no-privileges --dbname="$RESTORE_DATABASE_URL"
COUNT="$(psql "$RESTORE_DATABASE_URL" -Atqc 'SELECT count(*) FROM information_schema.tables WHERE table_schema = '''public''';')"
[ "${COUNT:-0}" -gt 0 ] || { echo "Restore test produced no public tables" >&2; exit 1; }
echo "Restore test passed from ${KEY}"
