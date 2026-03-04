# StoryEngine Documentation

**Last updated: March 4, 2026**

Index of documentation for the StoryEngine webapp. Docs are organized by purpose.

---

## Core Architecture & Design

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, data flow, design decisions, security |
| [AI_DEVELOPMENT_GUIDE.md](./AI_DEVELOPMENT_GUIDE.md) | Module map, ownership, "where to change X" for AI features |
| [frontend-design-system.md](./frontend-design-system.md) | Frontend design tokens and patterns |

---

## Feature & Roadmap Status

| Document | Description |
|----------|-------------|
| [MISSING_FEATURES.md](./MISSING_FEATURES.md) | Feature status — implemented vs. still missing |
| [StoryEngine-Consolidated-Roadmap.md](./StoryEngine-Consolidated-Roadmap.md) | Canonical roadmap (T01–T73), execution status |
| [MERGE-DEV-INTEGRATION-ROADMAP.md](../MERGE-DEV-INTEGRATION-ROADMAP.md) | Merge.dev integration plan (Settings, Setup Wizard) |

---

## Production & Operations

| Document | Description |
|----------|-------------|
| [PRODUCTION-READINESS-TASKS.md](./PRODUCTION-READINESS-TASKS.md) | Deployment checklist, CI, build, smoke tests |
| [operator-runbook.md](./operator-runbook.md) | Day-to-day operations, troubleshooting |
| [demo-staging-playbook.md](./demo-staging-playbook.md) | Staging/demo rollout |
| [environment-promotion-controls.md](./environment-promotion-controls.md) | Env promotion and controls |
| [launch-readiness-checklist.md](./launch-readiness-checklist.md) | Pre-launch checklist |

---

## Runbooks & Incident Response

| Document | Description |
|----------|-------------|
| [call-processing-dead-letter-runbook.md](./call-processing-dead-letter-runbook.md) | Dead-letter queue replay and recovery |

---

## Data & Schema

| Document | Description |
|----------|-------------|
| [prisma-schema-ownership.md](./prisma-schema-ownership.md) | Prisma model ownership, migration conventions |
| [prisma-enum-migration-plan.md](./prisma-enum-migration-plan.md) | Enum migration strategy |
| [gong-ingest-payload-contract.md](./gong-ingest-payload-contract.md) | Gong webhook payload contract |

---

## Security

| Document | Description |
|----------|-------------|
| [security/csrf-protection-matrix-2026-03-03.md](./security/csrf-protection-matrix-2026-03-03.md) | CSRF protected/unprotected paths |
| [security/dependency-triage-policy.md](./security/dependency-triage-policy.md) | npm audit triage policy |

---

## Performance & QA

| Document | Description |
|----------|-------------|
| [performance-and-scale.md](./performance-and-scale.md) | Performance considerations |
| [perf/load-profile-thresholds.md](./perf/load-profile-thresholds.md) | Load test thresholds |
| [rag-quality-guardrails.md](./rag-quality-guardrails.md) | RAG quality and grounding checks |
| [qa/](./qa/) | QA personas, bug discovery, accessibility evidence |

---

## UX Audits & Planning

| Document | Description |
|----------|-------------|
| [story-creation-ux-audit-2026-02-24.md](./story-creation-ux-audit-2026-02-24.md) | Story creation UX audit |
| [StoryEngine_UI_UX_Audit.md](./StoryEngine_UI_UX_Audit.md) | UI/UX audit (earlier) |
| [StoryEngine_UI_UX_Audit2.md](./StoryEngine_UI_UX_Audit2.md) | UI/UX audit (follow-up) |
| [sales-adoption-fast-path.md](./sales-adoption-fast-path.md) | Sales adoption guidance |

---

## Release Policy & Evidence

| Document | Description |
|----------|-------------|
| [release-policy/](./release-policy/) | Release freeze, phase blocks, security/reliability gates |
| [release-evidence/](./release-evidence/) | Release evidence snapshots |

---

## Other

| Document | Description |
|----------|-------------|
| [CODE_COMPLEXITY_EVALUATION.md](./CODE_COMPLEXITY_EVALUATION.md) | Code complexity assessment |
| [i18n-foundation.md](./i18n-foundation.md) | i18n groundwork |
| [grok-remediation-task-list-2026-02-24.md](./grok-remediation-task-list-2026-02-24.md) | Remediation task list (Feb 2026) |
