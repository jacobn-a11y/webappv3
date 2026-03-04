# StoryEngine — Comprehensive UI/UX Audit

**Date:** March 3, 2026
**Scope:** Full application audit across all personas (Owner, Admin, Member, Viewer), 40+ screens
**Objective:** Identify every UX gap preventing world-class clarity, usability, and polish — with specific rebuild directions

---

## Executive Summary

StoryEngine is a powerful B2B RevOps platform with solid information architecture and strong role-based access control. However, the UI feels **assembled incrementally** rather than designed as a cohesive system. The core problems are:

1. **No design system** — buttons, spacing, typography, and color are inconsistent page-to-page
2. **Low information density control** — some screens are too sparse, others are overwhelmed with actions
3. **Weak empty states & onboarding** — new users get no guidance on what to do first
4. **Missing interaction feedback** — hover states, loading states, and success confirmations are absent or inconsistent
5. **Form UX is ad-hoc** — field grouping, validation, and read-only states aren't standardized

Fixing these issues requires building a component design system first, then systematically applying it across every screen. The sections below provide page-by-page findings and specific rebuild directions.

---

## Part 1: Systemic Issues (Fix These First)

These cross-cutting problems affect every page and should be addressed before individual page fixes.

### 1.1 No Design Token System

**Problem:** Colors, spacing, font sizes, and border radii are hardcoded per-component rather than pulled from a shared token set.

**Evidence:**
- Primary blue varies subtly across pages (buttons vs links vs icons)
- Spacing between cards is 16px on some pages, 12px on others, 24px on yet others
- Font sizes for section headers range from 14px to 20px with no clear scale
- Border radii on cards vs inputs vs buttons don't match

**Rebuild Direction:**
```
Design Tokens to Define:
├── Colors
│   ├── Primary: blue-600 (buttons, links, active states)
│   ├── Secondary: gray-600 (secondary text, icons)
│   ├── Success: green-600 (published, healthy, resolved)
│   ├── Warning: amber-500 (pending, threshold alerts)
│   ├── Danger: red-600 (errors, failed, delete actions)
│   └── Neutrals: gray-50 through gray-900 (backgrounds, borders, text)
├── Spacing: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64px
├── Typography Scale
│   ├── xs: 12px / 16px line-height (badges, captions)
│   ├── sm: 14px / 20px (body, table cells)
│   ├── base: 16px / 24px (primary body text)
│   ├── lg: 18px / 28px (section headers)
│   ├── xl: 20px / 28px (page subtitles)
│   ├── 2xl: 24px / 32px (page titles)
│   └── 3xl: 30px / 36px (dashboard greeting)
├── Border Radius: 4px (inputs), 6px (cards), 8px (modals), full (avatars/badges)
└── Shadows: sm (cards), md (dropdowns), lg (modals)
```

### 1.2 Button Hierarchy is Broken

**Problem:** The app uses at least 5 different button treatments with no clear hierarchy. On the Stories page alone there are 9 action buttons per card — users can't tell what's primary.

**Evidence:**
- Blue filled: "New Story", "Generate Story", "Create", "Save Profile"
- White outlined: "Bulk Table", pagination buttons
- Plain text links: "Open", "Journey", "View All"
- Small icon buttons: "Copy", "PDF", "DOCX"
- Red destructive: "Delete" (only on some pages)

**Rebuild Direction:**
```
Button System (3 tiers + destructive):
├── Primary (filled blue): One per section max. The main CTA.
│   Examples: "Generate Story", "Publish", "Save"
├── Secondary (outlined): Supporting actions
│   Examples: "Edit", "View Journey", "Export"
├── Tertiary (ghost/text): Low-emphasis actions
│   Examples: "Cancel", "View All", "Copy Link"
├── Destructive (outlined red, filled red on hover): Delete/remove
│   Examples: "Delete Story", "Revoke Access"
└── Icon-only (with tooltip): Space-constrained repetitive actions
    Examples: Copy, Download PDF, Share
```

**Specific fix for Stories page:** Replace the 9-button row with:
- Primary: "Edit" (or "View" for viewers)
- Dropdown menu (⋯): Share, Copy, PDF, DOCX, CRM Note, Push CRM, Comments
- This reduces cognitive load from 9 choices to 2 visible + overflow

