# StoryEngine — Comprehensive UI/UX Audit

**Prepared for:** Jacob / Mosaic App
**Date:** February 22, 2026 (Revised)
**Auditor:** Claude (Opus 4.6)
**Scope:** Full application audit — every sidebar page, every role, every public surface, code + live multi-session review
**Standard:** World-class B2B SaaS (Linear, Notion, Vercel, Stripe Dashboard tier)
**Sessions Tested:** u0–u9 (Alice, Bob, Carol, Dave, Eve, Frank, Grace, Hank, Iris, Jack) across 3 orgs (Acme, Globex, Initech), plus public story server (port 3000)

---

## Executive Summary

StoryEngine has a strong foundation — a well-structured dark theme, a sensible design token system, and thoughtful multi-tenant architecture. However, the current UI falls significantly short of production-grade B2B SaaS for several systemic reasons: **MEMBER-role dashboards are completely broken** (500 errors across all orgs), **raw developer enums leak into every dashboard** (10+ instances of underscore-delimited keys visible to end users), **native HTML form controls appear unstyled on 6+ admin pages**, **the page editor lacks rich editing capabilities**, and **critical admin pages display data formatting bugs** ($[object Object]/mo, TRANSCRIPT_MINUTES, "Backup Age: -m", concatenated title+slug strings).

This revised audit incorporates findings from comprehensive multi-session testing across all 10 user personas, all sidebar-reachable pages, account detail/journey views, page editors, and all 4 public story URLs.

Below I've organized findings into **Critical (blocks usability)**, **High (damages perception)**, and **Medium (polish gaps)**, with specific, implementable recommendations for each.

---

## 1. CRITICAL — MEMBER Role Dashboards Completely Broken (NEW)

**Severity:** Critical — affects all MEMBER-role users across all organizations
**Pages affected:** Home dashboard (`/`)
**Users affected:** Carol (MEMBER/SALES u2, Acme), Frank (MEMBER/CS u5, Globex), Jack (MEMBER/BILLING u9, Initech)

When any MEMBER-role user loads their Home dashboard, the page displays:

- A red error icon (generic X in circle)
- "Failed to load dashboard" in red text
- "Internal Server Error" as the error detail
- A blue "Retry" button that repeats the same failure
- A separate "Failed to load renewal value report" error below

This is a **systemic backend issue** — the MEMBER role's API endpoint returns a 500 error regardless of organization. This means a significant percentage of users cannot access their primary dashboard at all.

**The error UX itself also needs work:**
- The generic X icon provides no meaningful context
- Red error text on dark background has poor contrast hierarchy
- The blue "Retry" button creates a frustrating loop (same error each time)
- No fallback content, no "Contact your admin" guidance, no alternative navigation suggestion

**Specific recommendations:**

- **Backend fix (urgent):** Debug the MEMBER role dashboard API endpoint — it appears the query or permission check fails for this role across all orgs
- **Error state redesign:** Replace the generic error with a branded empty state: StoryEngine icon, "We're having trouble loading your dashboard" headline, "This has been reported to your admin" subtext, and alternative navigation: "In the meantime, try [Pages] or [Analytics]"
- **Add error reporting:** Log frontend errors to an error tracking service and surface a correlation ID so users can reference it in support tickets

---

## 2. CRITICAL — Raw Enum Keys Throughout the Application

**Severity:** Critical — developer data exposed to end users including executives
**Pages affected:** Home dashboard (all roles), Operations, Billing, Data Quality, Analytics

Raw underscore-delimited enum keys appear in user-facing UI across at minimum 5 different pages:

**Home Dashboard — Renewal Value Report:**
- `problem_challenge_identification` (should be "Problem / Challenge Identification")
- `risk_mitigation_continuity` (should be "Risk Mitigation & Continuity")
- `implementation_onboarding` (should be "Implementation & Onboarding")
- These appear for EVERY role that can view the dashboard — including Executive users

