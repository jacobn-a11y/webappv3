# StoryEngine (webappv3) — Comprehensive Remaining Audit Fixes

**Repository:** `https://github.com/jacobn-a11y/webappv3`  
**Stack:** TypeScript strict, Express 4, Prisma ORM, BullMQ, Redis (`redis` npm package), React 18, Vite, Vitest  
**Objective:** Implement all remaining audit findings below. All changes must compile (`npm run build` for backend, `cd frontend && npm run build` for frontend), be committed to a new branch `audit-fixes-phase2`, and pushed.

**Prerequisite:** Add `"redis": "^5.11.0"` to `package.json` dependencies. The `redis` package is used by `webhook-idempotency.ts` but may be extraneous; adding it explicitly makes the build reliable on fresh installs.

---

## Task 1: Redis-Backed Rate Limiters

### 1a. HTTP middleware rate limiter

**File:** `src/middleware/rate-limiter.ts`

Currently uses an in-memory `Map<string, RateLimitEntry>` keyed by IP. In multi-instance deploys each process has its own counters, multiplying the effective rate limit by instance count. It exports 4 pre-configured limiters: `passwordRateLimiter` (5/min), `apiRateLimiter` (100/min), `webhookRateLimiter` (200/min), `exportRateLimiter` (10/min).

**Fix:**
1. Keep the `createRateLimiter` function signature and all 4 exported instances unchanged so no consumer files need updating.
2. Add Redis-backed storage using the project's existing pattern from `src/lib/webhook-idempotency.ts`: lazy singleton `getRedisClient()` that reads `process.env.REDIS_URL` and falls back to in-memory `Map` when Redis is unavailable.
3. Use Redis `INCR` + `EXPIRE` pattern. Key format: `ratelimit:{name}:{ip}`. On first `INCR` (returns 1), set `EXPIRE` to `windowMs / 1000` seconds.
4. Add an optional `name` field to `RateLimiterOptions` (used as Redis key prefix). The 4 pre-configured limiters should pass names `"password"`, `"api"`, `"webhook"`, `"export"`.
5. Use the `redis` package (added in prerequisite). Do not add other Redis-related npm dependencies.

### 1b. Outbound API rate limiter

**File:** `src/integrations/outbound-rate-limiter.ts` (35 lines)

Token-bucket rate limiter used by Gong (3 req/s), Salesforce (5 req/s), and Grain providers. Currently stores `tokens` and `lastRefill` as instance properties — each process has its own bucket.

Current code:
```typescript
export class OutboundRateLimiter {
  private tokens: number;
  private lastRefill: number;
  constructor(private readonly maxTokens: number, private readonly refillRatePerSecond: number) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }
  async acquire(): Promise<void> { /* refill + consume or wait */ }
  private refill(): void { /* token refill based on elapsed time */ }
}
```

**Fix:**
1. Add an optional `name` parameter to the constructor for Redis key namespacing.
2. When Redis is available (same `getRedisClient()` pattern), use a Lua script or `INCR`/`PTTL` to implement a distributed token bucket. Fall back to in-memory when Redis is unavailable.
3. Provider instances should pass names: `new OutboundRateLimiter(3, 3, "gong")`, `new OutboundRateLimiter(5, 5, "salesforce")`, `new OutboundRateLimiter(5, 5, "grain")`.
4. Update the provider files (`src/integrations/gong-provider.ts`, `salesforce-provider.ts`, `grain-provider.ts`) to pass the name parameter.

### 1c. AI circuit breaker

**File:** `src/services/ai-resilience.ts`

Circuit breaker state is in-memory `Map<string, CircuitState>` where `CircuitState = { failures: number; openUntil: number }`. Each instance has independent failure counts, so one instance can trip the breaker while others continue hammering a degraded provider.

**Fix:**
1. When Redis is available, store circuit state as a Redis hash `circuit:{key}` with fields `failures` (int) and `openUntil` (timestamp). Use `HSET`/`HGET` with `EXPIRE` for cleanup.
2. `recordFailure(key)` should `HINCRBY circuit:{key} failures 1` and conditionally set `openUntil`.
3. `isCircuitOpen(key)` should `HGET circuit:{key} openUntil` and compare to `Date.now()`.
4. Fall back to in-memory `Map` when Redis is unavailable.