### 1.3 Inconsistent Table Design

**Problem:** Every table in the app is styled differently — headers, row hover states, pagination, and column alignment all vary.

**Evidence:**
- Accounts table: centered headers, no row hover
- Stories table: card-based, no traditional table
- Dashboard/Pages table: small headers, mixed alignment
- Audit Logs table: different header style again
- Some tables have pagination, others don't

**Rebuild Direction:**
```
Standard Table Component:
├── Header: gray-50 background, sm font, uppercase tracking, left-aligned
├── Rows: white background, hover:gray-50, border-bottom:gray-100
├── Cells: 14px text, 12px/16px padding vertical/horizontal
├── Actions column: right-aligned, icon buttons with tooltips
├── Pagination: "Showing 1-25 of 142" + Previous/Next + page size selector
├── Empty state: centered illustration + message + CTA button
├── Loading state: skeleton rows (not spinner)
└── Sort indicators: chevron up/down on sortable columns
```

### 1.4 Empty States Are Generic and Unhelpful

**Problem:** When a page has no data, users see minimal text like "No workspaces yet" with no guidance on what to do or why the feature matters.

**Evidence:**
- Workspaces: "No workspaces yet. Create a workspace above to get started organizing your team's content"
- Writebacks: "No writebacks yet" (text cuts off mid-sentence — critical bug)
- Automations: Just shows "0 rules" with an empty table
- Chat: "Select an account to get started" with tiny icon

**Rebuild Direction:**
Every empty state should have 4 elements:
```
┌──────────────────────────────────────────┐
│          [Relevant illustration]          │
│                                          │
│     No [items] yet                       │
│                                          │
│     [1-2 sentence explanation of what    │
│      this feature does and why it's      │
│      valuable to the user's workflow]    │
│                                          │
│     [ + Create Your First [Item] ]       │
│                                          │
│     Learn more about [feature] →         │
└──────────────────────────────────────────┘
```

### 1.5 No Loading States or Skeleton UI

**Problem:** Pages either show instantly (cached) or show nothing while loading. There are no skeleton loading states, shimmer effects, or progress indicators.

**Rebuild Direction:** Implement skeleton screens for every data-loading page. Use gray placeholder rectangles that match the eventual content layout. This eliminates layout shift and communicates that content is coming.

### 1.6 Missing Hover & Focus States

**Problem:** Interactive elements (table rows, cards, metric tiles, links) provide little or no visual feedback on hover. Focus states for keyboard navigation are also missing.

**Rebuild Direction:**
```
Interaction States:
├── Buttons: hover (darken 10%), active (darken 15%), focus (ring-2 ring-blue-500)
├── Table rows: hover (bg-gray-50), clickable rows get cursor-pointer
├── Cards: hover (shadow-md, translate-y -1px), clickable cards get cursor-pointer
├── Links: hover (underline + darken), visited (purple-700)
├── Inputs: focus (ring-2 ring-blue-500, border-blue-500)
└── Navigation: hover (bg-gray-100), active (bg-blue-50, text-blue-700, left border)
```

### 1.7 Sidebar Navigation Needs Restructuring

**Problem:** The sidebar mixes core features (Home, Accounts, Stories) with administration in a flat list that grows very long for Owners. The hierarchy isn't clear, and the "Workspace" section at the bottom feels disconnected.

**Current sidebar (Alice/Owner):**
```
Home
  Status
  Accounts
  Stories
  Pages
  Analytics
  Chat
Administration ▾
  Permissions
  Roles
  Story Context
  Audit Logs
  Operations
  Security
  Governance
  Approvals
  Data Quality
  Setup
  Billing
Workspace ▾
```

**Rebuild Direction:**
```
Proposed Navigation:
├── CORE (always visible)
│   ├── Home (dashboard)
│   ├── Accounts
│   ├── Stories
│   ├── Pages (landing pages)
│   └── Analytics
├── TOOLS (collapsible)
│   ├── Chat (AI assistant)
│   ├── Automations
│   ├── Writebacks
│   └── Workspaces
├── ADMIN (Owners/Admins only, collapsible)
│   ├── Users & Permissions (merge permissions, roles, account-access)
│   ├── Story Settings (merge story-context, publish-approvals)
│   ├── Security & Governance (merge security, governance, data-quality)
│   ├── Operations (merge ops, audit-logs, status)
│   ├── Setup Wizard
│   └── Billing
└── FOOTER
    ├── [User avatar + name + role badge]
    ├── Profile Settings
    └── Collapse sidebar
```

