/**
 * Public Page — CSS Styles
 *
 * All CSS string constants used by the public landing page renderer.
 * Split out to keep the renderer focused on HTML template composition.
 */

// ─── Main Landing Page Styles ────────────────────────────────────────────────

/**
 * Returns the main stylesheet for a public landing page.
 * `brandingCssOverrides` is a pre-sanitized string of CSS custom-property
 * overrides injected into :root (e.g. `--color-accent: #ff0000;`).
 * `customCss` is user-provided CSS that has already been sanitized.
 */
export function getLandingPageStyles(
  brandingCssOverrides: string,
  customCss: string,
): string {
  return `
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
      ${brandingCssOverrides}
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
    .branding-header {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
      padding: 0.4rem 0.7rem;
      border: 1px solid var(--color-border);
      border-radius: 999px;
      background: var(--color-surface);
    }
    .branding-header__logo {
      width: 24px;
      height: 24px;
      object-fit: contain;
      border-radius: 6px;
      border: 1px solid var(--color-border);
      background: white;
    }
    .branding-header__name {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--color-text-secondary);
      letter-spacing: 0.01em;
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

    /* ─── Reading Time ─────────────────────────────────────────── */
    .reading-time {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      color: var(--color-text-secondary);
      margin-top: 0.75rem;
    }

    /* ─── Share Section ────────────────────────────────────────── */
    .share-section {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-top: 2.5rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--color-border);
    }
    .share-section__label {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--color-text-secondary);
      white-space: nowrap;
    }
    .share-section__buttons {
      display: flex;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .share-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 14px;
      font-size: 0.82rem;
      font-weight: 500;
      font-family: var(--font-sans);
      color: var(--color-text-secondary);
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 8px;
      text-decoration: none;
      cursor: pointer;
      transition: border-color 0.15s, color 0.15s;
    }
    .share-btn:hover {
      border-color: var(--color-accent);
      color: var(--color-accent);
    }

    /* ─── Footer ────────────────────────────────────────────────── */
    .page-footer {
      text-align: center;
      padding: 2rem 1.5rem;
      font-size: 0.82rem;
      color: var(--color-text-secondary);
      border-top: 1px solid var(--color-border);
      margin-top: 3rem;
    }
    .page-footer strong {
      color: var(--color-accent);
      font-weight: 600;
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

    ${customCss}`;
}

// ─── Password Page Styles ──────────────────────────────────────────────────

export const PASSWORD_PAGE_STYLES = `
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
    .error[hidden] { display: none; }`;

// ─── 404 Page Styles ───────────────────────────────────────────────────────

export const ERROR_404_STYLES = `
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
    .error-page p { color: #555770; font-size: 0.95rem; line-height: 1.6; }`;

// ─── 410 Page Styles ───────────────────────────────────────────────────────

export const ERROR_410_STYLES = `
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
    .error-page p { color: #555770; font-size: 0.95rem; line-height: 1.6; }`;
