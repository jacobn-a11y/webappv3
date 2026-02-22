Understood. I’ll re-enable the normal push URL on the local copy and keep a strict rule: no push unless you explicitly tell me to. Reconfiguring now.

# Conversation Compression Instruction

## Product Principle (Always Active)
- The app is self-service first. Every implemented feature should be operable by customer admins in-product without requiring internal operator intervention for normal setup, governance, billing, reliability, or day-to-day workflows.

## Mandatory Rules (Always Active)
1. Do not push to GitHub unless the user explicitly instructs to push.
2. Before producing any compressed conversation/context summary, explicitly read and apply this file.
3. In every compression output, state that this instruction file was referenced and applied.

## How To Reference This File
- File path: `/Users/jacobnikolau/Documents/Codex/webapp2/CONVERSATION_COMPRESSION_INSTRUCTION.md`
- When compressing context:
1. Re-open this file.
2. Include the active no-push rule in the compressed summary constraints.
3. Include block/task progress using the master task list below.
4. Call out what is complete, in progress, blocked, and not started.

## Execution Tracking Protocol
- Work in blocks.
- Smallest block = one task.
- Report current block as: `Block X/114: Task X`.
- Do not redo completed tasks.
- If blocked, log blocker under the matching task number.

## Master Task List (Complete Scope)
1. Finalize data model and migrations for all enterprise controls.
2. Add and apply Prisma migrations for audit logs, feature flags, governance policies, session policies, IP allowlists, SCIM identities, approval workflows, and integration run states.
3. Remove temporary type-cast workarounds and make all new fields strongly typed in services/routes.
4. Complete multi-tenant security hardening across every backend endpoint.
5. Enforce org scoping on every query/mutation (API, jobs, exports, webhooks, internal services).
6. Add centralized “tenant guard” utilities and refactor all route handlers to use them.
7. Add automated tests for cross-tenant access attempts on all critical resources.
8. Implement full RBAC/ABAC policy engine coverage.
9. Define canonical permission/action matrix for every route, queue action, export action, and admin action.
10. Implement ABAC conditions (role profile + account scope + story sensitivity + org policy).
11. Refactor all authorization checks to route through one policy service.
12. Add policy-deny telemetry and policy unit/integration tests for all actions.
13. Complete organization audit logging.
14. Instrument all admin, auth, data access, export, integration, and policy events.
15. Add immutable audit event schema/versioning and retention behavior.
16. Ship audit log filters, pagination, export, and actor/resource drilldown in admin UI.
17. Implement SSO + SCIM + MFA/session enforcement.
18. Add SSO enforcement toggle and domain/org mapping controls.
19. Add SCIM provisioning/deprovisioning endpoints + lifecycle handlers.
20. Add MFA-required policy enforcement for privileged actions.
21. Add session controls (max session age, re-auth for sensitive actions, session revocation).
22. Implement IP allowlists and device/session visibility.
23. Add org/user allowlist config and enforcement middleware.
24. Add active session/device inventory and admin revoke capability.
25. Deliver production-grade integration reliability.
26. Add integration run ledger with idempotency keys.
27. Add retry policies with jitter/backoff per connector.
28. Add dead-letter queue + replay endpoints/UI.
29. Add dedupe rules for inbound records and merge conflict handling.
30. Add backfill jobs (range-based and cursor-based) with progress tracking.
31. Add integration health dashboard (status, lag, failures, last success, throughput).
32. Deliver data governance workflows.
33. Implement retention scheduler/jobs for transcripts, derived artifacts, logs.
34. Add legal-hold policy and hold-aware deletion prevention.
35. Implement deletion workflow with approval states and audit trail.
36. Enforce PII export rules across all export surfaces.
37. Add governance admin UI for policy management and approval queue.
38. Complete reliability and operations tooling.
39. Add queue SLO metrics, alerts, and per-tenant failure visibility.
40. Add runbook-driven replay/recovery endpoints for failed pipelines.
41. Add synthetic health checks for critical dependencies.
42. Add operator dashboards for queue, sync, and pipeline status.
43. Implement DR readiness in-app integration points.
44. Add backup/restore status visibility and verification jobs.
45. Add RTO/RPO status reporting endpoints and admin dashboard widgets.
46. Add restoration validation hooks for critical entities.
47. Complete onboarding flow for non-technical admins.
48. Build guided setup wizard for org profile, connectors, role presets, governance defaults.
49. Add first-value workflow (seeded templates, guided first story, first dashboard outcomes).
50. Add setup completion scoring and missing-step prompts.
51. Complete billing/readiness for B2B operations.
52. Add seat management with role-aware seat accounting.
53. Add usage metering validation and reconciliation jobs.
54. Add plan/entitlement enforcement via feature flags and policy hooks.
55. Add invoice/overage/proration visibility APIs and admin settings UI.
56. Build role-specific experiences for RevOps/Marketing/Sales/CS.
57. Add role-aware landing dashboards and navigation.
58. Add saved views/workspaces by team with access controls.
59. Add shared assets library with ownership and permission model.
60. Build required KPI/reporting package.
61. Add pipeline influence and conversion-stage reporting.
62. Add win/loss reason and competitor mention analytics.
63. Add persona-objection insight reporting.
64. Add attribution links between calls/stories/opportunities/campaigns.
65. Add executive summary reporting endpoints and UI.
66. Implement CRM writeback and approvals.
67. Add writeback actions (tasks, notes, fields, timeline events).
68. Add approval workflows for writebacks and policy-based guards.
69. Add writeback audit trail and rollback where supported.
70. Build workflow automation system.
71. Add rule engine (thresholds, schedules, events) for alerts/actions.
72. Add delivery targets (Slack/email/webhook) with retry and failure tracking.
73. Add digest scheduling and subscription management UI.
74. Implement artifact governance lifecycle.
75. Add approval chains for publishing externally visible assets.
76. Add versioning, rollback, and expiration controls for published pages.
77. Add release audit + provenance metadata for each artifact.
78. Ship data quality and trust layer.
79. Add confidence scores for generated insights/stories.
80. Add lineage metadata (source calls/chunks/timestamps) per claim/metric.
81. Add quality monitoring dashboard (coverage, freshness, sync errors, drift).
82. Add human feedback loop for corrections and model/prompt tuning inputs.
83. Complete duplicate/account-merge safety tooling.
84. Add merge preview with impact diff and dependency graph.
85. Add undo/rollback for merges and conflict resolution workflow.
86. Add merge governance approvals and audit events.
87. Complete platform scale controls.
88. Set performance budgets and enforce in CI.
89. Add load/perf test suites for 100–2,000 employee tenant profiles.
90. Optimize DB indexes/queries for transcript, story, analytics heavy paths.
91. Add caching strategy and invalidation policy for hot read endpoints.
92. Standardize pagination and export limits across APIs.
93. Implement multi-environment promotion controls.
94. Add migration safety checks and rollback helpers.
95. Add environment-specific feature flag/entitlement overrides.
96. Add deploy verification gates and post-deploy smoke tests.
97. Build internal support/admin console.
98. Add tenant diagnostics (auth, permissions, integrations, queue health).
99. Add sync replay/troubleshooting tools for support staff.
100. Add support-safe impersonation/session tooling with strict audit guardrails.
101. Add customer success operational tooling.
102. Add adoption/health scoring per org/team.
103. Add onboarding progress and risk indicators.
104. Add renewal value reporting (usage + outcomes + ROI narratives).
105. Implement complete test coverage and quality gates.
106. Add comprehensive integration/e2e tests for all new enterprise features.
107. Add security tests (authorization bypass, tenant isolation, policy enforcement).
108. Add performance regression tests and reliability chaos tests.
109. Enforce CI gates (typecheck, tests, security scan, migration checks).
110. Final hardening and launch readiness.
111. Run full launch checklist in staging with real-like data volume.
112. Validate all admin controls and policy enforcement in production-like env.
113. Resolve all P0/P1 defects and freeze schema/API contracts.
114. Produce final operator docs/runbooks from implemented behavior (for handoff).

