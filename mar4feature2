# UI Audit: Detailed Recommendations & Feature Explanations

---

## Introduction

### Purpose of the Application

StoryEngine is a purpose-built internal application that connects to Gong and Salesforce, then turns raw call data into a governed, repeatable marketing content pipeline. Unlike a point integration that syncs a few fields from A to B, this tool owns the end-to-end workflow: curation, redaction, approvals, publishing readiness, and traceability.

**Who it's for:** Marketing, content ops, product marketing, and enablement teams that publish customer proof, quotes, narratives, case studies, emails, web pages, ads, and sales collateral sourced from calls. Orgs that need review gates, PII handling, and auditability before anything goes public.

**Core outcomes:**
- Faster, safer extraction of high-value moments across many calls
- A reusable library of curated proof points, quotes, objections, and story arcs
- Consistent outputs that match your templates, voice, and channels
- Operational reliability that does not collapse into brittle scripts

---

### Value Proposition: Internal Tool vs. API Hookup

An "API hookup to Gong and SFDC" is usually a point integration; it moves data from A to B or syncs a few fields. An internal tool is about owning an end-to-end workflow, with repeatability, governance, and a user experience that matches how your team actually works.

**When an API hookup is enough:** A direct integration is usually sufficient if you only need one of these:
- Sync call links or summaries into Salesforce
- Attach transcript text to an opportunity
- Trigger a Slack message when a keyword appears
- Build a dashboard from existing vendor data

**When an internal tool is the better choice:** An internal tool wins when you need:
- Repeatable content production at scale
- Governance, approvals, and audit trails
- A reusable library of curated moments and stories
- Flexible search and tagging aligned to marketing strategy
- Reliability, backfills, and operational ownership

---

### Ten Reasons a Single Company Might Choose an Internal Tool

1. **Marketing's workflow is not Gong's or Salesforce's.** Gong is optimized for sales coaching and deal intelligence. Salesforce is optimized for CRM and process automation. Marketing content ops needs a different pipeline: find moments, extract quotes, remove PII, route for review, publish. APIs can pull raw data, but they do not provide a marketing-friendly workflow layer.

2. **You need a system of record for derived assets.** Raw inputs are easy to fetch. The valuable outputs are derived and evolving: snippets, themes, tags, drafts, approvals, versions, publish status, and the linkage between each claim and its source moment. That structure rarely fits cleanly into Gong or Salesforce without heavy customization.

3. **Governance is simpler when you own the pipeline.** If calls feed public-facing materials, you want PII rules, review gates, audit trails, and retention controls. A dedicated tool can enforce every step, log every action, and make compliance a default behavior instead of a best-effort process.

4. **Reliability at scale requires real operational plumbing.** Vendor APIs have rate limits, outages, and schema changes. A dependable team tool needs queues, retries, idempotency, backfills, reprocessing, and monitoring. An "API hookup" often becomes a fragile stack of scripts once you add those requirements.

5. **Search and retrieval depends on your taxonomy, not theirs.** Marketing searches across accounts and themes: "ROI proof in healthcare," "security objections successfully handled," "quotes that support a new positioning angle." That works best when you normalize data into your own schema and apply your own tagging system, optionally with semantic search.

6. **Cost control is easier when you can govern usage centrally.** Teams care about preventing runaway AI usage, tracking consumption by team or campaign, choosing models per task, and enforcing budgets. If AI summarization and generation are part of the workflow, those controls belong in the same place as the workflow.

7. **You reduce vendor lock-in and preserve institutional knowledge.** When your derived library lives in your system, you can switch call platforms or evolve your CRM without losing your content corpus, taxonomy, and historical context. Integrations tend to bake in vendor assumptions.

8. **Permissions can match content lifecycle reality.** Marketing permissions are often content-centric: who can view raw transcripts vs. scrubbed excerpts, who can export externally, who can approve customer quotes, who can publish to web properties. Gong and Salesforce permissions are not usually aligned to "content lifecycle permissions."

9. **The internal UX matters more than people expect.** A lightweight integration may technically work but fail because it is painful to use. A purpose-built tool can provide a single place to search, curate, draft, review, and publish, with clear "next step" states and consistent templates.

10. **"API hookup" often becomes "internal tool" over time.** The usual path: scripts, then tagging, then approvals, then retries and monitoring, then permissions and audit trails. By step 3 or 4 you have effectively built an internal product. Doing it intentionally can be cheaper than accumulating brittle automation.

---

### How This Document Relates to the Value Proposition

This document expands on each recommendation and suggested feature from the StoryEngine UI Audit Report. Each section describes what the feature is, **why it matters for the value proposition** (mapping to the reasons above), how it could work in practice, and implementation considerations. The recommendations are designed to align the UI with the internal-tool value proposition, so the product feels like a purpose-built workflow, not an API hookup with a thin UI.

---

## Part 1: Workflow & Structure Recommendations

### 1. Content Lifecycle View

**What it is:** A single page or tab (e.g., "My Content" or "Content Queue") that shows all content organized by lifecycle stage: Draft → In Review → Approved → Published. Users can filter by account, content type, and date.

**Why it matters:** Marketing's workflow is not Gong's or Salesforce's. Marketing needs a pipeline that matches content production: identify moments, extract quotes, build narratives, scrub PII, route for review, then publish. Today, users jump between Story Library, Dashboard Pages, Publish Approvals, and Account Detail with no clear map of where everything sits in the pipeline. A Content Lifecycle view gives them a single place to see the state of all content.

**Lifecycle states (precise definitions):**
- **Draft** = stage resolved by precedence rules when `publishedAt` is null and latest approval is not `PENDING` or `APPROVED`. This includes assets with no approval requests and assets whose latest request is `REJECTED`.
- **In Review** = approval request pending
- **Approved** = approval granted, not yet published
- **Published** = live, published state
- **Published (recent)** = `publishedAt >= now - 30d`, items created by current user only (used in My Queue; configurable later). Use server time in UTC for `now`; treat the window as inclusive at the lower bound.

Applies to both stories and landing pages; approval requests link to the underlying asset type.

