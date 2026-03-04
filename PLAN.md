# StoryEngine UI/UX Audit — Implementation Plan

Based on the comprehensive audit in `storyengine-ui-ux-audit.md`, this plan maps every identified issue to concrete code changes across the frontend codebase. The project uses vanilla CSS with CSS custom properties (already defined in `themes.css`), React 18 with React Router, and BEM-like class naming.

**Key finding:** The codebase already has a reasonable design token system in `themes.css` and many component CSS classes in `components.css`. The audit's "no design system" finding is partially addressed — the real gap is *inconsistent usage* of existing tokens and *missing shared React components* that enforce the patterns.

---

## Phase 1: Foundation — Design System Enforcement & Critical Bugs
**Files touched:** `themes.css`, `components.css`, `layout.css`, plus new shared React components

### Step 1.1: Audit & Harden Design Tokens in `themes.css`
**Audit ref:** 1.1 (No Design Token System)

The token system already exists (`--neutral-*`, `--blue-*`, `--color-accent`, `--space-*`, `--radius-*`). The gap is inconsistent usage.

**Changes:**
- `frontend/src/styles/themes.css` — Add missing tokens that the audit calls for:
  - Typography scale tokens: `--font-xs`, `--font-sm`, `--font-base`, `--font-lg`, `--font-xl`, `--font-2xl`, `--font-3xl` with corresponding `--leading-*` line-height tokens
  - Semantic color aliases: `--color-warning` (currently missing — map to yellow/amber), `--color-info` (map to blue-lighter)
  - Verify `--shadow-sm`, `--shadow-md` exist for cards/dropdowns (currently `--shadow-lg` only)
- `frontend/src/styles/components.css` — Replace any remaining hardcoded color/spacing values with token references. Search for hardcoded `#` hex colors, raw `px` padding/margin values not using tokens, and raw `font-size` values.
- `frontend/src/styles/accounts.css`, `admin.css`, `analytics.css`, `stories.css`, `pages.css`, `transcript.css` — Same token enforcement pass across all page-specific CSS files.

### Step 1.2: Standardize Button Hierarchy
**Audit ref:** 1.2 (Button Hierarchy is Broken)

The existing `.btn`, `.btn--primary`, `.btn--ghost`, `.btn--sm` classes exist in `components.css`. The gaps:

**Changes:**
- `frontend/src/styles/components.css` — Add/update button variants:
  - `.btn--secondary` (outlined style — currently this is `.btn--ghost` which is used inconsistently)
  - `.btn--tertiary` (text-only, minimal style)
  - `.btn--destructive` (outlined red, filled red on hover) — currently `.btn--danger-text` exists but is inconsistent
  - `.btn--icon` (square icon-only button with tooltip support)
  - Ensure all buttons have proper `:hover`, `:active`, `:focus-visible` states
  - Add max "one primary per section" guideline via documentation comment

### Step 1.3: Build Shared `OverflowMenu` Component
**Audit ref:** 1.2, 2.4, 2.6 (9 action buttons per card)

This is the single highest-impact new component — it collapses action buttons into a `⋯` dropdown.

**New file:** `frontend/src/components/OverflowMenu.tsx`
- Props: `items: Array<{ label: string; icon?: ReactNode; onClick: () => void; variant?: 'default' | 'destructive'; disabled?: boolean }>`
- Renders a `⋯` button that opens a positioned dropdown menu
- Handles click-outside-to-close, keyboard navigation (arrow keys, Escape)
- Destructive items shown in red with separator above them

**CSS additions in `components.css`:**
- `.overflow-menu`, `.overflow-menu__trigger`, `.overflow-menu__dropdown`, `.overflow-menu__item`, `.overflow-menu__item--destructive`, `.overflow-menu__divider`

### Step 1.4: Build Shared `EmptyState` Component
**Audit ref:** 1.4 (Empty States Are Generic and Unhelpful)

**New file:** `frontend/src/components/EmptyState.tsx`
- Props: `icon?: ReactNode; title: string; message: string; actionLabel?: string; onAction?: () => void; learnMoreUrl?: string`
- Renders centered layout with icon, title, description, primary CTA button, and optional learn-more link

