# StoryEngine — Story Creation UX Audit

**Date:** February 24, 2026
**Scope:** End-to-end story creation user experience — from intent to finished story
**Audience:** UI/UX designers and product managers
**Method:** Full source code analysis of every component in the story creation flow, cross-referenced with 3 prior audit documents and 10 seeded test users across 3 organizations
**Standard:** World-class B2B SaaS (Linear, Notion, Jasper, Copy.ai tier)

---

## Executive Summary

StoryEngine's core value proposition is simple: **turn customer call transcripts into polished success stories with one click.** The AI backend that powers this is genuinely impressive — a 4-step prompt chain that gathers transcripts, merges them, generates a narrative via GPT-4o, and extracts quantified quotes with full provenance tracking. The data model is thoughtful (confidence scores, claim lineage, quality feedback loops). The raw capability is there.

**The UX does not match the capability.** Story creation is buried behind 3+ clicks of navigation with no global entry point. The generator modal presents 7 configuration fields simultaneously with no progressive disclosure. The preview renders beautifully inside the modal but degrades to raw `<pre>` tags on the story cards. And for MEMBER-role users — the people most likely to be creating stories day-to-day — the home dashboard doesn't even load (500 error), blocking the primary navigation path entirely.

The gap between what this product *can* do and what it *feels like* to use it is the single biggest opportunity. A user who has never seen StoryEngine should be able to generate their first story within 60 seconds of logging in. Today that takes 3+ minutes of navigation and configuration, assuming the dashboard loads at all.

### Scorecard

| Dimension | Score (1-10) | Summary |
|-----------|:---:|---------|
| **Discoverability** | 3 | Story creation is hidden behind Accounts → Account Detail. No global CTA, no sidebar entry point, no home page shortcut for most roles. |
| **Learnability** | 4 | 7 configuration fields with no guidance, no tooltips, no "what does this do?" affordances. Smart defaults exist but aren't communicated. |
| **Efficiency** | 5 | Once you find the modal, generating a story is straightforward. But there's no quick-generate path and no way to skip configuration. |
| **Feedback & Trust** | 6 | Loading phase communicates what's happening. Preview phase renders markdown well. But loading steps are static, and there's no progress percentage or cancel button. |
| **Output Quality UX** | 5 | The modal preview is good (rendered markdown + quote sidebar). But story cards on Account Detail show raw markdown in monospace. No edit capability. |
| **Post-Generation Actions** | 4 | Only 3 actions: Copy Markdown, Create Landing Page, or close. No Share, no Export PDF, no Regenerate shortcut, no Save & Close. |

**Overall: 4.5 / 10** — Strong backend, weak frontend experience for the core value flow.

---

## 1. The Story Creation Journey — Step by Step

This section walks through the entire story creation experience as a first-time user would encounter it, noting every point of friction.

### Step A: Finding Where to Create a Story

**What happens today:**
1. User logs in and sees their persona-specific home dashboard
2. User must know to click "Accounts" in the sidebar (or the "Generate Story" / "Account Journeys" CTA card on the home page, if their persona shows one)
3. The `/accounts` page does **not** show an account list — it silently auto-redirects to the first available account
4. User arrives at Account Detail for a single account and sees the "Generate Story" button

**Friction points:**

- **No account browsing.** The `/accounts` route (`AccountsIndexPage.tsx`) fetches the user's accounts and immediately redirects to the first one. If you have 50 accounts, you can only reach the first. There is no list view, no search, no way to choose which account to create a story for. This is a critical gap — story creation starts with picking the right account, and there's no UI for that.

- **No global "Create Story" entry point.** The only way to reach the story generator is through Account Detail. There's no "Create Story" button in the header, no floating action button, no sidebar shortcut, and no keyboard shortcut. The primary value action of the entire application requires navigating to a specific sub-page first.

- **MEMBER dashboard is broken.** For MEMBER-role users (Carol, Frank, Jack in the test data), the home dashboard returns a 500 error. This means the "Generate Story" CTA card on the MEMBER dashboard — which does exist in the code and links to `/accounts` — never renders. These users see an error page with a retry loop. This blocks the entire entry flow for the user role most likely to be creating stories.

- **3+ clicks minimum.** Even when everything works: Home → Accounts (sidebar) → (auto-redirect to first account) → "Generate Story" button. That's assuming the user wants the first account. If they want a different account, there's no way to get there through the UI.

**Recommendation for designers:**

