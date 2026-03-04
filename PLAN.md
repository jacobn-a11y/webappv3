# StoryEngine Unified Implementation Plan (De-duplicated)

This plan merges and de-duplicates:
- `PLAN.md` (UI/UX implementation actions)
- `UI-AUDIT-RECOMMENDATIONS-DETAILED.md` (workflow, governance, search, and cost-control recommendations)

It is organized as one execution roadmap with a single priority order, shared dependencies, and no repeated workstreams.

---

## Guiding Principles

1. **One workflow, not scattered features:** Creation -> review -> approval -> publish should be visible in one lifecycle model.
2. **Governance by default:** Permission checks, PII controls, and auditability are built into publish/export paths.
3. **Design system enforcement, not redesign churn:** Reuse existing token and component foundations; fix inconsistent usage.
4. **Cost controls are product features:** AI usage visibility and limits are first-class admin capabilities.

---

## Phase 0: Contracts, Data Rules, and Feature Flags (P0)

Lock these cross-cutting contracts before UI implementation:

1. **Lifecycle stage resolution (single source of truth):**
- `Published` if `publishedAt` exists.
- Else `In Review` if latest approval is `PENDING`.
- Else `Approved` if latest approval is `APPROVED`.
- Else `Draft`.

2. **Approval policy enum (org-level):**
- `ALL_REQUIRED`
- `ANONYMOUS_OK` (named requires approval)
- `NAMED_OK` (anonymous requires approval)
- `ALL_OK`

3. **Unified publish behavior:**
- One primary action: `Publish`.
- If policy requires approval -> create `ApprovalRequest(PENDING)`.
- Else -> publish directly.

4. **Quote model contract (two-tier in one library):**
- `tier: AUTO | CURATED`
- canonical source pointer: `sourceChunkId` (required in v1)
- provenance deep-link behavior and API-side permission enforcement

5. **AI usage event schema:**
- Track all AI paths with operation type, user, org, token usage, model, timestamp.

6. **Feature flags:**
- Lifecycle view
- Quote library
- Semantic search
- Slack approvals
- AI quotas and budget alerts

**Exit criteria:** API contracts and migrations are merged; feature flags are wired; no frontend work starts without these definitions.

---

## Phase 1: Design System Enforcement + Shared UX Primitives (P1)

Consolidated from prior token/button/table/loading/empty-state/accessibility-adjacent steps.

### 1.1 Token and style consistency pass
- Harden `themes.css` token set (typography scale, semantic aliases, shadows).
- Remove hardcoded colors/spacing/font sizes in page CSS files.
- Standardize color and spacing usage through CSS variables.

### 1.2 Button hierarchy (single pattern everywhere)
- Finalize variants: `primary`, `secondary`, `tertiary`, `destructive`, `icon`.
- Enforce consistent hover/active/focus-visible behavior.
- Enforce "one primary action per section" rule.

### 1.3 Shared components
- Build `OverflowMenu` for action-heavy cards/tables.
- Build `EmptyState` for all no-data and no-results scenarios.
- Expand `PageSkeleton` to variants: `table`, `cards`, `form`, `dashboard`.

### 1.4 Table and interaction baseline
- Unify on `.data-table` styling and pagination/action patterns.
- Add consistent row hover, focus states, and clickable row affordances.

### 1.5 Accessibility baseline (built into primitives)
- Visible `:focus-visible` on all interactive controls.
- 44x44 touch target minimum for icon/tight controls.
- ARIA labels for icon-only controls; decorative icon hiding.

**Primary files:**
- `frontend/src/styles/themes.css`
- `frontend/src/styles/components.css`
- `frontend/src/components/OverflowMenu.tsx`
- `frontend/src/components/EmptyState.tsx`
- `frontend/src/components/PageSkeleton.tsx`

---

## Phase 2: Core Navigation + Creator Workflow (P1/P2)

This merges the prior "sidebar/home" work with lifecycle and approvals recommendations.

