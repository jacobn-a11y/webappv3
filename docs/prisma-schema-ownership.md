# Prisma Schema Ownership

This document defines ownership and migration operating rules for `prisma/schema.prisma`.

## Model ownership map

| Domain | Prisma models (representative) | Primary owner |
| --- | --- | --- |
| Identity & tenant core | `Organization`, `User`, `OrgSettings`, `UserPermission` | Platform Backend |
| CRM account graph | `Account`, `AccountDomain`, `Contact`, `UserAccountAccess` | Platform Backend |
| Story pipeline | `Story`, `HighValueQuote` | Product Backend |
| Landing/public experience | `LandingPage`, `LandingPageEdit`, `PublishedArtifactVersion` | Product Backend |
| Ingestion & integrations | `LinkedAccount`, `Call`, `CallParticipant`, `CallTag`, `ChunkTag`, `IntegrationRun` | Integrations Backend |
| Governance & enterprise controls | `AuditLog`, `ArtifactGovernancePolicy`, `ArtifactApprovalStep`, `PublishedArtifactVersion`, `ApprovalRequest`, `ApprovalGroup`, `SupportImpersonationSession` (security/data governance as `Json` in `OrgSettings`) | Platform Backend |
| Billing, notifications, operations | `Subscription`, `UsageRecord`, `AiUsageRecord`, `AiUsageLimit`, `AiUsageNotification`, `Incident`, `IncidentUpdate`, `Notification` | Platform Backend |

Escalation rule:
- If ownership is unclear, default to `Platform Backend` and add an explicit owner assignment in the PR before merge.

## Migration naming convention

Use timestamped folder names under `prisma/migrations`:
- `YYYYMMDDHHMMSS_<short_snake_case_description>`
- Example: `20260303103000_add_incident_status_enum`

Naming requirements:
- Describe schema intent, not ticket IDs.
- One migration directory per logical change.
- If a migration requires data normalization/backfill, include a companion script under `scripts/migrations/`.

## Backfill requirements

Before introducing strict constraints (enum, `NOT NULL`, unique indexes):
- Define and review legacy value mappings in docs (see `docs/prisma-enum-migration-plan.md`).
- Provide an idempotent migration script with:
  - dry-run mode
  - apply mode
  - clear summary output
- Run backfill scripts in staging before production migration deploy.

Required release evidence per backfill:
- command(s) run
- row counts changed
- environment and timestamp
- operator identity

## Rollback procedure

Rollback strategy is forward-fix first; destructive down-migrations are not used by default.

When a migration causes issues:
1. Stop further deploys.
2. Capture `prisma migrate status` and DB backup.
3. If data-only issue, run corrective backfill script.
4. If schema issue, ship follow-up migration to restore compatibility.
5. Record incident + remediation in release evidence docs.

Operational checkpoints:
- Always take a pre-migration backup for production.
- Keep migration safety checks and migration smoke tests passing in CI.
- Attach rollback notes in each roadmap block release note.