Key changes: Group related admin pages, reduce 11 admin items to 6, separate tools from core navigation, and give the user section a proper footer treatment.

---

## Part 2: Page-by-Page Audit & Rebuild Directions

### 2.1 Login / Auth Page

**Current state:** Basic centered card with Email, Password, "Sign in" button, Google SSO button, and "Create an account" link. Dark background.

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | No product branding — just "Sign in" with no logo, tagline, or product context | High |
| 2 | No visual differentiation from a generic template | Medium |
| 3 | No password visibility toggle | Low |
| 4 | No "Forgot password" link | High |
| 5 | Error states for invalid credentials are not visible (no screenshot of error, but likely generic) | Medium |

**Rebuild:**
- Add logo + product name prominently above the form
- Add a left-panel or background illustration showing the product's value prop
- Add "Forgot password?" link below password field
- Add password show/hide toggle
- Consider social proof or feature highlights on the login page

### 2.2 Home / Dashboard

**Current state:** Greeting + subtitle, Recommended Actions checklist, Recent Stories table, 5 metric cards, Customer Success Health section, Team metrics, Risk Indicators alert, Renewal Report.

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | Too much information with no visual hierarchy — everything feels equally weighted | Critical |
| 2 | Metric cards (Stories, Pages, Page Views, etc.) lack hover states and aren't clearly clickable | High |
| 3 | "Recommended Next Actions" items have no clear CTA — just text with checkbox icons | High |
| 4 | Risk Indicators yellow alert box uses inconsistent styling vs other alert patterns | Medium |
| 5 | "View All" link for Recent Stories is too subtle | Medium |
| 6 | Greeting says "Good afternoon, alice" (lowercase name) | Low |
| 7 | Subtitle "RevOps Admin Dashboard" is ambiguous — is this a label or a role indicator? | Medium |

**Rebuild:**
- **Hero section:** Greeting + 1-line role context + "What would you like to do?" with 3-4 quick action cards (Generate Story, Review Approvals, Check Integrations, View Analytics)
- **Metrics strip:** Compact horizontal row of key metrics — clickable, with sparkline trends
- **Two-column layout below:** Left = Recent Stories + Activity Feed; Right = Action items + Alerts
- **Risk Indicators:** Use a proper alert component with icon, severity badge, and dismiss action
- Capitalize user's name properly

### 2.3 Accounts Index

**Current state:** Table with 4 accounts showing Domain, Calls, Stories, Last Activity, Actions (Generate Story, Open, Journey).

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | Three action buttons per row create clutter — "Generate Story" dominates visually | High |
| 2 | Account names aren't clearly styled as clickable links | Medium |
| 3 | Search field is overly wide | Low |
| 4 | No account health indicator or status badges | Medium |
| 5 | "1-4 of 4 accounts" count text is small and poorly positioned | Low |

**Rebuild:**
- Make account name the primary clickable element (bold, blue, opens detail)
- Replace 3 buttons with: row click → detail, overflow menu (⋯) for Generate Story + Journey
- Add health/status indicator column (green/yellow/red dot or badge)
- Add column sorting
- Compact the search + filter bar

### 2.4 Account Detail Page

**Current state:** Shows account info header, stories table, call log, and contact list. Has "Generate Story" CTA.

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | Story action buttons (Copy, Download, PDF, DOCX, Edit, Delete, Preview) are overwhelming per row | Critical |
| 2 | Delete button is red but sits inline with non-destructive actions — accidental clicks likely | High |
| 3 | No clear section navigation for long pages (stories vs calls vs contacts) | Medium |
| 4 | VIEWER sees "VIEW ONLY" badge but it's not consistently styled | Medium |

**Rebuild:**
- Add tabbed navigation: Overview | Stories | Calls | Contacts | Journey
- Stories tab: each story as a card with primary action (View/Edit) + overflow menu for exports
- Move Delete to overflow menu with confirmation dialog
- Calls tab: sortable table with play/view links
- Add breadcrumb: Accounts > Contoso Ltd

### 2.5 Account Journey Page