---

## Task 2: CSRF_SECRET Production Requirement

**Files:** `src/index.ts`, `src/middleware/csrf-protection.ts`, `.env.example`

Currently `csrf-protection.ts` line 6:
```typescript
const CSRF_SECRET = process.env.CSRF_SECRET || crypto.randomBytes(32).toString("hex");
```
Random fallback breaks multi-instance deployments and invalidates tokens on restart.

**Fix:**
1. In `src/index.ts`, add `CSRF_SECRET` to `requiredEnv` only when `NODE_ENV === "production"`. In development, keep the random fallback. The existing pattern:
   ```typescript
   const requiredEnv = ["DATABASE_URL", "REDIS_URL", "WORKOS_API_KEY", "WORKOS_CLIENT_ID"] as const;
   ```
   Change to conditionally include `CSRF_SECRET` for production.
2. In `src/middleware/csrf-protection.ts`, import `logger` from `../lib/logger.js` and log a warning when using the random fallback:
   ```typescript
   if (!process.env.CSRF_SECRET) {
     logger.warn("CSRF_SECRET not set — using random fallback. Set CSRF_SECRET in production.");
   }
   ```
3. In `.env.example`, update the `CSRF_SECRET` entry with a generation command:
   ```
   # REQUIRED in production. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   CSRF_SECRET=""
   ```

---

## Task 3: TanStack Query + Form Validation

### 3a. Install dependencies

```bash
cd frontend
npm install @tanstack/react-query @tanstack/react-query-devtools react-hook-form @hookform/resolvers zod
```

### 3b. Create query client

Create `frontend/src/lib/queryClient.ts`:
- Export a configured `QueryClient` with defaults: `staleTime: 30_000`, `gcTime: 5 * 60_000`, `retry: 1`, `refetchOnWindowFocus: false`.
- The existing `request<T>()` from `./api/http` should be used as the fetcher inside query functions.

### 3c. Wire into App

In `frontend/src/App.tsx`:
- Import `QueryClientProvider` from `@tanstack/react-query` and `ReactQueryDevtools` from `@tanstack/react-query-devtools`.
- Wrap the `<ToastProvider>` children with `<QueryClientProvider client={queryClient}>`.
- Add `<ReactQueryDevtools initialIsOpen={false} />` only in development.

### 3d. Convert HomePage to useQuery

`frontend/src/pages/HomePage.tsx` currently uses `useEffect` + `useState` for data fetching. Convert to `useQuery`:
- Create a `useDashboardData()` hook or inline `useQuery({ queryKey: ["dashboard"], queryFn: () => request<DashboardData>("/dashboard/home") })`.
- Replace manual loading/error state with `isLoading`, `error`, `data` from the query.
- Keep the existing UI structure.

### 3e. Convert AuthPage to react-hook-form + zod

`frontend/src/pages/AuthPage.tsx` uses manual `useState` + `onSubmit`. Convert the login/signup forms:
- Define a Zod schema: `z.object({ email: z.string().email(), password: z.string().min(8) })`.
- Wire to `useForm` with `zodResolver`.
- Show inline validation errors before submission.

### 3f. Wrap requestBlob and fetchApi

The existing `requestBlob` (binary downloads) and `fetchApi` (custom response handling like 409 conflicts) in `frontend/src/lib/api/http.ts` should NOT be converted to TanStack Query hooks — they're used for imperative actions (file downloads, optimistic conflict resolution). Instead:
- Create a `useMutation`-based pattern for write operations. Add a comment in `queryClient.ts` documenting: "Use `useQuery` for reads, `useMutation` for writes. Use `requestBlob`/`fetchApi` directly for binary downloads and custom response handling."
- No changes needed to `requestBlob` or `fetchApi` themselves.

---

## Task 4: Service Layer Extraction (All 13 Route Files)

### Service pattern to follow

