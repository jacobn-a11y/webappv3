# Production Readiness — Task List

Fix all identified issues to make StoryEngine production-ready. Ordered by priority and dependency.

---

## Phase 1: Unblock CI (P0)

### 1.1 Fix Supertest Port Bug
**Issue:** `request(app)` throws `Cannot read properties of null (reading 'port')` — 76 test failures.

**Tasks:**
- [x] Add `tests/helpers/request-server.ts` — helper that starts server, waits for `listening`, returns `request(server)`
- [x] Update all tests using `request(app)` to use `requestServer(app)` pattern:
  - [x] `tests/tenant-isolation-routes.test.ts`
  - [x] `tests/e2e/rag-query.test.ts`
  - [x] `tests/e2e/story-build.test.ts`
  - [x] `tests/integration/permissions.integration.test.ts`
  - [x] `tests/integration/support-impersonation-routes.integration.test.ts`
  - [x] `tests/integration/incident-status-routes.integration.test.ts`
  - [x] `tests/integration/customer-success-routes.integration.test.ts`
  - [x] `tests/integration/admin-controls-readiness.integration.test.ts`
  - [x] `tests/integration/self-service-auth-session.integration.test.ts`
  - [x] `tests/e2e/self-service-journey.e2e.test.ts`
  - [x] `tests/landing-page-lifecycle.test.ts` (uses `withRequestServer`)
- [x] Run `npm test` — verify all 76 previously failing tests pass

**Estimate:** 2–3 hours

---

### 1.2 Fix TypeScript Build
**Issue:** `npm run build` fails with 100+ errors (Prisma exports, implicit `any`).

**Tasks:**
- [ ] Run `npx prisma generate` — ensure client is current
- [ ] Fix Prisma export errors:
  - [ ] `UserRole`, `User`, `FunnelStage`, `PermissionType`, etc. — verify schema matches imports
  - [ ] `Prisma.InputJsonValue` → use correct Prisma 5.x type (`Prisma.JsonValue` or generated type)
  - [ ] `Prisma.JsonNull` → verify correct usage for Prisma 5
- [ ] Fix implicit `any` errors — add explicit types to callback parameters in:
  - [ ] `src/api/dashboard-routes.ts` (~50 occurrences)
  - [ ] `src/api/ai-settings-routes.ts`
  - [ ] `src/api/analytics-routes.ts`
  - [ ] `src/api/account-merge-routes.ts`
  - [ ] `src/services/*.ts` (account-merge, ai-config, analytics, etc.)
- [ ] Run `npm run build` — verify zero errors

**Estimate:** 4–6 hours

---

### 1.3 Vitest Config
**Issue:** Tests in `src/**/*.test.ts` are never run.

**Tasks:**
- [ ] Add `src/**/*.test.ts` to `vitest.config.ts` include array
- [ ] Run full test suite — ensure no regressions from newly included tests

**Estimate:** 15 min

---

### 1.4 CI Prerequisites
**Issue:** Ensure CI has everything it needs.

**Tasks:**
- [ ] Verify `ci-cd.yml` runs `npx prisma generate` before typecheck and test (already present)
- [ ] Verify test job has `TEST_DATABASE_URL` and Postgres/Redis services (already present)
- [ ] Push changes — confirm CI passes (lint, typecheck, test, build)

**Estimate:** 30 min

---

## Phase 2: Code Quality (P1)

### 2.1 Lint Warnings
**Issue:** 17 `@typescript-eslint/no-unused-vars` warnings.

**Tasks:**
- [ ] `analytics-routes.ts` — prefix `escapeHtml` with `_` or remove
- [ ] `api-key-routes.ts` — prefix `hashApiKey` with `_` or remove
- [ ] `dashboard-page-renderer.ts` — prefix `currentUserId`, `isOwner`, `canManage` with `_`
- [ ] `billing.ts` — prefix `stripe`, `err` with `_`
- [ ] `ai-tagger.ts` — prefix `STAGE_TOPICS`, `TOPIC_LABELS`, `wasCalibrated` with `_`
- [ ] `company-scrubber.test.ts` — prefix `beforeEach`, `ScrubConfig` with `_`
- [ ] `entity-resolution.test.ts` — prefix `CallParticipantInput`, `result` with `_`
- [ ] `entity-resolution.ts` — prefix `DomainRecord` with `_`
- [ ] `pricing.ts` — prefix `metadata` with `_`
- [ ] `transcript-processor.ts` — prefix `aiClient` with `_`
- [ ] Run `npm run lint` — verify 0 warnings

