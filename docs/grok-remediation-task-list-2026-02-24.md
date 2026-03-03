# Grok Audit Remediation Task List

Date: 2026-02-24  
Source: `/Users/jacobnikolau/Downloads/grok_report.pdf`  
Scope: All findings in Grok architecture, functionality, UI, accessibility, security, performance, and operational recommendations.

## Prioritization

- `P0` = production risk / data safety / security / critical reliability
- `P1` = major UX/reliability/perf improvements
- `P2` = polish and long-tail operational hardening

## Workstream A: Reliability And Queue Resilience

- [x] `A1 (P0)` Standardize call-processing enqueue policy across all producers (webhooks + sync + transcript fetch + backfill).
  - Acceptance: single shared policy used everywhere; no direct ad hoc options.
- [x] `A2 (P0)` Add enqueue retry-on-transient-failure with structured logging and Sentry context.
  - Acceptance: retries verified by unit tests; final failure includes source + callId context.
- [x] `A3 (P0)` Add webhook enqueue failure visibility (metrics + operator-readable diagnostics).
  - Acceptance: dashboard/admin metrics can show enqueue failure counts.
- [x] `A4 (P0)` Define dead-letter handling SOP for failed processing jobs.
  - Acceptance: documented replay and escalation runbook in docs.
- [x] `A5 (P1)` Add automatic replay policy for selected dead-letter classes.
  - Acceptance: replay logic is bounded/idempotent and audit-logged.
- [x] `A6 (P1)` Expand chaos tests for queue and Redis disruption scenarios.
  - Acceptance: chaos suite includes enqueue fail/recover and worker restart behavior.

## Workstream B: AI Reliability And Cost Controls

- [x] `B1 (P0)` Add AI provider failover policy for transcript/story flows.
  - Acceptance: fallback path tested when primary provider fails.
- [x] `B2 (P0)` Add circuit breaker and cooldown around repeated provider failures.
  - Acceptance: repeated upstream failures do not cascade to queue backlog.
- [x] `B3 (P0)` Ensure usage/cost writes are idempotent for failed/retried jobs.
  - Acceptance: duplicate retries cannot double-charge usage.
- [x] `B4 (P1)` Add configurable max retry budget for AI-heavy jobs.
  - Acceptance: global and org-level limits enforceable.
- [x] `B5 (P1)` Add spend anomaly alerts (org + platform thresholds).
  - Acceptance: alerts generated for abnormal cost spikes.

## Workstream C: Ingest/Transcript/Entity Robustness

- [x] `C1 (P0)` Add explicit failure fallbacks when entity resolution returns unresolved.
  - Acceptance: unresolved queue/manual follow-up path has automation hooks.
- [x] `C2 (P0)` Expand ingest tests for large transcripts and edge payloads.
  - Acceptance: high-size transcript tests pass and are gated in CI.
- [x] `C3 (P1)` Add stronger input validation for publish/scrub completeness.
  - Acceptance: unsafe/incomplete publish requests are blocked with actionable errors.
- [x] `C4 (P1)` Add replay-safe guards for webhook duplicate events.
  - Acceptance: idempotency verified for duplicate webhook deliveries.

## Workstream D: Accessibility (WCAG 2.1 AA)

- [ ] `D1 (P0)` Ensure `lang` and semantic landmarks are present globally.
  - Acceptance: root document has `lang`; nav/main/headers are semantically correct.
- [ ] `D2 (P0)` Add route-change focus management and focus traps where needed.
  - Acceptance: keyboard users land on page heading/main content on navigation.
- [ ] `D3 (P0)` Fix SVG/button ARIA labeling across nav and controls.
  - Acceptance: no unlabeled interactive controls in axe scans.
- [ ] `D4 (P1)` Add live regions for async status (story generation, toasts, job progress).
  - Acceptance: screen readers announce state changes.
- [ ] `D5 (P1)` Validate heading hierarchy and form labels across admin pages.
  - Acceptance: no heading-level skips and no unlabeled form fields.
- [ ] `D6 (P1)` Perform contrast audit and add high-contrast mode where needed.
  - Acceptance: WCAG AA contrast thresholds pass.
- [ ] `D7 (P1)` Add automated a11y testing (axe in Vitest/playwright path).
  - Acceptance: critical a11y regressions fail CI.

## Workstream E: UI/UX Improvements

- [x] `E1 (P1)` Add global search (accounts/stories/pages/admin destinations).
  - Acceptance: keyboard-accessible command/search palette returns scoped results.
- [x] `E2 (P1)` Improve long-list usability (pagination/virtualization/filtering).
  - Acceptance: large tables remain responsive; p95 render under target.
- [x] `E3 (P1)` Improve mobile nav close/focus behavior on route change.
  - Acceptance: no stuck overlays; focus and scroll behavior stable.
- [x] `E4 (P2)` Establish shared frontend design tokens/component patterns.
  - Acceptance: repeated ad hoc styles reduced; consistency score improved.
- [x] `E5 (P2)` Optional theming pass (light/dark/high-contrast support).
  - Acceptance: theme switch with accessible defaults.

## Workstream I: Sales Adoption UX Fast Path

- [ ] `I1 (P1)` Add a global `New Story` entry point with one-click account/opportunity picker.
  - Acceptance: story creation can start from any page in one click; no dependency on navigating to Account Detail first.
- [ ] `I2 (P1)` Add deal-stage presets mapped to seller workflow (`Discovery`, `Evaluation`, `Business Case`, `Negotiation`, `Expansion`).
  - Acceptance: selecting a stage auto-applies recommended story type, format, length, and outline defaults.