**CSS additions in `components.css`:** — `.state-view` already exists but needs enhancement:
- Ensure `.state-view` has consistent padding, centered layout, and proper sizing for the icon/title/message/action pattern

### Step 1.5: Fix Critical Bugs
**Audit ref:** 1.4 (Writebacks truncated text), 4.2 (Journey/Transcript error messages)

**Changes:**
- `frontend/src/pages/WritebacksPage.tsx` — The empty state message currently reads "Writebacks will appear here when data is synced back to your CRM." — verify this is not truncated in the rendered output. If the text is cut off in the CSS, check for `overflow: hidden` / `text-overflow: ellipsis` on `.state-view__message` and fix.
- `frontend/src/pages/AccountJourneyPage.tsx` — Change error handling: when API returns 403/permission error, show `<AccessDenied />` component instead of "Failed to load account journey" error string.
- `frontend/src/pages/TranscriptViewerPage.tsx` — Same pattern: when API returns 403, show `<AccessDenied />` instead of "Call not found" message. Import `AccessDenied` from `../components/ProtectedRoute`.

### Step 1.6: Skeleton Loading States
**Audit ref:** 1.5 (No Loading States or Skeleton UI)

`PageSkeleton.tsx` already exists and is used as the `Suspense` fallback.

**Changes:**
- `frontend/src/components/PageSkeleton.tsx` — Enhance to support variants: `variant?: 'table' | 'cards' | 'form' | 'dashboard'` that render layout-appropriate skeleton shapes
- `frontend/src/styles/components.css` — The `.skeleton` and `.skeleton-*` classes already exist; ensure shimmer animation is present and that skeleton blocks match real content dimensions
- Add page-specific skeleton usage in pages that currently show blank/spinner while loading (AccountDetailPage, StoryLibraryPage, AnalyticsDashboardPage, etc.)

---

## Phase 2: Core Screen Rebuilds

### Step 2.1: Restructure Sidebar Navigation
**Audit ref:** 1.7 (Sidebar Navigation Needs Restructuring)

**Changes:**
- `frontend/src/app/nav-config.tsx` — Restructure `buildNav()` to produce:
  - **CORE** group (always visible): Home, Accounts, Stories, Pages, Analytics
  - **TOOLS** group (collapsible): Chat, Automations, Writebacks, Workspaces
  - **ADMIN** group (Owner/Admin only, collapsible): Merge current 11 items into 6:
    - "Users & Access" → `/admin/account-access` (consolidate permissions + roles links as sub-items or tabs)
    - "Story Settings" → `/admin/story-context` (plus link to publish-approvals)
    - "Security" → `/admin/security` (plus governance, data-quality as tabs)
    - "Operations" → `/admin/ops` (plus audit-logs, status as tabs)
    - "Setup" → `/admin/setup`
    - "Billing" → `/admin/billing` (Owner only)
  - Move Profile + Account Settings to sidebar footer
- `frontend/src/app/Sidebar.tsx` — Update rendering to support section headers ("CORE", "TOOLS", "ADMIN") with collapsible group behavior. Add user avatar + role badge in footer area.
- `frontend/src/styles/layout.css` — Add styles for section headers (`.sidebar__section-label`), footer user area (`.sidebar__footer`)

### Step 2.2: Redesign Home Dashboard
**Audit ref:** 2.2 (Home / Dashboard)

**Changes to `frontend/src/pages/HomePage.tsx`:**
- Fix greeting capitalization — capitalize first letter of username
- Replace flat layout with structured sections:
  1. **Hero section:** Greeting with properly capitalized name + role-specific subtitle + 3-4 quick-action cards (using existing card styles)
  2. **Metrics strip:** Horizontal row of clickable KPI cards with `cursor: pointer` and hover states. Wrap each in `<Link>` to the relevant detail page.
  3. **Two-column grid below:** Left column = Recent Stories table; Right column = Recommended Actions + Risk Indicators
