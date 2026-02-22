# Environment Promotion Controls

## What Is Enforced

### 1) Migration Safety Gate
- Command: `npm run migrate:safety`
- Scans all Prisma migrations for risky SQL patterns (`DROP TABLE`, `DROP COLUMN`, `TRUNCATE`, `ALTER TYPE`, `DELETE FROM`).
- Baseline file:
  - `scripts/migration-safety-baseline.json`
- CI fails only when a risky statement is newly introduced (not already in baseline).
- To refresh baseline after review:
  - `npm run migrate:safety:baseline`

### 2) Rollback Helper
- Script: `scripts/rollback-helper.sh`
- Restores latest gzip SQL backup from `./backups` to `DATABASE_URL`, then runs `prisma migrate status`.

### 3) Deploy Verification Gate
- CI deploy now runs post-deploy smoke checks against production URL:
  - `npm run smoke:test` with `SMOKE_BASE_URL=https://storyengine.fly.dev`
- Release gate can require post-deploy smoke as a pass/fail step:
  - `LAUNCH_POST_DEPLOY_SMOKE=true npm run launch:gate`
- Release gate can also require admin/member policy validation:
  - `LAUNCH_VALIDATE_ADMIN_CONTROLS=true npm run launch:gate`
  - uses `npm run launch:validate-admin-controls`
  - expected credentials:
    - admin: `LAUNCH_ADMIN_BEARER_TOKEN` or `LAUNCH_ADMIN_SESSION_TOKEN`
    - member: `LAUNCH_MEMBER_BEARER_TOKEN` or `LAUNCH_MEMBER_SESSION_TOKEN`
- Smoke checks include:
  - `/api/health`
  - `/api/analytics`
  - `/api/dashboard/home`
  - `/api/dashboard/feature-flags/resolved`
  - `/api/dashboard/customer-success/health`
  - `/api/dashboard/customer-success/renewal-value-report`
  - `/api/dashboard/ops/diagnostics`
  - when auth is configured: `/api/dashboard/ops/incidents`
  - when auth is configured: `/api/dashboard/security/sessions`, `/api/dashboard/support/impersonation/sessions`
  - when org id is configured: `/api/status/incidents?organization_id=<org_id>` via `SMOKE_ORGANIZATION_ID`

### 4) Environment-Specific Feature Flag Overrides
- Supported env vars:
  - `FEATURE_FLAG_ENV_OVERRIDES_JSON`
  - `FEATURE_FLAG_ORG_OVERRIDES_JSON`
- `FeatureFlagService` resolves overrides by precedence:
  1. Org override
  2. Environment override
  3. DB value
- Resolved endpoint:
  - `GET /api/dashboard/feature-flags/resolved`

### 5) Environment-Specific Entitlement Overrides
- Supported env vars:
  - `ENTITLEMENT_ENV_OVERRIDES_JSON`
  - `ENTITLEMENT_ORG_OVERRIDES_JSON`
- Applied in billing readiness response:
  - Effective seat limits
  - Additional feature entitlements
  - Usage cap overlays

## CI Integration
- Workflow file: `.github/workflows/ci-cd.yml`
- Added jobs/gates:
  - `migration_safety`
  - `perf_budget`
  - post-deploy smoke check in `deploy`