```typescript
import type { PrismaClient } from "@prisma/client";

// ─── Types ───────────────────────────────────────────────────────────────────
export interface SomeResult { /* ... */ }

// ─── Service ─────────────────────────────────────────────────────────────────
export class XxxService {
  constructor(private prisma: PrismaClient) {}

  async getSomething(organizationId: string): Promise<SomeResult> {
    return this.prisma.someModel.findMany({ where: { organizationId } });
  }
}
```

Conventions: `constructor(private prisma: PrismaClient)`, async methods with typed returns, section comments with `─── dividers ───`, services throw domain errors, routes handle HTTP. Services are instantiated in route factory functions.

### 4a. `src/services/ops-diagnostics.ts` → NEW

Extract from `src/api/dashboard/ops-diagnostics-routes.ts` (924 lines, 36 prisma calls).

Handlers to extract business logic from:
- `GET /diagnostics` — system health: integration configs, run history, queue sizes, notification counts, usage records
- `GET /diagnostics/integration-runs` — paginated integration run history
- `GET /diagnostics/audit-trail` — filtered audit logs
- `POST /diagnostics/replay-run` — replay failed integration runs (validate run exists, check replay eligibility)
- Various admin stat queries

### 4b. `src/services/dashboard-overview.ts` → NEW

Extract from `src/api/dashboard/overview-routes.ts` (562 lines, 28 prisma calls).

Handlers:
- `GET /` — org-wide stats (story count, page count, call count, account count, integration count)
- `GET /home` — role-aware homepage data (recent activity, pending approvals, renewals, workspace counts, setup wizard state)

### 4c. `src/services/org-settings.ts` → NEW

Extract from `src/api/org-settings-routes.ts` (506 lines, 18 prisma calls).

Handlers:
- `GET/PATCH /settings` — org name and settings CRUD
- `GET /members` — member listing with roles
- `DELETE /members/:userId` — member removal
- `POST /invites` — invite creation
- `DELETE /invites/:inviteId` — invite revocation
- `GET /invites/:token` — invite lookup (public)
- `POST /invites/:token/accept` — invite acceptance

### 4d. `src/services/integration-config.ts` → NEW

Extract from `src/api/integration-routes.ts` (641 lines, 18 prisma calls).

Handlers:
- `GET /` — list all integration configs for org
- `GET /:provider` — get specific config with redacted credentials
- `POST /` — create integration config
- `PATCH /:provider` — update config
- `DELETE /:provider` — delete config
- `POST /:provider/test` — test credentials
- `POST /:provider/sync` — trigger sync
- `GET /ops/runs` — integration run history
- `POST /ops/runs/:runId/replay` — replay failed run
- `GET /ops/dead-letter` — dead letter runs
- `GET /ops/backfills` — backfill history
- `POST /ops/backfills` — trigger backfill

### 4e. `src/services/scim.ts` → NEW

Extract from `src/api/scim-routes.ts` (261 lines, 17 prisma calls).

Handlers:
- `POST /Users` — provision user
- `PATCH /Users/:userId` — update user (active flag, session revocation)
- `DELETE /Users/:userId` — deprovision user (session revocation)

### 4f. `src/services/auth.ts` → NEW

Extract from `src/api/auth-routes.ts` (455 lines, 17 prisma calls).

Handlers:
- WorkOS SSO callback — find/create user + org
- Password login — user lookup + session creation
- Signup — org + user creation
- Invite acceptance — user creation + org membership
- Session management — me, update profile, logout

### 4g–4m. Lower-priority route files

These have fewer direct prisma calls but should also be updated:

| Route file | Lines | Prisma calls | New service |
|-----------|-------|-------------|-------------|
| `dashboard/admin-settings-routes.ts` | 461 | 11 | `AdminSettingsService` |
| `dashboard/account-access-routes.ts` | 413 | 10 | (already has `AccountAccessService` — move remaining calls into it) |
| `ai-settings/admin-routes.ts` | 389 | 10 | `AISettingsService` |
| `landing-page-routes.ts` | 1,211 | 10 | (already has `LandingPageEditor` — move remaining calls into it) |
| `analytics-routes.ts` | 729 | 8 | (already has `AnalyticsService` — move remaining calls into it) |
| `story-routes.ts` | 1,004 | 6 | (already has `StoryBuilder` — move remaining calls into a new `StoryQueryService` or into existing service) |
| `account-merge-routes.ts` | 434 | 5 | (already has `AccountMergeService` — move remaining calls into it) |

