# StoryEngine vNext UX Master Specification (Standalone)

Last updated: 2026-03-04  
Status: Authoritative execution spec for UX updates  
Audience: Product, Design, Frontend, Backend, QA

---

## 1) Purpose

This document is the single source of truth for UX and workflow implementation in StoryEngine vNext. It is self-contained and designed to be used without any other planning or audit documents.

It defines:
- What must be preserved (already-shipped workflow behavior)
- What should be improved (UI/UX quality and consistency)
- What is explicitly deferred (to avoid identity-plumbing or governance regressions)
- The order of implementation and acceptance criteria

---

## 2) Product Context

StoryEngine vNext is an internal marketing/revops content operations platform that transforms call intelligence into governed publishable assets.

Primary user goals:
- Find and generate reusable customer-proof content
- Move content through approval and publish workflow safely
- Monitor what is draft/review/approved/published
- Reuse quote assets and taxonomy-driven discovery

Primary risk to avoid:
- Any UX update that regresses lifecycle/governance semantics or policy-aware publish behavior

---

## 3) Canonical Workflow Contract (Must Not Change During UX Work)

## 3.1 Lifecycle stages

The only lifecycle stages for stories and landing pages are:
- `DRAFT`
- `IN_REVIEW`
- `APPROVED`
- `PUBLISHED`

Rules:
- Do not introduce alternate stage labels in UI filters/badges/chips.
- Do not reintroduce legacy stage systems.
- Rejected approvals are request-history status, not lifecycle stage.

## 3.2 Approval request statuses

Approval request status values:
- `PENDING`
- `APPROVED`
- `REJECTED`

Rules:
- Request status views and lifecycle stage views are related but not identical.
- Request history may show rejected requests while lifecycle still shows `DRAFT`.

## 3.3 Approval policy values

Org-level policy values:
- `ALL_REQUIRED`
- `ANON_NO_APPROVAL`
- `NAMED_NO_APPROVAL`
- `ALL_NO_APPROVAL`

Rules:
- Governance UI must map exactly to these options.
- Do not replace with old booleans/toggles that lose semantics.

## 3.4 Publish action behavior

Publish remains a single primary action with policy-aware outcome:
- If policy requires approval: create approval request (`PENDING`)
- If policy does not require approval: publish directly

Rules:
- Before-action UX must communicate likely outcome.
- After-action UX must confirm what actually happened.

## 3.5 Queue surfaces

The following queue surfaces are required and must remain discoverable:
- `My Queue`
- `Content Queue`
- `Publish Approvals`
- `My Requests` (request history drill-down)

Rules:
- Navigation updates must not hide these routes.
- Stage labels and counts must remain consistent across queue pages.

## 3.6 Story Library search modes

Story Library supports:
- `Keyword Search`
- `Semantic Search`

Rules:
- Keep search mode control visible.
- Preserve semantic fallback behavior when semantic ranking yields no results.

## 3.7 Slack approvals scope (current phase)

Implemented:
- Slack webhook notifications for approval requested / approval decision

Deferred:
- Interactive approve/reject directly in Slack messages

Rules:
- Do not present interactive Slack approval as available.

---

## 4) Information Architecture (Target)

## 4.1 Primary navigation groups

Core routes (top-level priority):
- Home
- Accounts
- Stories
- Quotes
- Taxonomy
- My Queue
- Content Queue
- Pages
- Analytics

Secondary/tools:
- Chat
- Automations
- Writebacks
- Workspaces

Admin:
- Permissions
- Roles
- Story Context
- Audit Logs
- Operations
- Security
- Governance
- Approvals
- Data Quality
- AI Usage
- Setup
- Integrations
- Billing (owner)

Constraints:
- IA cleanup is allowed, but route discoverability for queue workflow is mandatory.
- Grouping can change, route visibility cannot regress for required roles.

---

## 5) UX Quality Standards

## 5.1 Design system standards

Use consistent tokens and component variants for:
- Color semantics (success/warning/danger/info)
- Spacing scale
- Typography scale
- Radius/shadow scale

Button hierarchy:
- Primary: single dominant action per region
- Secondary: supporting actions
- Tertiary: low-emphasis actions
- Destructive: explicit danger style with confirmation patterns
- Icon-only buttons: tooltips and accessible labels required

## 5.2 Table standards

All data tables should align on:
- Header contrast and typography
- Row hover/focus behavior
- Actions column alignment and density
- Pagination pattern
- Empty/loading/error states

## 5.3 State handling standards

Every data view must include:
- Loading skeleton state
- Empty state with clear next action
- Error state with recovery instruction
- Polling/refresh feedback where applicable

## 5.4 Interaction standards

Required interactions:
- Hover for interactive elements
- `:focus-visible` keyboard focus ring
- Disabled state clarity
- Permission-denied messaging that explains why

---

## 6) Page-Level Requirements

## 6.1 Home

Goals:
- Show role-relevant summary and next actions
- Reduce cognitive load and improve action clarity

Requirements:
- Greeting and role/persona context are readable and intentional
- Recommended actions are clickable and actionable
- KPI cards use current API fields and meaningful labels
- Risk/health messaging uses consistent alert pattern

Do not break:
- Existing role-aware data contracts
- Queue-related calls to action

## 6.2 Accounts index and detail

Goals:
- Faster navigation to account context and story actions

Requirements:
- Row/card action density reduced using overflow patterns
- Clear primary navigation into detail views
- Detail pages support predictable section navigation (tabs or anchors)

Do not break:
- Generate Story entry points
- Permission enforcement for restricted users

## 6.3 Story Library

