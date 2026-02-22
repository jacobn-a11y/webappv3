# Operator Runbook (Launch Handoff)

This runbook captures operational actions for the current enterprise app behavior.

## 1) Pre-Deploy Checks

1. Install dependencies and build:
   - `npm ci`
   - `npm run build`
   - `npm --prefix frontend ci`
   - `npm --prefix frontend run build`
2. Validate migration safety gate:
   - `npm run migrate:safety`
3. Validate security and reliability test gates:
   - `npm run test:security`
   - `npm run test:reliability`
4. Run consolidated release gate (P0):
   - `npm run launch:gate`
   - to include post-deploy smoke in the gate:
     - `LAUNCH_POST_DEPLOY_SMOKE=true npm run launch:gate`
   - to include admin/member policy validation in the gate:
     - `LAUNCH_VALIDATE_ADMIN_CONTROLS=true npm run launch:gate`
5. Run consolidated release gate including P1 perf/load checks:
   - `npm run launch:gate:p1`
   - add volume seed step by passing `--volume-seed` or `LAUNCH_GATE_VOLUME_SEED=true`
6. Validate volume profile sizing without DB writes:
   - `npm run db:seed:volume:dry-run`

## 2) Migration & Release Safety

1. Review pending migrations under `prisma/migrations`.
2. Apply migrations in staging:
   - `npm run db:migrate:deploy`
3. Verify app health and critical endpoints:
   - `npm run launch:checklist` (set `LAUNCH_BASE_URL` as needed)
4. If migration safety requires baseline refresh (intentional risky SQL):
   - `npm run migrate:safety:baseline`
   - Re-review changed baseline file before merge.

## 3) Security Controls Validation

1. Confirm org security policy is configured in dashboard:
   - MFA enforcement
   - Session controls
   - IP allowlist
2. Confirm session inventory and revocation APIs function:
   - `GET /api/dashboard/security/sessions`
   - `POST /api/dashboard/security/sessions/:sessionId/revoke`
3. Confirm support impersonation guardrails:
   - Start/list/revoke flows in Ops Diagnostics
   - Read-only impersonation blocks write actions
   - Audit logs include SUPPORT events
4. Validate admin/member permission enforcement in production-like env:
   - `npm run launch:validate-admin-controls`
   - required credentials:
     - admin: `LAUNCH_ADMIN_BEARER_TOKEN` or `LAUNCH_ADMIN_SESSION_TOKEN`
     - member: `LAUNCH_MEMBER_BEARER_TOKEN` or `LAUNCH_MEMBER_SESSION_TOKEN`

## 4) Integration Reliability Operations

1. Check integration health dashboard and pipeline status:
   - `/api/dashboard/integrations/health`
   - `/api/dashboard/ops/pipeline-status`
2. Review dead-letter queue and replay failed runs when needed:
   - `/api/integrations/ops/dead-letter`
   - `/api/integrations/ops/dead-letter/:runId/replay`
3. Trigger and monitor backfills if data gaps are detected.

## 5) Data Governance Operations

1. Verify retention and legal-hold policy values.
2. Validate deletion workflow approval queue.
3. Validate PII export policy enforcement before exports.
4. Check audit retention behavior and purge schedule health.

## 6) Customer Success Operations

1. Review CS health:
   - `/api/dashboard/customer-success/health`
2. Review renewal value report:
   - `/api/dashboard/customer-success/renewal-value-report`
3. Use risk indicators to drive onboarding/adoption playbooks.

## 7) Incident Handling

1. For customer-visible incidents:
   - Create/update incidents in Ops Diagnostics (`/admin/ops` in UI).
   - Verify external status output:
     - `GET /api/status/incidents?organization_id=<org_id>`
     - public UI page: `/status`
2. For integration failures:
   - Confirm provider status and credentials.
   - Replay dead-letter runs.
   - Trigger bounded backfill.
3. For authorization/security anomalies:
   - Revoke suspicious sessions.
   - Disable impersonation tokens (revoke sessions).
   - Review audit logs by actor/resource.
4. For deployment regressions:
   - Run smoke checks immediately.
   - Use rollback helper and restore runbook if needed.

## 8) Go/No-Go Criteria

Release is GO when all below are true:
1. Build + tests + migration safety pass.
2. Launch checklist passes on staging.
3. Post-deploy smoke gate passes (`LAUNCH_POST_DEPLOY_SMOKE=true`).
4. Admin/member controls validation passes (`LAUNCH_VALIDATE_ADMIN_CONTROLS=true`).
5. No unresolved CRITICAL alerts in ops diagnostics.
6. Security policy controls verified for a representative tenant.
7. Audit logging for admin/security actions confirmed.

## 9) Release Evidence Artifact

1. Generate release evidence markdown:
   - `npm run launch:evidence`
2. Artifact path:
   - `docs/release-evidence/release-evidence-<timestamp>.md`
3. Optionally include CI URL:
   - `CI_RUN_URL=<url> npm run launch:evidence`