**Stage source of truth:** Derived at read time from `publishedAt` plus latest `ApprovalRequest.status` (if any). Do not store a separate stage enum in v1.

**Precedence:** If `publishedAt` exists, stage is `Published` regardless of approval status. Otherwise if latest approval is `PENDING`, stage is `In Review`. Otherwise if latest approval is `APPROVED`, stage is `Approved`. Otherwise stage is `Draft`. If no `ApprovalRequest` exists for the asset, and `publishedAt` is null, stage is `Draft`. Latest request is defined as max(`createdAt`), tie break by descending `id` (lexicographic when `id` is a string).

**Approval statuses:** `PENDING`, `APPROVED`, `REJECTED`. Only the latest request per asset is considered for lifecycle stage. Latest request is defined in Precedence. Resubmits create a new request; previous requests remain immutable history. Rejected items appear as Draft in lifecycle views unless a new request is created. Rejected does not create a lifecycle stage; it is visible only in My Requests history and in the request detail modal.

**Approval scope (v1):** Approval attaches to the asset, not a content hash. Editing an Approved item keeps it Approved until published. Edits after approval are captured in audit logs, but do not force a new approval in v1. In v1, Approved items are not resubmitted; they are either published or left Approved. Submitting for approval again from Draft (including after rejection) uses the same Publish flow; any Story Builder user with edit access can do so. Later enhancement: require resubmission when content changes after approval.

**V1 default:** Approved means "ready to publish"; creator must click Publish. In the Approved state, Publish performs the actual publish action, not a resubmission. Auto-publish is a later enhancement.

**How it could work:**
- **Default:** List view. Table with columns: Title, Account, Type, Stage, Creator, Updated. Sort and filter by any column.
- **Kanban (optional mode):** Columns for Draft, In Review, Approved, Published. Cards show story or page title, account name, creator, last updated. Drag-and-drop to move between stages where applicable (e.g., Draft → In Review). Dragging Draft to In Review invokes the same Publish action. If approval is required, the item moves to In Review. If approval is not required, the item publishes immediately and moves to Published. Show a toast confirmation explaining what happened (inline confirmation is acceptable on mobile or when toasts are not available). Only Draft → In Review is draggable in v1. Drag-and-drop must call the same permission and governance checks as the Publish button. Publish policy is evaluated at action time; if policy changed since page load, the result may differ from the column target, and the UI should show the outcome in the confirmation message.
- **Filters:** Account (single or multi-select), content type (story, landing page), date range, creator.
- **Actions per card:** Open, Edit, Publish, View in Library.
- **Publish behavior:** If approval is required, Publish creates an `ApprovalRequest` with `status=PENDING`. If approval is not required, Publish publishes directly. On Draft items, Publish either (a) creates an approval request with `status=PENDING`, moving the item to In Review, or (b) publishes directly, moving the item to Published. Approval to reach Approved only happens via an approver action.
- **Empty states:** "No drafts" with CTA to generate a story. "No items in review" with explanation of approval flow.

**Implementation considerations:**
- Requires aggregating data from stories, landing pages, and approval requests. Approval state must be joinable to the content. Approval requests must be keyed by `(assetType, assetId)` to avoid collisions between Story and LandingPage IDs.
- "In Review" = approval request exists with PENDING status. "Approved" = approval request APPROVED but not yet published (or published).
- Consider a dedicated route (e.g., `/content-queue` or `/my-content`) and a nav item. Could also be a tab within Story Library or a new top-level section.

---

### 2. Surface Approval State to Creators

**What it is:** In Story Library and Dashboard Pages, show badges such as "In Review" and "Approved" on each story or page card. Where appropriate, link to the Publish Approvals queue or a "My Queue" view.

**Why it matters:** Governance is easier when you own the pipeline. A review gate before publish only works if creators know their content is in the queue. Today, creators submit for approval and get no in-app feedback; they don't see "pending" or "approved" in the places they browse. This creates confusion and support burden ("Where did my publish request go?").

**How it could work:**
- **Story Library:** Add a status badge beyond DRAFT/PUBLISHED: "In Review" (orange), "Approved" (green, ready to publish). Filter by these statuses. Labels align with Content Lifecycle: Draft, In Review, Approved, Published.
- **Dashboard Pages:** Same badges on page cards. "In Review" means a publish request exists and is awaiting review.
- **Click-through:** Clicking "In Review" could open a modal with request details (submitted when, by whom, which approvers) or link to My Queue (In Review section) or My Requests (full approval history).
- **Approved state:** "Approved" means an approver has approved; the creator can now complete the publish. V1: creator must click Publish. Make the next action obvious: "Publish now" or "View approved request."

**Implementation considerations:**
- Backend must expose approval request status per story/page. May need to join `ApprovalRequest` with `LandingPage` or `Story`.
- Consider real-time or polling updates so status changes when an admin approves.
- Publish happens in Story Builder; badges in Library and Pages are informational and link to request details.

---

### 3. "New Story" as a Primary Action

**What it is:** Ensure the global Story Picker (or "New Story" button) is prominent and works from any page. This is the primary entry point for the content production workflow.

**Why it matters:** Internal UX matters more than people expect. A purpose-built tool should provide a single place to search, curate, draft, review, and publish. The first step is "create." If "New Story" is buried or inconsistent, adoption suffers.

**How it could work:**
- **Global header:** Persistent "New Story" or "+ Story" button in the main nav. Opens the Story Picker modal (account selection, opportunity, deal stage, etc.).
- **Contextual CTAs:** On Home, Accounts, Account Detail, Story Library: clear "Generate Story" or "New Story" buttons that open the same flow.
- **Keyboard shortcut:** Cmd/Ctrl+N or similar for power users.
- **Consistency:** Same modal, same flow, regardless of where the user starts. No dead ends.

**Implementation considerations:**
- Likely already exists (Story Picker in header). Audit for visibility, discoverability, and consistency across pages.
- Ensure the modal is accessible (focus trap, escape to close, screen reader support).

---

### 4. My Queue for Creators

**What it is:** The home widget or page for creators. Shows the creator's content in four sections: Draft, In Review, Approved, Published (recent). Answers "What do I need to do next?" and helps creators confirm what went live. Distinct from the admin Publish Approvals queue (which shows all requests across the org).