**Estimate:** 30 min

---

### 2.2 Landing Page Lifecycle Tests
**Issue:** 41 tests skipped — requires `TEST_DATABASE_URL` and Prisma.

**Tasks:**
- [ ] Ensure `landing-page-lifecycle.test.ts` runs in CI (test job has DB)
- [ ] If skipped due to missing setup — add `beforeAll` to seed or skip with clear reason
- [ ] Document in README: integration tests require Postgres + Redis

**Estimate:** 1 hour

---

## Phase 3: Security & Dependencies (P2)

### 3.1 npm Vulnerabilities
**Issue:** 19 vulnerabilities (4 low, 1 moderate, 14 high).

**Tasks:**
- [ ] Run `npm audit` — review findings
- [ ] Run `npm audit fix` — apply non-breaking fixes
- [ ] For breaking fixes — evaluate and upgrade or pin
- [ ] Address deprecated packages: `node-domexception`, `glob@10.5.0`

**Estimate:** 1–2 hours

---

### 3.2 Environment Validation
**Issue:** App may start with missing/invalid env and fail at runtime.

**Tasks:**
- [x] Add startup validation for required env vars (DATABASE_URL, REDIS_URL, etc.)
- [x] Fail fast with clear error message if critical vars missing
- [x] Document all required vs optional vars in README

**Estimate:** 1 hour

---

## Phase 4: Deploy & Smoke (P3)

### 4.1 Docker Build
**Issue:** Dockerfile may fail if it runs `npm run build`.

**Tasks:**
- [ ] Verify Dockerfile build step succeeds with fixed TypeScript
- [ ] Test `docker compose up` — full stack runs
- [ ] Document `docker compose` workflow in README

**Estimate:** 30 min

---

### 4.2 Smoke Test
**Issue:** Post-deploy smoke test must pass.

**Tasks:**
- [ ] Run `npm run smoke:test` against local/staging
- [ ] Fix any failing smoke assertions
- [ ] Ensure `SMOKE_BASE_URL` is set in deploy job

**Estimate:** 30 min

---

### 4.3 Deploy Pipeline
**Issue:** Deploy job blocked until build passes.

**Tasks:**
- [ ] After Phase 1–2 complete — push to main
- [ ] Verify deploy job runs (Fly.io)
- [ ] Verify smoke test passes against production URL

**Estimate:** 30 min

---

## Phase 5: Documentation & Polish (P4)

### 5.1 README
**Tasks:**
- [x] Add "Quick Start" with minimal env for local dev
- [x] Document `prisma generate` requirement
- [x] Document test requirements (Postgres, Redis, TEST_DATABASE_URL)
- [x] Add troubleshooting section for common failures

**Estimate:** 30 min

---

### 5.2 Frontend Build
**Issue:** Verify frontend builds independently.

**Tasks:**
- [ ] Run `npm --prefix frontend run build` — verify success
- [ ] Ensure CI build job includes frontend build (already in ci-cd.yml)

**Estimate:** 15 min

---

## Summary

| Phase | Tasks | Estimate |
|-------|-------|----------|
| 1. Unblock CI | 4 | 7–10 hrs |
| 2. Code Quality | 2 | 1.5 hrs |
| 3. Security & Deps | 2 | 2–3 hrs |
| 4. Deploy & Smoke | 3 | 1.5 hrs |
| 5. Documentation | 2 | 45 min |
| **Total** | **13** | **~12–16 hrs** |

---

## Definition of Done

- [ ] `npm run lint` — 0 errors, 0 warnings
- [ ] `npm run build` — success
- [ ] `npm test` — all tests pass (no supertest port errors)
- [ ] CI/CD pipeline — green on main
- [ ] `npm run smoke:test` — passes against deployed app
- [ ] No critical/high npm audit vulnerabilities