**Operations Page (`/admin/ops`):**
- "Status: AT_RISK" — raw enum displayed as-is (should be "At Risk" with appropriate warning styling)

**Billing Page (`/admin/billing`):**
- "TRANSCRIPT_MINUTES" appears as a raw feature key in the usage table
- "100% MISMATCH" displayed in the Usage Reconciliation section without context or explanation

**Data Quality Page (`/admin/data-quality`):**
- "Drift: ALERT (0.5)" — raw enum status with numeric threshold shown to users

**Analytics Page (`/analytics`):**
- "Top Pages by Views" section concatenates the page title with its URL slug without any separator (e.g., "How Meridian Health Cut Clinical Search Time by 62%meridian-health-journey") — this is a string concatenation bug in the rendering logic

The `formatEnumLabel()` utility already exists in `lib/format.ts` and correctly converts `SCREAMING_SNAKE_CASE` to title case. It simply isn't being called in these components.

**Specific recommendations:**

- **Audit every component** for raw enum rendering — search for patterns like `{status}`, `{type}`, `{category}` in JSX that render API response fields directly
- **Apply `formatEnumLabel()`** universally: import and wrap every enum field before display
- **Fix the Analytics concatenation bug:** In the "Top Pages by Views" component, the title and slug are being joined without a separator. Either display only the title, or format as "Title — /slug"
- **Add a lint rule** or runtime guard that flags SCREAMING_SNAKE_CASE strings in rendered text

---

## 3. CRITICAL — "$[object Object]/mo" Bug in Setup Wizard

**Severity:** Critical — pricing display broken in billing context
**Page affected:** Setup Wizard (`/admin/setup`)

The Setup Wizard's plan selection section displays `$[object Object]/mo` for the Starter and Professional plan prices. This is a JavaScript serialization bug — the component is rendering a price object (likely `{amount: 499, currency: 'USD'}`) instead of accessing its `.amount` or `.formatted` property.

In a billing/pricing context, displaying `[object Object]` severely damages user trust and suggests the product is unfinished.

**Fix:** In the Setup Wizard component, ensure you're rendering `price.amount` or `price.formatted` rather than the price object itself. Add a TypeScript type guard to prevent object-to-string coercion in pricing displays.

---

## 4. CRITICAL — Page Editor Needs Rich Editing Capabilities

The page editor is the core value-generating surface of StoryEngine. Every persona except Exec touches it. It currently consists of:

- A title bar with page name + "PUBLISHED" green badge + "Save Draft" and "Publish" buttons (these are properly styled in the dark theme)
- A breadcrumb trail ("Pages > Page Name") at the top
- A raw monospace `<textarea>` for markdown editing — no syntax highlighting, no toolbar, no preview
- A "Published Versions" section below with a "Refresh" button and "No published versions yet." text
- Large empty space below the fold

**Correction from initial audit:** The Save Draft and Publish buttons ARE styled (Save Draft is ghost/outline, Publish is green primary). The buttons themselves are not the issue — the editing experience is.

**What world-class looks like:** Notion's editor, Contentful's rich text editor, or Webflow's visual builder. At minimum: a split-pane markdown editor with live preview, a proper toolbar, and version history in a collapsible panel.

**Specific recommendations:**

- Replace the `<textarea>` with a proper markdown editor (CodeMirror, TipTap, or Milkdown) with syntax highlighting, a formatting toolbar, and live preview in a side panel
- Add a sticky top bar with breadcrumb navigation, status badge, last-saved timestamp, and action buttons
- Version history should be a collapsible right panel or drawer, not a section below the fold
- Add autosave with a "Saved X seconds ago" indicator
- Add a "Preview" button that renders the markdown as it would appear on the public page

---

## 5. CRITICAL — Operations Page Formatting Bugs (NEW)

**Severity:** Critical — admin monitoring surface shows broken data
**Page affected:** Operations (`/admin/ops`)