**Why it matters:** Governance and next-step states. Creators need a single place to see their drafts, what's awaiting approval, what's approved and ready to publish, and what they recently published. My Queue is the creator's home base.

**How it could work:**
- **Widget on Home:** "Your content: 3 drafts, 2 in review, 1 approved, 5 published." Each section links to filtered view. Counts drive urgency. Published (recent) = `publishedAt >= now - 30d`, items created by current user only. Use server time in UTC for `now`; treat the window as inclusive at the lower bound (configurable later).
- **Full page:** My Queue with tabs or sections for Drafts, In Review, Approved, Published (recent). Actions per item: Edit, Publish, View. Publish behavior is policy-aware: it either publishes directly or creates an `ApprovalRequest` with `status=PENDING` when approval is required.
- **Request creation:** Any Story Builder user can click Publish on Draft items they can edit. If approval is required, this creates an `ApprovalRequest` with `status=PENDING`.
- **In Review (in My Queue):** Shows items with an approval request created by the current user. Status: Pending, Approved, Rejected. Shown from the latest request per asset.
- **My Requests (drill-down):** A dedicated view for full approval history, including Rejected items with reasons. Use when the creator needs to see why something was rejected or review past requests. My Requests lives under My Queue as a link, and is also accessible from the approval badge click-through.
- **Notifications:** Optional in-app (or email later) when status changes: request created, approved, rejected.

**Implementation considerations:**
- Filter content by `createdByUserId` or equivalent for Draft, In Review, Approved, and Published. Join to `ApprovalRequest` for In Review and Approved states.
- Expose via API and frontend. My Requests = filter `ApprovalRequest` by `requestedByUserId`.

---

## Part 2: Derived Assets Recommendations

### 5. Quote Library (Two-Tier)

**What it is:** A Quote Library that fills automatically as calls are ingested, with a high-signal curated layer that stays clean and trusted over time. Two tiers: **Auto Quotes** (generated in the background from newly ingested calls) and **Curated Quotes** (selected and promoted by humans). Curated is a state on the same quote record, not a separate asset type. Every quote has provenance back to the exact transcript segment. Attribution is gated by permissions and per-user preference.

**Why it matters:** You need a system of record for derived assets. The library fills naturally without anyone doing work; curated quotes surface first for high signal. Quotes are reusable across case studies, emails, ads. Provenance is what makes quotes trustworthy. Today, quotes live only on stories; there's no unified, queryable library.

**How it could work:**

**Core concepts:**
- **Quote:** First-class asset derived from a transcript segment, linked to account, call, transcript segment (chunkId or timestamp range). Optional speaker attribution, gated by permissions and user preference.
- **Auto Quotes:** Created by the system during ingestion (`createdByType=SYSTEM`, `tier=AUTO`). Sparse, high-quality extraction (e.g., 5–10 per eligible call).
- **Curated Quotes:** Quotes that a user has intentionally promoted for reuse. Curated quotes can be auto quotes that got promoted, or quotes created directly from transcript selection. **"Save quote from transcript"** creates a quote with `createdByType=USER` and `tier=CURATED` by default (or creates Auto and immediately promotes). One library, one concept. "Curated moments" can remain as a UI label or filter, not a separate product surface.

**Quote Library page:**
- **Default view:** Curated Quotes first, then Auto Quotes. Sort by newest within each tier; optional sort by relevance when searching.
- **Search:** Keyword search across quote text. Semantic search optional later (not required for v1).
- **Filters:** Tier (Curated, Auto, All), Account, Date range, Call type (if available), Topic tags (optional, can ship later), Funnel stage (optional, can ship later).
- **Quote card:** Quote text (truncated), tier badge (Curated or Auto), account name (if allowed), call date, optional topic tags. Actions: Copy quote, View source, Promote to Curated (if Auto), Demote (if Curated, permission controlled), Star, Add tags (optional), Add note (optional).
- **Settings icon** in the upper right → links to user settings where attribution display is configured.

**Transcript viewer integration:**
- "Save quote" creates a new quote directly from selected text or a transcript chunk.
- "Promote" appears for existing auto quotes tied to the chunk.
- "View in library" jumps to the quote detail.

**Quote detail view:**
- Full quote text, tier status; who curated it and when.
- Link to call details; deep link to transcript segment, highlighted on load.
- Optional speaker and timestamp, gated by permissions.

**Provenance (View source):**
- From any quote (in the Quote Library, on a story card, or in the Story Generator preview), provide a link to the source transcript segment. Click → opens Transcript Viewer for that call, with the segment highlighted or scrolled into view.
- Deep link: `/calls/:callId/transcript?chunk=:chunkId` where `callId` and `chunkId` are opaque identifiers. In OBFUSCATED mode, the client must not expose call title, account name, speaker identity, or timestamps in the UI or URL.
- Transcript viewer: auto-scroll to segment, highlight it. Optional "Play from timestamp" if media is available. Tooltip/label: "From Call: [Call Title], [MM:SS]." (when attribution is permitted).
- Backend already has lineage. Frontend builds the deep link from quote metadata. Transcript Viewer must support `chunk` or `t` query params and scroll/highlight logic.

**View source access rules (must be enforced at API layer):**
- **API enforced, not UI only.** View-source availability and the metadata it can reveal must be enforced by the API based on the user's transcript permissions and `quoteAttributionDisplay`. The UI must not be able to bypass restrictions by manipulating URLs or query params.
- **Raw transcript access required for raw view.** If the user does not have permission to view raw transcripts, View source must not reveal raw transcript text, speaker identity, call title, account name, or precise timestamps.
- **Scrubbed fallback.** If a scrubbed transcript view exists, View source routes to the scrubbed transcript segment when raw access is not permitted. If no scrubbed transcript view exists, View source is disabled and the UI shows a "Source unavailable due to permissions" message.
- **OBFUSCATED mode behavior.** When `quoteAttributionDisplay = OBFUSCATED`, View source must not reveal call identifiers, account name, call title, speaker identity, or exact timestamps. View source may still route to a scrubbed transcript segment, but the UI must use a neutral label such as "Source segment" and avoid exposing restricted metadata in the UI or URL.