- Make "Recommended Next Actions" items clickable with actual navigation links
- Use standardized Alert component for Risk Indicators instead of custom yellow box
- Add role-specific dashboard variants (audit ref 4.3):
  - OWNER: system health + pending actions + org metrics + admin quick links
  - MEMBER: my accounts + my stories + generate CTA + chat quick link
  - VIEWER: published stories + read-only metrics + page view analytics

**CSS changes in `pages.css`:**
- Add `.home__hero`, `.home__metrics-strip`, `.home__two-col` grid layout classes
- Add `.home__quick-action` card styles

### Step 2.3: Fix Stories Page — Reduce Action Button Overload
**Audit ref:** 2.6 (Stories / Story Library — 9 action buttons per card)

**Changes to `frontend/src/pages/StoryLibraryPage.tsx`:**
- Redesign story card layout:
  - Top row: Status badge (larger, more prominent) + date
  - Title as primary text (bold)
  - Account name + story type as subtitle
  - Description clamped to 2 lines with `text-overflow: ellipsis` (same card heights)
  - Bottom: 2 visible buttons max (View/Edit as primary, Edit as secondary) + `<OverflowMenu>` for remaining actions (Share, Copy, PDF, DOCX, CRM Note, Push CRM, Comments, Delete)
- Move "Delete" into the overflow menu as a destructive item with confirmation dialog
- Fix view toggle (Seller Cards / Bulk Table) — use proper `.btn--secondary` active state styling
- Add `aria-current` to active toggle button

**CSS changes in `stories.css`:**
- `.story-card__description` — Add `display: -webkit-box; -webkit-line-clamp: 2; overflow: hidden;` for consistent card heights
- `.story-card__actions` — Reduce to flex row with gap between 2 buttons + overflow trigger
- `.story-card__status` — Larger badge styling

### Step 2.4: Fix Accounts Index Page
**Audit ref:** 2.3 (Accounts Index)

**Changes to `frontend/src/pages/AccountsIndexPage.tsx`:**
- Make account name the primary clickable element (styled as blue link, bold)
- Replace 3 action buttons per row with: clicking the row navigates to detail + overflow menu (`⋯`) for "Generate Story" and "Journey"
- Add cursor-pointer to rows
- Compact the search bar width

**CSS changes in `accounts.css`:**
- `.account-list__name` — Add `color: var(--color-accent); font-weight: 700; cursor: pointer;`
- `.data-table tr` — Add `cursor: pointer` for clickable rows

### Step 2.5: Fix Account Detail Page
**Audit ref:** 2.4 (Account Detail Page)

**Changes to `frontend/src/pages/AccountDetailPage.tsx`:**
- Add tabbed navigation below the header: Overview | Stories | Calls | Contacts | Journey
- Collapse story action buttons per row into: primary View/Edit button + `<OverflowMenu>` for exports/delete
- Move Delete into overflow menu with `<ConfirmDialog>` (already exists as component)
- Add breadcrumb: Accounts > {Account Name} (using existing `<Breadcrumb>` component)

**CSS changes in `accounts.css`:**
- Add `.account-detail__tabs` tab navigation styles
- Ensure consistent story action layout

### Step 2.6: Standardize All Tables
**Audit ref:** 1.3 (Inconsistent Table Design)

The `.data-table` class exists in `components.css` but isn't used consistently.

**Changes:**
- `frontend/src/styles/components.css` — Enhance `.data-table`:
  - Header: use token background color, consistent font size + weight + tracking
  - Row hover: `tr:hover { background: var(--surface-hover); }`
  - Left-align all headers by default
  - Actions column: `.data-table__actions { text-align: right; }`
  - Standardize pagination below table: `.data-table__pagination`
- Apply `.data-table` consistently across all pages that currently use custom table styles:
  - `AccountsIndexPage.tsx`, `AccountDetailPage.tsx`, `DashboardPagesPage.tsx`, `AdminAuditLogsPage.tsx`, `WritebacksPage.tsx`, `AutomationsPage.tsx`, `StoryLibraryPage.tsx` (bulk table view)

---

## Phase 3: Forms, Interaction & Feedback

### Step 3.1: Redesign Form Layouts
**Audit ref:** 2.14 (Writebacks), 2.15 (Automations), 2.12 (Profile Center)

