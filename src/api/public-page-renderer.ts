/**
 * Public Landing Page Renderer
 *
 * Serves the published, company-name-scrubbed landing pages at /s/{slug}.
 * These pages are:
 *   - Not indexed by Google (noindex, nofollow)
 *   - Well-designed with callout boxes, typography, and a clean layout
 *   - Always show a floating badge: "Compiled by AI from X hours of real
 *     call recordings with a specific client"
 *   - Company name is fully scrubbed
 *   - Optionally password-protected
 *   - Accessible (WCAG 2.1 AA compliant)
 */

import { Router, type Request, type Response } from "express";
import { LandingPageEditor, type CalloutBox } from "../services/landing-page-editor.js";
import type { PrismaClient } from "@prisma/client";

// ─── Markdown to HTML (simple converter) ─────────────────────────────────────

function markdownToHtml(md: string): string {
  let html = md
    // Headers
    .replace(/^#### (.+)$/gm, "<h4>$1</h4>")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    // Italic
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Blockquotes
    .replace(/^> (.+)$/gm, '<blockquote><p>$1</p></blockquote>')
    // Unordered lists
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    // Horizontal rules
    .replace(/^---$/gm, "<hr>")
    // Tables (basic)
    .replace(/^\|(.+)\|$/gm, (_, content: string) => {
      const cells = content.split("|").map((c: string) => c.trim());
      const tds = cells.map((c: string) => `<td>${c}</td>`).join("");
      return `<tr>${tds}</tr>`;
    })
    // Line breaks
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");

  // Wrap loose <li> in <ul>
  html = html.replace(
    /(<li>.*?<\/li>(?:<br>)?)+/g,
    (match) => `<ul>${match.replace(/<br>/g, "")}</ul>`
  );

  // Wrap in paragraphs
  html = `<p>${html}</p>`;

  // Clean up empty paragraphs
  html = html.replace(/<p><\/p>/g, "");
  html = html.replace(/<p>(<h[1-4]>)/g, "$1");
  html = html.replace(/(<\/h[1-4]>)<\/p>/g, "$1");
  html = html.replace(/<p>(<blockquote>)/g, "$1");
  html = html.replace(/(<\/blockquote>)<\/p>/g, "$1");
  html = html.replace(/<p>(<ul>)/g, "$1");
  html = html.replace(/(<\/ul>)<\/p>/g, "$1");
  html = html.replace(/<p>(<hr>)<\/p>/g, "$1");

  // Wrap adjacent <tr> in <table>
  html = html.replace(
    /(<tr>.*?<\/tr>(?:\s*<tr>.*?<\/tr>)*)/g,
    '<table>$1</table>'
  );

  return html;
}

// ─── Callout Box Icon SVGs ───────────────────────────────────────────────────

const CALLOUT_ICONS: Record<string, string> = {
  metric:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>',
  quote:
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14.017 21v-7.391c0-5.704 3.731-9.57 8.983-10.609l.995 2.151c-2.432.917-3.995 3.638-3.995 5.849h4v10h-9.983zm-14.017 0v-7.391c0-5.704 3.748-9.57 9-10.609l.996 2.151c-2.433.917-3.996 3.638-3.996 5.849h3.983v10h-9.983z"/></svg>',
  insight:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  timeline:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>',
  warning:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  success:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>',
};

// ─── Callout type labels for screen readers ─────────────────────────────────

const CALLOUT_LABELS: Record<string, string> = {
  metric: "Key metric",
  quote: "Quote",
  insight: "Insight",
  timeline: "Timeline",
  warning: "Warning",
  success: "Success",
};

// ─── HTML Template ───────────────────────────────────────────────────────────

function renderLandingPageHtml(page: {
  title: string;
  subtitle: string | null;
  body: string;
  calloutBoxes: CalloutBox[];
  totalCallHours: number;
  heroImageUrl: string | null;
  customCss: string | null;
}): string {
  const bodyHtml = markdownToHtml(page.body);

  const calloutsHtml = page.calloutBoxes
    .map(
      (box) => {
        const iconType = box.icon ?? "insight";
        const label = CALLOUT_LABELS[iconType] ?? "Insight";
        return `
      <div class="callout callout--${iconType}" role="region" aria-label="${label}: ${escapeHtml(box.title)}">
        <div class="callout__icon">
          ${CALLOUT_ICONS[iconType] ?? CALLOUT_ICONS.insight}
        </div>
        <div class="callout__content">
          <h3 class="callout__title">${escapeHtml(box.title)}</h3>
          <p class="callout__body">${markdownToHtml(box.body)}</p>
        </div>
      </div>`;
      }
    )
    .join("\n");

  const heroSection = page.heroImageUrl
    ? `<div class="hero" role="img" aria-label="Page hero image" style="background-image: url('${escapeHtml(page.heroImageUrl)}')"></div>`
    : "";

  const hours = page.totalCallHours;
  const hoursLabel = hours === 1 ? "hour" : "hours";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <meta name="googlebot" content="noindex, nofollow">
  <title>${escapeHtml(page.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    /* ─── Reset & Base ──────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --color-bg: #fafafa;
      --color-surface: #ffffff;
      --color-text: #1a1a2e;
      --color-text-secondary: #555770;
      --color-accent: #4f46e5;
      --color-accent-hover: #4338ca;
      --color-accent-light: #eef2ff;
      --color-border: #e5e7eb;
      --color-focus: #4f46e5;
      --color-callout-metric: #059669;
      --color-callout-quote: #7c3aed;
      --color-callout-insight: #2563eb;
      --color-callout-timeline: #d97706;
      --color-callout-warning: #dc2626;
      --color-callout-success: #059669;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --font-serif: 'Georgia', 'Times New Roman', serif;
      --max-width: 720px;
    }

    html { scroll-behavior: smooth; }

    body {
      font-family: var(--font-sans);
      background: var(--color-bg);
      color: var(--color-text);
      line-height: 1.7;
      font-size: 16px;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    /* ─── Focus Styles ─────────────────────────────────────────── */
    :focus-visible {
      outline: 2px solid var(--color-focus);
      outline-offset: 2px;
    }

    /* ─── Skip to Content ──────────────────────────────────────── */
    .skip-link {
      position: absolute;
      top: -100%;
      left: 1rem;
      background: var(--color-accent);
      color: #ffffff;
      padding: 0.75rem 1.5rem;
      border-radius: 0 0 8px 8px;
      font-weight: 600;
      font-size: 0.9rem;
      z-index: 9999;
      text-decoration: none;
      transition: top 0.2s;
    }
    .skip-link:focus {
      top: 0;
      outline: 2px solid #ffffff;
      outline-offset: 2px;
    }

    /* ─── Hero ──────────────────────────────────────────────────── */
    .hero {
      width: 100%;
      height: 300px;
      background-size: cover;
      background-position: center;
      border-bottom: 1px solid var(--color-border);
    }

    /* ─── Container ─────────────────────────────────────────────── */
    .container {
      max-width: var(--max-width);
      margin: 0 auto;
      padding: 3rem 1.5rem 6rem;
    }

    /* ─── Header ────────────────────────────────────────────────── */
    .page-header {
      margin-bottom: 3rem;
      padding-bottom: 2rem;
      border-bottom: 2px solid var(--color-accent);
    }
    .page-header h1 {
      font-size: 2.25rem;
      font-weight: 700;
      line-height: 1.2;
      letter-spacing: -0.02em;
      color: var(--color-text);
      margin-bottom: 0.5rem;
    }
    .page-header .subtitle {
      font-size: 1.15rem;
      color: var(--color-text-secondary);
      font-weight: 400;
      line-height: 1.5;
    }

    /* ─── Callout Boxes ─────────────────────────────────────────── */
    .callouts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.25rem;
      margin: 2.5rem 0;
    }
    .callout {
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 1.5rem;
      display: flex;
      gap: 1rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.04);
      transition: box-shadow 0.2s, transform 0.2s;
    }
    .callout:hover {
      box-shadow: 0 4px 12px rgba(0,0,0,0.08);
      transform: translateY(-1px);
    }
    .callout__icon {
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 8px;
    }
    .callout__icon svg { width: 24px; height: 24px; }
    .callout--metric .callout__icon { background: #ecfdf5; color: var(--color-callout-metric); }
    .callout--quote .callout__icon { background: #f5f3ff; color: var(--color-callout-quote); }
    .callout--insight .callout__icon { background: #eff6ff; color: var(--color-callout-insight); }
    .callout--timeline .callout__icon { background: #fffbeb; color: var(--color-callout-timeline); }
    .callout--warning .callout__icon { background: #fef2f2; color: var(--color-callout-warning); }
    .callout--success .callout__icon { background: #ecfdf5; color: var(--color-callout-success); }
    .callout__title {
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 0.35rem;
    }
    .callout--metric .callout__title { color: var(--color-callout-metric); }
    .callout--quote .callout__title { color: var(--color-callout-quote); }
    .callout--insight .callout__title { color: var(--color-callout-insight); }
    .callout--timeline .callout__title { color: var(--color-callout-timeline); }
    .callout--warning .callout__title { color: var(--color-callout-warning); }
    .callout--success .callout__title { color: var(--color-callout-success); }
    .callout__body { font-size: 0.95rem; color: var(--color-text); }
    .callout__body p { margin: 0; }
    .callout__body strong { font-weight: 700; font-size: 1.4rem; display: block; margin-bottom: 0.25rem; }

    /* ─── Body Content ──────────────────────────────────────────── */
    .content h1 { font-size: 1.85rem; margin: 2.5rem 0 1rem; font-weight: 700; }
    .content h2 { font-size: 1.5rem; margin: 2.25rem 0 0.75rem; font-weight: 600; color: var(--color-accent); }
    .content h3 { font-size: 1.2rem; margin: 1.75rem 0 0.5rem; font-weight: 600; }
    .content p { margin-bottom: 1rem; }
    .content ul { margin: 0.5rem 0 1.5rem 1.5rem; }
    .content li { margin-bottom: 0.35rem; }
    .content blockquote {
      border-left: 4px solid var(--color-accent);
      background: var(--color-accent-light);
      padding: 1rem 1.5rem;
      margin: 1.5rem 0;
      border-radius: 0 8px 8px 0;
      font-style: italic;
    }
    .content blockquote p { margin: 0; color: var(--color-text); }
    .content strong { color: var(--color-text); }
    .content table {
      width: 100%;
      border-collapse: collapse;
      margin: 1.5rem 0;
      font-size: 0.9rem;
      overflow-x: auto;
      display: block;
    }
    .content table tr:first-child td { font-weight: 600; background: var(--color-accent-light); }
    .content td {
      padding: 0.6rem 0.8rem;
      border: 1px solid var(--color-border);
    }
    .content hr {
      border: none;
      border-top: 1px solid var(--color-border);
      margin: 2rem 0;
    }
    .content a {
      color: var(--color-accent);
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .content a:hover {
      color: var(--color-accent-hover);
    }

    /* ─── Floating AI Badge ─────────────────────────────────────── */
    .ai-badge {
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 12px;
      padding: 12px 18px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 0.82rem;
      color: var(--color-text-secondary);
      max-width: 360px;
      z-index: 1000;
      animation: badge-fade-in 0.6s ease-out 1s both;
    }
    .ai-badge__icon {
      flex-shrink: 0;
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #4f46e5, #7c3aed);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ai-badge__icon svg { width: 18px; height: 18px; color: white; }
    .ai-badge strong { color: var(--color-text); }
    .ai-badge__dismiss {
      flex-shrink: 0;
      width: 24px;
      height: 24px;
      border: none;
      background: transparent;
      color: var(--color-text-secondary);
      cursor: pointer;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      margin-left: 4px;
      transition: color 0.15s, background 0.15s;
    }
    .ai-badge__dismiss:hover {
      color: var(--color-text);
      background: var(--color-bg);
    }
    .ai-badge__dismiss svg { width: 14px; height: 14px; }
    .ai-badge[hidden] { display: none; }
    @keyframes badge-fade-in {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }

    /* ─── Responsive: Tablet (768px) ───────────────────────────── */
    @media (max-width: 768px) {
      .hero { height: 220px; }
      .container { padding: 2.5rem 1.25rem 5.5rem; }
      .page-header h1 { font-size: 2rem; }
      .page-header { margin-bottom: 2.5rem; padding-bottom: 1.5rem; }
    }

    /* ─── Responsive: Mobile (640px) ───────────────────────────── */
    @media (max-width: 640px) {
      .ai-badge { bottom: 12px; right: 12px; left: 12px; max-width: none; }
      .container { padding: 2rem 1rem 5rem; }
      .page-header h1 { font-size: 1.75rem; }
      .page-header .subtitle { font-size: 1.05rem; }
      .callouts { grid-template-columns: 1fr; }
      .hero { height: 180px; }
      .content table { font-size: 0.82rem; }
      .content td { padding: 0.5rem 0.6rem; }
      .callout { padding: 1.25rem; }
    }

    /* ─── Reduced Motion ───────────────────────────────────────── */
    @media (prefers-reduced-motion: reduce) {
      html { scroll-behavior: auto; }
      .ai-badge { animation: none; }
      .callout { transition: none; }
    }

    /* ─── Print ────────────────────────────────────────────────── */
    @media print {
      .ai-badge, .skip-link { display: none !important; }
      body { background: white; color: black; font-size: 12pt; }
      .container { max-width: 100%; padding: 0; }
      .hero { height: 150px; break-after: avoid; }
      .callout { break-inside: avoid; box-shadow: none; border: 1px solid #ccc; }
      .callouts { gap: 0.75rem; }
      .content blockquote { background: #f5f5f5; }
      a[href]::after { content: " (" attr(href) ")"; font-size: 0.8em; color: #666; }
    }

    ${page.customCss ?? ""}
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to content</a>

  ${heroSection}

  <main id="main-content" class="container">
    <header class="page-header">
      <h1>${escapeHtml(page.title)}</h1>
      ${page.subtitle ? `<p class="subtitle">${escapeHtml(page.subtitle)}</p>` : ""}
    </header>

    ${
      page.calloutBoxes.length > 0
        ? `<section class="callouts" aria-label="Key highlights">${calloutsHtml}</section>`
        : ""
    }

    <article class="content">
      ${bodyHtml}
    </article>
  </main>

  <!-- Floating AI Compilation Badge -->
  <aside class="ai-badge" role="complementary" aria-label="AI compilation notice">
    <div class="ai-badge__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2a4 4 0 014 4c0 1.1-.9 2-2 2h-4a2 2 0 01-2-2 4 4 0 014-4z"/>
        <path d="M8 8v8a4 4 0 004 4h0a4 4 0 004-4V8"/>
        <path d="M10 12h4"/>
        <path d="M10 16h4"/>
      </svg>
    </div>
    <span>
      Compiled by AI from <strong>${hours} ${hoursLabel}</strong>
      of real call recordings with a specific client
    </span>
    <button class="ai-badge__dismiss" aria-label="Dismiss notice" onclick="this.closest('.ai-badge').hidden=true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
      </svg>
    </button>
  </aside>
</body>
</html>`;
}

// ─── Password Challenge Page ─────────────────────────────────────────────────

function renderPasswordPage(slug: string, showError = false): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Password Required</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #fafafa;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 1rem;
      -webkit-font-smoothing: antialiased;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 2.5rem 2rem;
      box-shadow: 0 4px 20px rgba(0,0,0,0.08);
      max-width: 400px;
      width: 100%;
      text-align: center;
    }
    .card__icon {
      width: 48px;
      height: 48px;
      background: #eef2ff;
      border-radius: 12px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1.25rem;
      color: #4f46e5;
    }
    .card__icon svg { width: 24px; height: 24px; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; color: #1a1a2e; font-weight: 700; }
    .card__description { color: #555770; margin-bottom: 1.5rem; font-size: 0.9rem; line-height: 1.5; }
    .form-group { text-align: left; margin-bottom: 1rem; }
    label { display: block; font-size: 0.85rem; font-weight: 500; color: #1a1a2e; margin-bottom: 0.4rem; }
    input {
      width: 100%;
      padding: 0.75rem 1rem;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      font-size: 1rem;
      font-family: inherit;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    input:focus {
      outline: none;
      border-color: #4f46e5;
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.15);
    }
    button {
      width: 100%;
      padding: 0.75rem;
      background: #4f46e5;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background 0.15s;
    }
    button:hover { background: #4338ca; }
    button:focus-visible { outline: 2px solid #4f46e5; outline-offset: 2px; }
    .error {
      color: #dc2626;
      font-size: 0.85rem;
      margin-bottom: 1rem;
      padding: 0.6rem 0.75rem;
      background: #fef2f2;
      border-radius: 6px;
      border: 1px solid #fecaca;
    }
    .error[hidden] { display: none; }
  </style>
</head>
<body>
  <main class="card" role="main">
    <div class="card__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
        <path d="M7 11V7a5 5 0 0110 0v4"/>
      </svg>
    </div>
    <h1>This page is protected</h1>
    <p class="card__description">Enter the password to view this story.</p>
    <div class="error" role="alert" ${showError ? '' : 'hidden'}>Incorrect password. Please try again.</div>
    <form method="POST" action="/s/${escapeHtml(slug)}">
      <div class="form-group">
        <label for="password-input">Password</label>
        <input type="password" id="password-input" name="p" autocomplete="current-password" required autofocus />
      </div>
      <button type="submit">View Story</button>
    </form>
  </main>
</body>
</html>`;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export function createPublicPageRoutes(prisma: PrismaClient): Router {
  const router = Router();
  const editor = new LandingPageEditor(prisma);

  // Shared handler for both GET (with query param) and POST (with body) password flows
  async function handleSlugRequest(req: Request, res: Response): Promise<void> {
    const { slug } = req.params;
    const password =
      (req.query.p as string | undefined) ??
      (req.body?.p as string | undefined);

    // Check if page exists and needs a password
    const rawPage = await prisma.landingPage.findUnique({
      where: { slug },
      select: {
        status: true,
        visibility: true,
        password: true,
        expiresAt: true,
      },
    });

    if (!rawPage || rawPage.status !== "PUBLISHED") {
      res.status(404).send(render404());
      return;
    }

    if (rawPage.expiresAt && new Date() > rawPage.expiresAt) {
      res.status(410).send(render410());
      return;
    }

    if (rawPage.visibility === "PRIVATE") {
      res.status(404).send(render404());
      return;
    }

    // Password check
    if (rawPage.password && !password) {
      res.status(200).send(renderPasswordPage(slug));
      return;
    }

    if (rawPage.password && password !== rawPage.password) {
      res.status(200).send(renderPasswordPage(slug, true));
      return;
    }

    // Fetch and render
    const page = await editor.getPublicBySlug(slug, password);
    if (!page) {
      res.status(404).send(render404());
      return;
    }

    // Set noindex headers
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    res.setHeader("Cache-Control", "private, no-cache");
    res.send(renderLandingPageHtml(page));
  }

  /**
   * GET /s/:slug
   * Serves the published, scrubbed landing page as a full HTML page.
   */
  router.get("/:slug", handleSlugRequest);

  /**
   * POST /s/:slug
   * Handles password submission via POST to avoid password in URL.
   */
  router.post("/:slug", handleSlugRequest);

  return router;
}

// ─── Error Pages ─────────────────────────────────────────────────────────────

function render404(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Page Not Found</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #fafafa;
      padding: 1rem;
      -webkit-font-smoothing: antialiased;
    }
    .error-page { text-align: center; max-width: 420px; }
    .error-page__code {
      font-size: 5rem;
      font-weight: 700;
      color: #e5e7eb;
      line-height: 1;
      margin-bottom: 1rem;
    }
    .error-page h1 { font-size: 1.25rem; color: #1a1a2e; margin-bottom: 0.5rem; }
    .error-page p { color: #555770; font-size: 0.95rem; line-height: 1.6; }
  </style>
</head>
<body>
  <main class="error-page" role="main">
    <div class="error-page__code" aria-hidden="true">404</div>
    <h1>Page not found</h1>
    <p>The story you're looking for doesn't exist or is no longer available.</p>
  </main>
</body>
</html>`;
}

function render410(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>Link Expired</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: #fafafa;
      padding: 1rem;
      -webkit-font-smoothing: antialiased;
    }
    .error-page { text-align: center; max-width: 420px; }
    .error-page__icon {
      width: 56px;
      height: 56px;
      background: #fffbeb;
      border-radius: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 1.25rem;
      color: #d97706;
    }
    .error-page__icon svg { width: 28px; height: 28px; }
    .error-page h1 { font-size: 1.25rem; color: #1a1a2e; margin-bottom: 0.5rem; }
    .error-page p { color: #555770; font-size: 0.95rem; line-height: 1.6; }
  </style>
</head>
<body>
  <main class="error-page" role="main">
    <div class="error-page__icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/>
        <polyline points="12,6 12,12 16,14"/>
      </svg>
    </div>
    <h1>This link has expired</h1>
    <p>The owner of this story set an expiration date that has passed. Contact the person who shared this link to request access.</p>
  </main>
</body>
</html>`;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