> Add a global "New Story" button to the app header bar, visible on every page. Clicking it should open an account picker (searchable dropdown or modal with account cards showing name, call count, and last story date), then flow directly into the story generator. This single change would reduce the path from 3+ clicks to 1 click from anywhere in the app.
>
> Separately, the `/accounts` page needs a full redesign as a browsable, searchable account list with cards or a table showing each account's name, call count, existing stories, and a prominent "Generate Story" action on each row.

---

### Step B: The Story Generator Modal — Form Phase

**What happens today:**

The user clicks "Generate Story" on Account Detail. A modal opens with the account name displayed as context. The modal body contains 7 form fields presented all at once in a single scrollable view:

1. **Funnel Stages** — Multi-select dropdown (6 options: TOFU, MOFU, BOFU, POST_SALE, INTERNAL, VERTICAL)
2. **Topics** — Multi-select dropdown (up to 43 options, grouped by stage, dynamically filtered)
3. **Custom Title** — Text input (optional, placeholder: "Auto-generated if left blank")
4. **Story Format** — Grid of 7 button-style options with emoji icons (Before/After, Day-in-the-Life, By the Numbers, Video Testimonial, Joint Webinar, Peer Reference, Analyst-Validated)
5. **Story Length** — Native `<select>` dropdown (Short, Medium, Long, Executive Brief)
6. **Story Outline** — Native `<select>` dropdown (Chronological Journey, Problem→Solution→Impact, By the Numbers, Executive Brief, Implementation Playbook, Deal Anatomy)
7. **Story Type** — Native `<select>` dropdown (Full Account Journey, or any of 43 taxonomy topics)

The modal footer has Cancel and Generate Story buttons.

**Friction points:**

- **Option overload.** 7 fields, some with dozens of options, all visible at once. A new user encountering this for the first time has no way to know which fields matter, which are optional, or what the defaults will produce. The cognitive load is high. Compare this to Jasper or Copy.ai where you pick a template first, then see only the relevant fields.

- **No progressive disclosure.** All fields are shown simultaneously regardless of whether the user wants simple or advanced control. There should be a "Quick Generate" path (one click with smart defaults) and an "Advanced" path (full configuration). Today the only path is the advanced path.

- **No explanations or examples.** What does "Before/After Transformation" produce versus "By the Numbers Snapshot"? What's the difference between "Chronological Journey" and "Problem → Solution → Impact" outlines? There are no tooltips, no descriptions, no example snippets. Users must guess.

- **Mixed interaction patterns.** The Format selector uses a custom button grid. Length, Outline, and Type use native `<select>` elements. Stages and Topics use custom multi-select dropdowns. Three different input paradigms in one form. This is disorienting.

- **The Story Type dropdown is overwhelming.** It contains "Full Account Journey" plus all 43 taxonomy topics in a flat list. Scrolling through 44 options in a native `<select>` is a poor experience. Most users will never change this from the default.

- **Smart defaults are invisible.** The modal loads org-level defaults from the API on mount (via `getStoryContextSettings()`), silently populating Length, Outline, Format, and Type. But there's no visual indication that these are org-configured defaults. Users don't know if they're seeing a smart recommendation or a random starting value.

- **No preview of what you'll get.** Before clicking "Generate Story" (which takes 15-30 seconds), users have no way to preview or understand what the output will look like based on their selections. They're committing to a 30-second wait based on guesswork.

**Recommendation for designers:**

> Redesign the modal as a 2-mode experience:
>
> **Quick Mode (default):** Show only the account name and a large "Generate Story" button. Below it, a small text link: "Customize settings" that expands to show the advanced options. The button uses org-configured defaults. This gets 80% of users to a generated story in one click.
>
> **Advanced Mode:** When expanded, organize the 7 fields into logical groups with progressive disclosure:
> - **Step 1: Focus** — Funnel Stages and Topics (with a note: "Leave blank to use all available data")
> - **Step 2: Format** — Format grid, Length, and Outline (with short descriptions or hover previews for each option)
> - **Step 3: Type** — Story Type (with the 43 topics hidden behind a "Topic-specific story" toggle, not dumped into a flat dropdown)
>
> Add a "Defaults" badge next to any field that's using an org-configured default, with a tooltip: "Set by your admin in Story Context settings."

---

### Step C: Loading Phase

**What happens today:**

After clicking "Generate Story," the modal transitions to a loading state. It shows:
- A spinning animation
- "Generating your story..." heading
- Explanatory text: "Analyzing transcripts, extracting insights, and composing a structured narrative. This typically takes 15-30 seconds."
- Three status steps listed vertically:
  - "Gathering transcript segments" (marked active with a filled dot)
  - "Building journey narrative"
  - "Extracting high-value quotes"