**Changes:**
- `frontend/src/pages/WritebacksPage.tsx`:
  - Replace raw Account ID text input with a searchable `<select>` dropdown populated from the accounts API
  - Add feature explanation text above form: "Writebacks push story insights back to your CRM..."
  - Fix form layout to use consistent `.form-group` spacing
- `frontend/src/pages/AutomationsPage.tsx`:
  - Group form into logical sections: Trigger Config → Conditions → Delivery
  - Add unit label next to Threshold field (%, count, etc.)
  - Add helpful tooltips for metric/trigger descriptions
  - Improve empty state with explanation + templates
- `frontend/src/pages/ProfileCenterPage.tsx`:
  - Show Role as a read-only badge/chip instead of a disabled input field
  - Add explicit "Save Preferences" button (or auto-save indicator)
  - Add descriptions under each preference toggle
  - Switch to single-column form layout

### Step 3.2: Add Hover & Focus States
**Audit ref:** 1.6 (Missing Hover & Focus States)

**CSS changes across multiple files:**
- `frontend/src/styles/components.css`:
  - Buttons: verify `:hover` darkens by 10%, `:active` by 15%, `:focus-visible` shows ring
  - `.kpi-card`: Add `cursor: pointer; transition: var(--transition-fast);` and `:hover { border-color: var(--color-accent); }`
  - `.card--interactive`: Add `:hover` elevation (border color change, since no-shadow brand)
  - Form inputs: verify `:focus` ring
- `frontend/src/styles/layout.css`:
  - Sidebar links: ensure `.sidebar__link:hover` has background change and `.sidebar__link--active` has accent indicator
- `frontend/src/styles/accounts.css`, `analytics.css`, `stories.css`:
  - Table rows: `.data-table tbody tr:hover { background: var(--surface-hover); }`
  - Clickable cards: add `cursor: pointer`

### Step 3.3: Enhance Loading Skeletons per Page
**Audit ref:** 1.5 (No Loading States)

**Changes:**
- For each page that uses `setLoading(true)` → show a page-specific skeleton instead of empty space or a spinner:
  - `StoryLibraryPage.tsx` — skeleton grid of card placeholders
  - `AccountsIndexPage.tsx` — skeleton table rows
  - `AnalyticsDashboardPage.tsx` — skeleton metric cards + chart placeholders
  - `AccountDetailPage.tsx` — skeleton header + skeleton table
  - `HomePage.tsx` — skeleton greeting + skeleton metric strip + skeleton story rows
- Use the already-defined `.skeleton`, `.skeleton-row`, `.skeleton-text` classes from `components.css`

### Step 3.4: Redesign Empty States
**Audit ref:** 1.4 (Generic Empty States)

Using the new `<EmptyState>` component from Step 1.4, replace inline empty states across:
- `WorkspacesPage.tsx` — icon + "No workspaces yet" + "Workspaces help you organize your team's content and collaborate on stories." + "Create Workspace" CTA
- `WritebacksPage.tsx` — icon + "No writebacks yet" + "Writebacks push story insights back to your CRM. Create one to sync data automatically." + "Create Writeback" CTA
- `AutomationsPage.tsx` — icon + "No automation rules yet" + "Automations trigger actions based on metrics and events. Set up your first rule." + "Create Rule" CTA
- `ChatbotConnectorPage.tsx` — Better guidance with suggested prompts and capabilities overview
- `StoryLibraryPage.tsx` (empty search) — "No stories match your search"

---

## Phase 4: Admin Pages & Advanced Features

### Step 4.1: Admin Permissions Page
**Audit ref:** 3.2 (Permissions)

**Changes to `frontend/src/pages/AdminPermissionsPage.tsx`:**
- Replace checkboxes with toggle switches (better touch targets, clearer on/off)
- Add "Select All" toggle per role column
- Group permissions into categories with section headers
- Improve contrast on the permission matrix

### Step 4.2: Admin Roles Page
**Audit ref:** 3.3 (Roles)