For these, extend the existing service classes with the missing query methods rather than creating new service files.

### After all extractions

Each route file should contain only:
1. Request parsing (params, body, query)
2. Auth/permission checks
3. Service method calls
4. Response formatting (`res.json()`, `sendSuccess()`, etc.)

No `prisma.` imports or calls should remain in route files.

---

## Task 5: God File Decomposition

### Backend

#### 5a. `src/api/landing-page-routes.ts` (1,211 lines → 3 files)

Split into `src/api/landing-page/`:

| File | Routes | ~Lines |
|------|--------|--------|
| `crud-routes.ts` | `POST /`, `GET /:pageId`, `GET /:pageId/edit-data`, `PATCH /:pageId`, `DELETE /:pageId` | ~300 |
| `publish-routes.ts` | `POST /:pageId/publish`, `POST /:pageId/unpublish`, `POST /:pageId/archive`, `GET /:pageId/versions`, `POST /:pageId/versions/:versionId/rollback`, `GET/POST/DELETE /:pageId/scheduled-publish`, `GET /approvals/publish`, `POST /approvals/publish/:requestId/review` | ~500 |
| `preview-routes.ts` | `GET /:pageId/preview`, `POST /:pageId/preview-scrub` | ~200 |

Create a compatibility shim at `src/api/landing-page-routes.ts` (same pattern as `src/api/setup-routes.ts`):
```typescript
export function createLandingPageRoutes(prisma, deps) {
  const router = Router();
  registerCrudRoutes({ router, prisma, ...deps });
  registerPublishRoutes({ router, prisma, ...deps });
  registerPreviewRoutes({ router, prisma, ...deps });
  return router;
}
```

#### 5b. `src/api/story-routes.ts` (1,004 lines → 3 files)

Split into `src/api/story/`:

| File | Routes | ~Lines |
|------|--------|--------|
| `build-routes.ts` | `POST /build`, `POST /build/stream`, `POST /merge-transcripts` | ~400 |
| `library-routes.ts` | `GET /library`, `GET /:accountId` | ~300 |
| `export-routes.ts` | `GET /:storyId/export`, `DELETE /:storyId` | ~200 |

Compatibility shim at `src/api/story-routes.ts`.

#### 5c. `src/api/dashboard/ops-diagnostics-routes.ts` (924 lines → 3 files)

Split into `src/api/dashboard/ops-diagnostics/`:

| File | Routes | ~Lines |
|------|--------|--------|
| `health-routes.ts` | `GET /diagnostics` (system health overview) | ~300 |
| `runs-routes.ts` | `GET /diagnostics/integration-runs`, `POST /diagnostics/replay-run`, dead-letter routes | ~350 |
| `audit-routes.ts` | `GET /diagnostics/audit-trail`, notification counts | ~200 |

#### 5d. `src/api/analytics-routes.ts` (729 lines → 2 files)

Split into `src/api/analytics/`:

| File | Routes | ~Lines |
|------|--------|--------|
| `api-routes.ts` | `GET /`, `GET /revops-kpis` (JSON API) | ~350 |
| `dashboard-renderer.ts` | `GET /dashboard` (server-rendered HTML) | ~350 |

#### 5e. `src/api/templates/admin-account-access-template.ts` (1,276 lines)

This is a server-rendered HTML template. Split into:

| File | Content | ~Lines |
|------|---------|--------|
| `admin-account-access-template.ts` | Main template composition, layout | ~200 |
| `admin-account-access-styles.ts` | CSS string constant | ~400 |
| `admin-account-access-scripts.ts` | Client-side JS string constant | ~500 |

#### 5f. `src/api/templates/transcript-viewer-template.ts` (1,146 lines)

Same pattern:

