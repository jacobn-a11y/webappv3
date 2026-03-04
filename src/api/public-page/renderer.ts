/**
 * Public Page — Renderer
 *
 * Route handler + HTML template composition for the public landing pages
 * served at /s/{slug}. Includes:
 *   - Markdown-to-HTML converter
 *   - Callout-box icon/label maps
 *   - Landing page HTML template (`renderLandingPageHtml`)
 *   - Password challenge page
 *   - Error pages (404, 410)
 *   - Route registration (`registerRoutes`)
 */

import type { Router, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { escapeHtml } from "../../lib/html-utils.js";
import { LandingPageEditor, type CalloutBox } from "../../services/landing-page-editor.js";
import { verifyPagePassword } from "../../lib/page-password.js";
import {
  sanitizeCustomCss,
  sanitizeHeroImageUrl,
  sanitizeBrandingSettings,
} from "./sanitizers.js";
import {
  getLandingPageStyles,
  PASSWORD_PAGE_STYLES,
  ERROR_404_STYLES,
  ERROR_410_STYLES,
} from "./styles.js";

// ─── Markdown to HTML (simple converter) ─────────────────────────────────────

function markdownToHtml(md: string): string {
  const safeMd = escapeHtml(md);

  let html = safeMd
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

export function renderLandingPageHtml(page: {
  title: string;
  subtitle: string | null;
  body: string;
  calloutBoxes: CalloutBox[];
  totalCallHours: number;
  heroImageUrl: string | null;
  customCss: string | null;
  branding?: {
    brandName?: string | null;
    logoUrl?: string | null;
    primaryColor?: string | null;
    accentColor?: string | null;
    surfaceColor?: string | null;
  } | null;
}): string {
  const safeBranding = sanitizeBrandingSettings(page.branding);
  const bodyHtml = markdownToHtml(page.body);
  const safeCustomCss = sanitizeCustomCss(page.customCss) ?? "";
  const safeHeroImageUrl = sanitizeHeroImageUrl(page.heroImageUrl);
  const brandingCssOverrides = [
    safeBranding?.primaryColor ? `--color-accent: ${safeBranding.primaryColor};` : null,
    safeBranding?.primaryColor ? `--color-focus: ${safeBranding.primaryColor};` : null,
    safeBranding?.accentColor ? `--color-accent-hover: ${safeBranding.accentColor};` : null,
    safeBranding?.surfaceColor ? `--color-surface: ${safeBranding.surfaceColor};` : null,
  ]
    .filter((value): value is string => value !== null)
    .join("\n      ");

  // Reading time estimate (~200 words/min average reading speed)
  const wordCount = page.body.split(/\s+/).filter(Boolean).length;
  const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 200));
  const readingTimeLabel = readingTimeMinutes === 1 ? "1 min read" : `${readingTimeMinutes} min read`;
  const calloutBoxes = Array.isArray(page.calloutBoxes)
    ? page.calloutBoxes
    : [];

  const calloutsHtml = calloutBoxes
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
          <div class="callout__body">${markdownToHtml(box.body)}</div>
        </div>
      </div>`;
      }
    )
    .join("\n");

  const heroSection = safeHeroImageUrl
    ? `<div class="hero" role="img" aria-label="Page hero image" style="background-image: url('${escapeHtml(safeHeroImageUrl)}')"></div>`
    : "";

  const brandingHeader =
    safeBranding?.brandName || safeBranding?.logoUrl
      ? `<div class="branding-header" aria-label="Organization branding">
      ${
        safeBranding.logoUrl
          ? `<img class="branding-header__logo" src="${escapeHtml(safeBranding.logoUrl)}" alt="${escapeHtml(safeBranding.brandName ? `${safeBranding.brandName} logo` : "Organization logo")}" />`
          : ""
      }
      ${
        safeBranding.brandName
          ? `<span class="branding-header__name">${escapeHtml(safeBranding.brandName)}</span>`
          : ""
      }
    </div>`
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
  <style>${getLandingPageStyles(brandingCssOverrides, safeCustomCss)}
  </style>
</head>
<body>
  <a href="#main-content" class="skip-link">Skip to content</a>

  ${heroSection}

  <main id="main-content" class="container">
    <header class="page-header">
      ${brandingHeader}
      <h1>${escapeHtml(page.title)}</h1>
      ${page.subtitle ? `<p class="subtitle">${escapeHtml(page.subtitle)}</p>` : ""}
      <div class="reading-time" aria-label="Estimated reading time">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" aria-hidden="true">
          <circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/>
        </svg>
        ${readingTimeLabel}
      </div>
    </header>

    ${
      calloutBoxes.length > 0
        ? `<section class="callouts" aria-label="Key highlights">${calloutsHtml}</section>`
        : ""
    }

    <article class="content">
      ${bodyHtml}
    </article>

    <!-- Share section -->
    <div class="share-section" aria-label="Share this page">
      <span class="share-section__label">Share this story</span>
      <div class="share-section__buttons">
        <button class="share-btn" aria-label="Copy link to clipboard" onclick="navigator.clipboard.writeText(window.location.href).then(function(){var b=document.querySelector('.share-btn--copy-feedback');if(b){b.textContent='Copied!';setTimeout(function(){b.textContent='Copy link'},2000)}})">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" aria-hidden="true"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
          <span class="share-btn--copy-feedback">Copy link</span>
        </button>
        <a class="share-btn" href="mailto:?subject=${encodeURIComponent(page.title)}&body=Check out this story: " aria-label="Share via email" onclick="this.href=this.href+encodeURIComponent(window.location.href)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          Email
        </a>
        <a class="share-btn" href="https://www.linkedin.com/sharing/share-offsite/?url=" target="_blank" rel="noopener noreferrer" aria-label="Share on LinkedIn" onclick="this.href=this.href+encodeURIComponent(window.location.href)">
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
          LinkedIn
        </a>
      </div>
    </div>
  </main>

  <!-- Footer -->
  <footer class="page-footer" role="contentinfo">
    <p>
      Powered by <strong>StoryEngine</strong>
      ${
        safeBranding?.brandName
          ? ` for <strong>${escapeHtml(safeBranding.brandName)}</strong>`
          : ""
      }
    </p>
  </footer>

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
  <style>${PASSWORD_PAGE_STYLES}
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
  <style>${ERROR_404_STYLES}
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
  <style>${ERROR_410_STYLES}
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

// ─── Route Registration ──────────────────────────────────────────────────────

export function registerRoutes(deps: {
  router: Router;
  prisma: PrismaClient;
}): void {
  const { router, prisma } = deps;
  const editor = new LandingPageEditor(prisma);

  // Shared handler for GET and POST. Password is accepted via POST body only.
  async function handleSlugRequest(req: Request, res: Response): Promise<void> {
    const slug = req.params.slug as string;
    const password = typeof req.body?.p === "string" ? req.body.p : undefined;

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
    if (rawPage.password) {
      if (!password) {
        res.status(200).send(renderPasswordPage(slug));
        return;
      }

      if (!verifyPagePassword(password, rawPage.password)) {
        res.status(200).send(renderPasswordPage(slug, true));
        return;
      }
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
}