**Current state:** Two-panel layout — left sidebar with account stats, right panel with timeline visualization. "Generate Story" button present.

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | VIEWER role gets "Failed to load account journey" — should be "Access Restricted" | High |
| 2 | Timeline events need clearer visual markers (dots/lines connecting events) | Medium |
| 3 | Left panel stats are dense with no visual breathing room | Medium |

**Rebuild:**
- Fix error message for restricted roles — show permission-denied component, not generic error
- Add a proper vertical timeline with connected dots, date labels, and expandable event cards
- Left panel: use card-based stat blocks with icons
- Add "Generate Story from this Journey" as a clear CTA at the top

### 2.6 Stories / Story Library

**Current state:** Card-based layout with Seller Cards / Bulk Table toggle. Each card shows title, account, date, status badge, description, and 9 action buttons across 2 rows.

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | **9 action buttons per card is the single biggest UX problem in the app** | Critical |
| 2 | Status badges (Published/Pending) are small and easy to miss | High |
| 3 | Story description text wraps awkwardly, making cards different heights | Medium |
| 4 | View toggle (Seller Cards / Bulk Table) styling is unclear about current selection | Medium |
| 5 | No preview/thumbnail on story cards | Low |

**Rebuild:**
```
Redesigned Story Card:
┌─────────────────────────────────────────────────────────┐
│ [Published ●]                                 Mar 3, 2026│
│                                                          │
│ Contoso Manufacturing: $2.5M in Avoided Downtime         │
│ Contoso Ltd · ROI Analysis                               │
│                                                          │
│ Two-line max description with ellipsis overflow that     │
│ keeps cards the same height...                           │
│                                                          │
│ ┌──────────┐  ┌──────────┐  ┌───┐                       │
│ │  View    │  │  Edit    │  │ ⋯ │ ← overflow menu       │
│ └──────────┘  └──────────┘  └───┘    (Share, Copy, PDF, │
│                                       DOCX, CRM, Delete)│
└─────────────────────────────────────────────────────────┘
```

### 2.7 Landing Pages (Dashboard/Pages)

**Current state:** 4 metric cards + filter bar + table of landing pages.

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | Filter dropdowns (Status, Visibility, Creator) lack visual grouping | High |
| 2 | Metric cards have inconsistent spacing | Medium |
| 3 | Table "Actions" column with "View" + "⋯" is small and cramped | Medium |
| 4 | Column headers are hard to read (small, low contrast) | Medium |

**Rebuild:**
- Metric cards: standardize sizing with consistent icon treatment
- Filters: group into a single filter bar with clear pill-style active filters
- Table: use standardized table component (see 1.3)
- Add bulk actions (multi-select → publish/unpublish/archive)

### 2.8 Landing Page Editor

**Current state:** Markdown editor with Save Draft and Publish buttons. Shows published versions history.

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | Editor is plain textarea — no rich text toolbar, no markdown preview | High |
| 2 | No side-by-side preview of the published page | High |
| 3 | Publish flow doesn't confirm company name scrubbing | Medium |
| 4 | Version history is minimal — just a list of dates | Low |

**Rebuild:**
- Split-pane editor: left = markdown editor with toolbar; right = live preview
- Add toolbar: Bold, Italic, Heading, Quote, Link, Image
- Before publish: show scrubbed preview with highlighted changes
- Version history: show diff between versions

### 2.9 Transcript Viewer

**Current state:** Conversation transcript with speaker badges, timestamps, tags. Right panel shows call metadata and participant list.

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | Speaker badges could use color differentiation per person | Medium |
| 2 | Tags inline with text can be visually noisy | Low |
| 3 | Right panel metadata could use better visual grouping | Medium |

**Rebuild:**
- Color-code speakers consistently (blue for internal, gray for external)
- Move tags to a collapsible sidebar or filter chips
- Right panel: use grouped card sections (Call Info, Participants, Entity Resolution)
- Add "Generate Story from this Call" CTA

### 2.10 Chat / AI Assistant

**Current state:** Empty state with "Select Account" dropdown and a chat bubble icon. No chat input visible until account is selected.

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | Account dropdown is easy to miss (top-right corner, small) | High |
| 2 | Empty state provides no example queries or capabilities overview | High |
| 3 | No suggested prompts or conversation starters | Medium |