Two distinct formatting bugs on the Operations page:

1. **"Status: AT_RISK"** — Raw enum displayed without formatting (should be "At Risk" with yellow/warning badge styling)
2. **"Backup Age: -m"** — The backup age displays "-m" which appears to be a moment.js or date-fns formatting failure (likely `moment().fromNow()` receiving null/undefined, producing "-m" instead of a human-readable duration like "2 hours ago")

For an operations/monitoring page, displaying broken data is particularly damaging — admins rely on this page to assess system health.

**Specific recommendations:**

- Apply `formatEnumLabel()` to the status field
- Debug the backup age calculation — add a null check and fallback: `backupAge ? formatDuration(backupAge) : "Unknown"`
- Add visual status indicators (green/yellow/red dot or badge) alongside the text status

---

## 6. HIGH — Native HTML Form Controls on 6+ Admin Pages

Multiple admin pages use completely unstyled, browser-default form controls that violate the dark theme:

- **Security Policy (`/admin/security`):** White-background `<input>` fields for IP allowlists, session timeout, SCIM provisioning. Native checkboxes appear as small white boxes with no custom styling.
- **Data Governance (`/admin/governance`):** Number inputs render as white rectangles with browser spinner arrows. Toggle fields use native checkboxes.
- **Data Quality (`/admin/data-quality`):** White native inputs and `<select>` dropdowns clash with dark theme. The native select dropdown arrow is the browser default.
- **Page Editor:** The markdown `<textarea>` uses monospace font with dark background (acceptable) but browser-default resize handle.
- **Permissions (`/admin/permissions`):** Checkboxes are native browser checkboxes, not custom-styled toggles.
- **Chat page:** The "Select Account" dropdown is a native `<select>` element.

The design system in `index.css` already defines `.form-input`, `.form-checkbox`, `.form-textarea`, and `.btn` classes. These classes exist but are inconsistently applied across admin pages.

**Specific recommendations:**

- Audit every `<input>`, `<textarea>`, `<select>`, and `<button>` in the app and apply the existing CSS classes
- Replace all native checkboxes with custom toggle switches (or at minimum, styled checkboxes matching the dark theme)
- Ensure every interactive form control uses `--color-surface` background, `--color-border` borders, and `--color-text` text
- Add `:focus-visible` ring styling using `--color-accent` to every input

---

## 7. HIGH — KPI/Stats Cards Dominate Every Dashboard

On the Landing Pages dashboard, **four enormous stat cards** (Total Pages, Published, Drafts, Total Views) each take up ~25% of the viewport height, pushing the actual data table — the thing users came to interact with — below the fold. The same pattern repeats on the Home dashboard with six large stat cards.

Users come to the Pages view to find, manage, and act on pages. They don't come to stare at the number "2" displayed in 48px font inside a 120px-tall card.

**Specific recommendations:**

