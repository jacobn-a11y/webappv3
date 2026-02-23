# StoryEngine — Brand Guide

> **Purpose of this document:** This is a machine-readable brand guide for **StoryEngine**, a B2B SaaS platform that turns call recordings into publishable case studies. Any LLM generating UI, marketing copy, landing pages, emails, or design assets for StoryEngine should follow these rules exactly.

---

## 1. What StoryEngine Is

StoryEngine consolidates call recordings into Account Journey views with AI-powered story extraction. It turns hours of sales and customer success calls into publishable, company-name-scrubbed case studies — automatically.

**Core pipeline:** Raw call audio → Transcript processing → AI tagging → Vector indexing → Story generation → Scrubbed landing pages.

**Target users:** B2B SaaS marketing teams, RevOps, sales enablement, solutions consulting, and customer success.

**Brand personality:** Premium, technical, confident, minimal. The brand communicates "enterprise-grade intelligence" through restraint rather than loudness.

### Logo

StoryEngine uses a **text-only wordmark** — no icon, no symbol. The logo is the word "StoryEngine" rendered in the primary typeface.

```
Logo text:       StoryEngine
Font weight:     700 (bold — the ONE exception to the light-headline rule)
Font size:       16px (in-app nav) / scale up proportionally for marketing
Color on dark:   blue-400 (#336FE6)
Color on gradient / light:  white (#FFFFFF) or black (#1E1E1E) depending on contrast
Text decoration: none
```

The wordmark is always rendered as a single word with a capital S and capital E ("StoryEngine", not "Story Engine" or "storyengine"). In the application navigation, it links to the home/dashboard route. The logo color must always use `blue-400` (`#336FE6`) on dark backgrounds — the same primary action color used across the entire brand system.

---

## 2. Design Principles

These six principles govern every design decision. They are non-negotiable.

### 2.1 Dark-First Confidence
The entire brand leads with a near-black (`#090A0F`) foundation. This is not "dark mode" — it is the primary identity. White and light sections exist only as contrast moments, never the default. This conveys premium, technical confidence.

### 2.2 Weightless Typography
Hero headlines use ultra-light weight (300) at massive scale (up to 96px). The tension between size and delicacy creates effortless elegance — the type feels like it floats. Body copy stays light too.

### 2.3 Restrained Color
Color is used surgically. Blue (`#336FE6`) appears almost exclusively on interactive elements: buttons, links, arrows. Everything else is grayscale. Gradients appear only in hero accent moments using aurora-like teal/blue/purple blends.

### 2.4 Generous Whitespace
Sections breathe with 100px+ vertical padding. Content is centered and constrained to ~1200px max-width. There is no visual clutter. The emptiness itself communicates confidence and sophistication.

### 2.5 Systematic Navigation
Section labels use a numbered taxonomy (e.g., "Account Journeys — 01", "Story Builder — 02") that gives the interface a structured, almost editorial feel. This creates a sense of intentional information architecture.

### 2.6 Minimal Decoration
No box shadows. No heavy gradients on cards. Borders are 1px and use muted neutrals. The brand trusts typography, space, and color restraint to do the work. Decoration is reserved for gradient hero moments only.

---

## 3. Color System

The color system is built from seven carefully tuned scales. Each color has a range from 000 (lightest) to 600+ (darkest).

### 3.1 Neutrals — The Foundation

| Token | Hex | Usage |
|---|---|---|
| `neutral-000` | `#090A0F` | Primary background (near-black) |
| `neutral-100` | `#121213` | Card backgrounds, code blocks |
| `neutral-200` | `#1C1B1C` | Secondary backgrounds, section labels |
| `neutral-300` | `#2E2D2F` | Borders, dividers |
| `neutral-400` | `#5C5B5E` | Heavier borders, label borders |
| `neutral-500` | `#8A888E` | Muted text, captions, footnotes |
| `neutral-600` | `#A19FA5` | Subtitle text, lead paragraphs |
| `neutral-700` | `#B8B6BD` | Body text, nav links |
| `neutral-800` | `#CFCCD4` | Emphasized body text |
| `neutral-900` | `#E6E3EC` | Light surface (rare) |
| `neutral-1000` | `#F3F1F6` | Near-white surface |
| `neutral-1100` | `#FAF9FB` | Lightest surface |
| `white` | `#FFFFFF` | Headlines on dark, button text |
| `black` | `#1E1E1E` | Text on light/gradient backgrounds |

The neutral scale skews cool with a faint purple undertone. Backgrounds use 000–200. Borders use 300–400. Body text uses 500–700. Near-white surfaces use 1000–1100.

