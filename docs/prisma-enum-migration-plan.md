# Prisma Enum Migration Plan (T11)

Date: 2026-03-03

## Goal
Replace closed-domain `String` fields in `prisma/schema.prisma` with explicit Prisma enums, while preserving current API contracts and enabling safe staged rollout.

## Criteria Used
- Closed domain: field values are finite and enforced in code paths today.
- Open domain: field values are user/content driven or intentionally extensible.
- Mixed domain: appears finite but currently has inconsistent casing or cross-domain overload that needs normalization policy first.

## Closed-Domain Inventory and Enum Mapping

| Model.field | Current | Observed values (default + code paths) | Proposed enum | Priority | Notes |
| --- | --- | --- | --- | --- | --- |
| `AuditLog.severity` | `String` | `INFO`, `WARN`, `CRITICAL` | `AuditSeverity` | P1 | Candidate after incident/approval/integration pass. |
| `Incident.severity` | `String` | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` | `IncidentSeverity` | P0 | Route schema already enforces finite set. |
| `Incident.status` | `String` | `OPEN`, `MONITORING`, `RESOLVED` | `IncidentStatus` | P0 | Route schema already enforces finite set. |
| `IncidentUpdate.status` | `String?` | `OPEN`, `MONITORING`, `RESOLVED`, `null` | `IncidentStatus?` | P0 | Reuse incident enum. |
| `ApprovalRequest.requestType` | `String` | `CRM_WRITEBACK`, `DATA_DELETION`, `ACCOUNT_MERGE`, `LANDING_PAGE_PUBLISH`, `DATA_MERGE_CONFLICT` | `ApprovalRequestType` | P0 | Stable finite set from API + sync engine. |
| `ApprovalRequest.status` | `String` | `PENDING`, `APPROVED`, `REJECTED`, `COMPLETED`, `ROLLED_BACK` | `ApprovalRequestStatus` | P0 | `ROLLED_BACK` used in writeback rollback flow. |
| `IntegrationRun.runType` | `String` | `MANUAL`, `SCHEDULED`, `BACKFILL` | `IntegrationRunType` | P0 | Finite by orchestration code. |
| `IntegrationRun.status` | `String` | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `ERROR` | `IntegrationRunStatus` | P0 | Include `PENDING`/`ERROR` for compatibility. |
| `StoryQualityFeedback.feedbackType` | `String` | `CORRECTION`, `DISPUTE`, `MISSING_EVIDENCE`, `LINEAGE_FIX` | `StoryFeedbackType` | P0 | Route schema finite. |
| `StoryQualityFeedback.targetType` | `String` | `STORY`, `QUOTE`, `CLAIM` | `StoryFeedbackTargetType` | P0 | Route schema finite. |
| `StoryQualityFeedback.status` | `String` | `OPEN`, `ACCEPTED`, `REJECTED`, `APPLIED` | `StoryFeedbackStatus` | P0 | Route schema finite. |
| `ArtifactApprovalStep.approverScopeType` | `String` | `ROLE_PROFILE`, `TEAM`, `USER`, `GROUP`, `SELF` | `ApprovalScopeType` | P1 | Route schema finite. |
| `TeamApprovalAdminScope.teamKey` | `String` | `REVOPS`, `MARKETING`, `SALES`, `CS` | `WorkspaceTeam` (reuse) | P1 | Normalize legacy values before reuse. |
| `AccountMergeRun.status` | `String` | `COMPLETED`, `UNDONE` | `AccountMergeRunStatus` | P1 | Keep room for future terminal states later if needed. |
| `PublishedArtifactVersion.status` | `String` | `ACTIVE`, `ROLLED_BACK`, `SUPERSEDED` | `PublishedArtifactStatus` | P1 | Used by rollback + republish flows. |
| `AIUsageNotification.limitType` | `String` | `daily_tokens`, `monthly_tokens`, `daily_requests`, `monthly_requests`, `monthly_stories` | `AIUsageLimitType` | P0 | Canonicalize to snake_case before enum migration. |
| `OrgAISettings.defaultProvider` | `String?` | `OPENAI`, `ANTHROPIC`, `GOOGLE`, `null` | `AIProviderType?` (reuse) | P1 | Reuse existing enum after normalization. |
| `Story.aiProvider` | `String?` | `OPENAI`, `ANTHROPIC`, `GOOGLE`, `null` | `AIProviderType?` (reuse) | P1 | Backfill old aliases if present. |
| `AIUsageRecord.provider` | `String` | `OPENAI`, `ANTHROPIC`, `GOOGLE` | `AIProviderType` (reuse) | P1 | Reuse existing enum after normalization. |
| `ValidationSample.expectedFunnelStage` | `String` | `TOFU`, `MOFU`, `BOFU`, `POST_SALE`, `INTERNAL`, `VERTICAL` | `FunnelStage` (reuse) | P2 | Existing enum already present in schema. |

## Mixed/Open Fields Deferred (Intentional)

| Model.field | Reason deferred |
| --- | --- |
| `AuditLog.category`, `AuditLog.action`, `AuditLog.targetType` | Taxonomy still evolves; needs catalog + registry first. |
| `ApprovalRequest.targetType` | Mixed casing and cross-domain semantics (`account`, `landing_page`, `CALL`, `STORY`, etc.). Needs policy + contract update plan. |
| `StoryClaimLineage.claimType` | Not yet locked to finite taxonomy. |
| `HighValueQuote.metricType`, `HighValueQuote.metricValue` | Metric taxonomy not fixed. |
| `AutomationRule.metric`, `AutomationRule.operator`, `AutomationRule.eventType`, `AutomationRule.lastRunStatus` | Partly free-form / integration-defined. |
| `AIUsageRecord.model`, `Story.aiModel`, `OrgAISettings.defaultModel` | Model catalogs are intentionally dynamic. |

## T12 Backfill Scope (First Pass)

First migration scripts should normalize data for:
- incidents (`severity`, `status`, `incident_updates.status`)
- approval requests (`requestType`, `status`)
- integration runs (`runType`, `status`)
- AI usage notifications (`limitType`)

All normalization scripts must remain:
- dry-run by default
- idempotent (safe to rerun)
- explicit about each value mapping

## Next Steps
1. T12: run dry-run normalization scripts in staging snapshot and capture counts.
2. T12: apply normalization in staging, then production via controlled rollout.
3. T13+: switch schema fields to enums one domain at a time with contract tests.
