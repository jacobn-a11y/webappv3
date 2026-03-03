# StoryEngine Consolidated Roadmap (Canonical)

Repository: https://github.com/jacobn-a11y/webappv3
Updated: March 3, 2026

This is the canonical roadmap file for this repo.
It preserves the full `T01-T61` sequence and adds a new additive sales-adoption UX phase as `T62-T73`.

## Execution status

- As of March 3, 2026:
  - `T01-T61`: completed
  - `T62-T73`: completed

## 0) Execution setup (do first)

- Create a tracking epic with all tasks `T01-T61` and enforce one PR per task (or small paired tasks only when dependency-locked).
- Add a branch naming convention: `codex/roadmap-tXX-short-name`.
- Define PR template sections: scope, API changes, migration impact, tests run, rollback note.
- Use this validation baseline for every task:
  - `npm run lint`
  - `npm run build`
  - `npm test`
  - `npm --prefix frontend run test`
  - `npm run test:security`
  - `npm run test:reliability`
- Keep external contracts stable during refactors by preserving route paths and response envelopes until `T57`.

## Phase 1: Bloat removal + AI-friendly architecture (`T01-T10`)

- `T01` split `src/api/dashboard-routes.ts`: create `src/api/dashboard/` with domain modules (kpis, pages, stories, permissions, ops) and shared serializers/validators; keep `createDashboardRoutes()` export in `src/api/dashboard-routes.ts` as compatibility shim; update imports in `src/app.ts`; move tests from `src/api/dashboard-routes.test.ts` to module-level tests.
- `T02` split `src/api/setup-routes.ts`: create `src/api/setup/` with status, quickstart, steps, first-value modules; keep `createSetupRoutes()` API unchanged; ensure `/api/setup/*` behavior remains identical.
- `T03` split `src/api/ai-settings-routes.ts`: create `src/api/ai-settings/` with user, admin, billing modules; keep `createAISettingsRoutes()` compatibility.
- `T04` shared API helpers: add `src/api/_shared/` for pagination parser, zod request validators, and consistent error envelope helper; replace duplicated patterns in dashboard, setup, ai-settings, then expand to other route files.
- `T05` split `frontend/src/App.tsx`: create `frontend/src/app/` with `AppShell.tsx`, `routes.tsx`, `nav-config.ts`, `global-modals.tsx`; reduce `App.tsx` to composition only.
- `T06` split `frontend/src/lib/api.ts`: create `frontend/src/lib/api/` domain clients (auth, dashboard, stories, pages, setup, ai-settings, admin, integrations), plus shared `http.ts`; keep temporary re-export layer from `frontend/src/lib/api.ts`.
- `T07` decompose `frontend/src/components/StoryGeneratorModal.tsx`: move state + async orchestration to hooks (`useStoryGeneration`, `useQuoteSelection`, `usePublishFlow`) and split UI sections into subcomponents.
- `T08` CSS architecture: create `frontend/src/styles/` with `tokens.css`, `reset.css`, `utilities.css`, feature-level styles; make `frontend/src/index.css` an import orchestrator only.
- `T09` file-size guardrails: add `scripts/contracts/file-size-guard.mjs` + config JSON; wire warn-only CI step first; switch to blocking after `T01-T08` land.
- `T10` AI development map: add `docs/AI_DEVELOPMENT_GUIDE.md` with module map, ownership, “where to change X” table, test matrix, and route/client dependency graph.

## Phase 2: Prisma/type-safety foundation (`T11-T16`)

- `T11` enum migration plan: inventory all closed-domain String fields in `prisma/schema.prisma` (start with status, severity, request/run states); define Prisma enums and map field-by-field.
- `T12` migrations/backfills: create per-domain migration scripts in `scripts/migrations/` to normalize old strings before enum constraints; include dry-run mode + idempotency.
- `T13` JSON boundary decoders: add zod decoders for JSON columns (settings, credentials, policy, provenance, metadata-style blobs) in a central module (`src/types/json-boundaries.ts`); decode at service/repository boundaries.
- `T14` remove unsafe casts: block `as any` and `as unknown as` in production paths via eslint override + targeted refactors in data-access/services.
- `T15` Prisma ownership conventions: add `docs/prisma-schema-ownership.md` with model owners, migration naming, backfill requirements, rollback procedure.
- `T16` migration smoke tests: add CI DB smoke path for clean DB + seeded DB + upgrade path; gate merges if migrations fail either path.

## Phase 3: MVP path simplification (`T17-T22`)

- `T17` setup default path: make setup wizard default to Gong key + OpenAI key + save + index + select + ingest only; move non-core options behind advanced panel.
- `T18` advanced capability isolation: gate recorder/power features behind admin/advanced surfaces only; keep defaults minimal.
- `T19` Gong parity contract: define ingest payload contract doc + schema tests matching Exporter 4 required fields.
- `T20` parity automation: add contract tests validating ingest payload field parity on every CI run.
- `T21` provider resolution consolidation: centralize provider selection in one policy service (no route-level branching duplication).
- `T22` operation defaults normalization: define explicit defaults by operation (tagging, rag, story generation) with override rules and audit logging.

## Phase 4: reliability/security/performance (`T23-T32`)