## Progress Ledger (Update During Execution)
- `Block 96/114: Task 96` Completed
  - Added deploy verification gate options in release orchestrator for post-deploy smoke.
  - Added explicit launch checklist checks for status feeds and admin-control surfaces.
  - Added/updated docs for deploy verification and smoke behavior.
- `Block 112/114: Task 112` Completed
  - Added production-like admin/member policy validation CLI:
    - `scripts/launch/validate-admin-controls.mjs`
    - `npm run launch:validate-admin-controls`
  - Added release-gate optional required step via `LAUNCH_VALIDATE_ADMIN_CONTROLS=true`.
  - Added e2e tests for admin-control validation CLI and gate wiring.
- `Block 114/114: Task 114` Completed
  - Updated operator runbook with:
    - post-deploy smoke gate usage,
    - admin/member control validation procedure,
    - incident/public status handling (`/api/status/incidents`, `/status` UI).
  - Generated release evidence artifact for handoff:
    - `docs/release-evidence/release-evidence-2026-02-22T18-02-39.396Z.md`
- `Block 113/114: Task 113` Completed
  - Re-ran schema/API contract freeze check (`npm run contracts:check`) and verified no drift.
  - Re-ran migration safety gate and P0 security/reliability suites; all passing.
- `Block 106/114: Task 106` Completed
  - Added and stabilized self-service end-to-end journey coverage:
    - `tests/e2e/self-service-journey.e2e.test.ts`
  - Fixed session auth middleware resilience for malformed session query payloads:
    - `src/middleware/session-auth.ts`
  - Aligned e2e harness session mocks with current auth/session select shapes.