**Curation mechanics:**
- **Editability (v1):** Quotes are immutable except for curator notes, to preserve provenance. Edits to quote text are not allowed in v1. If a user wants a shorter or cleaner excerpt, they should save a new quote from the transcript selection. Editable fields in v1: curator note, star status, tier (promote or demote). Non editable: quote text, source pointers. **Display truncation is not editing.** The UI may show a shortened preview of quote text in list cards, but stored `quoteText` remains immutable. To produce a shorter excerpt, the user must save a new quote from a narrower transcript selection.
- **Promote:** Auto quotes have "Promote to Curated." Captures `curatedByUserId`, `curatedAt`, optional `curationNote`.
- **Demote:** Curated quotes can be demoted back to Auto by users with permission or by the original curator. Demotion preserved in audit logs.
- **Promotion and demotion semantics (v1):** Promote and Demote mutate the same Quote record by changing `tier`. They do not create a new Quote record. Audit logs must record `action` (PROMOTE or DEMOTE), `actorUserId`, `occurredAt`, `previousTier`, `newTier`, and `quoteId`.
- **Star:** Separate from curated status. Users can star quotes for personal shortlists. Stored as `UserStarredQuote`; does not change global tier. Star does not affect global ordering. Starring is per-user and does not change global ranking in default Quote Library views. A Starred-only filter or view is permitted in Phase 2.

**Auto quote generation:**
- Runs asynchronously after transcript is available and stored. Queued, retryable.
- Eligible call (v1) is defined by duration threshold, call type allowlist, and remaining capacity under the org daily cap. No complex stage logic in v1. Call type allowlist examples: discovery, demo, QBR, implementation.
- Auto quotes in v1 are not tagged beyond account and call metadata.
- Quality controls: minimum quote length; skip greetings, scheduling, filler; confidence score threshold.
- **Dedupe within call (v1):** Dedupe auto quotes within the same call using normalized quote text (trim, collapse whitespace, case fold). If two auto quotes have the same normalized text, keep the one with higher `confidenceScore` (tie break by later `createdAt`). No cross-call dedupe in v1.
- **Backfill:** No full-history backfill by default. Controlled backfill: "Backfill last 30 days" or "Backfill this account" on demand; rate limited and capped.

**Permissions and governance:**
- **View raw vs scrubbed:** Users without "View raw transcript" see scrubbed content or obfuscated attribution. Curated does not override permissions.
- **Attribution display modes** (per-user): Displayed; Hidden (show only on detail view); Obfuscated (never exposes speaker, call identifiers, or raw transcript links; if a scrubbed transcript view exists, View source routes there). Enforce at API layer, not just UI.
- **Scrubbed transcript view.** "Scrubbed transcript" means a transcript representation that has had PII and restricted identifiers removed or masked using the same masking rules used for publish-time scrubbing. The scrubbed transcript may be generated at read time or precomputed and stored, but it must be consistent across quote View source, story preview, and publish flows.
- **Copy behavior.** Copy to clipboard copies only `quoteText` by default. Copy must not include call title, account name, speaker identity, or timestamps unless the user has permission to see those fields and `quoteAttributionDisplay = DISPLAYED`. When governance restricts named data or PII export, the UI must show an in-context warning before copying when metadata would be included. In OBFUSCATED mode, copy action should copy only the quote text, no metadata.
- **Search access control.** Quote search and filters must respect account-level access and transcript permissions. Quotes tied to accounts the user cannot access are not returned. Attribution fields are filtered based on `quoteAttributionDisplay` and transcript permissions.
- **Export:** Warn when content may include named data or PII; restrict by role and governance settings.

**Quote Library v1 (Must-have):**
- Auto extraction on ingest, 5 to 10 quotes per eligible call. Auto Quotes are intentionally sparse to avoid noise. Auto quotes are intended for discovery; curation is the mechanism that creates the trusted set.
- Quote list page: keyword search, account filter, tier filter, date filter
- Quote card: Copy, View source, Promote, Demote, Star
- Deep link to transcript with highlight
- Basic dedupe and confidence threshold
- "Save quote from transcript" creates Curated quote in the same library

**Quote Library v1 (Explicitly not in scope):**
- Folders and pages
- Topic taxonomy assignment
- Funnel stage assignment
- Sentiment
- Semantic search
- Export workflows beyond copy to clipboard

**Implementation plan:**

**Phase 1 (Two-tier MVP):**
- Quote table with tier support. Auto extraction job on new calls.
- Quote Library page: tier filter, account filter, date filter, keyword search.
- Quote card actions: Copy, View source, Promote, Demote (permissioned), Star.
- Transcript deep link with highlight.

**Phase 2 (Curation effortless, Transcript Save now in scope):**
- Transcript viewer "Save quote" and "Promote" controls. "Save quote from transcript" creates a Curated quote in the same library; no separate Curated Moment Library.
- Quote detail view with curation note.
- Personal starred view.
- Optional: "Curated Moments" as a label on the Curated tier, a saved filter preset, or a tab within the Quote Library; not a separate feature.

**Phase 3 (Discovery smarter):**
- Taxonomy tags or semantic search (pick one).

**Phase 4 (Operational controls):**
- Admin controls for extraction heuristics and caps.
- Backfill tools with limits.
- Usage tracking for quote extraction calls.

