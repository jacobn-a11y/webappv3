# StoryEngine — Missing Features Analysis

## Overview

This document identifies features that are absent or incomplete in StoryEngine that users of a B2B SaaS sales-enablement / case-study platform would typically expect.

---

## Critical Gaps

### 1. No Notification System
- **Impact**: High
- No email or in-app notifications for any events (story generated, page published, transcript processing failed, trial expiring).
- For a PLG product with a 14-day free trial, trial expiration warnings are essential for conversion.
- No email-sending library (SendGrid, Mailgun, SES, Nodemailer) in dependencies.

### 2. No Test Suite
- **Impact**: High
- Zero test files (no `.test.ts`, `.spec.ts`, or test directories).
- No testing framework in `package.json` (no Jest, Mocha, Vitest, or similar).
- For a product handling PII masking, billing, and access control, this is a significant risk.

### 3. No Rate Limiting
- **Impact**: High
- No throttling middleware on any API endpoint.
- AI-powered endpoints (`/api/stories/build`, `/api/rag/query`) carry real OpenAI/Pinecone costs per request.
- No `express-rate-limit` or equivalent in dependencies.
- Only concurrency control is BullMQ's 3-worker limit for transcript processing.

### 4. No CSRF Protection
- **Impact**: High
- State-changing endpoints (POST, PATCH, DELETE) have no CSRF tokens.
- Relies solely on CORS headers and auth middleware.
- No `csurf` or equivalent library.

### 5. No Production Monitoring / APM
- **Impact**: High
- Winston is a dependency but appears unused in the codebase.
- No Sentry, Datadog, New Relic, or any error-tracking / APM integration.
- Debugging relies on ~41 `console.log`/`console.error` calls scattered across services.

---

## Feature Gaps Users Would Notice

### 6. No Export (PDF / DOCX)
- **Impact**: High
- Stories and landing pages are only viewable as HTML.
- Sales reps typically need downloadable formats for email attachments and pitch decks.
- No PDF/DOCX generation library in dependencies.

### 7. No Email Sharing
- **Impact**: Medium
- Landing pages have shareable public links (with optional password protection).
- No "send via email" feature — users must manually copy the link.

### 8. No Account or Call Browsing
- **Impact**: High
- No API endpoints to list CRM accounts, view account details, browse individual calls, or read full transcripts.
- Users interact with call data only indirectly through story generation and RAG queries.
- Expected endpoints like `GET /api/accounts`, `GET /api/accounts/:id`, `GET /api/calls/:id` do not exist.

### 9. No Collaboration Features
- **Impact**: Medium
- No comments, feedback threads, or @mentions on stories or landing pages.
- `OrgSettings.requireApprovalBeforePublish` flag exists in schema, but no approval workflow endpoint is implemented.
- Single-user editing only; no real-time co-editing.

### 10. No Custom Branding
- **Impact**: Medium (High for Enterprise)
- Landing page CSS is hardcoded: indigo color scheme, Inter + Georgia fonts.
- Per-page `customCss` field exists, but no org-wide theme settings (logo, colors, fonts).
- Enterprise customers typically require white-labeling.

### 11. No Landing Page Templates
- **Impact**: Medium
- Every page starts from a generated story with a fixed HTML layout.
- No template gallery or reusable custom templates.
- Story types exist (`FULL_JOURNEY`, `ROI_ANALYSIS`, etc.) but don't map to visual templates.

### 12. No Bulk Operations
- **Impact**: Medium
- All page operations (publish, archive, delete) are single-item via `/:pageId` endpoints.
- No batch endpoints for managing multiple pages at once.
- No CSV/bulk import or export.

### 13. No Scheduled Publishing
- **Impact**: Low–Medium
- `POST /:pageId/publish` publishes immediately (`publishedAt: new Date()`).
- Expiration dates exist for links, but publish scheduling does not.
- No cron job or delayed-publish queue.

---

## Partial Implementations

### 14. Inconsistent Pagination
- **Impact**: Medium
- Dashboard `GET /api/dashboard/pages` returns all results with no `offset`/`limit` parameters.
- `LandingPageEdit` history caps at 20 entries via `.take(20)`.
- No standard pagination pattern (cursor-based or offset-based) across list endpoints.
- **Files**: `src/api/dashboard-routes.ts:106-121`, `src/services/landing-page-editor.ts:287-307`

### 15. Shallow Analytics
- **Impact**: Medium
- Landing pages track a `viewCount` integer only.
- No per-visitor data: identity, timestamps, engagement time, scroll depth, or link clicks.
- Dashboard stats are aggregate counts (total pages, total views) with no time-series trends.
- **Files**: `src/services/landing-page-editor.ts:408-453`

### 16. Narrow Audit Logging
- **Impact**: Medium
- Landing page edits are tracked with before/after body snapshots and user attribution.
- No audit trail for: permission changes, story generation, publish/unpublish events, account access modifications, or login activity.
- **Files**: `prisma/schema.prisma:389-403`

### 17. No User-Facing Error Visibility
- **Impact**: Medium
- BullMQ worker failures are logged to console but not surfaced to users.
- No endpoint to list failed transcript processing jobs or retry them.
- API errors return generic `{ error: "Failed to X" }` messages.
- **Files**: `src/index.ts:84-86`

### 18. Minimal Accessibility (a11y)
- **Impact**: Medium
- Public landing pages use semantic HTML (`<article>`, `<section>`, `<h1>–<h3>`).
- Missing: ARIA attributes, image alt text, skip-to-content links, keyboard navigation, focus management, WCAG 2.1 color contrast compliance.
- **Files**: `src/api/public-page-renderer.ts:127-372`

---

## Lower Priority but Expected

### 19. No User Profile / Preferences
- User model has minimal fields (email, name, role).
- No profile editing, notification preferences, or personal settings endpoints.

### 20. No Onboarding Flow
- No setup wizard, guided tour, or getting-started checklist for new users.

### 21. No Internationalization (i18n)
- All text is English-only.
- `Transcript.language` field defaults to `"en"` but is never utilized for localization.

### 22. No Outbound Webhooks / Event API
- Incoming webhooks from Merge.dev and Stripe exist.
- No mechanism for customers to subscribe to StoryEngine events for their own integrations.

---

## Summary Table

| #  | Feature                       | Status       | Impact |
|----|-------------------------------|--------------|--------|
| 1  | Notifications                 | Missing      | High   |
| 2  | Test suite                    | Missing      | High   |
| 3  | Rate limiting                 | Missing      | High   |
| 4  | CSRF protection               | Missing      | High   |
| 5  | Production monitoring / APM   | Missing      | High   |
| 6  | Export (PDF / DOCX)           | Missing      | High   |
| 7  | Email sharing                 | Missing      | Medium |
| 8  | Account / call browsing       | Missing      | High   |
| 9  | Collaboration / comments      | Missing      | Medium |
| 10 | Custom branding               | Missing      | Medium |
| 11 | Landing page templates        | Missing      | Medium |
| 12 | Bulk operations               | Missing      | Medium |
| 13 | Scheduled publishing          | Missing      | Low    |
| 14 | Consistent pagination         | Partial      | Medium |
| 15 | Rich analytics                | Partial      | Medium |
| 16 | Comprehensive audit logging   | Partial      | Medium |
| 17 | User-facing error visibility  | Partial      | Medium |
| 18 | Accessibility (a11y)          | Partial      | Medium |
| 19 | User profile / preferences    | Missing      | Low    |
| 20 | Onboarding flow               | Missing      | Low    |
| 21 | Internationalization (i18n)   | Missing      | Low    |
| 22 | Outbound webhooks / event API | Missing      | Low    |
