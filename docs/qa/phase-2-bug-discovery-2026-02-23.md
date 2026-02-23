# Phase 2 QA Bug Discovery - 2026-02-23

Scope executed: auth, billing, stories/RAG, landing pages, permissions, integrations/webhooks, platform admin/owner, public pages.  
Primary deep-dive files: `src/app.ts`, `src/api/dashboard-routes.ts`, `src/api/ai-settings-routes.ts`, `src/api/landing-page-routes.ts`.

## QA Matrix Coverage

| Area | Status | Notes |
| --- | --- | --- |
| Auth/session wiring | Complete | Startup/runtime auth middleware wiring reviewed |
| Billing | Complete | Checkout/portal authz flow reviewed |
| Stories/RAG | Complete | Tenant/account scoping + retrieval filters reviewed |
| Landing pages | Complete | Publish/approval/delete flows reviewed |
| Permissions | Complete | Role/approval enforcement reviewed |
| Integrations/webhooks | Complete | Signature and fallback behavior reviewed |
| Platform admin/owner | Complete | Route mount order and auth model reviewed |
| Public pages | Complete | Password and rendering security path reviewed |

## Bug List

### 1) P0 - App boot path calls middleware incorrectly and can crash server startup
- Location:
  - `src/app.ts:263-266`
  - `src/middleware/auth.ts:33-49`
- Issue:
  - `requireAuth` is an Express middleware `(req, res, next)`, but `app.ts` invokes it as `requireAuth(prisma)`.
  - This executes middleware at startup with invalid arguments.
- Repro steps:
  1. Start the API app.
  2. App initialization reaches `app.use("/api/platform", requireAuth(prisma), createPlatformRoutes(prisma))`.
  3. `requireAuth` receives `prisma` as `req` and `res` is `undefined`, causing runtime failure when `res.status(...)` is accessed.

### 2) P0 - Cross-tenant data access in RAG query route via client-supplied organization ID
- Location:
  - `src/api/rag-routes.ts:86-104`
  - `src/app.ts:236-240`
- Issue:
  - `/api/rag/query` trusts `organization_id` from request body instead of authenticated `req.organizationId`.
  - Internal authenticated users can submit another tenant’s org ID.
- Repro steps:
  1. Authenticate as a user in Org A.
  2. `POST /api/rag/query` with body containing `organization_id` for Org B and a known Org B `account_id`.
  3. Endpoint forwards that org ID to `ragEngine.query(...)` and can return Org B sources.

### 3) P1 - RAG chat/query bypass account-level access controls
- Location:
  - `src/api/rag-routes.ts:53-54`
  - `src/api/rag-routes.ts:134-161`
  - `src/api/rag-routes.ts:197-201` (access service used only for `/accounts` list)
- Issue:
  - Route creates `AccountAccessService` but does not enforce `canAccessAccount` for `/chat` or `/query`.
  - Users with restricted account scopes can query disallowed accounts inside their org.
- Repro steps:
  1. Use a member account restricted to subset of accounts.
  2. `POST /api/rag/chat` with an unauthorized `account_id`.
  3. Receive RAG answer/sources for that account instead of `403`.

### 4) P1 - Landing-page approval workflow allows unauthorized rejection
- Location:
  - `src/api/landing-page-routes.ts:892-915`
  - `src/api/landing-page-routes.ts:918-927`
- Issue:
  - Reject branch executes before `canUserApproveStep(...)`.
  - A user not eligible for current step can still reject approval requests.
- Repro steps:
  1. Configure multi-step publish approval with step-scoped approvers.
  2. Use a user who has `publish` permission but is not eligible for current step.
  3. `POST /api/pages/approvals/publish/:requestId/review` with `{ "decision": "REJECT" }`.
  4. Request is rejected (`status: REJECTED`) instead of `403 permission_denied`.

### 5) P1 - Platform owner routes are effectively blocked by route shadowing and incompatible auth context
- Location:
  - `src/app.ts:207`
  - `src/app.ts:263-267`
  - `src/api/platform-admin-routes.ts:65`
  - `src/api/platform-routes.ts:19-23`
  - `src/middleware/session-auth.ts:91-94`