**Rebuild:**
- Make account selection the first step with prominent dropdown
- Show 4-6 suggested query cards: "Summarize recent calls with [Account]", "What objections came up?", "Find quantified ROI mentions", etc.
- After account selection, show chat interface with input at bottom and suggestions above
- Include a "capabilities" disclosure so users know what the AI can/can't do

### 2.11 Analytics Dashboard

**Current state:** 6 large metric cards with colorful icons, RevOps KPI section, Attribution Links, Executive Summary.

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | Icon colors on metric cards are arbitrary (blue, purple, green, yellow, red) | High |
| 2 | Metric labels are tiny uppercase text — hard to read | High |
| 3 | "Save View" button purpose is unclear | Medium |
| 4 | Filter dropdowns (All Segments, All Metrics) don't explain what they filter | Medium |
| 5 | No charts or visualizations — all numbers, no trends | High |

**Rebuild:**
- Replace colorful icons with monochrome icons + subtle tint backgrounds
- Add trend indicators (↑12% vs last month) to each metric
- Add at least 2 charts: Call Volume over Time, Story Generation Funnel
- Make filter controls more descriptive: "Filter by Segment" rather than "All Segments"
- Add date range selector prominently

### 2.12 Profile Center

**Current state:** Account Profile form (name, email, role) + User Preferences (story mode, preview, notifications, table density, language).

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | Role field appears editable but is read-only — no visual distinction | High |
| 2 | No "Save" button for User Preferences section — unclear if auto-saved | High |
| 3 | Two-column form layout is unbalanced | Medium |
| 4 | Preference labels are long and unclear ("Compact Table Density", "Open Preview After Generation") | Medium |

**Rebuild:**
- Show Role as a badge/chip, not an input field
- Add explicit "Save Preferences" button (or clear "Auto-saved" indicator after each change)
- Use single-column layout with clear section dividers
- Add descriptions under each preference explaining what it does

### 2.13 Workspaces

**Current state:** Create form at top + empty table below + Shared Asset Library section.

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | Empty state is generic | High |
| 2 | Create form above empty table is poor information architecture | Medium |
| 3 | "Shared Asset Library" section feels disconnected | Medium |

**Rebuild:**
- When empty: show only the empty state with a prominent "Create Workspace" CTA
- When workspaces exist: show workspace cards (not table) with team members, last activity
- Integrate Asset Library as a tab within workspaces, not a separate section

### 2.14 Writebacks

**Current state:** Form with Account ID, Action Type, Title, Body + empty table.

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | Account ID placeholder "acc..." is cryptic — users don't know the format | High |
| 2 | Empty state text cuts off mid-sentence (bug) | Critical |
| 3 | No explanation of what writebacks do or when to use them | High |
| 4 | Form field layout is irregular | Medium |

**Rebuild:**
- Replace Account ID text input with a searchable account dropdown
- Fix truncated text (critical bug)
- Add feature explanation at the top: "Writebacks push story insights back to your CRM..."
- Show writeback status timeline (Requested → Processing → Synced)

### 2.15 Automations

**Current state:** Form with Template, Rule Name, Trigger Type, Metric, Threshold, Channel, Target + empty rules table.

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | Form fields are scattered in 2 columns with no logical grouping | High |
| 2 | Threshold field has no unit label (%, count, etc.) | High |
| 3 | No explanation of available metrics or trigger types | Medium |
| 4 | Empty state is just "0 rules" with blank table | Medium |

**Rebuild:**
- Group form into steps: 1) Choose trigger → 2) Set conditions → 3) Configure delivery
- Or use a wizard/stepper UI for rule creation
- Add metric descriptions in a tooltip or help panel
- Show pre-built templates users can start from

### 2.16 Status Page

**Current state:** Organization ID field + Refresh button + green "All Systems Operational" banner.

**Issues:**
| # | Issue | Severity |
|---|-------|----------|
| 1 | Page is extremely sparse — feels like a stub | Medium |
| 2 | No service component breakdown (API, Database, Sync, AI, etc.) | Medium |
| 3 | No incident history | Medium |
| 4 | No timestamp for last check | Low |

**Rebuild:**
- Show individual service statuses: API ✓, Database ✓, Sync Engine ✓, AI Provider ✓
- Add incident history timeline
- Show "Last checked: 2 minutes ago" with auto-refresh
- Add uptime percentage badges per service