**Implementation considerations:**
- **Data model:** Quote with `id`, `organizationId`, `accountId`, `callId`, `quoteText`, `sourceChunkId` or `sourceStartMs/sourceEndMs`, `tier` (AUTO | CURATED), `createdAt`, `createdByType` (SYSTEM | USER), `curatedByUserId`, `curatedAt`. Optional later: `topics[]`, `funnelSourceStage`, `bestUseStage`, `sentiment`, `confidenceScore`.
- **Canonical source pointer (v1):** v1 must choose a single canonical source pointer for all quotes. Preferred: `sourceChunkId` as the source of truth for deep linking and highlight. Optional: `sourceStartMs/sourceEndMs` may be stored only when media playback is available and must not be required for quote creation. If the canonical pointer is missing, the quote cannot be created in v1.
- **UserStarredQuote:** `userId`, `quoteId`, `createdAt`. If the user filters to Starred, sort by `UserStarredQuote.createdAt` descending by default.
- **Audit:** Log quote created, promoted, demoted, edited, deleted.
- **Per-user attribution setting:** `quoteAttributionDisplay: "DISPLAYED" | "HIDDEN" | "OBFUSCATED"`. API enforces; View source is available only when it does not reveal restricted attribution.
- **Retention and source expiry.** If the underlying transcript segment is deleted due to retention, the Quote remains but View source is unavailable and the UI shows a "Source expired" state. Deleting quotes on source deletion is a later enhancement and is admin-configurable, not v1 default.

---

## Part 3: Governance Recommendations

### 6. Pre-publish PII Scan

**What it is:** In the Story Generator preview and Landing Page Editor, before the user hits Publish, show a PII check: "X potential PII items found" (e.g., emails, phone numbers, names). Offer an option to review and fix before publishing.

**Why it matters:** Governance when you own the pipeline. If you generate public-facing materials from calls, you want PII handling rules that match your risk tolerance. Today, scrubbing happens at publish (company names, etc.) but there's no pre-publish scan. Users may not realize they're about to publish unscrubbed content.

**How it could work:**
- **Trigger:** On Publish, run a scan on the publish payload before committing.
- **Display:** "3 potential PII items found: 1 email, 2 phone numbers." List or highlight the matches (with redaction in the list to avoid re-exposing).
- **Actions:** "Review" (scroll to matches in editor), "Scrub automatically" (run existing scrubber), "Publish anyway" (only when governance allows bypass; otherwise blocked until resolved).
- **Config:** If blocking is enabled by governance settings, prevent Publish until resolved.

**Implementation considerations:**
- Reuse or extend existing PII masking logic (regex-based). May need a "scan only" mode that returns matches without modifying.
- Consider performance for long documents. Could be async with a loading state.

---

### 7. Governance Dashboard

**What it is:** A summary page for governance: pending approvals count, retention status (e.g., "X items eligible for deletion"), recent audit events, PII exposure summary. One place for admins (or compliance) to see the health of the pipeline.

**Why it matters:** Governance is easier when you own the pipeline. A dedicated tool can enforce every step and log every action. A dashboard makes that visible (pending approvals, retention, audit trail) instead of scattering it across multiple admin pages.

**How it could work:**
- **Cards/sections:**
  - **Pending approvals:** Count and link to Publish Approvals. "5 publish requests awaiting review."
  - **Retention:** "Transcript retention: 90 days. X calls eligible for deletion." Link to retention settings.
  - **Audit log:** Last 5–10 events (category, action, actor, time). Link to full Audit Logs.
  - **PII/Export:** "Named exports: enabled. PII export: restricted." Link to Governance settings.
  - **Legal hold:** Status if enabled.
- **Audience:** Admin or compliance role. Could live under Governance or as a top-level "Compliance" or "Governance Overview" page.

**Implementation considerations:**
- Aggregate data from ApprovalRequest, AuditLog, retention logic, Governance settings.
- May require new API endpoints or reuse existing ones with filters.

---

### 8. In-context Export Warnings

**What it is:** When a user exports content (e.g., CSV of stories, PDF export, bulk export), show a clear message if the export may contain PII or named customer data, based on governance settings. E.g., "This export may contain PII. Ensure you have permission to share externally."

**Why it matters:** Export controls (PII export, named exports) are settings only today. Users may not know that exporting a story with customer names is governed. In-context warnings reduce compliance risk.

**How it could work:**
- **Export modal or confirmation:** Before the export completes, check governance settings and content. If PII or named data is possible: "Warning: This export may contain [PII / named customer data]. By proceeding, you confirm you have permission to share externally." Checkbox: "I understand." Then allow export.
- **Contextual:** Only show when relevant. E.g., exporting anonymized/scrubbed content might not trigger. Exporting full story with account name would.
- **Link:** "Learn more" → Governance or help doc on export policy.

**Implementation considerations:**
- Need to determine "contains PII" or "contains named data" from content + settings. May be heuristic (e.g., account name present, governance says named exports restricted).
- Frontend can show the warning; backend may enforce actual export permission.

---

### 9. Approval Flow (Simplified)

**What it is:** A simple approval policy with four org-level options. Admins choose one: (1) all stories require approval, (2) anonymous stories without approval / named require approval, (3) named stories without approval / anonymous require approval, or (4) all stories without approval. Users with approval permission can grant approvals; admins control who has that permission. No account-level rules or whitelists.

**Why it matters:** Governance is simpler when you own the pipeline. Named stories (with customer names) often need stricter review than anonymized ones. A simple four-option model keeps configuration manageable while covering the main cases: strict (all require approval), relaxed (all without), or mixed (one type requires approval, the other does not).

**How it could work:**

**Admin configuration (Governance or Approvals settings):**

- **Submission and approval permissions (v1):** Any Story Builder user can create an `ApprovalRequest` via Publish for assets they can edit. No separate "Can submit for approval" permission. Users can only create approval requests via Publish on assets they have edit access to. Approve/reject remains permissioned.

- **Approval policy (single select, one of four):**
  - **All require approval.** Every publish (named or anonymous) goes to the approval queue.
  - **Anonymous without approval; named require approval.** Anonymous/scrubbed stories publish directly. Named stories require approval.
  - **Named without approval; anonymous require approval.** Named stories publish directly. Anonymous/scrubbed stories require approval.
  - **All without approval.** No approval required; users can publish directly for both named and anonymous.

- **Approval permissions:**
  - **Who can approve:** Admins grant "Can approve publish requests" permission to users or roles. Only those users can approve or reject. Request creation via Publish is not permissioned beyond Story Builder access and edit access.

**User experience:**

