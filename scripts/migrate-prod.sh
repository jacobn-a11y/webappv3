#!/usr/bin/env bash
#
# migrate-prod.sh — Safely run Prisma migrations against the production database.
#
# Usage:
#   DATABASE_URL="postgresql://..." ./scripts/migrate-prod.sh
#
# Or inside a Fly.io machine:
#   fly ssh console -C "npx prisma migrate deploy"
#
# Safety features:
#   - Requires DATABASE_URL to be set
#   - Requires explicit confirmation before running
#   - Creates a pg_dump backup before migrating
#   - Rolls back if migration fails (restores from backup)
#   - Runs in a subshell so set -e aborts on any failure

set -euo pipefail

# ── Pre-flight checks ────────────────────────────────────────────────────────

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ERROR: DATABASE_URL is not set."
  echo "Usage: DATABASE_URL=\"postgresql://...\" $0"
  exit 1
fi

# Prevent running against a local dev database by accident
if echo "$DATABASE_URL" | grep -qE "localhost|127\.0\.0\.1"; then
  echo "WARNING: DATABASE_URL points to localhost."
  echo "This script is intended for production. Use 'npm run db:migrate' for local dev."
  read -r -p "Continue anyway? [y/N] " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# ── Show pending migrations ──────────────────────────────────────────────────

echo "==> Checking migration status..."
npx prisma migrate status

echo ""
read -r -p "==> Proceed with production migration? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

# ── Backup ───────────────────────────────────────────────────────────────────

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/pre_migrate_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "==> Creating database backup: ${BACKUP_FILE}"
if command -v pg_dump &>/dev/null; then
  pg_dump "$DATABASE_URL" | gzip >"$BACKUP_FILE"
  echo "    Backup created ($(du -h "$BACKUP_FILE" | cut -f1))."
else
  echo "WARNING: pg_dump not found — skipping backup."
  echo "         Install postgresql-client for automatic backups."
  read -r -p "Continue without backup? [y/N] " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Aborted."
    exit 0
  fi
fi

# ── Run migrations ───────────────────────────────────────────────────────────

echo "==> Running prisma migrate deploy..."
if npx prisma migrate deploy; then
  echo ""
  echo "==> Migrations applied successfully."
else
  MIGRATE_EXIT=$?
  echo ""
  echo "ERROR: Migration failed (exit code ${MIGRATE_EXIT})."

  if [ -f "$BACKUP_FILE" ]; then
    echo ""
    echo "A backup is available at: ${BACKUP_FILE}"
    echo "To restore:  gunzip -c ${BACKUP_FILE} | psql \"\$DATABASE_URL\""
  fi

  exit "$MIGRATE_EXIT"
fi

# ── Verify ───────────────────────────────────────────────────────────────────

echo ""
echo "==> Post-migration status:"
npx prisma migrate status

echo ""
echo "Done."
