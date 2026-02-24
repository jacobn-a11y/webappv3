# Demo/Staging Deployment Playbook

Date: 2026-02-24

This playbook defines a reproducible staging/demo deployment and validation path.

## 1) Preconditions

- Secrets configured in CI:
  - `FLY_API_TOKEN`
  - staging app env vars (`DATABASE_URL`, `REDIS_URL`, auth, AI keys as applicable)
- Staging database migrated and reachable.
- Staging Redis reachable.

## 2) Build And Gate

Run these locally before merge (or rely on CI equivalents):

```bash
npm ci
npm --prefix frontend ci
npx prisma generate
npm run build
npm --prefix frontend run build
npm run test:security
npm run test:reliability
npm run perf:budget
```

## 3) Deploy

- Preferred: merge to `main` and let `.github/workflows/ci-cd.yml` deploy.
- Manual fallback:
  - `fly deploy` using the same app config and secrets as CI.

## 4) Post-Deploy Smoke Checklist

Run smoke checks against staging URL:

```bash
SMOKE_BASE_URL=https://<staging-host> npm run smoke:test
```

Verify:

1. API liveness and readiness endpoints return healthy.
2. Auth flow reaches login callback without server errors.
3. Core authenticated routes load (`/accounts`, `/stories`, `/dashboard/pages`).
4. Story generation entry-point UI loads for non-viewer roles.
5. Queue/admin diagnostics endpoints respond for admin sessions.
6. Public status endpoint responds (`/api/status/incidents` with org query).

## 5) Demo Readiness Checks

1. Seed representative sample data:
   - `npm run db:seed:volume` (or dry run first).
2. Validate account search, story library search, and global command search (`Ctrl/Cmd+K`).
3. Validate landing-page create/edit/publish flow on at least one story.
4. Validate dead-letter replay endpoint and queue health visibility in admin.

## 6) Rollback And Incident Response

- If smoke checks fail:
  1. Mark release as failed.
  2. Roll back to previous Fly release.
  3. Open/update incident in Ops Diagnostics.
  4. Follow `docs/operator-runbook.md` incident and replay procedures.