| File | Content | ~Lines |
|------|---------|--------|
| `transcript-viewer-template.ts` | Template composition, layout | ~200 |
| `transcript-viewer-styles.ts` | CSS string constant | ~400 |
| `transcript-viewer-scripts.ts` | Client-side JS string constant | ~400 |

#### 5g. `src/api/public-page-renderer.ts` (1,068 lines)

Split into `src/api/public-page/`:

| File | Content | ~Lines |
|------|---------|--------|
| `renderer.ts` | Route handler + HTML template composition | ~300 |
| `sanitizers.ts` | `sanitizeCustomCss`, `sanitizeHeroImageUrl`, `sanitizeHexColor` | ~150 |
| `styles.ts` | CSS string constant for public page | ~400 |

Compatibility shim at `src/api/public-page-renderer.ts`.

### Frontend

The `StoryGeneratorModal.tsx` (1,615 lines) already has partial decomposition:
- `story-generator/useStoryGeneration.ts` (174 lines)
- `story-generator/useQuoteSelection.ts` (59 lines)
- `story-generator/usePublishFlow.ts` (165 lines)
- `story-generator/StoryModalSections.tsx` (449 lines)

But `StoryGeneratorModal.tsx` itself is still 1,615 lines. Further decompose:

#### 5h. `StoryGeneratorModal.tsx` (1,615 → ~300 lines)

Move more into `frontend/src/components/story-generator/`:

| File | Content | ~Lines |
|------|---------|--------|
| `StoryGeneratorModal.tsx` (shell) | Modal frame, step routing, state machine | ~300 |
| `StoryFormStep.tsx` | NEW — story type/template/account selection form | ~250 |
| `StoryPreviewStep.tsx` | NEW — generated story preview with streaming | ~300 |
| `StoryPublishStep.tsx` | NEW — publish to landing page flow | ~200 |
| `StoryModalSections.tsx` | KEEP — shared section components | ~449 |
| `useStoryGeneration.ts` | KEEP | ~174 |
| `useQuoteSelection.ts` | KEEP | ~59 |
| `usePublishFlow.ts` | KEEP | ~165 |

Re-export from `frontend/src/components/StoryGeneratorModal.tsx` for backward compatibility.

#### 5i. `HomePage.tsx` (1,059 → ~200 lines)

Decompose into `frontend/src/pages/home/`:

| File | Content | ~Lines |
|------|---------|--------|
| `HomePage.tsx` | Layout shell, data fetching (useQuery after Task 3) | ~200 |
| `StatsGrid.tsx` | Stat cards (Total Calls, Accounts, Stories, etc.) | ~150 |
| `QuickActions.tsx` | CTA buttons, role-aware shortcuts | ~150 |
| `RecentActivity.tsx` | Recent stories/pages feed | ~200 |
| `RenewalValue.tsx` | Renewal/pipeline value widget | ~150 |

Re-export from `frontend/src/pages/HomePage.tsx`.

#### 5j. `StoryLibraryPage.tsx` (1,072 → ~200 lines)

Decompose into `frontend/src/pages/story-library/`:

| File | Content | ~Lines |
|------|---------|--------|
| `StoryLibraryPage.tsx` | Layout, view toggle, filter state | ~200 |
| `StoryFilters.tsx` | Filter bar (type, stage, account, search) | ~200 |
| `StoryCard.tsx` | Card view item | ~150 |
| `StoryTable.tsx` | Table view with sortable columns | ~200 |
| `useStoryLibrary.ts` | Custom hook: fetch + filter + pagination state | ~150 |

Re-export from `frontend/src/pages/StoryLibraryPage.tsx`.

#### 5k. `LandingPageEditorPage.tsx` (1,037 → ~250 lines)

Decompose into `frontend/src/pages/editor/`:

| File | Content | ~Lines |
|------|---------|--------|
| `LandingPageEditorPage.tsx` | Layout shell, save/load, conflict resolution | ~250 |
| `EditorToolbar.tsx` | Top bar (title, status, save, publish buttons) | ~150 |
| `PublishModal.tsx` | Publish modal with visibility, password, scrub preview | ~300 |
| `VersionHistory.tsx` | Published versions list with rollback | ~200 |