- Redesign stats as a **compact horizontal row** of small metric pills or inline KPIs (like Linear's project view header) — each metric should be ~40px tall max, not 120px
- Use a layout like: `[Total: 2] [Published: 2] [Drafts: 0] [Views: 189]` in a single row with subtle background differentiation
- Move the data table immediately below the header, making it the primary visual element
- Consider making stats clickable to filter the table (clicking "Drafts: 1" filters to drafts)

---

## 8. HIGH — Permissions Page Layout is Broken

The Permissions page has severe layout issues:

- The "Publish Named" column header and its lock icon SVG are **overlapping the table columns**, creating a visual collision between the header text and the data below
- The lock icon is comically large (~100px) and centered between column headers
- Column headers ("Create", "Publish", "Edit Any", "Delete Any", "Analytics") are crammed together with no spacing
- User names and email addresses are concatenated without spacing (e.g., "Alice Martinezalice@acmecorp.com")

**Specific recommendations:**

- Use a proper `<table>` or CSS grid with defined column widths and consistent padding
- The lock icon should be a small inline icon (16px) next to the column header text, not a massive centered overlay
- Separate user display name from email: name on one line, email below in muted text
- Add proper cell padding (12px minimum) and align checkboxes to center
- Use toggle switches instead of checkboxes

---

## 9. HIGH — Account Settings and Platform Pages Error States (NEW)

**Severity:** High — error screens on important admin surfaces
**Pages affected:** Account Settings (`/account-settings`), Platform (`/platform`)

**Account Settings page** displays a red error: "Failed to load support account info" — no retry button, no fallback UI, just an error message at the top of an otherwise empty page.

**Platform page** displays: "Invalid or missing platform admin key" — this error appears even for the OWNER role (Alice), suggesting a configuration issue or missing API key setup.

Both of these pages represent dead-end experiences with no guidance for resolution.

**Specific recommendations:**

- Add structured error states with: error icon, descriptive message, suggested action, and retry button
- For Platform page: if a platform admin key is required, show a setup flow rather than an error — guide the user to configure their key
- For Account Settings: add a fallback that shows whatever data is cached/available, with a banner indicating some data couldn't be loaded

---

## 10. HIGH — Billing Page Data Display Issues (NEW)

**Severity:** High — billing/financial page shows raw data
**Page affected:** Billing (`/admin/billing`)

The Billing page surfaces multiple raw data issues:

- **"TRANSCRIPT_MINUTES"** appears as a raw feature key in the usage breakdown table — should be "Transcript Minutes" or "AI Transcription Minutes"
- **"100% MISMATCH"** displayed in Usage Reconciliation without context — users don't know what's mismatched, what percentage is acceptable, or what action to take
- Usage metrics appear to use raw API response field names rather than user-friendly labels

For a billing page, data clarity is paramount. Users make financial decisions based on this information.

**Specific recommendations:**

- Apply `formatEnumLabel()` to all feature/metric names in billing tables
- Add contextual help (tooltips or inline descriptions) for terms like "Usage Reconciliation"
- The "100% MISMATCH" should be styled as an alert/warning with an explanation: "Usage recorded by your account differs from platform records by 100%. Contact support if this persists."

---

## 11. HIGH — Public Story URLs Return 404 (NEW)

**Severity:** High — broken public-facing links
**URLs affected:** 2 of 4 provided public story URLs

Of the 4 public story URLs tested:

| URL | Status |
|-----|--------|
| `/s/meridian-health-journey` | ✅ Works — displays public story page |
| `/s/manufacturing-iot-roi` | 🔒 Password-protected — shows gate page |
| `/s/acme-enterprise-transformation` | ❌ 404 — "Page not found" |
| `/s/globex-supply-chain` | ❌ 404 — "Page not found" |

50% of the provided public story URLs are broken. If these are seeded demo data, the seeder needs to create the corresponding public page records. If these represent real published stories, the routing or database lookup is failing.

**The 404 page itself is well-designed** (clean, centered, descriptive copy), but having half your demo story links broken in a product demo context is damaging.

**Specific recommendations:**

- Verify seed data creates matching public page records for all seeded stories
- Add a "Go back to homepage" link or button on the 404 page
- Consider adding related stories or a search bar on the 404 page

---

## 12. HIGH — Empty States are Bare Text

Throughout the app, empty states are handled with plain text like:

- "No published versions yet."
- "No audit log entries found"
- "No workspaces yet"
- "No writebacks yet"
- "No shared assets yet"
- "No automation rules configured"

World-class B2B SaaS uses empty states as onboarding opportunities. Each should have: an illustration or icon, a descriptive headline, a brief explanation of what will appear here, and a primary action button to create the first item.

**Example transformation:**
Instead of "No workspaces yet" → Show a folder illustration, headline "No workspaces yet", subtext "Workspaces help your team organize stories and pages by project or client", and a "Create your first workspace" button.

---

## 13. HIGH — Sidebar Navigation Issues

The sidebar has good structural design but several UX problems:

- **Collapsed state loses all context:** When collapsed (icon-only mode), there are no tooltips on hover. Users see 18+ identical-looking small icons with no labels. This is unusable.
- **Too many top-level items:** The sidebar shows ~18 items at once (Home, Status, Pages, Analytics, Chat, plus 10 admin items, plus 3 workspace items). This violates the 7±2 rule and creates cognitive overload.
- **No visual grouping separators:** The "Administration" and "Workspace" group headers help, but there's no visual divider line between sections.
- **Active state is subtle:** The active item uses a blue left border and blue text, but against the dark background, the distinction is minimal.

**Specific recommendations:**

- Add tooltips (or labeled popover menus) when sidebar is collapsed
- Add 1px divider lines between nav groups (Core, Admin, Workspace)
- Increase active state contrast: add a subtle background fill (`--neutral-200`) to the active item
- Consider collapsing admin sub-items by default (progressive disclosure)
- For non-admin personas, hide admin sections entirely

---

## 14. HIGH — Table Design Inconsistencies

Tables across the app have inconsistent styling:

- **Pages table:** Sort buttons use `▲▼` Unicode characters in column headers — should be subtle chevron icons
- **Column headers** use different typography treatments across pages (some ALL CAPS, some Title Case)
- **Row actions** vary: some tables have "View" buttons, others have `...` overflow menus, others nothing
- **No row hover state** highlighting in several tables (Permissions, Audit Logs)
- The table header row doesn't have enough visual distinction from body rows

**Specific recommendations:**

- Standardize all tables: sticky header with `--neutral-200` background, consistent 14px ALL CAPS header text, hover row state with `--neutral-100` background
- Replace `▲▼` text with proper SVG chevron icons
- Standardize row actions to a consistent `...` overflow menu pattern
- Add alternating row shading or clear row dividers

---

## 15. MEDIUM — Analytics Dashboard Chart Styling

The Analytics dashboard is feature-rich but charts need polish:

- Bar charts and donut charts use Chart.js defaults with no custom theming to match the dark UI
- Chart axis labels (dates like "2025-12-08") are rotated at steep angles, making them hard to read
- The "Entity Resolution Success Rate" line chart has a bright green line with no smooth curve
- The "Landing Page Views Over Time" bar chart uses a single flat blue color with no rounded corners

**Specific recommendations:**

- Apply dark-theme Chart.js configuration globally: grid lines to `--neutral-300`, text to `--color-text-muted`, tooltips to match card style
- Use `tension: 0.4` on line charts for smooth curves
- Rotate date labels to max 45° and use shorter date formats ("Dec 8" not "2025-12-08")
- Add rounded corners to bar charts (`borderRadius: 4`)

---

## 16. MEDIUM — Chat/Chatbot Page UX

The Chat page has good conceptual design but needs refinement:

- The "Select Account" dropdown at top-right is a native `<select>` element, inconsistent with styled dropdowns elsewhere
- The chat bot icon is visually ambiguous — doesn't clearly communicate "AI assistant"
- The chat input area placeholder "Select an account first..." creates a dead-end feeling
- No chat history or conversation persistence is surfaced

**Specific recommendations:**

- Replace native `<select>` with the existing styled dropdown component
- Add welcome state with: AI icon, greeting message, and 3-4 suggestion chips
- Show recent chat history in a left sidebar panel

---

## 17. MEDIUM — Form Layout Consistency

Forms across admin pages use inconsistent layouts:

- **Roles page:** Good 2-column grid layout
- **Story Context:** Good 2-column layout
- **Security Policy:** Single-column with full-width inputs that stretch too wide (>800px)
- **Governance:** Mixed — checkboxes and inputs with no visual card grouping

**Specific recommendations:**

- Standardize form max-width to 720px for single-column forms
- Use fieldset-like card groupings with subtle headers for related fields
- Add consistent field descriptions/help text in `--color-text-muted`
- Ensure all form submit buttons are right-aligned and consistent sizing

---

## 18. MEDIUM — Public Story Page Polish

The public-facing story page (light theme) has good bones but needs work:

- **Blank hero area:** Large empty white space above the title suggests a missing featured image or hero component. This gap makes the page look unfinished.
- The story body content renders from markdown ("This healthcare system transformed their clinical workflows...") but the layout should handle long-form content more gracefully
- The "Compiled by AI from 3.08 hours of real call recordings" toast is a good trust signal but could be more polished (fixed-position banner rather than dismissible toast, add StoryEngine branding)
- The password-protected gate page is clean and well-designed — one of the best surfaces in the app
- No footer, no "Powered by StoryEngine" branding, no social share buttons

**Specific recommendations:**

- Add a hero image area or collapse the gap when no image is set
- Add a subtle "Powered by StoryEngine" footer with link
- Add social sharing buttons (LinkedIn, Twitter, Copy Link)
- Add reading time estimate near the subtitle

---

## 19. MEDIUM — Missing Loading and Error States

Many pages show no loading indicator when fetching data. The app should have:

- Skeleton loading states for stat cards, tables, and charts
- A consistent error boundary component with retry action and contextual messaging
- Toast notifications for successful and failed actions
- Optimistic UI updates for toggle actions (like permission checkboxes)

The error states that do exist (MEMBER dashboard failures, Account Settings, Platform) all use inconsistent styling — some red text, some with icons, some without retry options.

---

## 20. Brand Guide Compliance Gaps

After reviewing the brand guide (`storyengine-brand-guide.md`) against the live implementation:

### 20.1 Typography Weight Mismatch
- **Brand guide says:** "Hero headlines use ultra-light weight (300) at massive scale."
- **App does:** Page titles use weight 600–700 at 24–28px. No ultra-light typography anywhere.
- **Fix:** Reduce page title weights to 300–400 at 32–36px. Add `letter-spacing: -0.02em`.

### 20.2 "No Box Shadows" Is Followed — But No Alternative Elevation
- The app correctly avoids shadows. But there's no substitute for elevation — modals, dropdowns, and active cards sit at the same visual plane.
- **Fix:** Use border-color changes, `backdrop-filter: blur()`, and subtle transforms on hover.

### 20.3 Color Overuse in Stat Cards
- **Brand guide says:** "Color is used surgically. Blue appears almost exclusively on interactive elements."
- **App does:** Stat card icons use blue, cyan, green, yellow, and red circles. Taxonomy Topics uses a full rainbow.
- **Fix:** Stat card icons should be monochrome. Taxonomy bars should use a single-hue opacity gradient.

### 20.4 The Numbered Taxonomy Is Missing
- **Brand guide says:** "Section labels use a numbered taxonomy (e.g., 'Account Journeys — 01')."
- **App does:** No numbered taxonomy anywhere.
- **Fix:** Add section numbers to sidebar group headers and page titles: "01 — Home", "02 — Accounts".

---

## 21. Role-Specific View Issues (Verified Across All Sessions)

### 21.1 Executive View (Dave — u3)
- Greeting says "Good evening, Executive (View Only)" — the "(View Only)" suffix is developer-facing. Should say "Executive Dashboard" or "Leadership Overview."
- Renewal Readiness shows the same raw enum keys. An executive should NEVER see underscore-delimited taxonomy keys.
- Sidebar is extremely sparse (4 items). Consider auto-collapsing or using top-nav for Exec users.

### 21.2 MEMBER Views (Carol u2, Frank u5, Jack u9) — BROKEN
- All MEMBER-role users get 500 errors on Home dashboard (see Finding #1). This is the most critical cross-role issue.
- Carol (Sales Manager), Frank (CSM), and Jack (Billing Admin) all share this broken experience.

### 21.3 Cross-Org Admin Views (Eve/Globex u4, Hank/Initech u7)
- Structurally identical to Acme's admin dashboard — multi-tenant data separation is working correctly.
- Hank's greeting uses raw email prefix "hank" — should display proper name if available.
- Same raw enum keys and formatting issues appear in all orgs, confirming these are systemic code issues, not data issues.

### 21.4 Public Password Page (port 3000)
- Clean white card, centered layout, lock icon, clear copy — one of the best-designed surfaces.
- The purple/indigo "View Story" button is a departure from the blue brand color (`--blue-400: #336FE6`). Should use brand blue for consistency.
- No StoryEngine branding on the page.

---

## 22. Code-Level Design System Observations

After reviewing `index.css` (3100+ lines) and `App.tsx` (657 lines):

### What's Working Well
- **Token system is well-structured:** 70+ CSS custom properties covering colors, spacing, radius, transitions
- **Semantic color mapping is correct:** `--color-bg`, `--color-surface`, `--color-accent` properly abstract the raw palette
- **Accessibility foundations are strong:** `aria-label`, `aria-current`, `aria-expanded`, `role` attributes, skip-to-content link, `:focus-visible` styles
- **Mobile-responsive scaffolding exists:** Sidebar overlay, mobile header, breakpoint-aware layout
- **Sidebar collapse with localStorage persistence** is thoughtful
- **Public story page and password gate** are well-designed relative to the rest of the app

### What Needs Improvement
- **All 22 SVG icons are inline in App.tsx** — extract to a shared icon component library
- **No shared component library:** Each page re-implements its own stat cards, tables, forms, and error states. Extract: `<StatRow>`, `<DataTable>`, `<EmptyState>`, `<ErrorState>`, `<FormSection>`, `<PageHeader>`
- **CSS is monolithic:** 3100+ lines in a single file. Split into modules: `tokens.css`, `sidebar.css`, `forms.css`, `tables.css`, `cards.css`
- **No animation/transition utilities:** Brand guide describes "restrained animation." `--transition-fast` and `--transition-normal` are defined but barely used

---

## Complete Bug Tracker

| # | Bug | Severity | Page | Status |
|---|-----|----------|------|--------|
| 1 | MEMBER dashboard returns 500 error (all orgs) | Critical | Home `/` | Systemic |
| 2 | `$[object Object]/mo` on pricing cards | Critical | Setup `/admin/setup` | Confirmed |
| 3 | Raw enum keys in Renewal Report | Critical | Home `/` | Confirmed |
| 4 | Analytics title+slug concatenation | Critical | Analytics `/analytics` | New |
| 5 | "Backup Age: -m" formatting failure | Critical | Ops `/admin/ops` | New |
| 6 | "Status: AT_RISK" raw enum | High | Ops `/admin/ops` | New |
| 7 | "TRANSCRIPT_MINUTES" raw enum | High | Billing `/admin/billing` | New |
| 8 | "Drift: ALERT (0.5)" raw enum | High | Data Quality `/admin/data-quality` | New |
| 9 | "100% MISMATCH" without context | High | Billing `/admin/billing` | New |
| 10 | Permissions layout collision (lock icon) | High | Permissions `/admin/permissions` | Confirmed |
| 11 | Name+email concatenation (no space) | High | Permissions `/admin/permissions` | Confirmed |
| 12 | "Executive (View Only)" greeting | High | Home `/` (Exec) | Confirmed |
| 13 | "Failed to load support account info" | High | Account Settings | New |
| 14 | "Invalid or missing platform admin key" | High | Platform `/platform` | New |
| 15 | 2 of 4 public story URLs return 404 | High | Public `/s/...` | New |
| 16 | Greeting uses email prefix not name | Medium | Home `/` (Hank) | Confirmed |
| 17 | Password page uses purple not brand blue | Medium | Public `/s/...` (password) | Confirmed |
| 18 | Empty hero area on public story page | Medium | Public `/s/...` | New |

---

## Revised Priority Implementation Roadmap

### Phase 1 — Immediate Impact (1–2 days, highest ROI)
1. **Fix MEMBER role dashboard 500 errors** — This blocks an entire user class from using the product
2. **Fix raw enum keys everywhere** — Apply `formatEnumLabel()` across all components (the utility already exists in `lib/format.ts`)
3. **Fix the "$[object Object]/mo" pricing bug** in Setup Wizard
4. **Fix Analytics title+slug concatenation** — separate or show title only
5. **Fix "Backup Age: -m" formatting** — add null check and human-readable fallback
6. **Fix "Executive (View Only)" greeting** to user-friendly label

### Phase 2 — Visual Polish (3–5 days)
1. **Apply existing CSS classes to all unstyled form controls** — the classes already exist in index.css
2. **Compress stat cards to compact single-row layout** on all dashboards
3. **Fix Permissions page layout** — proper table grid, inline lock icons, separated name/email
4. **Fix Account Settings and Platform error states** — structured error UI with retry and guidance
5. **Fix 404 public story URLs** — verify seed data creates matching records

### Phase 3 — Interaction Quality (1 week)
1. **Redesign the Page Editor** with CodeMirror/TipTap, split-pane preview, styled toolbar
2. **Design proper empty states** with illustrations, value props, and CTAs
3. **Add skeleton loading screens** for all pages
4. **Theme all charts** to match dark aesthetic
5. **Implement typographic hierarchy** per brand guide (weight 300 titles)

### Phase 4 — Information Architecture (1–2 weeks)
1. **Extract shared components** (`<StatRow>`, `<DataTable>`, `<EmptyState>`, `<PageHeader>`)
2. **Split CSS into modules** for maintainability
3. **Add sidebar tooltips** for collapsed state, visual dividers between groups
4. **Add "Powered by StoryEngine" branding** to public pages
5. **Add numbered section taxonomy** to nav per brand guide
6. **Add page transition animations** and micro-interactions

---

## Final Assessment

StoryEngine's brand guide describes a product that is "premium, technical, confident, minimal." The current implementation has the *bones* of this — the color system, dark-first identity, and token architecture are correct. But the execution undermines the brand through: **broken core functionality** (MEMBER dashboards returning 500s), **raw developer data leaking into every view** (10+ instances of raw enums), visual clutter (oversized stat cards, rainbow icons), missing polish (no loading skeletons, no transitions, unstyled form controls), and broken public links (2 of 4 story URLs return 404).

**The single highest-ROI change:** Fix the MEMBER dashboard 500 error and apply `formatEnumLabel()` across all components. These two changes alone would resolve the most critical user-facing issues.

**The single highest-ROI visual change:** Apply the existing CSS classes that are already defined in `index.css` but not used across admin pages. The design system tokens and component styles are well-crafted — they just aren't consistently applied. Fixing this alone would solve ~40% of the visual quality issues.

The app is not far from excellent. The architecture is clean, the role-based navigation is well-thought-out, and the accessibility foundations are strong. What it needs is the last 20% of visual craft that separates tools people *use* from tools people *love* — and the critical bug fixes that currently block significant portions of the user base entirely.

---

*This audit was compiled from a full review of the StoryEngine codebase (React + Vite + TypeScript, custom CSS design system with 70+ tokens, 27+ page components, 657-line App.tsx) and live testing across all 10 parallel user sessions (u0–u9), covering: Alice (OWNER/Acme), Bob (ADMIN/Acme), Carol (MEMBER-SALES/Acme), Dave (VIEWER-EXEC/Acme), Eve (OWNER/Globex), Frank (MEMBER-CS/Globex), Grace (VIEWER/Globex), Hank (OWNER/Initech), Iris (ADMIN/Initech), Jack (MEMBER-BILLING/Initech), plus all 4 public story URLs on port 3000. Every sidebar-reachable page was navigated and scrolled for each accessible role.*