### 3.2 Blue — Primary Action Color

| Token | Hex | Usage |
|---|---|---|
| `blue-000` | `#EBF2FF` | Lightest tint (backgrounds) |
| `blue-100` | `#B0CAFF` | Light accent |
| `blue-200` | `#6195FF` | Code syntax highlighting |
| `blue-300` | `#397BFF` | Hover state for buttons/links |
| `blue-400` | `#336FE6` | **PRIMARY ACTION COLOR** — buttons, link arrows, interactive highlights |
| `blue-500` | `#2256C5` | Active/pressed state |
| `blue-600` | `#224A99` | Dark accent |
| `blue-700` | `#173166` | Deep blue (gradient start) |
| `blue-800` | `#0C1933` | Very dark blue |
| `blue-900` | `#070F1F` | Near-black blue |

### 3.3 Orange — Warm Accent

| Token | Hex |
|---|---|
| `orange-000` | `#FFF5F0` |
| `orange-100` | `#FFD6C4` |
| `orange-200` | `#FFAD89` |
| `orange-300` | `#FF996C` |
| `orange-400` | `#ED7C4A` |
| `orange-500` | `#BE633B` |
| `orange-600` | `#8E4A2C` |

### 3.4 Purple — Secondary Accent

| Token | Hex |
|---|---|
| `purple-000` | `#F6F2FF` |
| `purple-100` | `#DDCBFF` |
| `purple-200` | `#BA97FF` |
| `purple-300` | `#A97DFF` |
| `purple-400` | `#9871E6` |
| `purple-500` | `#8764CC` |
| `purple-600` | `#654B99` |

### 3.5 Teal — Gradient / Illustration

| Token | Hex |
|---|---|
| `teal-000` | `#F4FFFE` |
| `teal-100` | `#D1FEF9` |
| `teal-200` | `#A4FDF4` |
| `teal-300` | `#8DFCF1` |
| `teal-400` | `#7FE3D9` |
| `teal-500` | `#71CAC1` |

### 3.6 Semantic Colors

| Purpose | Token | Hex |
|---|---|---|
| Success / Positive | `green-000` | `#EDF7EE` |
| Success / Positive | `green-100` | `#B7DFB9` |
| Success / Positive | `green-300` | `#4CAF50` |
| Success / Positive | `green-500` | `#358238` |
| Success / Positive | `green-600` | `#2E6930` |
| Error / Destructive | `red-000` | `#FEECEC` |
| Error / Destructive | `red-100` | `#FBB4B4` |
| Error / Destructive | `red-300` | `#F44343` |
| Error / Destructive | `red-500` | `#C33636` |
| Error / Destructive | `red-600` | `#922828` |
| Warning / Highlight | `yellow-000` | `#FFFEF8` |
| Warning / Highlight | `yellow-100` | `#FFFBE2` |
| Warning / Highlight | `yellow-300` | `#FFF6B6` |
| Warning / Highlight | `yellow-400` | `#FFEE70` |
| Warning / Highlight | `yellow-500` | `#f0da4e` |

### 3.7 Color Usage Rules

**DO:**
- Use `blue-400` (`#336FE6`) exclusively for buttons, link arrows, and interactive elements. Let color draw the eye to actions.
- Reserve gradients (teal/blue/purple aurora blends) for large hero moments and feature cards. They should feel special.

**DON'T:**
- Scatter blue throughout headlines, body copy, or decorative elements. Color is a signal, not decoration.
- Apply gradients to small UI elements, icons, or text. Gradients lose their impact when overused.

---

## 4. Typography

### 4.1 Typeface

**Primary font:** Inter (free, Google Fonts).
**Acceptable alternatives:** General Sans, Satoshi, Plus Jakarta Sans, Cabinet Grotesk, Switzer — any geometric sans-serif with a humanist touch that includes a light (300) weight.

```css
font-family: 'Inter', 'General Sans', 'Satoshi', system-ui, sans-serif;
```

### 4.2 Weight System

| Weight | Value | Usage |
|---|---|---|
| Light | `300` | Headlines, hero text, subtitles |
| Regular | `400` | Body text |
| Medium | `500` | Nav links, subheadings |
| Semibold | `600` | Section labels, emphasis |
| Extrabold | `800` | Button text only |

### 4.3 Type Scale