**Changes to `frontend/src/pages/AdminRolesPage.tsx`:**
- Add visual role hierarchy display: Owner → Admin → Member → Viewer
- Show inherited permissions at each level
- Use card layout per role instead of flat list

### Step 4.3: Admin Audit Logs Page
**Audit ref:** 3.5 (Audit Logs)

**Changes to `frontend/src/pages/AdminAuditLogsPage.tsx`:**
- Add filter bar: date range picker, user selector, action type dropdown
- Use monospace font for IDs (`.code--sm` already exists)
- Add "Export to CSV" button
- Color-code action types with badges

### Step 4.4: Admin Security Page
**Audit ref:** 3.7 (Security)

**Changes to `frontend/src/pages/AdminSecurityPolicyPage.tsx`:**
- Add security posture summary at top: checklist with green/yellow indicators
- Show which settings are configured vs. need attention
- Use consistent card sections for each security area

### Step 4.5: Admin Setup Wizard
**Audit ref:** 3.10 (Setup Wizard)

**Changes to `frontend/src/pages/AdminSetupWizardPage.tsx`:**
- Redesign as true step-by-step wizard with:
  - Progress indicator (`.steps` component already exists in CSS)
  - Completion status per step
  - "Next Step" button flow
  - Success state when all steps complete

### Step 4.6: Admin Operations Page
**Audit ref:** 3.6 (Operations)

**Changes to `frontend/src/pages/AdminOpsDiagnosticsPage.tsx`:**
- Add visual queue health bars (progress bar component exists in CSS)
- Show job counts by status with badges
- Add one-click retry buttons for failed jobs

### Step 4.7: Admin Billing Page
**Audit ref:** 3.11 (Billing)

**Changes to `frontend/src/pages/AdminBillingReadinessPage.tsx`:**
- Standardize button styling to match system-wide button hierarchy
- Use consistent card layout

### Step 4.8: Account Settings Page
**Audit ref:** 3.13 (Account Settings)

**Changes to `frontend/src/pages/AccountSettingsPage.tsx`:**
- Increase font sizes, add section headers with descriptions
- Improve contrast ratios (use token colors that meet WCAG AA)

---

## Phase 5: Specific Page Improvements

### Step 5.1: Auth / Login Page
**Audit ref:** 2.1 (Login / Auth Page)

**Changes to `frontend/src/pages/AuthPage.tsx`:**
- Add logo + product name ("StoryEngine") above the form
- Add "Forgot password?" link below password field
- Add password show/hide toggle button
- Add product tagline or value prop text

**CSS changes in `auth.css`:**
- `.auth-card` — Add logo/branding area styles
- `.auth__forgot-link` — Styles for forgot password link

### Step 5.2: Chat / AI Assistant Page
**Audit ref:** 2.10 (Chat)

**Changes to `frontend/src/pages/ChatbotConnectorPage.tsx`:**
- Make account selector more prominent (larger, centered placement)
- Add 4-6 suggested query cards in empty state
- Add capabilities disclosure section
- Show chat input persistently after account selection

### Step 5.3: Analytics Dashboard Page
**Audit ref:** 2.11 (Analytics Dashboard)

**Changes to `frontend/src/pages/AnalyticsDashboardPage.tsx`:**
- Standardize metric card icon colors (monochrome with subtle tint backgrounds instead of arbitrary colors)
- Increase metric label font size and contrast
- Make filter labels descriptive: "Filter by Segment" not "All Segments"
- Add date range selector
- Add trend indicators (↑ / ↓ with percentage) to metric cards
- Note: `chart.js` is already a dependency — ensure charts are being used for trend visualization

### Step 5.4: Landing Page Editor
**Audit ref:** 2.8 (Landing Page Editor)

**Changes to `frontend/src/pages/LandingPageEditorPage.tsx`:**
- Add markdown toolbar buttons (Bold, Italic, Heading, Link, Quote) that insert markdown syntax
- Add side-by-side preview pane using the existing `react-markdown` + `remark-gfm` dependencies
- Add scrub preview before publish

### Step 5.5: Transcript Viewer
**Audit ref:** 2.9 (Transcript Viewer)

