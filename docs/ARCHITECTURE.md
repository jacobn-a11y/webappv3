# StoryEngine — System Architecture

## Overview

StoryEngine consolidates call recordings from 10+ providers (Gong, Chorus, Zoom,
Fireflies, etc.) and Google Meet into a unified **Account Journey** view. It syncs
with Salesforce/HubSpot to resolve inconsistent naming and extracts high-value
customer stories tagged against a B2B sales-funnel taxonomy.

---

## 1. System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        RECORDING SOURCES                                │
│  Gong · Chorus · Zoom · Google Meet · Fireflies · Teams · Dialpad ...  │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         MERGE.DEV UNIFIED API                           │
│                                                                          │
│  ┌─────────────────────┐    ┌─────────────────────┐                     │
│  │  Video/Conferencing  │    │     CRM (HRIS)       │                    │
│  │  Unified Model       │    │  Salesforce/HubSpot  │                    │
│  └─────────┬───────────┘    └──────────┬───────────┘                    │
└────────────┼───────────────────────────┼────────────────────────────────┘
             │  Webhooks                 │  Webhooks + Polling
             ▼                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                      STORYENGINE BACKEND (Node.js / Express)            │
│                                                                          │
│  ┌──────────────┐   ┌──────────────────┐   ┌────────────────────────┐   │
│  │   Webhook     │   │  Entity          │   │  PII Masking           │   │
│  │   Receiver    │──▶│  Resolution      │   │  Middleware             │   │
│  │  (Merge.dev)  │   │  (Email Domain + │   │  (Pre-LLM Redaction)   │   │
│  └──────────────┘   │   Fuzzy Match)   │   └───────────┬────────────┘   │
│                      └────────┬─────────┘               │                │
│                               │                         │                │
│                      Resolved │ Account_ID              │                │
│                               ▼                         ▼                │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │                    AI PROCESSING PIPELINE (BullMQ)               │    │
│  │                                                                  │    │
│  │  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────┐  │    │
│  │  │  Transcript   │  │  Taxonomy      │  │  Embedding           │  │    │
│  │  │  Chunking     │──▶  Tagger        │──▶  Generator           │  │    │
│  │  │              │  │  (LLM)         │  │  (text-embedding-3)  │  │    │
│  │  └──────────────┘  └───────────────┘  └──────────┬───────────┘  │    │
│  └──────────────────────────────────────────────────┼──────────────┘    │
│                                                      │                   │
│  ┌──────────────────┐  ┌─────────────────┐          │                   │
│  │  Story Builder    │  │  RAG Endpoint    │◀─────────┤                   │
│  │  (Prompt Chain)   │  │  /api/rag/query  │          │                   │
│  └────────┬─────────┘  └─────────────────┘          │                   │
│           │                                          │                   │
│           ▼                                          ▼                   │
│  ┌──────────────┐                          ┌─────────────────┐          │
│  │  Markdown     │                          │  Pinecone        │          │
│  │  Output       │                          │  Vector DB       │          │
│  └──────────────┘                          └─────────────────┘          │
│                                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │                    MIDDLEWARE LAYER                                 │  │
│  │  WorkOS Auth │ Stripe Billing │ Free Trial Gate │ Rate Limiter     │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
             │                                          │
             ▼                                          ▼
┌──────────────────────┐                    ┌──────────────────────┐
│   PostgreSQL (Prisma) │                    │  Third-Party          │
│                        │                    │  Chatbot Connector    │
│  Accounts · Contacts   │                    │  (via RAG API)        │
│  Calls · Transcripts   │                    └──────────────────────┘
│  Tags · SF Events      │
│  Organizations · Users │
└──────────────────────┘
```

## 2. Data Flow — Recording to Story

```
1. INGEST    Zoom/Gong creates a recording
                 ↓
2. WEBHOOK   Merge.dev fires POST /api/webhooks/merge
                 ↓
3. RESOLVE   Entity Resolution matches call participants
             to CRM Account_ID via email domain + fuzzy name
                 ↓
4. STORE     Call + Transcript persisted to PostgreSQL
                 ↓
5. MASK      PII Redactor strips emails, phone numbers,
             SSNs before any LLM call
                 ↓
6. TAG       LLM classifies each transcript chunk against
             the taxonomy (ToFu / MoFu / BoFu / Post-Sale / Internal)
                 ↓
7. EMBED     text-embedding-3-small generates vectors;
             stored in Pinecone with Account_ID metadata
                 ↓
8. BUILD     Story Builder prompt chain assembles
             structured Markdown per Account
                 ↓
9. SERVE     RAG endpoint answers queries from chatbots;
             Account Journey UI renders the timeline
```

## 3. Key Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Unified API | Merge.dev | Handles 10+ recording providers + CRM in one integration layer |
| Auth | WorkOS | Native Google SSO, email/password, org-level SAML for enterprise |
| Vector DB | Pinecone | Managed, scales independently of PostgreSQL |
| Queue | BullMQ + Redis | Async processing of transcripts prevents webhook timeouts |
| LLM | OpenAI GPT-4o | Best cost/quality for structured extraction tasks |
| Billing | Stripe | Usage-based metering on transcript minutes processed |
| Entity Resolution | Email domain primary, Fuse.js fuzzy secondary | Email domain is the most reliable signal across inconsistent naming |

## 4. Taxonomy Tags

Calls are tagged against a comprehensive B2B case-study taxonomy:

- **Top of Funnel (ToFu)**: Industry trends, problem identification, digital transformation, compliance, market expansion, thought leadership
- **Mid-Funnel (MoFu)**: Feature deep-dives, competitive displacement, integration, onboarding, security, customization, multi-product, TCO, pilots
- **Bottom of Funnel (BoFu)**: ROI, operational metrics, executive impact, risk mitigation, deployment speed, vendor selection, procurement
- **Post-Sale**: Renewal, upsell, CS experience, training, community, co-innovation, change management, scaling, governance
- **Internal**: Sales enablement, lessons learned, cross-functional, VoC, pricing validation, churn saves, deal anatomy, health trajectory, reference-ability

See `src/types/taxonomy.ts` for the full enumeration.