---

## Part 3: Admin Pages Audit

### 3.1 Admin — Account Access

**Issues:** Form layout for granting access needs clearer user picker (searchable dropdown vs text field). Permission scoping needs visual explanation.

### 3.2 Admin — Permissions

**Issues:** Checkbox-heavy grid has contrast issues. Checkmark visibility is low. Need clearer permission grouping and bulk toggle capability.

**Rebuild:** Use a permission matrix with role columns and permission rows. Add "Select All" per role. Use toggle switches instead of checkboxes for better touch targets.

### 3.3 Admin — Roles

**Issues:** Role hierarchy visualization is missing. Users can't see the inheritance chain.

**Rebuild:** Show roles as a visual hierarchy: Owner → Admin → Member → Viewer with inherited permissions displayed.

### 3.4 Admin — Story Context

**Issues:** Taxonomy configuration is functional but dense. No visual preview of how tags appear.

### 3.5 Admin — Audit Logs

**Issues:** Log data is dense and hard to scan. Timestamp formatting varies. No export capability visible.

**Rebuild:** Add filters (date range, user, action type). Use monospace font for IDs. Add export to CSV. Color-code action types.

### 3.6 Admin — Operations

**Issues:** Queue health and dead-letter management is technical. Needs better visualization of job status.

**Rebuild:** Add visual queue health bars. Show job counts by status (pending/processing/failed). Add one-click retry for failed jobs.

### 3.7 Admin — Security

**Issues:** Security settings are presented as a flat form. No indication of current security posture.

**Rebuild:** Add a security score/checklist at the top. Show green checkmarks for configured settings, yellow warnings for gaps.

### 3.8 Admin — Governance & Data Quality

**Issues:** Dense configuration pages with minimal guidance.

**Rebuild:** Add dashboards showing current data quality scores before the configuration forms.

### 3.9 Admin — Publish Approvals

**Issues:** Approval queue needs clearer status indicators and one-click approve/reject.

### 3.10 Admin — Setup Wizard

**Issues:** Should be the entry point for new orgs but feels like just another admin page.

**Rebuild:** Make this a true step-by-step wizard with progress indicator, completion status, and "Next Step" guidance.

### 3.11 Admin — Billing

**Issues:** Billing readiness page shows plan information but button styling is inconsistent with the rest of the admin pages.

### 3.12 Platform Owner Dashboard

**Issues:** Platform-level configuration is functional. AI provider management could use card-based layout.

### 3.13 Account Settings

**Issues:** Low contrast — text is hard to read. Settings feel cramped.

**Rebuild:** Increase font size, add section headers with descriptions, improve contrast ratios to meet WCAG AA.

---

## Part 4: Role-Based UX Audit

### 4.1 What Works Well

- **Permission enforcement is solid** — restricted pages show a clean "Access Restricted" page with lock icon, clear message, and "Return to Home" button
- **Navigation hides irrelevant items** — Viewers don't see Admin menu items
- **Data scoping works** — each role sees only their permitted accounts
- **Role badges** — "OWNER", "MEMBER", "VIEWER" labels appear in the UI

### 4.2 What Needs Fixing

| # | Issue | Severity | Affected Roles |
|---|-------|----------|---------------|
| 1 | Journey page shows "Failed to load" for restricted users instead of "Access Restricted" | High | Viewer |
| 2 | Transcript page shows "Call not found" for restricted users instead of permission message | High | Viewer |
| 3 | No role-specific onboarding — Owner, Sales Member, and Viewer all see the same home layout | High | All |
| 4 | Viewer home says "View Only" in greeting but no explanation of what they CAN do | Medium | Viewer |
| 5 | Member greeting says "Sales Team" — good role context, but should link to a "Getting Started for Sales" guide | Medium | Member |

### 4.3 Rebuild Direction: Role-Specific Home Dashboards

```
OWNER Dashboard:
├── System health strip (green/yellow/red)
├── Pending actions (approvals, failed syncs, billing alerts)
├── Org-wide metrics with trends
└── Quick links to admin tools

MEMBER (Sales) Dashboard:
├── My accounts with recent activity
├── Stories I'm working on
├── Generate Story CTA
└── Quick access to chat/RAG

VIEWER (Exec) Dashboard:
├── Published stories for sharing
├── Key metrics (read-only)
├── Page view analytics
└── Export/share capabilities
```

