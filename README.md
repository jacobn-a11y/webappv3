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

### AI Provider Architecture

```
  ┌─────────────────────────────────────────────────────────┐
  │                    AIConfigService                      │
  │                                                         │
  │  Request (org, user, provider preference)                │
  │         │                                               │
  │         ├── User allowed? (user override > role default)│
  │         │                                               │
  │         ├── Org has own key for this provider?          │
  │         │       YES → use org key (not platform-billed) │
  │         │       NO  → use platform key (billed)         │
  │         │                                               │
  │         └── Return { AIClient, isPlatformBilled }       │
  └────────────────────────┬────────────────────────────────┘
                           │
                           v
  ┌─────────────────────────────────────────────────────────┐
  │                  TrackedAIClient                        │
  │  (decorator wrapping any AIClient)                      │
  │                                                         │
  │  Pre-call:  enforce limits + enforce balance            │
  │  Call:      delegate to inner OpenAI/Anthropic/Google   │
  │  Post-call: record usage + deduct balance + notify      │
  └─────────────────────────────────────────────────────────┘
```

## Key Features

### Multi-Provider AI
Choose between OpenAI, Anthropic (Claude), and Google (Gemini) for story generation, transcript tagging, and RAG queries. Each provider is implemented behind a unified `AIClient` interface. Embeddings remain tied to OpenAI for Pinecone vector consistency.

### Per-Provider Hybrid Billing
Org admins can bring their own API keys on a per-provider basis. If an org configures their own key for a provider, all their users are routed through that key for that provider — no platform billing. For providers where the org hasn't added a key, the platform's key is used at platform-set per-token pricing. This allows mixing own-key and platform-billed providers.

### Prepaid Balance System
Per-user prepaid balances for platform AI usage. Admins top up balances, and each AI call deducts cost based on configurable per-model input/output token pricing. Transaction ledger tracks every credit and debit.

### Flexible Usage Limits
- **Token-based**: daily and monthly token caps
- **Request-based**: daily and monthly request caps
- **Story-count-based**: monthly case study generation cap
- **Seat-based pricing**: per-seat budgets multiplied by org user count
- Hard blocks when limits are exceeded, with configurable warning notifications at threshold percentages (default 80%, 90%, 100%)

### Granular AI Access Control
- Admins configure which providers and models are available per role (MEMBER, VIEWER)
- Per-user overrides with allow and deny lists for providers and models
- OWNER/ADMIN always have full access
- Only admins can add or modify AI provider configurations

### Platform Owner Dashboard
The application owner manages platform-level AI configuration via dedicated API routes:
- Add/update platform API keys per provider
- Set per-model pricing (input and output cost per 1k tokens)
- Enable/disable providers and models
- Validate API keys before saving

### Entity Resolution
Matches calls to CRM accounts despite naming inconsistencies. Email domain matching (high confidence) with Fuse.js fuzzy name fallback. Unresolved calls go to a manual review queue.

### Taxonomy Tagging
AI classifies every transcript chunk against a structured B2B taxonomy:
- **TOFU** — Industry trends, problem identification, digital transformation
- **MOFU** — Product capabilities, competitive displacement, integration, security
- **BOFU** — ROI, quantified metrics, executive impact, procurement
- **POST_SALE** — Renewal, expansion, customer success, scaling
- **INTERNAL** — Sales enablement, churn saves, deal anatomy
- **VERTICAL** — Industry-specific, segment, persona, geographic

### RAG Query Engine
Natural-language queries over transcript segments. Vector search via Pinecone, filtered by account and funnel stage, with LLM-generated answers grounded in source citations.

### Story Generation
Three-step pipeline: gather tagged segments, generate a chronological journey narrative (800-1500 word Markdown), then extract high-value quotes with quantified metrics. Each story records which AI provider and model was used.

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
| AI (Chat) | OpenAI GPT-4o, Anthropic Claude, Google Gemini |
| AI (Embeddings) | OpenAI text-embedding-3-small |
| Queue | BullMQ + Redis |
| Auth | WorkOS (SSO, SAML) |
| Billing | Stripe (usage-based) + prepaid AI balance system |
| CRM Integration | Merge.dev (unified API) |
| Markdown | markdown-it |

## API Endpoints

### Platform Admin (authenticated via `x-platform-admin-key` header)
| Method | Path | Description |
|---|---|---|
| GET | `/api/platform/providers` | List platform AI providers with pricing |
| POST | `/api/platform/providers` | Add/update a platform AI provider |
| POST | `/api/platform/providers/validate` | Validate an API key |
| GET | `/api/platform/models` | List all model pricing |
| POST | `/api/platform/models/pricing` | Set per-model pricing |
| DELETE | `/api/platform/models/pricing/:provider/:modelId` | Remove model pricing |

### AI Settings — User
| Method | Path | Description |
|---|---|---|
| GET | `/api/ai/providers` | List available providers (respects user access) |
| GET | `/api/ai/usage/me` | Current usage, limits, and balance |
| GET | `/api/ai/balance/me` | Balance with recent transactions |
| GET | `/api/ai/notifications` | Pending usage notifications |
| POST | `/api/ai/notifications/:id/acknowledge` | Acknowledge a notification |