| Role | Size | Weight | Line Height | Letter Spacing | Color |
|---|---|---|---|---|---|
| H1 / Display | `96px` (clamp 48px–96px) | 300 | 1.1 | -0.02em | `white` |
| H2 / Section Title | `48–56px` (clamp 32px–56px) | 300 | 1.15 | -0.01em | `white` |
| H3 / Card Title | `24px` | 300 | 1.2 | — | `white` |
| Subtitle / Lead | `18px` | 300 | 1.7 | — | `neutral-600` |
| Body Text | `16px` | 400 | 1.7 | — | `neutral-700` |
| Navigation | `14px` | 500 | — | — | `neutral-700` (white on hover) |
| Button Label | `14px` | 800 | 1.7 | — | `white` |
| Small / Caption | `14px` | 400 | 1.5 | — | `neutral-500` |
| Section Label | `14px` | 600 | — | — | `white` |

### 4.4 Typographic Rules

**DO:** Use weight 300 (light) for all display/hero headings. The contrast between massive size and thin weight is the signature.

**DON'T:** Use bold (700+) weights for headings. Bold headlines destroy the elegant, effortless feel of the brand.

---

## 5. Components

Every component follows the same principles: minimal borders, no shadows, pill-shaped interactives, and muted neutral palettes with blue reserved for action.

### 5.1 Buttons

**Primary CTA:**
```css
background: #336FE6;
color: #FFFFFF;
border: 2px solid #336FE6;
border-radius: 60px;       /* Pill shape */
padding: 12px 24px;
font-weight: 800;
font-size: 14px;
transition: all 0.25s ease-in-out;
```
Hover: `background: #397BFF; border-color: #397BFF;`

**Ghost / Secondary CTA:**
```css
background: transparent;
color: #FFFFFF;
border: 2px solid #FFFFFF;
border-radius: 60px;
padding: 12px 24px;
font-weight: 800;
font-size: 14px;
```
Hover: `background: rgba(255,255,255,0.1);`

**Icon Button (circular):**
```css
width: 48px;
height: 48px;
border-radius: 50%;
background: #336FE6;
color: #FFFFFF;
```

### 5.2 Link Arrows

```
Text → (arrow animates right on hover)
```

- Color: `blue-400` (`#336FE6`)
- Weight: 600
- Size: 14px
- Hover behavior: gap between text and arrow increases from 6px to 10px

### 5.3 Section Labels

Pill-shaped label with section name, horizontal rule, and number.

```css
font-size: 14px;
font-weight: 600;
border: 1px solid #5C5B5E;   /* neutral-400 */
border-radius: 4px;
padding: 4px 8px;
background: #1C1B1C;          /* neutral-200 */
/* Interior line: 40px wide, 1px tall, neutral-400 */
```

Examples for StoryEngine:
- `Account Journeys — 01`
- `Story Builder — 02`
- `RAG Engine — 03`
- `Landing Pages — 04`
- `AI Settings — 05`

### 5.4 Navigation Bar

- Background: `neutral-000` (`#090A0F`)
- Sticky/pinned to top
- Logo: left-aligned, "StoryEngine" wordmark in `blue-400` (`#336FE6`), 16px, weight 700
- Nav links: centered or right-aligned, `neutral-700`, white on hover, 14px, weight 500
- Subtle blue accent line at bottom edge
- Border: `1px solid neutral-300`

StoryEngine nav links: `Dashboard`, `Accounts`, `Stories`, `Pages`, `Settings`

### 5.5 Cards

```css
background: #121213;          /* neutral-100 */
border: 1px solid #2E2D2F;   /* neutral-300 */
border-radius: 8px;
/* NO box shadows */
```

- Optional image area at top
- Body padding: 24px
- H3 title + small-text description + link-arrow CTA

### 5.6 Gradient Feature Card (Hero CTA)

```css
border-radius: 16px;
padding: 80px 60px;
text-align: center;
background: linear-gradient(
  135deg,
  #173166 0%,
  #336FE6 20%,
  #71CAC1 45%,
  #A4FDF4 65%,
  #D1FEF9 85%,
  #8DFCF1 100%
);
```

Text on gradient backgrounds switches to dark (`#1E1E1E`). Used for high-impact CTAs and hero moments only.

---

## 6. Spacing & Layout

### 6.1 Base Grid

8px base unit. All spacing values are multiples of 4 or 8.

| Token | Value | Usage |
|---|---|---|
| `xxs` | 4px | Tight internal gaps |
| `xs` | 8px | Icon gaps, small padding |
| `sm` | 16px | Card internal spacing |
| `md` | 24px | Card body padding, element gaps |
| `lg` | 32px | Section internal spacing |
| `xl` | 48px | Between section label and heading |
| `2xl` | 80px | Hero bottom padding |
| `3xl` | 100px | Section top/bottom padding |