---

## Part 5: Public Story Pages Audit

**Tested:** /s/manufacturing-iot-roi, /s/meridian-health-journey

### Issues Found

| # | Issue | Severity |
|---|-------|----------|
| 1 | Pages render well with proper company name scrubbing | — (working correctly) |
| 2 | AI badge and callout boxes are functional | — (working correctly) |
| 3 | No social sharing meta tags visible (og:title, og:description, og:image) | Medium |
| 4 | No print-friendly stylesheet | Low |
| 5 | Password-protected pages need a more polished gate UI | Medium |

---

## Part 6: Accessibility Audit Summary

| Category | Status | Priority |
|----------|--------|----------|
| Color contrast (WCAG AA) | ❌ Multiple failures — gray text on white backgrounds, small badge text | High |
| Keyboard navigation | ❌ Focus states missing on most interactive elements | High |
| Screen reader compatibility | ⚠️ Needs testing — many icons lack aria-labels | Medium |
| Form labels | ⚠️ Some inputs use placeholder-only labels (no visible label) | Medium |
| Alt text on images/icons | ❌ Decorative icons lack aria-hidden, functional icons lack labels | Medium |
| Touch targets | ⚠️ Some buttons and links are below 44x44px minimum | Medium |
| Motion sensitivity | ✅ No auto-playing animations observed | — |

---

## Part 7: Priority Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
1. **Define design tokens** (colors, spacing, typography, shadows)
2. **Build core components:** Button (3 tiers), Input, Select, Table, Card, Badge, Alert, EmptyState
3. **Fix critical bugs:** Writebacks truncated text, Journey/Transcript error messages for restricted roles

### Phase 2: Core Screens (Week 3-4)
4. **Rebuild sidebar navigation** with grouped sections
5. **Redesign Home dashboard** per role
6. **Fix Stories page** — reduce to 2 visible actions + overflow menu
7. **Standardize all tables** using shared component

### Phase 3: Forms & Interaction (Week 5-6)
8. **Redesign all forms** — consistent layout, field grouping, validation
9. **Add hover/focus states** to all interactive elements
10. **Add loading skeletons** to all data-fetching pages
11. **Redesign empty states** with illustrations and guidance

### Phase 4: Polish & Admin (Week 7-8)
12. **Rebuild admin pages** — security score, permission matrix, setup wizard
13. **Improve Chat/AI UX** — suggested prompts, capabilities disclosure
14. **Add charts to Analytics** — trends, funnels, time series
15. **Accessibility remediation** — contrast, focus states, aria labels

### Phase 5: Delight (Week 9-10)
16. **Add onboarding flow** for new users (per role)
17. **Add success animations** for key actions (story published, page created)
18. **Add keyboard shortcuts** with discoverable cheat sheet (Cmd+K already works for search)
19. **Polish login page** with branding and product context

---

## Appendix: Component Inventory

Components that need to be built or rebuilt for design system:

| Component | Current State | Action |
|-----------|--------------|--------|
| Button | 5+ inconsistent variants | Rebuild with 3 tiers + destructive |
| Table | Different per page | Build shared component |
| Card | Different per page | Build shared component |
| Badge/Chip | Inconsistent colors | Standardize with semantic colors |
| Input/Select | Inconsistent sizing | Standardize with design tokens |
| Alert/Toast | Inconsistent styling | Build shared component |
| Modal/Dialog | Unknown consistency | Audit and standardize |
| Empty State | Generic text only | Build shared component with illustration slot |
| Loading/Skeleton | Doesn't exist | Build from scratch |
| Breadcrumb | Exists but inconsistent | Standardize |
| Pagination | Different per table | Build shared component |
| Dropdown Menu | Overflow menus vary | Build shared component |
| Avatar/User Badge | Role badges inconsistent | Standardize |
| Metric Card | Different across pages | Build shared component with trend indicator |
| Timeline | Journey page only | Build shared component |
| Permission Gate | Works but error messages vary | Standardize error component |

---

*End of audit. All findings are based on systematic testing of 40+ screens across 4 persona types (Owner, Admin, Member, Viewer) with attention to visual design, interaction design, information architecture, accessibility, and role-based UX.*