### AI Settings — Admin (requires `MANAGE_AI_SETTINGS` permission)
| Method | Path | Description |
|---|---|---|
| GET/PUT | `/api/ai/admin/settings` | Org AI settings (default provider, seat pricing) |
| GET/POST/DELETE | `/api/ai/admin/providers` | Org AI provider key management |
| POST | `/api/ai/admin/providers/validate` | Validate an API key |
| GET/POST/DELETE | `/api/ai/admin/role-defaults` | Per-role AI access defaults |
| GET/POST/DELETE | `/api/ai/admin/user-access` | Per-user AI access overrides |
| GET | `/api/ai/admin/balances` | List all user balances |
| POST | `/api/ai/admin/balances/top-up` | Add funds to a user's balance |
| GET | `/api/ai/admin/balances/:userId` | User balance with transactions |
| GET/POST/DELETE | `/api/ai/admin/limits` | Usage limit management |
| GET | `/api/ai/admin/usage` | Usage history (filterable) |
| GET | `/api/ai/admin/usage/summary` | Monthly usage summary by user |

### Webhooks (unauthenticated)
| Method | Path | Description |
|---|---|---|
| POST | `/api/webhooks/merge` | Merge.dev recording/contact/opportunity events |
| POST | `/api/webhooks/stripe` | Stripe subscription lifecycle |

### RAG
| Method | Path | Description |
|---|---|---|
| POST | `/api/rag/query` | Natural-language query (supports provider/model selection) |

### Stories
| Method | Path | Description |
|---|---|---|
| POST | `/api/stories/build` | Generate case study (supports provider/model selection) |
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

AI configuration: **PlatformAIProvider** > **PlatformModelPricing**, **OrgAISettings**, **OrgAIRoleDefault**, **AIProviderConfig** (org keys), **UserAIAccess**.

AI billing: **UserAIBalance** > **UserAITransaction**, **AIUsageRecord**, **AIUsageLimit**, **AIUsageNotification**.

Calls are tagged at both chunk level (`ChunkTag`) and aggregated call level (`CallTag`) with funnel stage, topic, and confidence score.

Access control is layered: role-based defaults (OWNER/ADMIN/MEMBER/VIEWER), granular user permissions, account-scoped access tied to CRM reports, and per-user AI provider/model restrictions.

## Environment Variables

Copy `.env.example` and fill in:

```
DATABASE_URL=            # PostgreSQL connection string
REDIS_URL=               # BullMQ queue (default: redis://localhost:6379)
MERGE_API_KEY=           # Merge.dev unified API
MERGE_ACCOUNT_TOKEN=
MERGE_WEBHOOK_SECRET=
OPENAI_API_KEY=          # Required for embeddings (Pinecone vectors)
PINECONE_API_KEY=
PINECONE_INDEX=
WORKOS_API_KEY=          # Auth (SSO/SAML)
WORKOS_CLIENT_ID=
WORKOS_REDIRECT_URI=
BILLING_ENABLED=         # self-service default is "true"; set "false" only for internal/dev bypass
STRIPE_SECRET_KEY=       # Billing
STRIPE_WEBHOOK_SECRET=
STRIPE_STARTER_PRICE_ID=
STRIPE_PROFESSIONAL_PRICE_ID=
STRIPE_ENTERPRISE_PRICE_ID=
AI_KEY_ENCRYPTION_SECRET=  # AES-256-GCM key for encrypting API keys at rest
PLATFORM_ADMIN_API_KEY=    # Auth for platform admin dashboard routes
APP_URL=                 # Base URL for generated links
FRONTEND_URL=            # Frontend URL for auth/invite/checkout redirects
INVITE_FROM_EMAIL=       # Sender identity for org invite emails
```

## Quick Start

Minimal setup for local development:

```bash
npm install
cp .env.example .env     # fill in at least DATABASE_URL and REDIS_URL
npx prisma generate      # required before build/test
npx prisma migrate dev
npm run dev
```

**Required env vars:** `DATABASE_URL` (PostgreSQL), `REDIS_URL` (BullMQ). The app will exit with a clear error if these are missing.

## Running Tests

- **Unit tests:** `npm test` (excludes DB-dependent tests when `TEST_DATABASE_URL` is unset)
- **Integration tests** (landing-page-lifecycle, etc.) require:
  - `TEST_DATABASE_URL` — PostgreSQL test database (default: `postgresql://user:password@localhost:5432/storyengine_test`)
  - Postgres and Redis running (e.g. `docker compose up -d`)

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `missing required environment variables` | Set `DATABASE_URL` and `REDIS_URL` in `.env` |
| `prisma generate` errors | Run `npx prisma generate` after schema changes |
| Tests fail with "port" null | Ensure tests use `requestServer(app)` — see `tests/helpers/request-server.ts` |
| Landing-page-lifecycle tests skipped | Start Postgres + Redis, set `TEST_DATABASE_URL` |

## Getting Started (full)

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

**Platform billing**: PLG (product-led growth) with 14-day free trial. After trial, Stripe-based subscription billing. Plans: FREE_TRIAL, STARTER, PROFESSIONAL, ENTERPRISE.

**AI billing**: Prepaid per-user balance system. Platform owner sets per-model token pricing (input and output costs per 1k tokens). Org admins top up user balances. Each platform-billed AI call deducts the computed cost. Orgs that bring their own API keys bypass platform AI billing for those providers.

## Security

- AI API keys encrypted at rest with AES-256-GCM
- PII masked before any LLM call
- Company names scrubbed from all public pages
- All landing pages served with `noindex`, `nofollow`, `X-Robots-Tag`
- Webhook signature verification (HMAC SHA256)
- Role-based + granular permissions (including AI access control)
- Account-scoped data access
- Helmet security headers
- Password-protected pages with bcrypt hashing
- Platform admin routes gated by separate API key