- Issue:
  - `/api/platform` is mounted twice. Platform admin middleware (`x-platform-admin-key`) runs first and short-circuits.
  - Platform owner check expects `req.userEmail`/`req.user.email`, but session auth only sets user/org/role.
- Repro steps:
  1. Log in as platform owner via normal app session.
  2. `GET /api/platform/settings` (no `x-platform-admin-key`).
  3. Request is intercepted by platform-admin route and denied before platform-owner route logic can run.

### 6) P1 - AI notification acknowledge endpoint has IDOR (no ownership/org check)
- Location:
  - `src/api/ai-settings-routes.ts:287-297`
  - `src/services/ai-usage-tracker.ts:522-526`
- Issue:
  - Endpoint acknowledges by notification ID only.
  - No verification that notification belongs to requesting user/org.
- Repro steps:
  1. User A has notification ID `notif_X`.
  2. User B (authenticated) calls `POST /api/ai/notifications/notif_X/acknowledge`.
  3. Endpoint returns success and marks User A’s notification acknowledged.

### 7) P2 - Funnel-stage filters in RAG are ineffective due metadata key mismatch
- Location:
  - `src/services/rag-engine.ts:113`
  - `src/services/rag-engine.ts:197`
  - `src/services/rag-engine.ts:297`
- Issue:
  - Query filters use `funnel_stage`, but indexed metadata stores `funnel_stages`.
  - Funnel-stage constrained queries can silently return unfiltered results.
- Repro steps:
  1. Index transcript chunks with funnel stages.
  2. Query/chat with `funnel_stages` filter in request.
  3. Observe results include chunks outside requested funnel stage.

### 8) P2 - Billing mutation endpoints are not role-gated (any authenticated user can invoke)
- Location:
  - `src/app.ts:229-230`
  - `src/middleware/billing.ts:148-166`
  - `src/middleware/billing.ts:236-252`
- Issue:
  - Checkout and portal handlers validate only `organizationId`; no owner/admin permission requirement.
  - Non-admin members can trigger org billing flows.
- Repro steps:
  1. Authenticate as `MEMBER`.
  2. `POST /api/billing/portal` (or `/api/billing/checkout`).
  3. Endpoint returns portal/checkout URL instead of `403`.

### 9) P2 - Public page password protection stores and compares raw password values
- Location:
  - `src/services/landing-page-editor.ts:278`
  - `src/services/landing-page-editor.ts:377`
  - `src/api/public-page-renderer.ts:731-733`
  - `src/api/public-page-renderer.ts:767-768`
- Issue:
  - Passwords are stored and compared in plaintext.
  - Password may also be passed via `?p=` query parameter, increasing leakage risk via logs/referrers.
- Repro steps:
  1. Publish a page with password.
  2. Inspect DB row: `landingPage.password` contains raw password.
  3. Access `/s/:slug?p=<password>` and observe successful unlock from query parameter.

### 10) P2 - Webhook handlers allow unsigned traffic in fallback configurations
- Location:
  - `src/webhooks/merge-webhook.ts:137-148`
  - `src/webhooks/gong-webhook.ts:102-105`
  - `src/webhooks/grain-webhook.ts:102-104`
- Issue:
  - Merge only verifies signature when env secret is set.
  - Gong/Grain explicitly allow matching configs without webhook secrets.
  - Misconfiguration can permit spoofed webhook events.
- Repro steps:
  1. Leave Merge secret unset (or configure Gong/Grain integration without webhook secret).
  2. Send forged webhook payload to respective endpoint.
  3. Endpoint accepts/processes payload path instead of hard failing on missing signature.

## Execution Notes

- Analysis was performed on `release/2026-02-23` synced to GitHub HEAD for that branch.
- Static analysis/code-path validation completed.
- Full TypeScript build/test run was not executed here because `tsc` is not installed in this local environment (`npm run build` failed with `sh: tsc: command not found`).
