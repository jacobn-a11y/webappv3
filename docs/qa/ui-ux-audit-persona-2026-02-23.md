# StoryEngine UI/UX Persona Audit

Date: 2026-02-23  
Scope: Frontend persona surfaces, route/role UX, design-system consistency, mobile responsiveness, and perceived consumer-grade polish.

## Method

- Reviewed route/nav logic and role gates in app shell.
- Reviewed all primary persona pages: Home, Accounts/Journey, Pages dashboard/editor, Chat, Analytics, Workspaces, Writebacks, Automations, Admin pages, Platform Owner, Auth/Invite, Status.
- Cross-checked class names used in pages against `index.css` selectors to detect styling drift.

## Executive Summary

Overall quality is **not yet consumer-grade** due to systemic styling drift and context/navigation defects:

- Multiple high-traffic screens render with missing or partial styling because page class names no longer match CSS selectors.
- Persona journeys still rely on hard-coded account IDs, creating broken context and incorrect navigation for non-demo data.
- Access model UX is inconsistent: some high-risk routes are ungated at route level, while denied routes often redirect silently.

## Scorecard (1-10)

| Dimension | Score | Notes |
|---|---:|---|
| Persona clarity | 6 | Persona dashboards exist, but account context is hard-coded and route-level guard behavior is inconsistent |
| Navigation intuitiveness | 5 | Sidebar structure is generally clear but overloaded and contains duplicate/workflow ambiguity |
| Visual consistency | 4 | Significant class/CSS mismatch across several major pages |
| Consumer-grade polish | 4 | Many pages look utilitarian/unfinished due to missing styles and inconsistent UI patterns |
| Mobile usability | 5 | App shell responsive, but several forms use fixed inline 2-column grids |
| Accessibility/feedback | 6 | Focus styles and some aria usage are present; denied-state and route feedback patterns are inconsistent |

## Persona Findings

| Persona | Current UX | Key Risks |
|---|---|---|
| OWNER / ADMIN | Broad feature access and dense operations surfaces | Overloaded information architecture and inconsistent visual quality across admin tools |
| MEMBER (Marketing/Sales/CSM) | Persona-specific home views exist | Core actions route to fixed account IDs; context can be wrong for real tenants |
| VIEWER / EXEC | Limited creation actions on several pages | Can still hit routes that should be role-restricted at route level; denial UX inconsistent |
| Platform Owner | Dedicated dashboard exists | Route is mounted without route-level role guard, causing confusing access behavior |
| Public / Invite | Basic flows are present | Minimal onboarding guidance and weak trust-building/polish compared to product interior |

## Prioritized Findings

### P0

1. **Critical style-system drift across core pages (unstyled/partially styled experiences)**
   - Evidence:
     - Dashboard uses `dash-pages__filters`, `dash-pages__table-wrap`, `dash-pages__search-input` classes that have no matching selectors, while CSS defines older names such as `dash-pages__toolbar`/`dash-pages__table-wrapper`.
     - Chat page uses `chat__bubble`, `chat__account-trigger`, `chat__empty`, while CSS defines `chat__message-bubble`, `chat__account-btn`, `chat__empty-state`.
     - Permissions page uses `admin-perms__*` while CSS only defines `admin-perm__*`.
     - Account Access and Editor modal have many class names with no selector coverage in global CSS.
   - Repro:
     1. Open Pages dashboard, Chat connector, Permissions, Account Access, and Publish modal.
     2. Compare rendered layout against expected design-system styling.
     3. Observe partially/unstyled controls and inconsistent spacing/typography.

2. **Hard-coded account context breaks persona journeys**
   - Evidence:
     - Accounts nav and multiple CTAs route to `/accounts/acc_meridian`.
   - Repro:
     1. Log into an org that does not use `acc_meridian`.
     2. Click Accounts/Home CTA/Create Page CTA.
     3. Observe navigation to incorrect/fixed account context.

3. **Platform route mounted without route-level role guard**
   - Evidence:
     - `/platform` route is mounted directly, unlike other sensitive routes wrapped in `ProtectedRoute`.
   - Repro:
     1. Log in as non-owner user.
     2. Navigate directly to `/platform`.
     3. Observe route resolves to page shell instead of immediate role denial at route boundary.

### P1

4. **Permissions page style namespace mismatch causes poor legibility and alignment**
   - Evidence:
     - JSX uses `admin-perms__...`, CSS defines `admin-perm__...`.
   - Repro:
     1. Open `/admin/permissions`.
     2. Verify table/toggle visual treatment is inconsistent with design system.

