# StoryEngine UI/UX Comprehensive Audit

**Prepared for:** Jacob / Mosaic App
**Date:** February 22, 2026
**Scope:** Full application audit across all views, personas, and user flows
**Standard:** World-class B2B SaaS (Notion, Linear, Figma, Vercel tier)

---

## Executive Summary

StoryEngine has a strong foundation — a well-structured dark theme, a sensible design token system, and thoughtful multi-tenant architecture. However, the current UI falls significantly short of production-grade B2B SaaS for several systemic reasons: **inconsistent component styling** (native HTML form controls mixed with styled components), **poor information hierarchy** (stats cards dominate pages that should prioritize data tables), **a dangerously bare page editor** (the single most important user-facing feature), and **missing empty states, loading states, and feedback patterns** throughout the admin surface.

Below I've organized findings into **Critical (blocks usability)**, **High (damages perception)**, and **Medium (polish gaps)**, with specific, implementable recommendations for each.

---

## 1. CRITICAL — Page Editor (The #1 Problem)

The page editor is the core value-generating surface of StoryEngine. Every persona except Exec touches it. It currently consists of:

- A raw `<textarea>` with monospace font and browser-default styling
- Two unstyled `<button>` elements ("Save Draft" / "Publish") with default browser chrome
- The page title and status badge ("PUBLISHED") concatenated inline as plain text with no visual separation
- A "Published Versions" section with a bare "Refresh" button and "No published versions yet" text
- Massive empty white space below

**What world-class looks like:** Notion's editor, Contentful's rich text editor, or Webflow's visual builder. At minimum: a split-pane markdown editor with live preview, a proper toolbar, styled action buttons, and version history in a collapsible panel.

**Specific recommendations:**

- Replace the `<textarea>` with a proper markdown editor (CodeMirror, TipTap, or Milkdown) with syntax highlighting, a formatting toolbar, and live preview in a side panel
- Style the Save Draft / Publish buttons using the existing `.btn` and `.btn--primary` classes from your design system — they're already defined in index.css but not applied here
- Separate the page title from the status badge: title should be an editable `<h1>`, status should be a `.badge` component
- Add a sticky top bar with breadcrumb navigation (Pages → Page Name), status badge, last-saved timestamp, and action buttons
- Version history should be a collapsible right panel or drawer, not a section below the fold
- Add autosave with a "Saved X seconds ago" indicator
- Add a "Preview" button that renders the markdown as it would appear on the public page

---

## 2. CRITICAL — KPI/Stats Cards Dominate Every Dashboard

On the Landing Pages dashboard, **four enormous stat cards** (Total Pages, Published, Drafts, Total Views) each take up ~25% of the viewport height, pushing the actual data table — the thing users came to interact with — below the fold. The same pattern repeats on the Home dashboard with six large stat cards.

**The problem:** Users come to the Pages view to find, manage, and act on pages. They don't come to stare at the number "2" displayed in 48px font inside a 120px-tall card.

**Specific recommendations:**

