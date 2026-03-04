/**
 * Transcript Viewer — CSS Styles
 *
 * Contains all CSS for the server-rendered transcript viewer page.
 */

export function getTranscriptViewerStyles(): string {
  return `
    /* ─── Reset & Base ──────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --color-bg: #f8f9fb;
      --color-surface: #ffffff;
      --color-text: #1a1a2e;
      --color-text-secondary: #555770;
      --color-text-muted: #8b8fa3;
      --color-accent: #4f46e5;
      --color-accent-light: #eef2ff;
      --color-border: #e5e7eb;
      --color-border-light: #f0f1f3;
      --color-highlight: #fef08a;
      --color-highlight-active: #fde047;
      --sidebar-width: 340px;
      --header-height: 64px;
      --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --font-mono: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, monospace;
    }

    body {
      font-family: var(--font-sans);
      background: var(--color-bg);
      color: var(--color-text);
      line-height: 1.6;
      font-size: 14px;
      -webkit-font-smoothing: antialiased;
    }

    /* ─── Layout ─────────────────────────────────────────────────── */
    .layout {
      display: flex;
      min-height: 100vh;
    }

    .main {
      flex: 1;
      min-width: 0;
      margin-right: var(--sidebar-width);
      transition: margin-right 0.3s ease;
    }

    .main.sidebar-collapsed {
      margin-right: 0;
    }

    /* ─── Header ─────────────────────────────────────────────────── */
    .header {
      position: sticky;
      top: 0;
      z-index: 100;
      background: var(--color-surface);
      border-bottom: 1px solid var(--color-border);
      padding: 0 2rem;
    }

    .header__inner {
      display: flex;
      align-items: center;
      gap: 1rem;
      height: var(--header-height);
    }

    .header__title {
      font-size: 1.1rem;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 400px;
    }

    .header__tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
      flex: 1;
      overflow: hidden;
      max-height: 2rem;
    }

    /* ─── Search Bar ─────────────────────────────────────────────── */
    .search {
      position: relative;
      margin-left: auto;
      flex-shrink: 0;
    }

    .search__input {
      width: 260px;
      height: 36px;
      padding: 0 2.25rem 0 2.25rem;
      border: 1px solid var(--color-border);
      border-radius: 8px;
      font-size: 0.85rem;
      font-family: var(--font-sans);
      background: var(--color-bg);
      color: var(--color-text);
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    .search__input:focus {
      border-color: var(--color-accent);
      box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.1);
    }

    .search__icon {
      position: absolute;
      left: 0.65rem;
      top: 50%;
      transform: translateY(-50%);
      width: 16px;
      height: 16px;
      color: var(--color-text-muted);
      pointer-events: none;
    }

    .search__count {
      position: absolute;
      right: 0.65rem;
      top: 50%;
      transform: translateY(-50%);
      font-size: 0.7rem;
      color: var(--color-text-muted);
      pointer-events: none;
    }

    .search__nav {
      display: none;
      align-items: center;
      gap: 0.25rem;
      margin-left: 0.5rem;
    }

    .search__nav.active { display: flex; }

    .search__nav-btn {
      width: 28px;
      height: 28px;
      border: 1px solid var(--color-border);
      border-radius: 6px;
      background: var(--color-surface);
      color: var(--color-text-secondary);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }

    .search__nav-btn:hover { background: var(--color-bg); }

    .search__nav-btn svg { width: 14px; height: 14px; }

    /* ─── Transcript Body ────────────────────────────────────────── */
    .transcript {
      padding: 1.5rem 2rem 4rem;
      max-width: 860px;
    }

    /* ─── Segment ────────────────────────────────────────────────── */
    .seg {
      display: flex;
      gap: 1rem;
      padding: 1rem 0;
      border-bottom: 1px solid var(--color-border-light);
      scroll-margin-top: calc(var(--header-height) + 1rem);
    }

    .seg:last-child { border-bottom: none; }

    .seg__gutter {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.35rem;
      flex-shrink: 0;
      width: 52px;
    }

    .seg__avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      font-weight: 700;
      color: white;
      letter-spacing: 0.02em;
    }

    .seg__timestamp {
      font-size: 0.7rem;
      font-family: var(--font-mono);
      color: var(--color-text-muted);
      white-space: nowrap;
    }

    .seg__body {
      flex: 1;
      min-width: 0;
    }

    .seg__header {
      display: flex;
      align-items: baseline;
      gap: 0.5rem;
      margin-bottom: 0.3rem;
    }

    .seg__speaker {
      font-weight: 600;
      font-size: 0.9rem;
      color: var(--color-text);
    }

    .seg__duration {
      font-size: 0.7rem;
      color: var(--color-text-muted);
      font-family: var(--font-mono);
    }

    .seg__text {
      font-size: 0.9rem;
      line-height: 1.7;
      color: var(--color-text);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .seg__tags {
      display: flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      margin-top: 0.5rem;
    }

    /* ─── Tag Pills ──────────────────────────────────────────────── */
    .tag-pill {
      display: inline-flex;
      align-items: center;
      padding: 0.15rem 0.55rem;
      border-radius: 100px;
      font-size: 0.7rem;
      font-weight: 600;
      border: 1px solid;
      cursor: default;
      position: relative;
      white-space: nowrap;
    }

    .tag-pill--header {
      font-size: 0.65rem;
      padding: 0.1rem 0.45rem;
    }

    .tag-pill[data-tooltip]:hover::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: var(--color-text);
      color: white;
      padding: 0.4rem 0.65rem;
      border-radius: 6px;
      font-size: 0.72rem;
      font-weight: 400;
      white-space: nowrap;
      z-index: 1000;
      pointer-events: none;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    }

    .tag-pill[data-tooltip]:hover::before {
      content: '';
      position: absolute;
      bottom: calc(100% + 2px);
      left: 50%;
      transform: translateX(-50%);
      border: 4px solid transparent;
      border-top-color: var(--color-text);
      z-index: 1000;
    }

    /* ─── Search Highlights ──────────────────────────────────────── */
    mark.search-hit {
      background: var(--color-highlight);
      color: inherit;
      border-radius: 2px;
      padding: 0 1px;
    }

    mark.search-hit.active {
      background: var(--color-highlight-active);
      outline: 2px solid var(--color-accent);
      outline-offset: 1px;
    }

    /* ─── Sidebar ────────────────────────────────────────────────── */
    .sidebar {
      position: fixed;
      top: 0;
      right: 0;
      width: var(--sidebar-width);
      height: 100vh;
      background: var(--color-surface);
      border-left: 1px solid var(--color-border);
      overflow-y: auto;
      z-index: 50;
      transition: transform 0.3s ease;
    }

    .sidebar.collapsed {
      transform: translateX(100%);
    }

    .sidebar__toggle {
      position: absolute;
      top: 1rem;
      left: -16px;
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10;
      box-shadow: 0 2px 6px rgba(0,0,0,0.08);
      transition: transform 0.3s;
    }

    .sidebar__toggle svg {
      width: 16px;
      height: 16px;
      color: var(--color-text-secondary);
      transition: transform 0.3s;
    }

    .sidebar.collapsed .sidebar__toggle { left: -40px; }
    .sidebar.collapsed .sidebar__toggle svg { transform: rotate(180deg); }

    .sidebar__content {
      padding: 1.5rem;
    }

    .sidebar__section {
      margin-bottom: 1.75rem;
    }

    .sidebar__section:last-child { margin-bottom: 0; }

    .sidebar__heading {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--color-text-muted);
      margin-bottom: 0.75rem;
      display: flex;
      align-items: center;
      gap: 0.4rem;
    }

    .sidebar__call-title {
      font-size: 1rem;
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: 0.75rem;
      line-height: 1.4;
    }

    .count-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 100px;
      background: var(--color-accent-light);
      color: var(--color-accent);
      font-size: 0.65rem;
      font-weight: 700;
    }

    .recording-link {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--color-accent);
      text-decoration: none;
      margin-bottom: 0.75rem;
    }

    .recording-link:hover { text-decoration: underline; }

    /* ─── Metadata Grid ──────────────────────────────────────────── */
    .meta-grid {
      display: flex;
      flex-direction: column;
      gap: 0;
    }

    .meta-row {
      display: flex;
      justify-content: space-between;
      padding: 0.4rem 0;
      border-bottom: 1px solid var(--color-border-light);
      font-size: 0.82rem;
    }

    .meta-row:last-child { border-bottom: none; }

    .meta-label {
      color: var(--color-text-muted);
      font-weight: 500;
    }

    .meta-value {
      color: var(--color-text);
      font-weight: 500;
      text-align: right;
    }

    /* ─── Participants List ───────────────────────────────────────── */
    .participants-list {
      display: flex;
      flex-direction: column;
      gap: 0.6rem;
    }

    .participant {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }

    .participant__avatar {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.6rem;
      font-weight: 700;
      color: white;
      flex-shrink: 0;
    }

    .participant__info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .participant__name {
      font-size: 0.82rem;
      font-weight: 600;
      color: var(--color-text);
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .participant__subtitle {
      font-size: 0.72rem;
      color: var(--color-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .host-badge {
      font-size: 0.6rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--color-accent);
      background: var(--color-accent-light);
      padding: 0.05rem 0.35rem;
      border-radius: 4px;
    }

    .sidebar__empty {
      font-size: 0.82rem;
      color: var(--color-text-muted);
      font-style: italic;
    }

    /* ─── Entity Card ────────────────────────────────────────────── */
    .entity-card {
      border: 1px solid var(--color-border);
      border-radius: 8px;
      padding: 0.75rem;
    }

    .entity-card--resolved { border-color: #a7f3d0; background: #f0fdf4; }
    .entity-card--unresolved { border-color: #fecaca; background: #fef2f2; }

    .entity-status {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.78rem;
      font-weight: 600;
      margin-bottom: 0.5rem;
    }

    .entity-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .entity-dot--resolved { background: #059669; }
    .entity-dot--unresolved { background: #dc2626; }

    .entity-detail {
      display: flex;
      justify-content: space-between;
      padding: 0.25rem 0;
      font-size: 0.78rem;
    }

    .entity-label { color: var(--color-text-muted); }
    .entity-value { color: var(--color-text); font-weight: 500; }

    .entity-note {
      font-size: 0.78rem;
      color: var(--color-text-muted);
    }

    /* ─── Empty / Error States ───────────────────────────────────── */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 4rem 2rem;
      text-align: center;
    }

    .empty-state__icon {
      width: 48px;
      height: 48px;
      color: var(--color-text-muted);
      margin-bottom: 1rem;
    }

    .empty-state__title {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--color-text);
      margin-bottom: 0.3rem;
    }

    .empty-state__subtitle {
      font-size: 0.9rem;
      color: var(--color-text-muted);
    }

    /* ─── Responsive ─────────────────────────────────────────────── */
    @media (max-width: 900px) {
      :root { --sidebar-width: 280px; }
    }

    @media (max-width: 700px) {
      :root { --sidebar-width: 100vw; }
      .main { margin-right: 0; }
      .sidebar { transform: translateX(100%); }
      .sidebar.mobile-open { transform: translateX(0); }
      .sidebar__toggle { display: flex; }
      .search__input { width: 160px; }
      .transcript { padding: 1rem; }
    }
  `;
}
