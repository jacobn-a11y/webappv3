# Release Freeze Policy - 2026-02-23 (Phase 0)

## Purpose

Create and enforce a release freeze for launch hardening only.

## Release Branch

- Branch name: `release/2026-02-23`
- Cut from: `origin/main`
- Freeze start: 2026-02-23
- Freeze end: until explicit release manager sign-off

## Scope (Allowed Changes)

Only `launch-hardening` pull requests may merge during this freeze:

1. P0/P1 bug fixes directly tied to launch-readiness gates.
2. Security, reliability, and migration-safety fixes.
3. Release/runbook/checklist corrections needed for safe launch.
4. CI/CD and deployment hardening that reduces launch risk.

## Out of Scope (Blocked During Freeze)

1. Net-new product features or UX expansions.
2. Refactors not required for launch risk reduction.
3. Non-essential dependency churn.
4. Schema or API changes without a launch-blocker justification.

## Merge Policy During Freeze

1. PR title must start with `[launch-hardening]`.
2. PR body must include:
   - launch risk addressed
   - rollback plan
   - test evidence
3. Minimum approvals:
   - Release Manager (required)
   - On-call Engineer (required)
4. Merge target for release work: `release/2026-02-23`.

## Owners and Roles

| Role | Owner | Responsibility |
| --- | --- | --- |
| Release Manager | Jacob Nikolau (`@jacobn-a11y`) | Approves scope, enforces freeze, final go/no-go decision |
| Web/API Hardening Owner | Jacob Nikolau (`@jacobn-a11y`) | API/app stability, reliability fixes, release gates |
| Frontend Hardening Owner | Jacob Nikolau (`@jacobn-a11y`) | UI regressions, smoke checks, build stability |
| CI/CD Hardening Owner | Jacob Nikolau (`@jacobn-a11y`) | Pipeline/deploy hardening and rollback validation |

## On-Call Engineer

- Primary on-call: Jacob Nikolau (`@jacobn-a11y`)
- Escalation: open P0 issue and page release manager directly.

## Exit Criteria for Phase 0

1. `release/2026-02-23` exists and is used as release hardening target.
2. Freeze scope is documented and shared with contributors.
3. Owners and on-call engineer are explicitly assigned.