- Redesign stats as a **compact horizontal row** of small metric pills or inline KPIs (like Linear's project view header) — each metric should be ~40px tall max, not 120px
- Use a layout like: `[Total: 2] [Published: 2] [Drafts: 0] [Views: 189]` in a single row with subtle background differentiation
- Move the data table immediately below the header, making it the primary visual element
- Consider making stats clickable to filter the table (clicking "Drafts: 1" filters to drafts)

---

## 3. CRITICAL — Native HTML Form Controls Everywhere

Multiple admin pages use completely unstyled, browser-default form controls that violate the otherwise dark theme:

- **Page Editor:** `<textarea>` and `<button>` elements render with white backgrounds, browser-default borders, and system fonts
- **Security Policy:** `<input>` fields appear with bright white backgrounds and no dark-mode styling (the IP allowlist field, session age fields)
- **Data Governance:** Number inputs render as white rectangles with browser spinners
- **Permissions:** Checkboxes are native browser checkboxes, not custom-styled toggles
- **Status page:** Organization ID input is unstyled

The design system in `index.css` already defines `.form-input`, `.form-checkbox`, `.form-textarea`, and `.btn` classes. These classes exist but are inconsistently applied.

**Specific recommendations:**

- Audit every `<input>`, `<textarea>`, `<select>`, and `<button>` in the app and apply the existing CSS classes
- Replace all native checkboxes with custom toggle switches (or at minimum, styled checkboxes matching the dark theme)
- Ensure every interactive form control uses `--color-surface` background, `--color-border` borders, and `--color-text` text
- Add `:focus-visible` ring styling using `--color-accent` to every input

---

## 4. HIGH — Permissions Page Layout is Broken

The Permissions page has severe layout issues:

- The "Publish Named" column header and its lock icon SVG are **overlapping the table columns**, creating a visual collision between the header text and the data below
- The lock icon is comically large (~100px) and centered between column headers
- Column headers ("Create", "Publish", "Edit Any", "Delete Any", "Analytics") are crammed together with no spacing, making them hard to read
- The "Access" buttons (expandable chevrons) for Carol and Dave overflow their cell boundaries
- User names and email addresses are concatenated without spacing (e.g., "Alice Martinezalice@acmecorp.com")

**Specific recommendations:**

- Use a proper `<table>` or CSS grid with defined column widths and consistent padding
- The lock icon for "Publish Named" should be a small inline icon (16px) next to the column header text, not a massive centered overlay
- Separate user display name from email: name on one line, email below in muted text
- Add proper cell padding (12px minimum) and align checkboxes to center
- Use toggle switches instead of checkboxes for a more polished B2B feel

---

## 5. HIGH — Sidebar Navigation Issues

The sidebar has good structural design but several UX problems:

- **Collapsed state loses all context:** When collapsed (icon-only mode), there are no tooltips on hover. Users see 18+ identical-looking small icons with no labels. This is unusable.
- **Too many top-level items:** The sidebar shows ~18 items at once (Home, Status, Pages, Analytics, Chat, plus 10 admin items, plus 3 workspace items). This violates the 7±2 rule and creates cognitive overload.
- **No visual grouping separators:** The "Administration" and "Workspace" group headers help, but there's no visual divider line between sections. At a glance, the sidebar reads as one flat list.
- **Active state is subtle:** The active item uses a blue left border and blue text, but against the dark background, the distinction from inactive items is minimal. The hover state is barely perceptible.

**Specific recommendations:**

- Add tooltips (or labeled popover menus) when sidebar is collapsed
- Add 1px divider lines between nav groups (Core, Admin, Workspace)
- Increase active state contrast: add a subtle background fill (`--neutral-200`) to the active item
- Consider collapsing admin sub-items by default (progressive disclosure) — most users don't need all 10 admin pages visible at once
- For non-admin personas, hide admin sections entirely (the permission redirect to Home is jarring — better to not show the nav item at all)

---

## 6. HIGH — Home Dashboard Information Overload

The Home dashboard (RevOps Admin view) tries to surface too much information at once:

- 6 KPI stat cards at the top
- A "Recommended Next Actions" section (good concept, needs refinement)
- A "Customer Success Health" section with 3 sub-metrics and a team breakdown table
- A "Risk Indicators" yellow warning card
- A "Renewal Value Report" with 3 more KPI cards and an AI-generated narrative

This results in a page that requires 3+ scrolls to view fully, with no clear visual hierarchy telling the user what's most important.

**Specific recommendations:**

- Prioritize: The Home dashboard should answer "What do I need to do right now?" — lead with Recommended Next Actions, not stats
- Compress the 6 KPI cards into a single compact row
- Use progressive disclosure: "Customer Success Health" and "Renewal Value Report" should be collapsible cards, expanded by default only for admin users
- The Risk Indicators and Renewal narrative blocks should use the existing yellow/warning design tokens more sparingly — currently the yellow cards feel alarming rather than informative
- Add a "Quick actions" area: Create Story, Create Page, Review Approvals (button-driven, not text list)

---

## 7. HIGH — "$[object Object]/mo" Bug in Setup Wizard

The Setup Wizard's plan selection section displays `$[object Object]/mo` for the Starter and Professional plan prices. This is a JavaScript serialization bug (likely rendering a price object instead of its `.amount` or `.formatted` property). This is a data-level bug but it severely damages trust in a billing/pricing context.

**Fix:** In the Setup Wizard component, ensure you're rendering `price.amount` or `price.formatted` rather than the price object itself.

---

## 8. HIGH — Empty States are Bare Text

Throughout the app, empty states are handled with plain text like:

- "No published versions yet."
- "No audit log entries found"
- "No workspaces yet"
- "No writebacks yet"
- "No shared assets yet"
- "No automation rules configured"

World-class B2B SaaS uses empty states as onboarding opportunities. Each should have:

- An illustration or icon
- A descriptive headline
- A brief explanation of what will appear here
- A primary action button to create the first item

**Example transformation:**
Instead of "No workspaces yet" → Show a folder illustration, headline "No workspaces yet", subtext "Workspaces help your team organize stories and pages by project or client", and a "Create your first workspace" button.

---

## 9. HIGH — Table Design Inconsistencies

Tables across the app have inconsistent styling:

- **Pages table:** Has sort buttons with `▲▼` Unicode characters in column headers, which look raw and unpolished. Sort indicators should be subtle chevron icons.
- **Column headers** use different typography treatments across pages (some ALL CAPS, some Title Case, some have sort controls, some don't)
- **Row actions** vary: some tables have "View" buttons with `...` overflow menus, others have inline action buttons, others have nothing
- **No row hover state** highlighting in several tables (Permissions, Audit Logs)
- The table header row doesn't have enough visual distinction from body rows

**Specific recommendations:**

- Standardize all tables with: sticky header row using `--neutral-200` background, consistent 14px ALL CAPS header text with `--color-text-muted`, hover row state with `--neutral-100` background
- Replace `▲▼` text with proper SVG chevron icons (12px) that change opacity based on sort state
- Standardize row actions to a consistent `...` overflow menu pattern
- Add alternating row shading (subtle) or clear row dividers

---

## 10. MEDIUM — Analytics Dashboard Chart Styling

The Analytics dashboard is feature-rich but the charts need polish:

- Bar charts and donut charts use Chart.js defaults with no custom theming to match the dark UI
- Chart axis labels (dates like "2025-12-08") are rotated at steep angles, making them hard to read
- The "Entity Resolution Success Rate" line chart has a bright green line on dark background with no smooth curve
- Chart cards have no titles that are visually distinct from the chart content
- The "Landing Page Views Over Time" bar chart uses a single flat blue color — it should use the accent gradient or at least rounded corners on bars

**Specific recommendations:**

- Apply dark-theme Chart.js configuration globally: set grid lines to `--neutral-300`, text to `--color-text-muted`, and tooltips to match the card style
- Use `tension: 0.4` on line charts for smooth curves
- Rotate date labels to max 45° and use shorter date formats (e.g., "Dec 8" instead of "2025-12-08")
- Add rounded corners to bar charts (`borderRadius: 4`)
- Consider replacing Chart.js with Recharts or Nivo for a more polished, React-native charting experience

---

## 11. MEDIUM — Chat/Chatbot Page UX

The Chat page has good conceptual design but needs refinement:

- The "Select Account" dropdown at top-right is a native `<select>` element, inconsistent with the styled dropdowns elsewhere
- The chat bot icon (horizontal bars) is visually ambiguous — it doesn't clearly communicate "AI assistant"
- The chat input area is inside a rounded card but the placeholder text "Select an account first..." creates a dead-end feeling
- No chat history or conversation persistence is surfaced
- The "suggestion chips" pattern (mentioned in code) isn't visible in the empty state

**Specific recommendations:**

- Replace native `<select>` with the existing multi-select dropdown component
- Add welcome state with: StoryEngine AI icon, greeting message, and 3-4 suggestion chips ("Summarize top accounts", "Show recent activity", "Draft a story for...")
- Show recent chat history in a left sidebar panel

---

## 12. MEDIUM — Form Layout Consistency

Forms across admin pages use inconsistent layouts:

- **Roles page:** Good 2-column grid layout for fields
- **Story Context:** Good 2-column layout
- **Security Policy:** Single-column with full-width inputs that stretch too wide (>800px inputs are hard to scan)
- **Automations:** 2-column but no visual grouping
- **Governance:** Mixed — checkboxes and inputs with no visual card grouping

**Specific recommendations:**

- Standardize form max-width to 720px for single-column forms
- Use fieldset-like card groupings with subtle headers for related fields
- Add consistent field descriptions/help text below inputs in `--color-text-muted`
- Ensure all form submit buttons are right-aligned and use consistent sizing

---

## 13. MEDIUM — Public Story Page Polish

The public-facing story page is the best-designed surface (light theme, hero image, clean typography) but still needs work:

- The story body content is very sparse ("This healthcare system transformed their clinical workflows...") — this appears to be a content issue, but the layout should handle long-form content gracefully
- The "Compiled by AI from 3.08 hours of real call recordings" toast in the bottom-right is a good trust signal but could be more polished (add the StoryEngine logo, make it a fixed-position banner rather than a dismissible toast)
- The password-protected page gate is clean and well-designed — one of the best UI surfaces in the app
- No footer, no "Powered by StoryEngine" branding, no social share buttons

**Specific recommendations:**

- Add a subtle "Powered by StoryEngine" footer with link
- Add social sharing buttons (LinkedIn, Twitter, Copy Link) in a floating sidebar or below the title
- Add reading time estimate near the subtitle
- Ensure the markdown renderer handles all content types (blockquotes, code blocks, tables, images) with proper styling

---

## 14. MEDIUM — Missing Loading and Error States

Many pages show no loading indicator when fetching data. The app should have:

- Skeleton loading states for stat cards, tables, and charts
- A consistent error boundary component with retry action
- Toast notifications for successful and failed actions (the Toast component exists in code but may not be consistently used)
- Optimistic UI updates for toggle actions (like permission checkboxes)

---

## 15. Persona-Specific Recommendations

### For RevOps Admin (Alice, Bob)
- The admin surface is functional but overwhelming. Add a "Quick Setup" checklist widget to Home that persists until all onboarding steps are complete.
- The sidebar should group admin items under a collapsible "Admin" section that remembers expand/collapse state.

### For Sales Manager / Rep
- The Pages dashboard should support card/grid view (not just table) for visual browsing of stories
- Add a "Share" button directly on page rows to copy the public URL
- The page editor needs a "Preview as prospect" button

### For Customer Success Manager
- No differentiation between named and anonymous stories in the current UI — add visual badges and filters
- The chat interface could be their primary tool — invest in making it feel like a first-class AI copilot

### For Marketing Analyst
- The Analytics dashboard is their home — it needs date range pickers, export buttons, and the ability to save custom views
- Add a "Download as PDF" option for charts

### For Executive
- The Home dashboard is too operational. Create an executive-specific home view with high-level KPIs, trend sparklines, and a "Stories driving pipeline" highlight

---

## Summary of Priority Implementation Order

1. **Redesign the Page Editor** — This is the product's core value surface. Ship a proper markdown editor with preview, styled buttons, and version history panel.
2. **Fix native form controls** — Apply existing CSS classes to all inputs, buttons, textareas, checkboxes across admin pages. This is the fastest win for perceived quality.
3. **Compress stat cards** — Reduce KPI cards from full-width stacked blocks to a compact horizontal row on every dashboard.
4. **Fix the Permissions table layout** — Broken layout with overlapping elements damages trust.
5. **Fix the $[object Object] pricing bug** — Critical trust issue in a billing context.
6. **Add empty states with illustrations and CTAs** — Transform dead-end screens into onboarding moments.
7. **Improve sidebar navigation** — Add tooltips for collapsed state, visual dividers, and hide admin items from non-admin users.
8. **Theme all charts** — Apply dark-mode styling globally to Chart.js.
9. **Add loading skeletons and error states** — Baseline quality expectation for any production SaaS.
10. **Polish the public story page** — Add footer, sharing buttons, and robust content rendering.

---

*This audit was compiled from a full review of the StoryEngine codebase (React + Vite, custom CSS design system, 3100+ lines of index.css, 27 page components) and live testing across 5 parallel user sessions (Alice/Bob on Acme, Eve on Globex, Hank/Iris on Initech), covering all admin views, page editors, public story pages, and workspace features.*