Goals:
- High-signal browsing with scalable actions and clear lifecycle status

Requirements:
- Status filter and badges use 4-stage lifecycle vocabulary
- Search mode selector for keyword/semantic remains visible
- Card action overload reduced (visible primary + overflow)
- Table/card views maintain parity for key actions

Do not break:
- Semantic mode request parameter and backend behavior
- Lifecycle status labels and filtering

## 6.4 Dashboard Pages

Goals:
- Clear lifecycle and action pathways for landing pages

Requirements:
- Lifecycle badges align with story lifecycle semantics
- Filter controls and table readability improved
- Bulk or grouped actions can be added if they do not bypass governance

Do not break:
- Policy-aware publish behavior
- Approval queue visibility

## 6.5 Landing Page Editor and Publish UX

Goals:
- Safer and clearer publishing flow

Requirements:
- Publish modal and controls explain policy-dependent outcome
- Scrub/PII preview remains visible and understandable before publish
- Success/error messages explicitly indicate direct publish vs queued approval

Do not break:
- Approval policy evaluator path
- Approval request creation behavior
- Existing governance checks

## 6.6 My Queue / Content Queue / Approvals

Goals:
- Make next actions and request states obvious for creators and approvers

Requirements:
- My Queue buckets: Draft, In Review, Approved, Published (recent)
- Content Queue supports cross-asset lifecycle browsing
- Approvals queue supports clear review actions and filtering
- Request history includes status and notes visibility

Do not break:
- Polling refresh
- Asset-type mixing in unified queue views

## 6.7 Quotes and Taxonomy

Goals:
- Make derived content assets discoverable and reusable

Requirements:
- Quote list interactions are clear (copy, source, promote/demote, star)
- Taxonomy browsing is navigable and count-aware
- Permissions and obfuscation modes remain respected in source navigation

Do not break:
- Attribution display mode constraints
- Source-view permission boundaries

## 6.8 Chat

Goals:
- Improve empty-state guidance and account-selection discoverability

Requirements:
- Prominent account context controls
- Better suggested starter prompts
- Clear capability framing

Do not break:
- Account scoping semantics

## 6.9 Admin areas

Goals:
- Reduce complexity and improve scanability without changing policy semantics

Requirements:
- Permissions/roles readability improvements
- Approvals clarity improvements
- Security/governance summary clarity
- Operations and audit views readability and filtering

Do not break:
- Existing permission gates
- Existing policy contract behavior

---

## 7) Accessibility Requirements

Mandatory baseline:
- Contrast compliance (WCAG AA)
- Keyboard navigation for all major flows
- Focus visibility on interactive controls
- ARIA labels on icon-only controls
- Meaningful status announcements for async updates
- Minimum touch target sizing for interactive elements

Queue and publish specific:
- Approval state changes should be perceivable for keyboard/screen-reader users
- Publish outcome messaging must not be color-only

---

## 8) Telemetry and UX Validation

Recommended instrumentation:
- Story Library search mode usage (`keyword` vs `semantic`)
- Queue page adoption and action completion rates
- Publish attempts split by direct-publish vs queued-for-approval
- Approval turnaround time
- Empty-state CTA conversion rates

Validation checkpoints:
- No increase in failed publish attempts due to unclear UX
- No drop in queue discoverability after nav changes
- No mismatch between visible status labels and backend contract values

---

## 9) Implementation Guardrails

These are hard guardrails for all UX work:

1. Preserve lifecycle vocabulary exactly.
2. Preserve queue route discoverability.
3. Preserve policy-aware publish outcome behavior.
4. Preserve semantic search mode control and behavior.
5. Preserve Slack scope as notification-only in this phase.
6. Preserve permission and obfuscation boundaries for transcript/quote source views.
7. Do not introduce dual status systems.

---

## 10) Explicitly Deferred Scope

Deferred from current UX execution:
- Interactive Slack approve/reject actions
- Any identity mapping/plumbing needed to securely authorize Slack actors
- Any migration/backfill workflows tied to legacy deployment environments

---

## 11) Execution Sequence

## Phase A: Contract-safe UX pass
- Align all lifecycle labels and filters
- Ensure nav preserves required queue surfaces
- Ensure publish UX text reflects policy-aware outcomes

## Phase B: High-impact flow usability
- Story Library action density and search-mode clarity
- Queue page clarity (creator + approver)
- Dashboard Pages lifecycle visual parity

## Phase C: System consistency
- Tokens, tables, buttons, empty states, loading states, interaction states

## Phase D: Admin and advanced polish
- Permissions/roles clarity
- Security/governance scanability
- Operations/audit readability

## Phase E: Accessibility completion
- Contrast, focus, keyboard, ARIA, touch target remediation

---

## 12) Definition of Done

This specification is considered successfully implemented when all criteria below are true:

1. All lifecycle UI surfaces use only `DRAFT/IN_REVIEW/APPROVED/PUBLISHED`.
2. `My Queue`, `Content Queue`, and `Publish Approvals` are discoverable for intended roles.
3. Story Library supports both keyword and semantic modes in UX and backend behavior.
4. Publish UX makes policy outcome clear before and after action.
5. Slack approval docs and UI language do not imply interactive in-message approval.
6. No governance or permission behavior regresses during visual refactors.
7. Accessibility baseline passes for key flows (stories, queues, publish, approvals).
8. Build and targeted test suites remain green after UX changes.

---

## 13) Summary

This document replaces fragmented guidance with one execution-safe plan:
- Preserve shipped workflow contracts
- Improve UX quality and consistency
- Avoid identity-plumbing scope traps
- Deliver measurable usability improvements without feature regressions