### 2.1 Navigation structure
- Restructure sidebar into `CORE`, `TOOLS`, `ADMIN` groups.
- Move account/profile controls to sidebar footer.
- Keep a globally visible primary `New Story` action.

### 2.2 Home and creator "My Queue"
- Rebuild Home with role-aware sections.
- Add creator queue summary: Draft, In Review, Approved, Published (recent).
- Make queue counts and cards actionable.

### 2.3 Content Lifecycle view
- New route for cross-asset lifecycle visibility (stories + landing pages).
- Default table mode; optional kanban mode as follow-up.
- Filters: account, type, creator, date, stage.

### 2.4 Surface approval state everywhere creators work
- Story Library and Dashboard Pages show lifecycle badges.
- Badge click-through to request details or filtered queue.

### 2.5 Simplified approval flow UX
- One context-aware `Publish` action.
- Clear pre-action messaging (publish now vs send for approval).
- Approvers use dedicated queue; creators use My Queue/My Requests.

**Primary files:**
- `frontend/src/app/nav-config.tsx`
- `frontend/src/app/Sidebar.tsx`
- `frontend/src/pages/HomePage.tsx`
- `frontend/src/pages/StoryLibraryPage.tsx`
- `frontend/src/pages/DashboardPagesPage.tsx`
- new lifecycle/queue routes + related API endpoints

---

## Phase 3: Page-Level UX Rebuilds (P2)

Consolidate page redesign items into one execution set; avoid repeating component-level work from Phase 1.

### 3.1 High-traffic content pages
- Stories: reduce action overload (2 visible actions + overflow).
- Accounts index: clickable rows and overflow actions.
- Account detail: tabbed IA, breadcrumbs, condensed actions.

### 3.2 Forms and operational pages
- Writebacks: account picker + clearer form framing.
- Automations: grouped sections, labels/tooltips, useful empty state.
- Profile center: role badge + explicit save behavior.

### 3.3 Remaining key surfaces
- Auth/Login, Chat assistant, Analytics dashboard, Landing Page editor,
  Transcript viewer, Status page, Workspaces, Dashboard Pages.
- Apply shared primitives only (buttons, empty states, skeletons, tables).

**Primary files:**
- `frontend/src/pages/AccountsIndexPage.tsx`
- `frontend/src/pages/AccountDetailPage.tsx`
- `frontend/src/pages/WritebacksPage.tsx`
- `frontend/src/pages/AutomationsPage.tsx`
- `frontend/src/pages/ProfileCenterPage.tsx`
- plus remaining page files listed above

---

## Phase 4: Governance and Permission Clarity (P1/P2)

This is the unified governance track (PII scan + export warnings + permission feedback + raw/scrubbed clarity + dashboard).

### 4.1 Pre-publish PII scan
- Run scan on publish payload before commit.
- Show itemized findings and remediation actions.
- Respect governance setting for block-vs-bypass.

### 4.2 In-context export warnings
- Warn when export may include named data/PII.
- Require acknowledgement where policy requires it.

### 4.3 Action-level permission feedback
- Replace generic 403 handling with clear action-specific messaging.
- Keep submission-for-approval behavior aligned with Story Builder edit permissions.

### 4.4 Raw vs scrubbed clarity
- Explicit UI labels on transcript/story surfaces.
- Enforce raw/scrubbed restrictions at API layer; never UI-only.

### 4.5 Governance dashboard
- Aggregate pending approvals, retention signals, recent audit events,
  export/PII policy status, and legal-hold status.

---

## Phase 5: Derived Assets + Search & Retrieval (P2/P3)

### 5.1 Quote Library (two-tier)
- Single quote asset model with `AUTO` and `CURATED` tiers.
- Auto extraction on ingest; promote/demote; starred personal list.
- Transcript "Save quote" creates curated quote in same library.

### 5.2 Provenance and view-source controls
- Deep-link from quote to transcript segment highlight.
- Strict API-side enforcement for attribution visibility and obfuscation.
- "Source unavailable/expired" handling for retention edge cases.