- `Block 109/114: Task 109` Completed
  - Repaired full-suite CI test compatibility after policy/billing middleware changes by updating test harness mocks:
    - `tests/permissions.test.ts`
    - `tests/e2e/story-build.test.ts`
    - `tests/e2e/rag-query.test.ts`
    - `tests/helpers/create-test-app.ts`
  - Added self-service journey to enterprise e2e gate script:
    - `package.json` (`test:e2e:enterprise`)
  - Revalidated quality gates locally:
    - `npm test`
    - `npm run test:e2e:enterprise`
    - `npm run build`
    - `npm --prefix frontend run build`
- `Block 110/114: Task 110` Completed
  - Ran full non-dry release gate and resolved one hard failure:
    - failure: contracts freeze drift in `src/middleware/permissions.ts`
    - fix: updated freeze manifest with `npm run contracts:update`
    - verification: `npm run launch:gate` passed all steps.
- `Block 111/114: Task 111` In Progress
  - Launch checklist runs and passes against local base URL (`http://localhost:3000`) but currently validates route availability only for several admin surfaces (expected HTTP 404 pass criteria in current checklist implementation).
  - Auth-dependent checklist validations are skipped without configured auth credentials.
- `Block 112/114: Task 112` Blocked (Local Credential Gap)
  - `npm run launch:validate-admin-controls` fails without `ADMIN`/`MEMBER` credentials and tokens configured in environment.
  - Requires production-like auth/session test credentials to complete in a non-skipped mode.
- `Block 113/114: Task 113` Completed (Additional P0/P1 PLG hardening)
  - Removed duplicate billing API surface mount from app routing:
    - removed `/api/settings/billing` route mount from `src/app.ts`
    - canonical self-service billing endpoints remain `/api/billing/checkout` and `/api/billing/portal`.
  - Switched sample environment to self-service-safe billing default:
    - `.env.example` now defaults `BILLING_ENABLED="true"`
    - `README.md` env guidance updated to reflect self-service default.
  - Expanded self-service journey e2e to validate Stripe webhook activation path:
    - checkout -> expired trial denial -> webhook `checkout.session.completed` -> plan activation -> trial-gated access restored
    - file: `tests/e2e/self-service-journey.e2e.test.ts`.
