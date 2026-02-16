# Code Complexity Evaluation: StoryEngine

**Date:** 2026-02-16
**Overall Complexity Score: 8.2/10 (HIGH)**

## Executive Summary

StoryEngine is a production-grade, enterprise B2B SaaS platform that converts sales/customer call recordings into publishable, anonymized case studies using AI-powered analysis. The codebase demonstrates high architectural sophistication with mature backend patterns and enterprise-ready features.

---

## Scale at a Glance

| Metric | Value |
|--------|-------|
| Total Lines of Code | ~54,300 |
| Backend LOC | ~39,200 |
| Frontend LOC | ~7,700 |
| Test LOC | ~7,900 |
| Source Files | 141 |
| Database Models (Prisma) | 41 |
| API Route Files | 34 |
| Service Classes | 34 |
| Middleware Modules | 15 |
| Test Files | 35 |
| External Integrations | 12+ |
| Environment Variables | 23+ |
| Docker Services | 3 |
| BullMQ Job Queues | 4 |

---

## Technology Stack

- **Runtime:** Node.js 20 + TypeScript 5.6
- **Backend:** Express 4.21 with Prisma 5.22 ORM
- **Frontend:** React 18.3 + Vite 6.0
- **Database:** PostgreSQL 16 (41 models)
- **Vector DB:** Pinecone 3.0 for semantic search
- **Job Queue:** BullMQ 5.20 + Redis 7
- **AI Providers:** OpenAI GPT-4o, Anthropic Claude, Google Gemini (unified routing)
- **Auth/SSO:** WorkOS 7.0 (SAML, OAuth)
- **Billing:** Stripe 17.0 (metered + per-seat + prepaid credit system)
- **CRM:** Merge.dev unified API + Salesforce direct
- **Observability:** OpenTelemetry + Sentry 10.38 + Winston
- **Testing:** Vitest 4.0 + Supertest 7.2
- **Deployment:** Docker + docker-compose

---

## Complexity Breakdown by Layer

| Layer | Complexity | Notes |
|-------|-----------|-------|
| Backend Services | VERY HIGH | 34 service classes: AI orchestration, multi-provider billing, entity resolution, confidence calibration, transcript pipelines |
| Database Schema | VERY HIGH | 41 Prisma models, multi-tenant relationships, 1,069-line schema |
| API Routes | HIGH | 34 route modules spanning auth, billing, webhooks, admin, integrations |
| Async Job Processing | HIGH | 4 BullMQ queues with exponential backoff retries, scheduled cron jobs |
| Integration Ecosystem | VERY HIGH | 12+ external services with factory/adapter provider registry |
| Middleware | HIGH | 15 modules: auth, RBAC, billing gate, rate limiting, PII masking, audit logging |
| AI/ML Pipeline | HIGH | Chunking, tagging (60-topic taxonomy), embeddings, RAG search, story generation |
| Type System | HIGH | Full end-to-end TypeScript, 48+ API interfaces, taxonomy union types |
| Testing | MEDIUM | 35 test files covering critical backend paths, minimal frontend tests |
| Frontend | LOW-MEDIUM | 9 pages, local useState only, no state management library |
| Styling | LOW | Single 67KB CSS file, no framework |
| CI/CD | LOW | Docker only, no automated pipeline |
| i18n | NONE | English-only hardcoded strings |

---

## Core Business Pipeline

1. Call recordings ingested via webhooks (Merge.dev, Gong, Grain)
2. Transcripts fetched and split into configurable chunks
3. Each chunk tagged against 60-topic B2B sales taxonomy via GPT-4o
4. Embeddings indexed in Pinecone for semantic search
5. Story Builder generates markdown case studies from top-tagged chunks
6. Landing Page Editor allows editing with company name scrubbing (anonymization)
7. Published pages shared via `/s/:slug` with password protection and expiration
8. Analytics dashboard tracks usage, AI costs, and performance metrics

---

## Design Patterns

- **Factory** - Provider registry, middleware factories, route factories
- **Strategy** - Entity resolution (email -> fuzzy name -> manual), pricing models
- **Adapter** - Provider implementations normalizing heterogeneous APIs
- **Dependency Injection** - Services receive Prisma, queues, API clients via constructors
- **Observer/Event** - BullMQ job lifecycle events, webhook systems
- **Chain of Responsibility** - Middleware stack: Auth -> Billing -> Feature -> Business Logic
- **Repository** - Prisma ORM centralizes all data access

---

## Strengths

- Strong TypeScript adoption with strict typing end-to-end
- Well-organized service layer with clear separation of concerns
- Comprehensive middleware for cross-cutting concerns
- Sophisticated multi-provider AI orchestration with billing controls
- Solid test coverage for critical backend paths (35 test files)
- Enterprise-ready: multi-tenant, RBAC, audit logging, PII masking, AES-256-GCM encryption
- Robust observability (Sentry + OpenTelemetry + Winston)
- Extensible integration framework via factory/adapter patterns

## Weaknesses

- Frontend is comparatively thin with large page components (up to 1,536 LOC) and no custom hooks
- Single monolithic CSS file (67KB) with no styling framework
- No CI/CD pipeline - manual deployments only
- No i18n support
- No OpenAPI/Swagger documentation for external APIs
- Semi-monorepo without npm workspaces
- No frontend code splitting or lazy loading
- Some backend services exceed 600 LOC and could be decomposed

---

## Key Files Reference

| Component | Primary Files |
|-----------|--------------|
| Entry Point | `src/index.ts` (571 lines) |
| Database Schema | `prisma/schema.prisma` (1,069 lines) |
| AI Tagging | `src/services/ai-tagger.ts`, `src/services/tag-cache.ts`, `src/services/confidence-calibrator.ts` |
| Story Generation | `src/services/story-builder.ts` |
| RAG Search | `src/services/rag-engine.ts` |
| AI Routing | `src/services/ai-config.ts`, `src/services/ai-client.ts` |
| Entity Resolution | `src/services/entity-resolution.ts` |
| Transcript Pipeline | `src/services/transcript-processor.ts`, `src/services/transcript-fetcher.ts` |
| Billing | `src/middleware/billing.ts`, `src/services/pricing.ts` |
| Auth/Permissions | `src/middleware/auth.ts`, `src/middleware/permissions.ts` |
| Integration Registry | `src/integrations/provider-registry.ts` |
| Largest Frontend Page | `frontend/src/pages/TranscriptViewerPage.tsx` (1,536 lines) |