**Changes to `frontend/src/pages/TranscriptViewerPage.tsx`:**
- Color-code speaker badges (blue for internal, gray for external)
- Group right panel metadata into card sections
- Add "Generate Story from this Call" CTA button

### Step 5.6: Status Page
**Audit ref:** 2.16 (Status Page)

**Changes to `frontend/src/pages/StatusPage.tsx`:**
- Add individual service status rows: API, Database, Sync Engine, AI Provider
- Add "Last checked" timestamp with auto-refresh indicator
- Add incident history section

### Step 5.7: Workspaces Page
**Audit ref:** 2.13 (Workspaces)

**Changes to `frontend/src/pages/WorkspacesPage.tsx`:**
- When empty: show only `<EmptyState>` with "Create Workspace" CTA
- When workspaces exist: show workspace cards (not table rows) with member count and last activity
- Integrate asset library as a tab within workspace context

### Step 5.8: Dashboard Pages Page
**Audit ref:** 2.7 (Landing Pages)

**Changes to `frontend/src/pages/DashboardPagesPage.tsx`:**
- Standardize metric cards with consistent sizing
- Group filters into a filter bar with pill-style active indicators
- Use standardized `.data-table` component
- Add bulk action support (select multiple → publish/unpublish)

---

## Phase 6: Accessibility Remediation
**Audit ref:** Part 6 (Accessibility Audit Summary)

### Step 6.1: Color Contrast Fixes
- Audit all text colors against backgrounds using WCAG AA thresholds (4.5:1 for body text, 3:1 for large text)
- `themes.css` — Adjust any neutral colors that fail contrast check
- `components.css` — Ensure badge text has sufficient contrast against badge backgrounds
- Focus on gray text on white/dark backgrounds identified in audit