5. **Create/Edit page flows are partially unstyled in publish modal**
   - Evidence:
     - Publish modal classes (`page-editor__field`, `page-editor__text-input`, `page-editor__preview-*`) do not have corresponding selectors in `index.css`.
   - Repro:
     1. Open any landing page editor.
     2. Click Publish.
     3. Observe modal presentation deviates from polished card/form system.

6. **Chat connector UI naming drift degrades perceived quality**
   - Evidence:
     - New chat markup classes do not match existing chat CSS selector names.
   - Repro:
     1. Open `/chat`.
     2. Verify header/thread/bubble treatments are inconsistent.

7. **Silent authorization redirects reduce user confidence**
   - Evidence:
     - `ProtectedRoute` defaults to redirect home instead of a consistent denied explanation.
   - Repro:
     1. Attempt restricted route as unauthorized role.
     2. User is redirected with limited context, creating confusion.

8. **CSM/workspace nav logic includes duplicate insertion path**
   - Evidence:
     - `buildNav` includes two `workspaces` pushes under CSM-related conditions.
   - Repro:
     1. Log in as CSM/admin-variant and inspect nav composition states.
     2. Observe duplicate-path logic complexity and potential duplication risk.

9. **Mobile form responsiveness gaps on operational pages**
   - Evidence:
     - Several pages use inline fixed 2-column grids (`gridTemplateColumns: "1fr 1fr"`), which are not media-query aware.
   - Repro:
     1. Open Writebacks/Automations on narrow viewport.
     2. Observe compressed controls and reduced input readability.

### P2

10. **Design-system leakage via inline style overrides**
   - Evidence:
     - Repeated inline style overrides in shell and page tables/buttons, reducing consistency and maintainability.

11. **Mixed styling architecture increases drift**
   - Evidence:
     - Global `index.css`, legacy selector blocks, and page-local `<style>` injection in Transcript viewer coexist.

12. **Account detail header content quality is placeholder-like**
   - Evidence:
     - Account name is hard-coded as `"Account"` in detail page instead of loaded account identity.

## Evidence References

- [App.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/App.tsx:204)
- [App.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/App.tsx:225)
- [App.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/App.tsx:261)
- [App.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/App.tsx:269)
- [App.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/App.tsx:574)
- [ProtectedRoute.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/components/ProtectedRoute.tsx:17)
- [DashboardPagesPage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/DashboardPagesPage.tsx:496)
- [DashboardPagesPage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/DashboardPagesPage.tsx:595)
- [DashboardPagesPage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/DashboardPagesPage.tsx:403)
- [ChatbotConnectorPage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/ChatbotConnectorPage.tsx:243)
- [ChatbotConnectorPage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/ChatbotConnectorPage.tsx:394)
- [ChatbotConnectorPage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/ChatbotConnectorPage.tsx:345)
- [LandingPageEditorPage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/LandingPageEditorPage.tsx:580)
- [LandingPageEditorPage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/LandingPageEditorPage.tsx:658)
- [AdminPermissionsPage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/AdminPermissionsPage.tsx:193)
- [AdminAccountAccessPage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/AdminAccountAccessPage.tsx:879)
- [HomePage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/HomePage.tsx:24)
- [HomePage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/HomePage.tsx:425)
- [AccountJourneyPage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/AccountJourneyPage.tsx:297)
- [AccountDetailPage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/AccountDetailPage.tsx:17)
- [AutomationsPage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/AutomationsPage.tsx:80)
- [WritebacksPage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/WritebacksPage.tsx:74)
- [index.css](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/index.css:2704)
- [index.css](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/index.css:2724)
- [index.css](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/index.css:2591)
- [index.css](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/index.css:2635)
- [index.css](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/index.css:2908)
- [index.css](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/index.css:3163)
- [TranscriptViewerPage.tsx](/Users/jacobnikolau/Documents/Codex/webappv3-release-2026-02-23/frontend/src/pages/TranscriptViewerPage.tsx:883)

## Recommended Remediation Sequence

1. Fix class-name/CSS alignment for Pages, Chat, Permissions, Account Access, and Editor modal.  
2. Remove hard-coded account IDs and route all account CTAs through selected/default account resolution.  
3. Add route-level guard for `/platform` and standardize denied-state UX (single reusable component).  
4. Remove inline fixed two-column form grids in favor of responsive utility classes.  
5. Consolidate style architecture (single naming convention, remove stale selectors, minimize page-scoped style blocks).