### 6.2 Border Radius

| Value | Usage |
|---|---|
| `4px` | Labels, tags, badges |
| `8px` | Cards, containers, code blocks |
| `16px` | Feature cards, gradient hero cards |
| `50px` | Inputs, dropdowns |
| `60px` | Buttons (pill shape) |
| `50%` | Icon buttons (circle) |

### 6.3 Layout Specifications

```css
/* Page Container */
max-width: 1200px;
margin: 0 auto;
padding: 0 40px;

/* Section Spacing */
padding-top: 100px;
padding-bottom: 100px;
border-bottom: 1px solid #2E2D2F;   /* thin divider */

/* Hero Section */
padding-top: 120px;
text-align: center;

/* Content Max Widths */
--text-width: 700px;      /* Body/subtitle max-width */
--content-width: 1200px;  /* Page container */
```

---

## 7. Signature Motifs

### 7.1 Aurora Gradients
Feature sections and CTA cards use ethereal, multi-stop gradients evoking a northern lights / aurora effect. The gradient blends deep navy, cobalt blue, teal, and cyan with soft transitions.

```css
background: linear-gradient(
  135deg,
  #173166 0%,
  #336FE6 20%,
  #71CAC1 45%,
  #A4FDF4 65%,
  #D1FEF9 85%,
  #8DFCF1 100%
);
```

### 7.2 Numbered Sections
Each major page section is tagged with a pill-shaped label containing the section name, a horizontal rule, and a number (01, 02, 03...). Labels are left-aligned within the section and sit above the main heading with 48px of space between them.

### 7.3 Thin Horizontal Dividers
Every major section is separated by a single 1px line in `neutral-300` (`#2E2D2F`). Subtle structure without visual weight.

### 7.4 Dark Sticky Header
Navigation bar pinned to top, same near-black background (`#090A0F`), subtle blue accent line at bottom edge. Logo left, nav links center/right.

### 7.5 Logo Carousel (Social Proof)
Scrolling horizontal row of integration partner logos (Gong, Chorus, Zoom, Teams, Salesforce, HubSpot) in white monochrome on dark background. Auto-scrolling ticker. Bordered above and below by thin 1px neutral-300 lines.

---

## 8. CSS Variables — Complete Token Reference

```css
:root {
  /* Neutrals */
  --neutral-000: #090A0F;  --neutral-100: #121213;
  --neutral-200: #1C1B1C;  --neutral-300: #2E2D2F;
  --neutral-400: #5C5B5E;  --neutral-500: #8A888E;
  --neutral-600: #A19FA5;  --neutral-700: #B8B6BD;
  --neutral-800: #CFCCD4;  --neutral-900: #E6E3EC;
  --neutral-1000: #F3F1F6; --neutral-1100: #FAF9FB;
  --white: #FFFFFF;        --black: #1E1E1E;

  /* Blue (Primary Action) */
  --blue-000: #EBF2FF;  --blue-100: #B0CAFF;
  --blue-200: #6195FF;  --blue-300: #397BFF;
  --blue-400: #336FE6;  --blue-500: #2256C5;
  --blue-600: #224A99;  --blue-700: #173166;
  --blue-800: #0C1933;  --blue-900: #070F1F;

  /* Orange */
  --orange-000: #FFF5F0; --orange-100: #FFD6C4;
  --orange-200: #FFAD89; --orange-300: #FF996C;
  --orange-400: #ED7C4A; --orange-500: #BE633B;
  --orange-600: #8E4A2C;

  /* Purple */
  --purple-000: #F6F2FF; --purple-100: #DDCBFF;
  --purple-200: #BA97FF; --purple-300: #A97DFF;
  --purple-400: #9871E6; --purple-500: #8764CC;
  --purple-600: #654B99;

  /* Teal */
  --teal-000: #F4FFFE;  --teal-100: #D1FEF9;
  --teal-200: #A4FDF4;  --teal-300: #8DFCF1;
  --teal-400: #7FE3D9;  --teal-500: #71CAC1;

  /* Green (Success) */
  --green-000: #EDF7EE; --green-100: #B7DFB9;
  --green-300: #4CAF50;  --green-500: #358238;
  --green-600: #2E6930;

  /* Red (Error) */
  --red-000: #FEECEC;   --red-100: #FBB4B4;
  --red-300: #F44343;    --red-500: #C33636;
  --red-600: #922828;

  /* Yellow (Warning) */
  --yellow-000: #FFFEF8; --yellow-100: #FFFBE2;
  --yellow-300: #FFF6B6; --yellow-400: #FFEE70;
  --yellow-500: #f0da4e;
}
```

