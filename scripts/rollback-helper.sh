#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TARGET_DB_URL="${DATABASE_URL:-}"

if [ -z "$TARGET_DB_URL" ]; then
  echo "ERROR: DATABASE_URL is not set."
  echo "Usage: DATABASE_URL=postgresql://... ./scripts/rollback-helper.sh [backup_dir]"
  exit 1
fi

LATEST_BACKUP=$(ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -n 1 || true)
if [ -z "$LATEST_BACKUP" ]; then
  echo "No backup file found in $BACKUP_DIR"
  exit 1
fi

echo "Latest backup: $LATEST_BACKUP"
echo "This helper restores the latest backup and then checks Prisma migration status."
read -r -p "Proceed with restore to target DB? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

gunzip -c "$LATEST_BACKUP" | psql "$TARGET_DB_URL"
echo "Restore complete."
npx prisma migrate status