- **Unified primary action:** The primary action is **Publish**. If approval is required, clicking Publish creates an `ApprovalRequest` with `status=PENDING` and routes to confirmation or request detail. If approval is not required, clicking Publish publishes directly and no request is created. The UI makes it clear with a subtitle when approval is required (e.g., "Requires approval; will be sent to the queue"). No separate "Request approval" vs "Publish" buttons; one action, context-aware behavior.
- **Clear feedback:** Before the user clicks, it must be obvious whether this will publish directly or go to approval. E.g., "This publish requires approval" or "You can publish directly." The button label or tooltip reflects the outcome.
- **Approvers:** Users with approval permission see the Publish Approvals queue and Approve/Reject. Admins manage who has this permission in Permissions or Roles.

**Implementation considerations:**

- Backend: Single config field (e.g., `approvalPolicy: "ALL_REQUIRED" | "ANONYMOUS_OK" | "NAMED_OK" | "ALL_OK"`). Evaluate at publish time based on story type (named vs. anonymous).
- UI: Governance/Approvals settings page with a single dropdown or radio group for the four options, plus approval permission assignment.
- Audit: Log when approval is required, bypassed, or granted.

---

### 10. Slack Integration for Approvals

**What it is:** Approvers can connect Slack and receive approval requests via Slack. Creators can connect Slack and be notified when their story is approved. Reduces friction: approvers don't have to check the app; creators get immediate feedback.

**Why it matters:** Approvals often sit in a queue until someone remembers to check. Slack is where many teams already work. Pushing requests into Slack and allowing approve-from-Slack increases speed and reduces dropped requests.

**How it could work:**

**For approvers:**
- **Setup:** In user settings or Approvals settings, approvers connect their Slack workspace (OAuth). Choose which channel or DM to receive approval requests.
- **Incoming request:** When a creator clicks Publish and approval is required, approvers get a Slack message with: who requested (name), story/page title, brief context (e.g., account name, story type), and a link to review in the app.
- **Approve from Slack:** Message includes buttons: "Approve" and "Reject." Approving from Slack completes the approval without opening the app. Or approver clicks the link to review in the app, then approves there.

**For creators:**
- **Setup:** In user settings, creators can connect Slack to receive notifications when their content is approved (or rejected).
- **Notification:** "Your story [Title] has been approved by [Approver]. Click Publish to go live." Link to the story/page.

**Implementation considerations:**
- Slack App: Create a Slack app with OAuth, incoming webhooks or Events API, and interactive components (buttons) for Approve/Reject.
- Backend: Store Slack user/channel mapping per user. On approval request created, post to configured Slack destination. On Approve/Reject from Slack, verify request and update ApprovalRequest.
- Security: Validate Slack payload signatures; ensure only authorized approvers can approve via Slack (match Slack user to app user with approval permission).

---

## Part 4: Search & Retrieval Recommendations

### 11. Cross-account Thematic Search

**What it is:** In Story Library, add filters for topic/theme (from taxonomy) and funnel stage that work across all accounts. E.g., "Find all stories tagged ROI" or "All BOFU stories in healthcare."

**Why it matters:** Search is your taxonomy, not theirs. Marketing search is thematic: "All examples of ROI proof in healthcare," "Security objections that were successfully handled." Gong and Salesforce aren't built for that. Your internal tool should be.

**How it could work:**
- **Story Library filters:** Add "Topic" (multi-select from taxonomy: roi_financial_outcomes, security_compliance_governance, etc.) and "Funnel stage" (TOFU, MOFU, BOFU, etc.). These filter across all accounts the user can access.
- **Combined with existing:** Keep account filter, status filter, story type. Topic and funnel become additional dimensions.
- **Backend:** Stories have `filterTags` and `funnelStages`; chunks have `ChunkTag`. May need to aggregate or join. Ensure indexes support these filters efficiently.

**Implementation considerations:**
- Taxonomy is already defined. Expose as filter options. Consider a "Topic" dropdown with grouped options (BOFU topics, MOFU topics, etc.).
- Performance: Filtering by topic across many stories may need DB indexes or materialized views.

---

### 12. Taxonomy Browser

**What it is:** A page or panel to explore the taxonomy (topics and funnel stages) with counts. Click a topic to see matching stories, quotes, or calls. "How many stories do we have for ROI? For security objections?"

**Why it is:** Flexible search and tagging aligned to marketing strategy. The taxonomy is a product of your strategy: ROI, security, competitive displacement, etc. A browser makes it explorable instead of hidden in filters.

**How it could work:**
- **Hierarchy view:** Funnel stages as top level (TOFU, MOFU, BOFU, etc.). Under each, list topics with counts. E.g., "BOFU → ROI & Financial Outcomes (23 stories)."
- **Click-through:** Click "ROI & Financial Outcomes" → navigate to Story Library or Quote Library with that topic filter applied.
- **Counts:** Stories, quotes, or calls per topic. Could be org-wide or filtered by account.
- **Placement:** Standalone page ("Explore taxonomy") or a sidebar in Story Library / Quote Library.

**Implementation considerations:**
- Backend: Aggregate counts per topic from stories/chunks. Cache if expensive.
- Taxonomy is static (from taxonomy config). UI renders the structure and fetches counts.

---

### 13. Semantic Search in Story Library

**What it is:** In addition to text search, offer optional semantic search in Story Library. User types "ROI proof" or "security concerns" and gets results based on meaning, not just keyword match. Uses the same embedding/RAG infrastructure as Chat.

**Why it matters:** Search is your taxonomy, not theirs. Semantic search finds "ROI proof" even when the story says "4x return on investment" or "payback in 6 months." It complements taxonomy filters.

**How it could work:**
- **Search input:** Toggle or mode: "Keyword" vs "Semantic" (or default to semantic when query is natural language).
- **Backend:** Use existing RAG/Pinecone to search story content (or chunk content) by embedding. Return matching stories with relevance score.
- **Results:** Same list UI as text search, with optional relevance indicator.
- **Scope:** Account-scoped or org-wide, consistent with existing access control.

**Implementation considerations:**
- Stories may not be embedded today; chunks are. May need to embed story markdown or use chunk-level search and aggregate to stories.
- Cost: Each semantic query uses embedding API. Consider rate limits or caching for popular queries.

---

## Part 5: Cost Control Recommendations

### AI Paths (Current State)