Re-export from `frontend/src/pages/LandingPageEditorPage.tsx`.

#### 5l. `AdminOpsDiagnosticsPage.tsx` (1,007 → ~200 lines)

Decompose into `frontend/src/pages/admin-ops/`:

| File | Content | ~Lines |
|------|---------|--------|
| `AdminOpsDiagnosticsPage.tsx` | Layout shell, tabs/sections | ~200 |
| `PipelineStatus.tsx` | Pipeline health, recent runs table | ~200 |
| `IncidentResponse.tsx` | Incidents table, create/update forms | ~200 |
| `SupportImpersonation.tsx` | Session management, start/revoke | ~150 |
| `IntegrationHealth.tsx` | Integration configs table, dead letter | ~200 |

Re-export from `frontend/src/pages/AdminOpsDiagnosticsPage.tsx`.

#### 5m. `DashboardPagesPage.tsx` (927 → ~200 lines)

Decompose into `frontend/src/pages/dashboard-pages/`:

| File | Content | ~Lines |
|------|---------|--------|
| `DashboardPagesPage.tsx` | Layout, filter state, data fetch | ~200 |
| `PageStatsCards.tsx` | Total/Published/Drafts/Views cards | ~100 |
| `PageFilters.tsx` | Search, status, visibility, creator filters | ~150 |
| `PageTable.tsx` | Sortable table with row actions | ~300 |

Re-export from `frontend/src/pages/DashboardPagesPage.tsx`.

#### 5n. `AnalyticsDashboardPage.tsx` (909 → ~200 lines)

Decompose into `frontend/src/pages/analytics/`:

| File | Content | ~Lines |
|------|---------|--------|
| `AnalyticsDashboardPage.tsx` | Layout, view controls, saved views | ~200 |
| `SummaryCards.tsx` | Stat cards (Total Calls, Accounts, etc.) | ~100 |
| `AnalyticsCharts.tsx` | Chart.js charts (calls/week, funnel, resolution) | ~300 |
| `RevOpsKPIs.tsx` | RevOps KPI package (pipeline influence, win rate) | ~200 |

Re-export from `frontend/src/pages/AnalyticsDashboardPage.tsx`.

#### 5o. `TranscriptViewerPage.tsx` (988 → ~250 lines)

Decompose into `frontend/src/pages/transcript/`:

| File | Content | ~Lines |
|------|---------|--------|
| `TranscriptViewerPage.tsx` | Layout, data fetch, deep-link handling | ~250 |
| `TranscriptBody.tsx` | Segments with speaker avatars, search highlights | ~300 |
| `TranscriptSidebar.tsx` | Call details, participants, entity resolution | ~200 |
| `TranscriptSearch.tsx` | Search input, match navigation | ~100 |

Re-export from `frontend/src/pages/TranscriptViewerPage.tsx`.

---

## Task 6: Other Remaining Audit Items

### 6a. RAG cache → Redis

**File:** `src/services/rag-engine.ts`

Currently uses two in-memory `Map`s:
```typescript
private queryCache = new Map<string, { value: RAGResponse; expiresAt: number }>();
private chatCache = new Map<string, { value: RAGChatResponse; expiresAt: number }>();
```
Lost on restart, not shared across instances.

**Fix:**
1. When Redis is available, use `SET key JSON.stringify(value) EX ttlSeconds` and `GET key` for both caches.
2. Key format: `rag:query:{hash}` and `rag:chat:{hash}` where hash is a stable hash of the query parameters.
3. Keep `maxCacheEntries` as a Redis `SCARD` check or simply rely on TTL-based eviction.
4. Fall back to in-memory `Map` when Redis is unavailable.

### 6b. Entity resolution memory pressure

**File:** `src/services/entity-resolution.ts` (method `matchByFuzzyName`, ~line 334)

Currently loads all org accounts into memory for Fuse.js fuzzy matching:
```typescript
const accounts = await this.prisma.account.findMany({
  where: { organizationId },
  select: { id: true, name: true, normalizedName: true, domain: true },
});
```
For large orgs (10,000+ accounts), this is a memory and latency problem.

