# StoryEngine — Feature Status

**Last updated: March 4, 2026**

This document tracks feature status for StoryEngine. Many items previously listed as "missing" have been implemented in recent work (Feb–Mar 2026).

---

## Implemented (Previously Missing)

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Notification system | ✅ Implemented | `notification-service.ts`, `notification-routes.ts` — in-app and email notifications |
| 2 | Test suite | ✅ Implemented | 782+ tests (Vitest), unit + integration + e2e |
| 3 | Rate limiting | ✅ Implemented | `rate-limiter.ts` — API, webhook, password, export rate limiters |
| 4 | CSRF protection | ✅ Implemented | `csrf-protection.ts` — state-changing endpoints protected |
| 5 | Production monitoring | ✅ Implemented | Sentry (`lib/sentry.ts`), Winston logger, request logging |
| 6 | Export (PDF / DOCX) | ✅ Implemented | `pdf-export-worker.ts`, `landing-page-exports.ts`, export routes |
| 8 | Account / call browsing | ✅ Implemented | `accounts-routes`, `account-journey-routes`, `transcript-viewer-routes` |
| 9 | Collaboration / comments | ✅ Implemented | `story-comments-routes.ts` — comments on stories/pages |
| 13 | Scheduled publishing | ✅ Implemented | `scheduled-page-publish.ts` — cron-based delayed publish |
| 20 | Onboarding flow | ✅ Implemented | Setup wizard (`setup-routes`, `setup/` modules) |
| 22 | Outbound webhooks / event API | ✅ Implemented | `outbound-webhooks.ts` — customer event subscriptions |

---

## Partial Implementations

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 14 | Consistent pagination | Partial | Some endpoints use offset/limit; not fully standardized |
| 15 | Rich analytics | Partial | `viewCount` and aggregate stats; no per-visitor, scroll depth, or time-series |
| 16 | Comprehensive audit logging | Partial | Landing page edits tracked; permission changes, story gen, publish events need expansion |
| 17 | User-facing error visibility | Partial | BullMQ failures logged; dead-letter replay exists; user-facing retry UI limited |
| 18 | Accessibility (a11y) | Partial | Semantic HTML; Phase 6/7 accessibility end-pass completed (see roadmap) |

---

## Still Missing or Low Priority

| # | Feature | Impact | Notes |
|---|---------|--------|-------|
| 7 | Email sharing | Medium | Landing pages have shareable links; no "send via email" button |
| 10 | Custom branding | Medium (High for Enterprise) | Per-page `customCss` exists; no org-wide theme (logo, colors, fonts) |
| 11 | Landing page templates | Medium | Fixed layout; no template gallery or reusable presets |
| 12 | Bulk operations | Medium | Single-item endpoints only; no batch publish/archive/delete |
| 19 | User profile / preferences | Low | Minimal user fields; no profile editing or notification prefs |
| 21 | Internationalization (i18n) | Low | `i18n-foundation.md` exists; string extraction not complete |

---

## Summary

As of March 2026, the critical gaps (test suite, rate limiting, CSRF, monitoring, export, notifications, comments, scheduled publishing, outbound webhooks, account browsing, onboarding) have been addressed. Remaining work is primarily polish, enterprise features (branding), and lower-priority UX improvements.

See `StoryEngine-Consolidated-Roadmap.md` for the full T01–T73 execution status and `PRODUCTION-READINESS-TASKS.md` for deployment checklist.
