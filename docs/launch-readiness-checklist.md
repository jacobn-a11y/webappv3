# Launch Readiness Checklist (P0/P1)

Use this checklist before customer-facing launch and each major release.
Automated orchestrator:
`npm run launch:gate` (P0) and `npm run launch:gate:p1` (P0+P1).

## P0 - Must Pass Before Release

1. `npm run migrate:safety`
2. `npm run contracts:check`
3. `npm run test:security`
4. `npm run test:reliability`
5. `npm run build`
6. `npm --prefix frontend run build`
7. `npm run launch:checklist` against staging
8. `LAUNCH_POST_DEPLOY_SMOKE=true npm run launch:gate` in deployed environment context (runs `smoke:test`)
9. `LAUNCH_VALIDATE_ADMIN_CONTROLS=true npm run launch:gate` with admin/member tokens configured
10. Verify tenant isolation tests pass
11. Verify support impersonation read-only/write guardrails and audit logs
12. Verify integration dead-letter replay path
13. Verify customer-success health and renewal-value report endpoints
14. Verify status endpoints:
   - Internal incident feed: `/api/dashboard/ops/incidents` (auth)
   - Public status feed: `/api/status/incidents?organization_id=<org_id>`

## P1 - Must Pass Before Scaling to 10+ Customers

1. Run perf budget gate: `npm run perf:budget`
2. Run realistic load profile against staging: `npm run perf:load`
3. Seed staging-like tenant volume (100-2,000 employee profile): `npm run db:seed:volume`
4. For CI/non-DB validation of seed plan: `npm run db:seed:volume:dry-run`
5. Validate onboarding completion/risk indicators for seeded tenants
6. Validate billing seat/usage reconciliation for sample orgs
7. Validate data retention/deletion/legal hold policy flows

## Evidence to Record Per Release

1. CI run URL and commit SHA
2. Migration safety output summary
3. Launch checklist output
4. Security and reliability test summaries
5. Any manual validation notes and known exceptions