### Step 6.2: Keyboard Navigation & Focus States
- Ensure all interactive elements have `:focus-visible` outlines (the existing `outline: 2px solid var(--color-accent)` pattern is good — verify it's applied everywhere)
- Add `tabindex="0"` to clickable cards and metric tiles that aren't native `<button>` or `<a>` elements
- Ensure `<OverflowMenu>` supports arrow key navigation and Escape to close
- Test and fix tab order on all forms

### Step 6.3: Screen Reader & ARIA
- Add `aria-label` to all icon-only buttons (copy, download, share, etc.)
- Add `aria-hidden="true"` to decorative icons (many SVGs already have this — verify completeness)
- Ensure form inputs have associated `<label>` elements (not just placeholders)
- Add `role="alert"` to error messages and toast notifications
- Add `aria-live="polite"` to loading/status regions

### Step 6.4: Touch Targets
- Ensure all buttons and links meet 44x44px minimum touch target size
- Add padding to any undersized interactive elements (especially in table action columns and sidebar nav items in collapsed mode)

---

## Phase 7: Public Story Pages
**Audit ref:** Part 5 (Public Story Pages)

### Step 7.1: Social Sharing Meta Tags
- `src/api/public-page-renderer.ts` (backend) — Add `og:title`, `og:description`, `og:image` meta tags to the HTML template for public story pages
- Add `twitter:card`, `twitter:title`, `twitter:description` meta tags

### Step 7.2: Print Stylesheet
- `frontend/src/styles/components.css` or new `print.css` — Add `@media print` rules that hide sidebar, navigation, action buttons and format content for printing

### Step 7.3: Password Gate UI Polish
- `src/api/public-page-renderer.ts` — Improve the password gate page styling with branding, clearer instructions

---

## Implementation Order Summary

The phases above should be executed roughly in order, but within each phase the steps can often be parallelized:

| Priority | Steps | Impact |
|----------|-------|--------|
| **P0 — Critical bugs** | 1.5 | Fix broken UX for Viewer role, fix truncated text |
| **P1 — Highest impact** | 1.1, 1.2, 1.3, 1.4, 2.3 | Token enforcement, button system, overflow menu, empty states, Stories page fix |
| **P2 — Core screens** | 2.1, 2.2, 2.4, 2.5, 2.6 | Sidebar, Home dashboard, Accounts pages, table standardization |
| **P3 — Forms & feedback** | 3.1, 3.2, 3.3, 3.4 | Form redesigns, hover states, skeletons, empty states |
| **P4 — Admin & polish** | 4.1–4.8, 5.1–5.8 | Admin pages, auth page, chat, analytics, editor improvements |
| **P5 — Accessibility** | 6.1–6.4 | Contrast, keyboard, ARIA, touch targets |
| **P6 — Public pages** | 7.1–7.3 | Meta tags, print, password gate |

---

## Files Changed Summary

### New Files (3)
- `frontend/src/components/OverflowMenu.tsx`
- `frontend/src/components/EmptyState.tsx`
- `frontend/src/styles/print.css` (optional)

### Modified CSS Files (8)
- `frontend/src/styles/themes.css` — Token additions
- `frontend/src/styles/components.css` — Button system, table standardization, overflow menu, empty state, skeleton enhancements, hover states, focus states, accessibility
- `frontend/src/styles/layout.css` — Sidebar restructuring, section headers, footer
- `frontend/src/styles/pages.css` — Home dashboard layout, form improvements
- `frontend/src/styles/accounts.css` — Clickable rows, tabs, hover states
- `frontend/src/styles/stories.css` — Card redesign, clamped descriptions, reduced actions
- `frontend/src/styles/auth.css` — Login branding, forgot password, password toggle
- `frontend/src/styles/analytics.css` — Metric card standardization, chart layout

### Modified React Files (30+)
- `frontend/src/app/nav-config.tsx` — Navigation restructuring
- `frontend/src/app/Sidebar.tsx` — Section headers, footer user area
- `frontend/src/components/PageSkeleton.tsx` — Skeleton variants
- `frontend/src/pages/HomePage.tsx` — Dashboard redesign, role-specific views
- `frontend/src/pages/StoryLibraryPage.tsx` — Action button reduction, card redesign
- `frontend/src/pages/AccountsIndexPage.tsx` — Clickable rows, overflow menu
- `frontend/src/pages/AccountDetailPage.tsx` — Tabs, action reduction, breadcrumbs
- `frontend/src/pages/AccountJourneyPage.tsx` — AccessDenied for restricted roles
- `frontend/src/pages/TranscriptViewerPage.tsx` — AccessDenied, speaker colors, CTA
- `frontend/src/pages/WritebacksPage.tsx` — Account dropdown, feature explanation, form fix
- `frontend/src/pages/AutomationsPage.tsx` — Grouped form, unit labels, templates
- `frontend/src/pages/ProfileCenterPage.tsx` — Role badge, save button, descriptions
- `frontend/src/pages/WorkspacesPage.tsx` — Empty state, card layout
- `frontend/src/pages/ChatbotConnectorPage.tsx` — Suggested prompts, capabilities
- `frontend/src/pages/AnalyticsDashboardPage.tsx` — Icon standardization, filters, trends
- `frontend/src/pages/LandingPageEditorPage.tsx` — Toolbar, split preview
- `frontend/src/pages/StatusPage.tsx` — Service breakdown, timestamps
- `frontend/src/pages/AuthPage.tsx` — Branding, forgot password, show/hide password
- `frontend/src/pages/DashboardPagesPage.tsx` — Filter bar, bulk actions
- `frontend/src/pages/AdminPermissionsPage.tsx` — Toggle switches, select all
- `frontend/src/pages/AdminRolesPage.tsx` — Visual hierarchy
- `frontend/src/pages/AdminAuditLogsPage.tsx` — Filters, export, color coding
- `frontend/src/pages/AdminSecurityPolicyPage.tsx` — Security posture summary
- `frontend/src/pages/AdminSetupWizardPage.tsx` — Step-by-step wizard
- `frontend/src/pages/AdminOpsDiagnosticsPage.tsx` — Visual health bars
- `frontend/src/pages/AdminBillingReadinessPage.tsx` — Button standardization
- `frontend/src/pages/AccountSettingsPage.tsx` — Contrast, spacing
- `src/api/public-page-renderer.ts` — OG meta tags, password gate styling

### Backend File (1)
- `src/api/public-page-renderer.ts` — Social sharing meta tags