**Fix:**
1. Pre-filter: before Fuse.js, narrow candidates using a SQL `ILIKE` or `contains` query on `normalizedName` with the first significant word from the search terms.
2. Limit: add `take: 500` to the `findMany` to cap memory usage.
3. If the SQL pre-filter returns 0 results, try a broader search with `take: 200`.
4. Only fall back to full Fuse.js scan if the org has fewer than 500 accounts.

### 6c. PDF/DOCX generation → worker thread

**File:** `src/services/landing-page-exports.ts`

Currently uses a busy-wait concurrency limiter (`while (activePdfJobs >= MAX_PDF_CONCURRENCY) await sleep(500)`) and runs Puppeteer on the request handler thread.

**Fix:**
1. Replace the busy-wait with a proper semaphore (use a `Promise`-based queue, not `setTimeout` polling).
2. Offload the Puppeteer work to a `worker_threads` Worker or a dedicated BullMQ job queue `pdf-export`:
   - If using BullMQ: add a new queue in `src/queues.ts`, create a worker with `concurrency: 2`, and have the route handler enqueue the job and poll for completion (or use `waitUntilFinished`).
   - If using `worker_threads`: create `src/workers/pdf-export-worker.ts` that receives HTML and returns a Buffer.
3. Either approach eliminates event loop blocking.

### 6d. Sequential CRM entity sync → batch

**File:** `src/integrations/sync-engine.ts`

`persistContact()` (~lines 863-937) does 3-4 sequential queries per contact. `persistAccount()` (~lines 769-835) does 2 sequential queries per account. With 1,000 contacts, this is 3,000-4,000 queries.

**Fix:**
1. In `syncContacts`, use `prisma.contact.createMany` for new contacts and batch `findMany` for collision detection.
2. In `syncAccounts`, use `prisma.account.createMany` with `skipDuplicates: true` where possible.
3. Use `Promise.all` with a concurrency limit (e.g., batches of 50) instead of sequential `for` loops.
4. The `persistCall` method is already transactional — follow the same `$transaction` pattern for contact and account batches.

### 6e. `req.organizationId` non-null assertions

Route files use `req.organizationId` with manual `if (!req.organizationId)` guards at the top of each handler. This is repeated ~200+ times across the codebase.

**Fix:**
1. Create `src/middleware/require-organization.ts`:
   ```typescript
   export function requireOrganization(req: AuthenticatedRequest, res: Response, next: NextFunction) {
     if (!req.organizationId) {
       sendUnauthorized(res, "Organization context required");
       return;
     }
     next();
   }
   ```
   Also export a typed request:
   ```typescript
   export type OrgRequest = AuthenticatedRequest & { organizationId: string; userId: string };
   ```
2. Apply `requireOrganization` as middleware on all route groups that need it (after `requireAuth` in `src/app.ts`).
3. Route handlers can then use `req as OrgRequest` or type the parameter directly, eliminating the guard boilerplate.
4. This is a large touch-surface change — do the middleware + type first, then convert the top 5 route files by usage as a pattern.

---

## General Rules

1. **Do not modify git config.**
2. **Run `npm run build` (backend) and `cd frontend && npm run build` after changes.** Fix any type errors introduced.
3. **Follow existing patterns** — section comments with `─── dividers ───`, `asyncHandler` for route handlers, `sendSuccess`/`sendError`/`sendBadRequest` from `src/api/_shared/responses.ts`, structured logger from `src/lib/logger.ts`.
4. **Keep backward compatibility** — use re-exports and compatibility shims when splitting files. No consumer files should need updating.
5. **Create branch `audit-fixes-phase2`**, commit all changes with descriptive messages, and push.
6. **Do not add narration comments.** Only add comments that explain non-obvious logic or API contracts.
7. **Priority order:** Task 1 (Redis) → Task 2 (CSRF) → Task 4 (services) → Task 5 (god files) → Task 6 (other items) → Task 3 (frontend deps). This order minimizes merge conflicts since backend changes are more isolated.
