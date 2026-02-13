# StoryEngine

B2B SaaS platform that consolidates call recordings into Account Journey views with AI-powered story extraction. Turns hours of sales and customer success calls into publishable, company-name-scrubbed case studies — automatically.

## What It Does

1. **Ingests call recordings** from 10+ providers (Gong, Chorus, Zoom, Teams, etc.) via Merge.dev webhooks
2. **Resolves callers to CRM accounts** using email-domain matching and fuzzy name resolution
3. **Tags transcript segments** against a 60+ topic B2B sales taxonomy (TOFU through POST_SALE)
4. **Indexes everything** in a vector database for natural-language retrieval (RAG)
5. **Generates Markdown case studies** with timeline narratives, quantified metrics, and high-value quotes
6. **Publishes landing pages** with full company-name scrubbing, password protection, and expiration

## Architecture

```
Merge.dev Webhooks
        |
        v
  ┌─────────────┐     ┌──────────────┐     ┌──────────────┐
  │  Webhook     │────>│  BullMQ      │────>│  Transcript  │
  │  Handler     │     │  Queue       │     │  Processor   │
  └─────────────┘     └──────────────┘     └──────┬───────┘
                                                   │
                              ┌─────────────────┬──┴──────────────┐
                              v                 v                  v
                        ┌──────────┐     ┌──────────┐      ┌──────────┐
                        │  PII     │     │  AI      │      │ Pinecone │
                        │  Masker  │     │  Tagger  │      │ Embeddings│
                        └──────────┘     └──────────┘      └──────────┘

  ┌─────────────┐     ┌──────────────┐     ┌──────────────┐
  │  RAG        │────>│  Story       │────>│  Landing     │
  │  Engine     │     │  Builder     │     │  Page Editor │
  └─────────────┘     └──────────────┘     └──────┬───────┘
                                                   │
                                                   v
                                            ┌──────────────┐
                                            │  Company     │
                                            │  Scrubber    │
                                            └──────┬───────┘
                                                   │
                                                   v
                                            ┌──────────────┐
                                            │  Public Page │
                                            │  /s/:slug   │
                                            └──────────────┘
```

## Key Features

### Entity Resolution
Matches calls to CRM accounts despite naming inconsistencies. Email domain matching (high confidence) with Fuse.js fuzzy name fallback. Unresolved calls go to a manual review queue.

### Taxonomy Tagging
GPT-4o classifies every transcript chunk against a structured B2B taxonomy:
- **TOFU** — Industry trends, problem identification, digital transformation
- **MOFU** — Product capabilities, competitive displacement, integration, security
- **BOFU** — ROI, quantified metrics, executive impact, procurement
- **POST_SALE** — Renewal, expansion, customer success, scaling
- **INTERNAL** — Sales enablement, churn saves, deal anatomy
- **VERTICAL** — Industry-specific, segment, persona, geographic

### RAG Query Engine
Natural-language queries over transcript segments. Vector search via Pinecone, filtered by account and funnel stage, with LLM-generated answers grounded in source citations.

### Story Generation
Three-step pipeline: gather tagged segments, generate a chronological journey narrative (800-1500 word Markdown), then extract high-value quotes with quantified metrics.

### Company Name Scrubbing
Removes all client-identifying information before publishing:
- Word-boundary enforcement to avoid substring matches
- Short acronyms (<=4 chars) matched case-sensitively only
- Possessives and hyphenated compounds handled ("Acme's", "Acme-powered")
- Contact names anonymized by seniority level ("a senior executive at the client")
- Email domains replaced with `[client-domain]`
- Custom org-level replacement mappings

### Landing Pages
Full lifecycle: create from story, edit with auto-save and history tracking, publish with scrubbing, share with optional password and expiration. Rendered as standalone HTML with callout boxes, floating AI badge, and `noindex`/`nofollow`.

### PII Masking
Regex-based detection and redaction of emails, phone numbers, SSNs, credit cards, IP addresses, and DOBs — applied *before* any text is sent to an LLM.

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js + TypeScript |
| Framework | Express |
| Database | PostgreSQL via Prisma |
| Vector DB | Pinecone |
| LLM | OpenAI GPT-4o + text-embedding-3-small |
| Queue | BullMQ + Redis |
| Auth | WorkOS (SSO, SAML) |
| Billing | Stripe (usage-based metering) |
| CRM Integration | Merge.dev (unified API) |
| Markdown | markdown-it |