**Friction points:**

- **Steps are static.** The first step is always shown as "active" and the others as pending. The steps don't animate to reflect actual backend progress. This was likely designed as a real-time progress indicator but is implemented as a static display. After 15 seconds of staring at the same "Gathering transcript segments" dot, users will wonder if it's frozen.

- **No cancel button.** If a user clicked "Generate Story" accidentally or changed their mind after 10 seconds, there's no way to cancel. They must wait for the full generation to complete (or close the modal entirely, losing context).

- **No progress percentage.** "15-30 seconds" is a wide range. A progress bar or percentage estimate (even an approximate one) would reduce anxiety.

- **No partial results.** The user sees nothing until the entire 4-step pipeline completes. In a world where ChatGPT streams tokens in real time, a 30-second black-box wait feels dated.

**Recommendation for designers:**

> - Animate the steps so they transition from pending → active → complete as the backend progresses. Even if the frontend can't track exact backend state, use timed transitions (e.g., step 1 completes at 5s, step 2 at 15s, step 3 at 25s) to create a sense of progress.
> - Add a thin progress bar at the top of the modal that fills over the expected duration.
> - Add a "Cancel" link below the spinner that closes the modal and discards the in-flight request.
> - Consider streaming: show partial markdown as it generates, similar to how ChatGPT shows tokens appearing. This transforms a passive wait into an engaging reveal.

---

### Step D: Preview Phase

**What happens today:**

When generation completes, the modal widens and shows a two-column layout:

**Left column — Story Content:**
- Full markdown rendered via ReactMarkdown with GitHub-flavored markdown support
- Headings, paragraphs, tables, lists all render correctly
- Wrapped in an `<article>` tag with `markdown-body` class

**Right column — High-Value Quotes Sidebar:**
- "High-Value Quotes" heading
- Cards for each extracted quote showing:
  - Blockquote text
  - Speaker attribution (if available)
  - Metric value and type (e.g., "30%" / "cost savings")

**Toolbar above the content:**
- Back button (returns to form, preserves selections)
- Copy Markdown button (copies raw markdown to clipboard, shows "Copied!" for 2 seconds)
- Create Landing Page button (primary action, creates a page and navigates to editor)

**Friction points:**

- **No edit capability.** The preview is read-only. If the generated story has a factual error, an awkward sentence, or a section that needs trimming, the user can't fix it here. They must copy the markdown, edit it elsewhere, and manually paste it into a landing page. This is a significant workflow break for a content creation tool.

- **No "Regenerate" shortcut.** If the story isn't quite right, the only option is "Back" (return to the form) and "Generate Story" again. There's no "Regenerate" button that re-runs with the same settings, and no "Regenerate with changes" option that lets you tweak one parameter without re-filling the whole form.

- **No word count or reading time.** Users selected a story length (e.g., "Medium: 900-1400 words") but can't verify the output meets that target without copying the text and counting words elsewhere.