---

## 9. Footer Pattern

- Same dark background (`neutral-000`)
- Multi-column link structure (4 columns)
- Column headings: 14px, weight 600, white
- Links: 13px, `neutral-500`, hover to `neutral-700`
- Separated from content by thin 1px `neutral-300` border
- Bottom bar: social icons left, copyright + legal links right
- Social icons: `neutral-500`

StoryEngine footer columns:
- **Product:** Account Journeys, Story Builder, RAG Engine, Landing Pages, AI Settings
- **Integrations:** Gong, Chorus, Zoom, Teams, Salesforce, HubSpot
- **Company:** About, Careers, Blog, Legal
- **Support:** Documentation, Trust Center, Contact, API Reference

---

## 10. Voice & Messaging

### 10.1 Brand Positioning
StoryEngine turns your "Dark Data" (call recordings) into a competitive moat by making customer stories accessible, actionable, and anonymous enough to share anywhere.

### 10.2 Hero-Level Headlines (weight 300, massive scale)

- "Turn calls into case studies"
- "Your stories, told automatically"
- "Dark data, meet daylight"
- "Every call is a story waiting to be told"

### 10.3 Value Propositions by Audience

**SaaS Marketing — Content at the Speed of Conversation:**
Zero-friction social proof. Generate scrubbed "blind" case studies instantly. Publish 50 niche use cases instead of 2 "perfect" ones. Turn yesterday's closing call into today's blog post.

**RevOps — The Bridge Between Data and Reality:**
CRM enrichment via entity resolution. Funnel analytics using 60+ topic B2B taxonomy. AI cost governance via prepaid balance system and per-provider billing.

**Sales & Sales Enablement — The Ultimate Playbook:**
RAG-powered "similar deal" search. Instant onboarding via tagged deal anatomy recordings. Real-time competitive intelligence from call mentions.

**Solutions Consulting — Technical Validation:**
Vector-search technical proof points from prior implementations. Precision scoping from Account Journey views.

**Customer Success — Retention and Expansion:**
Seamless handoff via full Account Journey history. POST_SALE tag expansion signal detection. Risk signal identification across thousands of calls.

### 10.4 Key Technical Differentiators

| Feature | Business Impact |
|---|---|
| PII / Company Scrubbing | Bypasses 90% of legal/PR hurdles for publishing social proof |
| Multi-Provider AI | Future-proofs the stack; use Claude for stories, GPT-4 for RAG |
| Unified Taxonomy (60+ topics) | Standardizes how the whole company talks about the funnel |
| Hybrid Billing (BYOK) | Enterprise clients bring their own API keys for security/cost |

---

## 11. Differentiation Levers

To evolve this brand over time while maintaining its DNA, adjust these variables:

| Lever | Current Default | How to Shift |
|---|---|---|
| Accent color | Blue `#336FE6` | Replace with a vibrant violet, electric green, or warm amber — the entire system pivots on this single accent |
| Typeface | Inter | Swap for General Sans, Satoshi, Cabinet Grotesk, or Switzer — must have light (300) weight |
| Neutral undertone | Cool purple | Shift warmer (brown/taupe) or cooler (blue-gray) |
| Gradient palette | Aurora (blue → teal → cyan → mint) | Create a sunset (amber → rose → violet) or forest (emerald → teal → slate) variant |
| Hero motif | Inline photography within headlines | Consider animated SVG patterns, custom illustrations, or kinetic typography |
| Logo style | Text-only wordmark ("StoryEngine"), weight 700 | Must work in blue-400 on dark, white on gradients, and black on light |

---

## 12. Quick-Reference Cheat Sheet

When generating any StoryEngine UI or marketing asset, apply these rules:

1. **Background:** Always start with `#090A0F` (near-black)
2. **Headlines:** Weight 300, massive size, white text
3. **Body text:** Weight 400, 16px, `#B8B6BD` (neutral-700)
4. **Buttons:** Pill-shaped (60px radius), `#336FE6` background, weight 800, 14px
5. **Links:** `#336FE6` with arrow, weight 600
6. **Cards:** `#121213` background, 1px `#2E2D2F` border, 8px radius, no shadows
7. **Spacing:** 100px between sections, 48px between label and heading, 24px card padding
8. **Gradients:** Aurora blend only for hero/CTA moments, never small elements
9. **Font:** Inter (or geometric sans with 300 weight)
10. **Borders:** Always 1px, always `neutral-300` or `neutral-400`
11. **Never:** Box shadows, bold headlines, colored body text, gradients on small elements