## API Endpoints

### Webhooks (unauthenticated)
| Method | Path | Description |
|---|---|---|
| POST | `/api/webhooks/merge` | Merge.dev recording/contact/opportunity events |
| POST | `/api/webhooks/stripe` | Stripe subscription lifecycle |

### RAG
| Method | Path | Description |
|---|---|---|
| POST | `/api/rag/query` | Natural-language query over transcripts |

### Stories
| Method | Path | Description |
|---|---|---|
| POST | `/api/stories/build` | Generate case study from account calls |
| GET | `/api/stories/:accountId` | List stories for an account |

### Landing Pages
| Method | Path | Description |
|---|---|---|
| POST | `/api/pages` | Create page from story |
| GET | `/api/pages/:pageId` | Get page for editing (unscrubbed) |
| PATCH | `/api/pages/:pageId` | Save edits |
| POST | `/api/pages/:pageId/publish` | Publish with company scrubbing |
| POST | `/api/pages/:pageId/unpublish` | Revert to draft |
| POST | `/api/pages/:pageId/archive` | Archive |
| DELETE | `/api/pages/:pageId` | Delete (admin only) |

### Dashboard
| Method | Path | Description |
|---|---|---|
| GET | `/api/dashboard/stats` | Aggregate org statistics |
| GET | `/api/dashboard/pages` | List pages with filters |
| GET/PATCH | `/api/dashboard/settings` | Org settings |
| POST | `/api/dashboard/permissions/grant` | Grant user permission |
| POST | `/api/dashboard/permissions/revoke` | Revoke user permission |

### Public
| Method | Path | Description |
|---|---|---|
| GET | `/s/:slug` | Rendered landing page (password-protected optional) |

## Data Model

Core entities: **Organization** > **User**, **Account** > **Contact**, **Call** > **Transcript** > **TranscriptChunk**, **Story** > **HighValueQuote**, **LandingPage** > **LandingPageEdit**.

Calls are tagged at both chunk level (`ChunkTag`) and aggregated call level (`CallTag`) with funnel stage, topic, and confidence score.

Access control is layered: role-based defaults (OWNER/ADMIN/MEMBER/VIEWER), granular user permissions, and account-scoped access tied to CRM reports.

## Environment Variables

Copy `.env.example` and fill in:

```
DATABASE_URL=            # PostgreSQL connection string
REDIS_URL=               # BullMQ queue (default: redis://localhost:6379)
MERGE_API_KEY=           # Merge.dev unified API
MERGE_ACCOUNT_TOKEN=
MERGE_WEBHOOK_SECRET=
OPENAI_API_KEY=          # GPT-4o + embeddings
PINECONE_API_KEY=
PINECONE_INDEX=
WORKOS_API_KEY=          # Auth (SSO/SAML)
WORKOS_CLIENT_ID=
WORKOS_REDIRECT_URI=
STRIPE_SECRET_KEY=       # Billing
STRIPE_WEBHOOK_SECRET=
STRIPE_FREE_TRIAL_PRICE_ID=
APP_URL=                 # Base URL for generated links
```

## Getting Started

```bash
npm install
cp .env.example .env     # fill in credentials
npx prisma generate
npx prisma migrate dev
npm run dev
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with hot reload (tsx watch) |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled output |
| `npm run db:generate` | Regenerate Prisma client |
| `npm run db:migrate` | Run database migrations |
| `npm run db:push` | Push schema to database |
| `npm run lint` | ESLint |

## Billing Model

PLG (product-led growth): 14-day free trial with no credit card. After trial, usage-based billing on transcript minutes via Stripe metered subscriptions. Plans: FREE_TRIAL, STARTER, PROFESSIONAL, ENTERPRISE.

## Security

- PII masked before any LLM call
- Company names scrubbed from all public pages
- All landing pages served with `noindex`, `nofollow`, `X-Robots-Tag`
- Webhook signature verification (HMAC SHA256)
- Role-based + granular permissions
- Account-scoped data access
- Helmet security headers
- Password-protected pages with bcrypt hashing