- **No source attribution on quotes.** Quote cards show the speaker name and metric, but don't link to the source call or transcript timestamp. Users who want to verify a quote's accuracy have no path to do so from this view. (The backend stores `callId` and `lineageMetadata` with timestamps — the data exists, it's just not surfaced.)

- **"Create Landing Page" requires a round-trip.** The `buildStory` API response returns title, markdown, and quotes — but not the story's database ID. To create a landing page, the frontend must make a separate `GET /api/stories/:accountId` call, find the most recent story, and use its ID. This is fragile (what if two users generate simultaneously?) and adds latency to the primary CTA.

- **"Copy Markdown" label is jargon.** Non-technical users (sales managers, CSMs) may not know what "Markdown" means. "Copy MD" on story cards is even more cryptic.

**Recommendation for designers:**

> - Add a "Regenerate" button next to "Back" that re-runs generation with the same settings. Add a small dropdown arrow on it for "Regenerate with changes" that reopens the form with values preserved.
> - Add a word count and estimated reading time in the toolbar (e.g., "1,247 words · 5 min read").
> - Make quote cards clickable — tapping a quote should show its source call name, timestamp, and a "View Transcript" link.
> - Rename "Copy Markdown" to "Copy to Clipboard." Drop "MD" entirely from the story cards.
> - Add a "Download as PDF" option alongside Copy and Create Landing Page.
> - Longer-term: add inline editing to the preview. Even a simple "click to edit" on paragraphs would dramatically improve the workflow. At minimum, add a "Edit in Landing Page Editor" option that creates the page and opens it with the cursor in the body.

---

### Step E: Post-Generation — Story Cards on Account Detail

**What happens today:**

After closing the modal, the Account Detail page refreshes its story list. Each previously generated story appears as a card (`StoryCard` component) showing:
- Story title
- Type badge (e.g., "Full Journey")
- Generation date
- Quote count
- Two buttons: "Copy MD" and "Preview" / "Collapse"

When "Preview" is clicked, the card expands to show the story's full markdown inside a `<pre>` tag — raw, unrendered markdown with no formatting.

**Friction points:**

- **Raw markdown in `<pre>` tags.** This is the most jarring UX inconsistency in the story flow. Inside the generator modal, the story renders beautifully as formatted prose with headings, lists, and tables via ReactMarkdown. But on the story cards — the permanent, at-a-glance view — the same content displays as raw markdown syntax (`## Heading`, `**bold**`, `| table |`) in a monospace font. It looks like a code dump, not a story. This completely undermines the perceived quality of the generated content.

- **No story status.** Cards don't indicate whether a story has been used (turned into a landing page, shared, etc.) or if it's just a raw generation. There's no draft/published/archived state visible.

- **No search, filter, or sort.** If an account has 10+ generated stories, there's no way to find a specific one except scrolling. No search by title, no filter by type or date, no sort options.

- **No bulk actions.** Can't delete multiple stories, can't compare two stories, can't archive old generations.

- **No "Create Landing Page" action on cards.** The only way to create a landing page from an existing story is to re-open the generator modal. Story cards only offer "Copy MD" and "Preview."

**Recommendation for designers:**

> - **Render story previews as formatted prose**, using the same `ReactMarkdown` renderer that the modal uses. Show the first ~200 words as a preview snippet on the card, expandable to full content.
> - Add a status badge to each card: "Draft" (just generated), "Page Created" (has a linked landing page), "Published" (landing page is live).
> - Add a "Create Landing Page" button on each story card.
> - Add a search bar and filter chips (by type, date range) above the story list.
> - Add a "Delete" action (with confirmation) on story cards for cleanup.

---

## 2. Per-Role Story Creation Experience

### OWNER / ADMIN (Alice, Bob, Eve, Hank, Iris)

**Path to story creation:** Home → sidebar "Accounts" → auto-redirect to first account → "Generate Story"

**What works:** Full access to all features. The admin dashboard shows KPIs and recommended actions, including story-related CTAs. The "Generate Story" button is prominently displayed on Account Detail.

**What doesn't:**
- The admin dashboard is dense with KPIs, health scores, and renewal data. Story creation CTAs compete with 6 stat cards, customer health tables, and risk indicators. The "Account Journeys" CTA exists but doesn't stand out as the path to story creation.
- No dedicated "Story Library" view showing all stories across all accounts. Admins managing 50+ accounts have no way to see an aggregate story inventory.

**Recommendation:** Add a "Stories" section to the admin dashboard showing recent stories across all accounts (last 5-10), with a "View All" link to a new Story Library page.

---

### MEMBER (Carol, Frank, Jack)

**Path to story creation:** Home (broken) → ??? → story creation is unreachable

**What works:** The code includes a `MemberDashboard` component with a prominent "Generate Story" CTA card that links to `/accounts`. This is the right design intent.

**What doesn't:**
- **The MEMBER home dashboard returns a 500 error.** This is a backend bug (the `/api/dashboard/home` endpoint fails for MEMBER role), but the result is that the entire story creation entry point is broken for this role. The error page shows a generic "Failed to load dashboard" with a retry button that loops.
- Even if the dashboard worked, the "Generate Story" CTA links to `/accounts`, which auto-redirects to the first account. Members with access to multiple accounts can't choose.
- The persona assignment bug (documented in prior audits) can cause MEMBER users to receive REVOPS_ADMIN persona, showing them admin navigation items they can't actually use.

**Recommendation:** This is the most urgent fix. MEMBER users are the primary story creators in most organizations. Fix the 500 error, then ensure the MEMBER dashboard's "Generate Story" CTA flows into an account picker, not an auto-redirect.

---

### VIEWER (Dave, Grace)

**Path to story creation:** N/A — viewers can't generate stories

**What works:** The "Generate Story" button on Account Detail is correctly hidden when `userRole === "VIEWER"`. The empty state message changes from "Generate your first story" to "No stories have been generated for this account." This is good role-aware UI.

**What doesn't:**
- Viewers can still see the story cards and "Copy MD" / "Preview" actions. Whether viewers should be able to copy story markdown is a product decision, but if stories contain sensitive customer data, this may be an unintended information leak.
- The sidebar may still show "Accounts" and other story-adjacent navigation, creating the impression that there's more to do than there is.

**Recommendation:** Consider whether VIEWER role should see story content at all, or only published landing pages. If viewers should see stories, add a "View Only" indicator on the Account Detail page.

---

### CSM / Sales Manager personas

**Path to story creation:** Home → "Account Journeys" CTA → auto-redirect → "Generate Story"

**What works:** The CSM dashboard has an "Account Journeys" CTA card. The Sales Manager persona also has account access.

**What doesn't:**
- No "Story Library" view. CSMs and sales managers who need to find existing stories across their accounts must navigate to each account individually.
- The Account Journey page (`/accounts/:id/journey`) — a beautiful timeline of customer interactions — has no "Generate Story" button. Users viewing the journey context must navigate back to Account Detail to generate a story. This is a missed opportunity: the journey page provides the richest context for why you'd want to generate a story.
- No way to search stories by content, quote, or metric across accounts.

**Recommendation:** Add a "Generate Story" button to the Account Journey page. Add a cross-account Story Library accessible from the sidebar.

---

## 3. Critical Issues (P0) — Fix Before Launch

### 3.1 MEMBER Dashboard 500 Error
**Impact:** Blocks the entire story creation flow for MEMBER-role users across all organizations.
**What users see:** Red error icon, "Failed to load dashboard," retry loop.
**Root cause:** Backend `/api/dashboard/home` endpoint fails for MEMBER role.
**Fix:** Backend bug fix. Additionally, the error state should provide alternative navigation: "While we fix this, try [Accounts](/accounts) or [Pages](/dashboard/pages)."

### 3.2 No Account Browsing
**Impact:** Users with multiple accounts can only reach the first one through the UI.
**What users see:** `/accounts` silently redirects to the first account. No list, no search, no choice.
**Root cause:** `AccountsIndexPage.tsx` fetches accounts and immediately redirects to `accounts[0].id`.
**Fix:** Replace with a full account list page showing cards or table rows with: account name, call count, story count, last activity date, and a "Generate Story" action per row.

### 3.3 No Global Story Creation Entry Point
**Impact:** Story creation — the primary value action — is buried behind navigation.
**What users see:** Must navigate to a specific account's detail page to find the "Generate Story" button.
**Fix:** Add a persistent "New Story" button to the app header or as a floating action button. On click, open an account picker → story generator flow.

### 3.4 Raw Markdown in Story Cards
**Impact:** The permanent view of generated stories looks like a code dump, undermining perceived quality.
**What users see:** `<pre>` blocks with unrendered markdown syntax when expanding a story card.
**Fix:** Use the same `ReactMarkdown` renderer on story cards that the modal preview uses.

### 3.5 No Story Editing
**Impact:** Users can't correct errors, trim content, or customize AI-generated stories.
**What users see:** Read-only preview with no edit affordance.
**Fix:** At minimum, add a "Edit as Landing Page" action that creates a landing page and opens the editor. Longer-term, add inline editing to the story preview.

---

## 4. High-Priority Issues (P1) — Fix Soon After Launch

### 4.1 Option Overload in Story Generator Modal
7 configuration fields with no progressive disclosure. Add a "Quick Generate" default mode.

### 4.2 No Onboarding or First-Run Guidance
No tooltip tour, no "first story" guided experience, no empty-state prompts explaining what the tool does. New users face a blank Account Detail page with a "Generate Story" button and no context.

### 4.3 Static Loading Steps
The 3-step progress indicator doesn't animate. Add timed transitions or real backend status polling.

### 4.4 No Cancel During Generation
Users committed to a 15-30 second wait can't abort. Add a cancel option.

### 4.5 No Regenerate Shortcut
From preview, users must go "Back" to the form and re-click "Generate." Add a "Regenerate" button.

### 4.6 "Copy MD" Label is Jargon
Rename to "Copy to Clipboard" or "Copy Story." Non-technical users don't know what "MD" means.

### 4.7 No Story Status Indicators
Story cards don't show whether a landing page was created, whether the story was published, or its age. Add status badges.

### 4.8 Missing "Generate Story" on Journey Page
The Account Journey page (`/accounts/:id/journey`) provides the richest context for story creation but has no generate button. Add one.

### 4.9 Landing Page Creation Fragility
The "Create Landing Page" action fetches the latest story by account ID rather than using the story ID directly from the generation response. This is fragile. The `buildStory` API should return the persisted story's ID.

---

## 5. Medium-Priority Issues (P2) — Polish

### 5.1 No Story Format Previews
The Format selector shows 7 options with emoji icons and labels but no example output. Users can't predict what "Day-in-the-Life Workflow" will produce versus "By the Numbers Snapshot."

**Recommendation:** Add a small preview snippet or description below each format option. Example: "Before/After Transformation — Contrasts the customer's situation before and after your product, emphasizing the transformation journey."

### 5.2 Story Type Dropdown is Overwhelming
The Story Type dropdown contains "Full Account Journey" plus all 43 taxonomy topics in a flat `<select>`. This is unusable.

**Recommendation:** Replace with a two-tier selection: a toggle between "Full Account Journey" and "Topic-Specific Story," where the latter expands to show a searchable topic picker grouped by funnel stage.

### 5.3 No Word Count on Preview
Users select a target length (e.g., 900-1400 words) but can't verify the output meets it.

### 5.4 No Quote Source Links
Quote cards show speaker and metric but don't link to source transcripts. The data exists in the backend (call ID, chunk ID, timestamp) but isn't surfaced.

### 5.5 Modal Doesn't Remember Settings
Each time the modal opens, it resets to org defaults. If a user generates several stories with similar settings, they must re-select each time.

### 5.6 No Story Search or Filtering
Account Detail shows all stories in a flat list with no search, filter by type, or sort by date.

### 5.7 No Export Options
Stories can only be copied as markdown or turned into landing pages. No PDF export, no DOCX, no email share.

### 5.8 No Cross-Account Story Library
No way to see all stories across all accounts in one view. Every story is siloed under its account.

---

## 6. Competitive Benchmark

| Capability | StoryEngine Today | World-Class Standard |
|-----------|-------------------|---------------------|
| **Entry point** | Buried 3 clicks deep under Accounts | Global "Create" button, 1 click from anywhere (Notion, Linear) |
| **Configuration** | 7 fields, all visible, no guidance | Template-first with preview (Jasper); wizard with live preview (Copy.ai) |
| **Generation feedback** | Static 3-step list, 15-30s black box | Token streaming in real time (ChatGPT); animated progress with partial results (Jasper) |
| **Output preview** | Rendered markdown in modal (good); raw markdown on cards (bad) | WYSIWYG with inline editing (Notion); side-by-side edit/preview (Hashnode) |
| **Post-generation** | Copy Markdown, Create Landing Page | Edit inline, Regenerate, Export PDF, Share via email, Publish directly (Jasper, Copy.ai) |
| **Story library** | Per-account list only | Searchable library with filters, tags, folders, team sharing (Notion, Contentful) |
| **Onboarding** | None | Interactive first-run wizard, template gallery, sample stories (Jasper) |

---

## 7. Design Recommendations — Prioritized

### Tier 1: Unblock Story Creation (1-2 days of design + dev)

1. **Fix MEMBER dashboard error** — Backend fix + fallback navigation in error state
2. **Build an Account List page** — Replace the auto-redirect with a browsable, searchable list. Each row: account name, call count, story count, "Generate Story" action button
3. **Add global "New Story" button** — Persistent in the app header. Opens account picker → story generator
4. **Render story cards as formatted prose** — Swap `<pre>` for `ReactMarkdown` on story card previews

### Tier 2: Simplify Story Creation (3-5 days of design + dev)

5. **Add "Quick Generate" mode** — Default the modal to a single "Generate Story" button with org defaults. Show a "Customize" toggle that expands to the full 7-field form
6. **Add "Regenerate" button** — On the preview phase toolbar, next to Back
7. **Rename "Copy MD" to "Copy to Clipboard"** — Across all story card and preview buttons
8. **Add "Generate Story" to Journey page** — The journey timeline provides the best context for story creation
9. **Return story ID from build API** — Eliminate the fragile re-fetch when creating landing pages

### Tier 3: Enrich the Story Experience (1-2 weeks of design + dev)

10. **Add format/outline previews** — Show example snippets or descriptions for each format and outline option
11. **Animate loading steps** — Timed transitions through the 3 generation phases with a progress bar
12. **Add word count and reading time** — Display on the preview toolbar
13. **Add story status badges** — Draft / Page Created / Published on each story card
14. **Build a Story Library page** — Cross-account view of all stories, searchable, filterable, accessible from sidebar
15. **Add quote source links** — Make quote cards clickable to view source transcript

### Tier 4: World-Class Polish (2-4 weeks of design + dev)

16. **Add inline story editing** — Click-to-edit on the preview phase, or at least an "Edit as Landing Page" fast path
17. **Add PDF/DOCX export** — Download button on preview and story cards
18. **Add streaming generation** — Show markdown tokens appearing in real time during generation
19. **Add first-run onboarding** — Guided tour highlighting the Generate Story button, explaining configuration options, and generating a sample story
20. **Add story templates** — Pre-configured combinations of format + outline + type (e.g., "Quick ROI Snapshot," "Full Customer Journey," "Executive Brief") that reduce the 7-field form to a single template selection

---

## 8. Accessibility Notes (Story Creation Flow)

The story creation flow has solid accessibility foundations that many apps miss:

**What's good:**
- The `StoryGeneratorModal` has `role="dialog"`, `aria-modal="true"`, and `aria-label="Generate Story"`
- Focus trap is properly implemented (Tab cycles within modal, Shift+Tab reverses, Escape closes)
- Previous focus is restored when the modal closes (the element that triggered it gets focus back)
- The multi-select component uses `role="combobox"`, `aria-expanded`, `aria-haspopup="listbox"`, and `aria-label` on the search input
- Loading state uses `role="status"` and `aria-live="polite"`
- Error state uses `role="alert"`
- Close button has `aria-label="Close"`
- Decorative SVGs use `aria-hidden="true"`
- Selected tags in multi-select have `aria-label` for remove buttons (e.g., "Remove Top of Funnel")

**What needs improvement:**
- The `FormatSelector` grid buttons have no `aria-pressed` attribute to communicate selection state to screen readers. Sighted users see visual highlighting; screen reader users can't tell which format is selected.
- Native `<select>` elements for Length, Outline, and Type lack `id` attributes, so their `<label>` elements aren't properly associated via `for`/`htmlFor`. They use visual proximity instead of semantic association.
- The multi-select dropdown options use `<label>` wrapping `<input type="checkbox">`, which is correct, but the group labels (`<div className="multi-select__group-label">`) are just visual — they don't use `role="group"` or `aria-labelledby` to associate options with their group.
- Story cards on Account Detail have no `aria-expanded` attribute on the "Preview" / "Collapse" toggle button.
- The Copy Markdown feedback ("Copied!") is only visual — it doesn't announce to screen readers. Add an `aria-live="polite"` region for the feedback.

---

## 9. Systemic Issues That Affect Story Creation

These broader application issues aren't specific to story creation but directly impact the story creation experience.

### 9.1 CSS Class-Name Drift
Multiple pages have JSX class names that don't match CSS selectors (e.g., `admin-perms__*` vs `admin-perm__*`, `chat__bubble` vs `chat__message-bubble`). While the story creation modal itself is well-styled, surrounding pages like the dashboard and chat show styling gaps that erode trust before users ever reach the story generator.

### 9.2 Raw Enum Values in UI
Throughout the app, raw enum keys like `problem_challenge_identification` and `TRANSCRIPT_MINUTES` appear in user-facing UI. A `formatEnumLabel()` utility exists but isn't consistently applied. This is relevant to story creation because the Home dashboard's "Recommended Actions" and renewal reports use these raw values, creating a perception of unfinished quality before the user even starts creating stories.

### 9.3 Persona Assignment Bug
MEMBER users without a `role_profile_key` default to `REVOPS_ADMIN` persona, causing them to see admin navigation items. This creates confusion about what they should be doing (admin tasks?) when their primary workflow should be story creation.

### 9.4 No Breadcrumbs on Key Pages
The Account Detail page does have breadcrumbs (Home → Accounts → Account Name), which is good. But the Account Journey page and many admin pages lack them, making it hard to navigate back to the story creation entry point.

### 9.5 Sidebar Navigation Overload
The sidebar shows ~18 items at once for admin roles, including 10+ admin items. Story creation competes with administration, analytics, chat, and workspace management for attention. For MEMBER users, the sidebar should be dramatically simplified to focus on story creation and content management.

---

## 10. Summary — The Single Most Important Change

If you could make only one change to improve the story creation UX, it should be:

**Add a global "New Story" button that opens an account picker and flows directly into a simplified story generator.**

This single change would:
- Reduce the path from 3+ clicks to 1 click
- Eliminate the dependency on the broken MEMBER dashboard
- Remove the need for the auto-redirect AccountsIndexPage
- Give story creation the prominence it deserves as the primary value action
- Work for every role and persona

The second most important change: **render story cards as formatted prose instead of raw markdown.** The story generator produces beautiful content. The permanent view of that content should reflect its quality.

Everything else — the progressive disclosure, the loading animations, the regenerate button, the story library — is polish on top of these two foundational changes.

---

## Appendix A: Test Environment Reference

| User | Role | Org | Home Dashboard | Story Creation Access |
|------|------|-----|----------------|----------------------|
| Alice | OWNER | Acme | Admin Dashboard (works) | Full access via Accounts |
| Bob | ADMIN | Acme | Admin Dashboard (works) | Full access via Accounts |
| Carol | MEMBER | Acme | **500 Error** | Blocked by dashboard failure |
| Dave | VIEWER | Acme | Exec Dashboard (works) | Correctly restricted — no generate button |
| Eve | OWNER | Globex | Admin Dashboard (works) | Full access via Accounts |
| Frank | MEMBER | Globex | **500 Error** | Blocked by dashboard failure |
| Grace | VIEWER | Globex | Exec Dashboard (works) | Correctly restricted |
| Hank | OWNER | Initech | Admin Dashboard (works) | Full access via Accounts |
| Iris | ADMIN | Initech | Admin Dashboard (works) | Full access via Accounts |
| Jack | MEMBER | Initech | **500 Error** | Blocked by dashboard failure |

## Appendix B: Key Source Files

| File | What it does |
|------|-------------|
| `frontend/src/components/StoryGeneratorModal.tsx` | The 563-line, 4-phase story creation modal (form → loading → preview → error) |
| `frontend/src/pages/AccountDetailPage.tsx` | Entry point for story creation; displays story cards |
| `frontend/src/pages/AccountsIndexPage.tsx` | The `/accounts` route — auto-redirects to first account, no list view |
| `frontend/src/pages/HomePage.tsx` | Persona-specific dashboards including MEMBER's "Generate Story" CTA |
| `frontend/src/components/MultiSelect.tsx` | Multi-select dropdown for funnel stages and topics |
| `frontend/src/components/FormatSelector.tsx` | Button grid for story format selection |
| `frontend/src/types/taxonomy.ts` | All story configuration types, options, and labels (43 topics, 7 formats, 6 outlines, 4 lengths) |
| `frontend/src/lib/api.ts` | API client: `buildStory()`, `getAccountStories()`, `createLandingPage()`, `getStoryContextSettings()` |
| `frontend/src/App.tsx` | Routing and sidebar navigation — 27 routes, role-based nav building |
| `src/services/story-builder.ts` | Backend: 4-step GPT-4o prompt chain (gather → merge → generate → extract) |
| `src/api/story-routes.ts` | Backend: `POST /api/stories/build`, `GET /api/stories/:accountId` |

## Appendix C: Story Generator Modal — Configuration Options Reference

| Field | Type | Options Count | Default | Notes |
|-------|------|:---:|---------|-------|
| Funnel Stages | Multi-select | 6 | All (no filter) | TOFU, MOFU, BOFU, POST_SALE, INTERNAL, VERTICAL |
| Topics | Multi-select (grouped) | 43 | All (no filter) | Dynamically filtered by selected stages |
| Custom Title | Text input | — | Auto-generated | Pattern: "{Account}: {Topic} Story" |
| Story Format | Button grid | 7 | Org default | Emoji icons + labels, toggle selection |
| Story Length | Select dropdown | 4 | MEDIUM (org default) | SHORT (500-800), MEDIUM (900-1400), LONG (1500-2400), EXECUTIVE (350-600) |
| Story Outline | Select dropdown | 6 | CHRONOLOGICAL_JOURNEY (org default) | Determines section structure of output |
| Story Type | Select dropdown | 44 | FULL_ACCOUNT_JOURNEY (org default) | "Full Account Journey" + all 43 taxonomy topics |

---

*This audit was compiled from analysis of the complete StoryEngine frontend and backend source code, including all components in the story creation flow, all page components, the routing and navigation system, the database schema, and the AI generation pipeline. Three prior audit documents were cross-referenced for consistency. Test environment includes 10 users across 3 organizations (Acme, Globex, Initech) with seeded call data, transcripts, and account records.*
