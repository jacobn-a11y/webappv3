# StoryEngine (webappv3) — Consolidated Multi-Audit Report

**Repository:** [jacobn-a11y/webappv3](https://github.com/jacobn-a11y/webappv3)
**Audit Date:** March 3, 2026
**Scope:** Security | Code Quality | Functionality | UX/A11y | API/Data Layer | Testing/Infra
**Method:** 8+ parallel agent analyses across multiple audit runs, cross-referenced and deduplicated

> Findings tagged with the number of independent audits that flagged them (e.g. **[4/4 audits]**) to indicate confidence. Higher counts = higher confidence the issue is real and important.

---

## Executive Summary

StoryEngine is a mature B2B SaaS platform that ingests call recordings, resolves them to CRM accounts, and generates AI-powered case studies. The codebase demonstrates **strong engineering fundamentals**: TypeScript strict mode, clean service-oriented architecture, Prisma ORM, Zod validation, BullMQ for async processing, OpenTelemetry observability, and industry-leading accessibility.

**Overall Assessment: B+ (84/100) — Production-ready with critical security and performance gaps.**

| Domain | Grade | Summary |
|--------|-------|---------|
| **Security** | B | Strong auth/RBAC/PII stack undermined by MFA bypass, CSRF design flaw, and XSS vectors |
| **Code Quality** | B+ | Clean architecture; `any` usage, 45 duplicate type defs, and god files hold it back |
| **Functionality** | B+ | Robust pipelines; in-memory state and missing retries limit horizontal scale |
| **UX & Frontend** | B | Industry-leading a11y; no code splitting, monolithic CSS/API files, no data caching |
| **API & Data Layer** | B+ | Well-designed; N+1 queries, missing indexes, inconsistent response envelopes |
| **Testing & Infra** | B+ | Excellent CI pipeline; low coverage thresholds, frontend tests nearly absent |

**Cross-cutting themes (ranked by risk):**
1. **Authentication & authorization holes** — MFA bypass, CSRF design flaw, SCIM deprovision gap
2. **Horizontal scaling blockers** — In-memory idempotency, rate limiting, and caching across 4 systems
3. **XSS attack surface** — `innerHTML` usage, CSS injection in public page renderer, `escapeHtml` duplication
4. **Type safety erosion** — 45 duplicate auth interfaces, 28+ unsafe casts, `no-explicit-any` disabled
5. **Frontend performance** — Zero code splitting, no API caching, 6,250-line monolithic CSS
6. **Data layer efficiency** — N+1 queries in sync engine (5,000+ queries for 500 calls)

---

## Findings by Severity

### Critical (5 findings)

| # | Finding | Audits | Domain | Location |
|---|---------|:---:|--------|----------|
| C1 | **MFA bypass via client-settable `x-mfa-verified` header** — Any request can set this header to skip org-mandated MFA on all admin routes. Header is also in CORS `allowedHeaders`. | **4/4** | Security | `src/middleware/security-policy.ts:36-42`, `src/app.ts:131-137` |
| C2 | **CSRF token is the session token echoed back** — `x-csrf-token` is compared to `x-session-token`; any XSS that reads the session token auto-bypasses CSRF. No independent token generation. | **2/4** | Security | `src/middleware/csrf-protection.ts:54` |
| C3 | **Stored XSS via CSS injection in public page renderer** — Custom CSS sanitization regex `<\/?\s*style\s*>` can be bypassed with `</style foo><svg/onload=alert(1)>`. | **2/4** | Security | `src/api/public-page-renderer.ts` |
| C4 | **No route-level code splitting** — All 32 page components eagerly imported. Zero `React.lazy()` or `Suspense`. Every user downloads the full bundle including Chart.js, admin pages, transcript viewer. | **4/4** | Performance | `frontend/src/app/routes.tsx` |
| C5 | **8+ page components exceed 900 lines** — `StoryGeneratorModal.tsx` (1,615), `HomePage.tsx` (1,060), `StoryLibraryPage.tsx` (1,056), `LandingPageEditorPage.tsx` (1,037), `AdminOpsDiagnosticsPage.tsx` (1,007), plus 3 more. | **3/4** | Code Quality | Multiple frontend files |

---

### High (25 findings)

#### Security (10)

| # | Finding | Audits | Location |
|---|---------|:---:|----------|
| H1 | **SCIM deprovisioning does not revoke sessions or disable app access** — Offboarded users with valid sessions remain active. `session-auth.ts` doesn't check SCIM `active` flag. | **2/4** | `src/api/scim-routes.ts:186-237`, `src/middleware/session-auth.ts:54-67` |
| H2 | **Tenant support opt-out not enforced in impersonation flow** — Opt-out is persisted but `canManageSupportImpersonation()` doesn't check it. | **2/4** | `src/api/dashboard/tenant-support-routes.ts:33-49`, `support-impersonation-routes.ts:137-141` |
| H3 | **Localhost origins in CORS/CSRF allowed in all environments** — No `NODE_ENV` check; production allows cross-origin from `localhost:3000` and `localhost:5173`. | **2/4** | `src/app.ts:121-123`, `src/middleware/csrf-protection.ts:23-24` |
| H4 | **Auth routes (`/api/auth`) have zero rate limiting** — `passwordRateLimiter` only applied to `/s` (public pages), not actual auth endpoints. Brute-force risk. | **2/4** | `src/app.ts:210` |
| H5 | **Stripe/WorkOS API keys default to empty `""`** — App boots successfully but auth/billing silently fail with cryptic downstream errors. Only `DATABASE_URL` and `REDIS_URL` validated. | **2/4** | `src/index.ts:44-51` |
| H6 | **Session auth swallows DB errors, calls `next()`** — During DB outages, users get unexplained 401s instead of clear 503 service unavailable. | **2/4** | `src/middleware/session-auth.ts:106-109` |
| H7 | **Credential validation accepts `z.record(z.unknown())`** — Any JSON object passes as credentials when creating integrations. No per-provider schema validation. | **2/4** | `src/api/integration-routes.ts:36-41` |
| H8 | **No outbound rate limiting for Gong/Grain/Salesforce API calls** — During backfills, sync engine can exhaust provider rate limits (Gong: 3 req/s). No throttling or concurrency controls. | **2/4** | `src/integrations/gong-provider.ts`, `grain-provider.ts`, `salesforce-provider.ts` |
| H9 | **`innerHTML` XSS risk in multiple server-rendered files** — Some paths escape, others may not. | **2/4** | `transcript-viewer-routes.ts`, `chatbot-connector.ts`, `analytics-routes.ts`, `admin-account-access-page.ts` |
| H10 | **Webhook intake can be globally blocked by one bad tenant config** — If any active Gong/Grain integration lacks `webhookSecret`, the handler returns 500 for all orgs. | **2/4** | `src/webhooks/gong-webhook.ts:90-95`, `src/webhooks/grain-webhook.ts:91-95` |

#### Code Quality (6)

| # | Finding | Audits | Location |
|---|---------|:---:|----------|
| H11 | **No global Express error handler** — Unhandled async errors produce HTML stack traces (with source in dev) instead of structured JSON. | **2/4** | `src/app.ts` (missing at line 424) |
| H12 | **155+ `console.error/warn/log` calls bypass structured logger across 39 files** — Winston logger with request context exists but is unused in most files. | **2/4** | Multiple (top offender: `landing-page-routes.ts` with 20 calls) |
| H13 | **28+ unsafe `as unknown as Record<string, unknown>` type casts** — Completely bypasses TypeScript; `undefined` typed as `string` propagates silently. | **2/4** | `src/api/story-routes.ts` (21 occurrences) + 5 others |
| H14 | **45 duplicate `AuthenticatedRequest`/`AuthReq` interface definitions** — No single source of truth; each has slightly different fields. | **2/4** | 45 files across `src/api/` and `src/middleware/` |
| H15 | **`@typescript-eslint/no-explicit-any` disabled globally** — Comment says "too many to fix in one pass". Production-path guardrail partially compensates. | **4/4** | `eslint.config.mjs:35` |
| H16 | **`escapeHtml` duplicated in 7 files** — DRY violation; should be a single shared utility. | **2/4** | Multiple renderers, chatbot, analytics |

#### Functionality (4)

| # | Finding | Audits | Location |
|---|---------|:---:|----------|
| H17 | **In-memory webhook idempotency** — Process-local `Map`; multi-instance deployments will process duplicate webhooks. | **4/4** | `src/lib/webhook-idempotency.ts:1` |
| H18 | **Merge API has no retries** — Transient 5xx/429 failures cause permanent data loss. | **2/4** | `src/services/merge-api-client.ts` |
| H19 | **N+1 query pattern in sync engine** — 5,000+ queries for 500 calls (sequential per-participant inserts). Contact sync: 3,000+ queries for 1,000 contacts. | **2/4** | `src/integrations/sync-engine.ts:549-559`, `:865-938` |
| H20 | **Story share links use `/p/:slug` but public pages mount at `/s/:slug`** — Users copy dead links from a core flow. | **2/4** | `frontend/src/pages/StoryLibraryPage.tsx:250-253`, `src/app.ts:188-189` |

#### Frontend (5)

| # | Finding | Audits | Location |
|---|---------|:---:|----------|
| H21 | **Monolithic CSS file (6,250 lines)** — Entire design system in one file, all global classes, no CSS Modules. | **2/4** | `frontend/src/styles/features.css` |
| H22 | **Monolithic API barrel file (2,643 lines)** — 100+ interfaces + 60+ functions in one file. | **3/4** | `frontend/src/lib/api.ts` |
| H23 | **No API caching or deduplication** — Every navigation re-fetches; no SWR, React Query, or custom cache. | **3/4** | `frontend/src/lib/api/http.ts` |
| H24 | **Frontend `request<T>()` always calls `.json()`, breaking `204 No Content`** — Successful deletes surface as client errors (`Unexpected end of JSON input`). | **2/4** | `frontend/src/lib/api/http.ts:50-55`, `src/api/dashboard/security-routes.ts:255-283` |
| H25 | **A11y blockers in admin UX** — Modal lacks dialog semantics/focus management; permission matrix toggles unlabeled; account search results mouse-only `div` rows. | **2/4** | `AdminAccountAccessPage.tsx:787-794`, `AdminPermissionsPage.tsx:292-308`, `:576-583` |

---

### Medium (30 findings)

#### Security & Infrastructure

| # | Finding | Audits | Location |
|---|---------|:---:|----------|
| M1 | In-memory rate limiter doesn't scale across instances | **4/4** | `src/middleware/rate-limiter.ts:34` |
| M2 | Security policy cache: no invalidation (60s stale window), unbounded growth | **2/4** | `src/middleware/security-policy.ts:24-29` |
| M3 | Invite URL with secret token returned in API response body | **1/4** | `src/api/org-settings-routes.ts:485-491` |
| M4 | `IntegrationConfig.credentials` stored as plaintext JSON (AI configs are encrypted) | **2/4** | `prisma/schema.prisma:1382` |
| M5 | Frontend `.env.local.example` uses `NEXT_PUBLIC_` prefix; Vite requires `VITE_` | **2/4** | `frontend/.env.local.example:3-4` |
| M6 | Replay protection weak: `validateWebhookTimestamp()` configured with `required: false` | **2/4** | `src/webhooks/merge-webhook.ts:180-184` |
| M7 | Check-then-create race in webhook ingestion can duplicate calls (no unique constraint on `externalId`) | **2/4** | `src/webhooks/gong-webhook.ts:196-218`, `prisma/schema.prisma:456-463` |
| M8 | Outbound webhook delivery has no timeout; slow targets inflate publish latency | **2/4** | `src/services/outbound-webhooks.ts:131-139` |
| M9 | Missing security headers (HSTS, CSP) | **1/4** | `src/app.ts` |
| M10 | Dependency audit (`npm run security:deps`) not in CI pipeline | **2/4** | `.github/workflows/ci-cd.yml` |

#### API & Data Layer

| # | Finding | Audits | Location |
|---|---------|:---:|----------|
| M11 | Auth context extraction uses unsafe double-cast in every route handler | **2/4** | `src/api/story-routes.ts:170-178` (and all route files) |
| M12 | Inconsistent response envelope (4 different patterns across endpoints) | **3/4** | Multiple files |
| M13 | Inconsistent error response shapes (4 different patterns) | **3/4** | Multiple files |
| M14 | No versioning for internal API routes (only RAG is `/api/v1`) | **3/4** | `src/app.ts` |
| M15 | No transaction wrapping for multi-step `persistCall` writes | **2/4** | `src/integrations/sync-engine.ts:509-619` |
| M16 | Missing index on `Call(organizationId, provider, externalId)` — sync lookups do full scans | **2/4** | `prisma/schema.prisma:479` |
| M17 | Gong provider silently swallows transcript fetch failures — calls stored without transcripts permanently | **2/4** | `src/integrations/gong-provider.ts:357-364` |
| M18 | Stripe webhook has no idempotency — duplicate deliveries can double-process | **2/4** | `src/middleware/billing.ts` |
| M19 | Pinecone calls lack error handling and retries | **2/4** | `src/services/rag-engine.ts` |

#### Code Quality

| # | Finding | Audits | Location |
|---|---------|:---:|----------|
| M20 | `req: any` in 6 route handlers | **3/4** | `src/api/dashboard/tenant-support-routes.ts` |
| M21 | 152+ non-null assertions (`!`) on `req.organizationId` | **1/4** | 17 files |
| M22 | Missing try/catch in billing trial gate middleware | **1/4** | `src/middleware/billing.ts:61-145` |
| M23 | Blocking PDF/DOCX generation on event loop | **2/4** | `src/api/story-routes.ts:1099-1209` |
| M24 | 4 unbounded in-memory caches with no eviction policy | **2/4** | `rate-limiter.ts`, `security-policy.ts` (x2), `response-cache.ts` |
| M25 | Sentry error handler registered before routes (should be after) | **1/4** | `src/app.ts:111` |
| M26 | Express 4 async handlers without centralized wrapper in several routes | **2/4** | Multiple route files |
| M27 | `story-routes.ts` is 1,209 lines mixing handlers, PDF gen, DOCX gen, markdown parsing | **4/4** | `src/api/story-routes.ts` |
| M28 | `landing-page-routes.ts` is 1,495 lines combining CRUD, approval workflow, versioning | **3/4** | `src/api/landing-page-routes.ts` |

#### Frontend

| # | Finding | Audits | Location |
|---|---------|:---:|----------|
| M29 | Duplicate toast implementations instead of shared `useToast` hook | **2/4** | `StoryLibraryPage.tsx`, `AdminAccountAccessPage.tsx` |
| M30 | Conflicting/dead `tokens.css` entirely overridden by `features.css` | **1/4** | `frontend/src/styles/tokens.css` vs `features.css` |

---

### Low (16 findings)

| # | Finding | Audits | Location |
|---|---------|:---:|----------|
| L1 | No Prettier or formatter; no pre-commit hooks | **3/4** | Repo root |
| L2 | `font: any` in PDF generation | **2/4** | `src/api/story-routes.ts:1078` |
| L3 | RAG cache in-memory; lost on restart | **2/4** | `src/lib/response-cache.ts` |
| L4 | README omits Gong/Grain, SCIM, impersonation | **2/4** | `README.md` |
| L5 | Some inputs use `outline: none` without `:focus-visible` fallback | **1/4** | Frontend CSS |
| L6 | No skeleton loaders; only spinners for loading states | **2/4** | Multiple pages |
| L7 | Toast has no manual dismiss or duration control | **1/4** | `frontend/src/components/Toast.tsx` |
| L8 | `window.confirm()` for destructive actions (5 pages) | **2/4** | `DashboardPagesPage`, `AdminAccountAccessPage`, etc. |
| L9 | Duplicate `saveBlob()` utility function | **1/4** | `usePublishFlow.ts`, `lib/api.ts` |
| L10 | Mobile shell likely broken/hidden from CSS defaults | **2/4** | `frontend/src/styles/features.css:556-567` |
| L11 | Nested interactive controls in analytics saved views (`button > span[role=button]`) | **1/4** | `AnalyticsDashboardPage.tsx:307-317` |
| L12 | `SELECT *` in trial gate middleware (runs every request, only 3 fields needed) | **1/4** | `src/middleware/billing.ts:79-81` |
| L13 | Sequential CRM entity sync (opportunities could parallel with contacts) | **1/4** | `src/integrations/sync-engine.ts:727-730` |
| L14 | No `engines` field in `package.json` enforcing Node 22 | **1/4** | `package.json` |
| L15 | Frontend ESLint config extends `next/core-web-vitals` but app uses Vite | **2/4** | `frontend/.eslintrc.json` |
| L16 | Borderline color contrast for muted text in default dark theme (~4.3:1) | **1/4** | `frontend/src/styles/features.css` |

---

### Testing & CI Gaps

| # | Finding | Audits | Location |
|---|---------|:---:|----------|
| T1 | Release coverage thresholds at 43-54% (industry: 70-80%) | **2/4** | `vitest.release.config.ts:34-39` |
| T2 | Security/reliability/e2e CI jobs lack Postgres/Redis service containers | **1/4** | `.github/workflows/ci-cd.yml:126-173` |
| T3 | Frontend test footprint is 1-3 test files; not in main CI `test` job | **2/4** | `frontend/` |
| T4 | Rate limiter tests only check exports exist (no behavioral tests) | **1/4** | `tests/rate-limiter.test.ts` |
| T5 | `fileParallelism: false` slows all test runs | **1/4** | `vitest.config.ts:8` |
| T6 | `npm run lint` fails (`eslint: command not found` without install) | **1/4** | Tooling gap |
| T7 | Root ESLint ignores entire `frontend/` directory | **1/4** | `eslint.config.mjs:8` |

#### Missing High-Value Tests (identified across audits)

- MFA spoof resistance: forged `x-mfa-verified` must not satisfy policy
- SCIM deprovision: verify session revocation and blocked auth post-deactivation
- Support opt-out enforcement in impersonation start/use flow
- Story share URL contract (`/s/:slug` not `/p/:slug`)
- HTTP client contract test for `204` endpoints
- Concurrent webhook ingestion race/idempotency

---

## Notable Positives (consensus across audits)

All audits independently praised these areas:

| Area | Detail | Audits |
|------|--------|:---:|
| **Accessibility** | Skip links, `aria-live` route announcements, focus trapping in modals, focus restoration, `aria-current="page"`, Cmd+K command palette, `ensureAccessibleFormLabels()` auto-patching, 3 themes (dark/light/high-contrast) | **4/4** |
| **Security architecture** | PII masking before AI providers, `crypto.timingSafeEqual` for webhooks, SHA-256 hashed API keys with rotation, migration safety scripts, tenant isolation via `organizationId` scoping | **4/4** |
| **Test architecture** | 93+ test files, pyramid (unit/integration/e2e/contract), chaos testing, dead-letter replay tests, no `.skip()`/`.only()`, proper fake timers, full E2E harness | **4/4** |
| **CI pipeline** | 10-12 quality gates with proper dependencies, lint -> typecheck -> test -> security -> build -> deploy + smoke test | **3/4** |
| **Docker** | 3-stage build, non-root user (`storyengine:1001`), `npm ci --omit=dev`, proper `.dockerignore` | **2/4** |
| **AI resilience** | Circuit breaker / failover pattern (`FailoverAIClient`), RAG context capping, token usage tracking with spend anomaly detection | **2/4** |
| **Backend architecture** | Factory pattern for routes with DI (`createXxxRoutes(deps)`), well-designed provider abstractions, BullMQ with idempotency keys and exponential backoff | **4/4** |
| **Schema design** | CUIDs, composite indexes, `@@map()` for snake_case, `@updatedAt`, safe additive migrations | **2/4** |
| **Custom hooks** | `useStoryGeneration`, `useQuoteSelection`, `usePublishFlow` — well-encapsulated with abort controllers and cleanup | **2/4** |
| **Observability** | OpenTelemetry from entry point, Sentry integration, Winston with `AsyncLocalStorage` context propagation | **2/4** |
| **Zero tech debt markers** | Virtually no `TODO`, `FIXME`, or `@ts-ignore` in production source code | **1/4** |

---

## Prioritized Action Plan

### Phase 1 — Critical Security (Week 1, ~1 day of focused work)

| # | Action | Severity | Effort | Addresses |
|---|--------|----------|--------|-----------|
| 1 | Remove `x-mfa-verified` header trust; derive MFA state server-side only | Critical | 15 min | C1 |
| 2 | Gate localhost origins on `NODE_ENV === "development"` | High | 15 min | H3 |
| 3 | Add rate limiter to `/api/auth` and `/api/scim/v2` | High | 15 min | H4 |
| 4 | Validate required env vars at startup (Stripe, WorkOS keys) | High | 20 min | H5 |
| 5 | Return 503 in session-auth catch block instead of `next()` | High | 5 min | H6 |
| 6 | Add global Express error handler before `return app` | High | 15 min | H11 |
| 7 | Enforce SCIM deprovision: revoke sessions + check `active` flag in session-auth | High | 1-2 hrs | H1 |
| 8 | Enforce tenant support opt-out in impersonation middleware | High | 30 min | H2 |

### Phase 2 — Security Redesign + Data Integrity (Week 1-2)

| # | Action | Severity | Effort | Addresses |
|---|--------|----------|--------|-----------|
| 9 | Redesign CSRF token with independent cryptographic token | Critical | 2-3 hrs | C2 |
| 10 | Fix CSS injection in public page renderer (use DOMPurify or strict allowlist) | Critical | 1-2 hrs | C3 |
| 11 | Audit and fix all `innerHTML` usage; extract `escapeHtml` to shared module | High | 2-3 hrs | H9, H16 |
| 12 | Fix share URL: `/p/:slug` -> `/s/:slug` | High | 10 min | H20 |
| 13 | Fix `request<T>()` to handle `204 No Content` safely | High | 15 min | H24 |
| 14 | Fix webhook intake: skip (not block) integrations with missing `webhookSecret` | High | 30 min | H10 |
| 15 | Replace in-memory webhook idempotency with Redis `SETNX` + TTL | High | 1-2 hrs | H17 |

### Phase 3 — Type Safety & Code Quality (Week 2-3)

| # | Action | Severity | Effort | Addresses |
|---|--------|----------|--------|-----------|
| 16 | Create canonical `AuthenticatedRequest` in `src/types/request.ts`; eliminate 45 duplicates | High | 3-4 hrs | H14, H13, M11 |
| 17 | Replace `console.*` with structured logger across 39 files | High | 2-3 hrs | H12 |
| 18 | Add per-provider Zod schemas for credential validation | High | 1-2 hrs | H7 |
| 19 | Re-enable `@typescript-eslint/no-explicit-any` with incremental fixes | High | Ongoing | H15 |
| 20 | Extract PDF/DOCX gen from story-routes.ts into `src/services/story-exports.ts` | Medium | 2 hrs | M27 |
| 21 | Extract approval workflow from landing-page-routes.ts | Medium | 2 hrs | M28 |

### Phase 4 — Frontend Performance (Week 3-4)

| # | Action | Severity | Effort | Addresses |
|---|--------|----------|--------|-----------|
| 22 | Add `React.lazy()` code splitting for all 32 routes | Critical | 2-3 hrs | C4 |
| 23 | Introduce SWR or TanStack Query for API caching | High | 3-4 hrs | H23 |
| 24 | Break down oversized page components (start with HomePage, StoryLibraryPage) | Critical | Ongoing | C5 |
| 25 | Begin CSS Modules migration (start with TranscriptViewerPage as model) | High | Ongoing | H21 |
| 26 | Split `lib/api.ts` into domain-specific sub-modules | High | 2-3 hrs | H22 |
| 27 | Fix admin a11y blockers (dialog semantics, checkbox labels, keyboard results) | High | 2-3 hrs | H25 |

### Phase 5 — Resilience & Scale (Month 2)

| # | Action | Severity | Effort | Addresses |
|---|--------|----------|--------|-----------|
| 28 | Batch sync engine queries (`createMany` + `$transaction`) | High | 3-4 hrs | H19 |
| 29 | Add `@@index([organizationId, provider, externalId])` on Call | Medium | 10 min | M16 |
| 30 | Move rate limiting to Redis (package already in deps) | Medium | 1-2 hrs | M1 |
| 31 | Add Merge API retries (3 attempts with exponential backoff) | High | 1-2 hrs | H18 |
| 32 | Add outbound API rate limiting for integration providers | High | 2-3 hrs | H8 |
| 33 | Add fetch timeout/abort for outbound webhooks; decouple from publish response | Medium | 1 hr | M8 |
| 34 | Add Stripe webhook idempotency using `event.id` | Medium | 1 hr | M18 |
| 35 | Add LRU eviction to in-memory caches | Medium | 1 hr | M24 |

### Phase 6 — Testing & Polish (Month 2-3)

| # | Action | Severity | Effort | Addresses |
|---|--------|----------|--------|-----------|
| 36 | Raise release coverage thresholds to 70-80% | Medium | Ongoing | T1 |
| 37 | Add Postgres/Redis services to security/reliability/e2e CI jobs | High | 30 min | T2 |
| 38 | Expand frontend test coverage beyond 3 files | Medium | Ongoing | T3 |
| 39 | Add missing high-value tests (MFA spoof, SCIM deprovision, share URL, 204 contract) | High | 3-4 hrs | Testing gaps |
| 40 | Standardize error response shape: `{ error, message?, details? }` | Medium | 2-3 hrs | M12, M13 |
| 41 | Add Prettier + pre-commit hooks | Low | 1 hr | L1 |
| 42 | Fix frontend ESLint config (remove Next.js, add Vite/React rules) | Low | 30 min | L15 |
| 43 | Add security headers (HSTS, CSP) | Medium | 1-2 hrs | M9 |
| 44 | Add `npm run security:deps` to CI pipeline | Medium | 15 min | M10 |

---

## Architecture Recommendations (Strategic)

| Timeframe | Recommendation | Audits |
|-----------|---------------|:---:|
| **Short-term** | Automated tenant scoping via Prisma Client Extensions (inject `organizationId` automatically) | **2/4** |
| **Short-term** | Separate API and worker entry points for independent scaling | **1/4** |
| **Medium-term** | Move PDF/DOCX gen to worker thread (`worker_threads`) or BullMQ job | **2/4** |
| **Medium-term** | Consider Prisma schema modularization (1,700+ lines currently) | **1/4** |
| **Long-term** | Evaluate breaking AI/Transcript processing into separate deployment from core CRM/Auth API | **1/4** |

---

## References

- **Prior audit:** `docs/StoryEngine_UI_UX_Audit2.md`
- **Dependency policy:** `docs/security/dependency-triage-policy.md`
- **Roadmap:** `docs/StoryEngine-Consolidated-Roadmap.md`

---

*Integrated from 8+ parallel audit agents across multiple independent audit sessions. Findings cross-referenced for confidence scoring.*