- `T23` dead-letter replay hardening: implement bounded replay windows, attempt caps, and replay audit records.
- `T24` replay observability: add queue replay dashboard endpoints/views (counts, filters, outcomes, operator identity).
- `T25` chaos expansion: extend Redis/worker failure tests and restart scenarios in integration reliability suite.
- `T26` webhook security hardening: expand replay-window and signature validation tests for inbound webhooks.
- `T27` dependency policy enforcement: wire `npm run security:deps` into CI as blocking gate with triage policy.
- `T28` PII masking corpus expansion: add false-negative-heavy corpus and regression tests for redaction edge cases.
- `T29` CSRF re-verification: rerun CSRF matrix after route refactors and document protected/unprotected paths.
- `T30` endpoint latency budgets: define P95/P99 budgets for key endpoints and enforce via `scripts/perf/check-budgets.mjs`.
- `T31` load tests: add sustained-load profiles for dashboard/story endpoints; publish thresholds and failure behavior.
- `T32` RAG quality guardrails: pair performance gains with relevance/grounding checks to prevent quality regressions.

## Phase 5: core UX/product improvements (`T33-T39`)

- `T33` quote provenance UX: show call + timestamp deep-links for story quotes; add backend citation payload support where missing.
- `T34` regenerate/edit/create concurrency: add optimistic concurrency checks and conflict handling for story/page edit flows.
- `T35` admin error-state standardization: unify API error UX with retry actions and operator guidance.
- `T36` table/list consistency: create reusable table/KPI layout primitives and migrate admin pages incrementally.
- `T37` publishing/share robustness: add broken-link checks and post-publish validation jobs.
- `T38` onboarding guidance: add contextual first-value prompts in setup and early dashboard states.
- `T39` story library quality: improve filter fidelity, lifecycle state clarity, and safe bulk affordances.

## Phase 6: medium/low backlog (`T40-T49`)

- `T40` comments/feedback threads on stories/pages.
- `T41` safe bulk operations with preview + confirmation.
- `T42` deeper analytics with segment/saved views.
- `T43` scheduled reporting exports.
- `T44` org branding/theming for published surfaces.
- `T45` template gallery + reusable presets.
- `T46` scheduled publishing controls.
- `T47` user preferences/profile center.
- `T48` outbound webhook/event API.
- `T49` i18n groundwork (string extraction + locale scaffolding).

## Phase 7: accessibility end-pass (`T50-T56`)

- `T50` global landmarks/lang attributes completeness audit.
- `T51` route-change and modal focus management audits/fixes.
- `T52` SVG/button labeling + heading hierarchy cleanup.
- `T53` live regions for async operations/status updates.
- `T54` contrast + high-contrast mode completion.
- `T55` automated axe checks in CI (blocking).
- `T56` manual keyboard + screen reader verification on critical flows.

## Cross-cutting release gates (`T57-T61`)

- `T57` contract tests for every refactored route/module boundary.
- `T58` migration smoke tests in release pipeline.
- `T59` CI performance gates for high-traffic endpoints.
- `T60` security scan gates + explicit triage policy.
- `T61` release note + rollback note required for each roadmap block (stored under `docs/release-policy/` + `docs/release-evidence/`).

## Suggested delivery batching (practical sequence)

- Batch A: `T01 + T57` (dashboard split + boundary tests).
- Batch B: `T05, T06, T07, T08, T09, T10`.
- Batch C: `T02, T03, T04`.
- Batch D: `T11-T16` (all Prisma safety work).
- Batch E: `T17-T22` (MVP simplification).
- Batch F: `T23-T32` (ops hardening).
- Batch G: `T33-T39`.
- Batch H: `T40-T49`.
- Batch I: `T50-T56`.
- Batch J: finalize `T58-T61` across all prior batches.

## Phase 8: Sales Adoption UX Fast Path (`T62-T73`) — additive

- `T62` global `New Story` entry point with one-click account/opportunity picker from any page.
- `T63` deal-stage presets mapped to seller workflow (`Discovery`, `Evaluation`, `Business Case`, `Negotiation`, `Expansion`) that auto-apply story defaults.
- `T64` guided quick flow for story generation (`Goal`, `Audience`, `Anonymization`) with advanced controls hidden by default.
- `T65` explicit `Anonymous` vs `Named` generation mode with guardrails and governance-aware blocking.
- `T66` `Generate + Package` action producing polished story view, email-ready summary, one-page PDF, and share link.
- `T67` story library card redesign for seller speed: rendered preview, lifecycle badge, and direct actions (`Share`, `Copy`, `Create Page`, `Export`).
- `T68` CRM-first sharing actions (`Copy for CRM note`, `Push to account/opportunity note` when integration supports it).
- `T69` rapid iteration controls (`Regenerate same`, `Regenerate with tweak`, `Shorter`, `More executive`, `More proof`).
- `T70` stage-matched packaging templates for both anonymous and named outputs (`Executive Recap`, `Champion Forward`, `ROI Proof`).
- `T71` quote/source confidence chips and a `Safe to Share` indicator.
- `T72` first-run seller onboarding focused on first story and first share in <=60 seconds.
- `T73` seller adoption telemetry (time-to-first-story, time-to-share, stage-preset usage, anonymous-vs-named usage, and funnel drop-off).

## Delivery extension for additive phase

- Batch K: `T62-T65` (fast start + guided defaults + anonymization clarity).
- Batch L: `T66-T70` (package/share/iterate + stage templates).
- Batch M: `T71-T73` (trust indicators + onboarding + telemetry).

## Canonicality note

- `T01-T61` sequence is preserved as the baseline roadmap contract.
- `T62-T73` is additive and does not replace any `T01-T61` commitments.