There are **five main AI paths** in the application. Only one is currently instrumented for usage tracking and limits.

| # | Path | Service | AI Calls | Tracked? |
|---|------|---------|----------|----------|
| 1 | **Story generation** | `StoryBuilder` | Chat completions (narrative, quotes) | ✅ Yes (`TrackedAIClient`) |
| 2 | **RAG query** | `RAGEngine.query` | 1 embed + 1 chat completion | ❌ No |
| 3 | **RAG chat** | `RAGEngine.chat` | 1 embed + 1 chat completion | ❌ No |
| 4 | **Transcript tagging** | `AITagger.tagChunk` | 1 chat completion per chunk | ❌ No |
| 5 | **RAG indexing** | `RAGEngine.indexChunk` | 1 embed per chunk | ❌ No |

**Additional path (admin):** API key validation (`AIConfigService.validateApiKey`): minimal chat completion for key checks; typically excluded from usage limits.

**Implication for AI usage limits:** To enforce limits across the app, RAG (query, chat, indexing) and transcript tagging must be wired through the usage tracker. Today only story generation goes through `TrackedAIClient`.

---

### Call Ingestion & Sync Strategy

**What it is:** A simplified sync model that limits initial cost and defers full ingestion until needed. On initial sync, pull only the last 30 days of calls with a cap of 1,000 calls. Run periodic syncs (e.g., weekly) for incremental updates. When a user requests a story for an account, pull in all calls for that account from the call recording provider before building the story.

**Why it matters:** Cost control and operational simplicity. Tagging and indexing every call uses AI (transcript tagging + embeddings). A full historical backfill can be very expensive for large orgs. Limiting the initial sync keeps onboarding cost predictable. On-demand sync for the account ensures story generation always has complete data for the account the user cares about.

**How it could work:**

- **Initial sync:** Last 30 days only; max 1,000 calls. Tag and index into the database. No webhooks required.
- **Periodic sync:** Weekly (or configurable) batch sync for incremental updates across all accounts.
- **On-demand for stories:** When a user requests a story for account X, sync all calls for that account from the provider (no date limit, no cap for that account). Then build the story. Ensures the story has the fullest possible transcript corpus for that account.

**Implementation considerations:**

- Sync engine: Apply initial limits (30 days, 1,000 max) when `lastSyncAt` is null. Add `syncCallsForAccount(organizationId, accountId)` for on-demand account sync.
- Story build flow: Before `buildStory`, call account sync for the requested account. User may wait briefly while new calls are fetched and processed.
- RAG for that account will have fresh data after the story request, since on-demand sync indexes new calls.
- **Provider fallback:** If the call recording provider does not support date filtering (e.g., no `fromDateTime` or equivalent), do not fail. Fall back to the max-calls cap only: take the first N calls returned (e.g., 1,000) and stop. Providers typically return calls in reverse chronological order, so this still yields recent calls. The tool must never fail due to missing date support.

---

### 14. AI Usage Dashboard

**What it is:** A dashboard showing AI usage broken down by user, operation (story generation, chat, tagging), and optionally by time period. Admins must be able to see usage by user so they can trace costs and identify heavy consumers. Helps admins understand consumption and control costs.

**Why it matters:** Cost control. Teams care about preventing runaway AI usage, tracking consumption by team or use case, and enforcing budgets. If AI is part of the workflow, those controls belong in the same place. Per-user visibility is essential for cost attribution and governance.

**How it could work:**
- **Summary:** Total tokens or cost this month, vs last month. Trend chart.
- **By user (required):** Table or list of every user with tokens used, cost (if available), story count, and breakdown by operation. Admins need this to trace costs. Sort by tokens, cost, or user name. Export to CSV for reporting.
- **By operation:** Story generation, Chat (RAG), Transcript tagging. Bar chart or table. Drill down to per-user within each operation.
- **Filters:** Date range, operation, user.
- **Placement:** Under Billing or a new "AI Usage" admin page. OWNER or ADMIN only.

**Implementation considerations:**
- Backend: `AIUsageRecord` or equivalent. Aggregate by operation, user, date. May need new queries or analytics.
- Privacy: Per-user usage is admin-only. Consider role restrictions (ADMIN/OWNER).

---

### 15. AI Usage Limits (Per-User Quotas)

**What it is:** Admins can set per-user limits on AI usage, configurable by number of stories and/or number of tokens. Limits use specific increments (100k, 250k, 1m) and can be enforced weekly, monthly, or both (admin chooses in the UI). When a user hits a limit, AI operations are blocked or restricted until the period resets.

**Why it matters:** Cost control. Preventing runaway spend requires hard limits, not just visibility. Per-user quotas let admins cap heavy users while allowing normal usage. Weekly and monthly options support different billing cycles and review cadences.

**How it could work:**

**Limit types:**
- **By stories:** Limit number of story generations per period. E.g., "Max 10 stories per week."
- **By tokens:** Limit total tokens consumed per period. E.g., "Max 500k tokens per month."

**Token limit increments (UI selector):**
- **Up to 1M tokens:** Increments of 100,000 (abbreviated 100k). Options: 100k, 200k, 300k, 400k, 500k, 600k, 700k, 800k, 900k, 1M.
- **1M to 2M tokens:** Increments of 250,000 (abbreviated 250k). Options: 1.25M, 1.5M, 1.75M, 2M.
- **Past 2M tokens:** Increments of 1,000,000 (abbreviated 1M). Options: 3M, 4M, 5M, etc.

**Period configuration (UI field):**
- **Weekly OR monthly:** Admin selects one. E.g., "Limit resets weekly" or "Limit resets monthly."
- **Weekly AND monthly:** Admin can set both. E.g., "Max 500k tokens per week AND 2M per month." User is blocked when either limit is hit. UI shows two limit fields when "Both" is selected.

**Placement:** AI Usage or Billing admin page. Per-user limits could be set globally (default for all users) or overridden per user. Table: User, Story limit (weekly/monthly), Token limit (weekly/monthly), Current usage.

