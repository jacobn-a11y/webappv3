# Enum Normalization Scripts

These scripts normalize legacy string values before Prisma enum constraints are introduced.

## Usage

- Dry-run (default):
  - `node scripts/migrations/run-enum-normalizations.mjs`
  - `npm run db:normalize:enums:dry`
- Apply updates:
  - `node scripts/migrations/run-enum-normalizations.mjs --apply`
  - `npm run db:normalize:enums`

## Migration smoke checks (T16)

- Run all migration smoke paths:
  - `npm run db:migrate:smoke`

The smoke runner validates:
- clean database path (`migrate deploy` on empty schema)
- seeded database path (`migrate deploy` + `db:seed` + post-seed deploy)
- upgrade path (deploy an older migration subset, then upgrade to latest)

Optional env:
- `MIGRATION_SMOKE_BASE=<migration-folder>` sets the upgrade baseline migration folder.

## Idempotency

Each script only updates rows where the current value matches a legacy alias. Running the scripts repeatedly is safe.
