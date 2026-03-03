# Dependency Vulnerability Triage Policy

This policy governs how high/critical dependency vulnerabilities are handled for StoryEngine.

## Enforcement

- CI runs `npm run security:deps` on every PR.
- The check fails if any unresolved `high` or `critical` vulnerability is present in:
  - root production dependencies (`npm audit --omit=dev`)
  - frontend production dependencies (`npm --prefix frontend audit --omit=dev`)
- Blocking is intentional. PRs do not merge until findings are remediated or explicitly triaged.

## Triage File

- Allowlisted exceptions live in:
  - `docs/security/dependency-audit-allowlist.json`
- Structure:
  - top-level scope (`root` or `frontend`)
  - package key
  - required metadata:
    - `reason`: concrete mitigation + why immediate upgrade is blocked
    - `expires_at`: ISO date when exception automatically expires

## Triage Rules

- Only transitive or blocked-upstream issues may be triaged.
- Direct dependencies with available safe upgrades must be upgraded, not triaged.
- Each triage entry must include:
  - owner (tracked in PR/release note),
  - mitigation in place,
  - removal plan before `expires_at`.
- Expired triage entries are treated as unresolved and fail CI.

## Review Cadence

- Review allowlist entries weekly.
- Remove entries immediately after dependency remediation lands.
- Record any new triage entry in release evidence with rollback notes.