**Implementation considerations:**
- Backend: Store limits per user (or org default). Check cumulative usage at operation time. Block or return 429 when limit exceeded.
- Reset logic: Weekly = reset every Monday (or configurable day). Monthly = reset on 1st. Track period start/end per user.

---

### 16. Model Choice in Story Generator

**What it is:** When org policy permits, allow users (or admins) to select the AI model for story generation. E.g., "Use GPT-4o" vs "Use Claude" vs "Use org default."

**Why it matters:** Cost control and flexibility. Different models have different cost/quality tradeoffs. Some tasks may not need the most expensive model. Letting users or admins choose supports governance and cost optimization.

**How it could work:**
- **Story Generator modal:** Dropdown or radio: "Model: Org default (GPT-4o)" or "Model: Claude 3.5" (if configured). Only shown when org has multiple models and policy allows selection.
- **Admin config:** Org settings could restrict to "default only" (no choice) or "allow selection" (user picks from configured models).
- **Fallback:** If user doesn't care, default to org default. No change to current behavior when only one model is configured.

**Implementation considerations:**
- Backend: `AIConfigService` or equivalent already resolves model. Add optional `modelOverride` to story build request.
- Frontend: Fetch available models from API, render selector when policy permits.

---

### 17. Budget Alerts

**What it is:** Configurable thresholds (e.g., 80%, 90%, 100% of AI budget) that trigger in-app notifications or emails. "You've used 90% of your AI budget for this month."

**Why it matters:** Cost control. Preventing runaway spend requires visibility and alerts. Budget alerts give teams a chance to adjust before hitting limits.

**How it could work:**
- **Settings:** In Billing or AI config, admins set budget (tokens or dollars) and thresholds (e.g., 80%, 90%, 100%).
- **Notifications:** At 80%, show banner or toast: "AI usage at 80% of monthly budget." At 100%, optionally block or restrict AI operations until reset.
- **Recipients:** Notify OWNER, or a configurable list. In-app + optional email.
- **Reset:** Monthly or custom period. Align with billing cycle if possible.

**Implementation considerations:**
- Backend: Track cumulative usage per period. Compare to budget. Emit events or check on each AI operation.
- May integrate with existing notification system (email, in-app).

---

## Part 6: Permissions Recommendations

### 18. Action-level Permission Feedback

**What it is:** When an action is blocked due to permissions (e.g., Publish, Export, Delete), show a clear message: "You need Publish Named permission to publish with customer names. Contact your admin." Instead of a generic error or silent failure.

**Why it matters:** Permissions match content lifecycle. Marketing needs controls like who can publish, who can export, who can approve. If users don't know why they're blocked, they'll be frustrated and may try workarounds.

**How it could work:**
- **Disabled buttons:** Instead of hiding, show disabled with tooltip: "Publish Named requires admin approval."
- **Failed actions:** On 403 or permission error, show toast or modal: "You don't have permission to [action]. [Reason]. Contact [admin/owner] to request access."
- **Consistency:** Apply to Publish, Export, Delete, Edit Any, etc. Use a shared pattern for permission-denied messaging. Do not show permission-denied states for **creating approval requests**. Any Story Builder user with edit access can create approval requests via Publish when approval is required.

**Implementation considerations:**
- Backend: Return structured error with permission type or reason when possible.
- Frontend: Map error codes to user-friendly messages. Consider a permission lookup (e.g., "Publish Named" → "Allows publishing with customer names").

---

### 19. Clarify Raw vs. Scrubbed

**What it is:** In transcript and story views, indicate when content is raw (full transcript, unscrubbed) vs. scrubbed (PII removed, company names anonymized). Tie this to permissions where relevant (e.g., only users with "View raw" can see unscrubbed).

**Why it matters:** Permissions match content lifecycle. "Who can view raw transcripts vs. scrubbed excerpts" is a common requirement. The UI should make the distinction visible so users know what they're looking at.

**How it could work:**
- **Transcript Viewer:** Badge or label: "Raw transcript" or "Scrubbed view" (if a scrubbed mode exists). If user lacks permission for raw, show scrubbed by default and explain: "You're viewing a scrubbed version. Contact admin for raw access."
- **Story/Page preview:** When showing a story before publish, indicate "Preview (will be scrubbed on publish)" or "Preview (scrubbed)."
- **Export:** "This export contains [raw/scrubbed] content" so users know what they're downloading.

**Implementation considerations:**
- May require a "scrubbed" view of transcripts if not already built. Raw = current. Scrubbed = run PII masker on display.
- Permission: Add "View raw transcript" or similar to permission model if not present.

---

## Part 7: Optional Enhancements

Features below are optional variants or extensions of the core recommendations. They are not duplicates; they represent alternate UIs, richer modes, or later-phase additions. Core specs live in Parts 1–6.

- **Semantic search** mode for Story Library
- **Budget alerts** for AI spend
- **Model choice** for story generation
- **Taxonomy browser** with counts and click-through
- **Notifications for lifecycle changes**, in-app initially. Email optional later. Triggered when: request created, approved, rejected.

---

## Summary: Priority Order

For maximum alignment with the value proposition, implement in this order:

1. **Content Lifecycle view.** Single place for workflow
2. **Approval Flow (Simplified).** Four options: all require, anonymous OK, named OK, or all OK; approval permissions; unified **Publish** button (creates an approval request when required)
3. **Surface approval state to creators.** Governance visibility
4. **"My Queue" for creators.** Next-step states; reinforces adoption and makes approvals and lifecycle visible
5. **Quote Library (Two-Tier) + Provenance.** Auto quotes from ingestion; curated tier (promote, save from transcript); keyword search, filters, provenance deep links; v1 guardrails keep it shippable
6. **Pre-publish PII scan.** Governance in the pipeline
7. **Slack integration for approvals.** Approvers get requests in Slack; creators notified when approved (optional once in-app workflow is clear)
8. **Cross-account thematic search.** Your taxonomy, not theirs
9. **AI usage dashboard.** Per-user cost tracing
10. **AI usage limits.** Per-user quotas (stories, tokens; weekly/monthly; 100k/250k/1M increments)
11. **Action-level permission feedback.** Permissions match lifecycle
12. **Governance dashboard.** Compliance visibility