- [ ] `I3 (P1)` Replace the current advanced-first modal with a guided quick flow (`Goal`, `Audience`, `Anonymization`) and an optional `Advanced` panel.
  - Acceptance: first-time sellers can generate a valid story with <=3 inputs; advanced controls stay available but hidden by default.
- [ ] `I4 (P1)` Add explicit `Anonymous` vs `Named` generation mode with clear guardrails and copy.
  - Acceptance: sellers can intentionally switch modes; named mode is blocked when governance requires anonymization review.
- [ ] `I5 (P1)` Add a `Generate + Package` action that outputs: polished story view, email-ready summary, one-page PDF, and share link.
  - Acceptance: seller can produce a deal-ready package in one flow without manual copy/paste steps.
- [ ] `I6 (P1)` Redesign story list cards for readability and speed: rendered markdown preview, status badge, and one-click actions (`Share`, `Copy`, `Create Page`, `Export`).
  - Acceptance: no raw markdown blocks on cards; top actions are visible without opening editor flows.
- [ ] `I7 (P1)` Add CRM-first sharing actions (`Copy for CRM note`, `Push to account/opportunity note` where integrations are available).
  - Acceptance: seller can move a generated story into CRM in <=2 clicks.
- [ ] `I8 (P1)` Add rapid iteration controls (`Regenerate same`, `Regenerate with tweak`, `Shorter`, `More executive`, `More proof`).
  - Acceptance: seller can iterate without re-entering the full form.
- [ ] `I9 (P1)` Add stage-matched packaging templates for both anonymous and named output (e.g., `Executive Recap`, `Champion Forward`, `ROI Proof`).
  - Acceptance: generated package clearly matches selected stage and audience framing.
- [ ] `I10 (P1)` Add quote/source confidence chips and a `Safe to Share` indicator.
  - Acceptance: sellers can quickly trust output quality and identify any content that still needs review.
- [ ] `I11 (P1)` Add first-run seller onboarding focused on the 60-second first story and first share.
  - Acceptance: new sellers have a guided path from login to generated+shared story without documentation.
- [ ] `I12 (P1)` Add adoption telemetry for seller UX: time-to-first-story, time-to-share, stage-preset usage, anonymous-vs-named usage, and drop-off points.
  - Acceptance: weekly funnel metrics identify where story creation/sharing friction remains.

## Workstream F: Security Hardening

- [x] `F1 (P0)` Strengthen PII masking beyond regex-only patterns.
  - Acceptance: edge-case corpus (phone/email/names/IDs) masked reliably.
- [x] `F2 (P0)` Review CSRF exposure for browser-initiated stateful routes.
  - Acceptance: anti-CSRF protections in place where applicable.
- [x] `F3 (P1)` Harden webhook validation + replay windows.
  - Acceptance: stale/replayed signatures rejected where provider supports it.
- [x] `F4 (P1)` Add dependency scanning and enforcement in CI.
  - Acceptance: vulnerable dependencies block merge until triaged.

## Workstream G: Performance And Scale

- [x] `G1 (P1)` Add RAG query caching and index-query optimization.
  - Acceptance: p95 RAG latency target met without response-quality regression.
- [x] `G2 (P1)` Add load tests with pass/fail budgets in CI.
  - Acceptance: key endpoints have documented SLO thresholds.
- [x] `G3 (P1)` Optimize heavy middleware stacks on admin routes.
  - Acceptance: measured reduction in latency overhead.
- [x] `G4 (P2)` Add cost/performance controls for vector storage growth.
  - Acceptance: retention/tiering policy documented and enforced.

## Workstream H: Docs And Operational Readiness

- [x] `H1 (P1)` Update README with frontend setup/dev/deployment paths.
  - Acceptance: clean-start setup works from docs only.
- [x] `H2 (P1)` Add operator runbooks for queue failures, replay, and incident flow.
  - Acceptance: on-call can execute remediation from docs.
- [x] `H3 (P2)` Add demo/staging deployment playbook and smoke checklist.
  - Acceptance: reproducible demo deployment with health verification.

## Execution Plan

- Sprint 1: `A1-A3`, `B1-B3`, `D1-D3`, `F1-F2`
- Sprint 2: `A4-A5`, `C1-C3`, `D4-D6`, `E1-E3`
- Sprint 3: `A6`, `B4-B5`, `F3-F4`, `G1-G3`
- Sprint 4: `C4`, `E4-E5`, `G4`, `H1-H3`
- Sprint 5: `I1-I4` (fast story start + stage-guided defaults)
- Sprint 6: `I5-I9` (packaging, sharing, and fast iteration)
- Sprint 7: `I10-I12` + `D1-D7` (trust signals, onboarding, telemetry, accessibility completion)

## Sales UX Success Metrics

- `Median time to first story`: <= 60 seconds for first-time seller flow
- `Median time to package + share`: <= 2 minutes from generation start
- `Stage preset usage`: >= 70% of new story starts use a stage preset
- `Story-to-share conversion`: >= 65% of generated stories are shared/exported within 24h
- `Anonymous/Named clarity`: < 5% mode-switch reversals due to confusion
- `Weekly active sellers using story flow`: +30% vs pre-I-series baseline

## Current Status

- `A1` Completed in this branch
- `A2` Completed in this branch
- `A3` Completed in this branch
- `A4` Completed in this branch
- `A5` Completed in this branch
- `A6` Completed in this branch
- `B1-B5` Completed in this branch
- `C1-C4` Completed in this branch
- `E1-E5` Completed in this branch
- `F1-F4` Completed in this branch
- `G1-G4` Completed in this branch
- `H1-H3` Completed in this branch
- `D1-D7` Deferred to end of queue per active instruction
- `I1-I12` Pending (new high-impact sales adoption track)