### 5.3 Cross-account thematic retrieval
- Add topic + funnel filters across accessible accounts.
- Add taxonomy browser with counts and click-through filtering.

### 5.4 Semantic search (feature-flagged)
- Story Library semantic mode using existing RAG stack.
- Preserve account-level permission boundaries.

**Explicitly out of scope for v1 Quote Library:**
- folders/pages
- sentiment scoring
- full semantic quote search
- advanced export workflows beyond guarded copy/export basics

---

## Phase 6: AI Cost Control + Sync Strategy (P1/P2)

### 6.1 Instrument all AI paths
- Story generation (already tracked) + RAG query/chat/indexing + transcript tagging.
- Normalize usage records for reporting and quota checks.

### 6.2 Call sync cost strategy
- Initial sync: last 30 days, max 1,000 calls.
- Periodic incremental sync (weekly default).
- On-demand full account sync before story generation for requested account.
- Provider fallback when date filters are unsupported (cap-only path).

### 6.3 AI usage dashboard
- Admin view by user and operation, with date filters and export.

### 6.4 Per-user AI quotas
- Story and/or token quotas.
- Weekly, monthly, or both.
- Hard enforcement when limits are exceeded.

### 6.5 Model choice + budget alerts
- Optional model selector where org policy allows.
- Threshold alerts (80/90/100%) with admin notifications.

---

## Phase 7: Admin Surfaces, Integrations, and Public Pages (P3)

### 7.1 Admin UX consolidation
- Permissions matrix improvements.
- Roles hierarchy display.
- Audit logs filters + export.
- Security posture summary.
- Setup wizard clarity.
- Ops diagnostics queue health/retry.
- Billing/readiness consistency.
- Account settings readability/contrast.

### 7.2 Slack approvals integration
- Approver notifications and interactive Approve/Reject actions.
- Creator notifications for approved/rejected status.
- Signed payload verification + approver permission checks.

### 7.3 Public story page polish
- OG/Twitter metadata.
- Print stylesheet.
- Password gate UX improvements.

---

## Phase 8: Accessibility Hardening, QA, and Rollout (P1-P3)

### 8.1 Accessibility hardening pass
- Contrast audit + fixes.
- Keyboard tab order validation.
- Screen reader announcement checks.
- Touch target verification.

### 8.2 Test coverage and quality gates
- Unit coverage for lifecycle stage resolution, approval policy evaluation,
  quote tier transitions, quota enforcement.
- E2E flows: Create -> Publish (required/no approval), approval queue,
  My Queue, quote provenance, export warnings, permission-denied feedback.

### 8.3 Release strategy
- Progressive rollout under feature flags by workstream.
- Monitor errors, publish latency, approval turnaround time, AI spend,
  and creator throughput before full enablement.

---

## Final Priority Order (Single Cohesive Backlog)

1. **P0:** Contracts, migrations, and flags (Phase 0)
2. **P1:** Design system primitives + workflow backbone (Phases 1-2)
3. **P1/P2:** Governance + cost controls (Phases 4 and 6)
4. **P2:** Page-level rebuilds and quote/search delivery (Phases 3 and 5)
5. **P3:** Admin polish, Slack integration, public page polish (Phase 7)
6. **Cross-phase:** Accessibility hardening, testing, staged rollout (Phase 8)

---

## De-duplication Notes

These duplicates were intentionally collapsed:
- Loading/skeleton work from multiple sections -> one shared skeleton track (Phase 1).
- Empty-state recommendations repeated across sections -> one shared component track + adoption pass (Phases 1 and 3).
- Approval-related recommendations spread across home/library/admin -> one lifecycle + publish model (Phase 2).
- Governance, permission, and raw/scrubbed guidance -> one governance track (Phase 4).
- Accessibility directives repeated in styling and remediation sections -> one baseline + hardening model (Phases 1 and 8).

